const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const chokidar = require('chokidar');
const git = require('./git');

const PORT = process.env.PORT || 3000;
// Só escuta na máquina local por padrão: o servidor executa LaTeX e escreve em disco
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws', verifyClient: ({ req }) => trustedRequest(req) });
// Listen errors are reported once, by the HTTP server's handler below
wss.on('error', () => {});

// Projects directory - each project is a subfolder
const PROJECTS_DIR = path.resolve(process.env.PROJECTS_DIR || path.join(__dirname, 'projects'));
if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });

const DIST_DIR = path.join(__dirname, 'dist');
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// Arquivos internos de cada projeto (ocultos na árvore de arquivos)
const META_FILE = '.project.json';
const OUTPUT_DIR = '.output';

const COMPILERS = ['pdflatex', 'xelatex', 'lualatex'];
const LATEXMK_ENGINE_FLAG = { pdflatex: '-pdf', xelatex: '-pdfxe', lualatex: '-pdflua' };
const COMPILE_TIMEOUTS = [30, 60, 120, 240, 600]; // seconds

const TEXT_EXTS = new Set([
  '.tex', '.bib', '.txt', '.md', '.sty', '.cls', '.bst', '.bbx', '.cbx', '.cfg', '.def',
  '.clo', '.ltx', '.dtx', '.ins', '.tikz', '.csv', '.tsv', '.json', '.yml', '.yaml',
  '.sh', '.js', '.css', '.html', '.xml', '.lua', '.py', '.r', '.gitignore'
]);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);

// Other websites open in the browser must not drive this server: reject unknown Host
// headers (DNS rebinding) and cross-site writes (CSRF). Loopback origins are fine,
// which keeps the Vite dev server working.
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LISTENS_ON_LOOPBACK = /^(localhost|127\.0\.0\.1|::1)$/.test(HOST);

function trustedOrigin(origin, host) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.host === host || LOOPBACK_HOST.test(url.host);
  } catch (e) {
    return false;
  }
}

function trustedRequest(req) {
  const host = req.headers.host || '';
  if (LISTENS_ON_LOOPBACK && !LOOPBACK_HOST.test(host)) return false;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.headers.upgrade) return true;
  return trustedOrigin(req.headers.origin, host) && req.headers['sec-fetch-site'] !== 'cross-site';
}

app.use((req, res, next) => {
  if (trustedRequest(req)) return next();
  res.status(403).json({ error: 'Requisição de outro site bloqueada' });
});

app.use(express.json({ limit: '50mb' }));

// Projects with a compile in progress (value: the latexmk process)
const compiling = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wraps a handler so thrown errors become JSON responses
function route(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error('[API]', e);
      if (!res.headersSent) res.status(status).json({ error: e.message });
    }
  };
}

function validateProjectName(name) {
  if (typeof name !== 'string') throw new HttpError(400, 'Nome de projeto inválido');
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) throw new HttpError(400, 'Nome de projeto inválido');
  if (/[\/\\\x00-\x1f]/.test(trimmed) || trimmed.startsWith('.')) {
    throw new HttpError(400, 'O nome não pode conter "/", "\\" nem começar com "."');
  }
  return trimmed;
}

// Absolute path of an existing project
function projectDir(name) {
  const dir = path.join(PROJECTS_DIR, validateProjectName(name));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new HttpError(404, 'Projeto não encontrado');
  return dir;
}

// Resolves a path inside a project, rejecting traversal and hidden/internal files
function safeResolve(dir, relPath) {
  if (typeof relPath !== 'string' || !relPath) throw new HttpError(400, 'Caminho inválido');
  const segments = relPath.split(/[\/\\]/).filter(Boolean);
  if (!segments.length || segments.some(s => s.startsWith('.'))) {
    throw new HttpError(403, 'Caminho não permitido');
  }
  const resolved = path.resolve(dir, ...segments);
  if (!resolved.startsWith(dir + path.sep)) throw new HttpError(403, 'Caminho não permitido');
  return resolved;
}

function fileType(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (!ext || TEXT_EXTS.has(ext)) return 'text';
  return 'binary';
}

function listFiles(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith('.'))
    .map(entry => {
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return { name: entry.name, path: relPath, type: 'folder', children: listFiles(abs, relPath) };
      }
      return { name: entry.name, path: relPath, type: fileType(entry.name), size: fs.statSync(abs).size };
    });
}

// Finds the most likely root document: main.tex, then any .tex with \documentclass
function detectMainFile(dir) {
  if (fs.existsSync(path.join(dir, 'main.tex'))) return 'main.tex';
  const texFiles = [];
  (function walk(d, base, depth) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory() && depth < 3) walk(path.join(d, entry.name), rel, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.tex')) texFiles.push(rel);
    }
  })(dir, '', 0);
  // Root-level files first, then shallower paths
  texFiles.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const withClass = texFiles.find(f => {
    try {
      return /^[^%\n]*\\documentclass/m.test(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) { return false; }
  });
  return withClass || texFiles[0] || null;
}

function readMeta(dir) {
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, META_FILE), 'utf8')); } catch (e) {}
  if (!COMPILERS.includes(meta.compiler)) meta.compiler = 'pdflatex';
  meta.shellEscape = meta.shellEscape === true;
  if (!COMPILE_TIMEOUTS.includes(meta.timeout)) meta.timeout = 120;
  meta.archived = meta.archived === true;
  meta.trashed = meta.trashed === true;
  meta.tags = Array.isArray(meta.tags) ? meta.tags.filter(t => typeof t === 'string') : [];
  if (!meta.mainFile || !fs.existsSync(path.join(dir, meta.mainFile))) {
    meta.mainFile = detectMainFile(dir);
  }
  return meta;
}

function writeMeta(dir, meta) {
  fs.writeFileSync(path.join(dir, META_FILE), JSON.stringify(meta, null, 2));
}

// ─── WebSocket (one "room" per project) ───────────────────────────────────────

wss.on('connection', ws => {
  ws.project = null;
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'join') ws.project = typeof msg.project === 'string' ? msg.project : null;
    } catch (e) {}
  });
});

function broadcastTo(project, data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.project === project) client.send(payload);
  });
}

