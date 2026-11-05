import { $, el, icon, toast } from './util.js';
import { S } from './state.js';
import { api, fileUrl } from './api.js';
import { getPref, setPref } from './prefs.js';
import { getView, isTextOpen, insertText, onEditorUpdate } from './editor.js';
import { setRailPanel, getRailPanel } from './layout.js';
import { getLogEntries } from './logs.js';
import { aiStatus, aiPref, setAiPref, aiEnabled, pickModel, streamChat } from './ai.js';
import { renderMarkdown } from './markdown.js';

// "Assistente de IA" panel: a chat with a local model (Ollama) that can see the
// selection or the code around the cursor and put its answers into the editor
const C = {
  messages: [],      // { role, content, display?, context?, model?, thinking?, error?, stopped? }
  busy: false,
  controller: null,
  nodes: new Map(),  // message → element
};

const list = $('ai-messages');
const input = $('ai-input');
const sendBtn = $('btn-ai-send');
const modelSelect = $('ai-model');
const contextSelect = $('ai-context-mode');
const contextChip = $('ai-context');
const notice = $('ai-notice');

const NEARBY_LINES = 40;
const MAX_FILE_CHARS = 24000;
const MAX_HISTORY = 30;    // messages sent back to the model
const MAX_SAVED = 60;      // messages kept per project

const SUGGESTIONS = [
  ['help', 'Explique o trecho selecionado', 'Explique o que este trecho faz, linha por linha.'],
  ['build', 'Corrija os erros da compilação', null],
  ['spellcheck', 'Revise a escrita', 'Revise a ortografia, a gramática e a clareza deste trecho e mostre a versão corrigida.'],
  ['table', 'Monte uma tabela', 'Crie uma tabela em LaTeX com booktabs, legenda e rótulo, com 3 colunas de exemplo.'],
];

// ════════════════════════════════════
//  CONTEXT FROM THE EDITOR
// ════════════════════════════════════
// Line numbers stay in the label: models tend to copy numbered lines into their answers

// What goes along with the next question: the selection, else what the context setting says
function currentContext() {
  const view = getView();
  if (!view || !isTextOpen()) return null;
  const { state } = view;
  const { doc } = state;
  const sel = state.selection.main;
  const file = S.openFile.path;
  if (!sel.empty) {
    const a = doc.lineAt(sel.from).number, b = doc.lineAt(sel.to).number;
    return { label: a === b ? `Seleção em ${file}, linha ${a}` : `Seleção em ${file}, linhas ${a}–${b}`, text: state.sliceDoc(sel.from, sel.to) };
  }
  const mode = aiPref('context');
  if (mode === 'none') return null;
  const cursor = doc.lineAt(sel.head).number;
  if (mode === 'file' && doc.length <= MAX_FILE_CHARS) {
    return { label: `Arquivo ${file} (cursor na linha ${cursor})`, text: doc.toString() };
  }
  const span = mode === 'file' ? Math.floor(NEARBY_LINES * 4) : NEARBY_LINES;
  const a = Math.max(1, cursor - span), b = Math.min(doc.lines, cursor + span);
  const lines = [];
  for (let n = a; n <= b; n++) lines.push(doc.line(n).text);
  return { label: `${file}, linhas ${a}–${b} (cursor na ${cursor})`, text: lines.join('\n') };
}

function renderContextChip() {
  if (!aiEnabled() || getRailPanel() !== 'ai') return;
  const ctx = currentContext();
  contextChip.replaceChildren(...(ctx ? [icon('attach_file'), el('span', {}, ctx.label)] : []));
  contextChip.classList.toggle('hidden', !ctx);
}

const withContext = (question, ctx) => (ctx ? `Contexto: ${ctx.label}\n\`\`\`latex\n${ctx.text}\n\`\`\`\n\n${question}` : question);

// ════════════════════════════════════
//  MESSAGES
// ════════════════════════════════════
const storageKey = () => `ai.chat.${S.project}`;

function save() {
  if (!S.project) return;
  const kept = C.messages.filter(m => m.role === 'user' || m.content).slice(-MAX_SAVED);
  setPref(storageKey(), kept.map(({ role, content, display, context, model }) => ({ role, content, display, context, model })));
}

function load() {
  C.messages = S.project ? getPref(storageKey(), []).filter(m => m && typeof m.content === 'string') : [];
  render();
}

function copy(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copiado'), () => toast('Não foi possível copiar', 'err'));
}

function codeBlock(code, lang) {
  return el('div', { className: 'ai-code' },
    el('div', { className: 'ai-code-bar' },
      el('span', {}, lang || 'código'),
      el('span', { className: 'tb-spacer' }),
      el('button', {
        className: 'link-btn',
        title: 'Substitui a seleção ou insere na posição do cursor',
        onclick: () => (insertText(code) ? toast('Inserido no editor') : toast('Abra um arquivo de texto para inserir', 'err')),
      }, icon('input'), 'Inserir no editor'),
      el('button', { className: 'link-btn', onclick: () => copy(code) }, icon('content_copy'), 'Copiar')),
    el('pre', {}, el('code', {}, code)));
}

