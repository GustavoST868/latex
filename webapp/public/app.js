/* ── PDF.js Worker ── */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ════════════════════════════════════
//  DOM & STATE
// ════════════════════════════════════
const $ = id => document.getElementById(id);

const S = {
  project: null,
  projects: [],
  mainFile: null,
  dirty: false,
  content: '',
  compiling: false,
  pdf: null,
  pdfZoom: 1.3,
  pdfUrl: null,
  autocomplete: {
    visible: false,
    query: '',
    index: 0,
    list: [],
    start: 0,
    end: 0
  },
  files: []
};

const LATEX_COMMANDS = [
  // Structure & Formatting
  { name: 'begin', snippet: 'begin{$1}\n  $0\n\\end{$1}' },
  { name: 'end', snippet: 'end{$1}' },
  { name: 'section', snippet: 'section{$1}' },
  { name: 'subsection', snippet: 'subsection{$1}' },
  { name: 'subsubsection', snippet: 'subsubsection{$1}' },
  { name: 'paragraph', snippet: 'paragraph{$1}' },
  { name: 'textbf', snippet: 'textbf{$1}' },
  { name: 'textit', snippet: 'textit{$1}' },
  { name: 'underline', snippet: 'underline{$1}' },
  { name: 'texttt', snippet: 'texttt{$1}' },
  { name: 'textsc', snippet: 'textsc{$1}' },
  { name: 'author', snippet: 'author{$1}' },
  { name: 'title', snippet: 'title{$1}' },
  { name: 'date', snippet: 'date{\\today}' },
  { name: 'emph', snippet: 'emph{$1}' },
  { name: 'usepackage', snippet: 'usepackage{$1}' },
  { name: 'documentclass', snippet: 'documentclass{$1}' },
  { name: 'maketitle', snippet: 'maketitle' },
  { name: 'centering', snippet: 'centering' },
  { name: 'item', snippet: 'item ' },
  { name: 'label', snippet: 'label{$1}' },
  { name: 'ref', snippet: 'ref{$1}' },
  { name: 'cite', snippet: 'cite{$1}' },
  { name: 'caption', snippet: 'caption{$1}' },
  { name: 'footnote', snippet: 'footnote{$1}' },
  { name: 'includegraphics', snippet: 'includegraphics[width=$1]{$2}' },
  
  // Tables & Figures
  { name: 'table', snippet: 'begin{table}[h!]\n  \\centering\n  \\begin{tabular}{|c|c|}\n    \\hline\n    $1 & $2 \\\\\n    \\hline\n    $3 & $4 \\\\\n    \\hline\n  \\end{tabular}\n  \\caption{$5}\n  \\label{tab:$6}\n\\end{table}' },
  { name: 'figure', snippet: 'begin{figure}[h!]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{$1}\n  \\caption{$2}\n  \\label{fig:$3}\n\\end{figure}' },
  { name: 'tabular', snippet: 'begin{tabular}{|c|c|}\n  \\hline\n  $1 & $2 \\\\\n  \\hline\n\\end{tabular}' },
  
  // Math environments
  { name: 'equation', snippet: 'begin{equation}\n  $1\n\\end{equation}' },
  { name: 'align', snippet: 'begin{align}\n  $1\n\\end{align}' },
  { name: 'itemize', snippet: 'begin{itemize}\n  \\item $1\n\\end{itemize}' },
  { name: 'enumerate', snippet: 'begin{enumerate}\n  \\item $1\n\\end{enumerate}' },
  
  // Math symbols & Greek
  { name: 'frac', snippet: 'frac{$1}{$2}' },
  { name: 'sqrt', snippet: 'sqrt{$1}' },
  { name: 'sum', snippet: 'sum_{$1}^{$2}' },
  { name: 'int', snippet: 'int_{$1}^{$2}' },
  { name: 'limit', snippet: 'limit_{$1}' },
  { name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }, { name: 'delta' }, { name: 'epsilon' },
  { name: 'zeta' }, { name: 'eta' }, { name: 'theta' }, { name: 'iota' }, { name: 'kappa' },
  { name: 'lambda' }, { name: 'mu' }, { name: 'nu' }, { name: 'xi' }, { name: 'pi' },
  { name: 'rho' }, { name: 'sigma' }, { name: 'tau' }, { name: 'upsilon' }, { name: 'phi' },
  { name: 'chi' }, { name: 'psi' }, { name: 'omega' },
  { name: 'Gamma' }, { name: 'Delta' }, { name: 'Theta' }, { name: 'Lambda' }, { name: 'Xi' },
  { name: 'Pi' }, { name: 'Sigma' }, { name: 'Upsilon' }, { name: 'Phi' }, { name: 'Psi' }, { name: 'Omega' },
  
  // Common math ops
  { name: 'sin' }, { name: 'cos' }, { name: 'tan' }, { name: 'log' }, { name: 'ln' }, { name: 'exp' },
  { name: 'min' }, { name: 'max' }, { name: 'sup' }, { name: 'inf' },
  { name: 'neq' }, { name: 'leq' }, { name: 'geq' }, { name: 'approx' }, { name: 'equiv' },
  { name: 'times' }, { name: 'div' }, { name: 'cdot' }, { name: 'pm' }, { name: 'mp' },
  { name: 'rightarrow' }, { name: 'leftarrow' }, { name: 'Rightarrow' }, { name: 'Leftarrow' },
  { name: 'mathbb', snippet: 'mathbb{$1}' },
  { name: 'mathcal', snippet: 'mathcal{$1}' }
].sort((a,b) => a.name.localeCompare(b.name));

