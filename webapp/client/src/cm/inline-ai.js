import { StateField, StateEffect, Prec } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, showTooltip, keymap } from '@codemirror/view';
import { el, icon } from '../util.js';
import { streamChat } from '../ai.js';

// Inline AI editing (Ctrl+J): a prompt box opens under the selection, the model's
// proposal streams in below the struck-through original, and Accept replaces it.
// With no selection, the proposal is inserted at the cursor.

const openEffect = StateEffect.define();   // { id, from, to }
const closeEffect = StateEffect.define();

// The open prompt, if any (one at a time); its DOM lives across redraws
let session = null;
let nextId = 1;

const SELECTION_ACTIONS = [
  'Corrija a ortografia e a gramática',
  'Melhore a escrita, mantendo o sentido',
  'Deixe mais curto',
  'Converta em uma tabela',
  'Converta em uma lista com \\item',
];
// One-click review and translation of the selection: the server answers these modes with
// JSON { result, changes: [{ original, suggestion, explanation }] }
const QUICK_ACTIONS = [
  { mode: 'review-en', label: 'Revisar inglês', icon: 'spellcheck', busy: 'Revisando…' },
  { mode: 'review-pt', label: 'Revisar português', icon: 'spellcheck', busy: 'Revisando…' },
  { mode: 'translate-en', label: 'Traduzir para inglês', icon: 'translate', busy: 'Traduzindo…' },
  { mode: 'translate-pt', label: 'Traduzir para português', icon: 'translate', busy: 'Traduzindo…' },
];
const CURSOR_ACTIONS = [
  'Escreva um parágrafo de introdução sobre o tema do documento',
  'Insira uma figura com legenda e rótulo',
  'Insira uma tabela de exemplo com booktabs',
  'Insira uma equação numerada de exemplo',
];

const inlineField = StateField.define({
  create: () => null,
  update(value, tr) {
    if (value && tr.docChanged) {
      const from = tr.changes.mapPos(value.from, 1);
      const to = Math.max(from, tr.changes.mapPos(value.to, -1));
      value = { ...value, from, to };
    }
    for (const e of tr.effects) {
      if (e.is(openEffect)) value = e.value;
      else if (e.is(closeEffect)) value = null;
    }
    if (!value) return null;
    // A selection of whole lines ends at the start of the next one: show the box above it
    const end = value.to > value.from && tr.state.doc.lineAt(value.to).from === value.to ? value.to - 1 : value.to;
    return { ...value, at: tr.state.doc.lineAt(end).to };
  },
  provide: field => EditorView.decorations.from(field, value => {
    if (!value) return Decoration.none;
    const ranges = [];
    if (value.to > value.from) ranges.push(Decoration.mark({ class: 'cm-ai-target' }).range(value.from, value.to));
    ranges.push(Decoration.widget({ widget: new PromptWidget(value.id), block: true, side: 1 }).range(value.at));
    return Decoration.set(ranges, true);
  }),
});

class PromptWidget extends WidgetType {
  constructor(id) {
    super();
    this.id = id;
  }

  eq(other) {
    return other.id === this.id;
  }

  toDOM() {
    return session?.id === this.id ? session.dom : document.createElement('div');
  }

  // Typing and clicking inside the box is not editor input
  ignoreEvent() {
    return true;
  }
}

// ════════════════════════════════════
//  SESSION (the prompt box)
// ════════════════════════════════════
function createSession(view, id, hasSelection) {
  const s = { id, view, controller: null, text: '', running: false, quick: null };
  const input = el('input', { type: 'text', className: 'cm-ai-input', placeholder: hasSelection ? 'O que fazer com o trecho selecionado?' : 'O que escrever aqui?' });
  const sendBtn = el('button', { className: 'cm-ai-btn primary', title: 'Gerar (Enter)' }, icon('arrow_upward'));
  const closeBtn = el('button', { className: 'cm-ai-btn', title: 'Fechar (Esc)' }, icon('close'));
  const quickRow = hasSelection ? el('div', { className: 'cm-ai-quick' },
    QUICK_ACTIONS.map(action => el('button', {
      className: 'cm-ai-quick-btn',
      onclick: () => { s.quick = action; input.value = action.label; generate(s); },
    }, icon(action.icon), action.label))) : null;
  const chips = el('div', { className: 'cm-ai-chips' },
    (hasSelection ? SELECTION_ACTIONS : CURSOR_ACTIONS).map(label => el('button', {
      className: 'cm-ai-chip',
      onclick: () => { s.quick = null; input.value = label; generate(s); },
    }, label)));
  const resultEl = el('pre', { className: 'cm-ai-result hidden' });
  const changesEl = el('ul', { className: 'cm-ai-changes hidden' });
  const status = el('div', { className: 'cm-ai-status' });
  const acceptBtn = el('button', { className: 'btn btn-primary', title: 'Ctrl+Enter' }, icon('check'), hasSelection ? 'Substituir' : 'Inserir');
  const retryBtn = el('button', { className: 'btn btn-ghost' }, icon('refresh'), 'Gerar de novo');
  const discardBtn = el('button', { className: 'btn btn-ghost' }, 'Descartar');
  const actions = el('div', { className: 'cm-ai-actions hidden' }, acceptBtn, retryBtn, discardBtn, el('span', { className: 'cm-ai-hint' }, 'Ctrl+Enter aceita · Esc descarta'));

  s.dom = el('div', { className: 'cm-ai-inline' },
    el('div', { className: 'cm-ai-row' }, icon('auto_awesome', 'cm-ai-spark'), input, sendBtn, closeBtn),
    quickRow, chips, resultEl, changesEl, status, actions);
  Object.assign(s, { input, sendBtn, quickRow, chips, resultEl, changesEl, status, actions, acceptBtn });

  // A typed instruction is a free-form edit, not the quick action that filled the box
  input.addEventListener('input', () => { s.quick = null; });
  sendBtn.onclick = () => (s.running ? s.controller?.abort() : generate(s));
  closeBtn.onclick = () => closeInlineAI(view);
  discardBtn.onclick = () => closeInlineAI(view);
  retryBtn.onclick = () => generate(s);
  acceptBtn.onclick = () => accept(s);
  s.dom.addEventListener('keydown', e => {
    // Never let these reach the editor or the global shortcuts (Ctrl+Enter compiles)
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeInlineAI(view);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (s.text && !s.running) accept(s);
    } else if (e.key === 'Enter' && e.target === input) {
      e.preventDefault();
      generate(s);
    }
  });
  return s;
}

