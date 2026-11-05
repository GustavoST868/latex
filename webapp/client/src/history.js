import { $, el, icon, toast, promptModal, confirmModal, FILE_ICONS } from './util.js';
import { S } from './state.js';
import { api, json, projectUrl } from './api.js';
import { openMenu } from './menu.js';
import { saveFile } from './editor.js';

// Version history, like Overleaf's: versions on the right, changed files on the left,
// the selected file's changes in the middle. Versions are saved by the server.
const H = {
  open: false,
  versions: [],
  version: null,   // selected version
  file: null,      // selected file of that version
};

const body = $('ide-body');
const versionList = $('history-version-list');
const fileList = $('history-file-list');
const diffView = $('history-diff');
const onlyLabels = $('history-only-labels');
let afterRestore = async () => {};

const STATUS_LABEL = { added: 'Adicionado', modified: 'Alterado', deleted: 'Excluído', renamed: 'Renomeado' };
const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp)$/i;

const fmtDate = d => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const fileIcon = path => (IMAGE_RE.test(path) ? FILE_ICONS.image : /\.pdf$/i.test(path) ? FILE_ICONS.pdf : FILE_ICONS.text);
const historyUrl = (hash = '') => `${projectUrl()}/history${hash ? '/' + hash : ''}`;

export const isHistoryOpen = () => H.open;

export async function openHistory() {
  if (!S.project) return;
  try { await saveFile(); } catch {}
  H.open = true;
  body.classList.add('history-mode');
  $('btn-history').classList.add('active');
  await loadVersions();
}

export function closeHistory() {
  if (!H.open) return;
  H.open = false;
  body.classList.remove('history-mode');
  $('btn-history').classList.remove('active');
}

export const toggleHistory = () => (H.open ? closeHistory() : openHistory());

// ════════════════════════════════════
//  VERSIONS
// ════════════════════════════════════
async function loadVersions(selectHash = H.version?.hash) {
  versionList.replaceChildren(el('div', { className: 'history-empty' }, 'Carregando…'));
  try {
    H.versions = await api(historyUrl());
  } catch (err) {
    versionList.replaceChildren(el('div', { className: 'history-empty' }, 'Erro: ' + err.message));
    return;
  }
  renderVersions();
  const next = H.versions.find(v => v.hash === selectHash) || H.versions[0];
  next ? selectVersion(next) : showEmpty();
}

function renderVersions() {
  const list = onlyLabels.checked ? H.versions.filter(v => v.labels.length) : H.versions;
  if (!list.length) {
    versionList.replaceChildren(el('div', { className: 'history-empty' },
      onlyLabels.checked ? 'Nenhuma versão nomeada ainda.' : 'Nenhuma versão salva ainda. As versões são criadas ao compilar e a cada poucos minutos de edição.'));
    return;
  }
  let lastDay = '';
  const nodes = [];
  list.forEach(v => {
    const longDay = new Date(v.date).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const day = longDay[0].toUpperCase() + longDay.slice(1);
    if (day !== lastDay) nodes.push(el('div', { className: 'history-day' }, day));
    lastDay = day;
    const isCurrent = v === H.versions[0];
    nodes.push(el('div', {
      className: 'history-version' + (H.version?.hash === v.hash ? ' active' : ''),
      onclick: () => selectVersion(v),
    },
      el('div', { className: 'history-version-top' },
        el('span', { className: 'history-time' }, new Date(v.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })),
        isCurrent ? el('span', { className: 'history-current' }, 'Versão atual') : null,
        el('span', { className: 'tb-spacer' }),
        el('button', {
          className: 'icon-btn', title: 'Mais opções',
          onclick: e => { e.stopPropagation(); openMenu(e.currentTarget, versionMenu(v, isCurrent), { align: 'right' }); },
        }, icon('more_vert'))),
      el('div', { className: 'history-message' }, v.message),
      v.labels.length ? el('div', { className: 'history-labels' }, v.labels.map(l => el('span', { className: 'history-label' },
        icon('bookmark', 'filled'), l,
        el('button', { title: 'Remover nome', onclick: e => { e.stopPropagation(); removeLabel(v, l); } }, icon('close'))))) : null,
      el('div', { className: 'history-meta' }, `${v.files.length} arquivo(s) alterado(s)`),
    ));
  });
  versionList.replaceChildren(...nodes);
}

function versionMenu(v, isCurrent) {
  return [
    { label: 'Nomear esta versão', icon: 'bookmark_add', action: () => labelVersion(v) },
    { label: 'Restaurar o projeto para esta versão', icon: 'settings_backup_restore', disabled: isCurrent, action: () => restore(v) },
  ];
}

function selectVersion(v) {
  H.version = v;
  renderVersions();
  const keep = v.files.find(f => f.path === H.file?.path);
  renderFiles();
  const first = keep || v.files.find(f => /\.tex$/.test(f.path)) || v.files[0];
  first ? selectFile(first) : showEmpty('Esta versão não alterou arquivos.');
}

function showEmpty(msg = 'Nenhuma versão selecionada.') {
  H.file = null;
  $('history-file-name').textContent = '';
  $('btn-history-restore-file').disabled = true;
  if (!H.version) fileList.replaceChildren();
  diffView.replaceChildren(el('div', { className: 'history-empty' }, msg));
}

