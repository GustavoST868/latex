import { snippet, snippetCompletion } from '@codemirror/autocomplete';
import { COMMANDS, ENVIRONMENTS, PACKAGES, CLASSES } from '../latex-commands.js';
import { META } from '../meta.js';
import { S } from '../state.js';

// ════════════════════════════════════
//  STATIC OPTIONS
// ════════════════════════════════════
// A last empty field after the arguments lets Tab jump out of the braces.
// (CodeMirror orders ${0} before unnamed fields, so a plain ${} is used instead.)
const withExit = template => template + '${}';

const commandOptions = COMMANDS.map(([name, args, detail]) => args
  ? snippetCompletion(withExit(`\\${name}${args}`), { label: `\\${name}`, detail, type: 'function' })
  : { label: `\\${name}`, detail, type: 'keyword' });

// \begin{…} skeletons offered directly when typing \begin or \beg…
const beginOptions = [
  snippetCompletion('\\begin{${env}}\n\t${}\n\\end{${env}}', { label: '\\begin', detail: 'ambiente', type: 'function', boost: 1 }),
  ...ENVIRONMENTS.map(([env, body, args = '']) =>
    snippetCompletion(`\\begin{${env}}${args}\n${body}\n\\end{${env}}`, { label: `\\begin{${env}}`, type: 'class' })),
];

const staticCommandOptions = [...commandOptions, ...beginOptions];

// ════════════════════════════════════
//  HELPERS
// ════════════════════════════════════

// Applies a completion, swallowing a "}" right after the cursor (from auto-closed braces)
function applyArgument(text, { snippetText = null } = {}) {
  return (view, completion, from, to) => {
    const next = view.state.sliceDoc(to, to + 1);
    const end = next === '}' ? to + 1 : to;
    if (snippetText) snippet(snippetText)(view, completion, from, end);
    else view.dispatch({ changes: { from, to: end, insert: text + '}' }, selection: { anchor: from + text.length + 1 } });
  };
}

// Labels defined in the open document (unsaved ones included) plus the rest of the project
function labelOptions(state) {
  const seen = new Set();
  const options = [];
  const add = (label, detail) => {
    if (seen.has(label)) return;
    seen.add(label);
    options.push({ label, detail, type: 'variable', apply: applyArgument(label) });
  };
  const text = state.doc.toString().replace(/(^|[^\\])%.*$/gm, '$1');
  for (const m of text.matchAll(/\\label\s*\{([^}]+)\}/g)) add(m[1], 'este arquivo');
  for (const l of META.labels) {
    if (l.file !== S.openFile?.path) add(l.label, l.file);
  }
  return options;
}

function bibOptions() {
  return META.bibKeys.map(b => ({
    label: b.key,
    detail: b.author ? b.author.split(/\s+and\s+/)[0] : b.type,
    info: [b.title, b.author].filter(Boolean).join(' — ') || undefined,
    type: 'text',
    apply: applyArgument(b.key),
  }));
}

function fileOptions(filter, { stripExt = null } = {}) {
  return META.files.filter(filter).map(f => {
    const value = stripExt ? f.path.replace(stripExt, '') : f.path;
    return { label: value, type: 'text', apply: applyArgument(value) };
  });
}

const isImage = f => f.type === 'image' || f.type === 'pdf' || /\.(eps|png|jpe?g|pdf)$/i.test(f.path);

function openEnvironments(state, pos) {
  const text = state.sliceDoc(0, pos).replace(/(^|[^\\])%.*$/gm, '$1');
  const stack = [];
  for (const m of text.matchAll(/\\(begin|end)\s*\{([^}]+)\}/g)) {
    if (m[1] === 'begin') stack.push(m[2]);
    else {
      const i = stack.lastIndexOf(m[2]);
      if (i >= 0) stack.splice(i);
    }
  }
  return [...new Set(stack.reverse())];
}

// ════════════════════════════════════
//  COMPLETION SOURCE
// ════════════════════════════════════

// Argument contexts: \cmd[opts]{partial  (for comma lists, only the last item)
const ARG_CONTEXTS = [
  { re: /\\(?:ref|eqref|pageref|autoref|cref|Cref|nameref|vref)\{([^}]*)$/, list: true, options: labelOptions },
  { re: /\\(?:cite[a-zA-Z]*|[pP]arencite|[tT]extcite|[aA]utocite|footcite|nocite|citeonline)\*?(?:\[[^\]]*\])*\{([^}]*)$/, list: true, options: bibOptions },
  { re: /\\includegraphics\*?(?:\[[^\]]*\])?\{([^}]*)$/, options: () => fileOptions(isImage) },
  { re: /\\(?:input|include|subfile)\{([^}]*)$/, options: () => fileOptions(f => f.path.endsWith('.tex'), { stripExt: /\.tex$/ }) },
  { re: /\\(?:bibliography|addbibresource)\{([^}]*)$/, list: true, options: () => fileOptions(f => f.path.endsWith('.bib'), { stripExt: /\.bib$/ }) },
  { re: /\\usepackage(?:\[[^\]]*\])?\{([^}]*)$/, list: true, options: () => PACKAGES.map(p => ({ label: p, type: 'namespace', apply: applyArgument(p) })) },
  { re: /\\documentclass(?:\[[^\]]*\])?\{([^}]*)$/, options: () => CLASSES.map(c => ({ label: c, type: 'namespace', apply: applyArgument(c) })) },
  {
    re: /\\begin\{([^}]*)$/,
    options: () => ENVIRONMENTS.map(([env, body, args = '']) => ({
      label: env, type: 'class',
      apply: applyArgument(null, { snippetText: `${env}}${args}\n${body}\n\\end{${env}}` }),
    })),
  },
  { re: /\\end\{([^}]*)$/, options: (state, pos) => openEnvironments(state, pos).map(env => ({ label: env, type: 'class', apply: applyArgument(env) })) },
];

export function latexCompletions(context) {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);

  for (const ctx of ARG_CONTEXTS) {
    const m = before.match(ctx.re);
    if (!m) continue;
    let typed = m[1];
    if (ctx.list) typed = typed.slice(typed.lastIndexOf(',') + 1).trimStart();
    return {
      from: pos - typed.length,
      options: ctx.options(state, pos),
      validFor: /^[^},\s]*$/,
    };
  }

  const cmd = context.matchBefore(/\\[a-zA-Z@*]*/);
  if (!cmd || (cmd.from === cmd.to && !context.explicit)) return null;
  // "\\" is a line break, not the start of a command
  if (cmd.from > 0 && state.sliceDoc(cmd.from - 1, cmd.from) === '\\') return null;

  const custom = META.commands.map(c => c.args
    ? snippetCompletion(withExit(`\\${c.name}${'{${}}'.repeat(c.args)}`), { label: `\\${c.name}`, detail: c.file, type: 'function' })
    : { label: `\\${c.name}`, detail: c.file, type: 'keyword' });

  return {
    from: cmd.from,
    options: [...staticCommandOptions, ...custom],
    validFor: /^\\[a-zA-Z@*]*$/,
  };
}
