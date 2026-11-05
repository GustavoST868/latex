import { el, icon, FILE_ICONS } from './util.js';

const DRAG_TYPE = 'application/x-latex-path';

// Folders first, then files, alphabetically
function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if ((a.type === 'folder') !== (b.type === 'folder')) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export const parentOf = path => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/**
 * Renders the project tree.
 * state: { activePath, mainFile, expanded:Set }
 */
export function renderFileTree(container, files, state) {
  const nodes = renderLevel(files, 0, state);
  container.replaceChildren(...nodes, el('div', { className: 'file-list-tail' }));
}

function renderLevel(entries, depth, state) {
  const nodes = [];
  for (const f of sortEntries(entries)) {
    const isFolder = f.type === 'folder';
    const isOpen = isFolder && state.expanded.has(f.path);
    const isMain = f.path === state.mainFile;

    const item = el('div', {
      className: 'file-item' + (f.path === state.activePath ? ' active' : '') + (isMain ? ' main' : ''),
      title: f.path,
      draggable: 'true',
      'data-path': f.path,
      'data-folder': isFolder ? 'true' : null,
    },
      el('span', { className: 'file-chevron' + (isOpen ? ' open' : '') }, isFolder ? icon('chevron_right') : null),
      icon(isFolder && isOpen ? 'folder_open' : FILE_ICONS[f.type] || FILE_ICONS.binary),
      el('span', { className: 'file-label' }, f.name),
      el('div', { className: 'file-item-actions' },
        isMain ? el('span', { className: 'main-star', title: 'Documento principal' }, icon('star', 'filled')) : null,
        el('button', { className: 'icon-btn btn-file-menu', title: 'Mais opções', 'data-action': 'menu' }, icon('more_vert'))),
    );
    item.style.paddingLeft = `${4 + depth * 14}px`;
    nodes.push(item);

    if (isOpen) nodes.push(...renderLevel(f.children || [], depth + 1, state));
  }
  return nodes;
}

/**
 * Wires clicks, context menus and drag & drop once (the tree is re-rendered often).
 * handlers: { getEntry(path), onOpen(entry), onToggle(path), onMenu(entry|null, {x, y}),
 *             onMove(entry, folder), onDropFiles(files, folder) }
 */
export function initFileTree(container, handlers) {
  const itemOf = target => target.closest?.('.file-item');
  const entryOf = item => item && handlers.getEntry(item.dataset.path);

  container.addEventListener('click', e => {
    const item = itemOf(e.target);
    const entry = entryOf(item);
    if (!entry) return;
    if (e.target.closest('[data-action="menu"]')) {
      e.stopPropagation();
      const r = e.target.closest('button').getBoundingClientRect();
      handlers.onMenu(entry, { x: r.left, y: r.bottom + 2 });
      return;
    }
    entry.type === 'folder' ? handlers.onToggle(entry.path) : handlers.onOpen(entry);
  });

  container.addEventListener('contextmenu', e => {
    e.preventDefault();
    handlers.onMenu(entryOf(itemOf(e.target)), { x: e.clientX, y: e.clientY });
  });

  // ── Drag & drop: move entries between folders, or upload files from the computer ──
  let dragPath = null;
  let highlighted = null;

  // The folder a drop lands in: the folder under the pointer, a file's folder, or the root
  const folderAt = target => {
    const item = itemOf(target);
    if (!item) return { folder: '', node: container };
    if (item.dataset.folder) return { folder: item.dataset.path, node: item };
    const folder = parentOf(item.dataset.path);
    return { folder, node: folder ? container.querySelector(`.file-item[data-path="${CSS.escape(folder)}"]`) || container : container };
  };

  const highlight = node => {
    if (highlighted === node) return;
    highlighted?.classList.remove('drop-target');
    highlighted = node;
    node?.classList.add('drop-target');
  };

  container.addEventListener('dragstart', e => {
    const item = itemOf(e.target);
    if (!item) return;
    dragPath = item.dataset.path;
    e.dataTransfer.setData(DRAG_TYPE, dragPath);
    e.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragend', () => { dragPath = null; highlight(null); });

  container.addEventListener('dragover', e => {
    const types = [...e.dataTransfer.types];
    const external = types.includes('Files');
    if (!external && !types.includes(DRAG_TYPE)) return;
    const { folder, node } = folderAt(e.target);
    // A folder can't go inside itself
    if (!external && dragPath && (folder === dragPath || folder.startsWith(dragPath + '/'))) {
      highlight(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = external ? 'copy' : 'move';
    highlight(node);
  });
  container.addEventListener('dragleave', e => {
    if (!container.contains(e.relatedTarget)) highlight(null);
  });

  container.addEventListener('drop', e => {
    e.preventDefault();
    highlight(null);
    const { folder } = folderAt(e.target);
    if (e.dataTransfer.files.length) {
      handlers.onDropFiles([...e.dataTransfer.files], folder);
      return;
    }
    const entry = handlers.getEntry(e.dataTransfer.getData(DRAG_TYPE));
    if (entry && parentOf(entry.path) !== folder) handlers.onMove(entry, folder);
  });
}

// Depth-first search for an entry by path
export function findEntry(entries, path) {
  for (const f of entries) {
    if (f.path === path) return f;
    if (f.children) {
      const hit = findEntry(f.children, path);
      if (hit) return hit;
    }
  }
  return null;
}

// First text file in the tree (fallback when there's no main document)
export function firstTextFile(entries) {
  const sorted = sortEntries(entries);
  const here = sorted.find(f => f.type === 'text');
  if (here) return here;
  for (const f of sorted) {
    const hit = f.children && firstTextFile(f.children);
    if (hit) return hit;
  }
  return null;
}
