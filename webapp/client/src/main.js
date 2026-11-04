import 'material-symbols/outlined.css';
import './style.css';
import { $, showView, toast } from './util.js';
import { S } from './state.js';
import { api, projectUrl } from './api.js';
import { applyTheme, applyFontSize } from './prefs.js';
import { connectWS } from './ws.js';
import { initEditor, onSaved, getCursorPosition } from './editor.js';
import { initPDF, loadPDF } from './pdf.js';
import { initCompile, compile, handleCompileMessage, updateCompileTarget, scheduleAutoCompile } from './compile.js';
import { initProjectUI, closeProject, openFileAtLine } from './project.js';
import { initHome, refreshHomeProjects } from './home.js';
import { initLayout, onPanelShown, setLayout, getLayout } from './layout.js';
import { initSearch, focusSearch } from './search.js';
import { initMenus } from './menus.js';
import { initToolbar } from './toolbar.js';
import { initSynctex } from './synctex.js';

applyTheme();
applyFontSize();

// ════════════════════════════════════
//  GLOBAL SHORTCUTS
// ════════════════════════════════════
document.addEventListener('keydown', e => {
  if (!S.project) return;
  const mod = e.ctrlKey || e.metaKey;
  // Ctrl+S saves and recompiles, like Overleaf
  if (mod && (e.key === 's' || e.key === 'Enter')) {
    e.preventDefault();
    compile();
  }
});

window.addEventListener('beforeunload', e => {
  if (S.dirty) e.preventDefault();
});

// ════════════════════════════════════
//  DETACHED PDF WINDOW (#pdf=<project>)
// ════════════════════════════════════
async function startDetached(project) {
  document.body.classList.add('detached');
  document.title = `PDF – ${project}`;
  S.project = project;
  showView('editor');
  initPDF();
  initCompile();
  initSynctex({ isDetached: true });
  connectWS(handleCompileMessage);
  try {
    S.settings = await api(`${projectUrl()}/settings`);
    updateCompileTarget();
    // Show the last compiled PDF right away, if there is one
    const base = S.settings.mainFile?.split('/').pop().replace(/\.tex$/, '');
    if (base) await loadPDF(`${base}.pdf`).catch(() => {});
  } catch (err) {
    toast('Erro ao abrir o projeto: ' + err.message, 'err');
  }
}

// ════════════════════════════════════
//  START
// ════════════════════════════════════
const detachedProject = new URLSearchParams(location.hash.slice(1)).get('pdf');
// Switching between the editor and the detached PDF view needs a fresh page
window.addEventListener('hashchange', () => location.reload());

if (detachedProject) {
  startDetached(detachedProject);
} else {
  initEditor();
  initPDF({
    menuExtras: () => [{ label: 'Abrir em outra janela', icon: 'open_in_new', action: () => setLayout('detached'), disabled: !S.project }],
  });
  initCompile();
  initProjectUI();
  initHome();
  initLayout();
  initSearch({ onOpenHit: openFileAtLine });
  initMenus();
  initToolbar();
  onPanelShown(name => { if (name === 'search') focusSearch(); });
  onSaved(() => scheduleAutoCompile());
  initSynctex({ onOpenCode: openFileAtLine, getCursor: getCursorPosition, pdfDetached: () => getLayout() === 'detached' });

  $('btn-back-home').onclick = async () => {
    if (!(await closeProject())) return;
    showView('home');
    refreshHomeProjects();
  };

  connectWS(handleCompileMessage);
  showView('home');
  refreshHomeProjects();
}
