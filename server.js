const http = require('node:http');
const { readFile, mkdir, rename, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'bingo-sessions.json');
const FRONTEND_FILE = path.join(__dirname, 'index.html');
const MAX_BALLS = 75;
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || '*').split(',').map((value) => value.trim()));

let database = { sessions: [] };
let writeQueue = Promise.resolve();

function letterFor(number) {
  if (number <= 15) return 'B';
  if (number <= 30) return 'I';
  if (number <= 45) return 'N';
  if (number <= 60) return 'G';
  return 'O';
}

function formatBall(number) {
  return `${letterFor(number)}-${String(number).padStart(2, '0')}`;
}

function publicSession(session) {
  const calledNumbers = [...session.calledNumbers];
  return {
    id: session.id,
    name: session.name,
    gameType: '75-ball',
    status: session.status,
    autoDraw: session.autoDraw,
    drawIntervalSeconds: session.drawIntervalSeconds,
    calledNumbers,
    totalCalled: calledNumbers.length,
    totalRemaining: MAX_BALLS - calledNumbers.length,
    lastCalled: calledNumbers.length ? formatBall(calledNumbers.at(-1)) : null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt || null,
    winners: session.winners || []
  };
}

async function persist() {
  const snapshot = JSON.stringify(database, null, 2);
  writeQueue = writeQueue.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const temporaryFile = `${DATA_FILE}.tmp`;
    await writeFile(temporaryFile, snapshot, 'utf8');
    await rename(temporaryFile, DATA_FILE);
  });
  return writeQueue;
}

async function load() {
  if (!existsSync(DATA_FILE)) return;
  try {
    const parsed = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    if (Array.isArray(parsed.sessions)) database = parsed;
  } catch (error) {
    console.error('Could not load saved bingo sessions:', error.message);
  }
}

function createSession({ name = 'New session', autoDraw = false, drawIntervalSeconds = 5 } = {}) {
  const now = new Date().toISOString();
  const session = {
    id: randomUUID(),
    name: String(name).trim().slice(0, 80) || 'New session',
    status: 'in_progress',
    autoDraw: Boolean(autoDraw),
    drawIntervalSeconds: Number(drawIntervalSeconds),
    calledNumbers: [],
    winners: [],
    createdAt: now,
    updatedAt: now
  };
  database.sessions.push(session);
  return session;
}

function sessionById(id) {
  return database.sessions.find((session) => session.id === id);
}

function takeNextBall(session) {
  if (session.status !== 'in_progress') return null;
  const called = new Set(session.calledNumbers);
  const available = Array.from({ length: MAX_BALLS }, (_, index) => index + 1).filter((number) => !called.has(number));
  if (!available.length) {
    session.status = 'completed';
    session.autoDraw = false;
    session.completedAt = new Date().toISOString();
    return null;
  }
  const number = available[Math.floor(Math.random() * available.length)];
  session.calledNumbers.push(number);
  session.updatedAt = new Date().toISOString();
  if (session.calledNumbers.length === MAX_BALLS) {
    session.status = 'completed';
    session.autoDraw = false;
    session.completedAt = session.updatedAt;
  }
  return number;
}

function send(response, status, body, origin) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(body));
}

function requestOrigin(request) {
  const origin = request.headers.origin;
  if (!origin || allowedOrigins.has('*') || allowedOrigins.has(origin)) return origin || '*';
  return null;
}

async function bodyOf(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error('Request payload too large');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('Request body must be valid JSON'); }
}

function validateSettings(body) {
  const seconds = Number(body.drawIntervalSeconds);
  if (!Number.isInteger(seconds) || seconds < 3 || seconds > 15) {
    return 'drawIntervalSeconds must be an integer from 3 to 15.';
  }
  if (typeof body.autoDraw !== 'boolean') return 'autoDraw must be true or false.';
  return null;
}

