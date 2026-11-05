// Git helpers: per-project version history (a bare repository in .history,
// invisible to the user) and the optional integration with a real .git repository.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const HISTORY_DIR = '.history';
const LABELS_FILE = 'labels.json';
// Internal files never go into history or into the user's repository
const EXCLUDES = ['/.output/', '/.history/', '/.project.json', '.git/'];
const IDENTITY = [
  '-c', 'user.name=Editor LaTeX', '-c', 'user.email=editor-latex@localhost',
  '-c', 'commit.gpgsign=false', '-c', 'core.quotepath=off',
];

class GitError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

function runGit(cwd, args, { timeout = 60000, input = null } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd,
      // Never block waiting for a username/password on the terminal
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', LC_ALL: 'C' },
    });
    const out = [], err = [];
    proc.stdout.on('data', d => out.push(d));
    proc.stderr.on('data', d => err.push(d));
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeout);
    proc.on('error', e => {
      clearTimeout(timer);
      reject(new GitError(e.code === 'ENOENT' ? 'O Git não está instalado neste computador' : e.message));
    });
    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() });
    });
    if (input !== null) proc.stdin.end(input);
  });
}

async function gitOk(cwd, args, opts) {
  const r = await runGit(cwd, args, opts);
  if (r.code !== 0) throw new GitError(r.stderr.trim().split('\n').pop() || `git ${args[0]} falhou`);
  return r.stdout.toString();
}

// One operation at a time per project (git takes an index lock)
const locks = new Map();
function serialized(dir, fn) {
  const prev = locks.get(dir) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(dir, next);
  next.finally(() => { if (locks.get(dir) === next) locks.delete(dir); }).catch(() => {});
  return next;
}

// ─── History (bare repo at <project>/.history, work tree = project) ──────────

const historyArgs = dir => [`--git-dir=${path.join(dir, HISTORY_DIR)}`, `--work-tree=${dir}`, ...IDENTITY];
const hgit = (dir, args, opts) => runGit(dir, [...historyArgs(dir), ...args], opts);
const hgitOk = (dir, args, opts) => gitOk(dir, [...historyArgs(dir), ...args], opts);

async function ensureHistory(dir) {
  const gitDir = path.join(dir, HISTORY_DIR);
  if (fs.existsSync(path.join(gitDir, 'HEAD'))) return;
  await gitOk(dir, ['init', '--quiet', '--bare', gitDir]);
  fs.mkdirSync(path.join(gitDir, 'info'), { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'info', 'exclude'), EXCLUDES.join('\n') + '\n');
}

// Commits the current state; resolves to the new commit hash, or null when nothing changed
function snapshot(dir, message) {
  return serialized(dir, async () => {
    await ensureHistory(dir);
    await hgitOk(dir, ['add', '-A']);
    const r = await hgit(dir, ['commit', '--quiet', '--no-verify', '-m', message]);
    if (r.code !== 0) return null;
    return (await hgitOk(dir, ['rev-parse', 'HEAD'])).trim();
  });
}

function readLabels(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, HISTORY_DIR, LABELS_FILE), 'utf8')); } catch { return {}; }
}

function writeLabels(dir, labels) {
  fs.writeFileSync(path.join(dir, HISTORY_DIR, LABELS_FILE), JSON.stringify(labels, null, 2));
}

const STATUS = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified' };

async function historyLog(dir, limit = 300) {
  if (!fs.existsSync(path.join(dir, HISTORY_DIR, 'HEAD'))) return [];
  const r = await hgit(dir, ['log', `-n${limit}`, '--format=%x1e%H%x1f%at%x1f%s', '--name-status', '-M']);
  if (r.code !== 0) return []; // no commits yet
  const labels = readLabels(dir);
  return r.stdout.toString().split('\x1e').filter(Boolean).map(record => {
    const [header, ...lines] = record.split('\n');
    const [hash, time, message] = header.split('\x1f');
    const files = lines.filter(Boolean).map(line => {
      const parts = line.split('\t');
      const status = STATUS[parts[0][0]] || 'modified';
      return status === 'renamed'
        ? { status, from: parts[1], path: parts[2] }
        : { status, path: parts[1] };
    });
    return { hash, date: new Date(Number(time) * 1000), message, files, labels: labels[hash] || [] };
  });
}