function messageNode(m) {
  if (m.role === 'user') {
    return el('div', { className: 'ai-msg user' },
      el('div', { className: 'ai-bubble' }, m.display ?? m.content),
      m.context ? el('div', { className: 'ai-msg-context' }, icon('attach_file'), m.context) : null);
  }
  const waiting = !m.content && !m.error && !m.stopped;
  const last = m === C.messages[C.messages.length - 1];
  return el('div', { className: 'ai-msg assistant' },
    m.thinking ? el('details', { className: 'ai-thinking' }, el('summary', {}, 'Raciocínio'), el('pre', {}, m.thinking)) : null,
    waiting
      ? el('div', { className: 'ai-typing' }, el('span'), el('span'), el('span'), m.thinking ? ' pensando…' : '')
      : el('div', { className: 'ai-answer' }, renderMarkdown(m.content, codeBlock)),
    m.error ? el('div', { className: 'ai-error' }, icon('error'), m.error) : null,
    m.stopped ? el('div', { className: 'ai-meta' }, 'Resposta interrompida') : null,
    !C.busy || !last ? el('div', { className: 'ai-msg-actions' },
      m.model ? el('span', { className: 'ai-meta' }, m.model) : null,
      el('span', { className: 'tb-spacer' }),
      m.content ? el('button', { className: 'icon-btn', title: 'Copiar resposta', onclick: () => copy(m.content) }, icon('content_copy')) : null,
      last ? el('button', { className: 'icon-btn', title: 'Gerar outra resposta', onclick: regenerate }, icon('refresh')) : null,
    ) : null);
}

function emptyState() {
  return el('div', { className: 'ai-empty' },
    icon('auto_awesome'),
    el('p', {}, 'Pergunte sobre LaTeX ou sobre o seu documento. O assistente roda no seu computador, pelo Ollama: nada sai da sua máquina.'),
    el('p', { className: 'hint-text' }, 'Ele vê a seleção ou o trecho perto do cursor. Para editar um trecho direto no código, selecione-o e pressione Ctrl+J.'),
    el('div', { className: 'ai-suggestions' }, SUGGESTIONS.map(([ic, label, prompt]) => el('button', {
      className: 'ai-suggestion',
      onclick: () => (prompt ? send(prompt) : fixCompileErrors()),
    }, icon(ic), label))));
}

function render() {
  C.nodes.clear();
  if (!C.messages.length) {
    list.replaceChildren(emptyState());
    return;
  }
  list.replaceChildren(...C.messages.map(m => {
    const node = messageNode(m);
    C.nodes.set(m, node);
    return node;
  }));
  list.scrollTop = list.scrollHeight;
}

// Redraws one message while it streams, at most once per frame
let frame = 0;
function update(m) {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const old = C.nodes.get(m);
    if (!old) return render();
    const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const node = messageNode(m);
    old.replaceWith(node);
    C.nodes.set(m, node);
    if (stick) list.scrollTop = list.scrollHeight;
  });
}

// ════════════════════════════════════
//  SENDING
// ════════════════════════════════════
function setBusy(busy) {
  C.busy = busy;
  sendBtn.replaceChildren(icon(busy ? 'stop' : 'arrow_upward'));
  sendBtn.title = busy ? 'Parar' : 'Enviar (Enter)';
  sendBtn.classList.toggle('stop', busy);
}

async function ask() {
  const reply = { role: 'assistant', content: '', thinking: '' };
  C.messages.push(reply);
  render();
  setBusy(true);
  C.controller = new AbortController();
  const history = C.messages.slice(0, -1)
    .filter(m => m.role === 'user' || m.content)
    .slice(-MAX_HISTORY)
    .map(({ role, content }) => ({ role, content }));
  try {
    const { model } = await streamChat({
      messages: history,
      signal: C.controller.signal,
      onUpdate: ({ text, thinking }) => {
        reply.content = text;
        reply.thinking = thinking;
        update(reply);
      },
    });
    reply.model = model;
  } catch (err) {
    if (err.name === 'AbortError') reply.stopped = true;
    else reply.error = err.message;
    if (!C.messages.length) return; // conversation cleared meanwhile
  } finally {
    C.controller = null;
    setBusy(false);
  }
  cancelAnimationFrame(frame);
  frame = 0;
  save();
  render();
  refreshStatus();
}

// Sends a question; `display` is what the chat shows when it differs from what the model gets
export async function send(question, { display = question, context = currentContext() } = {}) {
  question = question.trim();
  if (C.busy || !question || !S.project) return;
  C.messages.push({ role: 'user', content: withContext(question, context), display, context: context?.label });
  await ask();
}

function regenerate() {
  if (C.busy) return;
  const last = C.messages[C.messages.length - 1];
  if (last?.role === 'assistant') C.messages.pop();
  if (C.messages[C.messages.length - 1]?.role === 'user') ask();
}

function stop() {
  C.controller?.abort();
}

