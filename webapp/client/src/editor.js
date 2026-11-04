import { EditorState, Compartment, Prec } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection,
  dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine,
} from '@codemirror/view';
import {
  defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, selectAll, toggleComment as cmToggleComment,
  indentMore, indentLess,
} from '@codemirror/commands';
import { foldGutter, foldKeymap, indentOnInput, bracketMatching, indentUnit } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches, openSearchPanel, gotoLine, search } from '@codemirror/search';
import {
  autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, acceptCompletion, snippet, startCompletion,
} from '@codemirror/autocomplete';
import { lintGutter, lintKeymap, forceLinting } from '@codemirror/lint';
import { $, toast } from './util.js';
import { S } from './state.js';
import { api, json, fileUrl } from './api.js';
import { getPref } from './prefs.js';
import { scheduleMetaRefresh } from './meta.js';
import { latex, editorTheme, ptBRPhrases } from './cm/latex.js';
import { latexCompletions } from './cm/completion.js';
import { latexLinter, checkEnvironments, compileDiagnosticsChanged } from './cm/lint.js';
import { mathPreview } from './cm/math-preview.js';
import { spellcheck } from './cm/spell.js';

const saveStatus = $('save-status');
const AUTOSAVE_DELAY_MS = 1500;
let autosaveTimer = null;

let view = null;
const updateListeners = [];
// Called with the editor state after edits and cursor moves (toolbar state)
export const onEditorUpdate = fn => updateListeners.push(fn);
const savedListeners = [];
// Called after an edit is saved (used for auto-compile)
export const onSaved = fn => savedListeners.push(fn);
// Editor states per file, so undo history survives switching files
const states = new Map();

// ════════════════════════════════════
//  PREFERENCES (reconfigurable at runtime)
// ════════════════════════════════════
export const EDITOR_DEFAULTS = {
  autocomplete: true,
  closeBrackets: true,
  lint: true,
  lineWrapping: true,
  mathPreview: true,
  spellcheck: 'pt-BR',
};

export const editorPref = key => getPref(`editor.${key}`, EDITOR_DEFAULTS[key]);

const compartments = {
  autocomplete: new Compartment(),
  closeBrackets: new Compartment(),
  lint: new Compartment(),
  lineWrapping: new Compartment(),
  mathPreview: new Compartment(),
  spellcheck: new Compartment(),
};

const prefExtensions = {
  autocomplete: on => autocompletion({ override: [latexCompletions], activateOnTyping: on, icons: false, closeOnBlur: true }),
  closeBrackets: on => (on ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : []),
  lint: on => (on ? [latexLinter, lintGutter()] : []),
  lineWrapping: on => (on ? EditorView.lineWrapping : []),
  mathPreview: on => (on ? mathPreview : []),
  spellcheck: lang => spellcheck(lang === 'off' ? null : lang),
};

function prefExtension(key) {
  return compartments[key].of(prefExtensions[key](editorPref(key)));
}

// Applies changed preferences to the open editor
export function applyEditorPrefs() {
  if (!view) return;
  view.dispatch({
    effects: Object.keys(compartments).map(key => compartments[key].reconfigure(prefExtensions[key](editorPref(key)))),
  });
  // Cached states keep their old config; rebuild them lazily
  states.clear();
}

// ════════════════════════════════════
//  EDITOR SETUP
// ════════════════════════════════════
const wrap = (before, after) => v => {
  wrapSelection(before, after, v);
  return true;
};

const customKeymap = [
  { key: 'Mod-b', run: wrap('\\textbf{', '}') },
  { key: 'Mod-i', run: wrap('\\textit{', '}') },
  { key: 'Mod-Shift-l', run: gotoLine },
  { key: 'Mod-h', run: openSearchPanel },
  // Handled globally (save & compile); keep CodeMirror from inserting a line
  { key: 'Mod-Enter', run: () => true },
  { key: 'Mod-s', run: () => true },
];

function extensions() {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter({ openText: '▾', closedText: '▸' }),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    indentUnit.of('    '),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    latex(),
    editorTheme,
    EditorState.phrases.of(ptBRPhrases),
    prefExtension('autocomplete'),
    prefExtension('closeBrackets'),
    prefExtension('lint'),
    prefExtension('lineWrapping'),
    prefExtension('mathPreview'),
    prefExtension('spellcheck'),
    Prec.high(keymap.of(customKeymap)),
    keymap.of([
      { key: 'Tab', run: acceptCompletion },
      ...completionKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of(u => {
      if (u.docChanged) markDirty(u.state);
      if (u.docChanged || u.selectionSet) updateListeners.forEach(fn => fn(u.state));
    }),
  ];
}

export function initEditor() {
  view = new EditorView({
    state: EditorState.create({ doc: '', extensions: extensions() }),
    parent: $('editor'),
  });
}

export const getView = () => view;
export const isTextOpen = () => S.openFile?.type === 'text';

// ════════════════════════════════════
//  CONTENT
// ════════════════════════════════════

/** Shows a file in the editor, reusing its previous state (undo history) when unchanged. */
export function setEditorContent(text, path = null) {
  clearTimeout(autosaveTimer);
  const cached = path && states.get(path);
  const state = cached && cached.doc.toString() === text
    ? cached
    : EditorState.create({ doc: text, extensions: extensions() });
  view.setState(state);
  S.content = text;
  S.dirty = false;
  updateSaveStatus(path ? 'saved' : '');
}

// Remembers the open file's state before switching to another file
export function stashEditorState() {
  if (view && isTextOpen()) states.set(S.openFile.path, view.state);
}

// Forget cached states (e.g. when leaving the project)
export function clearEditorStates() {
  states.clear();
}

function markDirty(state) {
  S.content = state.doc.toString();
  if (!S.dirty) {
    S.dirty = true;
    updateSaveStatus('dirty');
  }
  // Save automatically shortly after typing stops, like Overleaf
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveFile().catch(() => {}), AUTOSAVE_DELAY_MS);
}