function checkHash(hash) {
  if (!/^[0-9a-f]{7,40}$/.test(String(hash))) throw new GitError('Versão inválida', 400);
  return hash;
}

// Unified diff of one file in a commit, with the whole file as context
async function historyDiff(dir, hash, file) {
  checkHash(hash);
  const r = await hgitOk(dir, ['show', '--format=', '--no-color', '-M', '-U100000', hash, '--', file]);
  return r;
}

async function historyFile(dir, hash, file) {
  checkHash(hash);
  const r = await hgit(dir, ['show', `${hash}:${file}`]);
  if (r.code !== 0) throw new GitError('O arquivo não existe nesta versão', 404);
  return r.stdout;
}

// Restores one file, or the whole project, to how it was in `hash`
function historyRestore(dir, hash, file = null) {
  checkHash(hash);
  return serialized(dir, async () => {
    const when = (await hgitOk(dir, ['log', '-1', '--format=%at', hash])).trim();
    const label = new Date(Number(when) * 1000).toLocaleString('pt-BR');
    if (file) {
      const r = await hgit(dir, ['show', `${hash}:${file}`]);
      if (r.code !== 0) throw new GitError('O arquivo não existe nesta versão', 404);
      const abs = path.join(dir, file);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, r.stdout);
    } else {
      // Save what's there now, so the restore itself can be undone
      await hgitOk(dir, ['add', '-A']);
      await hgit(dir, ['commit', '--quiet', '--no-verify', '-m', 'Antes de restaurar uma versão']);
      const target = new Set((await hgitOk(dir, ['ls-tree', '-r', '--name-only', '-z', hash])).split('\0').filter(Boolean));
      const tracked = (await hgitOk(dir, ['ls-files', '-z'])).split('\0').filter(Boolean);
      for (const f of tracked) if (!target.has(f)) fs.rmSync(path.join(dir, f), { force: true });
      await hgitOk(dir, ['checkout', hash, '--', '.']);
    }
    await hgitOk(dir, ['add', '-A']);
    await hgit(dir, ['commit', '--quiet', '--no-verify', '-m',
      file ? `Restaurado ${file} da versão de ${label}` : `Projeto restaurado para a versão de ${label}`]);
  });
}

function addLabel(dir, hash, label) {
  checkHash(hash);
  const labels = readLabels(dir);
  labels[hash] = [...new Set([...(labels[hash] || []), label])];
  writeLabels(dir, labels);
  return labels[hash];
}

function removeLabel(dir, hash, label) {
  checkHash(hash);
  const labels = readLabels(dir);
  labels[hash] = (labels[hash] || []).filter(l => l !== label);
  if (!labels[hash].length) delete labels[hash];
  writeLabels(dir, labels);
}

// ─── Integration with a real repository (<project>/.git) ─────────────────────

const isRepo = dir => fs.existsSync(path.join(dir, '.git'));

