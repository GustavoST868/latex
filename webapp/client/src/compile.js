import { $, toast } from './util.js';
import { S } from './state.js';
import { api, json, projectUrl, outputUrl } from './api.js';
import { getPref, setPref } from './prefs.js';
import { openMenu } from './menu.js';
import { saveFile, refreshDiagnostics, hasCodeCheckErrors } from './editor.js';
import { loadPDF } from './pdf.js';
import { parseTexLog, parseBlg, toProjectPath } from './log-parser.js';
import { setCompileDiagnostics } from './cm/lint.js';
import {
  initLogs, setLogOpen, toggleLog, clearLogs, startRawLog, appendRawLog, setLogResult, countErrors,
} from './logs.js';

export { setLogOpen, toggleLog };

const btnCompile = $('btn-compile');
const compileBadge = $('compile-badge');

// Per-browser compile options (Overleaf keeps these in the Recompile menu)
const OPTIONS = {
  auto: () => getPref('compile.auto', true),
  draft: () => getPref('compile.draft', false),
  stopOnFirstError: () => getPref('compile.stopOnFirstError', false),
};

let autoPending = false;
let autoTimer = null;

export function clearCompileState() {
  clearLogs();
  setCompileDiagnostics([]);
  compileBadge.className = 'compile-badge hidden';
}

export function updateCompileTarget() {
  btnCompile.title = S.settings?.mainFile
    ? `Compilar ${S.settings.mainFile} (Ctrl+Enter)`
    : 'Nenhum documento principal definido';
}

function setCompilingUI(on) {
  $('spinner').classList.toggle('hidden', !on);
  $('compile-icon').classList.toggle('hidden', on);
  $('compile-label').textContent = on ? 'Compilando…' : 'Recompilar';
  btnCompile.disabled = on;
}

function showBadge(text, kind) {
  compileBadge.textContent = text;
  compileBadge.className = `compile-badge ${kind}`;
}

// ════════════════════════════════════
//  COMPILE
// ════════════════════════════════════
export async function compile({ auto = false } = {}) {
  if (!S.project) return;
  if (S.compiling) {
    if (auto) autoPending = true;
    return;
  }
  if (!S.settings?.mainFile) {
    if (!auto) toast('Nenhum arquivo .tex encontrado no projeto', 'err');
    return;
  }
  const project = S.project;
  try {
    await saveFile({ silent: true });
  } catch {
    return;
  }

  S.compiling = true;
  setCompilingUI(true);
  compileBadge.className = 'compile-badge hidden';
  startRawLog();

  try {
    const result = await api(`${projectUrl(project)}/compile`, json('POST', {
      draft: OPTIONS.draft(),
      stopOnFirstError: OPTIONS.stopOnFirstError(),
    }));
    if (S.project !== project) return; // user left the project meanwhile
    await finishCompile(result, { auto });
  } catch (err) {
    showBadge('Erro', 'err');
    toast('Erro: ' + err.message, 'err');
  } finally {
    S.compiling = false;
    setCompilingUI(false);
    if (autoPending) {
      autoPending = false;
      scheduleAutoCompile(0);
    }
  }
}

// Reads the .log/.blg of the last run and turns them into log entries
async function loadLogEntries(result) {
  const read = async file => {
    if (!file) return '';
    try {
      const res = await fetch(`${outputUrl(file)}?t=${Date.now()}`);
      return res.ok ? res.text() : '';
    } catch {
      return '';
    }
  };
  const [texLog, blg] = await Promise.all([read(result.logFile), read(result.blgFile)]);
  const ctx = { compileDir: result.compileDir, root: result.projectRoot };
  return [...parseTexLog(texLog), ...parseBlg(blg)].map(e => ({ ...e, path: toProjectPath(e.file, ctx) }));
}

