import { StateField, StateEffect, Prec } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, showTooltip, keymap } from '@codemirror/view';
import { el, icon } from '../util.js';
import { streamChat } from '../ai.js';

// Inline AI editing (Ctrl+J): a prompt box opens under the selection and the model's
// proposal streams in. A review (or an edit that only touches a few words) then shows up
// in the text itself: each change is highlighted, and a click on it opens a balloon to
// accept, edit or ignore it. Other proposals appear in full below the struck-through
// original, where they can be edited before replacing it. With no selection, the proposal
// is inserted at the cursor.

const openEffect = StateEffect.define();            // { id, from, to }
const closeEffect = StateEffect.define();
const setSuggestionsEffect = StateEffect.define();  // [{ id, from, to, before, insert, why }] or null
const resolveEffect = StateEffect.define();         // id of a suggestion accepted or ignored
const activateEffect = StateEffect.define();        // id of the suggestion whose balloon is open, or null

// The open prompt, if any (one at a time); its DOM lives across redraws
let session = null;
let nextId = 1;
let nextSuggestionId = 1;

const SELECTION_ACTIONS = [
  'Corrija a ortografia e a gramática',
  'Melhore a escrita, mantendo o sentido',
  'Deixe mais curto',
  'Converta em uma tabela',
  'Converta em uma lista com \\item',
];
// One-click review and translation of the selection: the server answers these modes with
// JSON { result, changes: [{ original, suggestion, explanation }] }
const QUICK_ACTIONS = [
  { mode: 'review-en', label: 'Revisar inglês', icon: 'spellcheck', busy: 'Revisando…' },
  { mode: 'review-pt', label: 'Revisar português', icon: 'spellcheck', busy: 'Revisando…' },
  { mode: 'translate-en', label: 'Traduzir para inglês', icon: 'translate', busy: 'Traduzindo…' },
  { mode: 'translate-pt', label: 'Traduzir para português', icon: 'translate', busy: 'Traduzindo…' },
];
const CURSOR_ACTIONS = [
  'Escreva um parágrafo de introdução sobre o tema do documento',
  'Insira uma figura com legenda e rótulo',
  'Insira uma tabela de exemplo com booktabs',
  'Insira uma equação numerada de exemplo',
];

// A free-form edit is shown as suggestions in the text only when it keeps most of it
const MAX_SUGGESTED_SHARE = 0.5;

const inlineField = StateField.define({
  create: () => null,
  update(value, tr) {
    if (value && tr.docChanged) {
      const from = tr.changes.mapPos(value.from, 1);
      const to = Math.max(from, tr.changes.mapPos(value.to, -1));
      value = { ...value, from, to };
    }
    for (const e of tr.effects) {
      if (e.is(openEffect)) value = e.value;
      else if (e.is(closeEffect)) value = null;
    }
    if (!value) return null;
    // A selection of whole lines ends at the start of the next one: show the box above it
    const end = value.to > value.from && tr.state.doc.lineAt(value.to).from === value.to ? value.to - 1 : value.to;
    return { ...value, at: tr.state.doc.lineAt(end).to };
  },
});

// ════════════════════════════════════
//  SUGGESTIONS IN THE TEXT
// ════════════════════════════════════
const NO_SUGGESTIONS = { items: [], active: null };

// True when an edit changes text inside the suggestion (not just next to it)
function editedInside(changes, { from, to }) {
  let hit = false;
  changes.iterChangedRanges((fromA, toA) => {
    if (fromA < to && toA > from) hit = true;
  });
  return hit;
}

const suggestField = StateField.define({
  create: () => NO_SUGGESTIONS,
  update(value, tr) {
    let { items, active } = value;
    // A suggestion whose text the user changed no longer applies
    if (tr.docChanged && items.length) {
      items = items
        .filter(s => !editedInside(tr.changes, s))
        .map(s => ({ ...s, from: tr.changes.mapPos(s.from, 1), to: tr.changes.mapPos(s.to, -1) }))
        .filter(s => s.to > s.from);
    }
    // Moving the cursor away from the suggestion closes its balloon
    if (tr.selection && active != null) {
      const open = items.find(s => s.id === active);
      const { head } = tr.state.selection.main;
      if (!open || head < open.from || head > open.to) active = null;
    }
    for (const e of tr.effects) {
      if (e.is(setSuggestionsEffect)) {
        items = e.value || [];
        active = null;
      } else if (e.is(closeEffect)) {
        items = [];
        active = null;
      } else if (e.is(resolveEffect)) {
        items = items.filter(s => s.id !== e.value);
        if (active === e.value) active = null;
      } else if (e.is(activateEffect)) {
        active = items.some(s => s.id === e.value) ? e.value : null;
      }
    }
    if (active != null && !items.some(s => s.id === active)) active = null;
    if (items === value.items && active === value.active) return value;
    return items.length ? { items, active } : NO_SUGGESTIONS;
  },
});

