import { $, el, icon, FILE_ICONS } from './util.js';
import { api, projectUrl } from './api.js';

const form = $('search-form');
const input = $('search-input');
const optCase = $('search-case');
const optRegex = $('search-regex');
const results = $('search-results');

let debounce = null;
let requestId = 0;

function summary(text) {
  return el('div', { className: 'search-summary' }, text);
}

// Splits a line into text and <mark> nodes for each match
function highlight(text, re) {
  const parts = [];
  let last = 0;
  if (re) {
    for (const m of text.matchAll(re)) {
      if (!m[0]) break;
      parts.push(text.slice(last, m.index), el('mark', {}, m[0]));
      last = m.index + m[0].length;
    }
  }
  parts.push(text.slice(last));
  return parts;
}

async function runSearch(openHit) {
  const q = input.value;
  const id = ++requestId;
  if (!q) return results.replaceChildren();

  const params = new URLSearchParams({ q, case: optCase.checked ? '1' : '0', regex: optRegex.checked ? '1' : '0' });
  let data;
  try {
    data = await api(`${projectUrl()}/search?${params}`);
  } catch (err) {
    if (id === requestId) results.replaceChildren(summary(err.message));
    return;
  }
  if (id !== requestId) return; // a newer search started meanwhile

  if (!data.results.length) return results.replaceChildren(summary('Nenhum resultado.'));

  let re = null;
  try {
    const source = optRegex.checked ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(source, optCase.checked ? 'g' : 'gi');
  } catch {}

  const byFile = new Map();
  for (const r of data.results) {
    if (!byFile.has(r.path)) byFile.set(r.path, []);
    byFile.get(r.path).push(r);
  }

  const nodes = [summary(
    `${data.results.length}${data.truncated ? '+' : ''} resultado(s) em ${byFile.size} arquivo(s)`
  )];
  for (const [path, hits] of byFile) {
    nodes.push(el('div', { className: 'search-file', title: path }, icon(FILE_ICONS.text), path));
    for (const hit of hits) {
      nodes.push(el('div', { className: 'search-hit', onclick: () => openHit(hit.path, hit.line) },
        el('span', { className: 'line-no' }, hit.line),
        el('span', { className: 'text' }, ...highlight(hit.text.trimStart(), re)),
      ));
    }
  }
  results.replaceChildren(...nodes);
}

export function focusSearch() {
  input.focus();
  input.select();
}

export function clearSearch() {
  requestId++;
  input.value = '';
  results.replaceChildren();
}

export function initSearch({ onOpenHit }) {
  form.addEventListener('submit', e => {
    e.preventDefault();
    runSearch(onOpenHit);
  });
  const schedule = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => runSearch(onOpenHit), 300);
  };
  input.addEventListener('input', schedule);
  optCase.addEventListener('change', schedule);
  optRegex.addEventListener('change', schedule);
}