const editorScreen = $('editor-screen');
const homeScreen   = $('home-screen');
const editor       = $('editor');
const lineNums     = $('line-nums');
const btnSave      = $('btn-save');
const saveStatus   = $('save-status');
const btnCompile   = $('btn-compile');
const compileBadge = $('compile-badge');
const pdfPages     = $('pdf-pages');
const pdfEmpty     = $('pdf-empty');
const logPanel     = $('log-panel');
const logContent   = $('log-content');

// ════════════════════════════════════
//  API HELPER
// ════════════════════════════════════
async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.clone().json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

// ════════════════════════════════════
//  INIT
// ════════════════════════════════════
async function initApp() {
  try {
    showView('home');
    await refreshHomeProjects();
    connectWS();
  } catch (err) {
    console.error(err);
  }
}

function showView(view) {
  if (view === 'home') {
    homeScreen.classList.remove('hidden');
    editorScreen.classList.add('hidden');
    refreshHomeProjects();
  } else {
    homeScreen.classList.add('hidden');
    editorScreen.classList.remove('hidden');
  }
}

async function refreshHomeProjects() {
  const grid = $('home-projects-list');
  grid.innerHTML = '<div class="loading">Carregando seus projetos...</div>';
  try {
    const list = await api('/api/projects');
    S.projects = list;
    grid.innerHTML = '';
    
    if (list.length === 0) {
      grid.innerHTML = '<div class="loading">Ninguém por aqui ainda. Crie seu primeiro projeto acima!</div>';
      return;
    }

    list.forEach(p => {
      const card = document.createElement('div');
      card.className = 'project-card';
      const date = new Date(p.mtime).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      
      card.onclick = () => selectProject(p.name);
      
      card.innerHTML = `
        <div class="project-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <span class="project-name">${p.name}</span>
        <span class="project-meta">Modificado em ${date}</span>
        <div class="card-actions">
          <button class="icon-btn btn-delete" title="Excluir" data-name="${p.name}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;

      // Use modern event logic to prevent conflicts
      card.querySelector('.btn-delete').onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const n = e.currentTarget.getAttribute('data-name');
        console.log('Delete button clicked for:', n);
        deleteProject(n);
      };

      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = `<div class="loading">Erro: ${err.message}</div>`;
  }
}

async function loadProject(projectName, fileToLoad = null) {
  try {
    S.project = projectName;
    
    // Get file info
    const files = await api(`/api/projects/${encodeURIComponent(S.project)}/files`);
    const mainTex = files.find(f => f.name.endsWith('.tex'));
    S.mainFile = fileToLoad || (mainTex ? mainTex.name : 'main.tex');

    $('file-name').textContent = S.mainFile;
    
    // Reset editor UI
    S.pdf = null;
    S.pdfUrl = null;
    pdfPages.innerHTML = '';
    pdfEmpty.classList.remove('hidden');
    logContent.textContent = '';
    logPanel.classList.remove('open');

    // Load file content
    const data = await api(`/api/projects/${encodeURIComponent(S.project)}/files/${encodeURIComponent(S.mainFile)}`);
    S.content = data.content || '';
    editor.value = S.content;
    renderLineNums();
    updateSaveStatus('saved');
    
    await refreshProjectFiles();
    showView('editor');
    compile();
  } catch (err) {
    toast('Erro ao carregar projeto: ' + err.message, 'err');
  }
}

async function refreshProjectFiles() {
  if (!S.project) return;
  try {
    const list = await api(`/api/projects/${encodeURIComponent(S.project)}/files`);
    S.files = list;
    renderFileList();
  } catch (err) {
    console.error('refreshProjectFiles err:', err);
  }
}

function renderFileList() {
  const listEl = $('file-list');
  listEl.innerHTML = '';
  
  // Sort files: folders first, then files
  const sorted = [...S.files].sort((a,b) => {
    if (a.type === 'folder' && b.type !== 'folder') return -1;
    if (a.type !== 'folder' && b.type === 'folder') return 1;
    return a.name.localeCompare(b.name);
  });

  sorted.forEach(f => {
    const item = document.createElement('div');
    item.className = 'file-item' + (S.mainFile === f.name ? ' active' : '');
    
    const icon = f.type === 'text' ? 
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>` :
      f.type === 'pdf' ?
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>` :
      f.type === 'image' ?
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>` :
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;

    item.innerHTML = `${icon}<span>${f.name}</span>`;
    
    // Add delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn btn-file-delete';
    delBtn.title = 'Excluir arquivo';
    delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteFile(f.name);
    };
    item.appendChild(delBtn);

    item.onclick = () => switchFile(f.name, f.type);
    listEl.appendChild(item);
  });
}

