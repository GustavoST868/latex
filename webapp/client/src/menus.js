import { $, el, openModal } from './util.js';
import { S } from './state.js';
import { buildMenubar, bindDropdown } from './menu.js';
import {
  insertSnippet, wrapSelection, toggleComment, editorUndo, editorRedo, editorSelectAll, isTextOpen, openFind, openGotoLine,
} from './editor.js';
import { openFigureDialog, insertTable } from './toolbar.js';
import { toggleLog } from './compile.js';
import { zoomIn, zoomOut, downloadPDF } from './pdf.js';
import { LAYOUTS, getLayout, setLayout, setRailPanel, isRailVisible } from './layout.js';
import { getTheme, setTheme } from './prefs.js';
import {
  createNewFile, triggerUpload, renameProject, copyProject, downloadSource, showWordCount,
} from './project.js';
import { openSettings } from './settings.js';

const isMac = navigator.platform.toUpperCase().includes('MAC');
const MOD = isMac ? '⌘' : 'Ctrl';

export function openProjectSearch() {
  setRailPanel('search');
}

export function showShortcuts() {
  const shortcuts = [
    [`${MOD}+S`, 'Salvar e recompilar'],
    [`${MOD}+Enter`, 'Recompilar'],
    [`${MOD}+B`, 'Negrito'],
    [`${MOD}+I`, 'Itálico'],
    [`${MOD}+/`, 'Comentar/descomentar linhas'],
    [`${MOD}+Z`, 'Desfazer'],
    [`${MOD}+Shift+Z`, 'Refazer'],
    [`${MOD}+F`, 'Localizar e substituir no arquivo'],
    [`${MOD}+Shift+F`, 'Buscar no projeto'],
    [`${MOD}+Shift+L`, 'Ir para a linha'],
    [`${MOD}+D`, 'Selecionar a próxima ocorrência (vários cursores)'],
    [`${MOD}+Espaço`, 'Abrir sugestões'],
    [`${MOD}+Shift+[ / ]`, 'Recolher / expandir bloco'],
    ['Alt+clique', 'Adicionar cursor'],
    ['Tab', 'Aceitar sugestão / próximo campo / indentar'],
    ['Esc', 'Fechar sugestões, menus e janelas'],
  ];
  openModal({
    title: 'Atalhos de teclado',
    body: el('table', { className: 'kv-table' }, el('tbody', {},
      shortcuts.map(([k, d]) => el('tr', {}, el('td', {}, d), el('td', {}, el('span', { className: 'kbd' }, k)))))),
  });
}

const needsText = () => !isTextOpen();

// Shared by the "File" menu and the project title dropdown
const projectItems = () => [
  { label: 'Baixar código-fonte (.zip)', icon: 'folder_zip', action: downloadSource },
  { label: 'Baixar PDF', icon: 'download', action: downloadPDF, disabled: !S.pdfUrl },
  '-',
  { label: 'Fazer uma cópia', icon: 'content_copy', action: copyProject },
  { label: 'Renomear projeto', icon: 'edit', action: renameProject },
  '-',
  { label: 'Contagem de palavras', icon: 'match_case', action: showWordCount },
  { label: 'Configurações', icon: 'settings', action: openSettings },
];

