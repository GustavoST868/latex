import { $, el, toast, showView, download, openModal, promptModal, confirmModal } from './util.js';
import { S } from './state.js';
import { api, json, projectUrl, fileUrl } from './api.js';
import {
  setEditorContent, stashEditorState, clearEditorStates, saveFile, updateSaveStatus, goToLine, replaceContentExternally,
} from './editor.js';
import { scheduleMetaRefresh, clearMeta } from './meta.js';
import { renderFileTree, initFileTree, findEntry, firstTextFile, parentOf } from './filetree.js';
import { openMenu } from './menu.js';
import { refreshOutline } from './outline.js';
import { resetHistory } from './history.js';
import { compile, clearCompileState, updateCompileTarget } from './compile.js';
import { resetPDF } from './pdf.js';
import { joinProject } from './ws.js';
import { resetDetached } from './layout.js';
import { clearSearch } from './search.js';
import { joinSyncChannel } from './synctex.js';
import { resetChat } from './chat.js';

const editorInner = $('editor-inner');
const fileView = $('file-view');

function setProjectTitle() {
  $('project-name').textContent = S.project || '—';
  document.title = S.project ? `${S.project} – Editor LaTeX` : 'Editor LaTeX';
}

// ════════════════════════════════════
//  PROJECT
// ════════════════════════════════════
export async function loadProject(name) {
  try {
    S.project = name;
    S.openFile = null;
    S.expanded = new Set();
    clearEditorStates();
    clearMeta();
    joinProject(name);
    resetPDF();
    clearCompileState();
    clearSearch();
    resetHistory();
    setProjectTitle();
    joinSyncChannel();
    resetChat();

    const [settings] = await Promise.all([api(`${projectUrl()}/settings`), refreshFiles()]);
    S.settings = settings;
    updateCompileTarget();

    const entry = (settings.mainFile && findEntry(S.files, settings.mainFile)) || firstTextFile(S.files);
    if (entry) await openFile(entry);
    else showEmptyEditor();

    showView('editor');
    compile();
  } catch (err) {
    S.project = null;
    setProjectTitle();
    toast('Erro ao carregar projeto: ' + err.message, 'err');
  }
}

// Saves pending edits before leaving the project
export async function closeProject() {
  try {
    await saveFile();
  } catch {
    const leave = await confirmModal({ title: 'Erro ao salvar', message: 'Não foi possível salvar as alterações. Sair mesmo assim?', confirmLabel: 'Sair sem salvar', danger: true });
    if (!leave) return false;
  }
  resetDetached();
  resetHistory();
  clearEditorStates();
  clearMeta();
  S.project = null;
  S.openFile = null;
  S.dirty = false;
  joinProject(null);
  resetChat();
  resetPDF();
  setProjectTitle();
  return true;
}

function showEmptyEditor() {
  S.openFile = null;
  setEditorContent('');
  $('file-name').textContent = 'Nenhum arquivo aberto';
  updateSaveStatus('');
  refreshTree();
  refreshOutline();
}

