// Per-browser preferences (theme, layout, font size). Storage can be unavailable,
// so every access is guarded and defaults always apply.
const PREFIX = 'latex.';

export function getPref(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function setPref(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch {}
}

// ─── Theme ───
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function getTheme() {
  // Stored as a bare string by the inline script in index.html
  try { return localStorage.getItem(PREFIX + 'theme') || 'system'; } catch { return 'system'; }
}

export function setTheme(theme) {
  try { localStorage.setItem(PREFIX + 'theme', theme); } catch {}
  applyTheme();
}

export function applyTheme() {
  const t = getTheme();
  const dark = t === 'dark' || (t === 'system' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

darkQuery.addEventListener('change', applyTheme);

// ─── Editor font size ───
export const FONT_SIZES = [11, 12, 13, 14, 16, 18, 20];

export function applyFontSize(size = getPref('fontSize', 13)) {
  document.documentElement.style.setProperty('--editor-font-size', size + 'px');
}

// ─── Editor appearance (color theme, font, line spacing) ───
export const EDITOR_THEMES = [
  ['default', 'Padrão (segue a interface)'],
  ['solarized-light', 'Solarized claro'],
  ['solarized-dark', 'Solarized escuro'],
  ['monokai', 'Monokai'],
  ['dracula', 'Dracula'],
  ['high-contrast', 'Alto contraste'],
];
export const EDITOR_FONTS = [
  ['jetbrains', 'JetBrains Mono', "'JetBrains Mono', ui-monospace, monospace"],
  ['system', 'Monoespaçada do sistema', "ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace"],
  ['courier', 'Courier', "'Courier New', Courier, monospace"],
];
export const LINE_HEIGHTS = [['compact', 'Compacto', 1.4], ['normal', 'Normal', 1.6], ['wide', 'Largo', 1.9]];

export function applyEditorAppearance() {
  const root = document.documentElement;
  root.dataset.editorTheme = getPref('editorTheme', 'default');
  const font = EDITOR_FONTS.find(f => f[0] === getPref('editorFont', 'jetbrains')) || EDITOR_FONTS[0];
  root.style.setProperty('--editor-font', font[2]);
  const lh = LINE_HEIGHTS.find(l => l[0] === getPref('lineHeight', 'normal')) || LINE_HEIGHTS[1];
  root.style.setProperty('--editor-line-height', lh[2]);
}