// ════════════════════════════════════
//  FILES & DIFF
// ════════════════════════════════════
function renderFiles() {
  fileList.replaceChildren(...H.version.files.map(f => el('div', {
    className: 'history-file' + (H.file?.path === f.path ? ' active' : ''),
    title: f.from ? `${f.from} → ${f.path}` : f.path,
    onclick: () => selectFile(f),
  },
    icon(fileIcon(f.path)),
    el('span', { className: 'file-label' }, f.path),
    el('span', { className: `history-status ${f.status}` }, STATUS_LABEL[f.status] || f.status))));
}

async function selectFile(f) {
  H.file = f;
  renderFiles();
  $('history-file-name').textContent = f.path.split('/').join(' › ');
  $('btn-history-restore-file').disabled = f.status === 'deleted';
  const hash = H.version.hash;
  diffView.replaceChildren(el('div', { className: 'history-empty' }, 'Carregando…'));

  if (IMAGE_RE.test(f.path) && f.status !== 'deleted') {
    diffView.replaceChildren(el('div', { className: 'history-image' },
      el('img', { src: `${historyUrl(hash)}/file?file=${encodeURIComponent(f.path)}`, alt: f.path })));
    return;
  }
  try {
    const { diff } = await api(`${historyUrl(hash)}/diff?file=${encodeURIComponent(f.path)}`);
    if (H.file !== f) return;
    renderDiff(diff);
  } catch (err) {
    diffView.replaceChildren(el('div', { className: 'history-empty' }, 'Erro: ' + err.message));
  }
}

function renderDiff(diff) {
  const lines = diff.split('\n');
  const start = lines.findIndex(l => l.startsWith('@@'));
  if (start < 0) {
    const binary = /^Binary files/m.test(diff);
    diffView.replaceChildren(el('div', { className: 'history-empty' },
      binary ? 'Arquivo binário: não é possível mostrar as diferenças.' : 'Sem alterações de conteúdo (apenas renomeado ou movido).'));
    return;
  }
  let oldNo = 0, newNo = 0, added = 0, removed = 0;
  const rows = [];
  for (const line of lines.slice(start)) {
    if (line.startsWith('@@')) {
      const m = line.match(/-(\d+)(?:,\d+)? \+(\d+)/);
      if (m) { oldNo = Number(m[1]); newNo = Number(m[2]); }
      if (rows.length) rows.push(el('div', { className: 'diff-line diff-hunk' }, el('span', { className: 'diff-no' }), el('span', { className: 'diff-no' }), el('span', { className: 'diff-text' }, '⋯')));
      continue;
    }
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    const kind = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx';
    if (kind === 'add') added++;
    if (kind === 'del') removed++;
    rows.push(el('div', { className: `diff-line diff-${kind}` },
      el('span', { className: 'diff-no' }, kind === 'add' ? '' : oldNo++),
      el('span', { className: 'diff-no' }, kind === 'del' ? '' : newNo++),
      el('span', { className: 'diff-text' }, line.slice(1) || ' ')));
  }
  // Trailing empty context line from the final newline
  if (rows.length && lines[lines.length - 1] === '') rows.pop();
  diffView.replaceChildren(
    el('div', { className: 'diff-summary' },
      el('span', { className: 'diff-count add' }, `+${added}`),
      el('span', { className: 'diff-count del' }, `−${removed}`),
      el('span', {}, 'linhas nesta versão')),
    el('div', { className: 'diff-body' }, rows));
  diffView.querySelector('.diff-add, .diff-del')?.scrollIntoView({ block: 'center' });
}

// ════════════════════════════════════
//  ACTIONS
// ════════════════════════════════════
async function saveVersion() {
  const label = await promptModal({ title: 'Salvar versão', label: 'Nome da versão (opcional)', confirmLabel: 'Salvar' });
  if (label === null) return;
  try {
    await saveFile().catch(() => {});
    const { hash } = await api(historyUrl(), json('POST', { label }));
    toast('Versão salva');
    await loadVersions(hash);
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

async function labelVersion(v) {
  const label = await promptModal({ title: 'Nomear versão', label: 'Nome', confirmLabel: 'Salvar' });
  if (!label) return;
  try {
    const res = await api(`${historyUrl(v.hash)}/labels`, json('POST', { label }));
    v.labels = res.labels;
    renderVersions();
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

async function removeLabel(v, label) {
  try {
    await api(`${historyUrl(v.hash)}/labels?label=${encodeURIComponent(label)}`, { method: 'DELETE' });
    v.labels = v.labels.filter(l => l !== label);
    renderVersions();
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

async function restore(v, file = null) {
  const message = file
    ? `Substituir o conteúdo atual de "${file}" pelo desta versão (${fmtDate(v.date)})?`
    : `Restaurar todo o projeto para a versão de ${fmtDate(v.date)}? Arquivos criados depois dela serão removidos. O estado atual fica salvo no histórico.`;
  if (!(await confirmModal({ title: 'Restaurar', message, confirmLabel: 'Restaurar' }))) return;
  try {
    await api(`${historyUrl(v.hash)}/restore`, json('POST', file ? { file } : {}));
    toast(file ? 'Arquivo restaurado' : 'Projeto restaurado');
    await afterRestore();
    await loadVersions();
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

export function resetHistory() {
  closeHistory();
  H.versions = [];
  H.version = null;
  H.file = null;
}

export function initHistory({ onRestored }) {
  afterRestore = onRestored;
  $('btn-history').onclick = toggleHistory;
  $('btn-history-close').onclick = closeHistory;
  $('btn-history-save').onclick = saveVersion;
  $('btn-history-restore-file').onclick = () => H.version && H.file && restore(H.version, H.file.path);
  onlyLabels.onchange = renderVersions;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && H.open && !document.querySelector('.modal-backdrop:not(.hidden)')) closeHistory();
  });
}
