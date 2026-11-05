import { el } from './util.js';

// Small Markdown renderer for chat answers. It builds DOM nodes (text is never parsed
// as HTML) and copes with half-written input while an answer is still streaming.
// `codeBlock(code, lang)` renders fenced blocks, so callers can add their own buttons.
export function renderMarkdown(text, codeBlock) {
  const out = [];
  const lines = text.split('\n');
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) out.push(el('p', {}, inline(para.join(' '))));
    para = [];
  };
  const flushList = () => {
    if (list) out.push(list.node);
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+-]*)/);
    if (fence) {
      flushPara();
      flushList();
      const code = [];
      while (++i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i]);
      out.push(codeBlock(code.join('\n'), fence[1].toLowerCase()));
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)/);
    if (heading) {
      flushPara();
      flushList();
      out.push(el(heading[1].length <= 2 ? 'h3' : 'h4', {}, inline(heading[2])));
      continue;
    }
    const item = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)/);
    if (item) {
      flushPara();
      const ordered = /\d/.test(item[1]);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, node: el(ordered ? 'ol' : 'ul') };
      }
      list.node.append(el('li', {}, inline(item[2])));
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    // Indented continuation of a list item
    if (list && /^\s{2,}/.test(line)) {
      list.node.lastChild.append(' ', ...inline(line.trim()));
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return out;
}

// `code`, **bold** and *italic*
function inline(text) {
  const nodes = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|(?<![\w*\\])\*([^*\s][^*]*?)\*(?![\w*])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] != null) nodes.push(el('code', {}, m[1]));
    else if (m[2] != null) nodes.push(el('strong', {}, m[2]));
    else nodes.push(el('em', {}, m[3]));
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