const fieldOf = view => view.state.field(inlineField, false);

// The model sometimes wraps its answer in a code fence or echoes our markers
function cleanResult(text, original) {
  let out = text.replace(/^\s*```[\w-]*\n?/, '').replace(/\n?```\s*$/, '').replace(/^<<<\n?|\n?>>>$/g, '');
  if (original.endsWith('\n') && !out.endsWith('\n')) out += '\n';
  return out;
}

function promptFor(instruction, view, { from, to }) {
  const { doc } = view.state;
  const before = doc.sliceString(Math.max(0, from - 1500), from);
  const after = doc.sliceString(to, Math.min(doc.length, to + 600));
  if (to > from) {
    return `Instrução: ${instruction}\n\nTrecho a alterar:\n<<<\n${doc.sliceString(from, to)}\n>>>\n\n`
      + `Para contexto, o texto logo antes do trecho (não o repita):\n<<<\n${before}\n>>>`;
  }
  return `Instrução: ${instruction}\n\nEscreva o texto LaTeX a ser inserido na posição do cursor.\n`
    + `Texto antes do cursor:\n<<<\n${before}\n>>>\nTexto depois do cursor:\n<<<\n${after}\n>>>`;
}

// ════════════════════════════════════
//  QUICK ACTIONS (JSON replies)
// ════════════════════════════════════

// Decodes the "result" string of a JSON reply that is still streaming in
function partialResult(json) {
  const start = /"result"\s*:\s*"/.exec(json);
  if (!start) return '';
  const escapes = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };
  let out = '';
  for (let i = start.index + start[0].length; i < json.length; i++) {
    const c = json[i];
    if (c === '"') break;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const next = json[++i];
    if (next === undefined) break;
    if (next === 'u') {
      const hex = json.slice(i + 1, i + 5);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    } else {
      out += escapes[next] ?? next;
    }
  }
  return out;
}

// The full reply, or null when it is not the JSON we asked for
function parseReply(text) {
  let data;
  try {
    data = JSON.parse(text.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, ''));
  } catch {
    return null;
  }
  if (typeof data?.result !== 'string') return null;
  const changes = (Array.isArray(data.changes) ? data.changes : []).filter(c =>
    c && typeof c.original === 'string' && typeof c.suggestion === 'string' && c.original !== c.suggestion);
  return { result: data.result, changes };
}

// Models drop the selection's leading indentation and trailing newline: give them back
function keepEdges(result, original) {
  const lead = original.match(/^\s*/)[0];
  const trail = original.slice(lead.length).match(/\s*$/)[0];
  return lead + result.trim() + trail;
}

function showChanges(s, changes) {
  s.changesEl.replaceChildren(...changes.map(c => el('li', {},
    el('span', { className: 'cm-ai-del' }, c.original || '—'),
    icon('arrow_forward'),
    el('span', { className: 'cm-ai-ins' }, c.suggestion || '—'),
    typeof c.explanation === 'string' && c.explanation ? el('span', { className: 'cm-ai-why' }, c.explanation) : null)));
  s.changesEl.classList.toggle('hidden', !changes.length);
}

// What the box says once a quick action is done
function quickSummary(quick, original, reply) {
  if (!quick.mode.startsWith('review')) return '';
  if (reply.result === original) return 'Nenhum problema encontrado.';
  const n = reply.changes.length;
  return n === 1 ? '1 correção.' : n ? `${n} correções.` : '';
}

