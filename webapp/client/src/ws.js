import { S } from './state.js';

let ws = null;
let handler = () => {};

export function connectWS(onMessage) {
  handler = onMessage;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);
  ws.onopen = () => joinProject(S.project);
  ws.onmessage = e => {
    try { handler(JSON.parse(e.data)); } catch {}
  };
  ws.onclose = () => setTimeout(() => connectWS(handler), 2500);
}

// Only receive compile messages for the project that is open
export function joinProject(name) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'join', project: name }));
}
