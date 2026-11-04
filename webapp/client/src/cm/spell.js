import { EditorView, ViewPlugin, Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

// Parts of the source that are not prose: commands, arguments that hold keys/paths, math and comments
const NO_SPELL = new RegExp([
  '%.*$',
  '\\\\(?:label|ref|eqref|pageref|autoref|cref|Cref|cite[a-zA-Z]*|parencite|textcite|autocite|citeonline|nocite|begin|end|usepackage|documentclass|includegraphics|input|include|bibliography[a-zA-Z]*|addbibresource|url|href|newcommand|renewcommand|newenvironment|color|textcolor)\\*?(?:\\[[^\\]]*\\])*\\{[^}]*\\}',
  '\\\\[a-zA-Z@]+\\*?',
  '\\$\\$[^$]*\\$\\$',
  '\\$[^$]*\\$',
  '\\\\\\[[\\s\\S]*?\\\\\\]',
].join('|'), 'gm');

const noSpell = Decoration.mark({ attributes: { spellcheck: 'false' } });

function buildDecorations(view) {
  const builder = new RangeSetBuilder();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const m of text.matchAll(NO_SPELL)) {
      if (m[0].length) builder.add(from + m.index, from + m.index + m[0].length, noSpell);
    }
  }
  return builder.finish();
}

const skipLatexMarkup = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildDecorations(view); }
  update(u) {
    if (u.docChanged || u.viewportChanged) this.decorations = buildDecorations(u.view);
  }
}, { decorations: v => v.decorations });

/**
 * Uses the browser's own spellchecker (right-click shows suggestions),
 * skipping LaTeX markup so only prose gets underlined.
 */
export function spellcheck(lang) {
  if (!lang) return EditorView.contentAttributes.of({ spellcheck: 'false' });
  return [EditorView.contentAttributes.of({ spellcheck: 'true', lang }), skipLatexMarkup];
}
