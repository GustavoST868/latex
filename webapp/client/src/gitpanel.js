import { $, el, icon, toast, promptModal } from './util.js';
import { S } from './state.js';
import { api, json, projectUrl } from './api.js';
import { saveFile } from './editor.js';

// "Git" panel: commit, pull and push when the project folder is a Git repository
const panel = $('git-body');
let busy = false;
let afterPull = async () => {};

const CODES = { M: 'alterado', A: 'novo', D: 'excluído', R: 'renomeado', '??': 'novo', U: 'conflito' };

function message(...children) {
  panel.replaceChildren(el('div', { className: 'git-section' }, ...children));
}

async function run(action, body = {}, doneMsg = '') {
  if (busy) return;
  busy = true;
  panel.classList.add('busy');
  try {
    await saveFile().catch(() => {});
    const status = await api(`${projectUrl()}/git/${action}`, json('POST', body));
    if (doneMsg) toast(doneMsg);
    render(status);
    if (action === 'pull') await afterPull();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    busy = false;
    panel.classList.remove('busy');
  }
}

async function setRemote(current) {
  const url = await promptModal({ title: 'Repositório remoto', label: 'Endereço (https://… ou git@…)', value: current, confirmLabel: 'Salvar' });
  if (url) run('remote', { url }, 'Remoto configurado');
}

function render(st) {
  if (!st.repo) {
    message(
      el('p', {}, 'Este projeto ainda não é um repositório Git.'),
      el('p', { className: 'hint-text' }, 'Transforme-o em um repositório para enviar e receber alterações do GitHub, GitLab ou outro servidor. O histórico de versões do editor continua funcionando de qualquer forma.'),
      el('button', { className: 'btn btn-primary', onclick: () => run('init', {}, 'Repositório criado') }, icon('add'), 'Criar repositório Git'),
    );
    return;
  }

  const textarea = el('textarea', { className: 'git-message', rows: 3, placeholder: 'Descreva as alterações…' });
  const commit = () => run('commit', { message: textarea.value }, 'Commit criado');
  textarea.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commit(); } });

  const sync = [];
  if (st.ahead) sync.push(`${st.ahead} commit(s) para enviar`);
  if (st.behind) sync.push(`${st.behind} commit(s) para receber`);

  panel.replaceChildren(
    el('div', { className: 'git-section' },
      el('div', { className: 'git-kv' }, icon('alt_route'), el('span', {}, 'Ramo'), el('strong', {}, st.branch || '—')),
      el('div', { className: 'git-kv' }, icon('cloud'), el('span', {}, 'Remoto'),
        el('button', { className: 'link-btn', title: st.remote || 'Configurar', onclick: () => setRemote(st.remote) }, st.remote ? st.remote.replace(/^https?:\/\//, '') : 'Configurar…')),
      st.last ? el('div', { className: 'git-kv' }, icon('commit'), el('span', {}, 'Último'), el('span', { className: 'git-last', title: st.last.message }, `${st.last.hash} ${st.last.message}`)) : null,
      sync.length ? el('div', { className: 'git-sync' }, sync.join(' · ')) : null,
    ),
    el('div', { className: 'git-section' },
      el('div', { className: 'git-subtitle' }, `Alterações (${st.changes.length})`),
      st.changes.length
        ? el('div', { className: 'git-changes' }, st.changes.map(c => el('div', { className: 'git-change', title: c.path },
          el('span', { className: `git-code c-${c.code.replace('??', 'N')[0]}` }, c.code === '??' ? 'N' : c.code[0]),
          el('span', { className: 'file-label' }, c.path),
          el('span', { className: 'git-code-label' }, CODES[c.code] || CODES[c.code[0]] || ''))))
        : el('p', { className: 'hint-text' }, 'Nenhuma alteração desde o último commit.'),
      textarea,
      el('button', { className: 'btn btn-primary', disabled: !st.changes.length, onclick: commit }, icon('check'), 'Fazer commit'),
    ),
    el('div', { className: 'git-section git-actions' },
      el('button', { className: 'btn btn-ghost', disabled: !st.remote, onclick: () => run('pull', {}, 'Alterações recebidas') }, icon('download'), 'Receber (pull)'),
      el('button', { className: 'btn btn-ghost', disabled: !st.remote, onclick: () => run('push', {}, 'Alterações enviadas') }, icon('upload'), 'Enviar (push)'),
    ),
  );
}

export async function refreshGitPanel() {
  if (!S.project) return;
  const project = S.project;
  try {
    const st = await api(`${projectUrl()}/git`);
    if (S.project === project) render(st);
  } catch (err) {
    message(el('p', {}, 'Erro: ' + err.message));
  }
}

export function initGitPanel({ onPulled }) {
  afterPull = onPulled;
  $('btn-git-refresh').onclick = refreshGitPanel;
}