const targetMark = Decoration.mark({ class: 'cm-ai-target' });

// The struck-through original and the prompt box, or the highlighted suggestions
const aiDecorations = EditorView.decorations.compute([inlineField, suggestField], state => {
  const open = state.field(inlineField);
  const { items, active } = state.field(suggestField);
  const ranges = [];
  if (open && open.to > open.from && !items.length) ranges.push(targetMark.range(open.from, open.to));
  for (const s of items) {
    ranges.push(Decoration.mark({
      class: `cm-ai-sug${s.insert.trim() ? '' : ' del'}${s.id === active ? ' active' : ''}`,
      attributes: { 'data-sug': String(s.id) },
    }).range(s.from, s.to));
  }
  if (open) ranges.push(Decoration.widget({ widget: new PromptWidget(open.id), block: true, side: 1 }).range(open.at));
  return Decoration.set(ranges, true);
});

const findSuggestion = (state, id) => state.field(suggestField).items.find(s => s.id === id);

function autosize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight + 2, 360) + 'px';
}

// The balloon of one suggestion: what changes, why, and Accept / Edit / Ignore
function balloonDOM(view, id) {
  const dom = el('div', { className: 'cm-ai-balloon' });

  const apply = insert => {
    const sug = findSuggestion(view.state, id);
    if (!sug) return;
    view.dispatch({
      changes: { from: sug.from, to: sug.to, insert },
      selection: { anchor: sug.from + insert.length },
      effects: resolveEffect.of(id),
      userEvent: 'input.ai',
    });
    view.focus();
  };
  const ignore = () => {
    view.dispatch({ effects: resolveEffect.of(id) });
    view.focus();
  };
  const before = sug => el('span', { className: 'cm-ai-del' }, sug.before);

  const show = () => {
    const sug = findSuggestion(view.state, id);
    if (!sug) return;
    const acceptBtn = el('button', { className: 'btn btn-primary', onclick: () => apply(sug.insert) }, icon('check'), 'Aceitar');
    dom.replaceChildren(
      el('div', { className: 'cm-ai-balloon-diff' },
        before(sug),
        icon('arrow_forward'),
        sug.insert.trim() ? el('span', { className: 'cm-ai-ins' }, sug.insert) : el('em', {}, 'remover')),
      sug.why ? el('div', { className: 'cm-ai-why' }, sug.why) : null,
      el('div', { className: 'cm-ai-balloon-actions' },
        acceptBtn,
        el('button', { className: 'btn btn-ghost', onclick: edit }, icon('edit'), 'Editar'),
        el('button', { className: 'btn btn-ghost', onclick: ignore }, icon('close'), 'Ignorar')));
    return acceptBtn;
  };

  const edit = () => {
    const sug = findSuggestion(view.state, id);
    if (!sug) return;
    const box = el('textarea', { className: 'cm-ai-edit', spellcheck: 'false', rows: 1, 'aria-label': 'Texto da sugestão' });
    box.value = sug.insert;
    const done = () => apply(box.value);
    box.addEventListener('input', () => autosize(box));
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        done();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        show()?.focus();
      }
    });
    dom.replaceChildren(
      el('div', { className: 'cm-ai-balloon-diff' }, before(sug), icon('arrow_forward')),
      box,
      el('div', { className: 'cm-ai-balloon-actions' },
        el('button', { className: 'btn btn-primary', onclick: done }, icon('check'), 'Aplicar'),
        el('button', { className: 'btn btn-ghost', onclick: () => show()?.focus() }, 'Cancelar'),
        el('span', { className: 'cm-ai-hint' }, 'Enter aplica · Shift+Enter quebra a linha')));
    requestAnimationFrame(() => {
      autosize(box);
      box.focus();
      box.select();
    });
  };

  // Keys typed here are not editor input, nor global shortcuts
  dom.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      view.dispatch({ effects: activateEffect.of(null) });
      view.focus();
    }
  });
  show();
  return dom;
}

