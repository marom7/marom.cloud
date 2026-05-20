/* ═══════════════════════════════════════════════
   talk2ev.app  –  app.js
   UI state machine + OCPP event wiring
   Depends on: api-ocpp.js  (window.OCPP)
   ═══════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── STATE ──────────────────────────────────────
  const state = {
    charging:      false,
    soc:           20,      // %
    kwh:           0,       // kWh delivered this session
    kw:            0,       // current power kW
    startTime:     null,
    transactionId: null,
    interval:      null,
    meterInterval: null,
  };

  // ── DOM REFS ───────────────────────────────────
  const $ = id => document.getElementById(id);

  const DOM = {
    fill:        $('fill'),
    pctNum:      $('pctNum'),
    kwhVal:      $('kwhVal'),
    costVal:     $('costVal'),
    timeVal:     $('timeVal'),
    bolt:        $('bolt'),
    dot:         $('dot'),
    statusLabel: $('statusLabel'),
    btnStart:    $('btnStart'),
    btnStop:     $('btnStop'),
    powerBar:    $('powerBar'),
    powerVal:    $('powerVal'),
    toast:       $('toast'),
  };

  // ── RENDER ─────────────────────────────────────
  function render() {
    const soc = state.soc;

    DOM.pctNum.textContent = Math.round(soc);
    DOM.fill.style.height  = soc + '%';
    DOM.fill.className     = 'battery-fill ' + (soc < 25 ? 'low' : soc < 60 ? 'mid' : 'high');

    DOM.kwhVal.textContent  = state.kwh.toFixed(2);
    DOM.costVal.textContent = (state.kwh * 0.62).toFixed(2) + ' ₪';

    const kw = state.kw;
    DOM.powerBar.style.width  = (kw / 11 * 100) + '%';
    DOM.powerVal.textContent  = kw.toFixed(1) + ' kW';
  }

  // ── TOAST ──────────────────────────────────────
  function toast(msg, duration = 2500) {
    DOM.toast.textContent = msg;
    DOM.toast.classList.add('show');
    setTimeout(() => DOM.toast.classList.remove('show'), duration);
  }

  // ── STATUS HEADER ──────────────────────────────
  function setStatus(label, dotClass = '') {
    DOM.statusLabel.textContent = label;
    DOM.dot.className = 'dot ' + dotClass;
  }

  // ── START CHARGING ─────────────────────────────
  async function startCharging() {
    if (state.charging || state.soc >= 100) return;

    setStatus('STARTING…', 'connecting');
    DOM.btnStart.disabled = true;

    // Call OCPP layer (mock-safe)
    const result = await OCPP.remoteStart();

    if (result.status !== 'Accepted') {
      toast(`❌ שגיאה: ${result.status}`);
      setStatus('ERROR', 'error');
      DOM.btnStart.disabled = false;
      return;
    }

    state.charging      = true;
    state.transactionId = result.transactionId || null;

    if (!state.startTime) {
      state.startTime = new Date();
      DOM.timeVal.textContent = state.startTime.toLocaleTimeString('he-IL', {
        hour: '2-digit', minute: '2-digit'
      });
    }

    setStatus('CHARGING', 'charging');
    DOM.bolt.classList.add('active');
    DOM.btnStop.disabled = false;

    toast('⚡ טעינה החלה');

    // Simulate SOC rise (will be replaced by real MeterValues from OCPP server)
    state.interval = setInterval(() => {
      if (state.soc < 100) {
        state.soc  = Math.min(100, state.soc + 1.5);
        state.kwh += 0.48;
        state.kw   = 7.2;
        render();
      } else {
        stopCharging(true);
      }
    }, 160);

    // Send MeterValues to server every 60 s
    state.meterInterval = setInterval(() => {
      if (state.transactionId) {
        OCPP.sendMeterValues(
          state.transactionId,
          Math.round(state.kw * 1000),   // W
          Math.round(state.kwh * 1000)   // Wh
        );
      }
    }, 60_000);
  }

  // ── STOP CHARGING ──────────────────────────────
  async function stopCharging(full = false) {
    state.charging = false;
    state.kw       = 0;

    clearInterval(state.interval);
    clearInterval(state.meterInterval);

    // Notify OCPP server
    if (state.transactionId) {
      await OCPP.remoteStop(state.transactionId, Math.round(state.kwh * 1000));
      state.transactionId = null;
    }

    setStatus(full ? 'FULL' : 'STANDBY', '');
    DOM.bolt.classList.remove('active');
    DOM.btnStart.disabled = state.soc >= 100;
    DOM.btnStop.disabled  = true;

    render();
    toast(full ? '✅ הטעינה הסתיימה – 100%' : '⏹ הטעינה עצרה');
  }

  // ── STATUS BUTTON ──────────────────────────────
  async function showStatus() {
    const ocppInfo = await OCPP.getStatus();
    const elapsed  = state.startTime
      ? Math.round((Date.now() - state.startTime) / 60000) + ' דק\''
      : '—';

    const mode = ocppInfo.mockMode !== false ? '🔌 offline' : '🟢 live';
    toast(
      `🚗 SOC: ${Math.round(state.soc)}%  ⚡ ${state.kwh.toFixed(2)} kWh  💰 ${(state.kwh * 0.62).toFixed(2)}₪  ⏱ ${elapsed}  ${mode}`,
      4500
    );
  }

  // ── OCPP EVENT WIRING ──────────────────────────
  OCPP.on('connected',    ()  => { setStatus('CONNECTED', '');       toast('📡 שרת OCPP מחובר'); });
  OCPP.on('disconnected', ()  => { setStatus('OFFLINE', 'error');    toast('⚠️ התנתק מהשרת'); });
  OCPP.on('connecting',   ()  => { setStatus('CONNECTING…', 'connecting'); });
  OCPP.on('booted',       ()  => { setStatus('STANDBY', ''); });
  OCPP.on('error',        (e) => { toast(`❌ ${e.message}`); });

  // Server can push a RemoteStart (e.g. from a mobile app in the future)
  OCPP.on('remoteStart', () => startCharging());
  OCPP.on('remoteStop',  () => stopCharging());

  // ── EXPOSE TO HTML onclick ─────────────────────
  window.startCharging = startCharging;
  window.stopCharging  = () => stopCharging(false);
  window.showStatus    = showStatus;

  // ── INIT ───────────────────────────────────────
  render();

})();
