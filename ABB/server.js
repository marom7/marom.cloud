// ═══════════════════════════════════════════════════════════════
//  talk2ev  –  server.js
//  OCPP 1.6J Central System
//  wss://ocpp.talk2ev.app/ocpp/:cpId
//  marom.cloud / 67.codes
// ═══════════════════════════════════════════════════════════════

'use strict';

const http    = require('http');
const { WebSocketServer } = require('ws');
const url     = require('url');
const db      = require('./db');
const handler = require('./ocpp-handler');

const PORT = process.env.PORT || 3000;

// ── Wait for DB, then start ───────────────────────────────────
db.ready.then(startServer).catch(e => {
  console.error('[server] DB init failed:', e);
  process.exit(1);
});

function startServer() {

  // ── HTTP (health + status endpoints) ───────────────────────
  const httpServer = http.createServer((req, res) => {
    const path = url.parse(req.url).pathname;

    if (path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status      : 'ok',
        service     : 'talk2ev OCPP server',
        time        : new Date().toISOString(),
        chargePoints: handler.listConnected(),
      }));
      return;
    }

    // GET /status/:cpId
    const m = path.match(/^\/status\/(.+)$/);
    if (m) {
      const cp = handler.getState(m[1]);
      res.writeHead(cp ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cp || { error: 'not connected' }));
      return;
    }

    res.writeHead(200);
    res.end('talk2ev ocpp-server 🟢');
  });

  // ── WebSocket ───────────────────────────────────────────────
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    const pathname = url.parse(req.url).pathname;
    const match    = pathname.match(/^\/ocpp\/(.+)$/);

    if (!match) {
      log(`Rejected – bad path: ${pathname}`);
      ws.close(1002, 'Expected /ocpp/<chargePointId>');
      return;
    }

    const cpId = decodeURIComponent(match[1]);
    const ip   = req.socket.remoteAddress;
    log(`[${cpId}] ✅ Connected from ${ip}`);

    handler.register(cpId, ws);

    ws.on('message', (raw) => {
      try {
        handler.handle(cpId, ws, JSON.parse(raw));
      } catch (e) {
        log(`[${cpId}] Parse error: ${e.message}`);
      }
    });

    ws.on('close', (code) => {
      log(`[${cpId}] ❌ Disconnected (code ${code})`);
      handler.unregister(cpId);
    });

    ws.on('error', (e) => log(`[${cpId}] WS error: ${e.message}`));
  });

  // ── Listen ──────────────────────────────────────────────────
  httpServer.listen(PORT, () => {
    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    log(`talk2ev OCPP server  🚀`);
    log(`WebSocket : ws://localhost:${PORT}/ocpp/<cpId>`);
    log(`Health    : http://localhost:${PORT}/health`);
    log(`Public    : wss://ocpp.talk2ev.app/ocpp/ABB1`);
    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  });

} // end startServer

function log(...args) {
  const ts = new Date().toLocaleTimeString('he-IL', { hour12: false });
  console.log(`[${ts}]`, ...args);
}
