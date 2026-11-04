import { el, icon, FILE_ICONS } from './util.js';

// Folders first, then files, alphabetically
function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if ((a.type === 'folder') !== (b.type === 'folder')) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Renders the project tree.
 * opts: { activePath, mainFile, expanded:Set, onOpen(entry), onToggle(path),
 *         onDelete(entry), onSetMain(entry) }
 */
export function renderFileTree(container, files, opts) {
  container.replaceChildren(...renderLevel(files, 0, opts));
}

function renderLevel(entries, depth, opts) {
  const nodes = [];
  for (const f of sortEntries(entries)) {
    const isFolder = f.type === 'folder';
    const isOpen = isFolder && opts.expanded.has(f.path);
    const isMain = f.path === opts.mainFile;

    const actions = el('div', { className: 'file-item-actions' });
    if (f.name.endsWith('.tex')) {
      actions.append(el('button', {
        className: 'icon-btn btn-file-main' + (isMain ? ' is-main' : ''),
        title: isMain ? 'Documento principal' : 'Definir como documento principal',
        onclick: e => { e.stopPropagation(); if (!isMain) opts.onSetMain(f); },
      }, icon('star')));
    }
    actions.append(el('button', {
      className: 'icon-btn btn-file-delete',
      title: isFolder ? 'Excluir pasta' : 'Excluir arquivo',
      onclick: e => { e.stopPropagation(); opts.onDelete(f); },
    }, icon('delete')));

    const item = el('div', {
      className: 'file-item' + (f.path === opts.activePath ? ' active' : '') + (isMain ? ' main' : ''),
      title: f.path,
      onclick: () => (isFolder ? opts.onToggle(f.path) : opts.onOpen(f)),
    },
      el('span', { className: 'file-chevron' + (isOpen ? ' open' : '') }, isFolder ? icon('chevron_right') : null),
      icon(isFolder && isOpen ? 'folder_open' : FILE_ICONS[f.type] || FILE_ICONS.binary),
      el('span', { className: 'file-label' }, f.name),
      actions,
    );
    item.style.paddingLeft = `${8 + depth * 14}px`;
    nodes.push(item);

    if (isOpen) nodes.push(...renderLevel(f.children || [], depth + 1, opts));
  }
  return nodes;
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
