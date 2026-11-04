import { S } from './state.js';
import { api, projectUrl } from './api.js';

// Project-wide data for autocompletion: labels, bib keys, custom commands, files
export const META = { labels: [], bibKeys: [], commands: [], files: [] };

let timer = null;

export async function refreshMeta() {
  if (!S.project) return;
  const project = S.project;
  try {
    const data = await api(`${projectUrl()}/metadata`);
    if (S.project === project) Object.assign(META, data);
  } catch (err) {
    console.warn('metadata:', err.message);
  }
}

// Coalesces refreshes after a burst of saves
export function scheduleMetaRefresh(delay = 1000) {
  clearTimeout(timer);
  timer = setTimeout(refreshMeta, delay);
}

export function clearMeta() {
  Object.assign(META, { labels: [], bibKeys: [], commands: [], files: [] });
}