export function focusEditor() {
  view?.focus();
}

// ════════════════════════════════════
//  SAVE
// ════════════════════════════════════
// `silent` skips the saved listeners (the compile button saves before compiling)
export async function saveFile({ silent = false } = {}) {
  clearTimeout(autosaveTimer);
  if (!S.project || !isTextOpen() || !S.dirty) return;
  const { path } = S.openFile;
  const content = S.content;
  try {
    updateSaveStatus('saving');
    await api(fileUrl(path), json('PUT', { content }));
    // Typing may have continued while the request was in flight
    if (S.openFile?.path === path && S.content === content) {
      S.dirty = false;
      updateSaveStatus('saved');
    } else {
      updateSaveStatus('dirty');
    }
    scheduleMetaRefresh();
    if (!silent) savedListeners.forEach(fn => fn());
  } catch (err) {
    toast('Erro ao salvar: ' + err.message, 'err');
    updateSaveStatus('error');
    throw err;
  }
}

export function updateSaveStatus(state) {
  const labels = { saved: 'Todas as alterações salvas', dirty: 'Alterações pendentes…', saving: 'Salvando…', error: 'Erro ao salvar' };
  saveStatus.textContent = labels[state] || '';
  saveStatus.className = 'save-status ' + (state || '');
}

// ════════════════════════════════════
//  EDITING COMMANDS (menus, toolbar & shortcuts)
// ════════════════════════════════════

// Makes plain text safe inside a CodeMirror snippet template
export const escapeSnippet = text => text.replace(/\\(?=[{}])/g, '\\\\').replace(/([#$])\{/g, '$1\\{');

/**
 * Inserts a template at the cursor. `$SEL` becomes the selected text, `$0` a tab stop
 * (put it last for the final cursor), and CodeMirror fields (`${name}`) become tab stops.
 */
export function insertSnippet(template, v = view) {
  if (!isTextOpen() || !v) return;
  const { from, to } = v.state.selection.main;
  const selection = escapeSnippet(v.state.sliceDoc(from, to));
  // Unnamed fields are visited in order, so the final cursor is the last `${}`
  const text = template.replace('$SEL', () => selection).replace(/\$0(?!\{)/, '${}');
  snippet(text)(v, null, from, to);
  v.focus();
}

export function wrapSelection(before, after, v = view) {
  if (!isTextOpen() || !v) return;
  // Wrap every selection range (multiple cursors included)
  v.dispatch(v.state.changeByRange(range => ({
    changes: [{ from: range.from, insert: before }, { from: range.to, insert: after }],
    range: range.empty
      ? { anchor: range.from + before.length, head: range.from + before.length }
      : { anchor: range.from + before.length, head: range.to + before.length },
  })), { scrollIntoView: true, userEvent: 'input' });
  v.focus();
}

// Replaces the heading command of the current line (or turns it back into text)
export function setHeading(command) {
  if (!isTextOpen()) return;
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const m = line.text.match(/^(\s*)\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{(.*)\}\s*$/);
  const indent = m ? m[1] : line.text.match(/^\s*/)[0];
  const content = m ? m[2] : line.text.trim();
  const insert = command ? `${indent}\\${command}{${content}}` : indent + content;
  const cursor = line.from + insert.length - (command ? 1 : 0);
  view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: { anchor: cursor }, userEvent: 'input' });
  view.focus();
}

// Heading command of the line under the cursor (for the toolbar dropdown)
export function currentHeading() {
  if (!view || !isTextOpen()) return null;
  const text = view.state.doc.lineAt(view.state.selection.main.head).text;
  return (text.match(/^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{/) || [])[1] || null;
}

const run = cmd => () => { if (view && isTextOpen()) { cmd(view); view.focus(); } };
export const toggleComment = run(cmToggleComment);
export const editorUndo = run(undo);
export const editorRedo = run(redo);
export const editorSelectAll = run(selectAll);
export const openFind = run(openSearchPanel);
export const triggerCompletion = run(startCompletion);
export const openGotoLine = run(gotoLine);
export const editorIndentMore = run(indentMore);
export const editorIndentLess = run(indentLess);

// Re-runs the linter now (after a compile brought new diagnostics)
export function refreshDiagnostics() {
  if (!view || !editorPref('lint')) return;
  view.dispatch({ effects: compileDiagnosticsChanged.of(null) });
  forceLinting(view);
}

// True when the open document has \begin/\end problems
export function hasCodeCheckErrors() {
  return !!view && isTextOpen() && checkEnvironments(view.state.doc).length > 0;
}

// Cursor position for SyncTeX (1-based line, 0-based column)
export function getCursorPosition() {
  if (!view || !isTextOpen()) return null;
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return { line: line.number, column: head - line.from };
}

// Moves the cursor to a 1-based line and scrolls it into view
export function goToLine(line) {
  if (!view) return;
  const doc = view.state.doc;
  const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
  view.dispatch({
    selection: { anchor: l.from, head: l.to },
    effects: EditorView.scrollIntoView(l.from, { y: 'center' }),
  });
  view.focus();
}
