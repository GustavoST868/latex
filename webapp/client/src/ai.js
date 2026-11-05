import { api, json } from './api.js';
import { getPref, setPref } from './prefs.js';

// Talks to local models through the server's Ollama proxy (/api/ai/*)
export const AI_DEFAULTS = {
  model: '',          // empty: pick the best installed model
  think: false,       // let "thinking" models reason first (better, much slower)
  context: 'nearby',  // what the chat sends along: none | nearby | file
};

export const aiPref = key => getPref(`ai.${key}`, AI_DEFAULTS[key]);
export const setAiPref = (key, value) => setPref(`ai.${key}`, value);
export const aiEnabled = () => getPref('editor.ai', true);

// Used when no model was chosen: good LaTeX writers first, tiny models last
const PREFERRED = [/^qwen3\.5/, /^qwen3/, /^gemma4/, /^gemma3/, /^llama3\.1/, /^mistral/, /^qwen/, /^llama/];

let statusPromise = null;

/** { available, url, models: [{ name, size, thinking }], error } — cached until `refresh`. */
export function aiStatus({ refresh = false } = {}) {
  if (!statusPromise || refresh) {
    statusPromise = api('/api/ai/models').catch(err => ({ available: false, models: [], error: err.message }));
  }
  return statusPromise;
}

export function pickModel(models) {
  const saved = aiPref('model');
  if (models.some(m => m.name === saved)) return saved;
  for (const re of PREFERRED) {
    const hit = models.find(m => re.test(m.name) && !/uncensored/i.test(m.name));
    if (hit) return hit.name;
  }
  return models[0]?.name || '';
}

// Hidden reasoning some models put in the answer itself
export const stripThinking = text => text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');

/**
 * Streams a reply. `mode` picks the server's system prompt ('chat' or 'edit').
 * `onUpdate({ text, thinking })` runs as tokens arrive; resolves with the final text.
 */
export async function streamChat({ mode = 'chat', messages, signal, onUpdate }) {
  const status = await aiStatus();
  if (!status.available) {
    statusPromise = null; // try again next time, Ollama may have been started meanwhile
    throw new Error(status.error || 'O Ollama não está disponível');
  }
  const model = pickModel(status.models);
  if (!model) throw new Error('Nenhum modelo instalado no Ollama. No terminal, rode por exemplo: ollama pull qwen3.5:9b');

  const res = await fetch('/api/ai/chat', { ...json('POST', { model, mode, messages, think: aiPref('think') }), signal });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '', text = '', thinking = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(msg.error);
      text += msg.message?.content || '';
      thinking += msg.message?.thinking || '';
      onUpdate?.({ text: stripThinking(text), thinking });
    }
  }
  return { text: stripThinking(text), thinking, model };
}
