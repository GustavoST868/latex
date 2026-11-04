export const $ = id => document.getElementById(id);

// Creates an element; text children are inserted as text nodes (never parsed as HTML)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === 'className') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(child) : child);
  }
  return node;
}

// Material Symbols icon by ligature name
export const icon = (name, className = '') => el('span', { className: `ms ${className}`.trim(), 'aria-hidden': 'true' }, name);

export const FILE_ICONS = {
  text: 'description',
  pdf: 'picture_as_pdf',
  image: 'image',
  binary: 'draft',
  folder: 'folder',
};

export function toast(msg, type = 'ok') {
  const t = el('div', { className: `toast ${type}` }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

export function showView(view) {
  $('home-screen').classList.toggle('hidden', view !== 'home');
  $('editor-screen').classList.toggle('hidden', view !== 'editor');
}

// Triggers a browser download of a URL
export function download(url, filename = '') {
  el('a', { href: url, download: filename }).click();
}

// ════════════════════════════════════
//  MODAL
// ════════════════════════════════════
const backdrop = $('modal-backdrop');
let onModalClose = null;

export function openModal({ title, body, footer = [], onClose = null }) {
  $('modal-title').textContent = title;
  $('modal-body').replaceChildren(...[].concat(body));
  $('modal-footer').replaceChildren(...footer);
  onModalClose = onClose;
  backdrop.classList.remove('hidden');
  const focusable = backdrop.querySelector('input, select, .btn-primary');
  if (focusable) focusable.focus();
}

export function closeModal() {
  if (backdrop.classList.contains('hidden')) return;
  backdrop.classList.add('hidden');
  const cb = onModalClose;
  onModalClose = null;
  if (cb) cb();
}

$('modal-close').onclick = closeModal;
backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !backdrop.classList.contains('hidden')) closeModal();
});

// Text prompt in a modal; resolves to the value, or null when cancelled
export function promptModal({ title, label, value = '', confirmLabel = 'OK' }) {
  return new Promise(resolve => {
    let result = null;
    const input = el('input', { type: 'text', value });
    const submit = () => { result = input.value.trim(); closeModal(); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    openModal({
      title,
      body: [el('label', { className: 'form-section' }, label), input],
      footer: [
        el('button', { className: 'btn btn-ghost', onclick: closeModal }, 'Cancelar'),
        el('button', { className: 'btn btn-primary', onclick: submit }, confirmLabel),
      ],
      onClose: () => resolve(result || null),
    });
    input.select();
  });
}