async function createNewFile() {
  const name = prompt('Nome do novo arquivo (ex: capitulo1.tex):');
  if (!name) return;
  
  try {
    await api(`/api/projects/${encodeURIComponent(S.project)}/files/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '' })
    });
    toast('Arquivo criado');
    await refreshProjectFiles();
    // Auto switch to it
    const ext = name.split('.').pop().toLowerCase();
    const type = ['.tex', '.bib', '.txt', '.md'].includes('.' + ext) ? 'text' : 'binary';
    if (type === 'text') switchFile(name, 'text');
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

async function deleteFile(name) {
  if (name === 'main.tex') {
    toast('Não é possível excluir o arquivo principal', 'err');
    return;
  }
  if (!confirm(`Excluir o arquivo "${name}" permanentemente?`)) return;
  
  try {
    await api(`/api/projects/${encodeURIComponent(S.project)}/files/${encodeURIComponent(name)}`, { method: 'DELETE' });
    toast('Arquivo excluído');
    if (S.mainFile === name) {
      // If we deleted the current file, switch back to main.tex
      switchFile('main.tex', 'text');
    }
    await refreshProjectFiles();
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

async function switchFile(name, type) {
  if (S.dirty) {
    if (!confirm('Alterações não salvas serão perdidas. Trocar de arquivo mesmo assim?')) return;
  }
  
  const imgPrev = $('image-preview');
  const txtArea = editor;
  const lNums = lineNums;

  if (type === 'image') {
    const url = `/api/projects/${encodeURIComponent(S.project)}/files/${encodeURIComponent(name)}`;
    imgPrev.innerHTML = `<img src="${url}?t=${Date.now()}" alt="${name}">`;
    imgPrev.classList.remove('hidden');
    txtArea.classList.add('hidden');
    lNums.classList.add('hidden');
    
    S.mainFile = name;
    $('file-name').textContent = name;
    renderFileList();
    return;
  }

  if (type === 'text') {
    try {
      const data = await api(`/api/projects/${encodeURIComponent(S.project)}/files/${encodeURIComponent(name)}`);
      imgPrev.classList.add('hidden');
      txtArea.classList.remove('hidden');
      lNums.classList.remove('hidden');
      
      S.mainFile = name;
      S.content = data.content || '';
      editor.value = S.content;
      $('file-name').textContent = name;
      S.dirty = false;
      updateSaveStatus('saved');
      renderLineNums();
      renderFileList();
    } catch (err) {
      toast('Erro ao carregar arquivo: ' + err.message, 'err');
    }
  }
}

// ─── UPLOAD ───
$('btn-new-file').onclick = createNewFile;
$('btn-upload-trigger').onclick = () => $('file-upload-input').click();

$('file-upload-input').onchange = async (e) => {
  const files = e.target.files;
  if (!files.length) return;
  
  const formData = new FormData();
  for (let f of files) formData.append('files', f);
  
  try {
    await api(`/api/projects/${encodeURIComponent(S.project)}/upload`, {
      method: 'POST',
      body: formData
    });
    toast(`Sucesso: ${files.length} arquivos carregados`);
    await refreshProjectFiles();
  } catch (err) {
    toast('Erro no upload: ' + err.message, 'err');
  }
  e.target.value = ''; // Reset input
};

window.selectProject = (name) => loadProject(name);

// ─── ACTIONS ───

// ─── ACTIONS ───

async function createNewProjectFromHome() {
  const input = $('home-new-project-name');
  const name = input.value.trim();
  if (!name) return;
  try {
    const res = await api('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    input.value = '';
    toast('Projeto criado com sucesso');
    // Load the project to switch to editor
    await loadProject(name);
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
    console.error('CreateProject error:', err);
    await refreshHomeProjects();
  }
}

$('home-btn-create').onclick = createNewProjectFromHome;

$('home-new-project-name').onkeydown = (e) => {
  if (e.key === 'Enter') createNewProjectFromHome();
};

window.deleteProject = async (name) => {
  if (!confirm(`Excluir o projeto "${name}" permanentemente?`)) return;
  try {
    await api(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
    toast('Projeto excluído');
    await refreshHomeProjects();
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
    console.error('DeleteProject error:', err);
  }
};

$('btn-back-home').onclick = () => {
  if (S.dirty) {
    if (!confirm('Alterações não salvas serão perdidas. Sair?')) return;
  }
  S.dirty = false;
  showView('home');
};

// ════════════════════════════════════
//  WEBSOCKET
// ════════════════════════════════════
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}`);
  ws.onmessage = e => {
    try {
      const m = JSON.parse(e.data);
      if (m.type === 'compile_log')  { logContent.textContent += m.data; logContent.scrollTop = 1e9; }
      if (m.type === 'compile_start'){ logContent.textContent = ''; logPanel.classList.add('open'); }
      if (m.type === 'compile_done') { finishCompile(m.success, m.pdfFile); }
    } catch {}
  };
  ws.onclose = () => setTimeout(connectWS, 2500);
}

// ════════════════════════════════════
//  EDITOR
// ════════════════════════════════════
editor.addEventListener('input', () => {
  S.content = editor.value;
  if (!S.dirty) {
    S.dirty = true;
    updateSaveStatus('dirty');
  }
  renderLineNums();
});

editor.addEventListener('scroll', () => {
  lineNums.scrollTop = editor.scrollTop;
});

editor.addEventListener('keydown', e => {
  if (e.key === 'Tab' && !S.autocomplete.visible) {
    e.preventDefault();
    const s = editor.selectionStart, en = editor.selectionEnd;
    editor.value = editor.value.slice(0,s) + '  ' + editor.value.slice(en);
    editor.selectionStart = editor.selectionEnd = s + 2;
    S.content = editor.value;
    if (!S.dirty) { S.dirty = true; updateSaveStatus('dirty'); }
    renderLineNums();
    return;
  }

  // ─── AUTOCOMPLETE CONTROLS ───
  if (S.autocomplete.visible) {
    const list = S.autocomplete.list;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      S.autocomplete.index = (S.autocomplete.index + 1) % list.length;
      updateAutocompleteUI();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      S.autocomplete.index = (S.autocomplete.index - 1 + list.length) % list.length;
      updateAutocompleteUI();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (list.length > 0) {
        e.preventDefault();
        insertCommand(list[S.autocomplete.index]);
        return;
      }
    }
    if (e.key === 'Escape') {
      hideAutocomplete();
      return;
    }
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveFile().then(() => compile());
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    compile();
  }
});

