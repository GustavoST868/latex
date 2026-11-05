import { StreamLanguage, LanguageSupport, foldService, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { tags as t } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';

const latexLanguage = StreamLanguage.define({
  ...stex,
  languageData: {
    ...stex.languageData,
    commentTokens: { line: '%' },
    closeBrackets: { brackets: ['(', '[', '{', '$'] },
  },
});

// ════════════════════════════════════
//  FOLDING
// ════════════════════════════════════
const SECTION_LEVELS = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };
const SECTION_RE = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/;
const BEGIN_RE = /\\begin\s*\{([^}]+)\}/;

// Strips a trailing comment (ignoring escaped \%)
const code = text => text.replace(/(^|[^\\])%.*$/, '$1');

// \begin{x} … \end{x} and sections (up to the next heading of the same or higher level)
const latexFolding = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.lineAt(lineStart);
  const text = code(line.text);

  const begin = text.match(BEGIN_RE);
  if (begin && begin[1] !== 'document') {
    const name = begin[1];
    let depth = 0;
    for (let n = line.number; n <= state.doc.lines; n++) {
      const l = state.doc.line(n);
      const s = code(l.text);
      const from = n === line.number ? s.indexOf(begin[0]) : 0;
      for (const m of s.slice(from).matchAll(/\\(begin|end)\s*\{([^}]+)\}/g)) {
        if (m[2] !== name) continue;
        depth += m[1] === 'begin' ? 1 : -1;
        if (depth === 0) {
          if (n === line.number) return null;
          return { from: lineEnd, to: state.doc.line(n - 1).to };
        }
      }
    }
    return null;
  }

  const section = text.match(SECTION_RE);
  if (section) {
    const level = SECTION_LEVELS[section[1]];
    let last = line.number;
    for (let n = line.number + 1; n <= state.doc.lines; n++) {
      const s = code(state.doc.line(n).text);
      const m = s.match(SECTION_RE);
      if ((m && SECTION_LEVELS[m[1]] <= level) || /\\end\s*\{document\}/.test(s)) break;
      last = n;
    }
    // Don't swallow trailing blank lines
    while (last > line.number && !state.doc.line(last).text.trim()) last--;
    if (last > line.number) return { from: lineEnd, to: state.doc.line(last).to };
  }
  return null;
});

// ════════════════════════════════════
//  THEME (colors come from CSS variables, so light/dark just work)
// ════════════════════════════════════
export const latexHighlight = HighlightStyle.define([
  { tag: t.tagName, color: 'var(--syn-command)' },
  { tag: t.atom, color: 'var(--syn-argument)' },
  { tag: t.keyword, color: 'var(--syn-math-delim)', fontWeight: '600' },
  { tag: t.special(t.variableName), color: 'var(--syn-math)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.bracket, color: 'var(--syn-bracket)' },
]);

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--editor-font-size)',
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--text)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--editor-font, var(--font-code))', lineHeight: 'var(--editor-line-height, 1.6)' },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--text)' },
  '.cm-line': { padding: '0 12px 0 6px' },
  '.cm-gutters': {
    backgroundColor: 'var(--gutter-bg)',
    color: 'var(--text-subtle)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-active)', color: 'var(--text)' },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--editor-selection) !important' },
  '.cm-selectionMatch': { backgroundColor: 'var(--editor-match)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--editor-match)', outline: '1px solid var(--border-strong)' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--danger-subtle)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--bg-muted)', border: 'none', color: 'var(--text-muted)', padding: '0 6px', borderRadius: '4px',
  },
  '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer', color: 'var(--text-subtle)' },
  '.cm-searchMatch': { backgroundColor: 'var(--warn-subtle)', outline: '1px solid var(--warn)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--editor-match)' },

  // Panels (search & replace)
  '.cm-panels': { backgroundColor: 'var(--bg-subtle)', color: 'var(--text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel.cm-search': { padding: '8px 10px', fontFamily: 'var(--font-ui)', fontSize: '13px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': { fontSize: '13px', margin: '2px 4px 2px 0' },
  '.cm-textfield': {
    border: '1px solid var(--border-strong)', borderRadius: '6px', background: 'var(--bg)', color: 'var(--text)', padding: '4px 8px',
  },
  '.cm-textfield:focus': { borderColor: 'var(--accent)', outline: 'none' },
  '.cm-button': {
    backgroundImage: 'none', background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: '6px',
    color: 'var(--text)', padding: '3px 10px',
  },
  '.cm-button:hover': { background: 'var(--bg-hover)' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--text-muted)', fontSize: '18px', right: '8px', top: '6px' },

  // Autocomplete & tooltips
  '.cm-tooltip': {
    backgroundColor: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)',
    borderRadius: '6px', boxShadow: 'var(--shadow-md)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-code)', maxHeight: '16em' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px', lineHeight: '1.5' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-subtle)', color: 'var(--text)' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700', color: 'var(--accent)' },
  '.cm-completionDetail': { fontFamily: 'var(--font-ui)', fontStyle: 'normal', color: 'var(--text-subtle)', marginLeft: '12px', fontSize: '12px' },
  '.cm-completionInfo': { fontFamily: 'var(--font-ui)', fontSize: '12px', maxWidth: '320px', padding: '6px 10px' },
  '.cm-tooltip-lint': { fontFamily: 'var(--font-ui)', fontSize: '13px' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--warn)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn)', textUnderlineOffset: '3px' },
  '.cm-gutter-lint': { width: '14px' },
});

export function latex() {
  return [new LanguageSupport(latexLanguage, [latexFolding]), syntaxHighlighting(latexHighlight)];
}

// Portuguese labels for CodeMirror's built-in UI
export const ptBRPhrases = {
  'Find': 'Localizar',
  'Replace': 'Substituir',
  'next': 'próximo',
  'previous': 'anterior',
  'all': 'todos',
  'match case': 'diferenciar maiúsc./minúsc.',
  'by word': 'palavra inteira',
  'regexp': 'expressão regular',
  'replace': 'substituir',
  'replace all': 'substituir todos',
  'close': 'fechar',
  'current match': 'ocorrência atual',
  'replaced $ matches': '$ ocorrências substituídas',
  'replaced match on line $': 'ocorrência substituída na linha $',
  'on line': 'na linha',
  'Go to line': 'Ir para a linha',
  'go': 'ir',
  'Folded lines': 'Linhas recolhidas',
  'Unfolded lines': 'Linhas expandidas',
  'to': 'até',
  'folded code': 'código recolhido',
  'unfold': 'expandir',
  'Fold line': 'Recolher',
  'Unfold line': 'Expandir',
  'Diagnostics': 'Diagnósticos',
  'No diagnostics': 'Nenhum problema',
};