// One create function per suggestion, so that redraws keep the balloon (and what is typed in it)
let balloon = { id: null, create: null };
const balloonTooltip = showTooltip.compute([suggestField], state => {
  const { items, active } = state.field(suggestField);
  const sug = active == null ? null : items.find(s => s.id === active);
  if (!sug) return null;
  if (balloon.id !== sug.id) balloon = { id: sug.id, create: view => ({ dom: balloonDOM(view, sug.id) }) };
  return { pos: sug.from, above: false, arrow: false, create: balloon.create };
});

// A click on a highlighted change opens its balloon (the cursor still goes where clicked)
const suggestionClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0) return false;
    const mark = e.target.closest?.('.cm-ai-sug');
    const id = mark ? Number(mark.dataset.sug) : null;
    if (id && id !== view.state.field(suggestField).active && findSuggestion(view.state, id)) {
      view.dispatch({ effects: activateEffect.of(id) });
    }
    return false;
  },
});

// Keeps the box's count up to date and closes it once every suggestion was handled
const reviewWatcher = EditorView.updateListener.of(u => {
  const s = session;
  if (!s?.reviewing || s.view !== u.view) return;
  const left = u.state.field(suggestField).items.length;
  if (left === s.left) return;
  s.left = left;
  if (left) showReviewStatus(s);
  else setTimeout(() => finishReview(s));
});

class PromptWidget extends WidgetType {
  constructor(id) {
    super();
    this.id = id;
  }

  eq(other) {
    return other.id === this.id;
  }

  toDOM() {
    return session?.id === this.id ? session.dom : document.createElement('div');
  }

  // Typing and clicking inside the box is not editor input
  ignoreEvent() {
    return true;
  }
}

// ════════════════════════════════════
//  SESSION (the prompt box)
// ════════════════════════════════════
function createSession(view, id, hasSelection) {
  const s = {
    id, view, hasSelection, controller: null, text: '', original: '', running: false, quick: null,
    editing: false, reviewing: false, left: 0, highlight: false,
  };
  const input = el('input', { type: 'text', className: 'cm-ai-input', placeholder: hasSelection ? 'O que fazer com o trecho selecionado?' : 'O que escrever aqui?' });
  const sendBtn = el('button', { className: 'cm-ai-btn primary', title: 'Gerar (Enter)' }, icon('arrow_upward'));
  const closeBtn = el('button', { className: 'cm-ai-btn', title: 'Fechar (Esc)' }, icon('close'));
  const quickRow = hasSelection ? el('div', { className: 'cm-ai-quick' },
    QUICK_ACTIONS.map(action => el('button', {
      className: 'cm-ai-quick-btn',
      onclick: () => { s.quick = action; input.value = action.label; generate(s); },
    }, icon(action.icon), action.label))) : null;
  const chips = el('div', { className: 'cm-ai-chips' },
    (hasSelection ? SELECTION_ACTIONS : CURSOR_ACTIONS).map(label => el('button', {
      className: 'cm-ai-chip',
      onclick: () => { s.quick = null; input.value = label; generate(s); },
    }, label)));
  const resultEl = el('pre', { className: 'cm-ai-result hidden' });
  const editEl = el('textarea', { className: 'cm-ai-edit hidden', spellcheck: 'false', rows: 1, 'aria-label': 'Resposta do modelo' });
  const changesEl = el('ul', { className: 'cm-ai-changes hidden' });
  const status = el('div', { className: 'cm-ai-status' });
  const acceptLabel = el('span', {});
  const acceptBtn = el('button', { className: 'btn btn-primary', title: 'Ctrl+Enter' }, icon('check'), acceptLabel);
  const nextBtn = el('button', { className: 'btn btn-ghost', title: 'Abrir a próxima sugestão no texto' }, icon('arrow_downward'), 'Próxima');
  const editBtn = el('button', { className: 'btn btn-ghost', title: 'Editar a resposta antes de aplicá-la' }, icon('edit'), 'Editar');
  const retryBtn = el('button', { className: 'btn btn-ghost' }, icon('refresh'), 'Gerar de novo');
  const discardBtn = el('button', { className: 'btn btn-ghost' }, 'Descartar');
  const hint = el('span', { className: 'cm-ai-hint' });
  const actions = el('div', { className: 'cm-ai-actions hidden' }, acceptBtn, nextBtn, editBtn, retryBtn, discardBtn, hint);

  s.dom = el('div', { className: 'cm-ai-inline' },
    el('div', { className: 'cm-ai-row' }, icon('auto_awesome', 'cm-ai-spark'), input, sendBtn, closeBtn),
    quickRow, chips, resultEl, editEl, changesEl, status, actions);
  Object.assign(s, { input, sendBtn, quickRow, chips, resultEl, editEl, changesEl, status, actions, acceptBtn, acceptLabel, nextBtn, editBtn, hint });
  setMode(s, 'result');

  // A typed instruction is a free-form edit, not the quick action that filled the box
  input.addEventListener('input', () => { s.quick = null; });
  editEl.addEventListener('input', () => {
    s.text = editEl.value;
    autosize(editEl);
  });
  sendBtn.onclick = () => (s.running ? s.controller?.abort() : generate(s));
  closeBtn.onclick = () => closeInlineAI(view);
  discardBtn.onclick = () => closeInlineAI(view);
  retryBtn.onclick = () => generate(s);
  acceptBtn.onclick = () => accept(s);
  editBtn.onclick = () => startEditing(s);
  nextBtn.onclick = () => openNextSuggestion(s);
  s.dom.addEventListener('keydown', e => {
    // Never let these reach the editor or the global shortcuts (Ctrl+Enter compiles)
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      // In the text being edited, Esc only stops editing (the changes are kept)
      if (e.target === editEl) stopEditing(s);
      else closeInlineAI(view);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!s.running && (s.text || s.editing || s.reviewing)) accept(s);
    } else if (e.key === 'Enter' && e.target === input) {
      e.preventDefault();
      generate(s);
    }
  });
  return s;
}