async function finishCompile(result, { auto }) {
  const { status, pdfFile, durationMs } = result;
  const entries = await loadLogEntries(result);
  setLogResult({ entries, rawLog: result.log, outputFiles: result.outputFiles });
  setCompileDiagnostics(entries);
  refreshDiagnostics();

  const secs = (durationMs / 1000).toFixed(1) + 's';
  const errors = countErrors();
  if (status === 'success' && !errors) {
    showBadge(secs, 'ok');
  } else if (status === 'success' || status === 'errors') {
    showBadge(`${errors || 'Com'} erro${errors === 1 ? '' : 's'} · ${secs}`, 'warn');
  } else if (status === 'stopped') {
    showBadge('Interrompida', 'warn');
  } else if (status === 'timeout') {
    showBadge('Tempo esgotado', 'err');
    if (!auto) setLogOpen(true);
  } else {
    showBadge('Erro', 'err');
    // No PDF: show what went wrong (but don't interrupt typing on auto-compiles)
    if (!auto) setLogOpen(true);
  }

  if (pdfFile) {
    try {
      await loadPDF(pdfFile);
    } catch (err) {
      console.error('loadPDF err:', err);
      toast('Não foi possível abrir o PDF', 'err');
    }
  }
}

async function stopCompile() {
  if (!S.compiling || !S.project) return;
  try {
    await api(`${projectUrl()}/compile/stop`, { method: 'POST' });
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

// ════════════════════════════════════
//  AUTO-COMPILE (after edits are saved, like Overleaf)
// ════════════════════════════════════
export function scheduleAutoCompile(delay = 500) {
  if (!OPTIONS.auto() || !S.project) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    // Overleaf skips auto-compiles while the code check finds problems
    if (hasCodeCheckErrors()) {
      showBadge('Verificação de código falhou', 'warn');
      return;
    }
    compile({ auto: true });
  }, delay);
}

// ════════════════════════════════════
//  WEBSOCKET
// ════════════════════════════════════

// Messages from the server for this project (also from compiles started in another window)
export function handleCompileMessage(m) {
  if (m.type === 'compile_log' && S.compiling) appendRawLog(m.data);
  if (m.type === 'compile_done' && !S.compiling && m.pdfFile) {
    loadPDF(m.pdfFile).catch(err => console.error('loadPDF err:', err));
  }
}

// ════════════════════════════════════
//  RECOMPILE MENU
// ════════════════════════════════════
function toggleOption(key, value) {
  setPref(`compile.${key}`, value);
}

function compileMenuItems() {
  return [
    { heading: 'Compilação automática' },
    { label: 'Ligada', checked: OPTIONS.auto(), action: () => toggleOption('auto', true) },
    { label: 'Desligada', checked: !OPTIONS.auto(), action: () => toggleOption('auto', false) },
    { heading: 'Modo de compilação' },
    { label: 'Normal', checked: !OPTIONS.draft(), action: () => toggleOption('draft', false) },
    { label: 'Rascunho (sem imagens, mais rápido)', checked: OPTIONS.draft(), action: () => toggleOption('draft', true) },
    { heading: 'Ao encontrar erros' },
    { label: 'Continuar e gerar o PDF', checked: !OPTIONS.stopOnFirstError(), action: () => toggleOption('stopOnFirstError', false) },
    { label: 'Parar no primeiro erro', checked: OPTIONS.stopOnFirstError(), action: () => toggleOption('stopOnFirstError', true) },
    '-',
    { label: 'Parar compilação', checked: false, disabled: !S.compiling, action: stopCompile },
    { label: 'Limpar arquivos em cache', checked: false, disabled: S.compiling, action: () => $('btn-clear-cache').click() },
  ];
}

export function initCompile() {
  btnCompile.onclick = () => compile();
  $('btn-log').onclick = toggleLog;
  const menuBtn = $('btn-compile-menu');
  menuBtn.addEventListener('mousedown', e => {
    e.preventDefault();
    openMenu(menuBtn, compileMenuItems());
  });
  initLogs({
    onClearCache: () => {
      setCompileDiagnostics([]);
      refreshDiagnostics();
    },
  });
}
