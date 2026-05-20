// ═══════════════════════════════════════════════════════════════
//  talk2ev  –  ocpp-handler.js
//  OCPP 1.6J message router & state machine
// ═══════════════════════════════════════════════════════════════

'use strict';

const db = require('./db');

// ── In-memory state per connected charge point ────────────────
// { [cpId]: { ws, status, transactionId, connectorId, lastSeen } }
const connected = {};

// ── OCPP message types ────────────────────────────────────────
const CALL        = 2;
const CALL_RESULT = 3;
const CALL_ERROR  = 4;

// ── Register / unregister ─────────────────────────────────────
function register(cpId, ws) {
  connected[cpId] = {
    ws,
    status       : 'Connected',
    transactionId: null,
    connectorId  : 1,
    lastSeen     : new Date().toISOString(),
  };
}

function unregister(cpId) {
  if (connected[cpId]) {
    db.setStatus({ id: cpId, status: 'Offline', last_seen: new Date().toISOString() });
  }
  delete connected[cpId];
}

function listConnected() {
  return Object.keys(connected).map(id => ({
    id,
    status      : connected[id].status,
    transaction : connected[id].transactionId,
    lastSeen    : connected[id].lastSeen,
  }));
}

function getState(cpId) {
  const c = connected[cpId];
  if (!c) return null;
  return {
    cpId,
    status      : c.status,
    transactionId: c.transactionId,
    connectorId : c.connectorId,
    lastSeen    : c.lastSeen,
  };
}

// ── Main message entry point ──────────────────────────────────
function handle(cpId, ws, msg) {
  const cp = connected[cpId];
  if (!cp) return;

  cp.lastSeen = new Date().toISOString();

  // Log raw message
  db.logMsg({
    cp_id    : cpId,
    direction: 'IN',
    action   : Array.isArray(msg) ? (msg[2] || 'CallResult') : 'unknown',
    payload  : JSON.stringify(msg),
  });

  const [type] = msg;

  if (type === CALL) {
    const [, msgId, action, payload] = msg;
    log(cpId, `← ${action}`);
    handleCall(cpId, ws, msgId, action, payload || {});
    return;
  }

  if (type === CALL_RESULT) {
    const [, msgId, payload] = msg;
    log(cpId, `← CallResult [${msgId}]`);
    // future: resolve pending server-initiated calls
    return;
  }

  if (type === CALL_ERROR) {
    const [, msgId, errCode, errDesc] = msg;
    log(cpId, `← CallError [${msgId}] ${errCode}: ${errDesc}`);
    return;
  }

  log(cpId, `Unknown message type: ${type}`);
}

// ── Route OCPP actions ────────────────────────────────────────
function handleCall(cpId, ws, msgId, action, payload) {
  switch (action) {
    case 'BootNotification':      return onBootNotification(cpId, ws, msgId, payload);
    case 'Heartbeat':             return onHeartbeat(cpId, ws, msgId);
    case 'StatusNotification':    return onStatusNotification(cpId, ws, msgId, payload);
    case 'Authorize':             return onAuthorize(cpId, ws, msgId, payload);
    case 'StartTransaction':      return onStartTransaction(cpId, ws, msgId, payload);
    case 'StopTransaction':       return onStopTransaction(cpId, ws, msgId, payload);
    case 'MeterValues':           return onMeterValues(cpId, ws, msgId, payload);
    case 'DataTransfer':          return sendResult(ws, msgId, { status: 'Accepted' });
    default:
      log(cpId, `Unknown action: ${action}`);
      sendError(ws, msgId, 'NotImplemented', `Action not supported: ${action}`);
  }
}

// ── OCPP Action Handlers ──────────────────────────────────────

function onBootNotification(cpId, ws, msgId, payload) {
  db.upsertCP({
    id        : cpId,
    vendor    : payload.chargePointVendor   || '',
    model     : payload.chargePointModel    || '',
    serial    : payload.chargePointSerialNumber || '',
    firmware  : payload.firmwareVersion     || '',
    last_seen : new Date().toISOString(),
    status    : 'Available',
  });

  connected[cpId].status = 'Available';

  sendResult(ws, msgId, {
    status     : 'Accepted',
    currentTime: new Date().toISOString(),
    interval   : 300,   // heartbeat every 5 min
  });

  log(cpId, `✓ Boot accepted – ${payload.chargePointVendor} ${payload.chargePointModel}`);
}

function onHeartbeat(cpId, ws, msgId) {
  db.setStatus({ id: cpId, status: connected[cpId]?.status || 'Available', last_seen: new Date().toISOString() });
  sendResult(ws, msgId, { currentTime: new Date().toISOString() });
}