function renderLineNums() {
  const n = (editor.value.match(/\n/g) || []).length + 1;
  lineNums.textContent = Array.from({length: n}, (_, i) => i + 1).join('\n');
}

// ════════════════════════════════════
//  AUTOCOMPLETE LOGIC
// ════════════════════════════════════

const dropdown = document.createElement('div');
dropdown.className = 'autocomplete-dropdown';
document.body.appendChild(dropdown);

const ghost = document.createElement('div');
ghost.id = 'editor-ghost';
document.body.appendChild(ghost);

editor.addEventListener('input', (e) => {
  const text = editor.value;
  const pos = editor.selectionStart;
  
  // Find backslash before cursor
  const lastSlash = text.lastIndexOf('\\', pos - 1);
  
  if (lastSlash !== -1 && pos - lastSlash <= 15) { // Limit length for auto-trigger
    const q = text.substring(lastSlash + 1, pos);
    // Ensure only letters are in the query
    if (/^[a-zA-Z]*$/.test(q)) {
      showAutocomplete(q, lastSlash, pos);
    } else {
      hideAutocomplete();
    }
  } else {
    hideAutocomplete();
  }
});

function showAutocomplete(q, start, end) {
  const matches = LATEX_COMMANDS.filter(cmd => cmd.name.startsWith(q.toLowerCase()));
  if (matches.length === 0) {
    hideAutocomplete();
    return;
  }

  S.autocomplete.visible = true;
  S.autocomplete.query = q;
  S.autocomplete.list = matches;
  S.autocomplete.index = 0;
  S.autocomplete.start = start;
  S.autocomplete.end = end;

  renderAutocompleteList(matches);
  positionAutocomplete();
}