// What the action row offers: the full proposal ('result'), the proposal being edited
// ('editing'), or the suggestions highlighted in the text ('review')
function setMode(s, mode) {
  s.editing = mode === 'editing';
  s.reviewing = mode === 'review';
  s.editEl.classList.toggle('hidden', !s.editing);
  s.nextBtn.classList.toggle('hidden', !s.reviewing);
  s.editBtn.classList.toggle('hidden', s.editing);
  if (s.editing || s.reviewing) {
    s.resultEl.classList.add('hidden');
    s.changesEl.classList.add('hidden');
    s.acceptBtn.classList.remove('hidden');
  }
  s.acceptLabel.textContent = s.reviewing ? 'Aceitar todas' : s.hasSelection ? 'Substituir' : 'Inserir';
  s.hint.textContent = s.reviewing ? 'Ctrl+Enter aceita todas · Esc descarta'
    : s.editing ? 'Ctrl+Enter aplica · Esc termina a edição'
    : 'Ctrl+Enter aceita · Esc descarta';
}

const fieldOf = view => view.state.field(inlineField, false);

// The model sometimes wraps its answer in a code fence or echoes our markers
function cleanResult(text, original) {
  let out = text.replace(/^\s*```[\w-]*\n?/, '').replace(/\n?```\s*$/, '').replace(/^<<<\n?|\n?>>>$/g, '');
  if (original.endsWith('\n') && !out.endsWith('\n')) out += '\n';
  return out;
}

function promptFor(instruction, view, { from, to }) {
  const { doc } = view.state;
  const before = doc.sliceString(Math.max(0, from - 1500), from);
  const after = doc.sliceString(to, Math.min(doc.length, to + 600));
  if (to > from) {
    return `Instrução: ${instruction}\n\nTrecho a alterar:\n<<<\n${doc.sliceString(from, to)}\n>>>\n\n`
      + `Para contexto, o texto logo antes do trecho (não o repita):\n<<<\n${before}\n>>>`;
  }
  return `Instrução: ${instruction}\n\nEscreva o texto LaTeX a ser inserido na posição do cursor.\n`
    + `Texto antes do cursor:\n<<<\n${before}\n>>>\nTexto depois do cursor:\n<<<\n${after}\n>>>`;
}

// ════════════════════════════════════
//  QUICK ACTIONS (JSON replies)
// ════════════════════════════════════

// Decodes the "result" string of a JSON reply that is still streaming in
function partialResult(json) {
  const start = /"result"\s*:\s*"/.exec(json);
  if (!start) return '';
  const escapes = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };
  let out = '';
  for (let i = start.index + start[0].length; i < json.length; i++) {
    const c = json[i];
    if (c === '"') break;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const next = json[++i];
    if (next === undefined) break;
    if (next === 'u') {
      const hex = json.slice(i + 1, i + 5);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    } else {
      out += escapes[next] ?? next;
    }
  }
  return out;
}

