import { $, el, icon, openModal, closeModal, toast } from './util.js';
import { S } from './state.js';
import { openMenu } from './menu.js';
import {
  insertSnippet, wrapSelection, toggleComment, editorUndo, editorRedo, openFind, setHeading, currentHeading,
  onEditorUpdate, escapeSnippet, triggerCompletion, editorIndentMore, editorIndentLess, isTextOpen,
} from './editor.js';
import { uploadFiles } from './project.js';
import { SYMBOLS } from './symbols.js';

const HEADINGS = [
  [null, 'Texto normal'],
  ['part', 'Parte'],
  ['chapter', 'Capítulo'],
  ['section', 'Seção'],
  ['subsection', 'Subseção'],
  ['subsubsection', 'Subsubseção'],
  ['paragraph', 'Parágrafo'],
  ['subparagraph', 'Subparágrafo'],
];

// ════════════════════════════════════
//  POPOVER (symbol palette & table picker)
// ════════════════════════════════════
const popover = el('div', { className: 'tb-popover hidden' });
document.body.appendChild(popover);
let popoverAnchor = null;

function openPopover(anchor, content) {
  if (popoverAnchor === anchor) return closePopover();
  popover.replaceChildren(content);
  popover.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - popover.offsetWidth - 8));
  popover.style.left = left + 'px';
  popover.style.top = r.bottom + 4 + 'px';
  popoverAnchor = anchor;
  anchor.classList.add('open');
}

function closePopover() {
  popover.classList.add('hidden');
  popoverAnchor?.classList.remove('open');
  popoverAnchor = null;
}

document.addEventListener('mousedown', e => {
  if (popoverAnchor && !popover.contains(e.target) && !popoverAnchor.contains(e.target)) closePopover();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopover(); });
window.addEventListener('resize', closePopover);

// ════════════════════════════════════
//  SYMBOL PALETTE
// ════════════════════════════════════
function symbolPalette() {
  const categories = Object.keys(SYMBOLS);
  let active = categories[0];
  const grid = el('div', { className: 'symbol-grid' });
  const search = el('input', { type: 'search', placeholder: 'Buscar símbolo…', className: 'symbol-search' });
  const tabs = el('div', { className: 'symbol-tabs' });

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const list = q
      ? Object.values(SYMBOLS).flat().filter(([cmd, , name]) => cmd.toLowerCase().includes(q) || name.includes(q))
      : SYMBOLS[active];
    grid.replaceChildren(...list.map(([cmd, glyph, name]) => el('button', {
      className: 'symbol-btn',
      title: `${cmd} — ${name}`,
      onmousedown: e => e.preventDefault(),
      onclick: () => insertSnippet(cmd.replace('{}', '{$0}')),
    }, glyph)));
    if (!list.length) grid.append(el('p', { className: 'symbol-empty' }, 'Nenhum símbolo encontrado.'));
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', !q && b.dataset.cat === active));
  };

  tabs.append(...categories.map(cat => el('button', {
    'data-cat': cat,
    onclick: () => { active = cat; search.value = ''; render(); },
  }, cat)));
  search.addEventListener('input', render);
  render();
  setTimeout(() => search.focus());
  return el('div', { className: 'symbol-palette' }, search, tabs, grid);
}

// ════════════════════════════════════
//  TABLE PICKER (choose size on a grid, like Overleaf)
// ════════════════════════════════════
function tablePicker() {
  const MAX = 10;
  const label = el('div', { className: 'table-picker-label' }, 'Escolha o tamanho');
  const grid = el('div', { className: 'table-picker-grid' });
  const cells = [];
  for (let r = 1; r <= MAX; r++) {
    for (let c = 1; c <= MAX; c++) {
      const cell = el('button', {
        className: 'table-picker-cell',
        onmouseenter: () => {
          label.textContent = `${r} × ${c}`;
          cells.forEach(x => x.el.classList.toggle('on', x.r <= r && x.c <= c));
        },
        onclick: () => { closePopover(); insertTable(r, c); },
      });
      cells.push({ el: cell, r, c });
      grid.append(cell);
    }
  }
  return el('div', { className: 'table-picker' }, label, grid);
}

