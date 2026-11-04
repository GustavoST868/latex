import { S } from './state.js';

export async function api(url, opts = {}) {
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

export function json(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// Encodes each segment so "/" keeps working as a separator
export const encodePath = p => p.split('/').map(encodeURIComponent).join('/');

export const projectUrl = (name = S.project) => `/api/projects/${encodeURIComponent(name)}`;
export const fileUrl = relPath => `${projectUrl()}/files/${encodePath(relPath)}`;
export const outputUrl = file => `${projectUrl()}/output/${encodeURIComponent(file)}`;