// ─── Projects API ─────────────────────────────────────────────────────────────

// Newest modification time among the project's own files
function lastModified(dir) {
  let newest = fs.statSync(dir).mtimeMs;
  (function walk(d, depth) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(d, entry.name);
      if (entry.isDirectory()) { if (depth < 6) walk(abs, depth + 1); continue; }
      try { newest = Math.max(newest, fs.statSync(abs).mtimeMs); } catch (e) {}
    }
  })(dir, 0);
  return new Date(newest);
}

function compiledPdfName(dir, meta) {
  if (!meta.mainFile) return null;
  const pdf = path.basename(meta.mainFile, '.tex') + '.pdf';
  return fs.existsSync(path.join(dir, OUTPUT_DIR, pdf)) ? pdf : null;
}

// List all projects (the dashboard filters archived/trashed/tags on the client)
app.get('/api/projects', route((req, res) => {
  const projects = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => {
      const dir = path.join(PROJECTS_DIR, d.name);
      const meta = readMeta(dir);
      return {
        name: d.name,
        mtime: lastModified(dir),
        archived: meta.archived,
        trashed: meta.trashed,
        tags: meta.tags,
        pdfFile: compiledPdfName(dir, meta),
        git: git.isRepo(dir),
      };
    })
    .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  res.json(projects);
}));

function listTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      try {
        const info = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, d.name, 'template.json'), 'utf8'));
        return { id: d.name, ...info };
      } catch (e) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (a.order || 99) - (b.order || 99));
}

app.get('/api/templates', route((req, res) => res.json(listTemplates())));

// Reserves a new project folder, failing if the name is taken
function newProjectDir(rawName) {
  const name = validateProjectName(rawName);
  const dir = path.join(PROJECTS_DIR, name);
  if (fs.existsSync(dir)) throw new HttpError(409, 'Já existe um projeto com esse nome');
  return { name, dir };
}

// Settings and a first history entry for a freshly created project
function initProject(dir, message) {
  writeMeta(dir, { ...readMeta(dir), createdAt: new Date() });
  git.snapshot(dir, message).catch(err => console.warn('[history]', err.message));
}

// Create new project from a template
app.post('/api/projects', route((req, res) => {
  const { name, dir } = newProjectDir(req.body.name);
  const templateId = String(req.body.template || 'blank');
  const template = listTemplates().find(t => t.id === templateId);
  if (!template) throw new HttpError(400, 'Modelo não encontrado');

  const src = path.join(TEMPLATES_DIR, template.id);
  const title = name.replace(/[\\{}$&#^_%~]/g, '');
  fs.cpSync(src, dir, { recursive: true, filter: s => path.basename(s) !== 'template.json' });
  for (const file of listFiles(dir)) {
    if (file.type !== 'text') continue;
    const abs = path.join(dir, file.path);
    fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replaceAll('{{TITLE}}', title));
  }
  initProject(dir, `Projeto criado (${template.title})`);
  console.log(`[API] Project created: ${name} (${template.id})`);
  res.json({ name, created: true });
}));

// Create a project from an uploaded .zip
const zipUpload = multer({ dest: path.join(os.tmpdir(), 'latex-uploads'), limits: { fileSize: 200 * 1024 * 1024 } });
app.post('/api/projects/import-zip', zipUpload.single('file'), route((req, res) => {
  const file = req.file;
  try {
    if (!file) throw new HttpError(400, 'Envie um arquivo .zip');
    const rawName = req.body.name || path.basename(file.originalname || 'Projeto', '.zip');
    const { name, dir } = newProjectDir(rawName);
    let entries;
    try {
      entries = new AdmZip(file.path).getEntries().filter(e => !e.isDirectory && !e.entryName.startsWith('__MACOSX/'));
    } catch (e) {
      throw new HttpError(400, 'Arquivo .zip inválido');
    }
    if (!entries.length) throw new HttpError(400, 'O .zip está vazio');
    // A zip with a single top-level folder is unwrapped
    const tops = new Set(entries.map(e => e.entryName.split('/')[0]));
    const strip = tops.size === 1 && entries.every(e => e.entryName.includes('/')) ? [...tops][0] + '/' : '';
    fs.mkdirSync(dir);
    try {
      for (const entry of entries) {
        const rel = entry.entryName.slice(strip.length);
        if (!rel || rel.split('/').some(s => s.startsWith('.'))) continue; // skip hidden files
        const dest = safeResolve(dir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, entry.getData());
      }
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw e;
    }
    initProject(dir, 'Projeto importado de um .zip');
    res.json({ name, created: true });
  } finally {
    if (file) fs.rm(file.path, { force: true }, () => {});
  }
}));

// Create a project by cloning a Git repository
app.post('/api/projects/import-git', route(async (req, res) => {
  const url = String(req.body.url || '').trim();
  const fallback = path.basename(url.replace(/\/+$/, ''), '.git') || 'Projeto';
  const { name, dir } = newProjectDir(req.body.name || fallback);
  await git.cloneInto(url, dir);
  initProject(dir, 'Projeto clonado de um repositório Git');
  res.json({ name, created: true });
}));

// Delete project
app.delete('/api/projects/:name', route((req, res) => {
  const dir = projectDir(req.params.name);
  if (compiling.has(req.params.name)) throw new HttpError(409, 'Aguarde a compilação terminar');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`[API] Project deleted: ${req.params.name}`);
  res.json({ deleted: true });
}));

// Rename project
app.post('/api/projects/:name/rename', route((req, res) => {
  const dir = projectDir(req.params.name);
  if (compiling.has(req.params.name)) throw new HttpError(409, 'Aguarde a compilação terminar');
  const newName = validateProjectName(req.body.newName);
  const dest = path.join(PROJECTS_DIR, newName);
  if (fs.existsSync(dest)) throw new HttpError(409, 'Já existe um projeto com esse nome');
  fs.renameSync(dir, dest);
  // Pending history and compile options follow the project
  if (changedProjects.delete(req.params.name)) changedProjects.add(newName);
  lastCompileOptions.delete(req.params.name);
  res.json({ name: newName });
}));

