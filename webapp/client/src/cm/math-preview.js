import { StateField } from '@codemirror/state';
import { showTooltip } from '@codemirror/view';

const DISPLAY_ENVS = 'equation|align|gather|multline|flalign|alignat|eqnarray|displaymath|math|split';
const WINDOW = 4000;

// KaTeX is loaded only the first time a formula is previewed
let katexPromise = null;
function loadKatex() {
  katexPromise ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => m.default);
  return katexPromise;
}

const stripComments = s => s.replace(/(^|[^\\])%.*$/gm, '$1');

/**
 * Finds the math expression around `pos`.
 * Returns { from, to, tex, display } with from/to covering the whole expression.
 */
export function findMathAt(doc, pos) {
  const start = Math.max(0, pos - WINDOW);
  const text = doc.sliceString(start, Math.min(doc.length, pos + WINDOW));
  const p = pos - start;

  // 1. Display environments: \begin{equation} … \end{equation}
  const envRe = new RegExp(`\\\\(begin|end)\\{(${DISPLAY_ENVS})(\\*?)\\}`, 'g');
  let open = null;
  for (const m of text.matchAll(envRe)) {
    if (m[1] === 'begin') {
      if (m.index >= p) break;
      open = m;
    } else if (open && m[2] === open[2] && m[3] === open[3]) {
      if (m.index + m[0].length >= p) {
        const env = open[2] === 'displaymath' || open[2] === 'math' ? null : open[2] + open[3];
        const body = text.slice(open.index + open[0].length, m.index);
        return {
          from: start + open.index,
          to: start + m.index + m[0].length,
          tex: env ? `\\begin{${env}}${body}\\end{${env}}` : body,
          display: true,
        };
      }
      open = null;
    }
  }

  // 2. \[ … \] and \( … \)
  for (const [o, c, display] of [['\\[', '\\]', true], ['\\(', '\\)', false]]) {
    const oi = text.lastIndexOf(o, p - 1);
    if (oi === -1 || text.lastIndexOf(c, p - 1) > oi) continue;
    const ci = text.indexOf(c, oi + 2);
    if (ci !== -1 && ci + 2 >= p) {
      return { from: start + oi, to: start + ci + 2, tex: text.slice(oi + 2, ci), display };
    }
  }

  // 3. $ … $ and $$ … $$ within the current paragraph
  const paraStart = Math.max(text.lastIndexOf('\n\n', p - 1) + 2, 0);
  let paraEnd = text.indexOf('\n\n', p);
  if (paraEnd === -1) paraEnd = text.length;
  const para = text.slice(paraStart, paraEnd);
  const rel = p - paraStart;
  let i = 0;
  while (i < para.length) {
    const ch = para[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '%') { const nl = para.indexOf('\n', i); i = nl === -1 ? para.length : nl; continue; }
    if (ch === '$') {
      const delim = para[i + 1] === '$' ? '$$' : '$';
      let j = i + delim.length;
      while (j < para.length) {
        if (para[j] === '\\') { j += 2; continue; }
        if (para.startsWith(delim, j)) break;
        j++;
      }
      if (j >= para.length) return null; // unclosed
      if (rel > i && rel <= j + delim.length - 1) {
        return { from: start + paraStart + i, to: start + paraStart + j + delim.length, tex: para.slice(i + delim.length, j), display: delim === '$$' };
      }
      i = j + delim.length;
      continue;
    }
    i++;
  }
  return null;
}

function mathTooltip(state) {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const math = findMathAt(state.doc, sel.head);
  if (!math || !math.tex.trim()) return null;

  return {
    pos: math.from,
    above: true,
    arrow: false,
    create() {
      const dom = document.createElement('div');
      dom.className = 'math-preview';
      loadKatex().then(katex => {
        try {
          katex.render(stripComments(math.tex), dom, { displayMode: math.display, throwOnError: false, strict: 'ignore' });
        } catch (err) {
          dom.textContent = err.message;
        }
      });
      return { dom };
    },
  };
}

// Shows a rendered preview while the cursor is inside a formula, like Overleaf
export const mathPreview = StateField.define({
  create: mathTooltip,
  update(tooltip, tr) {
    if (!tr.docChanged && !tr.selection) return tooltip;
    return mathTooltip(tr.state);
  },
  provide: f => showTooltip.from(f),
});
