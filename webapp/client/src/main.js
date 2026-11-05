import 'material-symbols/outlined.css';
import './style.css';
import { $, showView, toast } from './util.js';
import { S } from './state.js';
import { api, projectUrl } from './api.js';
import { applyTheme, applyFontSize, applyEditorAppearance } from './prefs.js';
import { connectWS } from './ws.js';
import { initEditor, onSaved, getCursorPosition } from './editor.js';
import { initPDF, loadPDF } from './pdf.js';
import { initCompile, compile, handleCompileMessage, updateCompileTarget, scheduleAutoCompile } from './compile.js';
import { initProjectUI, closeProject, openFileAtLine, openFile, handleFilesChanged, reloadFromDisk } from './project.js';
import { initHome, refreshHomeProjects } from './home.js';
import { initLayout, onPanelShown, setLayout, getLayout } from './layout.js';
import { initSearch, focusSearch } from './search.js';
import { initMenus, paletteCommands } from './menus.js';
import { initOutline } from './outline.js';
import { initHistory } from './history.js';
import { initGitPanel, refreshGitPanel } from './gitpanel.js';
import { initPalette, fileCommands } from './palette.js';
import { initToolbar } from './toolbar.js';
import { initSynctex } from './synctex.js';
import { initChat, onChatShown } from './chat.js';
import { openSettings } from './settings.js';

applyTheme();
applyFontSize();
applyEditorAppearance();

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
  initOutline();
  initHistory({ onRestored: reloadFromDisk });
  initGitPanel({ onPulled: reloadFromDisk });
  initChat();
  $('btn-ai-settings').onclick = () => openSettings('ai');
  initPalette(() => [...paletteCommands(), ...fileCommands(openFile)]);
  onPanelShown(name => {
    if (name === 'search') focusSearch();
    if (name === 'git') refreshGitPanel();
    if (name === 'ai') onChatShown();
  });
  onSaved(() => scheduleAutoCompile());
  initSynctex({ onOpenCode: openFileAtLine, getCursor: getCursorPosition, pdfDetached: () => getLayout() === 'detached' });

  $('btn-back-home').onclick = async () => {
    if (!(await closeProject())) return;
    showView('home');
    refreshHomeProjects();
  };

  connectWS(msg => {
    handleCompileMessage(msg);
    if (msg.type === 'files_changed') handleFilesChanged(msg);
    // Projects added or removed outside the app
    if (msg.type === 'projects_changed' && !S.project) refreshHomeProjects();
  });
  showView('home');
  refreshHomeProjects();
}
