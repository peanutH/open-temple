const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_TTL = 45_000;
const PAGE_SIZE = 48;
const sessions = new Map();
const indexPath = path.join(__dirname, 'index.html');

function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL;
  for (const [session, lastSeen] of sessions) {
    if (lastSeen < cutoff) sessions.delete(session);
  }
}

function presence(page, you = '') {
  pruneSessions();
  const guests = [...sessions.keys()].sort();
  const pages = Math.max(1, Math.ceil(guests.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pages - 1);
  const start = safePage * PAGE_SIZE;
  return {
    count: guests.length,
    guests: guests.slice(start, start + PAGE_SIZE),
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
      else if (body.action === 'join') sessions.set(body.session, Date.now());
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
