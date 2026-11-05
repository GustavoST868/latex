import { $, toast } from './util.js';
import { S } from './state.js';
import { getPref, setPref } from './prefs.js';

const body = $('ide-body');
const railPanel = $('rail-panel');
const editorPane = $('editor-pane');
const pdfPane = $('pdf-pane');
const splitHandle = $('split-handle');
const btnCollapseEditor = $('btn-collapse-editor');
const btnCollapsePdf = $('btn-collapse-pdf');

export const LAYOUTS = [
  { id: 'both', label: 'Editor e PDF', icon: 'splitscreen_right' },
  { id: 'editor', label: 'Somente o editor', icon: 'edit_note' },
  { id: 'pdf', label: 'Somente o PDF', icon: 'picture_as_pdf' },
  { id: 'detached', label: 'PDF em outra janela', icon: 'open_in_new' },
];

const L = {
  mode: getPref('layout', 'both') === 'detached' ? 'both' : getPref('layout', 'both'),
  panel: getPref('railPanel', 'files'),
  railWidth: getPref('railWidth', 260),
  editorFraction: getPref('editorFraction', 0.5),
};

let detachedWin = null;
let detachedPoll = null;
const panelListeners = [];

export const getLayout = () => L.mode;
export const getRailPanel = () => L.panel;
export const onPanelShown = fn => panelListeners.push(fn);

// ════════════════════════════════════
//  LAYOUT MODES
// ════════════════════════════════════
export function setLayout(mode) {
  if (mode === 'detached') return detachPdf();
  if (L.mode === 'detached' && detachedWin && !detachedWin.closed) detachedWin.close();
  stopDetachedPoll();
  L.mode = mode;
  setPref('layout', mode);
  applyLayout();
}

function applyLayout() {
  const editorOnly = L.mode === 'editor' || L.mode === 'detached';
  body.classList.toggle('layout-editor', editorOnly);
  body.classList.toggle('layout-pdf', L.mode === 'pdf');
  body.classList.toggle('layout-detached', L.mode === 'detached');

  // In split mode both arrows collapse one side; otherwise the single arrow restores
  btnCollapseEditor.classList.toggle('hidden', L.mode === 'pdf');
  btnCollapsePdf.classList.toggle('hidden', editorOnly);
  btnCollapseEditor.title = editorOnly ? 'Mostrar o PDF' : 'Mostrar só o PDF';
  btnCollapsePdf.title = L.mode === 'pdf' ? 'Mostrar o editor' : 'Mostrar só o editor';

  editorPane.style.flex = `${L.editorFraction} 1 0`;
  pdfPane.style.flex = `${1 - L.editorFraction} 1 0`;
}

// Opens the PDF in its own window, which follows compiles over the WebSocket
function detachPdf() {
  if (!S.project) return;
  const url = `${location.pathname}#pdf=${encodeURIComponent(S.project)}`;
  detachedWin = window.open(url, `latex-pdf-${S.project}`, 'width=900,height=1000');
  if (!detachedWin) {
    toast('O navegador bloqueou a nova janela. Permita pop-ups para este site.', 'err');
    return;
  }
  L.mode = 'detached';
  applyLayout();
  stopDetachedPoll();
  // Bring the PDF back when the other window is closed
  detachedPoll = setInterval(() => {
    if (detachedWin.closed) setLayout('both');
  }, 1000);
}

function stopDetachedPoll() {
  clearInterval(detachedPoll);
  detachedPoll = null;
}

// Closes the detached window when leaving the project
export function resetDetached() {
  if (L.mode === 'detached') setLayout('both');
}

// ════════════════════════════════════
//  RAIL PANELS
// ════════════════════════════════════
export function setRailPanel(name, { toggle = false } = {}) {
  if (toggle && L.panel === name) name = null;
  L.panel = name;
  setPref('railPanel', name);
  applyRail();
  if (name) panelListeners.forEach(fn => fn(name));
}

function applyRail() {
  body.classList.toggle('rail-collapsed', !L.panel);
  railPanel.style.width = L.railWidth + 'px';
  document.querySelectorAll('.rail-tab[data-panel]').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.panel === L.panel);
  });
  document.querySelectorAll('#rail-panel .panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `panel-${L.panel}`);
  });
}

export const isRailVisible = () => !!L.panel;

// ════════════════════════════════════
//  DRAG HANDLES
// ════════════════════════════════════
function dragHandle(handle, onMove, onEnd) {
  handle.addEventListener('mousedown', e0 => {
    if (e0.target.closest('button')) return;
    e0.preventDefault();
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    // Iframes would swallow mouse events while dragging
    document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
    const move = e => onMove(e);
    const up = () => {
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      onEnd();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

export function initLayout() {
  document.querySelectorAll('.rail-tab[data-panel]').forEach(tab => {
    tab.addEventListener('click', () => setRailPanel(tab.dataset.panel, { toggle: true }));
  });

  dragHandle($('rail-handle'), e => {
    const left = railPanel.getBoundingClientRect().left;
    L.railWidth = Math.round(Math.max(180, Math.min(720, e.clientX - left)));
    railPanel.style.width = L.railWidth + 'px';
  }, () => setPref('railWidth', L.railWidth));

  // The PDF is drawn at a fixed zoom, so resizing doesn't need a re-render
  dragHandle(splitHandle, e => {
    if (L.mode !== 'both') return;
    const left = editorPane.getBoundingClientRect().left;
    const total = editorPane.offsetWidth + pdfPane.offsetWidth;
    const w = Math.max(280, Math.min(total - 240, e.clientX - left));
    L.editorFraction = +(w / total).toFixed(4);
    applyLayout();
  }, () => setPref('editorFraction', L.editorFraction));

  btnCollapseEditor.onclick = () => setLayout(L.mode === 'both' ? 'pdf' : 'both');
  btnCollapsePdf.onclick = () => setLayout(L.mode === 'both' ? 'editor' : 'both');

  applyLayout();
  applyRail();
}