// Copy project (compiled output is not copied)
app.post('/api/projects/:name/copy', route((req, res) => {
  const dir = projectDir(req.params.name);
  const newName = validateProjectName(req.body.newName);
  const dest = path.join(PROJECTS_DIR, newName);
  if (fs.existsSync(dest)) throw new HttpError(409, 'Já existe um projeto com esse nome');
  // Compiled output and version history stay with the original
  const skip = new Set([path.join(dir, OUTPUT_DIR), path.join(dir, git.HISTORY_DIR)]);
  fs.cpSync(dir, dest, { recursive: true, filter: src => !skip.has(src) });
  const meta = readMeta(dest);
  writeMeta(dest, { ...meta, archived: false, trashed: false, createdAt: new Date() });
  git.snapshot(dest, `Cópia de ${path.basename(dir)}`).catch(err => console.warn('[history]', err.message));
  res.json({ name: newName });
}));

// Download sources as .zip (internal files excluded)
app.get('/api/projects/:name/download.zip', route((req, res) => {
  const dir = projectDir(req.params.name);
  const zipName = encodeURIComponent(path.basename(dir)) + '.zip';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${zipName}`);
  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.on('error', err => { console.error('[zip]', err); res.destroy(err); });
  zip.pipe(res);
  zip.glob('**/*', { cwd: dir, dot: false });
  zip.finalize();
}));

// Word count of the main document (and its \input/\include files)
app.get('/api/projects/:name/wordcount', route(async (req, res) => {
  const dir = projectDir(req.params.name);
  const meta = readMeta(dir);
  if (!meta.mainFile) throw new HttpError(400, 'Nenhum arquivo .tex encontrado no projeto');
  const texFile = safeResolve(dir, meta.mainFile);
  const output = await new Promise((resolve, reject) => {
    const proc = spawn('texcount', ['-inc', '-total', '-utf8', path.basename(texFile)], { cwd: path.dirname(texFile) });
    let out = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => out += d);
    proc.on('error', err => reject(new HttpError(500, `Não foi possível executar texcount: ${err.message}`)));
    proc.on('close', () => resolve(out));
  });
  const pick = label => {
    const m = output.match(new RegExp(`^${label}:\\s*(\\d+)`, 'm'));
    return m ? Number(m[1]) : 0;
  };
  res.json({
    mainFile: meta.mainFile,
    words: pick('Words in text'),
    headerWords: pick('Words in headers'),
    captionWords: pick('Words outside text \\(captions, etc\\.\\)'),
    headers: pick('Number of headers'),
    floats: pick('Number of floats/tables/figures'),
    mathInline: pick('Number of math inlines'),
    mathDisplay: pick('Number of math displayed'),
  });
}));

// Full-text search across the project's text files
app.get('/api/projects/:name/search', route((req, res) => {
  const dir = projectDir(req.params.name);
  const q = String(req.query.q || '');
  if (!q) return res.json({ results: [], truncated: false });
  const caseSensitive = req.query.case === '1';
  let re;
  try {
    const source = req.query.regex === '1' ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(source, caseSensitive ? '' : 'i');
  } catch (e) {
    throw new HttpError(400, 'Expressão regular inválida');
  }

  const MAX_RESULTS = 500;
  const results = [];
  (function walk(entries) {
    for (const f of entries) {
      if (results.length >= MAX_RESULTS) return;
      if (f.type === 'folder') { walk(f.children); continue; }
      if (f.type !== 'text' || f.size > 2 * 1024 * 1024) continue;
      const lines = fs.readFileSync(path.join(dir, f.path), 'utf8').split('\n');
      lines.forEach((text, i) => {
        if (results.length < MAX_RESULTS && re.test(text)) {
          results.push({ path: f.path, line: i + 1, text: text.slice(0, 300) });
        }
      });
    }
  })(listFiles(dir));
  res.json({ results, truncated: results.length >= MAX_RESULTS });
}));

// Labels, bibliography keys and custom commands, used for autocompletion
app.get('/api/projects/:name/metadata', route((req, res) => {
  const dir = projectDir(req.params.name);
  const labels = [], bibKeys = [], commands = [], files = [];
  const stripComments = text => text.replace(/(^|[^\\])%.*$/gm, '$1');

  (function walk(entries) {
    for (const f of entries) {
      if (f.type === 'folder') { walk(f.children); continue; }
      files.push({ path: f.path, type: f.type });
      if (f.type !== 'text' || f.size > 2 * 1024 * 1024) continue;
      const ext = path.extname(f.name).toLowerCase();
      const text = fs.readFileSync(path.join(dir, f.path), 'utf8');
      if (ext === '.bib') {
        // @article{key, ... title = {…}
        const entryRe = /@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n\s*@|$)/g;
        let m;
        while ((m = entryRe.exec(text))) {
          if (/^(comment|string|preamble)$/i.test(m[1])) continue;
          const title = (m[3].match(/\btitle\s*=\s*[{"]+([^}"]*)/i) || [])[1];
          const author = (m[3].match(/\bauthor\s*=\s*[{"]+([^}"]*)/i) || [])[1];
          bibKeys.push({ key: m[2], type: m[1].toLowerCase(), title: title?.trim(), author: author?.trim(), file: f.path });
        }
      } else if (['.tex', '.sty', '.cls', '.ltx'].includes(ext)) {
        const clean = stripComments(text);
        for (const m of clean.matchAll(/\\label\s*\{([^}]+)\}/g)) labels.push({ label: m[1], file: f.path });
        for (const m of clean.matchAll(/\\(?:re)?newcommand\*?\s*\{?\\([a-zA-Z@]+)\}?\s*(?:\[(\d)\])?/g)) {
          commands.push({ name: m[1], args: Number(m[2] || 0), file: f.path });
        }
        for (const m of clean.matchAll(/\\DeclareMathOperator\*?\s*\{?\\([a-zA-Z@]+)\}?/g)) {
          commands.push({ name: m[1], args: 0, file: f.path });
        }
      }
    }
  })(listFiles(dir));

  res.json({ labels, bibKeys, commands, files });
}));

// Project settings (main document, compiler, shell-escape)
app.get('/api/projects/:name/settings', route((req, res) => {
  res.json(readMeta(projectDir(req.params.name)));
}));

app.patch('/api/projects/:name/settings', route((req, res) => {
  const dir = projectDir(req.params.name);
  const meta = readMeta(dir);
  const { mainFile, compiler, shellEscape, timeout, archived, trashed, tags } = req.body;
  if (mainFile !== undefined) {
    const abs = safeResolve(dir, mainFile);
    if (!mainFile.endsWith('.tex') || !fs.existsSync(abs)) {
      throw new HttpError(400, 'O documento principal deve ser um arquivo .tex existente');
    }
    meta.mainFile = path.relative(dir, abs).split(path.sep).join('/');
  }
  if (compiler !== undefined) {
    if (!COMPILERS.includes(compiler)) throw new HttpError(400, 'Compilador inválido');
    meta.compiler = compiler;
  }
  if (shellEscape !== undefined) meta.shellEscape = shellEscape === true;
  if (timeout !== undefined) {
    if (!COMPILE_TIMEOUTS.includes(timeout)) throw new HttpError(400, 'Tempo limite inválido');
    meta.timeout = timeout;
  }
  // Dashboard state: a project is either active, archived or in the trash
  if (archived !== undefined) {
    meta.archived = archived === true;
    if (meta.archived) meta.trashed = false;
  }
  if (trashed !== undefined) {
    meta.trashed = trashed === true;
    if (meta.trashed) meta.archived = false;
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 50)) {
      throw new HttpError(400, 'Tags inválidas');
    }
    meta.tags = [...new Set(tags.map(t => t.trim()))];
  }
  writeMeta(dir, meta);
  res.json(meta);
}));

// ─── Files API ────────────────────────────────────────────────────────────────

// List files in a project
app.get('/api/projects/:name/files', route((req, res) => {
  res.json(listFiles(projectDir(req.params.name)));
}));

// Read file
app.get('/api/projects/:name/files/*', route((req, res) => {
  const filePath = safeResolve(projectDir(req.params.name), req.params[0]);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new HttpError(404, 'Arquivo não encontrado');
  if (fileType(filePath) !== 'text' || req.query.raw !== undefined) return res.sendFile(filePath);
  res.json({ content: fs.readFileSync(filePath, 'utf8') });
}));

// Save/create file
app.put('/api/projects/:name/files/*', route((req, res) => {
  const filePath = safeResolve(projectDir(req.params.name), req.params[0]);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) throw new HttpError(409, 'Já existe uma pasta com esse nome');
  const content = req.body.content;
  if (content !== undefined && typeof content !== 'string') throw new HttpError(400, 'Conteúdo inválido');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content || '');
  markChanged(req.params.name);
  res.json({ saved: true });
}));

// Delete file or folder
app.delete('/api/projects/:name/files/*', route((req, res) => {
  const filePath = safeResolve(projectDir(req.params.name), req.params[0]);
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'Arquivo não encontrado');
  const dir = projectDir(req.params.name);
  const meta = readMeta(dir);
  fs.rmSync(filePath, { recursive: true });
  // Deleting the main document (or its folder) lets the next one be detected
  if (meta.mainFile && !fs.existsSync(path.join(dir, meta.mainFile))) writeMeta(dir, { ...meta, mainFile: detectMainFile(dir) });
  markChanged(req.params.name);
  res.json({ deleted: true });
}));

// Create a folder
app.post('/api/projects/:name/folders', route((req, res) => {
  const folder = safeResolve(projectDir(req.params.name), String(req.body.path || ''));
  if (fs.existsSync(folder)) throw new HttpError(409, 'Já existe um arquivo ou pasta com esse nome');
  fs.mkdirSync(folder, { recursive: true });
  res.json({ created: true });
}));

// Rename or move a file/folder (never overwrites)
app.post('/api/projects/:name/move', route((req, res) => {
  const dir = projectDir(req.params.name);
  const from = safeResolve(dir, String(req.body.from || ''));
  const to = safeResolve(dir, String(req.body.to || ''));
  if (!fs.existsSync(from)) throw new HttpError(404, 'Arquivo não encontrado');
  if (from === to) return res.json({ moved: false });
  if (fs.existsSync(to)) throw new HttpError(409, 'Já existe um arquivo ou pasta com esse nome no destino');
  if (to.startsWith(from + path.sep)) throw new HttpError(400, 'Não é possível mover uma pasta para dentro dela mesma');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);

  // Keep the main document pointing at the same file
  const meta = readMeta(dir);
  const rel = abs => path.relative(dir, abs).split(path.sep).join('/');
  const fromRel = rel(from), toRel = rel(to);
  const stored = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, META_FILE), 'utf8')).mainFile; } catch (e) { return null; } })();
  if (stored && (stored === fromRel || stored.startsWith(fromRel + '/'))) {
    writeMeta(dir, { ...meta, mainFile: toRel + stored.slice(fromRel.length) });
  }
  markChanged(req.params.name);
  res.json({ moved: true, path: toRel });
}));

// Upload files (optional ?folder=sub/dir)
const upload = multer({
  dest: path.join(os.tmpdir(), 'latex-uploads'),
  limits: { fileSize: 100 * 1024 * 1024 }
});
app.post('/api/projects/:name/upload', upload.array('files'), route((req, res) => {
  const files = req.files || [];
  try {
    const dir = projectDir(req.params.name);
    const target = req.query.folder ? safeResolve(dir, String(req.query.folder)) : dir;
    fs.mkdirSync(target, { recursive: true });
    for (const file of files) {
      const dest = safeResolve(target, path.basename(file.originalname));
      // copy + unlink instead of rename: /tmp is often on another filesystem
      fs.copyFileSync(file.path, dest);
    }
    markChanged(req.params.name);
    res.json({ uploaded: files.length });
  } finally {
    files.forEach(f => fs.rm(f.path, { force: true }, () => {}));
  }
}));

// ─── Compile API ──────────────────────────────────────────────────────────────

// Options of each project's last compile; a change forces latexmk to rebuild
const lastCompileOptions = new Map();

app.post('/api/projects/:name/compile', route(async (req, res) => {
  const project = req.params.name;
  const dir = projectDir(project);
  if (compiling.has(project)) throw new HttpError(409, 'Já existe uma compilação em andamento');

  const meta = readMeta(dir);
  if (!meta.mainFile) throw new HttpError(400, 'Nenhum arquivo .tex encontrado no projeto');
  const texFile = safeResolve(dir, meta.mainFile);
  if (!fs.existsSync(texFile)) throw new HttpError(404, `Documento principal não encontrado: ${meta.mainFile}`);

  const draft = req.body.draft === true;
  const stopOnFirstError = req.body.stopOnFirstError === true;

  const outDir = path.join(dir, OUTPUT_DIR);
  fs.mkdirSync(outDir, { recursive: true });
  const baseName = path.basename(texFile, '.tex');
  const pdfPath = path.join(outDir, baseName + '.pdf');

  // latexmk runs bibtex/biber, makeindex etc. as needed and keeps aux files
  // in .output so later compiles are faster and the .log can be inspected
  const args = [
    LATEXMK_ENGINE_FLAG[meta.compiler],
    '-interaction=nonstopmode',
    '-file-line-error',
    '-synctex=1',
    `-outdir=${outDir}`,
  ];
  // Keep going after errors (like Overleaf) unless asked to stop at the first one
  args.push(stopOnFirstError ? '-latexoption=-halt-on-error' : '-f');
  // Draft mode: images become boxes, which makes big documents compile faster
  if (draft) args.push('-usepretex=\\PassOptionsToPackage{draft}{graphicx}\\PassOptionsToPackage{draft}{graphics}');
  if (meta.shellEscape) args.push('-shell-escape');
  const optionsKey = JSON.stringify([meta.compiler, draft, stopOnFirstError, meta.shellEscape]);
  if (lastCompileOptions.has(project) && lastCompileOptions.get(project) !== optionsKey) args.push('-g');
  args.push(path.basename(texFile));

  compiling.set(project, null);
  const startedAt = Date.now();
  broadcastTo(project, { type: 'compile_start' });
  let log = '';

  try {
    const result = await new Promise(resolve => {
      const proc = spawn('latexmk', args, {
        // Run next to the main file so relative \input/\includegraphics work
        cwd: path.dirname(texFile),
        env: { ...process.env, TEXINPUTS: `.:${dir}:` + (process.env.TEXINPUTS || '') },
        detached: true,
      });
      compiling.set(project, proc);
      const onData = chunk => {
        const text = chunk.toString();
        log += text;
        broadcastTo(project, { type: 'compile_log', data: text });
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { process.kill(-proc.pid, 'SIGKILL'); } catch (e) {}
      }, meta.timeout * 1000);

      proc.on('error', err => {
        clearTimeout(timer);
        onData(`\n[erro] Não foi possível executar latexmk: ${err.message}\n`);
        resolve({ code: -1, timedOut });
      });
      proc.on('close', code => {
        clearTimeout(timer);
        resolve({ code, timedOut, stopped: proc.stoppedByUser === true });
      });
    });
    lastCompileOptions.set(project, optionsKey);
    if (result.stopped || result.timedOut) {
      // An interrupted run can leave a truncated PDF that latexmk would then treat
      // as up to date: drop its database so the next compile starts over
      fs.rmSync(path.join(outDir, baseName + '.fdb_latexmk'), { force: true });
    }

    // On success latexmk may skip an up-to-date PDF; on failure only trust a PDF from this run
    const pdfExists = fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 0;
    // "up-to-date" with a non-zero code means the sources didn't change since a run with errors
    const pdfFresh = pdfExists && (fs.statSync(pdfPath).mtimeMs >= startedAt - 1000 || /are up-to-date/.test(log));
    const pdfFile = pdfExists && (result.code === 0 || pdfFresh) ? baseName + '.pdf' : null;
    const status = result.stopped ? 'stopped'
      : result.timedOut ? 'timeout'
      : result.code === 0 ? 'success'
      : pdfFile ? 'errors' : 'failure';

    broadcastTo(project, { type: 'compile_done', status, pdfFile });
    recordHistory(project, 'Compilação');
    res.json({
      status,
      pdfFile,
      mainFile: meta.mainFile,
      // Lets the client map paths in the .log back to project files
      compileDir: path.dirname(meta.mainFile) === '.' ? '' : path.dirname(meta.mainFile),
      projectRoot: dir,
      logFile: fs.existsSync(path.join(outDir, baseName + '.log')) ? baseName + '.log' : null,
      blgFile: fs.existsSync(path.join(outDir, baseName + '.blg')) ? baseName + '.blg' : null,
      outputFiles: listOutputFiles(outDir),
      log,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    compiling.delete(project);
  }
}));

// Stop a running compile
app.post('/api/projects/:name/compile/stop', route((req, res) => {
  projectDir(req.params.name);
  const proc = compiling.get(req.params.name);
  if (!proc) return res.json({ stopped: false });
  proc.stoppedByUser = true;
  try { process.kill(-proc.pid, 'SIGTERM'); } catch (e) {}
  // Make sure the whole process group goes away
  setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch (e) {} }, 1500);
  res.json({ stopped: true });
}));

function listOutputFiles(outDir) {
  if (!fs.existsSync(outDir)) return [];
  return fs.readdirSync(outDir, { withFileTypes: true })
    .filter(e => e.isFile() && !e.name.startsWith('.'))
    .map(e => ({ name: e.name, size: fs.statSync(path.join(outDir, e.name)).size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// List / clear compiled output (aux files, logs, PDF)
app.get('/api/projects/:name/output', route((req, res) => {
  res.json(listOutputFiles(path.join(projectDir(req.params.name), OUTPUT_DIR)));
}));

app.delete('/api/projects/:name/output', route((req, res) => {
  const dir = projectDir(req.params.name);
  if (compiling.has(req.params.name)) throw new HttpError(409, 'Aguarde a compilação terminar');
  fs.rmSync(path.join(dir, OUTPUT_DIR), { recursive: true, force: true });
  lastCompileOptions.delete(req.params.name);
  res.json({ cleared: true });
}));

// ─── SyncTeX ──────────────────────────────────────────────────────────────────

function runSynctex(args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn('synctex', args, { cwd });
    let out = '';
    proc.stdout.on('data', d => out += d);
    proc.on('error', err => reject(new HttpError(500, `Não foi possível executar synctex: ${err.message}`)));
    proc.on('close', () => resolve(out));
  });
}

// Parses "Key:value" records of `synctex view/edit`; each record starts at `firstKey`
function parseSynctex(out, firstKey) {
  const records = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(\w+):(.*)$/);
    if (!m) continue;
    if (m[1] === firstKey) records.push({});
    if (records.length) records[records.length - 1][m[1]] = m[2];
  }
  return records;
}

function compiledPdf(dir) {
  const meta = readMeta(dir);
  if (!meta.mainFile) throw new HttpError(400, 'Nenhum documento principal');
  const outDir = path.join(dir, OUTPUT_DIR);
  const pdf = path.basename(meta.mainFile, '.tex') + '.pdf';
  if (!fs.existsSync(path.join(outDir, pdf))) throw new HttpError(404, 'Compile o projeto primeiro');
  return { outDir, pdf };
}

// Code → PDF: where does file:line appear in the PDF?
app.get('/api/projects/:name/synctex/code', route(async (req, res) => {
  const dir = projectDir(req.params.name);
  const file = safeResolve(dir, String(req.query.file || ''));
  const line = Math.max(1, parseInt(req.query.line, 10) || 1);
  const column = Math.max(0, parseInt(req.query.column, 10) || 0);
  const { outDir, pdf } = compiledPdf(dir);
  const out = await runSynctex(['view', '-i', `${line}:${column}:${file}`, '-o', pdf], outDir);
  const boxes = parseSynctex(out, 'Output')
    .filter(r => r.Page)
    .map(r => ({ page: +r.Page, h: +r.h, v: +r.v, width: +r.W, height: +r.H }));
  if (!boxes.length) throw new HttpError(404, 'Não foi possível localizar este trecho no PDF');
  res.json({ boxes });
}));

// PDF → code: which source line produced this point of the page?
app.get('/api/projects/:name/synctex/pdf', route(async (req, res) => {
  const dir = projectDir(req.params.name);
  const page = parseInt(req.query.page, 10);
  const h = parseFloat(req.query.h), v = parseFloat(req.query.v);
  if (!(page > 0) || !Number.isFinite(h) || !Number.isFinite(v)) throw new HttpError(400, 'Posição inválida');
  const { outDir, pdf } = compiledPdf(dir);
  const out = await runSynctex(['edit', '-o', `${page}:${h}:${v}:${pdf}`], outDir);
  const hit = parseSynctex(out, 'Output').find(r => r.Input);
  const input = hit && path.resolve(hit.Input);
  if (!input || !input.startsWith(dir + path.sep)) throw new HttpError(404, 'Não foi possível localizar este trecho no código');
  res.json({ file: path.relative(dir, input).split(path.sep).join('/'), line: Math.max(1, +hit.Line || 1), column: +hit.Column });
}));

// Compiled output (PDF, .log, .synctex.gz …)
app.get('/api/projects/:name/output/:file', route((req, res) => {
  const outDir = path.join(projectDir(req.params.name), OUTPUT_DIR);
  const fileName = path.basename(req.params.file);
  if (fileName.startsWith('.')) throw new HttpError(403, 'Caminho não permitido');
  const filePath = path.join(outDir, fileName);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new HttpError(404, 'Arquivo de saída não encontrado');
  // Text outputs (.log, .aux, .bbl…) are shown inline in the browser
  if (/\.(log|aux|bbl|blg|out|toc|lof|lot|fls|fdb_latexmk|idx|ind|ilg|nav|snm|bcf|run\.xml)$/.test(fileName)) {
    res.type('text/plain; charset=utf-8');
  }
  res.sendFile(filePath);
}));

// ─── History (automatic versions in <project>/.history) ───────────────────────

const HISTORY_INTERVAL_MS = 5 * 60 * 1000;
const changedProjects = new Set();

function markChanged(project) {
  changedProjects.add(project);
}

// Records a version if anything changed since the last one
function recordHistory(project, message) {
  changedProjects.delete(project);
  let dir;
  try { dir = projectDir(project); } catch (e) { return Promise.resolve(null); }
  return git.snapshot(dir, message).catch(err => {
    console.warn('[history]', err.message);
    return null;
  });
}

// Edits that weren't followed by a compile still get a version every few minutes
setInterval(() => {
  for (const project of [...changedProjects]) recordHistory(project, 'Alterações salvas');
}, HISTORY_INTERVAL_MS).unref();

app.get('/api/projects/:name/history', route(async (req, res) => {
  // Include edits not recorded yet (also changes made outside the app)
  await recordHistory(req.params.name, 'Alterações salvas');
  res.json(await git.historyLog(projectDir(req.params.name)));
}));

// Save a version now (optionally with a label)
app.post('/api/projects/:name/history', route(async (req, res) => {
  const dir = projectDir(req.params.name);
  const label = typeof req.body.label === 'string' ? req.body.label.trim().slice(0, 80) : '';
  changedProjects.delete(req.params.name);
  let hash = await git.snapshot(dir, label ? `Versão nomeada: ${label}` : 'Versão salva manualmente');
  if (!hash) hash = (await git.historyLog(dir, 1))[0]?.hash;
  if (!hash) throw new HttpError(400, 'Nada para salvar');
  if (label) git.addLabel(dir, hash, label);
  res.json({ hash });
}));

app.get('/api/projects/:name/history/:hash/diff', route(async (req, res) => {
  const dir = projectDir(req.params.name);
  const file = String(req.query.file || '');
  safeResolve(dir, file);
  res.json({ diff: await git.historyDiff(dir, req.params.hash, file) });
}));

app.get('/api/projects/:name/history/:hash/file', route(async (req, res) => {
  const dir = projectDir(req.params.name);
  const file = String(req.query.file || '');
  safeResolve(dir, file);
  const data = await git.historyFile(dir, req.params.hash, file);
  if (fileType(file) === 'text') return res.type('text/plain; charset=utf-8').send(data);
  res.type(path.extname(file) || 'application/octet-stream').send(data);
}));

app.post('/api/projects/:name/history/:hash/restore', route(async (req, res) => {
  const project = req.params.name;
  const dir = projectDir(project);
  if (compiling.has(project)) throw new HttpError(409, 'Aguarde a compilação terminar');
  const file = req.body.file ? String(req.body.file) : null;
  if (file) safeResolve(dir, file);
  changedProjects.delete(project);
  await git.historyRestore(dir, req.params.hash, file);
  const meta = readMeta(dir);
  writeMeta(dir, meta);
  res.json({ restored: true });
}));

app.post('/api/projects/:name/history/:hash/labels', route((req, res) => {
  const dir = projectDir(req.params.name);
  const label = String(req.body.label || '').trim().slice(0, 80);
  if (!label) throw new HttpError(400, 'Digite um nome para a versão');
  res.json({ labels: git.addLabel(dir, req.params.hash, label) });
}));

app.delete('/api/projects/:name/history/:hash/labels', route((req, res) => {
  git.removeLabel(projectDir(req.params.name), req.params.hash, String(req.query.label || ''));
  res.json({ removed: true });
}));

// ─── Git integration (the project folder as a real repository) ────────────────

app.get('/api/projects/:name/git', route(async (req, res) => {
  res.json(await git.repoStatus(projectDir(req.params.name)));
}));

app.post('/api/projects/:name/git/:action', route(async (req, res) => {
  const dir = projectDir(req.params.name);
  const { action } = req.params;
  if (action === 'init') await git.repoInit(dir);
  else if (action === 'remote') await git.repoSetRemote(dir, req.body.url);
  else if (action === 'commit') {
    const message = String(req.body.message || '').trim();
    if (!message) throw new HttpError(400, 'Escreva uma mensagem para o commit');
    await git.repoCommit(dir, message);
  } else if (action === 'pull') await git.repoPull(dir);
  else if (action === 'push') await git.repoPush(dir);
  else throw new HttpError(404, 'Ação desconhecida');
  res.json(await git.repoStatus(dir));
}));

// ─── AI assistant (local models served by Ollama) ─────────────────────────────

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const AI_MAX_CHARS = 400000;

const AI_PROMPTS = {
  chat: 'Você é um assistente de LaTeX integrado a um editor no estilo do Overleaf. '
    + 'Responda em português do Brasil, de forma direta e sem rodeios. '
    + 'Quando mostrar código LaTeX, use blocos ```latex. Ao corrigir um trecho, mostre o trecho corrigido completo. '
    + 'Não invente pacotes, comandos nem referências bibliográficas; se não tiver certeza, diga.',
  edit: 'Você edita trechos de documentos LaTeX. Siga a instrução e responda SOMENTE com o texto LaTeX que deve '
    + 'substituir o trecho (ou ser inserido no cursor): sem explicações, sem comentários sobre as mudanças e sem blocos ```. '
    + 'Preserve comandos, rótulos, citações e a indentação do original, a menos que a instrução peça outra coisa. '
    + 'Mantenha o idioma do texto, salvo quando a instrução pedir uma tradução.',
  // Quick actions of the inline AI: the user message is the selected text and the reply is JSON
  'review-en': 'You are an expert English proofreader, like LanguageTool or Grammarly. Fix spelling, grammar, punctuation, '
    + "word choice and style problems in the user's English text. Keep the original meaning, tone and formatting (line breaks). "
    + 'Do not add new content. If the text is already correct, return it unchanged with an empty changes list. '
    + 'Write every explanation in Brazilian Portuguese, briefly. '
    + 'Respond ONLY with JSON: {"result": "<full corrected text>", "changes": [{"original": "...", "suggestion": "...", "explanation": "..."}]}',
  'review-pt': 'Você é um revisor especialista em português brasileiro, como o LanguageTool. Corrija ortografia, gramática, '
    + 'concordância, regência, crase, pontuação e estilo do texto do usuário. Mantenha o sentido, o tom e a formatação (quebras de linha). '
    + 'Não acrescente conteúdo novo. Se o texto já estiver correto, devolva-o igual e com a lista de mudanças vazia. '
    + 'Escreva as explicações em português, de forma breve. '
    + 'Responda SOMENTE com JSON: {"result": "<texto completo corrigido>", "changes": [{"original": "...", "suggestion": "...", "explanation": "..."}]}',
  'translate-en': "You are a professional translator. Translate the user's text into natural, fluent English. "
    + 'Preserve meaning, tone and formatting (line breaks). Do not explain, do not add notes. '
    + 'Respond ONLY with JSON: {"result": "<translation>", "changes": []}',
  'translate-pt': 'Você é um tradutor profissional. Traduza o texto do usuário para um português brasileiro natural e fluente. '
    + 'Preserve o sentido, o tom e a formatação (quebras de linha). Não explique e não adicione notas. '
    + 'Responda SOMENTE com JSON: {"result": "<tradução>", "changes": []}',
};

// The selections come from LaTeX files: markup must survive the review or translation
const LATEX_NOTES = {
  en: ' The text may contain LaTeX: keep commands, environment names, labels, citation keys and math unchanged; only the prose changes.',
  pt: ' O texto pode conter LaTeX: mantenha inalterados os comandos, os nomes de ambientes, os rótulos, as chaves de citação e as fórmulas; só o texto corrido muda.',
};
for (const mode of ['review-en', 'translate-en']) AI_PROMPTS[mode] += LATEX_NOTES.en;
for (const mode of ['review-pt', 'translate-pt']) AI_PROMPTS[mode] += LATEX_NOTES.pt;

// Modes whose reply must follow this JSON schema (Ollama structured outputs)
const AI_JSON_MODES = new Set(['review-en', 'review-pt', 'translate-en', 'translate-pt']);
const AI_JSON_SCHEMA = {
  type: 'object',
  properties: {
    result: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { original: { type: 'string' }, suggestion: { type: 'string' }, explanation: { type: 'string' } },
        required: ['original', 'suggestion', 'explanation'],
      },
    },
  },
  required: ['result', 'changes'],
};