function newConversation() {
  stop();
  C.messages = [];
  save();
  render();
  input.focus();
}

// ════════════════════════════════════
//  COMPILE ERRORS
// ════════════════════════════════════
async function sourceAround(path, line, span = 6) {
  const view = getView();
  const text = S.openFile?.path === path && isTextOpen() ? view.state.doc.toString() : (await api(fileUrl(path))).content;
  const lines = text.split('\n');
  const a = Math.max(1, line - span), b = Math.min(lines.length, line + span);
  const excerpt = lines.slice(a - 1, b);
  if (excerpt[line - a] != null) excerpt[line - a] += '   % <- linha do problema';
  return { label: `${path}, linhas ${a}–${b} (problema na ${line})`, text: excerpt.join('\n') };
}

export function openChat() {
  if (getRailPanel() !== 'ai') setRailPanel('ai');
}

// "Perguntar à IA" on an entry of the compile log
export async function askAboutLogEntry(entry) {
  openChat();
  const kind = entry.level === 'error' ? 'erro' : 'aviso';
  let context = null;
  if (entry.path && entry.line) {
    try { context = await sourceAround(entry.path, entry.line); } catch {}
  }
  const details = entry.content && entry.content !== entry.message ? `\n${entry.content.trim()}` : '';
  await send(`A compilação deu este ${kind}:\n\n${entry.message}${details}\n\nExplique a causa e mostre como corrigir.`, {
    display: `Explique este ${kind}: ${entry.message}`,
    context,
  });
}

async function fixCompileErrors() {
  const errors = getLogEntries().filter(e => e.level === 'error').slice(0, 5);
  if (!errors.length) {
    toast('A última compilação não teve erros');
    return;
  }
  const first = errors.find(e => e.path && e.line);
  let context = null;
  if (first) {
    try { context = await sourceAround(first.path, first.line, 10); } catch {}
  }
  const listText = errors.map(e => `- ${e.path || e.file || '?'}${e.line ? `:${e.line}` : ''}: ${e.message}`).join('\n');
  await send(`A compilação deu estes erros:\n${listText}\n\nExplique cada um e mostre o código corrigido.`, {
    display: `Corrija os erros da compilação (${errors.length})`,
    context,
  });
}

// ════════════════════════════════════
//  STATUS & MODELS
// ════════════════════════════════════
async function refreshStatus({ refresh = false } = {}) {
  const status = await aiStatus({ refresh });
  if (!status.available) {
    notice.replaceChildren(
      el('strong', {}, 'O Ollama não foi encontrado'),
      el('p', {}, status.error || ''),
      el('p', {}, 'Instale em ', el('code', {}, 'ollama.com'), ', depois rode ', el('code', {}, 'ollama pull qwen3.5:9b'), ' no terminal.'),
      el('button', { className: 'btn btn-ghost', onclick: () => refreshStatus({ refresh: true }) }, icon('refresh'), 'Tentar de novo'));
  } else if (!status.models.length) {
    notice.replaceChildren(
      el('strong', {}, 'Nenhum modelo instalado'),
      el('p', {}, 'No terminal, rode ', el('code', {}, 'ollama pull qwen3.5:9b'), ' (ou outro modelo) e tente de novo.'),
      el('button', { className: 'btn btn-ghost', onclick: () => refreshStatus({ refresh: true }) }, icon('refresh'), 'Tentar de novo'));
  }
  notice.classList.toggle('hidden', status.available && status.models.length > 0);

  const current = pickModel(status.models);
  modelSelect.replaceChildren(...status.models.map(m => el('option', { value: m.name }, m.size ? `${m.name} · ${m.size}` : m.name)));
  modelSelect.value = current;
  modelSelect.disabled = !status.models.length;
}

// ════════════════════════════════════
//  INIT
// ════════════════════════════════════
export function applyAiVisibility() {
  const on = aiEnabled();
  document.querySelector('.rail-tab[data-panel="ai"]').classList.toggle('hidden', !on);
  if (!on && getRailPanel() === 'ai') setRailPanel('files');
}

// Called when a project is opened or closed
export function resetChat() {
  stop();
  load();
  if (S.project && getRailPanel() === 'ai') onChatShown();
}

export function onChatShown() {
  refreshStatus();
  renderContextChip();
  input.focus();
}

export function initChat() {
  $('ai-composer').addEventListener('submit', e => {
    e.preventDefault();
    if (C.busy) return stop();
    const text = input.value;
    input.value = '';
    autosize();
    send(text);
  });
  const autosize = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', e => {
    // Keep Ctrl+Enter (compile) and other global shortcuts out of the chat box
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (!C.busy) $('ai-composer').requestSubmit();
    }
  });
  $('btn-ai-new').onclick = newConversation;
  modelSelect.onchange = () => setAiPref('model', modelSelect.value);
  contextSelect.value = aiPref('context');
  contextSelect.onchange = () => {
    setAiPref('context', contextSelect.value);
    renderContextChip();
  };
  onEditorUpdate(renderContextChip);
  setBusy(false);
  applyAiVisibility();
  load();
}