async function generate(s) {
  const instruction = s.input.value.trim();
  const range = fieldOf(s.view);
  if (!instruction || s.running || !range || session !== s) return;
  const original = s.view.state.sliceDoc(range.from, range.to);
  const quick = range.to > range.from ? s.quick : null;
  const busy = quick?.busy || 'Gerando…';
  s.running = true;
  s.text = '';
  s.controller = new AbortController();
  s.sendBtn.replaceChildren(icon('stop'));
  s.sendBtn.title = 'Parar';
  s.quickRow?.classList.add('hidden');
  s.chips.classList.add('hidden');
  s.actions.classList.add('hidden');
  s.acceptBtn.classList.remove('hidden');
  s.changesEl.classList.add('hidden');
  s.resultEl.classList.remove('hidden');
  s.resultEl.textContent = '';
  s.status.textContent = busy;
  try {
    const { text } = await streamChat({
      mode: quick ? quick.mode : 'edit',
      messages: [{ role: 'user', content: quick ? original : promptFor(instruction, s.view, range) }],
      signal: s.controller.signal,
      onUpdate: ({ text, thinking }) => {
        s.text = quick ? partialResult(text) : cleanResult(text, original);
        s.resultEl.textContent = s.text;
        if (!text && thinking) s.status.textContent = 'Pensando…';
        else if (text) s.status.textContent = busy;
      },
    });
    if (!quick) {
      s.status.textContent = s.text ? '' : 'O modelo não devolveu nenhum texto.';
    } else {
      const reply = parseReply(text);
      if (!reply || !reply.result.trim()) {
        s.text = '';
        s.resultEl.classList.add('hidden');
        s.status.textContent = 'O modelo não devolveu uma resposta válida. Tente de novo (Enter).';
      } else {
        s.text = keepEdges(reply.result, original);
        s.resultEl.textContent = s.text;
        showChanges(s, reply.changes);
        s.acceptBtn.classList.toggle('hidden', s.text === original);
        s.status.textContent = quickSummary(quick, original, { ...reply, result: s.text });
      }
    }
  } catch (err) {
    s.status.textContent = err.name === 'AbortError' ? 'Interrompido.' : 'Erro: ' + err.message;
  } finally {
    s.running = false;
    s.controller = null;
    s.sendBtn.replaceChildren(icon('arrow_upward'));
    s.sendBtn.title = 'Gerar (Enter)';
    s.actions.classList.toggle('hidden', !s.text);
    if (s.text && !s.acceptBtn.classList.contains('hidden')) s.acceptBtn.focus();
  }
}

function accept(s) {
  const range = fieldOf(s.view);
  if (!range || !s.text) return;
  const { text } = s;
  s.view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from, head: range.from + text.length },
    effects: closeEffect.of(null),
    userEvent: 'input.ai',
    scrollIntoView: true,
  });
  endSession();
  s.view.focus();
}

function endSession() {
  session?.controller?.abort();
  session = null;
}

/** Opens the prompt box for the selection (or the cursor). */
export function openInlineAI(view) {
  if (!view.state.facet(EditorView.editable)) return false;
  if (session) closeInlineAI(view);
  const sel = view.state.selection.main;
  const id = nextId++;
  session = createSession(view, id, !sel.empty);
  // Collapse the selection so the struck-through original stays visible
  view.dispatch({
    selection: { anchor: sel.to },
    effects: [openEffect.of({ id, from: sel.from, to: sel.to }), EditorView.scrollIntoView(sel.to, { y: 'nearest' })],
  });
  requestAnimationFrame(() => session?.input.focus());
  return true;
}

export function closeInlineAI(view) {
  const open = fieldOf(view);
  endSession();
  // Discarding gives the original selection back
  if (open) view.dispatch({ effects: closeEffect.of(null), selection: { anchor: open.from, head: open.to } });
  view.focus();
  return !!open;
}

export const isInlineAIOpen = view => !!fieldOf(view);

// ════════════════════════════════════
//  "Editar com IA" BUTTON ON THE SELECTION
// ════════════════════════════════════
function selectionTip(state) {
  const sel = state.selection.main;
  if (sel.empty || state.field(inlineField)) return null;
  return {
    pos: sel.head,
    above: sel.head === sel.from,
    arrow: false,
    create: view => ({
      dom: el('button', {
        className: 'cm-ai-tip',
        title: 'Editar o trecho selecionado com IA (Ctrl+J)',
        onmousedown: e => {
          e.preventDefault();
          openInlineAI(view);
        },
      }, icon('auto_awesome'), 'Editar com IA', el('span', { className: 'kbd' }, 'Ctrl+J')),
    }),
  };
}

const tipField = StateField.define({
  create: selectionTip,
  update: (tip, tr) => (tr.docChanged || tr.selection || tr.effects.length ? selectionTip(tr.state) : tip),
  provide: field => showTooltip.from(field),
});

// Sessions belong to one editor state; switching files or projects drops them
export function dropInlineAI() {
  endSession();
}

export function inlineAI() {
  return [
    inlineField,
    tipField,
    Prec.highest(keymap.of([
      { key: 'Mod-j', run: openInlineAI },
      { key: 'Escape', run: view => (fieldOf(view) ? closeInlineAI(view) : false) },
    ])),
  ];
}
