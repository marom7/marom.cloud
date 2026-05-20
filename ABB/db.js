// ═══════════════════════════════════════════════
//  talk2ev  –  db.js
//  SQLite via sql.js (pure JS, no native compile)
//  NOTE: sql.js is in-memory by default.
//  We persist to disk manually via fs.writeFileSync.
// ═══════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'talk2ev.db');

// sql.js is async to init, so we export a promise
// server.js awaits db.ready before starting
let SQL, db;

const ready = require('sql.js')().then(SqlJs => {
  SQL = SqlJs;

  // Load existing DB from disk, or create fresh
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
    console.log(`[db] Loaded from ${DB_PATH}`);
  } else {
    db = new SQL.Database();
    console.log(`[db] New database created`);
  }

  // Schema
  db.run(`
    CREATE TABLE IF NOT EXISTS charge_points (
      id        TEXT PRIMARY KEY,
      vendor    TEXT, model TEXT, serial TEXT, firmware TEXT,
      last_seen TEXT, status TEXT DEFAULT 'Unknown'
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      cp_id        TEXT    NOT NULL,
      id_tag       TEXT,
      connector_id INTEGER DEFAULT 1,
      meter_start  INTEGER DEFAULT 0,
      meter_stop   INTEGER,
      started_at   TEXT,
      stopped_at   TEXT,
      reason       TEXT,
      status       TEXT DEFAULT 'Active'
    );
    CREATE TABLE IF NOT EXISTS messages (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      cp_id     TEXT,
      direction TEXT,
      action    TEXT,
      payload   TEXT,
      ts        TEXT DEFAULT (datetime('now'))
    );
  `);

  persist();
  return db;
});

// ── Persist to disk ───────────────────────────
function persist() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Auto-persist every 30 seconds
setInterval(persist, 30_000);

// ── Helpers ───────────────────────────────────
function run(sql, params = {}) {
  db.run(sql, params);
  persist();
}

function get(sql, params = []) {
  const stmt   = db.prepare(sql);
  const result = stmt.getAsObject(params);
  stmt.free();
  return Object.keys(result).length ? result : null;
}

// ── Public API ────────────────────────────────
module.exports = {
  ready,

  upsertCP({ id, vendor, model, serial, firmware, last_seen, status }) {
    run(`INSERT INTO charge_points (id,vendor,model,serial,firmware,last_seen,status)
         VALUES ($id,$vendor,$model,$serial,$firmware,$last_seen,$status)
         ON CONFLICT(id) DO UPDATE SET
           vendor=excluded.vendor, model=excluded.model, serial=excluded.serial,
           firmware=excluded.firmware, last_seen=excluded.last_seen, status=excluded.status`,
      { $id:id, $vendor:vendor, $model:model, $serial:serial,
        $firmware:firmware, $last_seen:last_seen, $status:status });
  },

  setStatus({ id, status, last_seen }) {
    run(`UPDATE charge_points SET status=$status, last_seen=$last_seen WHERE id=$id`,
      { $id:id, $status:status, $last_seen:last_seen });
  },

  getCP(id) {
    return get(`SELECT * FROM charge_points WHERE id=?`, [id]);
  },

  startTx({ cp_id, id_tag, connector_id, meter_start, started_at }) {
    run(`INSERT INTO transactions (cp_id,id_tag,connector_id,meter_start,started_at,status)
         VALUES ($cp_id,$id_tag,$connector_id,$meter_start,$started_at,'Active')`,
      { $cp_id:cp_id, $id_tag:id_tag, $connector_id:connector_id,
        $meter_start:meter_start, $started_at:started_at });
    // get last inserted rowid
    const row = get(`SELECT last_insert_rowid() as id`);
    return { lastInsertRowid: row?.id };
  },

  stopTx({ id, meter_stop, stopped_at, reason }) {
    run(`UPDATE transactions SET meter_stop=$ms, stopped_at=$sa, reason=$r, status='Completed' WHERE id=$id`,
      { $id:id, $ms:meter_stop, $sa:stopped_at, $r:reason });
  },

  getActiveTx(cpId) {
    return get(`SELECT * FROM transactions WHERE cp_id=? AND status='Active' ORDER BY id DESC LIMIT 1`, [cpId]);
  },

  logMsg({ cp_id, direction, action, payload }) {
    // fire and forget – no persist on every message (too noisy)
    if (!db) return;
    db.run(
      `INSERT INTO messages (cp_id,direction,action,payload) VALUES ($c,$d,$a,$p)`,
      { $c:cp_id, $d:direction, $a:action, $p:payload }
    );
  },

  persist,
};
