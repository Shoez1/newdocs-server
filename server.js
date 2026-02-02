const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

require('dotenv').config();

const fastify = require('fastify')({
  logger: true,
  trustProxy: true,
});

const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join(__dirname, 'storage');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

const TRANSFERS_FILE = path.join(DATA_DIR, 'transfers.json');

const PORT = Number(process.env.PORT || 3000);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 512);
const EXPIRE_HOURS = Number(process.env.EXPIRE_HOURS || 72);
const MAX_FILES = Number(process.env.MAX_FILES || 20);

function nowMs() {
  return Date.now();
}

function randomId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function sanitizeFilename(name) {
  return String(name || 'file')
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 180);
}

function getBaseUrl(req) {
  const envBase = (process.env.BASE_URL || '').trim();
  if (envBase) return envBase.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .toString()
    .split(',')[0]
    .trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '')
    .toString()
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

async function ensureDirs() {
  await fsp.mkdir(STORAGE_DIR, { recursive: true });
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(TRANSFERS_FILE);
  } catch {
    await fsp.writeFile(TRANSFERS_FILE, JSON.stringify({ transfers: {} }, null, 2));
  }
}

let dbWriteLock = Promise.resolve();

async function withDbWrite(fn) {
  const prev = dbWriteLock;
  let release;
  dbWriteLock = new Promise((r) => (release = r));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function readDb() {
  const raw = await fsp.readFile(TRANSFERS_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return { transfers: {} };
  if (!parsed.transfers || typeof parsed.transfers !== 'object') return { transfers: {} };
  return parsed;
}

async function writeDb(db) {
  const tmp = `${TRANSFERS_FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
  await fsp.rename(tmp, TRANSFERS_FILE);
}

function isExpired(transfer) {
  return !transfer || Number(transfer.expiresAt) <= nowMs();
}

async function deleteTransferFiles(transfer) {
  if (!transfer) return;
  const dir = path.join(STORAGE_DIR, transfer.id);
  await fsp.rm(dir, { recursive: true, force: true });
}

async function cleanupExpired() {
  await withDbWrite(async () => {
    const db = await readDb();
    const ids = Object.keys(db.transfers || {});
    let changed = false;

    for (const id of ids) {
      const t = db.transfers[id];
      if (isExpired(t)) {
        await deleteTransferFiles(t);
        delete db.transfers[id];
        changed = true;
      }
    }

    if (changed) await writeDb(db);
  });
}

fastify.register(require('@fastify/multipart'), {
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024,
    files: MAX_FILES,
  },
});

fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/',
});

fastify.get(['/', '/t/:id'], async (req, reply) => {
  return reply.sendFile('index.html');
});

fastify.get('/api/health', async () => ({ ok: true }));

fastify.post('/api/uploads', async (req, reply) => {
  const transferId = randomId();
  const transferDir = path.join(STORAGE_DIR, transferId);
  await fsp.mkdir(transferDir, { recursive: true });

  const files = [];
  const parts = req.parts();

  for await (const part of parts) {
    if (part.type !== 'file') continue;

    const originalName = sanitizeFilename(part.filename);
    const fileId = randomId();
    const storedName = `${fileId}-${originalName}`;
    const filePath = path.join(transferDir, storedName);

    await pipeline(part.file, fs.createWriteStream(filePath));

    let size = null;
    try {
      const st = await fsp.stat(filePath);
      size = st.size;
    } catch {
      size = null;
    }

    files.push({
      id: fileId,
      name: originalName,
      storedName,
      size,
      mime: part.mimetype || null,
    });
  }

  if (files.length === 0) {
    await fsp.rm(transferDir, { recursive: true, force: true });
    return reply.code(400).send({ error: 'Nenhum arquivo enviado.' });
  }

  const createdAt = nowMs();
  const expiresAt = createdAt + EXPIRE_HOURS * 60 * 60 * 1000;

  const transfer = {
    id: transferId,
    createdAt,
    expiresAt,
    downloads: 0,
    files,
  };

  await withDbWrite(async () => {
    const db = await readDb();
    db.transfers[transferId] = transfer;
    await writeDb(db);
  });

  const baseUrl = getBaseUrl(req);
  return reply.send({
    id: transferId,
    url: `${baseUrl}/t/${transferId}`,
    expiresAt,
    files: files.map((f) => ({ id: f.id, name: f.name, size: f.size })),
  });
});

fastify.get('/api/transfers/:id', async (req, reply) => {
  const id = String(req.params.id);
  const db = await readDb();
  const transfer = db.transfers[id];

  if (!transfer || isExpired(transfer)) {
    if (transfer && isExpired(transfer)) {
      await cleanupExpired();
    }
    return reply.code(404).send({ error: 'Link inválido ou expirado.' });
  }

  const baseUrl = getBaseUrl(req);

  return reply.send({
    id: transfer.id,
    createdAt: transfer.createdAt,
    expiresAt: transfer.expiresAt,
    files: transfer.files.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      downloadUrl: `${baseUrl}/d/${transfer.id}/${f.id}`,
    })),
  });
});

fastify.get('/d/:id/:fileId', async (req, reply) => {
  const id = String(req.params.id);
  const fileId = String(req.params.fileId);
  const db = await readDb();
  const transfer = db.transfers[id];

  if (!transfer || isExpired(transfer)) {
    if (transfer && isExpired(transfer)) {
      await cleanupExpired();
    }
    return reply.code(404).send('Link inválido ou expirado.');
  }

  const file = (transfer.files || []).find((f) => f.id === fileId);
  if (!file) {
    return reply.code(404).send('Arquivo não encontrado.');
  }

  const filePath = path.join(STORAGE_DIR, transfer.id, file.storedName);
  try {
    await fsp.access(filePath);
  } catch {
    return reply.code(404).send('Arquivo não encontrado.');
  }

  reply.header('Content-Type', file.mime || 'application/octet-stream');
  reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);

  return reply.send(fs.createReadStream(filePath));
});

async function start() {
  await ensureDirs();
  await cleanupExpired();

  setInterval(() => {
    cleanupExpired().catch((err) => fastify.log.error(err));
  }, 60 * 1000);

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
}

start().catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});
