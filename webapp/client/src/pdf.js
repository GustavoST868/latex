import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { $, el, download } from './util.js';
import { S } from './state.js';
import { outputUrl } from './api.js';
import { getPref, setPref } from './prefs.js';
import { openMenu } from './menu.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
// The viewer components read the core library from this global
globalThis.pdfjsLib = pdfjsLib;

const pdfPane = $('pdf-pane');
const pdfPages = $('pdf-pages');
const pdfEmpty = $('pdf-empty');
const pdfScroll = $('pdf-scroll');
const pageInput = $('page-input');

const MIN_SCALE = 0.25, MAX_SCALE = 5;

let lib = null;      // pdf_viewer module (loaded on first use)
let viewer = null;
let eventBus = null;
let linkService = null;
let loadToken = 0;
let onMenuExtras = () => [];

// ════════════════════════════════════
//  VIEWER
// ════════════════════════════════════
async function ensureViewer() {
  if (viewer) return viewer;
  lib ??= await import('pdfjs-dist/web/pdf_viewer.mjs');
  eventBus = new lib.EventBus();
  linkService = new lib.PDFLinkService({ eventBus, externalLinkTarget: lib.LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer' });
  viewer = new lib.PDFViewer({
    container: pdfScroll,
    viewer: pdfPages,
    eventBus,
    linkService,
    textLayerMode: 1,        // selectable text
    annotationMode: pdfjsLib.AnnotationMode.ENABLE, // clickable links
  });
  linkService.setViewer(viewer);

  eventBus.on('pagechanging', e => { pageInput.value = e.pageNumber; });
  eventBus.on('scalechanging', e => { $('zoom-label').textContent = Math.round(e.scale * 100) + '%'; });
  return viewer;
}

export const getViewer = () => viewer;

export function resetPDF() {
  loadToken++;
  if (viewer) viewer.setDocument(null);
  if (linkService) linkService.setDocument(null);
  if (S.pdf) S.pdf.destroy();
  S.pdf = null;
  S.pdfUrl = null;
  S.pdfFile = null;
  pdfEmpty.classList.remove('hidden');
  $('page-count').textContent = '';
  pageInput.value = '';
  pageInput.disabled = true;
  $('btn-download').disabled = true;
}

const savedScale = () => getPref('pdf.scale', 'page-width');

export async function loadPDF(pdfFile) {
  const token = ++loadToken;
  const url = `${outputUrl(pdfFile)}?t=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = await pdfjsLib.getDocument({ data: await res.arrayBuffer() }).promise;
  await ensureViewer();
  if (token !== loadToken) return doc.destroy(); // a newer load started

  // Keep zoom and reading position across recompiles
  const keep = S.pdf ? { scale: viewer.currentScaleValue, top: pdfScroll.scrollTop, left: pdfScroll.scrollLeft } : null;
  const old = S.pdf;
  const inited = new Promise(resolve => eventBus.on('pagesinit', resolve, { once: true }));
  S.pdf = doc;
  S.pdfUrl = url;
  S.pdfFile = pdfFile;
  viewer.setDocument(doc);
  linkService.setDocument(doc);
  await inited;
  viewer.currentScaleValue = keep?.scale || savedScale();
  if (keep) {
    pdfScroll.scrollTop = keep.top;
    pdfScroll.scrollLeft = keep.left;
  }
  old?.destroy();

  pdfEmpty.classList.add('hidden');
  $('page-count').textContent = `/ ${doc.numPages}`;
  pageInput.disabled = false;
  pageInput.value = viewer.currentPageNumber;
  $('btn-download').disabled = false;
}

// ════════════════════════════════════
//  ZOOM
// ════════════════════════════════════
function setScale(value) {
  if (!viewer || !S.pdf) return;
  viewer.currentScaleValue = String(value);
  setPref('pdf.scale', String(value));
}

export function zoomIn() {
  if (!viewer || !S.pdf) return;
  setScale(Math.min(MAX_SCALE, +(viewer.currentScale * 1.1).toFixed(2)));
}

export function zoomOut() {
  if (!viewer || !S.pdf) return;
  setScale(Math.max(MIN_SCALE, +(viewer.currentScale / 1.1).toFixed(2)));
}

function zoomMenuItems() {
  const current = viewer?.currentScaleValue;
  return [
    { label: 'Ajustar à largura', checked: current === 'page-width', action: () => setScale('page-width') },
    { label: 'Ajustar à página', checked: current === 'page-fit', action: () => setScale('page-fit') },
    '-',
    ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map(v => ({
      label: `${v * 100}%`, checked: Number(current) === v, action: () => setScale(v),
    })),
  ];
}

// Ctrl + wheel zooms around the mouse pointer
function onWheel(e) {
  if (!(e.ctrlKey || e.metaKey) || !viewer || !S.pdf) return;
  e.preventDefault();
  const rect = pdfScroll.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const old = viewer.currentScale;
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  if (next === old) return;
  const sx = pdfScroll.scrollLeft + x, sy = pdfScroll.scrollTop + y;
  viewer.currentScale = next;
  setPref('pdf.scale', String(next));
  const ratio = next / old;
  pdfScroll.scrollLeft = sx * ratio - x;
  pdfScroll.scrollTop = sy * ratio - y;
}

// ════════════════════════════════════
//  FULL SCREEN & PRESENTATION
// ════════════════════════════════════
let presenting = null; // saved state while in presentation mode

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else pdfPane.requestFullscreen?.();
}

async function startPresentation() {
  if (!viewer || !S.pdf) return;
  presenting = { scale: viewer.currentScaleValue, page: viewer.currentPageNumber };
  pdfPane.classList.add('presenting');
  try {
    await pdfPane.requestFullscreen();
  } catch {
    stopPresentation();
    return;
  }
  viewer.scrollMode = lib.ScrollMode.PAGE;
  viewer.currentScaleValue = 'page-fit';
  viewer.currentPageNumber = presenting.page;
}

function stopPresentation() {
  if (!presenting) return;
  pdfPane.classList.remove('presenting');
  viewer.scrollMode = lib.ScrollMode.VERTICAL;
  viewer.currentScaleValue = presenting.scale;
  viewer.currentPageNumber = viewer.currentPageNumber;
  presenting = null;
}

function onPresentationKey(e) {
  if (!presenting) return;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); viewer.nextPage(); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); viewer.previousPage(); }
  else if (e.key === 'Home') viewer.currentPageNumber = 1;
  else if (e.key === 'End') viewer.currentPageNumber = S.pdf.numPages;
}

// ════════════════════════════════════
//  DARK PDF
// ════════════════════════════════════
function applyDarkPdf() {
  pdfPane.classList.toggle('pdf-dark', getPref('pdf.dark', false));
}

export function downloadPDF() {
  if (S.pdfUrl) download(S.pdfUrl, S.pdfFile);
}

function pdfMenuItems() {
  const dark = getPref('pdf.dark', false);
  return [
    { label: 'Tela cheia', icon: 'fullscreen', action: toggleFullscreen, disabled: !S.pdf },
    { label: 'Modo apresentação', icon: 'slideshow', action: startPresentation, disabled: !S.pdf },
    '-',
    { label: dark ? 'PDF com cores normais' : 'PDF escuro (inverter cores)', icon: dark ? 'light_mode' : 'dark_mode', action: () => { setPref('pdf.dark', !dark); applyDarkPdf(); } },
    { label: 'Baixar PDF', icon: 'download', action: downloadPDF, disabled: !S.pdf },
    ...onMenuExtras(),
  ];
}

// Coordinates of a point of the page, in PDF points from the top-left corner (as SyncTeX expects)
export function pdfPointAt(pageNumber, clientX, clientY) {
  const pageView = viewer?.getPageView(pageNumber - 1);
  const wrapper = pageView?.div.querySelector('.canvasWrapper');
  if (!pageView || !wrapper) return null;
  const rect = wrapper.getBoundingClientRect();
  const [px, py] = pageView.viewport.convertToPdfPoint(clientX - rect.left, clientY - rect.top);
  const view = pageView.pdfPage.view;
  return { page: pageNumber, h: px - view[0], v: view[3] - py };
}

/**
 * Scrolls to and briefly highlights SyncTeX boxes ({ page, h, v, width, height },
 * v = baseline from the top of the page).
 */
export function highlightBoxes(boxes) {
  if (!viewer || !S.pdf || !boxes.length) return;
  const page = boxes[0].page;
  const pageView = viewer.getPageView(page - 1);
  if (!pageView) return;
  const view = pageView.pdfPage.view;
  const first = boxes[0];
  viewer.scrollPageIntoView({
    pageNumber: page,
    destArray: [null, { name: 'XYZ' }, null, view[3] - (first.v - first.height) + 40, null],
    allowNegativeOffset: true,
  });

  // Draw after the page has been laid out at its scroll position
  requestAnimationFrame(() => {
    const wrapper = pageView.div.querySelector('.canvasWrapper') || pageView.div;
    for (const box of boxes.filter(b => b.page === page).slice(0, 6)) {
      const x1 = view[0] + box.h, x2 = x1 + box.width;
      const y1 = view[3] - box.v, y2 = view[3] - (box.v - box.height);
      const [a, b, c, d] = pageView.viewport.convertToViewportRectangle([x1, y1, x2, y2]);
      const mark = el('div', { className: 'synctex-highlight' });
      Object.assign(mark.style, {
        left: wrapper.offsetLeft + Math.min(a, c) + 'px',
        top: wrapper.offsetTop + Math.min(b, d) + 'px',
        width: Math.max(4, Math.abs(c - a)) + 'px',
        height: Math.max(4, Math.abs(d - b)) + 'px',
      });
      pageView.div.appendChild(mark);
      setTimeout(() => mark.remove(), 2000);
    }
  });
}

// ════════════════════════════════════
//  INIT
// ════════════════════════════════════
export function initPDF({ menuExtras = () => [] } = {}) {
  onMenuExtras = menuExtras;
  $('btn-zoom-in').onclick = zoomIn;
  $('btn-zoom-out').onclick = zoomOut;
  $('btn-download').onclick = downloadPDF;
  const zoomBtn = $('btn-zoom-menu');
  zoomBtn.addEventListener('mousedown', e => { e.preventDefault(); openMenu(zoomBtn, zoomMenuItems(), { align: 'right' }); });
  const menuBtn = $('btn-pdf-menu');
  menuBtn.addEventListener('mousedown', e => { e.preventDefault(); openMenu(menuBtn, pdfMenuItems(), { align: 'right' }); });

  pageInput.addEventListener('change', () => {
    const n = parseInt(pageInput.value, 10);
    if (viewer && S.pdf && n >= 1 && n <= S.pdf.numPages) viewer.currentPageNumber = n;
    else if (viewer) pageInput.value = viewer.currentPageNumber;
  });
  pageInput.addEventListener('focus', () => pageInput.select());

  pdfScroll.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('keydown', onPresentationKey);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) stopPresentation();
  });
  pdfPages.addEventListener('click', () => { if (presenting) viewer.nextPage(); });
  applyDarkPdf();

  // Resizing the pane keeps "fit width/page" modes fitted
  new ResizeObserver(() => {
    if (viewer && S.pdf && isNaN(Number(viewer.currentScaleValue))) viewer.currentScaleValue = viewer.currentScaleValue;
  }).observe(pdfScroll);
}

