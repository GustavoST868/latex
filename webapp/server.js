const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Projects directory - each project is a subfolder
const PROJECTS_DIR = path.join(__dirname, 'projects');
if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// Copy initial project from parent directory if we have one
const INITIAL_PROJECT = path.join(__dirname, '../');
const INITIAL_PROJECT_DEST = path.join(PROJECTS_DIR, 'Meu Projeto');
if (!fs.existsSync(INITIAL_PROJECT_DEST)) {
  fs.mkdirSync(INITIAL_PROJECT_DEST, { recursive: true });
  // Copy .tex and .bib files
  const files = fs.readdirSync(INITIAL_PROJECT).filter(f =>
    ['.tex', '.bib', '.pdf', '.png', '.jpg'].some(ext => f.endsWith(ext))
  );
  files.forEach(f => {
    try {
      fs.copyFileSync(path.join(INITIAL_PROJECT, f), path.join(INITIAL_PROJECT_DEST, f));
    } catch (e) {}
  });
}

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket broadcast utility
function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// ─── Config (auto-detect first project + first .tex) ─────────────────────────
app.get('/api/config', (req, res) => {
  try {
    const projects = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
    if (!projects.length) return res.status(404).json({ error: 'No projects found' });

    const project = projects[0];
    const projectPath = path.join(PROJECTS_DIR, project);
    const texFile = fs.readdirSync(projectPath).find(f => f.endsWith('.tex')) || 'main.tex';
    res.json({ project, mainFile: texFile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Projects API ─────────────────────────────────────────────────────────────

// List all projects
app.get('/api/projects', (req, res) => {
  try {
    const projects = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({
        name: d.name,
        mtime: fs.statSync(path.join(PROJECTS_DIR, d.name)).mtime
      }))
      .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    res.json(projects);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create new project
app.post('/api/projects', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name required' });
  const projectPath = path.join(PROJECTS_DIR, name);
  if (fs.existsSync(projectPath)) return res.status(409).json({ error: 'Project already exists' });
  fs.mkdirSync(projectPath, { recursive: true });

  // Create default main.tex
  const defaultTex = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage[brazil]{babel}

\\title{${name}}
\\author{Seu Nome}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introdução}
Escreva seu texto aqui.

\\end{document}
`;
  fs.writeFileSync(path.join(projectPath, 'main.tex'), defaultTex);
  res.json({ name, created: true });
});

// Delete project
app.delete('/api/projects/:name', (req, res) => {
  const projectPath = path.join(PROJECTS_DIR, req.params.name);
  if (!fs.existsSync(projectPath)) return res.status(404).json({ error: 'Not found' });
  fs.rmSync(projectPath, { recursive: true });
  res.json({ deleted: true });
});

// ─── Files API ────────────────────────────────────────────────────────────────

// List files in a project
app.get('/api/projects/:name/files', (req, res) => {
  const projectPath = path.join(PROJECTS_DIR, req.params.name);
  if (!fs.existsSync(projectPath)) return res.status(404).json({ error: 'Not found' });

  function listFiles(dir, base = '') {
    return fs.readdirSync(dir, { withFileTypes: true }).map(entry => {
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return { name: entry.name, path: relPath, type: 'folder', children: listFiles(path.join(dir, entry.name), relPath) };
      }
      const ext = path.extname(entry.name).toLowerCase();
      const type = ['.tex', '.bib', '.txt', '.md'].includes(ext) ? 'text' :
                   ['.pdf'].includes(ext) ? 'pdf' :
                   ['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext) ? 'image' : 'binary';
      return { name: entry.name, path: relPath, type, size: fs.statSync(path.join(dir, entry.name)).size };
    });
  }

  res.json(listFiles(projectPath));
});

// Read file
app.get('/api/projects/:name/files/*', (req, res) => {
  const rawRelPath = req.params[0] || '';
  const filePath = path.resolve(PROJECTS_DIR, req.params.name, rawRelPath);
  // Security: prevent directory traversal
  if (!filePath.startsWith(path.resolve(PROJECTS_DIR))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    return res.sendFile(filePath); // sendFile requires absolute path — filePath is already absolute
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext)) {
    return res.sendFile(filePath);
  }
  try {
    res.json({ content: fs.readFileSync(filePath, 'utf8') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save/create file
app.put('/api/projects/:name/files/*', (req, res) => {
  const filePath = path.join(PROJECTS_DIR, req.params.name, req.params[0]);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, req.body.content || '');
  res.json({ saved: true });
});

// Delete file
app.delete('/api/projects/:name/files/*', (req, res) => {
  const filePath = path.join(PROJECTS_DIR, req.params.name, req.params[0]);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  fs.rmSync(filePath, { recursive: true });
  res.json({ deleted: true });
});

// Upload file
const upload = multer({ dest: '/tmp/latex-uploads/' });
app.post('/api/projects/:name/upload', upload.array('files'), (req, res) => {
  const projectPath = path.join(PROJECTS_DIR, req.params.name);
  req.files.forEach(file => {
    fs.renameSync(file.path, path.join(projectPath, file.originalname));
  });
  res.json({ uploaded: req.files.length });
});

// ─── Compile API ──────────────────────────────────────────────────────────────

app.post('/api/projects/:name/compile', (req, res) => {
  const { mainFile = 'main.tex' } = req.body;
  const projectPath = path.join(PROJECTS_DIR, req.params.name);
  if (!fs.existsSync(projectPath)) return res.status(404).json({ error: 'Not found' });

  const texFile = path.join(projectPath, mainFile);
  if (!fs.existsSync(texFile)) return res.status(404).json({ error: 'TeX file not found' });

  const baseName = path.basename(mainFile, '.tex');

  broadcast({ type: 'compile_start', project: req.params.name });

  let logOutput = '';

  function runCmd(cmd, cwd) {
    return new Promise((resolve, reject) => {
      const proc = exec(cmd, { cwd, timeout: 60000 }, (err, stdout, stderr) => {
        const out = (stdout || '') + (stderr || '');
        logOutput += out + '\n';
        broadcast({ type: 'compile_log', data: out });
        if (err && err.killed) reject(new Error('Timeout'));
        else resolve({ code: err ? err.code : 0, out });
      });
    });
  }

  (async () => {
    try {
      // Run pdflatex → bibtex → pdflatex → pdflatex
      await runCmd(`pdflatex -interaction=nonstopmode -halt-on-error "${mainFile}"`, projectPath);

      const bibFile = path.join(projectPath, baseName + '.aux');
      if (fs.existsSync(bibFile)) {
        try { await runCmd(`bibtex "${baseName}"`, projectPath); } catch (e) {}
      }

      await runCmd(`pdflatex -interaction=nonstopmode "${mainFile}"`, projectPath);
      await runCmd(`pdflatex -interaction=nonstopmode "${mainFile}"`, projectPath);

      const pdfPath = path.join(projectPath, baseName + '.pdf');
      const success = fs.existsSync(pdfPath);

      // Clean auxiliary files
      ['aux', 'bbl', 'blg', 'fls', 'log', 'out', 'toc', 'snm', 'nav', 'fdb_latexmk'].forEach(ext => {
        const f = path.join(projectPath, `${baseName}.${ext}`);
        if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch (e) {}
      });

      broadcast({ type: 'compile_done', success, pdfFile: success ? `${baseName}.pdf` : null });
      res.json({ success, log: logOutput, pdfFile: success ? `${baseName}.pdf` : null });
    } catch (err) {
      broadcast({ type: 'compile_done', success: false });
      res.status(500).json({ success: false, log: logOutput, error: err.message });
    }
  })();
});

// ─── Start server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 LaTeX Editor rodando em http://localhost:${PORT}\n`);
});
