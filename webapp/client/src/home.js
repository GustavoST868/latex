import { $, el, icon, toast } from './util.js';
import { api, json, projectUrl } from './api.js';
import { loadProject } from './project.js';

const grid = $('home-projects-list');

function message(text) {
  grid.replaceChildren(el('div', { className: 'loading' }, text));
}

export async function refreshHomeProjects() {
  message('Carregando seus projetos...');
  try {
    const list = await api('/api/projects');
    if (list.length === 0) return message('Ninguém por aqui ainda. Crie seu primeiro projeto acima!');
    grid.replaceChildren(...list.map(projectCard));
  } catch (err) {
    message(`Erro: ${err.message}`);
  }
}

function projectCard(p) {
  const date = new Date(p.mtime).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  return el('div', { className: 'project-card', onclick: () => loadProject(p.name) },
    el('div', { className: 'project-icon' }, icon('article')),
    el('span', { className: 'project-name' }, p.name),
    el('span', { className: 'project-meta' }, `Modificado em ${date}`),
    el('div', { className: 'card-actions' },
      el('button', {
        className: 'icon-btn btn-delete',
        title: 'Excluir',
        onclick: e => { e.stopPropagation(); deleteProject(p.name); },
      }, icon('delete'))),
  );
}

async function createProject() {
  const input = $('home-new-project-name');
  const name = input.value.trim();
  if (!name) return;
  try {
    await api('/api/projects', json('POST', { name }));
    input.value = '';
    toast('Projeto criado com sucesso');
    await loadProject(name);
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
    await refreshHomeProjects();
  }
}

async function deleteProject(name) {
  if (!confirm(`Excluir o projeto "${name}" permanentemente?`)) return;
  try {
    await api(projectUrl(name), { method: 'DELETE' });
    toast('Projeto excluído');
    await refreshHomeProjects();
  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  }
}

export function initHome() {
  $('home-btn-create').onclick = createProject;
  $('home-new-project-name').onkeydown = e => {
    if (e.key === 'Enter') createProject();
  };
}