// The full reply, or null when it is not the JSON we asked for
function parseReply(text) {
  let data;
  try {
    data = JSON.parse(text.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, ''));
  } catch {
    return null;
  }
  if (typeof data?.result !== 'string') return null;
  const changes = (Array.isArray(data.changes) ? data.changes : []).filter(c =>
    c && typeof c.original === 'string' && typeof c.suggestion === 'string' && c.original !== c.suggestion);
  return { result: data.result, changes };
}

// Models drop the selection's leading indentation and trailing newline: give them back
function keepEdges(result, original) {
  const lead = original.match(/^\s*/)[0];
  const trail = original.slice(lead.length).match(/\s*$/)[0];
  return lead + result.trim() + trail;
}

// ════════════════════════════════════
//  DIFF (what a review changed, in red)
// ════════════════════════════════════

// Words, runs of whitespace and single symbols: the units a review changes
const tokenize = text => text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) || [];

// Past this many table cells the changed middle is marked as a whole
const MAX_DIFF_CELLS = 4e6;

// Word-level diff as a list of [kind, token]: 0 kept, 1 removed, 2 inserted
function diffTokens(a, b) {
  // The unchanged ends need no table
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  const ops = b.slice(0, start).map(t => [0, t]);
  if (n * m > MAX_DIFF_CELLS) {
    for (let i = start; i < endA; i++) ops.push([1, a[i]]);
    for (let j = start; j < endB; j++) ops.push([2, b[j]]);
  } else {
    // lcs[i * w + j]: longest common subsequence of the middles from i and j on
    const w = m + 1;
    const lcs = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] = a[start + i] === b[start + j]
          ? lcs[(i + 1) * w + j + 1] + 1
          : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        ops.push([0, b[start + j]]);
        i++;
        j++;
      } else if (j < m && (i === n || lcs[(i + 1) * w + j] < lcs[i * w + j + 1])) {
        ops.push([2, b[start + j]]);
        j++;
      } else {
        ops.push([1, a[start + i]]);
        i++;
      }
    }
  }
  for (let j = endB; j < b.length; j++) ops.push([0, b[j]]);
  return ops;
}

// The result as runs of { text, changed, before }, where before is the text it replaced
function diffRuns(original, result) {
  const runs = [];
  for (const [kind, token] of diffTokens(tokenize(original), tokenize(result))) {
    let last = runs[runs.length - 1];
    if (!last || last.changed !== (kind !== 0)) {
      last = { text: '', changed: kind !== 0, before: '' };
      runs.push(last);
    }
    if (kind === 1) last.before += token;
    else last.text += token;
  }
  // A lone space between two changes belongs to them: "a big house" -> "the large house"
  const merged = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    const gap = merged[merged.length - 2];
    if (run.changed && prev && !prev.changed && !prev.text.trim() && gap?.changed) {
      merged.pop();
      gap.text += prev.text + run.text;
      gap.before += prev.text + run.before;
    } else {
      merged.push(run);
    }
  }
  return merged;
}

// Shows the result with what changed from the original in red (removals struck through)
function showDiff(target, original, result) {
  target.replaceChildren(...diffRuns(original, result).map(run => {
    if (!run.changed) return document.createTextNode(run.text);
    if (!run.text) return el('span', { className: 'cm-ai-removed', title: 'Removido' }, run.before);
    const title = run.before.trim() ? `Antes: ${run.before}` : 'Acrescentado';
    return el('span', { className: 'cm-ai-changed', title }, run.text);
  }));
}

// The last word (or symbol) of a text and the spaces after it; a line break stops it
const LAST_WORD = /(?:[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s])[ \t]*$/u;
// The spaces at the start of a text and the word (or symbol) after them
const FIRST_WORD = /^[ \t]*(?:[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s])/u;

/**
 * The changes from original to result as replacements [{ from, to, before, insert }], with
 * offsets into the original. A pure insertion takes in the word before it (or after it),
 * so that every change covers some text to highlight and click. Returns [] when a change
 * can't be anchored like that.
 */
