import { linter } from '@codemirror/lint';
import { StateEffect } from '@codemirror/state';
import { S } from '../state.js';

// Environments whose content is not LaTeX
const VERBATIM = new Set(['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment', 'filecontents', 'filecontents*']);

// Checks that every \begin{x} has a matching \end{x}
export function checkEnvironments(doc) {
  const diagnostics = [];
  const stack = [];
  let verbatim = null;

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    // Drop comments (keeping escaped \%) unless inside a verbatim block
    const text = verbatim ? line.text : line.text.replace(/(^|[^\\])%.*$/, '$1');

    for (const m of text.matchAll(/\\(begin|end)\s*\{([^}]*)\}/g)) {
      const from = line.from + m.index;
      const to = from + m[0].length;
      const [, kind, name] = m;

      if (verbatim) {
        if (kind === 'end' && name === verbatim.name) {
          stack.pop();
          verbatim = null;
        }
        continue;
      }

      if (kind === 'begin') {
        const entry = { name, from, to };
        stack.push(entry);
        if (VERBATIM.has(name)) verbatim = entry;
        continue;
      }

      const idx = stack.map(e => e.name).lastIndexOf(name);
      if (idx === -1) {
        diagnostics.push({ from, to, severity: 'error', message: `\\end{${name}} sem \\begin{${name}} correspondente` });
        continue;
      }
      // Anything opened after the matching \begin was left unclosed
      for (const open of stack.splice(idx).slice(1)) {
        diagnostics.push({ from: open.from, to: open.to, severity: 'error', message: `O ambiente "${open.name}" não foi fechado antes de \\end{${name}}` });
      }
    }
  }

  for (const open of stack) {
    diagnostics.push({ from: open.from, to: open.to, severity: 'error', message: `Falta \\end{${open.name}}` });
  }
  return diagnostics;
}

// Errors and warnings from the last compile, shown on the lines they point to
let compileDiagnostics = [];

// Dispatched after a compile so the linter runs again without an edit
export const compileDiagnosticsChanged = StateEffect.define();

export function setCompileDiagnostics(entries) {
  compileDiagnostics = entries.filter(e => e.path && e.line);
}

const SEVERITY = { error: 'error', warning: 'warning', typesetting: 'info' };

function compileDiagnosticsFor(doc) {
  const path = S.openFile?.path;
  return compileDiagnostics
    .filter(e => e.path === path && e.line <= doc.lines)
    .map(e => {
      const line = doc.line(e.line);
      return { from: line.from, to: line.to, severity: SEVERITY[e.level], source: 'Compilação', message: e.message };
    });
}

export const latexLinter = linter(view => [
  ...checkEnvironments(view.state.doc),
  ...compileDiagnosticsFor(view.state.doc),
], {
  delay: 600,
  needsRefresh: u => u.transactions.some(tr => tr.effects.some(e => e.is(compileDiagnosticsChanged))),
});