const MENUS = [
  {
    label: 'Arquivo',
    items: () => [
      { label: 'Novo arquivo', icon: 'note_add', action: createNewFile },
      { label: 'Enviar arquivos', icon: 'upload', action: triggerUpload },
      '-',
      ...projectItems(),
      '-',
      { label: 'Voltar para projetos', icon: 'home', action: () => $('btn-back-home').click() },
    ],
  },
  {
    label: 'Editar',
    items: () => [
      { label: 'Desfazer', icon: 'undo', shortcut: `${MOD}+Z`, action: editorUndo, disabled: needsText() },
      { label: 'Refazer', icon: 'redo', shortcut: `${MOD}+Shift+Z`, action: editorRedo, disabled: needsText() },
      '-',
      { label: 'Selecionar tudo', icon: 'select_all', shortcut: `${MOD}+A`, action: editorSelectAll, disabled: needsText() },
      '-',
      { label: 'Localizar e substituir', icon: 'find_replace', shortcut: `${MOD}+F`, action: openFind, disabled: needsText() },
      { label: 'Ir para a linha', icon: 'format_list_numbered_rtl', shortcut: `${MOD}+Shift+L`, action: openGotoLine, disabled: needsText() },
      { label: 'Buscar no projeto', icon: 'search', shortcut: `${MOD}+Shift+F`, action: openProjectSearch },
    ],
  },
  {
    label: 'Inserir',
    items: () => [
      { label: 'Seção', icon: 'title', action: () => insertSnippet('\\section{$SEL$0}'), disabled: needsText() },
      { label: 'Subseção', icon: 'title', action: () => insertSnippet('\\subsection{$SEL$0}'), disabled: needsText() },
      { label: 'Subsubseção', icon: 'title', action: () => insertSnippet('\\subsubsection{$SEL$0}'), disabled: needsText() },
      '-',
      { label: 'Figura…', icon: 'image', disabled: needsText(), action: openFigureDialog },
      { label: 'Tabela (3 × 3)', icon: 'table', disabled: needsText(), action: () => insertTable(3, 3) },
      '-',
      { label: 'Lista com marcadores', icon: 'format_list_bulleted', disabled: needsText(), action: () => insertSnippet('\\begin{itemize}\n\t\\item $SEL$0\n\\end{itemize}') },
      { label: 'Lista numerada', icon: 'format_list_numbered', disabled: needsText(), action: () => insertSnippet('\\begin{enumerate}\n\t\\item $SEL$0\n\\end{enumerate}') },
      '-',
      { label: 'Fórmula no texto', icon: 'function', disabled: needsText(), action: () => wrapSelection('$', '$') },
      { label: 'Equação numerada', icon: 'functions', disabled: needsText(), action: () => insertSnippet('\\begin{equation}\n\t$SEL$0\n\\end{equation}') },
      '-',
      { label: 'Citação', icon: 'format_quote', disabled: needsText(), action: () => insertSnippet('\\cite{$SEL$0}') },
      { label: 'Referência cruzada', icon: 'link', disabled: needsText(), action: () => insertSnippet('\\ref{$SEL$0}') },
      { label: 'Rótulo', icon: 'label', disabled: needsText(), action: () => insertSnippet('\\label{$SEL$0}') },
      { label: 'Nota de rodapé', icon: 'notes', disabled: needsText(), action: () => insertSnippet('\\footnote{$SEL$0}') },
    ],
  },
  {
    label: 'Exibir',
    items: () => [
      { heading: 'Layout' },
      ...LAYOUTS.map(l => ({ label: l.label, checked: getLayout() === l.id, action: () => setLayout(l.id) })),
      '-',
      { label: 'Painel lateral', checked: isRailVisible(), action: () => setRailPanel(isRailVisible() ? null : 'files') },
      { label: 'Log de compilação', checked: $('log-panel').classList.contains('open'), action: toggleLog },
      '-',
      { label: 'Aumentar zoom do PDF', action: zoomIn },
      { label: 'Diminuir zoom do PDF', action: zoomOut },
      '-',
      { heading: 'Tema' },
      ...[['system', 'Igual ao sistema'], ['light', 'Claro'], ['dark', 'Escuro']].map(([id, label]) => ({
        label, checked: getTheme() === id, action: () => setTheme(id),
      })),
    ],
  },
  {
    label: 'Formatar',
    items: () => [
      { label: 'Negrito', icon: 'format_bold', shortcut: `${MOD}+B`, disabled: needsText(), action: () => wrapSelection('\\textbf{', '}') },
      { label: 'Itálico', icon: 'format_italic', shortcut: `${MOD}+I`, disabled: needsText(), action: () => wrapSelection('\\textit{', '}') },
      { label: 'Sublinhado', icon: 'format_underlined', disabled: needsText(), action: () => wrapSelection('\\underline{', '}') },
      { label: 'Ênfase', icon: 'format_italic', disabled: needsText(), action: () => wrapSelection('\\emph{', '}') },
      { label: 'Monoespaçado', icon: 'code', disabled: needsText(), action: () => wrapSelection('\\texttt{', '}') },
      '-',
      { label: 'Comentar/descomentar linhas', icon: 'tag', shortcut: `${MOD}+/`, disabled: needsText(), action: toggleComment },
    ],
  },
  {
    label: 'Ajuda',
    items: () => [
      { label: 'Atalhos de teclado', icon: 'keyboard', action: showShortcuts },
      { label: 'Guia de LaTeX (Wikibooks)', icon: 'menu_book', action: () => window.open('https://en.wikibooks.org/wiki/LaTeX', '_blank', 'noopener') },
    ],
  },
];

export function initMenus() {
  buildMenubar($('menubar'), MENUS);
  bindDropdown($('btn-project-menu'), projectItems);
  bindDropdown($('btn-layout'), () =>
    LAYOUTS.map(l => ({ label: l.label, checked: getLayout() === l.id, action: () => setLayout(l.id) })), { align: 'right' });

  $('btn-settings').onclick = openSettings;
  bindDropdown($('btn-help'), () => MENUS.find(m => m.label === 'Ajuda').items(), { placement: 'right' });

  document.addEventListener('keydown', e => {
    if (!S.project) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openProjectSearch();
    }
  });
}