function suggestionsFor(original, result) {
  const runs = diffRuns(original, result);
  runs.forEach((run, i) => {
    if (!run.changed || run.before) return;
    const prev = runs[i - 1];
    const next = runs[i + 1];
    const tail = prev && !prev.changed ? LAST_WORD.exec(prev.text) : null;
    if (tail) {
      prev.text = prev.text.slice(0, tail.index);
      run.before = tail[0];
      run.text = tail[0] + run.text;
      return;
    }
    const head = next && !next.changed ? FIRST_WORD.exec(next.text) : null;
    if (head) {
      next.text = next.text.slice(head[0].length);
      run.before = head[0];
      run.text += head[0];
    }
  });
  const out = [];
  let pos = 0;
  for (const run of runs) {
    if (!run.changed) {
      pos += run.text.length;
      continue;
    }
    const last = out[out.length - 1];
    // Changes that touch after the growth above are one suggestion
    if (last && last.to === pos) {
      last.to += run.before.length;
      last.before += run.before;
      last.insert += run.text;
    } else {
      out.push({ from: pos, to: pos + run.before.length, before: run.before, insert: run.text });
    }
    pos += run.before.length;
  }
  if (out.some(c => !c.before)) return [];
  // Changes of whitespace only (line breaks moved around) can't be seen when highlighted
  return out.filter(c => c.before.trim() || c.insert.trim());
}

// The model's explanation of a change, matched by the text it changed
function explanationFor(sug, changes) {
  const norm = t => t.trim().toLowerCase();
  const overlaps = (a, b) => {
    a = norm(a);
    b = norm(b);
    return !!a && !!b && (a.includes(b) || b.includes(a));
  };
  const hit = changes.find(c => !c.used && typeof c.explanation === 'string' && c.explanation.trim()
    && (sug.insert.trim() ? overlaps(c.suggestion, sug.insert) : !c.suggestion.trim())
    && (!c.original.trim() || overlaps(c.original, sug.before)));
  if (!hit) return '';
  hit.used = true;
  return hit.explanation.trim();
}

function showChanges(s, changes) {
  s.changesEl.replaceChildren(...changes.map(c => el('li', {},
    el('span', { className: 'cm-ai-del' }, c.original || '—'),
    icon('arrow_forward'),
    el('span', { className: 'cm-ai-ins' }, c.suggestion || '—'),
    typeof c.explanation === 'string' && c.explanation ? el('span', { className: 'cm-ai-why' }, c.explanation) : null)));
  s.changesEl.classList.toggle('hidden', !changes.length);
}

// What the box says once a quick action is done
function quickSummary(quick, original, reply) {
  if (!quick.mode.startsWith('review')) return '';
  if (reply.result === original) return 'Nenhum problema encontrado.';
  const n = reply.changes.length;
  return n === 1 ? '1 correção.' : n ? `${n} correções.` : '';
}

// ════════════════════════════════════
//  REVIEW IN THE TEXT
// ════════════════════════════════════

/**
 * Highlights the changes from original to result in the text, one suggestion each.
 * `onlyIfFew` keeps rewrites (most of the text changed) in the box. Returns false when
 * the result is not shown that way.
 */
function startReview(s, original, result, changes, { onlyIfFew = false } = {}) {
  const range = fieldOf(s.view);
  // The text may have changed while the model was answering
  if (!range || s.view.state.sliceDoc(range.from, range.to) !== original) return false;
  const found = suggestionsFor(original, result);
  if (!found.length) return false;
  if (onlyIfFew && found.reduce((n, c) => n + c.before.length, 0) > original.length * MAX_SUGGESTED_SHARE) return false;
  const items = found.map(c => ({
    ...c,
    id: nextSuggestionId++,
    from: range.from + c.from,
    to: range.from + c.to,
    why: explanationFor(c, changes),
  }));
  s.text = result;
  s.left = items.length;
  setMode(s, 'review');
  s.view.dispatch({ effects: setSuggestionsEffect.of(items) });
  showReviewStatus(s);
  return true;
}

function showReviewStatus(s) {
  const n = s.left;
  s.status.textContent = `${n === 1 ? '1 sugestão destacada' : `${n} sugestões destacadas`} no texto. `
    + 'Clique em um trecho destacado para aceitar, editar ou ignorar.';
}

// Removes the highlighted suggestions (the box stays open)
function endReview(s) {
  if (!s.reviewing) return;
  setMode(s, 'result');
  s.left = 0;
  if (s.view.state.field(suggestField).items.length) s.view.dispatch({ effects: setSuggestionsEffect.of(null) });
}

// Every suggestion was accepted or ignored: the review is over
function finishReview(s) {
  if (session !== s || !s.reviewing || s.view.state.field(suggestField).items.length) return;
  endSession();
  s.view.dispatch({ effects: closeEffect.of(null) });
  s.view.focus();
}

