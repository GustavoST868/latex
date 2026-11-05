import { $, el, icon } from './util.js';
import { S } from './state.js';
import { getPref, setPref } from './prefs.js';
import { getView, onEditorUpdate, goToLine } from './editor.js';

// File outline: the sectioning commands of the open .tex file, like Overleaf's
const LEVELS = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };
const HEADING_RE = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*(?:\[[^\]]*\])?\s*\{/g;
// Beamer: \begin{frame}{Title} and \frametitle{Title}
const FRAME_RE = /\\(?:begin\s*\{frame\}(?:<[^>]*>)?(?:\[[^\]]*\])?\s*\{|frametitle\s*\{)/g;

const list = $('outline-list');
const section = $('outline');
let timer = null;
let headings = [];
let collapsed = new Set(); // lines of headings whose children are hidden

// Reads a {…} argument with nested braces, starting after the opening brace
function readGroup(text, start) {
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i);
  }
  return text.slice(start);
}

// Turns "Título com \emph{ênfase} e $x$" into readable text
const plain = title => title
  .replace(/\\[a-zA-Z@]+\*?\s*(\[[^\]]*\])?/g, '')
  .replace(/[{}]/g, '')
  .replace(/~/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function parse(doc) {
  const out = [];
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text.replace(/(^|[^\\])%.*$/, '$1');
    if (!text.includes('\\')) continue;
    for (const m of text.matchAll(HEADING_RE)) {
      out.push({ line: n, level: LEVELS[m[1]], starred: !!m[2], title: plain(readGroup(text, m.index + m[0].length)) || '(sem título)' });
    }
    for (const m of text.matchAll(FRAME_RE)) {
      out.push({ line: n, level: 7, frame: true, title: plain(readGroup(text, m.index + m[0].length)) || '(slide)' });
    }
  }
  return out;
}

// Index of the heading the cursor is in
function currentIndex(line) {
  let idx = -1;
  for (let i = 0; i < headings.length && headings[i].line <= line; i++) idx = i;
  return idx;
}

function render() {
  const view = getView();
  if (!view || S.openFile?.type !== 'text' || !S.openFile.path.endsWith('.tex')) {
    headings = [];
    list.replaceChildren(el('div', { className: 'outline-empty' }, 'Abra um arquivo .tex para ver o sumário.'));
    return;
  }
  headings = parse(view.state.doc);
  if (!headings.length) {
    list.replaceChildren(el('div', { className: 'outline-empty' }, 'Nenhuma seção neste arquivo.'));
    return;
  }

  const minLevel = Math.min(...headings.map(h => h.level));
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const current = currentIndex(cursorLine);
  const nodes = [];
  let hideBelow = Infinity; // level under a collapsed heading
  headings.forEach((h, i) => {
    if (h.level > hideBelow) return;
    hideBelow = Infinity;
    const hasChildren = headings[i + 1] && headings[i + 1].level > h.level;
    const isCollapsed = hasChildren && collapsed.has(h.line);
    if (isCollapsed) hideBelow = h.level;
    nodes.push(el('div', {
      className: 'outline-item' + (i === current ? ' active' : ''),
      title: `Linha ${h.line}`,
      onclick: () => goToLine(h.line),
    },
      el('span', {
        className: 'outline-chevron' + (isCollapsed ? '' : ' open'),
        onclick: e => {
          if (!hasChildren) return;
          e.stopPropagation();
          collapsed.has(h.line) ? collapsed.delete(h.line) : collapsed.add(h.line);
          render();
        },
      }, hasChildren ? icon('chevron_right') : null),
      el('span', { className: 'outline-title' + (h.frame ? ' frame' : '') }, h.title),
    ));
    nodes[nodes.length - 1].style.paddingLeft = `${4 + (h.level - minLevel) * 12}px`;
  });
  list.replaceChildren(...nodes);
  list.querySelector('.outline-item.active')?.scrollIntoView({ block: 'nearest' });
}

export function refreshOutline() {
  collapsed = new Set();
  clearTimeout(timer);
  render();
}

function setOpen(open) {
  section.classList.toggle('collapsed', !open);
  setPref('outline.open', open);
}

export function initOutline() {
  setOpen(getPref('outline.open', true));
  $('outline-toggle').onclick = () => setOpen(section.classList.contains('collapsed'));
  section.style.height = getPref('outline.height', 240) + 'px';

  // Drag the divider between the file tree and the outline
  const handle = $('outline-handle');
  handle.addEventListener('mousedown', e0 => {
    e0.preventDefault();
    const startY = e0.clientY, startH = section.offsetHeight;
    const max = section.parentElement.offsetHeight - 120;
    handle.classList.add('active');
    document.body.style.cursor = 'row-resize';
    const move = e => { section.style.height = Math.max(80, Math.min(max, startH - (e.clientY - startY))) + 'px'; };
    const up = () => {
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      setPref('outline.height', section.offsetHeight);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  onEditorUpdate(() => {
    clearTimeout(timer);
    timer = setTimeout(render, 250);
  });
  render();
}