function hideAutocomplete() {
  S.autocomplete.visible = false;
  dropdown.style.display = 'none';
}

function renderAutocompleteList(list) {
  dropdown.innerHTML = '';
  list.forEach((cmd, i) => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item' + (i === S.autocomplete.index ? ' active' : '');
    item.innerHTML = `<span class="cmd-prefix">\\</span>${cmd.name}`;
    item.onclick = () => insertCommand(cmd);
    dropdown.appendChild(item);
  });
  dropdown.style.display = 'block';
}

function updateAutocompleteUI() {
  const items = dropdown.querySelectorAll('.autocomplete-item');
  items.forEach((it, i) => {
    it.className = 'autocomplete-item' + (i === S.autocomplete.index ? ' active' : '');
    if (i === S.autocomplete.index) it.scrollIntoView({ block: 'nearest' });
  });
}

function insertCommand(cmdObj) {
  const s = S.autocomplete.start;
  const e = S.autocomplete.end;
  const text = editor.value;
  
  // Use snippet if available, else just command name
  const snippet = cmdObj.snippet || cmdObj.name;
  let replacement = '\\' + snippet;
  
  // Simple snippet expansion: replace $1, $2, $0 with empty and position cursor
  // Find first placeholder index
  let firstPlaceholder = replacement.indexOf('$1');
  if (firstPlaceholder === -1) firstPlaceholder = replacement.indexOf('$0');
  
  // Clean placeholders
  const cleanReplacement = replacement.replace(/\$[0-9]/g, '');
  
  editor.value = text.substring(0, s) + cleanReplacement + text.substring(e);
  
  let newPos;
  if (firstPlaceholder !== -1) {
    newPos = s + firstPlaceholder;
  } else {
    newPos = s + cleanReplacement.length;
  }
  
  editor.selectionStart = editor.selectionEnd = newPos;
  
  S.content = editor.value;
  if (!S.dirty) { S.dirty = true; updateSaveStatus('dirty'); }
  renderLineNums();
  hideAutocomplete();
  editor.focus();
}