// The selected text as it would be with every pending suggestion accepted
function textWithSuggestions(state, { from, to }) {
  let out = '';
  let pos = from;
  for (const sug of [...state.field(suggestField).items].sort((a, b) => a.from - b.from)) {
    if (sug.from < pos || sug.to > to) continue;
    out += state.sliceDoc(pos, sug.from) + sug.insert;
    pos = sug.to;
  }
  return out + state.sliceDoc(pos, to);
}

// Opens the balloon of the suggestion after the open one (or the first)
function openNextSuggestion(s) {
  const { items, active } = s.view.state.field(suggestField);
  if (!items.length) return;
  const sorted = [...items].sort((a, b) => a.from - b.from);
  const next = sorted[(sorted.findIndex(sug => sug.id === active) + 1) % sorted.length];
  s.view.dispatch({
    selection: { anchor: next.from },
    effects: [activateEffect.of(next.id), EditorView.scrollIntoView(next.from, { y: 'center' })],
  });
}

// ════════════════════════════════════
//  EDITING THE PROPOSAL
// ════════════════════════════════════
function startEditing(s) {
  const range = fieldOf(s.view);
  if (s.running || !range) return;
  // From the review: the text with the suggestions that are still pending
  if (s.reviewing) {
    s.text = textWithSuggestions(s.view.state, range);
    s.original = s.view.state.sliceDoc(range.from, range.to);
    endReview(s);
  }
  setMode(s, 'editing');
  s.editEl.value = s.text;
  s.status.textContent = '';
  s.actions.classList.remove('hidden');
  requestAnimationFrame(() => {
    autosize(s.editEl);
    s.editEl.focus();
  });
}

// Back to the proposal as text (with the edits made)
function stopEditing(s) {
  if (!s.editing) return;
  setMode(s, 'result');
  showResult(s);
  s.editBtn.focus();
}

function showResult(s) {
  s.resultEl.classList.remove('hidden');
  if (s.highlight && s.original) showDiff(s.resultEl, s.original, s.text);
  else s.resultEl.textContent = s.text;
}

// ════════════════════════════════════
//  GENERATING
// ════════════════════════════════════
async function generate(s) {
  const instruction = s.input.value.trim();
  const range = fieldOf(s.view);
  if (!instruction || s.running || !range || session !== s) return;
  endReview(s);
  setMode(s, 'result');
  const original = s.view.state.sliceDoc(range.from, range.to);
  const quick = range.to > range.from ? s.quick : null;
  const busy = quick?.busy || 'Gerando…';
  s.running = true;
  s.text = '';
  s.original = original;
  s.highlight = !!quick?.mode.startsWith('review');
  s.controller = new AbortController();
  s.sendBtn.replaceChildren(icon('stop'));
  s.sendBtn.title = 'Parar';
  s.quickRow?.classList.add('hidden');
  s.chips.classList.add('hidden');
  s.actions.classList.add('hidden');
  s.acceptBtn.classList.remove('hidden');
  s.changesEl.classList.add('hidden');
  s.resultEl.classList.remove('hidden');
  s.resultEl.textContent = '';
  s.status.textContent = busy;
  try {
    const { text } = await streamChat({
      mode: quick ? quick.mode : 'edit',
      messages: [{ role: 'user', content: quick ? original : promptFor(instruction, s.view, range) }],
      signal: s.controller.signal,
      onUpdate: ({ text, thinking }) => {
        s.text = quick ? partialResult(text) : cleanResult(text, original);
        s.resultEl.textContent = s.text;
        if (!text && thinking) s.status.textContent = 'Pensando…';
        else if (text) s.status.textContent = busy;
      },
    });
    if (!quick) {
      // An edit of the selection that changes only a few words is reviewed in the text
      const inText = s.text && original && startReview(s, original, keepEdges(s.text, original), [], { onlyIfFew: true });
      if (!inText) s.status.textContent = s.text ? '' : 'O modelo não devolveu nenhum texto.';
    } else {
      const reply = parseReply(text);
      if (!reply || !reply.result.trim()) {
        s.text = '';
        s.resultEl.classList.add('hidden');
        s.status.textContent = 'O modelo não devolveu uma resposta válida. Tente de novo (Enter).';
      } else {
        s.text = keepEdges(reply.result, original);
        if (!(s.highlight && startReview(s, original, s.text, reply.changes))) {
          showResult(s);
          showChanges(s, reply.changes);
          s.acceptBtn.classList.toggle('hidden', s.text === original);
          s.status.textContent = quickSummary(quick, original, { ...reply, result: s.text });
        }
      }
    }
  } catch (err) {
    s.status.textContent = err.name === 'AbortError' ? 'Interrompido.' : 'Erro: ' + err.message;
  } finally {
    s.running = false;
    s.controller = null;
    s.sendBtn.replaceChildren(icon('arrow_upward'));
    s.sendBtn.title = 'Gerar (Enter)';
    s.actions.classList.toggle('hidden', !s.text);
    if (s.reviewing) s.nextBtn.focus();
    else if (s.text && !s.acceptBtn.classList.contains('hidden')) s.acceptBtn.focus();
  }
}

