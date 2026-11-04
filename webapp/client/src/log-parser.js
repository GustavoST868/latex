// Turns a TeX .log (and BibTeX/Biber .blg) into errors, warnings and bad boxes.

const MAX_PRINT_LINE = 79; // TeX wraps log lines at this width
const encoder = new TextEncoder();

// Joins lines TeX broke at the wrap width (pdfTeX counts bytes, XeTeX/LuaTeX characters)
function unwrap(text) {
  const out = [];
  let buf = '';
  for (const line of text.split(/\r?\n/)) {
    buf += line;
    if (line.length === MAX_PRINT_LINE || encoder.encode(line).length === MAX_PRINT_LINE) continue;
    out.push(buf);
    buf = '';
  }
  if (buf) out.push(buf);
  return out;
}

// Tracks which file TeX is reading: "(./chapter.tex" opens one, ")" closes it
function updateFileStack(line, stack) {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '(') {
      const m = line.slice(i + 1).match(/^("[^"]+"|[^\s()"]+)/);
      const name = m && m[1].replace(/"/g, '');
      if (name && /\.[a-zA-Z0-9]{1,10}$/.test(name) && /[/.]/.test(name[0] + name)) {
        stack.push(name);
        i += m[1].length;
      } else {
        stack.push(null);
      }
    } else if (ch === ')') {
      stack.pop();
    }
  }
}

const currentFile = stack => [...stack].reverse().find(Boolean) || null;

// Lines after a message, up to a blank line (TeX's context: "l.12 \foo")
function collect(lines, from, max = 8) {
  const out = [];
  for (let i = from; i < lines.length && out.length < max; i++) {
    if (!lines[i].trim()) break;
    out.push(lines[i]);
  }
  return out;
}

export function parseTexLog(text) {
  const lines = unwrap(text);
  const entries = [];
  const stack = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;

    // -file-line-error format: ./main.tex:12: Undefined control sequence.
    if ((m = line.match(/^((?:\.{0,2}\/|[A-Za-z]:\\|[^\s:()]+\/)?[^\s:()]*\.[a-zA-Z0-9]+):(\d+): (.*)$/))) {
      const context = collect(lines, i + 1);
      entries.push({ level: 'error', file: m[1], line: +m[2], message: m[3], content: [line, ...context].join('\n') });
      i += context.length;
      continue;
    }

    // Classic format: ! LaTeX Error: … (line from the following "l.<n>")
    if ((m = line.match(/^! (.*)$/))) {
      const context = collect(lines, i + 1);
      const at = context.map(l => l.match(/^l\.(\d+)/)).find(Boolean);
      entries.push({ level: 'error', file: currentFile(stack), line: at ? +at[1] : null, message: m[1], content: [line, ...context].join('\n') });
      i += context.length;
      continue;
    }

    // LaTeX / package / class warnings, possibly continued on "(pkg)   …" lines
    if ((m = line.match(/^(LaTeX|LaTeX Font|Package ([\w.-]+)|Class ([\w.-]+)|pdfTeX) warning:? ?(.*)$/i))) {
      const pkg = m[2] || m[3];
      let message = m[4];
      const raw = [line];
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        const isCont = pkg ? next.startsWith(`(${pkg})`) : (next.trim() && !/[.!]$/.test(message.trim()) && !/^\S+:\d+:|^!|warning/i.test(next));
        if (!isCont) break;
        message += ' ' + next.replace(/^\([\w.-]+\)\s*/, '').trim();
        raw.push(next);
        i++;
      }
      // Font warnings are mostly noise; Overleaf hides them too
      if (/^LaTeX Font$/i.test(m[1])) continue;
      const at = message.match(/on input line (\d+)/);
      entries.push({ level: 'warning', file: currentFile(stack), line: at ? +at[1] : null, message: message.trim(), content: raw.join('\n') });
      continue;
    }

    // Overfull/underfull boxes
    if ((m = line.match(/^(Over|Under)full \\([hv])box \((.*?)\)(.*)$/))) {
      const where = m[4].match(/lines? (\d+)/);
      const context = collect(lines, i + 1, 3);
      entries.push({
        level: 'typesetting',
        file: currentFile(stack),
        line: where ? +where[1] : null,
        message: `${m[1] === 'Over' ? 'Overfull' : 'Underfull'} \\${m[2]}box (${m[3]})${m[4]}`,
        content: [line, ...context].join('\n'),
      });
      i += context.length;
      continue;
    }

    updateFileStack(line, stack);
  }
  return dedupe(entries);
}

// BibTeX and Biber messages
export function parseBlg(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    let m;
    if ((m = line.match(/^Warning--(.*)$/))) entries.push({ level: 'warning', file: null, line: null, message: `BibTeX: ${m[1]}`, content: line });
    else if ((m = line.match(/^(I couldn't open .*|I found no .*|.*---line \d+ of file .*)$/))) entries.push({ level: 'error', file: null, line: null, message: `BibTeX: ${m[1]}`, content: line });
    else if ((m = line.match(/\b(WARN|ERROR) - (.*)$/))) {
      entries.push({ level: m[1] === 'ERROR' ? 'error' : 'warning', file: null, line: null, message: `Biber: ${m[2]}`, content: line });
    }
  }
  return dedupe(entries);
}

function dedupe(entries) {
  const seen = new Set();
  return entries.filter(e => {
    const key = `${e.level}|${e.file}|${e.line}|${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Maps a path from the log to a project path, or null for files outside the project.
 * compileDir: folder of the main file (TeX runs there); root: absolute project path.
 */
export function toProjectPath(file, { compileDir = '', root = '' } = {}) {
  if (!file) return null;
  if (root && file.startsWith(root + '/')) return file.slice(root.length + 1);
  if (file.startsWith('/') || /^[A-Za-z]:\\/.test(file)) return null;
  const parts = [];
  for (const seg of [...(compileDir ? compileDir.split('/') : []), ...file.split('/')]) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}
