/* ── PDF.js Worker ── */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ════════════════════════════════════
//  DOM & STATE
// ════════════════════════════════════
const $ = id => document.getElementById(id);

const S = {
  project: null,
  mainFile: null,
  dirty: false,
  content: '',
  compiling: false,
  pdf: null,
  pdfZoom: 1.3,
  pdfUrl: null
};

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
    // Auto-discover the first project & main text file
    const config = await api('/api/config');
    S.project = config.project;
    S.mainFile = config.mainFile;

    $('file-name').textContent = S.mainFile;

    // Load file content
    const data = await api(`/api/projects/${encodeURIComponent(S.project)}/files/${encodeURIComponent(S.mainFile)}`);
    S.content = data.content || '';
    editor.value = S.content;
    renderLineNums();
    updateSaveStatus('saved');

    connectWS();
    
    // Attempt initial compile
    compile();
  } catch (err) {
    editor.value = 'Erro ao carregar projeto: ' + err.message;
    console.error(err);
  }
}

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
  // Tab -> 2 spaces
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = editor.selectionStart, en = editor.selectionEnd;
    editor.value = editor.value.slice(0,s) + '  ' + editor.value.slice(en);
    editor.selectionStart = editor.selectionEnd = s + 2;
    S.content = editor.value;
    if (!S.dirty) { S.dirty = true; updateSaveStatus('dirty'); }
    renderLineNums();
  }
  // Ctrl+S
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveFile();
  }
  // Ctrl+Enter
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
    // Handled by compile_done websocket message
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
    
    // Keep log open shortly, then close if success
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

    await page.render({
      canvasContext: canvas.getContext('2d'),
      viewport
    }).promise;
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
  const sx = e0.clientX;
  const sw = editorPanel.offsetWidth;
  splitHandle.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  const onMove = e => {
    const w = sw + (e.clientX - sx);
    editorPanel.style.width = Math.max(200, Math.min(window.innerWidth - 200, w)) + 'px';
    if (S.pdf) renderAllPages().catch(()=>{}); // re-render PDF if needed, though pure CSS scale might be smoother
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