function ensureRepoExcludes(dir) {
  const file = path.join(dir, '.git', 'info', 'exclude');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch {}
  const missing = EXCLUDES.filter(e => e !== '.git/' && !text.split('\n').includes(e));
  if (!missing.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text + (text && !text.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
}

async function repoStatus(dir) {
  if (!isRepo(dir)) return { repo: false };
  ensureRepoExcludes(dir);
  const status = await gitOk(dir, ['-c', 'core.quotepath=off', 'status', '--porcelain=v1', '-b']);
  const [head, ...lines] = status.split('\n').filter(Boolean);
  const branch = (head.match(/^## (?:No commits yet on )?([^.\s]+)/) || [])[1] || '';
  const ahead = Number((head.match(/ahead (\d+)/) || [])[1] || 0);
  const behind = Number((head.match(/behind (\d+)/) || [])[1] || 0);
  const remote = (await runGit(dir, ['remote', 'get-url', 'origin'])).stdout.toString().trim();
  const last = (await runGit(dir, ['log', '-1', '--format=%h%x1f%s%x1f%at'])).stdout.toString().trim();
  const [lastHash, lastMessage, lastTime] = last ? last.split('\x1f') : [];
  return {
    repo: true,
    branch,
    remote,
    ahead,
    behind,
    changes: lines.map(l => ({ code: l.slice(0, 2).trim(), path: l.slice(3) })),
    last: lastHash ? { hash: lastHash, message: lastMessage, date: new Date(Number(lastTime) * 1000) } : null,
  };
}

async function repoInit(dir) {
  if (isRepo(dir)) throw new GitError('O projeto já é um repositório Git', 409);
  await gitOk(dir, ['init', '--quiet', '-b', 'main']);
  ensureRepoExcludes(dir);
}

function validRemoteUrl(url) {
  return typeof url === 'string' && /^(https:\/\/|ssh:\/\/|git@)[^\s]+$/.test(url.trim());
}

async function repoSetRemote(dir, url) {
  if (!validRemoteUrl(url)) throw new GitError('Use um endereço https://, ssh:// ou git@', 400);
  const has = (await runGit(dir, ['remote', 'get-url', 'origin'])).code === 0;
  await gitOk(dir, ['remote', has ? 'set-url' : 'add', 'origin', url.trim()]);
}

// Uses the user's own identity when configured, falling back to a local one
async function identityArgs(dir) {
  const name = (await runGit(dir, ['config', 'user.name'])).stdout.toString().trim();
  const email = (await runGit(dir, ['config', 'user.email'])).stdout.toString().trim();
  return [
    ...(name ? [] : ['-c', 'user.name=Editor LaTeX']),
    ...(email ? [] : ['-c', 'user.email=editor-latex@localhost']),
  ];
}

async function repoCommit(dir, message) {
  ensureRepoExcludes(dir);
  await gitOk(dir, ['add', '-A']);
  const r = await runGit(dir, [...(await identityArgs(dir)), 'commit', '--quiet', '-m', message]);
  if (r.code !== 0) throw new GitError(/nothing to commit/.test(r.stdout + r.stderr) ? 'Não há alterações para enviar' : r.stderr.trim() || 'Falha no commit', 400);
}

const authHint = msg => /could not read Username|Authentication failed|Permission denied|terminal prompts disabled/i.test(msg)
  ? 'O Git precisa de credenciais. Configure uma chave SSH ou um gerenciador de credenciais (ex.: gh auth login) e tente de novo.'
  : msg;

async function repoPull(dir) {
  const r = await runGit(dir, [...(await identityArgs(dir)), 'pull', '--ff-only'], { timeout: 120000 });
  if (r.code !== 0) throw new GitError(authHint(r.stderr.trim().split('\n').pop()), 400);
  return r.stdout.toString().trim();
}

async function repoPush(dir) {
  const r = await runGit(dir, ['push', '-u', 'origin', 'HEAD'], { timeout: 120000 });
  if (r.code !== 0) throw new GitError(authHint(r.stderr.trim().split('\n').pop()), 400);
}

async function cloneInto(url, dest) {
  if (!validRemoteUrl(url)) throw new GitError('Use um endereço https://, ssh:// ou git@', 400);
  const r = await runGit(path.dirname(dest), ['clone', '--quiet', url.trim(), dest], { timeout: 300000 });
  if (r.code !== 0) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw new GitError(authHint(r.stderr.trim().split('\n').pop() || 'Não foi possível clonar o repositório'), 400);
  }
  ensureRepoExcludes(dest);
}

module.exports = {
  HISTORY_DIR, GitError,
  snapshot, historyLog, historyDiff, historyFile, historyRestore, addLabel, removeLabel,
  isRepo, repoStatus, repoInit, repoSetRemote, repoCommit, repoPull, repoPush, cloneInto,
};