function positionAutocomplete() {
  const text = editor.value;
  const pos = S.autocomplete.start;
  
  // Get style from editor
  const styles = window.getComputedStyle(editor);
  const properties = [
    'font-family', 'font-size', 'line-height', 'padding', 'width', 'box-sizing', 
    'border', 'text-transform', 'letter-spacing', 'word-spacing', 'white-space'
  ];
  
  properties.forEach(p => ghost.style[p] = styles[p]);
  
  // Set text up to cursor, and a marker
  ghost.textContent = text.substring(0, pos);
  const span = document.createElement('span');
  span.textContent = '|';
  ghost.appendChild(span);
  
  // Position the ghost
  const rect = editor.getBoundingClientRect();
  ghost.style.top = rect.top + 'px';
  ghost.style.left = rect.left + 'px';
  ghost.style.width = styles.width;
  ghost.style.height = styles.height;
  ghost.scrollTop = editor.scrollTop;
  ghost.scrollLeft = editor.scrollLeft;
  
  const spanRect = span.getBoundingClientRect();
  
  // Constrain dropdown to viewport
  let top = spanRect.bottom + 2;
  let left = spanRect.left;
  
  // Make sure it doesn't go off screen
  const dropdownWidth = 180;
  const dropdownHeight = 200;
  
  if (left + dropdownWidth > window.innerWidth) {
    left = window.innerWidth - dropdownWidth - 10;
  }
  if (top + dropdownHeight > window.innerHeight) {
    top = spanRect.top - dropdownHeight - 2;
  }

  dropdown.style.top = top + 'px';
  dropdown.style.left = left + 'px';
}

// Close autocomplete on click outside
document.addEventListener('mousedown', (e) => {
  if (!dropdown.contains(e.target) && e.target !== editor) {
    hideAutocomplete();
  }
});

// ════════════════════════════════════
//  SAVE
// ════════════════════════════════════
async function saveFile() {
  if (!S.project || !S.mainFile) return;
  try {
    updateSaveStatus('saving');
    await api(`/api/projects/${encodeURIComponent(S.project)}/files/${encodeURIComponent(S.mainFile)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: S.content }),
    });
    S.dirty = false;
    updateSaveStatus('saved');
  } catch (err) {
    toast('Erro ao salvar: ' + err.message, 'err');
    updateSaveStatus('dirty');
  }
}

btnSave.onclick = saveFile;

function updateSaveStatus(state) {
  if (state === 'saved') {
    saveStatus.textContent = 'Salvo';
    saveStatus.className = 'save-status saved';
  } else if (state === 'dirty') {
    saveStatus.textContent = 'Modificado';
    saveStatus.className = 'save-status dirty';
  } else if (state === 'saving') {
    saveStatus.textContent = 'Salvando…';
    saveStatus.className = 'save-status';
  }
}

// ════════════════════════════════════
//  COMPILE
// ════════════════════════════════════
async function compile() {
  if (S.compiling || !S.project) return;
  if (S.dirty) await saveFile();

  S.compiling = true;
  $('spinner').classList.remove('hidden');
  $('compile-icon').classList.add('hidden');
  $('compile-label').textContent = 'Compilando…';
  btnCompile.disabled = true;
  compileBadge.className = 'compile-badge hidden';
  logContent.textContent = '';
  logPanel.classList.add('open');

  try {
    await api(`/api/projects/${encodeURIComponent(S.project)}/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mainFile: S.mainFile })
    });
  } catch (err) {
    finishCompile(false, null);
    toast('Erro: ' + err.message, 'err');
  }
}

