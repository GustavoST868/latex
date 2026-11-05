import { $, el, icon, toast, download, openModal, closeModal, promptModal, confirmModal } from './util.js';
import { api, json, projectUrl } from './api.js';
import { getPref, setPref, getTheme, setTheme } from './prefs.js';
import { openMenu } from './menu.js';
import { loadProject } from './project.js';

// ════════════════════════════════════
//  STATE
// ════════════════════════════════════
const D = {
  projects: [],
  templates: [],
  filter: 'all',          // all | archived | trashed | tag
  tag: null,
  query: '',
  sort: getPref('dash.sort', { key: 'mtime', dir: 'desc' }),
  selected: new Set(),
  loaded: false,
};

const FILTERS = [
  { id: 'all', label: 'Todos os projetos', icon: 'folder' },
  { id: 'archived', label: 'Arquivados', icon: 'inventory_2' },
  { id: 'trashed', label: 'Lixeira', icon: 'delete' },
];

const rows = $('project-rows');
const empty = $('dash-empty');

// ════════════════════════════════════
//  HELPERS
// ════════════════════════════════════
const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
function relativeTime(date) {
  const secs = (new Date(date) - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  }
  return 'agora mesmo';
}

// Stable color per tag name
export function tagColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)) % 360;
  return `hsl(${h} 55% 45%)`;
}

const tagChip = name => el('span', { className: 'tag-chip', style: `--tag:${tagColor(name)}` }, name);

// Tags in use plus empty tags created by the user
function allTags() {
  const tags = new Set(getPref('dash.extraTags', []));
  D.projects.forEach(p => p.tags.forEach(t => tags.add(t)));
  return [...tags].sort((a, b) => a.localeCompare(b));
}

function visibleProjects() {
  const q = D.query.toLowerCase();
  const list = D.projects.filter(p => {
    if (D.filter === 'trashed') { if (!p.trashed) return false; }
    else if (p.trashed) return false;
    else if (D.filter === 'archived') { if (!p.archived) return false; }
    else if (D.filter === 'tag') { if (!p.tags.includes(D.tag)) return false; }
    else if (p.archived) return false;
    return !q || p.name.toLowerCase().includes(q) || p.tags.some(t => t.toLowerCase().includes(q));
  });
  const { key, dir } = D.sort;
  list.sort((a, b) => {
    const r = key === 'name' ? a.name.localeCompare(b.name, 'pt-BR') : new Date(a.mtime) - new Date(b.mtime);
    return dir === 'asc' ? r : -r;
  });
  return list;
}

const byName = name => D.projects.find(p => p.name === name);

async function patchProject(name, patch) {
  await api(`${projectUrl(name)}/settings`, json('PATCH', patch));
  Object.assign(byName(name) || {}, patch, patch.archived ? { trashed: false } : {}, patch.trashed ? { archived: false } : {});
}