function accept(s) {
  const range = fieldOf(s.view);
  if (!range) return;
  // Review: every suggestion still pending, in one step (one Ctrl+Z undoes it)
  if (s.reviewing) {
    const changes = s.view.state.field(suggestField).items
      .map(({ from, to, insert }) => ({ from, to, insert }))
      .sort((x, y) => x.from - y.from);
    endSession();
    s.view.dispatch({ changes, effects: closeEffect.of(null), userEvent: 'input.ai', scrollIntoView: true });
    s.view.focus();
    return;
  }
  // An edited proposal may be left empty on purpose (it deletes the selection)
  if (!s.text && !s.editing) return;
  const { text } = s;
  s.view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from, head: range.from + text.length },
    effects: closeEffect.of(null),
    userEvent: 'input.ai',
    scrollIntoView: true,
  });
  endSession();
  s.view.focus();
}

function endSession() {
  session?.controller?.abort();
  session = null;
}

/** Opens the prompt box for the selection (or the cursor). */
export function openInlineAI(view) {
  if (!view.state.facet(EditorView.editable)) return false;
  if (session) closeInlineAI(view);
  const sel = view.state.selection.main;
  const id = nextId++;
  session = createSession(view, id, !sel.empty);
  // Collapse the selection so the struck-through original stays visible
  view.dispatch({
    selection: { anchor: sel.to },
    effects: [openEffect.of({ id, from: sel.from, to: sel.to }), EditorView.scrollIntoView(sel.to, { y: 'nearest' })],
  });
  requestAnimationFrame(() => session?.input.focus());
  return true;
}

export function closeInlineAI(view) {
  const open = fieldOf(view);
  endSession();
  // Discarding gives the original selection back (and drops the suggestions)
  if (open) view.dispatch({ effects: closeEffect.of(null), selection: { anchor: open.from, head: open.to } });
  view.focus();
  return !!open;
}

export const isInlineAIOpen = view => !!fieldOf(view);

// ════════════════════════════════════
//  "Editar com IA" BUTTON ON THE SELECTION
// ════════════════════════════════════
function selectionTip(state) {
  const sel = state.selection.main;
  if (sel.empty || state.field(inlineField)) return null;
  return {
    pos: sel.head,
    above: sel.head === sel.from,
    arrow: false,
    create: view => ({
      dom: el('button', {
        className: 'cm-ai-tip',
        title: 'Editar o trecho selecionado com IA (Ctrl+J)',
        onmousedown: e => {
          e.preventDefault();
          openInlineAI(view);
        },
      }, icon('auto_awesome'), 'Editar com IA', el('span', { className: 'kbd' }, 'Ctrl+J')),
    }),
  };
}

const tipField = StateField.define({
  create: selectionTip,
  update: (tip, tr) => (tr.docChanged || tr.selection || tr.effects.length ? selectionTip(tr.state) : tip),
  provide: field => showTooltip.from(field),
});

// Sessions belong to one editor state; switching files or projects drops them
export function dropInlineAI() {
  endSession();
}

// Esc closes the open balloon first, then the prompt box
function escape(view) {
  if (view.state.field(suggestField).active != null) {
    view.dispatch({ effects: activateEffect.of(null) });
    return true;
  }
  return fieldOf(view) ? closeInlineAI(view) : false;
}

export function inlineAI() {
  return [
    inlineField,
    suggestField,
    aiDecorations,
    balloonTooltip,
    suggestionClicks,
    reviewWatcher,
    tipField,
    Prec.highest(keymap.of([
      { key: 'Mod-j', run: openInlineAI },
      { key: 'Escape', run: escape },
    ])),
  ];
}