export async function renameProject() {
  const newName = await promptModal({ title: 'Renomear projeto', label: 'Novo nome', value: S.project, confirmLabel: 'Renomear' });
  if (!newName || newName === S.project) return;
  try {
    await saveFile();
    await api(`${projectUrl()}/rename`, json('POST', { newName }));
    resetDetached();
    S.project = newName;
    joinProject(newName);
    setProjectTitle();
    toast('Projeto renomeado');
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

export async function copyProject() {
  const newName = await promptModal({ title: 'Fazer uma cópia', label: 'Nome da cópia', value: `Cópia de ${S.project}`, confirmLabel: 'Copiar' });
  if (!newName) return;
  try {
    await saveFile();
    await api(`${projectUrl()}/copy`, json('POST', { newName }));
    if (!(await closeProject())) return;
    toast('Cópia criada');
    await loadProject(newName);
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

export async function downloadSource() {
  try { await saveFile(); } catch { return; }
  download(`${projectUrl()}/download.zip`);
}

export async function showWordCount() {
  try { await saveFile(); } catch {}
  openModal({ title: 'Contagem de palavras', body: el('p', { className: 'loading' }, 'Contando…') });
  try {
    const wc = await api(`${projectUrl()}/wordcount`);
    const rows = [
      ['Palavras no texto', wc.words],
      ['Palavras em títulos', wc.headerWords],
      ['Palavras em legendas e afins', wc.captionWords],
      ['Títulos de seção', wc.headers],
      ['Figuras e tabelas', wc.floats],
      ['Fórmulas no texto', wc.mathInline],
      ['Fórmulas em destaque', wc.mathDisplay],
    ];
    $('modal-body').replaceChildren(
      el('p', { className: 'form-section' }, `Documento: ${wc.mainFile}`),
      el('table', { className: 'kv-table' }, el('tbody', {},
        rows.map(([k, v]) => el('tr', {}, el('td', {}, k), el('td', {}, v.toLocaleString('pt-BR')))))),
    );
  } catch (err) {
    $('modal-body').replaceChildren(el('p', {}, 'Erro: ' + err.message));
  }
}

// ════════════════════════════════════
//  FILES
// ════════════════════════════════════
export async function refreshFiles() {
  if (!S.project) return;
  S.files = await api(`${projectUrl()}/files`);
  refreshTree();
  scheduleMetaRefresh(100); // file list feeds autocompletion
}

export function refreshTree() {
  renderFileTree($('file-list'), S.files, {
    activePath: S.openFile?.path,
    mainFile: S.settings?.mainFile,
    expanded: S.expanded,
  });
}

function toggleFolder(path) {
  S.expanded.has(path) ? S.expanded.delete(path) : S.expanded.add(path);
  refreshTree();
}

// Right-click menu (entry is null for the empty area of the tree)
function entryMenu(entry, at) {
  const folder = entry ? (entry.type === 'folder' ? entry.path : parentOf(entry.path)) : '';
  const items = [];
  if (entry && entry.type !== 'folder') {
    items.push({ label: 'Abrir', icon: 'open_in_new', action: () => openFile(entry) });
    if (entry.name.endsWith('.tex') && entry.path !== S.settings?.mainFile) {
      items.push({ label: 'Definir como documento principal', icon: 'star', action: () => setMainFile(entry.path) });
    }
    items.push({ label: 'Baixar', icon: 'download', action: () => download(fileUrl(entry.path) + '?raw', entry.name) });
    items.push('-');
  }
  items.push(
    { label: folder ? `Novo arquivo em ${folder}` : 'Novo arquivo', icon: 'note_add', action: () => createNewFile(folder) },
    { label: folder ? `Nova pasta em ${folder}` : 'Nova pasta', icon: 'create_new_folder', action: () => createFolder(folder) },
    { label: folder ? `Enviar arquivos para ${folder}` : 'Enviar arquivos', icon: 'upload', action: () => triggerUpload(folder) },
  );
  if (entry) {
    items.push(
      '-',
      { label: 'Renomear', icon: 'edit', action: () => renameEntry(entry) },
      { label: 'Excluir', icon: 'delete', danger: true, action: () => deleteEntry(entry) },
    );
  }
  openMenu($('file-list'), items, { at });
}

// Expands every folder above a file so it's visible in the tree
function revealInTree(path) {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) S.expanded.add(parts.slice(0, i).join('/'));
}

export async function openFile(entry) {
  if (S.openFile?.path === entry.path && entry.type === 'text') return;
  try {
    await saveFile();
  } catch {
    const proceed = await confirmModal({ title: 'Erro ao salvar', message: 'Não foi possível salvar as alterações. Trocar de arquivo mesmo assim?', confirmLabel: 'Trocar sem salvar', danger: true });
    if (!proceed) return;
  }

  const url = fileUrl(entry.path);
  stashEditorState();
  if (entry.type === 'text') {
    try {
      const data = await api(url);
      setEditorContent(data.content || '', entry.path);
      S.openFile = { path: entry.path, type: 'text' };
      editorInner.classList.remove('hidden');
      fileView.classList.add('hidden');
      fileView.replaceChildren();
    } catch (err) {
      toast('Erro ao carregar arquivo: ' + err.message, 'err');
      return;
    }
  } else {
    S.openFile = { path: entry.path, type: entry.type };
    S.dirty = false;
    updateSaveStatus('');
    const src = `${url}?t=${Date.now()}`;
    let body;
    if (entry.type === 'image') body = el('img', { src, alt: entry.name });
    else if (entry.type === 'pdf') body = el('iframe', { src, title: entry.name });
    else body = el('p', { className: 'file-view-msg' }, 'Este arquivo não pode ser visualizado no editor.');
    fileView.replaceChildren(
      body,
      el('a', { className: 'btn btn-ghost', href: url, download: entry.name }, `Baixar ${entry.name}`),
    );
    editorInner.classList.add('hidden');
    fileView.classList.remove('hidden');
  }

  $('file-name').textContent = entry.path.split('/').join(' › ');
  revealInTree(entry.path);
  refreshTree();
  refreshOutline();
}

export async function openFileAtLine(path, line) {
  const entry = findEntry(S.files, path);
  if (!entry) return toast('Arquivo não encontrado: ' + path, 'err');
  await openFile(entry);
  if (S.openFile?.path === path) goToLine(line);
}

export async function updateSettings(patch) {
  try {
    S.settings = await api(`${projectUrl()}/settings`, json('PATCH', patch));
    updateCompileTarget();
    refreshTree();
    return true;
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
    return false;
  }
}

async function setMainFile(path) {
  if (await updateSettings({ mainFile: path })) toast(`Documento principal: ${path}`);
}

// "a/b.tex" typed by the user, relative to `folder`; null when invalid
function joinPath(folder, name) {
  const path = [folder, name.replace(/^\/+/, '')].filter(Boolean).join('/');
  if (!name || path.split('/').some(s => !s || s.startsWith('.'))) {
    toast('Nome inválido: não use nomes vazios nem começados por "."', 'err');
    return null;
  }
  return path;
}

export async function createNewFile(folder = '') {
  const name = await promptModal({
    title: folder ? `Novo arquivo em ${folder}` : 'Novo arquivo',
    label: 'Nome do arquivo (ex: capitulo1.tex ou capitulos/cap1.tex)',
    confirmLabel: 'Criar',
  });
  if (!name) return;
  const path = joinPath(folder, name);
  if (!path) return;
  if (findEntry(S.files, path)) {
    toast('Já existe um arquivo com esse nome', 'err');
    return;
  }

  try {
    await api(fileUrl(path), json('PUT', { content: '' }));
    toast('Arquivo criado');
    await refreshFiles();
    const entry = findEntry(S.files, path);
    if (entry && entry.type === 'text') await openFile(entry);
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

export async function createFolder(folder = '') {
  const name = await promptModal({
    title: folder ? `Nova pasta em ${folder}` : 'Nova pasta',
    label: 'Nome da pasta',
    confirmLabel: 'Criar',
  });
  if (!name) return;
  const path = joinPath(folder, name);
  if (!path) return;
  try {
    await api(`${projectUrl()}/folders`, json('POST', { path }));
    S.expanded.add(path);
    revealInTree(path);
    await refreshFiles();
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

// Moves/renames on the server, keeping the open file and expanded folders in sync
async function moveEntry(entry, to) {
  if (to === entry.path) return;
  try {
    await saveFile();
    await api(`${projectUrl()}/move`, json('POST', { from: entry.path, to }));
    const rebase = p => (p === entry.path || p.startsWith(entry.path + '/') ? to + p.slice(entry.path.length) : p);
    if (S.openFile) {
      S.openFile.path = rebase(S.openFile.path);
      $('file-name').textContent = S.openFile.path.split('/').join(' › ');
    }
    S.expanded = new Set([...S.expanded].map(rebase));
    revealInTree(to);
    S.settings = await api(`${projectUrl()}/settings`);
    updateCompileTarget();
    await refreshFiles();
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

async function renameEntry(entry) {
  const name = await promptModal({
    title: entry.type === 'folder' ? 'Renomear pasta' : 'Renomear arquivo',
    label: 'Novo nome',
    value: entry.name,
    confirmLabel: 'Renomear',
  });
  if (!name || name === entry.name) return;
  if (name.includes('/')) return toast('Use arrastar e soltar para mover para outra pasta', 'err');
  const path = joinPath(parentOf(entry.path), name);
  if (path) await moveEntry(entry, path);
}

async function deleteEntry(entry) {
  const main = S.settings?.mainFile;
  const isFolder = entry.type === 'folder';
  if (main && (main === entry.path || (isFolder && main.startsWith(entry.path + '/')))) {
    toast('Defina outro documento principal antes de excluir este', 'err');
    return;
  }
  const msg = isFolder
    ? `Excluir a pasta "${entry.path}" e todo o seu conteúdo?`
    : `Excluir o arquivo "${entry.path}" permanentemente?`;
  if (!(await confirmModal({ title: isFolder ? 'Excluir pasta' : 'Excluir arquivo', message: msg, confirmLabel: 'Excluir', danger: true }))) return;

  try {
    await api(fileUrl(entry.path), { method: 'DELETE' });
    toast(isFolder ? 'Pasta excluída' : 'Arquivo excluído');
    const open = S.openFile?.path;
    const openWasDeleted = open && (open === entry.path || open.startsWith(entry.path + '/'));
    if (openWasDeleted) {
      S.dirty = false; // nothing left to save
      S.openFile = null;
    }
    await refreshFiles();
    if (openWasDeleted) {
      const next = (main && findEntry(S.files, main)) || firstTextFile(S.files);
      next ? await openFile(next) : showEmptyEditor();
    }
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

export async function uploadFiles(files, folder = '') {
  if (!files.length) return false;
  const formData = new FormData();
  for (const f of files) formData.append('files', f);
  try {
    const query = folder ? `?folder=${encodeURIComponent(folder)}` : '';
    await api(`${projectUrl()}/upload${query}`, { method: 'POST', body: formData });
    toast(`${files.length} arquivo(s) enviado(s)`);
    await refreshFiles();
    return true;
  } catch (err) {
    toast('Erro no upload: ' + err.message, 'err');
    return false;
  }
}

let uploadFolder = '';
export function triggerUpload(folder = '') {
  uploadFolder = typeof folder === 'string' ? folder : '';
  $('file-upload-input').click();
}

// ════════════════════════════════════
//  CHANGES MADE OUTSIDE THE APP (server file watcher)
// ════════════════════════════════════
export async function handleFilesChanged(msg) {
  if (!S.project) return;
  if (msg.structure) await refreshFiles().catch(() => {});
  const open = S.openFile;
  if (!open || !msg.files.includes(open.path)) return;
  if (open.type !== 'text') {
    // Reload images/PDFs shown in the editor area
    const media = fileView.querySelector('img, iframe');
    if (media) media.src = `${fileUrl(open.path)}?t=${Date.now()}`;
    return;
  }
  if (S.dirty) return; // local edits win; they'll be saved over the file
  try {
    const { content } = await api(fileUrl(open.path));
    if (S.openFile?.path === open.path && !S.dirty && content !== S.content) {
      replaceContentExternally(content);
      toast(`${open.path} foi alterado fora do editor e recarregado`);
    }
  } catch {}
}

// After a restore or a pull: refresh the tree and the open file from disk
export async function reloadFromDisk() {
  await refreshFiles();
  S.settings = await api(`${projectUrl()}/settings`);
  updateCompileTarget();
  const open = S.openFile && findEntry(S.files, S.openFile.path);
  if (!open) {
    S.openFile = null;
    const next = (S.settings.mainFile && findEntry(S.files, S.settings.mainFile)) || firstTextFile(S.files);
    return next ? openFile(next) : showEmptyEditor();
  }
  await handleFilesChanged({ files: [open.path], structure: false });
}

export function initProjectUI() {
  $('btn-new-file').onclick = () => createNewFile();
  $('btn-new-folder').onclick = () => createFolder();
  $('btn-upload-trigger').onclick = () => triggerUpload();
  $('file-upload-input').onchange = async e => {
    await uploadFiles(e.target.files, uploadFolder);
    e.target.value = '';
  };
  initFileTree($('file-list'), {
    getEntry: path => findEntry(S.files, path),
    onOpen: entry => openFile(entry),
    onToggle: toggleFolder,
    onMenu: entryMenu,
    onMove: (entry, folder) => moveEntry(entry, [folder, entry.name].filter(Boolean).join('/')),
    onDropFiles: async (files, folder) => {
      if (await uploadFiles(files, folder) && folder) {
        S.expanded.add(folder);
        refreshTree();
      }
    },
  });
}