function onStatusNotification(cpId, ws, msgId, payload) {
  const { status, errorCode, connectorId } = payload;

  if (connected[cpId]) {
    connected[cpId].status      = status;
    connected[cpId].connectorId = connectorId || 1;
  }

  db.setStatus({ id: cpId, status, last_seen: new Date().toISOString() });
  sendResult(ws, msgId, {});

  const icon = statusIcon(status);
  log(cpId, `${icon} Status → ${status}${errorCode !== 'NoError' ? ` (${errorCode})` : ''}`);
}

function onAuthorize(cpId, ws, msgId, payload) {
  // TODO: validate against a real ID tag list
  // For now: accept everything
  sendResult(ws, msgId, {
    idTagInfo: { status: 'Accepted' },
  });
  log(cpId, `✓ Authorized tag: ${payload.idTag}`);
}

function onStartTransaction(cpId, ws, msgId, payload) {
  const { connectorId = 1, idTag, meterStart = 0, timestamp } = payload;

  const info = db.startTx({
    cp_id       : cpId,
    id_tag      : idTag,
    connector_id: connectorId,
    meter_start : meterStart,
    started_at  : timestamp || new Date().toISOString(),
  });

  const transactionId = info.lastInsertRowid;

  if (connected[cpId]) {
    connected[cpId].transactionId = transactionId;
    connected[cpId].status        = 'Charging';
  }

  sendResult(ws, msgId, {
    transactionId,
    idTagInfo: { status: 'Accepted' },
  });

  log(cpId, `⚡ Transaction #${transactionId} started | tag: ${idTag} | meter: ${meterStart} Wh`);
}

function onStopTransaction(cpId, ws, msgId, payload) {
  const { transactionId, meterStop = 0, timestamp, reason = 'Local' } = payload;

  db.stopTx({
    id         : transactionId,
    meter_stop : meterStop,
    stopped_at : timestamp || new Date().toISOString(),
    reason,
  });

  if (connected[cpId]) {
    connected[cpId].transactionId = null;
    connected[cpId].status        = 'Available';
  }

  sendResult(ws, msgId, {
    idTagInfo: { status: 'Accepted' },
  });

  const kwh = ((meterStop - 0) / 1000).toFixed(2);
  log(cpId, `■ Transaction #${transactionId} stopped | ${kwh} kWh | reason: ${reason}`);
}

function onMeterValues(cpId, ws, msgId, payload) {
  sendResult(ws, msgId, {});

  // Log the sampled values nicely
  const samples = payload?.meterValue?.[0]?.sampledValue || [];
  const parts   = samples.map(s => `${s.measurand || 'Value'}=${s.value}${s.unit || ''}`);
  if (parts.length) log(cpId, `📊 MeterValues: ${parts.join('  ')}`);
}

// ── Server → Charge Point commands ───────────────────────────
// (called from REST or future dashboard)

function remoteStart(cpId, idTag = 'MAROM-HOME-TAG', connectorId = 1) {
  return serverCall(cpId, 'RemoteStartTransaction', { connectorId, idTag });
}

function remoteStop(cpId) {
  const state = connected[cpId];
  if (!state?.transactionId) return Promise.reject(new Error('No active transaction'));
  return serverCall(cpId, 'RemoteStopTransaction', { transactionId: state.transactionId });
}

// ── Generic server-initiated Call ─────────────────────────────
let _msgCounter = 0;
function serverCall(cpId, action, payload) {
  return new Promise((resolve, reject) => {
    const cp = connected[cpId];
    if (!cp) return reject(new Error(`${cpId} not connected`));

    const msgId = `srv-${++_msgCounter}-${Date.now()}`;
    const msg   = JSON.stringify([CALL, msgId, action, payload]);

    cp.ws.send(msg);

    db.logMsg({ cp_id: cpId, direction: 'OUT', action, payload: msg });
    log(cpId, `→ ${action}`);

    // simple timeout – no pending map needed at this stage
    const t = setTimeout(() => reject(new Error(`Timeout: ${action}`)), 10000);
    cp.ws.once('message', (raw) => {
      clearTimeout(t);
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}

// ── Send helpers ──────────────────────────────────────────────
function sendResult(ws, msgId, payload) {
  ws.send(JSON.stringify([CALL_RESULT, msgId, payload]));
}

function sendError(ws, msgId, code, description) {
  ws.send(JSON.stringify([CALL_ERROR, msgId, code, description, {}]));
}

// ── Util ──────────────────────────────────────────────────────
function statusIcon(status) {
  const icons = {
    Available  : '🟢',
    Preparing  : '🟡',
    Charging   : '⚡',
    Finishing  : '🔵',
    Faulted    : '🔴',
    Unavailable: '⚫',
  };
  return icons[status] || '❓';
}

function log(cpId, ...args) {
  const ts = new Date().toLocaleTimeString('he-IL', { hour12: false });
  console.log(`[${ts}] [${cpId}]`, ...args);
}

// ── Exports ───────────────────────────────────────────────────
module.exports = {
  register,
  unregister,
  handle,
  listConnected,
  getState,
  remoteStart,
  remoteStop,
};