async function ollama(pathname, options = {}) {
  let res;
  try {
    res = await fetch(OLLAMA_URL + pathname, options);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new HttpError(503, `Não foi possível conectar ao Ollama em ${OLLAMA_URL}. Verifique se ele está instalado e rodando.`);
  }
  if (!res.ok) {
    let msg = `O Ollama respondeu com o erro ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch (e) {}
    throw new HttpError(502, msg);
  }
  return res;
}

// Installed models that can chat (embedding-only models are left out)
async function aiModels() {
  const res = await ollama('/api/tags', { signal: AbortSignal.timeout(4000) });
  const { models = [] } = await res.json();
  return models
    .filter(m => !m.capabilities || m.capabilities.includes('completion'))
    .map(m => ({
      name: m.name,
      size: m.details?.parameter_size || '',
      thinking: (m.capabilities || []).includes('thinking'),
    }));
}

app.get('/api/ai/models', route(async (req, res) => {
  try {
    res.json({ available: true, url: OLLAMA_URL, models: await aiModels() });
  } catch (e) {
    res.json({ available: false, url: OLLAMA_URL, models: [], error: e.message });
  }
}));

// Streams the model's reply as NDJSON, exactly as Ollama sends it
app.post('/api/ai/chat', route(async (req, res) => {
  const { model, messages, mode = 'chat', think = false } = req.body;
  if (typeof model !== 'string' || !model || model.length > 200) throw new HttpError(400, 'Escolha um modelo');
  if (!Object.hasOwn(AI_PROMPTS, mode)) throw new HttpError(400, 'Modo inválido');
  if (!Array.isArray(messages) || !messages.length || messages.length > 200
    || messages.some(m => !['user', 'assistant'].includes(m?.role) || typeof m.content !== 'string')) {
    throw new HttpError(400, 'Mensagens inválidas');
  }
  if (messages.reduce((n, m) => n + m.content.length, 0) > AI_MAX_CHARS) {
    throw new HttpError(413, 'A conversa ficou grande demais. Comece uma nova conversa.');
  }
  const info = (await aiModels()).find(m => m.name === model);
  if (!info) throw new HttpError(404, `O modelo "${model}" não está instalado no Ollama`);

  // Stop generating when the client goes away (stop button, closed window)
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  let upstream;
  try {
    upstream = await ollama('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: true,
        think: info.thinking && think === true,
        keep_alive: '30m',
        messages: [{ role: 'system', content: AI_PROMPTS[mode] }, ...messages.map(({ role, content }) => ({ role, content }))],
        ...(AI_JSON_MODES.has(mode) ? { format: AI_JSON_SCHEMA } : {}),
        options: { num_ctx: 8192, temperature: mode === 'chat' ? 0.6 : 0.2 },
      }),
    });
  } catch (e) {
    if (controller.signal.aborted) return;
    throw e;
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  try {
    for await (const chunk of upstream.body) res.write(chunk);
  } catch (e) {
    if (!controller.signal.aborted) res.write(JSON.stringify({ error: 'A conexão com o Ollama foi interrompida' }) + '\n');
  }
  res.end();
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

// ─── Frontend ─────────────────────────────────────────────────────────────────

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
} else {
  app.get('/', (req, res) => res.status(503).send('Frontend não compilado. Rode <code>npm run build</code> em webapp/.'));
}

// ─── Watch for changes made outside the app ──────────────────────────────────

const pendingChanges = new Map(); // project → { timer, files: Set, structure }

const watcher = chokidar.watch(PROJECTS_DIR, {
  ignoreInitial: true,
  // Internal files (.output, .history, .project.json) and other dotfiles
  ignored: p => path.relative(PROJECTS_DIR, p).split(path.sep).some(seg => seg.startsWith('.')),
  depth: 12,
});
watcher.on('all', (event, abs) => {
  const [project, ...rest] = path.relative(PROJECTS_DIR, abs).split(path.sep);
  if (!project || project.startsWith('..')) return;
  let pending = pendingChanges.get(project);
  if (!pending) {
    pending = { files: new Set(), structure: false, topLevel: false };
    pendingChanges.set(project, pending);
  }
  if (event === 'change') pending.files.add(rest.join('/'));
  else pending.structure = true;
  // A project folder itself was added or removed
  if (!rest.length) pending.topLevel = true;
  clearTimeout(pending.timer);
  pending.timer = setTimeout(() => {
    pendingChanges.delete(project);
    broadcastTo(project, { type: 'files_changed', files: [...pending.files], structure: pending.structure });
    if (pending.topLevel) broadcastAll({ type: 'projects_changed' });
  }, 300);
});
watcher.on('error', err => console.warn('[watch]', err.message));

function broadcastAll(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(payload); });
}

// ─── Desktop app mode: quit once the last window has been closed ─────────────

if (process.env.EXIT_WHEN_IDLE) {
  const graceMs = Number(process.env.EXIT_WHEN_IDLE) * 1000 || 30000;
  let idleTimer = null;
  const check = () => {
    clearTimeout(idleTimer);
    if (wss.clients.size === 0) {
      idleTimer = setTimeout(async () => {
        if (wss.clients.size) return;
        console.log('Nenhuma janela aberta, salvando o histórico e encerrando.');
        await Promise.all([...changedProjects].map(p => recordHistory(p, 'Alterações salvas')));
        process.exit(0);
      }, graceMs);
    }
  };
  wss.on('connection', ws => {
    clearTimeout(idleTimer);
    ws.on('close', check);
  });
  // Also quit if no window ever connects
  check();
}

// ─── Start server ─────────────────────────────────────────────────────────────

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ A porta ${PORT} já está em uso. Feche o outro processo ou use PORT=xxxx npm start\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n🚀 LaTeX Editor rodando em ${url}\n`);
  if (process.env.NO_OPEN) return;

  // Abre o navegador automaticamente (Multi-plataforma: Windows, Mac, Linux)
  const [cmd, ...args] = process.platform === 'darwin' ? ['open', url]
    : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url]
    : ['xdg-open', url];
  const opener = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  opener.on('error', () => {});
  opener.unref();
});