export function insertTable(rows, cols) {
  const row = Array.from({ length: cols }, () => '${}').join(' & ') + ' \\\\';
  const body = Array.from({ length: rows }, () => `\t\t${row}\n\t\t\\hline`).join('\n');
  insertSnippet([
    '\\begin{table}[htbp]',
    '\t\\centering',
    `\t\\begin{tabular}{|${'c|'.repeat(cols)}}`,
    '\t\t\\hline',
    body,
    '\t\\end{tabular}',
    '\t\\caption{${Legenda}}',
    '\t\\label{tab:${rotulo}}',
    '\\end{table}${}',
  ].join('\n'));
}

// ════════════════════════════════════
//  FIGURE DIALOG
// ════════════════════════════════════
function imageFiles(entries = S.files, out = []) {
  for (const f of entries) {
    if (f.type === 'folder') imageFiles(f.children || [], out);
    else if (f.type === 'image' || f.type === 'pdf' || /\.eps$/i.test(f.name)) out.push(f.path);
  }
  return out;
}

const slug = s => s.replace(/\.[^.]+$/, '').split('/').pop().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function openFigureDialog() {
  if (!isTextOpen()) return;
  const imageSelect = el('select');
  const fill = selected => {
    const images = imageFiles();
    imageSelect.replaceChildren(...(images.length
      ? images.map(p => el('option', { value: p }, p))
      : [el('option', { value: '' }, 'Nenhuma imagem no projeto')]));
    if (selected) imageSelect.value = selected;
  };
  fill();

  const fileInput = el('input', { type: 'file', accept: 'image/*,.pdf,.eps', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (file && await uploadFiles([file])) fill(file.name);
  });

  const caption = el('input', { type: 'text', placeholder: 'Legenda da figura' });
  const label = el('input', { type: 'text', placeholder: 'rotulo' });
  const width = el('select', {}, ...[['0.25', '25%'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%']]
    .map(([v, t]) => el('option', { value: v }, `${t} da largura da linha`)));
  width.value = '0.75';
  imageSelect.addEventListener('change', () => { if (!label.value) label.placeholder = slug(imageSelect.value); });
  label.placeholder = slug(imageSelect.value) || 'rotulo';

  const row = (text, control) => el('div', { className: 'form-row' }, el('label', {}, text), control);

  const insert = () => {
    const path = imageSelect.value;
    if (!path) return toast('Escolha ou envie uma imagem', 'err');
    const e = escapeSnippet;
    const lbl = label.value.trim() || slug(path) || 'figura';
    closeModal();
    insertSnippet([
      '\\begin{figure}[htbp]',
      '\t\\centering',
      `\t\\includegraphics[width=${width.value}\\linewidth]{${e(path)}}`,
      `\t\\caption{${caption.value.trim() ? e(caption.value.trim()) : '${Legenda}'}}`,
      `\t\\label{fig:${e(lbl)}}`,
      '\\end{figure}${}',
    ].join('\n'));
  };

  openModal({
    title: 'Inserir figura',
    body: [
      row('Imagem', el('div', { className: 'inline-field' }, imageSelect,
        el('button', { className: 'btn btn-ghost', onclick: () => fileInput.click(), title: 'Enviar do computador' }, icon('upload')),
        fileInput)),
      row('Largura', width),
      row('Legenda', caption),
      row('Rótulo (fig:…)', label),
    ],
    footer: [
      el('button', { className: 'btn btn-ghost', onclick: closeModal }, 'Cancelar'),
      el('button', { className: 'btn btn-primary', onclick: insert }, 'Inserir'),
    ],
  });
}

// ════════════════════════════════════
//  TOOLBAR
// ════════════════════════════════════
// Buttons are described once so they can also appear in the overflow menu
const buttonActions = new Map();

function button(iconName, title, action) {
  const node = el('button', {
    className: 'tb-btn',
    title,
    onmousedown: e => e.preventDefault(), // keep the editor's selection
    onclick: e => action(e.currentTarget),
  }, icon(iconName));
  buttonActions.set(node, { iconName, title, action });
  return node;
}

const sep = () => el('span', { className: 'tb-sep' });

// Hides buttons that don't fit (from the end) and lists them under "⋯"
function fitToolbar(toolbar, overflowBtn) {
  const items = [...toolbar.children].filter(n => n !== overflowBtn && !n.classList.contains('tb-spacer') && !n.classList.contains('tb-pinned'));
  items.forEach(n => n.classList.remove('tb-hidden'));
  overflowBtn.classList.add('tb-hidden');
  if (toolbar.scrollWidth <= toolbar.clientWidth) return;

  overflowBtn.classList.remove('tb-hidden');
  for (let i = items.length - 1; i >= 0 && toolbar.scrollWidth > toolbar.clientWidth; i--) {
    items[i].classList.add('tb-hidden');
  }
  // Don't leave a dangling separator at the end
  const visible = items.filter(n => !n.classList.contains('tb-hidden'));
  const last = visible[visible.length - 1];
  if (last?.classList.contains('tb-sep')) last.classList.add('tb-hidden');
}

export function initToolbar() {
  const toolbar = $('editor-toolbar');
  const headingLabel = el('span', {}, 'Texto normal');
  const headingBtn = el('button', {
    className: 'tb-btn tb-dropdown',
    title: 'Estilo do título',
    onmousedown: e => {
      e.preventDefault();
      if (!isTextOpen()) return;
      const current = currentHeading();
      openMenu(headingBtn, HEADINGS.map(([cmd, label]) => ({
        label, checked: current === cmd, action: () => setHeading(cmd),
      })));
    },
  }, headingLabel, icon('expand_more'));

  const overflowBtn = el('button', {
    className: 'tb-btn tb-pinned',
    title: 'Mais opções',
    onmousedown: e => {
      e.preventDefault();
      const hidden = [...toolbar.querySelectorAll('.tb-btn.tb-hidden')].filter(n => buttonActions.has(n));
      openMenu(overflowBtn, hidden.map(n => {
        const { iconName, title, action } = buttonActions.get(n);
        return { label: title, icon: iconName, action: () => action(overflowBtn) };
      }), { align: 'right' });
    },
  }, icon('more_horiz'));

  const searchBtn = button('search', 'Localizar e substituir (Ctrl+F)', openFind);
  searchBtn.classList.add('tb-pinned');

  toolbar.replaceChildren(
    button('undo', 'Desfazer (Ctrl+Z)', editorUndo),
    button('redo', 'Refazer (Ctrl+Shift+Z)', editorRedo),
    sep(),
    headingBtn,
    sep(),
    button('format_bold', 'Negrito (Ctrl+B)', () => wrapSelection('\\textbf{', '}')),
    button('format_italic', 'Itálico (Ctrl+I)', () => wrapSelection('\\textit{', '}')),
    sep(),
    button('function', 'Fórmula no texto', () => wrapSelection('$', '$')),
    button('special_character', 'Paleta de símbolos', anchor => openPopover(anchor, symbolPalette())),
    sep(),
    button('link', 'Link (\\href)', () => insertSnippet('\\href{${url}}{$SEL${}}')),
    button('tag', 'Referência cruzada (\\ref)', () => { insertSnippet('\\ref{$0}'); triggerCompletion(); }),
    button('format_quote', 'Citação (\\cite)', () => { insertSnippet('\\cite{$0}'); triggerCompletion(); }),
    sep(),
    button('add_photo_alternate', 'Inserir figura', openFigureDialog),
    button('table', 'Inserir tabela', anchor => openPopover(anchor, tablePicker())),
    sep(),
    button('format_list_bulleted', 'Lista com marcadores', () => insertSnippet('\\begin{itemize}\n\t\\item $SEL$0\n\\end{itemize}')),
    button('format_list_numbered', 'Lista numerada', () => insertSnippet('\\begin{enumerate}\n\t\\item $SEL$0\n\\end{enumerate}')),
    button('format_indent_decrease', 'Diminuir recuo', editorIndentLess),
    button('format_indent_increase', 'Aumentar recuo', editorIndentMore),
    sep(),
    button('comment', 'Comentar/descomentar (Ctrl+/)', toggleComment),
    el('span', { className: 'tb-spacer' }),
    overflowBtn,
    searchBtn,
  );

  new ResizeObserver(() => fitToolbar(toolbar, overflowBtn)).observe(toolbar);

  // Keep the heading dropdown in sync with the line under the cursor
  onEditorUpdate(() => {
    const cmd = currentHeading();
    headingLabel.textContent = (HEADINGS.find(([c]) => c === cmd) || HEADINGS[0])[1];
  });
}
