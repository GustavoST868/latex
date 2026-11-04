import { $, toast } from './util.js';
import { S } from './state.js';
import { api, projectUrl } from './api.js';
import { getViewer, pdfPointAt, highlightBoxes } from './pdf.js';

// Main window and the detached PDF window talk over this channel
let channel = null;
let detached = false;
let openInEditor = null;   // (path, line) => void, main window only
let isPdfDetached = () => false;

function ensureChannel() {
  if (!S.project || typeof BroadcastChannel === 'undefined') return null;
  const name = `latex-sync:${S.project}`;
  if (channel?.name !== name) {
    channel?.close();
    channel = new BroadcastChannel(name);
    channel.onmessage = e => onChannelMessage(e.data);
  }
  return channel;
}

function onChannelMessage(msg) {
  if (msg.type === 'open-code' && !detached) {
    openInEditor?.(msg.file, msg.line);
    window.focus();
  }
  if (msg.type === 'show-pdf' && detached) highlightBoxes(msg.boxes);
}

// ════════════════════════════════════
//  PDF → CODE
// ════════════════════════════════════
async function syncFromPoint(point) {
  if (!point || !S.project) return;
  try {
    const hit = await api(`${projectUrl()}/synctex/pdf?page=${point.page}&h=${point.h.toFixed(2)}&v=${point.v.toFixed(2)}`);
    if (detached) {
      ensureChannel()?.postMessage({ type: 'open-code', file: hit.file, line: hit.line });
      window.opener?.focus();
    } else {
      openInEditor?.(hit.file, hit.line);
    }
  } catch (err) {
    toast(err.message, 'err');
  }
}

function onDoubleClick(e) {
  const pageDiv = e.target.closest('.page[data-page-number]');
  if (!pageDiv) return;
  syncFromPoint(pdfPointAt(Number(pageDiv.dataset.pageNumber), e.clientX, e.clientY));
}

// Uses the middle of the visible part of the PDF
export function syncToCode() {
  const viewer = getViewer();
  if (!viewer || !S.pdf) return toast('Compile o projeto primeiro', 'err');
  const scroll = $('pdf-scroll').getBoundingClientRect();
  const cx = scroll.left + scroll.width / 2, cy = scroll.top + scroll.height / 3;
  const pageDiv = document.elementsFromPoint(cx, cy).find(n => n.matches?.('.page[data-page-number]'));
  const pageNumber = pageDiv ? Number(pageDiv.dataset.pageNumber) : viewer.currentPageNumber;
  syncFromPoint(pdfPointAt(pageNumber, cx, cy));
}

// ════════════════════════════════════
//  CODE → PDF
// ════════════════════════════════════
export async function syncToPdf({ line, column }) {
  if (!S.project || S.openFile?.type !== 'text') return;
  if (!S.pdf && !isPdfDetached()) return toast('Compile o projeto primeiro', 'err');
  const file = encodeURIComponent(S.openFile.path);
  try {
    const { boxes } = await api(`${projectUrl()}/synctex/code?file=${file}&line=${line}&column=${column}`);
    if (isPdfDetached()) ensureChannel()?.postMessage({ type: 'show-pdf', boxes });
    else highlightBoxes(boxes);
  } catch (err) {
    toast(err.message, 'err');
  }
}

export function initSynctex({ isDetached = false, onOpenCode = null, getCursor = null, pdfDetached = () => false } = {}) {
  detached = isDetached;
  openInEditor = onOpenCode;
  isPdfDetached = pdfDetached;
  $('pdf-pages').addEventListener('dblclick', onDoubleClick);
  ensureChannel();
  if (!detached) {
    $('btn-sync-pdf').onclick = () => { const c = getCursor?.(); if (c) syncToPdf(c); };
    $('btn-sync-code').onclick = syncToCode;
  }
}

// Re-subscribe when another project is opened
export function joinSyncChannel() {
  ensureChannel();
}