btnCompile.onclick = compile;

function finishCompile(success, pdfFile) {
  S.compiling = false;
  $('spinner').classList.add('hidden');
  $('compile-icon').classList.remove('hidden');
  $('compile-label').textContent = 'Compilar PDF';
  btnCompile.disabled = false;

  if (success && pdfFile) {
    compileBadge.textContent = 'Feito';
    compileBadge.className = 'compile-badge ok';
    toast('Compilação concluída', 'ok');
    $('btn-download').disabled = false;
    setTimeout(() => { if (!S.compiling) logPanel.classList.remove('open'); }, 2000);
    loadPDF(pdfFile);
  } else {
    compileBadge.textContent = 'Erro';
    compileBadge.className = 'compile-badge err';
    toast('Erro na compilação', 'err');
  }
}

// ════════════════════════════════════
//  PDF
// ════════════════════════════════════
async function loadPDF(pdfFile) {
  S.pdfUrl = `/api/projects/${encodeURIComponent(S.project)}/files/${encodeURIComponent(pdfFile)}?t=${Date.now()}`;
  try {
    const res = await fetch(S.pdfUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    S.pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    pdfEmpty.classList.add('hidden');
    await renderAllPages();
  } catch (err) {
    console.error('loadPDF err:', err);
  }
}

async function renderAllPages() {
  if (!S.pdf) return;
  pdfPages.innerHTML = '';
  const total = S.pdf.numPages;
  $('page-count').textContent = `${total} pág.`;
  $('zoom-label').textContent = Math.round(S.pdfZoom * 100) + '%';

  for (let i = 1; i <= total; i++) {
    const page = await S.pdf.getPage(i);
    const viewport = page.getViewport({ scale: S.pdfZoom });
    const wrap = document.createElement('div');
    wrap.className = 'pdf-page-wrap';
    const num = document.createElement('div');
    num.className = 'pdf-page-num';
    num.textContent = `${i} / ${total}`;
    wrap.appendChild(num);
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    wrap.appendChild(canvas);
    pdfPages.appendChild(wrap);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }
}

$('btn-zoom-in').onclick = () => { S.pdfZoom = Math.min(4, +(S.pdfZoom+0.2).toFixed(1)); renderAllPages().catch(()=>{}); };
$('btn-zoom-out').onclick = () => { S.pdfZoom = Math.max(0.3, +(S.pdfZoom-0.2).toFixed(1)); renderAllPages().catch(()=>{}); };

$('btn-download').onclick = () => {
  if (S.pdfUrl) {
    const a = document.createElement('a');
    a.href = S.pdfUrl;
    a.download = 'document.pdf';
    a.click();
  }
};

// ════════════════════════════════════
//  SPLIT RESIZE
// ════════════════════════════════════
const splitHandle = $('split-handle');
const editorPanel = $('editor-panel');
splitHandle.addEventListener('mousedown', e0 => {
  const sx = e0.clientX, sw = editorPanel.offsetWidth;
  splitHandle.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  const onMove = e => {
    const w = sw + (e.clientX - sx);
    editorPanel.style.width = Math.max(200, Math.min(window.innerWidth - 200, w)) + 'px';
    if (S.pdf) renderAllPages().catch(()=>{});
  };
  const onUp = () => {
    splitHandle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// ════════════════════════════════════
//  MISC
// ════════════════════════════════════
$('btn-log').onclick = () => $('log-panel').classList.toggle('open');
$('btn-close-log').onclick = () => $('log-panel').classList.remove('open');

function toast(msg, type='ok') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// START
initApp();
