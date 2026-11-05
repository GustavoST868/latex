import { $, el, icon } from './util.js';

const pop = $('menu-popover');
let current = null; // { anchor, onClose }

/**
 * Opens a dropdown under `anchor`.
 * items: { label, icon, shortcut, action, disabled, checked, danger } | '-' | { heading }
 * `at: {x, y}` places it at a point instead (context menus).
 */
export function openMenu(anchor, items, { align = 'left', placement = 'below', at = null, onClose = null } = {}) {
  closeMenu();
  const hasChecks = items.some(i => i && i.checked !== undefined);

  pop.replaceChildren(...items.map(item => {
    if (item === '-') return el('div', { className: 'menu-sep' });
    if (item.heading) return el('div', { className: 'menu-heading' }, item.heading);
    return el('button', {
      className: 'menu-item' + (item.checked ? ' checked' : '') + (item.danger ? ' danger' : ''),
      role: 'menuitem',
      disabled: !!item.disabled,
      onclick: () => { closeMenu(); item.action(); },
    },
      hasChecks ? icon('check', 'check') : null,
      item.icon && !hasChecks ? icon(item.icon) : null,
      el('span', { className: 'menu-label' }, item.label),
      item.shortcut ? el('span', { className: 'menu-shortcut' }, item.shortcut) : null,
    );
  }));

  pop.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let left, top;
  if (at) {
    // Context menus open at the mouse pointer
    left = at.x;
    top = at.y;
  } else if (placement === 'right') {
    left = r.right + 4;
    top = r.top;
  } else {
    left = align === 'right' ? r.right - w : r.left;
    top = r.bottom + 4;
  }
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';

  anchor.classList.add('open');
  current = { anchor, onClose };
}

export function closeMenu() {
  if (!current) return;
  pop.classList.add('hidden');
  current.anchor.classList.remove('open');
  const cb = current.onClose;
  current = null;
  if (cb) cb();
}

export const isMenuOpenFor = anchor => current?.anchor === anchor;
export const isAnyMenuOpen = () => current !== null;

document.addEventListener('mousedown', e => {
  if (current && !pop.contains(e.target) && !current.anchor.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('resize', closeMenu);
window.addEventListener('blur', closeMenu);

/**
 * Desktop-style menubar: click opens, hovering another entry while open switches.
 * menus: [{ label, items: () => items }]
 */
export function buildMenubar(container, menus) {
  container.replaceChildren(...menus.map(m => {
    const btn = el('button', { className: 'menubar-item' }, m.label);
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      if (isMenuOpenFor(btn)) closeMenu();
      else openMenu(btn, m.items());
    });
    btn.addEventListener('mouseenter', () => {
      if (isAnyMenuOpen() && !isMenuOpenFor(btn) && container.contains(current.anchor)) openMenu(btn, m.items());
    });
    return btn;
  }));
}

// Button that toggles a dropdown
export function bindDropdown(button, items, opts) {
  button.addEventListener('mousedown', e => {
    e.preventDefault();
    if (isMenuOpenFor(button)) closeMenu();
    else openMenu(button, items(), opts);
  });
}
