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
