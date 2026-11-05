import { el, icon, FILE_ICONS } from './util.js';
import { S } from './state.js';

// Command palette (Ctrl+K): runs any menu command or opens a file by name
let overlay = null;
let getCommands = () => [];

// Lowercase without accents, so "secao" finds "Seção"
const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function matches(item, words) {
  const text = fold(`${item.group} ${item.label}`);
  return words.every(w => text.includes(w));
}

export function openPalette() {
  if (overlay) return;
  const commands = getCommands();
  const input = el('input', { type: 'text', className: 'palette-input', placeholder: 'Digite um comando ou o nome de um arquivo…', 'aria-label': 'Comando' });
  const list = el('div', { className: 'palette-list', role: 'listbox' });
  let shown = [];
  let index = 0;

  const close = () => {
    overlay?.remove();
    overlay = null;
  };
  const run = item => {
    close();
    item?.action();
  };
  const render = () => {
    const words = fold(input.value).split(/\s+/).filter(Boolean);
    shown = commands.filter(c => !c.disabled && matches(c, words)).slice(0, 60);
    index = Math.min(index, Math.max(0, shown.length - 1));
    list.replaceChildren(...(shown.length ? shown.map((c, i) => el('div', {
      className: 'palette-item' + (i === index ? ' active' : ''),
      role: 'option',
      onmousedown: e => { e.preventDefault(); run(c); },
      onmousemove: () => { if (index !== i) { index = i; render(); } },
    },
      icon(c.icon || 'chevron_right'),
      el('span', { className: 'palette-group' }, c.group),
      el('span', { className: 'palette-label' }, c.label),
      c.shortcut ? el('span', { className: 'kbd' }, c.shortcut) : null,
    )) : [el('div', { className: 'palette-empty' }, 'Nada encontrado')]));
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', () => { index = 0; render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); index = Math.min(index + 1, shown.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(index - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(shown[index]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });

  overlay = el('div', { className: 'palette-backdrop', onmousedown: e => { if (e.target === overlay) close(); } },
    el('div', { className: 'palette', role: 'dialog', 'aria-label': 'Paleta de comandos' }, input, list));
  document.body.append(overlay);
  render();
  input.focus();
}

// Files of the open project as palette entries
export function fileCommands(openFile) {
  const out = [];
  (function walk(entries) {
    for (const f of entries) {
      if (f.type === 'folder') walk(f.children || []);
      else out.push({ group: 'Abrir arquivo', label: f.path, icon: FILE_ICONS[f.type] || FILE_ICONS.binary, action: () => openFile(f) });
    }
  })(S.files || []);
  return out;
}

export function initPalette(commands) {
  getCommands = commands;
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && S.project) {
      e.preventDefault();
      e.stopPropagation();
      openPalette();
    }
  }, true);
}
