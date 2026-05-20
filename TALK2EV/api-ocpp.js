/* ═══════════════════════════════════════════════════════════════
   talk2ev.app  –  api-ocpp.js
   OCPP 1.6J / 2.0.1  WebSocket client layer
   Target server: Node.js on turtle67  (ws://turtle67:3000/ocpp)
   ═══════════════════════════════════════════════════════════════

   HOW IT WORKS
   ────────────
   OCPP (Open Charge Point Protocol) uses JSON over WebSocket.
   Each message is an array:
     [2, "<msgId>", "<action>",  { ...payload }]  → Request  (Call)
     [3, "<msgId>",              { ...payload }]  → Response (CallResult)
     [4, "<msgId>", "<errCode>", "<desc>", {}]    → Error    (CallError)

   This file exposes a single global object:  window.OCPP
   app.js calls OCPP.remoteStart() / OCPP.remoteStop() / OCPP.getStatus()
   and listens to OCPP.on('statusNotification', cb) etc.

   When the server is not yet available, all calls fall through to
   MOCK MODE so the UI keeps working in development.
   ═══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  // ── CONFIG ────────────────────────────────────────────────────
  const CONFIG = {
    /** WebSocket endpoint of the future Node.js OCPP server.
     *  Change to wss:// + real hostname once the server is live. */
    serverUrl:    'ws://localhost:3000/ocpp/ABB1',

    /** OCPP Charge Point identifier (must match server config) */
    chargePointId: 'ABB1',

    /** Connector index on the ABB Terra AC (single-phase = 1) */
    connectorId:   1,

    /** ID tag used in RemoteStartTransaction (later: user auth) */
    idTag:         'MAROM-HOME-TAG',

    /** ms between reconnect attempts */
    reconnectDelay: 5000,

    /** Print debug messages to console */
    debug: true,
  };

  // ── INTERNAL STATE ────────────────────────────────────────────
  let ws            = null;
  let connected     = false;
  let mockMode      = true;           // flips to false once WS connects
  let msgCounter    = 0;
  const pending     = {};             // msgId → { resolve, reject, timeout }
  const listeners   = {};             // event → [callbacks]

  // ── HELPERS ───────────────────────────────────────────────────
  function log(...args) {
    if (CONFIG.debug) console.log('[OCPP]', ...args);
  }

  function uid() {
    return `msg-${++msgCounter}-${Date.now()}`;
  }

  // ── EVENT EMITTER (tiny) ──────────────────────────────────────
  function on(event, cb) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(cb);
  }

  function off(event, cb) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(fn => fn !== cb);
  }

  function emit(event, data) {
    (listeners[event] || []).forEach(cb => {
      try { cb(data); } catch (e) { console.error('[OCPP] listener error', e); }
    });
  }

  // ── WEBSOCKET CONNECT ─────────────────────────────────────────
  function connect() {
    if (ws && ws.readyState < 2) return; // already open/connecting

    log(`Connecting → ${CONFIG.serverUrl}`);
    emit('connecting', {});

    try {
      ws = new WebSocket(CONFIG.serverUrl, ['ocpp1.6']);
    } catch (e) {
      log('WebSocket not available, staying in mock mode');
      return;
    }

    ws.onopen = () => {
      connected = true;
      mockMode  = false;
      log('Connected ✓');
      emit('connected', {});
      _sendBootNotification();
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        _handleMessage(msg);
      } catch (e) {
        log('Parse error', e);
      }
    };

    ws.onerror = (e) => {
      log('WebSocket error', e);
      emit('error', { message: 'WebSocket error' });
    };

    ws.onclose = (evt) => {
      connected = false;
      mockMode  = true;
      log(`Disconnected (code ${evt.code}). Retrying in ${CONFIG.reconnectDelay}ms…`);
      emit('disconnected', { code: evt.code });
      setTimeout(connect, CONFIG.reconnectDelay);
    };
  }

  // ── MESSAGE ROUTER ────────────────────────────────────────────
  function _handleMessage(msg) {
    const [type, id] = msg;

    if (type === 3) {
      // CallResult → resolve pending promise
      if (pending[id]) {
        clearTimeout(pending[id].timeout);
        pending[id].resolve(msg[2]);
        delete pending[id];
      }
      return;
    }

    if (type === 4) {
      // CallError
      if (pending[id]) {
        clearTimeout(pending[id].timeout);
        pending[id].reject({ code: msg[2], description: msg[3] });
        delete pending[id];
      }
      return;
    }

    if (type === 2) {
      // Inbound Call from server (CS-initiated)
      const action  = msg[2];
      const payload = msg[3];
      log(`← Server call: ${action}`, payload);
      _handleServerCall(id, action, payload);
    }
  }

  // ── SERVER-INITIATED CALLS ────────────────────────────────────
  function _handleServerCall(id, action, payload) {
    switch (action) {

      case 'RemoteStartTransaction':
        emit('remoteStart', payload);
        _sendCallResult(id, { status: 'Accepted' });
        break;

      case 'RemoteStopTransaction':
        emit('remoteStop', payload);
        _sendCallResult(id, { status: 'Accepted' });
        break;

      case 'ChangeAvailability':
        emit('availabilityChange', payload);
        _sendCallResult(id, { status: 'Accepted' });
        break;

      case 'GetConfiguration':
        _sendCallResult(id, { configurationKey: [], unknownKey: [] });
        break;

      default:
        log(`Unknown action from server: ${action}`);
        _sendCallResult(id, {});
    }
  }

  // ── SEND HELPERS ──────────────────────────────────────────────
  function _send(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log('Send failed – not connected');
      return false;
    }
    ws.send(JSON.stringify(data));
    return true;
  }

  function _sendCallResult(id, payload) {
    _send([3, id, payload]);
  }

  /** Send a Call and return a Promise that resolves with the CallResult payload */
  function _call(action, payload, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (mockMode) {
        log(`[MOCK] ${action}`, payload);
        // Simulate server response after short delay
        setTimeout(() => resolve(_mockResponse(action, payload)), 250);
        return;
      }

      const id = uid();
      const timeout = setTimeout(() => {
        delete pending[id];
        reject(new Error(`OCPP timeout: ${action}`));
      }, timeoutMs);

      pending[id] = { resolve, reject, timeout };
      _send([2, id, action, payload]);
      log(`→ ${action}`, payload);
    });
  }

  // ── MOCK RESPONSES (dev / offline mode) ──────────────────────
  function _mockResponse(action, payload) {
    const responses = {
      BootNotification:          { status: 'Accepted', currentTime: new Date().toISOString(), interval: 300 },
      Heartbeat:                 { currentTime: new Date().toISOString() },
      Authorize:                 { idTagInfo: { status: 'Accepted' } },
      StartTransaction:          { transactionId: Math.floor(Math.random() * 9000) + 1000, idTagInfo: { status: 'Accepted' } },
      StopTransaction:           { idTagInfo: { status: 'Accepted' } },
      StatusNotification:        {},
      MeterValues:               {},
      RemoteStartTransaction:    { status: 'Accepted' },
      RemoteStopTransaction:     { status: 'Accepted' },
    };
    return responses[action] || {};
  }

  // ── OCPP ACTIONS (CP → CS) ────────────────────────────────────

  async function _sendBootNotification() {
    const res = await _call('BootNotification', {
      chargePointVendor: 'ABB',
      chargePointModel:  'Terra AC W11-G5-R-0',
      chargePointSerialNumber: 'ABB1-MAROM-2024',
      firmwareVersion:   '1.9.0',
    });
    log('BootNotification response:', res);
    emit('booted', res);
    _sendStatusNotification('Available');
  }

  function _sendStatusNotification(status, errorCode = 'NoError') {
    return _call('StatusNotification', {
      connectorId:  CONFIG.connectorId,
      status,       // Available | Preparing | Charging | SuspendedEVSE | Finishing | Faulted
      errorCode,
      timestamp:    new Date().toISOString(),
    }).then(res => {
      emit('statusNotification', { status, errorCode });
      return res;
    });
  }

  // ── PUBLIC API ────────────────────────────────────────────────

  /**
   * Authorize an ID tag before starting a transaction.
   * @returns {Promise<{status: string}>}  status: Accepted | Blocked | Expired | Invalid
   */
  async function authorize(idTag = CONFIG.idTag) {
    const res = await _call('Authorize', { idTag });
    log('Authorize:', res.idTagInfo.status);
    return res.idTagInfo;
  }

  /**
   * Start a charging transaction.
   * Sends Authorize + StartTransaction + StatusNotification(Charging)
   * @returns {Promise<{transactionId: number, status: string}>}
   */
  async function remoteStart(idTag = CONFIG.idTag) {
    const auth = await authorize(idTag);
    if (auth.status !== 'Accepted') {
      emit('error', { message: `Auth failed: ${auth.status}` });
      return { status: auth.status };
    }

    const res = await _call('StartTransaction', {
      connectorId:  CONFIG.connectorId,
      idTag,
      meterStart:   0,
      timestamp:    new Date().toISOString(),
    });

    await _sendStatusNotification('Charging');
    emit('transactionStarted', { transactionId: res.transactionId });
    log('Transaction started:', res.transactionId);
    return { status: 'Accepted', transactionId: res.transactionId };
  }

  /**
   * Stop an active charging transaction.
   * @param {number} transactionId
   * @param {number} meterStop  – total Wh delivered
   */
  async function remoteStop(transactionId, meterStop = 0) {
    const res = await _call('StopTransaction', {
      transactionId,
      meterStop,
      timestamp:    new Date().toISOString(),
      reason:       'Remote',
    });

    await _sendStatusNotification('Finishing');
    setTimeout(() => _sendStatusNotification('Available'), 2000);
    emit('transactionStopped', { transactionId, meterStop });
    log('Transaction stopped:', transactionId);
    return res;
  }

  /**
   * Send a MeterValues update (called periodically while charging).
   * @param {number} transactionId
   * @param {number} powerW   – current power in Watts
   * @param {number} totalWh  – energy delivered so far in Wh
   */
  async function sendMeterValues(transactionId, powerW, totalWh) {
    return _call('MeterValues', {
      connectorId:   CONFIG.connectorId,
      transactionId,
      meterValue: [{
        timestamp: new Date().toISOString(),
        sampledValue: [
          { value: String(powerW),  unit: 'W',  measurand: 'Power.Active.Import', context: 'Sample.Periodic' },
          { value: String(totalWh), unit: 'Wh', measurand: 'Energy.Active.Import.Register', context: 'Sample.Periodic' },
        ],
      }],
    });
  }

  /**
   * Request current status from the server / charger.
   * In mock mode returns a simulated snapshot.
   */
  async function getStatus() {
    if (mockMode) {
      return {
        mode:      'mock',
        connected: false,
        serverUrl: CONFIG.serverUrl,
        message:   'Server not yet available – running in offline/mock mode',
      };
    }
    // Real: send a Heartbeat and return connectivity info
    await _call('Heartbeat', {});
    return { mode: 'live', connected: true, serverUrl: CONFIG.serverUrl };
  }

  /** Manually trigger a reconnect attempt */
  function reconnect() {
    if (ws) { ws.close(); ws = null; }
    connect();
  }

  // ── EXPORT ────────────────────────────────────────────────────
  global.OCPP = {
    // lifecycle
    connect,
    reconnect,
    // actions
    authorize,
    remoteStart,
    remoteStop,
    sendMeterValues,
    getStatus,
    // events
    on,
    off,
    // read-only state
    get connected() { return connected; },
    get mockMode()  { return mockMode; },
    get config()    { return { ...CONFIG }; },
  };

  log('api-ocpp.js loaded — attempting connection…');
  connect();

})(window);