async function handler(request, response) {
  const origin = requestOrigin(request);
  if (!origin) return send(response, 403, { error: 'Origin is not allowed.' }, '*');
  if (request.method === 'OPTIONS') return send(response, 204, {}, origin);

  const url = new URL(request.url, `http://${request.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await readFile(FRONTEND_FILE, 'utf8');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(html);
    }
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return send(response, 200, { ok: true, service: 'bingo-api' }, origin);
    }
    if (request.method === 'GET' && url.pathname === '/api/sessions') {
      return send(response, 200, { sessions: database.sessions.map(publicSession) }, origin);
    }
    if (request.method === 'DELETE' && url.pathname === '/api/sessions/history') {
      const before = database.sessions.length;
      database.sessions = database.sessions.filter((session) => session.status === 'in_progress');
      const deleted = before - database.sessions.length;
      await persist();
      return send(response, 200, { deleted }, origin);
    }
    if (request.method === 'POST' && url.pathname === '/api/sessions') {
      const body = await bodyOf(request);
      if (body.drawIntervalSeconds !== undefined && (!Number.isInteger(Number(body.drawIntervalSeconds)) || Number(body.drawIntervalSeconds) < 3 || Number(body.drawIntervalSeconds) > 15)) {
        return send(response, 400, { error: 'drawIntervalSeconds must be an integer from 3 to 15.' }, origin);
      }
      const session = createSession(body);
      await persist();
      return send(response, 201, { session: publicSession(session) }, origin);
    }
    if (parts[0] !== 'api' || parts[1] !== 'sessions' || !parts[2]) {
      return send(response, 404, { error: 'Route not found.' }, origin);
    }
    const session = sessionById(parts[2]);
    if (!session) return send(response, 404, { error: 'Session not found.' }, origin);

    if (request.method === 'GET' && parts.length === 3) return send(response, 200, { session: publicSession(session) }, origin);
    if (request.method === 'POST' && parts.length === 4 && parts[3] === 'draw') {
      const number = takeNextBall(session);
      await persist();
      if (number === null) return send(response, 409, { error: 'All balls have already been drawn.', session: publicSession(session) }, origin);
      return send(response, 200, { drawn: { number, label: formatBall(number) }, session: publicSession(session) }, origin);
    }
    if (request.method === 'PATCH' && parts.length === 4 && parts[3] === 'settings') {
      const body = await bodyOf(request);
      const error = validateSettings(body);
      if (error) return send(response, 400, { error }, origin);
      if (session.status !== 'in_progress' && body.autoDraw) return send(response, 409, { error: 'An ended session cannot start auto draw.' }, origin);
      session.autoDraw = body.autoDraw;
      session.drawIntervalSeconds = Number(body.drawIntervalSeconds);
      session.updatedAt = new Date().toISOString();
      await persist();
      return send(response, 200, { session: publicSession(session) }, origin);
    }
    if (request.method === 'POST' && parts.length === 4 && parts[3] === 'reset') {
      session.calledNumbers = [];
      session.status = 'in_progress';
      session.autoDraw = false;
      session.completedAt = null;
      session.updatedAt = new Date().toISOString();
      await persist();
      return send(response, 200, { session: publicSession(session) }, origin);
    }
    if (request.method === 'POST' && parts.length === 4 && parts[3] === 'close') {
      const body = await bodyOf(request);
      if (!Array.isArray(body.winners) || body.winners.length === 0 || body.winners.some((winner) => typeof winner !== 'string' || !winner.trim())) {
        return send(response, 400, { error: 'Informe pelo menos um nome de ganhador.' }, origin);
      }
      if (session.status === 'in_progress') {
        session.status = 'closed';
        session.autoDraw = false;
        session.winners = body.winners.map((winner) => winner.trim().slice(0, 80)).slice(0, 20);
        session.completedAt = new Date().toISOString();
        session.updatedAt = session.completedAt;
        await persist();
      }
      return send(response, 200, { session: publicSession(session) }, origin);
    }
    return send(response, 404, { error: 'Route not found.' }, origin);
  } catch (error) {
    const status = error.message === 'Request payload too large' ? 413 : 400;
    return send(response, status, { error: error.message || 'Invalid request.' }, origin);
  }
}

async function start() {
  await load();
  if (!database.sessions.length) {
    createSession({ name: 'Session #402' });
    await persist();
  }
  http.createServer(handler).listen(PORT, () => console.log(`Bingo API ready at http://localhost:${PORT}`));
}

if (require.main === module) start();

module.exports = { createSession, formatBall, letterFor, takeNextBall };
