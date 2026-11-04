import { $, el, toast, showView, download, openModal, promptModal } from './util.js';
import { S } from './state.js';
import { api, json, projectUrl, fileUrl } from './api.js';
import { setEditorContent, stashEditorState, clearEditorStates, saveFile, updateSaveStatus, goToLine } from './editor.js';
import { scheduleMetaRefresh, clearMeta } from './meta.js';
import { renderFileTree, findEntry, firstTextFile } from './filetree.js';
import { compile, clearCompileState, updateCompileTarget } from './compile.js';
import { resetPDF } from './pdf.js';
import { joinProject } from './ws.js';
import { resetDetached } from './layout.js';
import { clearSearch } from './search.js';
import { joinSyncChannel } from './synctex.js';

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
    setProjectTitle();
    joinSyncChannel();

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
    if (!confirm('Não foi possível salvar as alterações. Sair mesmo assim?')) return false;
  }
  resetDetached();
  clearEditorStates();
  clearMeta();
  S.project = null;
  S.openFile = null;
  S.dirty = false;
  joinProject(null);
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
    onOpen: entry => openFile(entry),
    onToggle: path => {
      S.expanded.has(path) ? S.expanded.delete(path) : S.expanded.add(path);
      refreshTree();
    },
    onDelete: entry => deleteEntry(entry),
    onSetMain: entry => setMainFile(entry.path),
  });
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
    if (!confirm('Não foi possível salvar as alterações. Trocar de arquivo mesmo assim?')) return;
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

export async function createNewFile() {
  const name = await promptModal({
    title: 'Novo arquivo',
    label: 'Nome do arquivo (ex: capitulo1.tex ou capitulos/cap1.tex)',
    confirmLabel: 'Criar',
  });
  if (!name) return;
  const path = name.replace(/^\/+/, '');
  if (!path || path.split('/').some(s => !s || s.startsWith('.'))) {
    toast('Nome de arquivo inválido', 'err');
    return;
  }
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
  if (!confirm(msg)) return;

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

export const triggerUpload = () => $('file-upload-input').click();

export function initProjectUI() {
  $('btn-new-file').onclick = createNewFile;
  $('btn-upload-trigger').onclick = triggerUpload;
  $('file-upload-input').onchange = async e => {
    await uploadFiles(e.target.files);
    e.target.value = '';
  };
}
