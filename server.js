const http = require('node:http');
const { randomInt } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_TTL = 45_000;
const PAGE_SIZE = 48;
const SEAT_COUNT = 42;
const sessions = new Map();
const indexPath = path.join(__dirname, 'index.html');

function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL;
  for (const [session, visitor] of sessions) {
    if (visitor.lastSeen < cutoff) sessions.delete(session);
  }
}

function assignSeat() {
  const occupied = new Set([...sessions.values()].map(visitor => visitor.seat));
  const available = [];
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    if (seat % 7 !== 6 && !occupied.has(seat)) available.push(seat);
  }
  return available.length ? available[randomInt(available.length)] : null;
}

function presence(page, you = '') {
  pruneSessions();
  const guests = [...sessions.keys()].sort();
  const positions = Object.fromEntries([...sessions].map(([session, visitor]) => [session, visitor.seat]));
  const pages = Math.max(1, Math.ceil(guests.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pages - 1);
  const start = safePage * PAGE_SIZE;
  return {
    count: guests.length,
    guests: guests.slice(start, start + PAGE_SIZE),
    positions,
    you: sessions.has(you) ? you : '',
    page: safePage,
    pages
  };
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  response.end(payload);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 10_000) reject(new Error('Request too large'));
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (url.pathname === '/api/presence' && request.method === 'GET') {
    const page = Number.parseInt(url.searchParams.get('page') || '0', 10) || 0;
    sendJson(response, 200, presence(page, url.searchParams.get('session') || ''));
    return;
  }

  if (url.pathname === '/api/presence' && request.method === 'POST') {
    try {
      const body = await readJson(request);
      if (typeof body.session !== 'string' || body.session.length < 1 || body.session.length > 100) {
        sendJson(response, 400, { error: 'A valid session is required' });
        return;
      }
      if (body.action === 'leave') sessions.delete(body.session);
      else if (body.action === 'join') {
        const visitor = sessions.get(body.session);
        sessions.set(body.session, { lastSeen: Date.now(), seat: visitor?.seat ?? assignSeat() });
      }
      else {
        sendJson(response, 400, { error: 'Unknown action' });
        return;
      }
      sendJson(response, 200, presence(0, body.session));
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method !== 'GET' || url.pathname !== '/') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  fs.createReadStream(indexPath).on('error', () => {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Unable to load the temple');
  }).pipe(response);
});

server.listen(PORT, HOST, () => {
  console.log(`Still Temple listening on http://localhost:${PORT}`);
});
