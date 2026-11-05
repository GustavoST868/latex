import { $, el, icon, toast } from './util.js';
import { S } from './state.js';
import { api, projectUrl, outputUrl } from './api.js';
import { openMenu } from './menu.js';
import { openFileAtLine } from './project.js';
import { askAboutLogEntry } from './chat.js';
import { aiEnabled } from './ai.js';

const logPanel = $('log-panel');
const entriesEl = $('log-entries');
const rawEl = $('log-content');
const badge = $('log-badge');

const LEVELS = {
  error: { label: 'Erros', icon: 'error' },
  warning: { label: 'Avisos', icon: 'warning' },
  typesetting: { label: 'Formatação', icon: 'info' },
};

const state = { entries: [], filter: 'all', raw: false, outputFiles: [], done: false };

// Short explanations for the most common errors, shown under the message
const HINTS = [
  [/Undefined control sequence/, 'O comando não existe. Verifique a grafia ou se falta carregar um pacote com \\usepackage.'],
  [/Missing \$ inserted/, 'Há um símbolo matemático (como ^ ou _) fora do modo matemático. Use $…$ ao redor da fórmula.'],
  [/File `(.+)' not found/, 'O arquivo não foi encontrado. Confira o nome e se ele foi enviado para o projeto.'],
  [/Environment (.+) undefined/, 'Esse ambiente não existe. Verifique a grafia ou carregue o pacote que o define.'],
  [/\\begin\{(.+)\} on input line \d+ ended by \\end/, 'Os ambientes \\begin/\\end não estão casados. Feche-os na ordem inversa em que foram abertos.'],
  [/Missing \} inserted|Extra \}, or forgotten|Too many \}'s/, 'Há chaves { } sem par. Confira se cada { tem um } correspondente.'],
  [/Runaway argument/, 'Um argumento não foi fechado antes do fim do parágrafo — provavelmente falta um }.'],
  [/Emergency stop/, 'A compilação foi interrompida por um erro anterior. Corrija o primeiro erro da lista.'],
  [/Reference .+ undefined/, 'O rótulo citado em \\ref não existe (ou ainda falta compilar de novo). Confira o \\label.'],
  [/Citation .+ undefined/, 'A chave citada não foi encontrada nos arquivos .bib do projeto.'],
  [/Misplaced alignment tab character &/, 'O caractere & só pode ser usado em tabelas e alinhamentos. No texto, escreva \\&.'],
  [/Overfull \\hbox/, 'O conteúdo passou da margem. Reescreva a frase, permita hifenização ou reduza a imagem/tabela.'],
  [/Underfull \\hbox/, 'A linha ficou com espaçamento excessivo. Normalmente pode ser ignorado.'],
  [/There were undefined references/, 'Há referências sem rótulo correspondente — veja os avisos acima.'],
  [/Label\(s\) may have changed/, 'Compile novamente para atualizar as referências cruzadas.'],
];

function hintFor(message) {
  const hit = HINTS.find(([re]) => re.test(message));
  return hit ? hit[1] : null;
}

// ════════════════════════════════════
//  PANEL
// ════════════════════════════════════
export function setLogOpen(open) {
  logPanel.classList.toggle('open', open);
  $('btn-log').classList.toggle('active', open);
}

export const toggleLog = () => setLogOpen(!logPanel.classList.contains('open'));
export const isLogOpen = () => logPanel.classList.contains('open');

export function clearLogs() {
  Object.assign(state, { entries: [], filter: 'all', raw: false, outputFiles: [], done: false });
  rawEl.textContent = '';
  render();
  setLogOpen(false);
}

// Live output while compiling
export function startRawLog() {
  rawEl.textContent = '';
  state.done = false;
}

export function appendRawLog(text) {
  rawEl.textContent += text;
  if (state.raw) rawEl.scrollTop = rawEl.scrollHeight;
}

export function setLogResult({ entries, rawLog, outputFiles }) {
  const order = { error: 0, warning: 1, typesetting: 2 };
  state.entries = [...entries].sort((a, b) => order[a.level] - order[b.level]);
  state.outputFiles = outputFiles || [];
  state.done = true;
  rawEl.textContent = rawLog;
  if (state.filter !== 'all' && !state.entries.some(e => e.level === state.filter)) state.filter = 'all';
  render();
}

export const countErrors = () => state.entries.filter(e => e.level === 'error').length;
export const getLogEntries = () => state.entries;

function renderBadge() {
  const errors = countErrors();
  const warnings = state.entries.filter(e => e.level === 'warning').length;
  const n = errors || warnings;
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.className = 'log-badge' + (n ? (errors ? ' err' : ' warn') : ' hidden');
  $('btn-log').title = n
    ? `Logs: ${errors} erro(s), ${warnings} aviso(s)`
    : 'Logs e arquivos de saída';
}

function renderFilters() {
  const count = level => state.entries.filter(e => e.level === level).length;
  const filters = [['all', 'Todos', state.entries.length], ...Object.entries(LEVELS).map(([k, v]) => [k, v.label, count(k)])];
  $('log-filters').replaceChildren(...filters.map(([key, label, n]) => el('button', {
    className: `log-filter ${key}` + (state.filter === key && !state.raw ? ' active' : ''),
    onclick: () => { state.filter = key; state.raw = false; render(); },
  }, label, el('span', { className: 'count' }, n))));
}

function entryCard(e) {
  const hint = hintFor(e.message);
  const location = e.path
    ? el('button', {
      className: 'log-location',
      title: 'Ir para o código',
      onclick: () => openFileAtLine(e.path, e.line || 1),
    }, e.line ? `${e.path}, linha ${e.line}` : e.path)
    : e.file ? el('span', { className: 'log-location muted' }, e.line ? `${e.file}, linha ${e.line}` : e.file) : null;

  return el('div', { className: `log-entry ${e.level}` },
    el('div', { className: 'log-entry-header' },
      icon(LEVELS[e.level].icon),
      el('span', { className: 'log-entry-title' }, e.message),
      location),
    e.level !== 'typesetting' && aiEnabled() ? el('button', {
      className: 'link-btn log-ask-ai',
      title: 'Pedir ao assistente de IA uma explicação e uma correção',
      onclick: () => askAboutLogEntry(e),
    }, icon('auto_awesome'), 'Perguntar à IA') : null,
    hint ? el('p', { className: 'log-entry-hint' }, hint) : null,
    e.content && e.content !== e.message ? el('pre', { className: 'log-entry-content' }, e.content) : null,
  );
}

function render() {
  renderBadge();
  renderFilters();
  $('btn-raw-log').classList.toggle('active', state.raw);
  rawEl.classList.toggle('hidden', !state.raw);
  entriesEl.classList.toggle('hidden', state.raw);
  if (state.raw) return;

  const list = state.filter === 'all' ? state.entries : state.entries.filter(e => e.level === state.filter);
  if (!state.done) {
    entriesEl.replaceChildren(el('p', { className: 'log-empty' }, S.compiling ? 'Compilando…' : 'Compile o projeto para ver os logs.'));
  } else if (!list.length) {
    entriesEl.replaceChildren(el('div', { className: 'log-empty' }, icon('check_circle'), 'Nenhum problema encontrado.'));
  } else {
    entriesEl.replaceChildren(...list.map(entryCard));
  }
}

// ════════════════════════════════════
//  FOOTER ACTIONS
// ════════════════════════════════════
const formatSize = n => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

async function showOutputFiles(anchor) {
  let files = state.outputFiles;
  if (!files.length && S.project) {
    try { files = await api(`${projectUrl()}/output`); } catch {}
  }
  openMenu(anchor, files.length
    ? files.map(f => ({ label: `${f.name}  ·  ${formatSize(f.size)}`, icon: 'description', action: () => window.open(outputUrl(f.name), '_blank', 'noopener') }))
    : [{ label: 'Nenhum arquivo de saída', disabled: true, action: () => {} }]);
}

export function initLogs({ onClearCache }) {
  $('btn-close-log').onclick = () => setLogOpen(false);
  $('btn-raw-log').onclick = () => { state.raw = !state.raw; render(); if (state.raw) rawEl.scrollTop = rawEl.scrollHeight; };
  $('btn-output-files').addEventListener('mousedown', e => {
    e.preventDefault();
    showOutputFiles(e.currentTarget);
  });
  $('btn-clear-cache').onclick = async () => {
    if (!S.project) return;
    try {
      await api(`${projectUrl()}/output`, { method: 'DELETE' });
      state.outputFiles = [];
      toast('Arquivos em cache apagados');
      onClearCache?.();
    } catch (err) {
      toast('Erro: ' + err.message, 'err');
    }
  };
  render();
}