// Runs an action on several projects, then refreshes the list
async function forEachProject(names, fn, doneMsg) {
  try {
    for (const name of names) await fn(name);
    if (doneMsg) toast(doneMsg);
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
  D.selected.clear();
  await refreshHomeProjects();
}

// ════════════════════════════════════
//  RENDER
// ════════════════════════════════════
function renderSidebar() {
  const count = id => D.projects.filter(p => (id === 'trashed' ? p.trashed : id === 'archived' ? p.archived : !p.archived && !p.trashed)).length;
  $('dash-filters').replaceChildren(...FILTERS.map(f => el('button', {
    className: 'dash-filter' + (D.filter === f.id ? ' active' : ''),
    onclick: () => setFilter(f.id),
  }, icon(f.icon), el('span', { className: 'grow' }, f.label), el('span', { className: 'count' }, count(f.id)))));

  $('dash-tags').replaceChildren(...allTags().map(tag => {
    const n = D.projects.filter(p => !p.trashed && p.tags.includes(tag)).length;
    return el('div', {
      className: 'dash-filter dash-tag' + (D.filter === 'tag' && D.tag === tag ? ' active' : ''),
      onclick: () => setFilter('tag', tag),
    },
      el('span', { className: 'tag-dot', style: `background:${tagColor(tag)}` }),
      el('span', { className: 'grow' }, tag),
      el('span', { className: 'count' }, n),
      el('button', {
        className: 'icon-btn tag-menu', title: 'Opções da tag',
        onclick: e => { e.stopPropagation(); openMenu(e.currentTarget, tagMenu(tag)); },
      }, icon('more_vert')));
  }));
}

function renderTitle() {
  const f = FILTERS.find(x => x.id === D.filter);
  $('dash-title').replaceChildren(D.filter === 'tag' ? tagChip(D.tag) : f.label);
  document.querySelectorAll('.sort-btn').forEach(btn => {
    const active = btn.dataset.sort === D.sort.key;
    btn.classList.toggle('active', active);
    btn.querySelector('.ms').textContent = active ? (D.sort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : '';
  });
}

function rowActions(p) {
  const btn = (label, iconName, action, opts = {}) => el('button', {
    className: 'icon-btn' + (opts.danger ? ' btn-delete' : ''),
    title: label,
    'aria-label': label,
    disabled: !!opts.disabled,
    onclick: e => { e.stopPropagation(); action(); },
  }, icon(iconName));

  if (p.trashed) {
    return [
      btn('Restaurar', 'restore_from_trash', () => forEachProject([p.name], n => patchProject(n, { trashed: false }), 'Projeto restaurado')),
      btn('Excluir para sempre', 'delete_forever', () => deleteForever([p.name]), { danger: true }),
    ];
  }
  return [
    btn('Fazer uma cópia', 'content_copy', () => copyProject(p.name)),
    btn('Baixar código-fonte (.zip)', 'folder_zip', () => download(`${projectUrl(p.name)}/download.zip`)),
    btn('Baixar PDF', 'picture_as_pdf', () => download(`${projectUrl(p.name)}/output/${encodeURIComponent(p.pdfFile)}`, p.pdfFile), { disabled: !p.pdfFile }),
    p.archived
      ? btn('Desarquivar', 'unarchive', () => forEachProject([p.name], n => patchProject(n, { archived: false }), 'Projeto desarquivado'))
      : btn('Arquivar', 'archive', () => forEachProject([p.name], n => patchProject(n, { archived: true }), 'Projeto arquivado')),
    btn('Mover para a lixeira', 'delete', () => forEachProject([p.name], n => patchProject(n, { trashed: true }), 'Projeto movido para a lixeira'), { danger: true }),
  ];
}

function renderRows() {
  const list = visibleProjects();
  // Forget selections that are no longer visible
  const visible = new Set(list.map(p => p.name));
  D.selected.forEach(n => { if (!visible.has(n)) D.selected.delete(n); });

  rows.replaceChildren(...list.map(p => {
    const date = new Date(p.mtime);
    const checkbox = el('input', {
      type: 'checkbox',
      'aria-label': `Selecionar ${p.name}`,
      checked: D.selected.has(p.name),
      onclick: e => e.stopPropagation(),
      onchange: e => { e.target.checked ? D.selected.add(p.name) : D.selected.delete(p.name); renderBulk(); },
    });
    return el('tr', { className: D.selected.has(p.name) ? 'selected' : '', onclick: () => !p.trashed && loadProject(p.name) },
      el('td', { className: 'col-check' }, checkbox),
      el('td', { className: 'col-title' },
        el('span', { className: 'project-link' }, p.name),
        p.git ? el('span', { className: 'git-badge', title: 'Repositório Git' }, icon('commit')) : null,
        ...p.tags.map(tagChip)),
      el('td', { className: 'col-date', title: date.toLocaleString('pt-BR') }, relativeTime(date)),
      el('td', { className: 'col-actions' }, el('div', { className: 'row-actions' }, rowActions(p))),
    );
  }));

  const msg = !D.loaded ? 'Carregando seus projetos…'
    : D.projects.length === 0 ? 'Você ainda não tem projetos. Clique em "Novo projeto" para começar.'
    : list.length === 0 ? (D.query ? 'Nenhum projeto corresponde à busca.' : 'Nenhum projeto aqui.')
    : '';
  empty.textContent = msg;
  empty.classList.toggle('hidden', !msg);
  renderBulk();
}

function renderBulk() {
  const bulk = $('dash-bulk');
  const names = [...D.selected];
  const visibleCount = rows.children.length;
  const all = $('dash-select-all');
  all.checked = names.length > 0 && names.length === visibleCount;
  all.indeterminate = names.length > 0 && names.length < visibleCount;
  rows.querySelectorAll('tr').forEach((tr, i) => tr.classList.toggle('selected', tr.querySelector('input').checked));
  bulk.classList.toggle('hidden', !names.length);
  if (!names.length) return bulk.replaceChildren();

  const b = (label, iconName, action, danger) => el('button', { className: 'btn btn-ghost' + (danger ? ' btn-ghost-danger' : ''), onclick: action }, icon(iconName), label);
  const items = [el('span', { className: 'bulk-count' }, `${names.length} selecionado(s)`)];
  if (D.filter === 'trashed') {
    items.push(
      b('Restaurar', 'restore_from_trash', () => forEachProject(names, n => patchProject(n, { trashed: false }), 'Projetos restaurados')),
      b('Excluir para sempre', 'delete_forever', () => deleteForever(names), true),
    );
  } else {
    const tagsBtn = b('Tags', 'sell', () => openMenu(tagsBtn, bulkTagMenu(names)));
    items.push(
      tagsBtn,
      D.filter === 'archived'
        ? b('Desarquivar', 'unarchive', () => forEachProject(names, n => patchProject(n, { archived: false }), 'Projetos desarquivados'))
        : b('Arquivar', 'archive', () => forEachProject(names, n => patchProject(n, { archived: true }), 'Projetos arquivados')),
      b('Lixeira', 'delete', () => forEachProject(names, n => patchProject(n, { trashed: true }), 'Projetos movidos para a lixeira'), true),
    );
  }
  bulk.replaceChildren(...items);
}

function render() {
  renderSidebar();
  renderTitle();
  renderRows();
}

function setFilter(filter, tag = null) {
  D.filter = filter;
  D.tag = tag;
  D.selected.clear();
  render();
}

export async function refreshHomeProjects() {
  try {
    D.projects = await api('/api/projects');
    D.loaded = true;
    if (D.filter === 'tag' && !allTags().includes(D.tag)) D.filter = 'all';
  } catch (err) {
    toast('Erro ao listar projetos: ' + err.message, 'err');
  }
  render();
}

// ════════════════════════════════════
//  TAGS
// ════════════════════════════════════
function setExtraTags(fn) {
  setPref('dash.extraTags', fn(getPref('dash.extraTags', [])));
}

async function setTags(name, tags) {
  await patchProject(name, { tags });
}

function bulkTagMenu(names) {
  const projects = names.map(byName).filter(Boolean);
  return [
    ...allTags().map(tag => {
      const all = projects.every(p => p.tags.includes(tag));
      return {
        label: tag,
        checked: all,
        action: () => forEachProject(names, n => {
          const p = byName(n);
          return setTags(n, all ? p.tags.filter(t => t !== tag) : [...new Set([...p.tags, tag])]);
        }),
      };
    }),
    '-',
    { label: 'Nova tag…', checked: false, action: () => createTag(names) },
  ];
}

function tagMenu(tag) {
  return [
    { label: 'Renomear', icon: 'edit', action: () => renameTag(tag) },
    { label: 'Excluir tag', icon: 'delete', danger: true, action: () => deleteTag(tag) },
  ];
}

async function createTag(names = []) {
  const tag = await promptModal({ title: 'Nova tag', label: 'Nome da tag', confirmLabel: 'Criar' });
  if (!tag) return;
  if (!names.length) {
    setExtraTags(tags => [...new Set([...tags, tag])]);
    return render();
  }
  await forEachProject(names, n => setTags(n, [...new Set([...byName(n).tags, tag])]), `Tag "${tag}" adicionada`);
}

async function renameTag(tag) {
  const name = await promptModal({ title: 'Renomear tag', label: 'Novo nome', value: tag, confirmLabel: 'Renomear' });
  if (!name || name === tag) return;
  setExtraTags(tags => tags.map(t => (t === tag ? name : t)));
  if (D.tag === tag) D.tag = name;
  const users = D.projects.filter(p => p.tags.includes(tag)).map(p => p.name);
  await forEachProject(users, n => setTags(n, [...new Set(byName(n).tags.map(t => (t === tag ? name : t)))]));
}

async function deleteTag(tag) {
  if (!(await confirmModal({ title: 'Excluir tag', message: `Excluir a tag "${tag}"? Os projetos não serão excluídos.`, confirmLabel: 'Excluir', danger: true }))) return;
  setExtraTags(tags => tags.filter(t => t !== tag));
  if (D.tag === tag) D.filter = 'all';
  const users = D.projects.filter(p => p.tags.includes(tag)).map(p => p.name);
  await forEachProject(users, n => setTags(n, byName(n).tags.filter(t => t !== tag)));
}

// ════════════════════════════════════
//  PROJECT ACTIONS
// ════════════════════════════════════
async function deleteForever(names) {
  const what = names.length === 1 ? `o projeto "${names[0]}"` : `${names.length} projetos`;
  if (!(await confirmModal({
    title: 'Excluir para sempre',
    message: `Excluir ${what} permanentemente? Os arquivos e o histórico serão apagados e isso não pode ser desfeito.`,
    confirmLabel: 'Excluir para sempre',
    danger: true,
  }))) return;
  await forEachProject(names, n => api(projectUrl(n), { method: 'DELETE' }), 'Excluído');
}

async function copyProject(name) {
  const newName = await promptModal({ title: 'Fazer uma cópia', label: 'Nome da cópia', value: `Cópia de ${name}`, confirmLabel: 'Copiar' });
  if (!newName) return;
  try {
    await api(`${projectUrl(name)}/copy`, json('POST', { newName }));
    toast('Cópia criada');
    await refreshHomeProjects();
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

async function createFromTemplate(template) {
  const name = await promptModal({ title: template.title, label: 'Nome do projeto', confirmLabel: 'Criar' });
  if (!name) return;
  try {
    await api('/api/projects', json('POST', { name, template: template.id }));
    toast('Projeto criado');
    await loadProject(name);
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

function openTemplateGallery() {
  const cards = D.templates.map(t => el('button', {
    className: 'template-card',
    onclick: () => { closeModal(); createFromTemplate(t); },
  }, icon(t.icon || 'description'), el('strong', {}, t.title), el('span', {}, t.description)));
  openModal({ title: 'Modelos', body: el('div', { className: 'template-grid' }, cards), wide: true });
}

async function importZip(file) {
  const name = await promptModal({ title: 'Enviar projeto', label: 'Nome do projeto', value: file.name.replace(/\.zip$/i, ''), confirmLabel: 'Criar' });
  if (!name) return;
  const form = new FormData();
  form.append('name', name);
  form.append('file', file);
  try {
    toast('Enviando…');
    await api('/api/projects/import-zip', { method: 'POST', body: form });
    toast('Projeto importado');
    await loadProject(name);
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

function importGit() {
  const url = el('input', { type: 'text', placeholder: 'https://github.com/usuario/repositorio.git' });
  const name = el('input', { type: 'text', placeholder: 'Opcional: usa o nome do repositório' });
  const submit = async () => {
    if (!url.value.trim()) return url.focus();
    closeModal();
    toast('Clonando o repositório…');
    try {
      const res = await api('/api/projects/import-git', json('POST', { url: url.value.trim(), name: name.value.trim() || undefined }));
      toast('Repositório clonado');
      await loadProject(res.name);
    } catch (err) {
      toast('Erro: ' + err.message, 'err');
    }
  };
  [url, name].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
  openModal({
    title: 'Importar de repositório Git',
    body: [
      el('label', { className: 'form-section' }, 'Endereço do repositório'), url,
      el('label', { className: 'form-section' }, 'Nome do projeto'), name,
      el('p', { className: 'hint-text' }, 'Repositórios privados usam as credenciais do Git deste computador (chave SSH ou gerenciador de credenciais).'),
    ],
    footer: [
      el('button', { className: 'btn btn-ghost', onclick: closeModal }, 'Cancelar'),
      el('button', { className: 'btn btn-primary', onclick: submit }, 'Clonar'),
    ],
  });
}

function newProjectMenu() {
  const byId = id => D.templates.find(t => t.id === id);
  const quick = ['blank', 'example'].map(byId).filter(Boolean);
  const others = D.templates.filter(t => !quick.includes(t));
  return [
    ...quick.map(t => ({ label: t.title, icon: t.icon, action: () => createFromTemplate(t) })),
    '-',
    { heading: 'Modelos' },
    ...others.map(t => ({ label: t.title, icon: t.icon, action: () => createFromTemplate(t) })),
    { label: 'Ver todos os modelos…', icon: 'grid_view', action: openTemplateGallery },
    '-',
    { label: 'Enviar projeto (.zip)', icon: 'upload_file', action: () => $('zip-upload-input').click() },
    { label: 'Importar de repositório Git', icon: 'commit', action: importGit },
  ];
}

// ════════════════════════════════════
//  INIT
// ════════════════════════════════════
export function initHome() {
  api('/api/templates').then(t => { D.templates = t; }).catch(() => {});

  const newBtn = $('btn-new-project');
  newBtn.addEventListener('mousedown', e => { e.preventDefault(); openMenu(newBtn, newProjectMenu()); });
  $('btn-new-tag').onclick = () => createTag([...D.selected]);
  $('zip-upload-input').onchange = e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importZip(file);
  };

  $('dash-search').addEventListener('input', e => { D.query = e.target.value.trim(); renderRows(); });
  $('dash-select-all').onchange = e => {
    rows.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = e.target.checked; });
    D.selected = new Set(e.target.checked ? visibleProjects().map(p => p.name) : []);
    renderBulk();
  };
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.onclick = () => {
      const key = btn.dataset.sort;
      // Same column flips the order; a new column starts A→Z / newest first
      const dir = D.sort.key === key
        ? (D.sort.dir === 'asc' ? 'desc' : 'asc')
        : (key === 'name' ? 'asc' : 'desc');
      D.sort = { key, dir };
      setPref('dash.sort', D.sort);
      render();
    };
  });

  const themeBtn = $('dash-theme');
  themeBtn.addEventListener('mousedown', e => {
    e.preventDefault();
    openMenu(themeBtn, [['system', 'Igual ao sistema'], ['light', 'Claro'], ['dark', 'Escuro']].map(([id, label]) => ({
      label, checked: getTheme() === id, action: () => setTheme(id),
    })), { align: 'right' });
  });
}
