#!/usr/bin/env node
'use strict';
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const DB_PATH = path.join(os.homedir(), '.locus', 'locus.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── PRNG ─────────────────────────────────────────────────────────────────────
let _s = 20240101;
function rand() {
  _s += 0x6d2b79f5;
  let t = _s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri  = (lo, hi) => Math.floor(rand() * (hi - lo + 1)) + lo;
const rc  = arr => arr[Math.floor(rand() * arr.length)];
const g   = () => Math.sqrt(-2 * Math.log(rand() + 1e-10)) * Math.cos(2 * Math.PI * rand());
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const NOW = Date.now();
const DAY = 86400000;
function msts(dAgo, hour) {
  const d = new Date(NOW - dAgo * DAY);
  d.setHours(hour, ri(0, 55), 0, 0);
  return d.getTime();
}

// ─── Schema migration ─────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS captures (
    id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, timestamp INTEGER NOT NULL,
    focus_score INTEGER NOT NULL, posture_quality TEXT, engagement_signal TEXT,
    confidence REAL, note TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, date TEXT NOT NULL, started_at INTEGER, ended_at INTEGER,
    avg_focus REAL, peak_focus INTEGER, duration_seconds INTEGER, capture_count INTEGER
  );
  CREATE TABLE IF NOT EXISTS habit_tags (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, tag TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS experiments (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, tag TEXT NOT NULL,
    created_at INTEGER, description TEXT, closed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS experiment_absences (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, tag TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS session_metadata (
    session_id TEXT PRIMARY KEY, sleep_quality INTEGER, energy_level INTEGER,
    caffeine INTEGER, stress INTEGER, noise INTEGER, task_type TEXT, task_clarity INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_cap_sess ON captures(session_id);
  CREATE INDEX IF NOT EXISTS idx_ht_sess  ON habit_tags(session_id);
  CREATE INDEX IF NOT EXISTS idx_ht_tag   ON habit_tags(tag);
  CREATE INDEX IF NOT EXISTS idx_ea_sess  ON experiment_absences(session_id);
  CREATE INDEX IF NOT EXISTS idx_ea_tag   ON experiment_absences(tag);
`);

// ─── Wipe ─────────────────────────────────────────────────────────────────────
db.exec(`
  DELETE FROM captures; DELETE FROM habit_tags; DELETE FROM experiment_absences;
  DELETE FROM session_metadata; DELETE FROM sessions; DELETE FROM experiments;
`);

// ─── Experiments ─────────────────────────────────────────────────────────────
const insExp = db.prepare('INSERT INTO experiments (name,tag,description,created_at,closed_at) VALUES (?,?,?,?,?)');
insExp.run('Morning exercise',   'morning_exercise',   'Did you exercise before this session?', msts(90,8), null);
insExp.run('Late-night screens', 'late_night_screens', 'Did you use screens after 10pm?',       msts(90,8), null);
insExp.run('Morning meditation', 'meditation',         '10-min meditation before work',         msts(70,8), msts(20,8));

const [exEx, exSc, exMed] = db.prepare('SELECT * FROM experiments ORDER BY id').all();

// ─── Focus model ──────────────────────────────────────────────────────────────
// exercise → strong +effect, screens → strong -effect, meditation → near-null
function baseFocus(ex, sc, med, sleep, energy, caf, stress, noise) {
  let f = 62;
  if (ex  === 1) f += 15;
  if (sc  === 1) f -= 13;
  if (med === 1) f += g() * 2.5;   // noise only — null effect
  f += (sleep - 3) * 3 + (energy - 3) * 2.5 - caf * 1.5 - stress * 3 - noise * 2 + g() * 5;
  return clamp(Math.round(f), 18, 99);
}

// ─── Generate session list ────────────────────────────────────────────────────
// Strategy: 1 session/day for 90 days, varying conditions deterministically
// ex alternates 5 days on / 2 days off; sc alternates opposite; med random while active
const sessions = [];
for (let dAgo = 90; dAgo >= 1; dAgo--) {
  // Skip ~1/7 days (weekends feel lighter)
  if (rand() < 0.12) continue;

  const hour = ri(8, 11);
  const dayOfPattern = (90 - dAgo) % 7;

  // exercise: on Mon-Fri ~60%, off weekends
  const ex = dayOfPattern < 5 && rand() < 0.55 ? 1 : 0;
  // screens: higher on days without exercise, occasional on exercise days
  const sc = ex === 0 ? (rand() < 0.6 ? 1 : 0) : (rand() < 0.15 ? 1 : 0);

  // meditation only tracked while experiment is active (days 20-70)
  let med = -1;
  if (dAgo <= 70 && dAgo >= 20) {
    // balanced: ~50% present, independent of exercise
    med = rand() < 0.5 ? 1 : 0;
  }

  // Metadata — vary realistically
  const sleep  = ex === 1 ? ri(3, 5) : ri(2, 4);   // people who exercise tend to sleep better
  const energy = clamp(sleep + ri(-1, 1), 1, 5);
  const caf    = ri(0, 2);
  const stress = ri(0, 2);
  const noise  = ri(0, 2);
  const taskTypes = ['deep_work', 'meetings', 'admin', 'creative'];
  const task_type = rc(taskTypes);
  const task_clarity = ri(2, 5);

  sessions.push({ dAgo, hour, ex, sc, med, sleep, energy, caf, stress, noise, task_type, task_clarity });
}

// ─── Prepared statements ──────────────────────────────────────────────────────
const insSess = db.prepare(`INSERT INTO sessions (id,date,started_at,ended_at,avg_focus,peak_focus,capture_count,duration_seconds) VALUES (?,?,?,?,?,?,?,?)`);
const insCap  = db.prepare(`INSERT INTO captures (session_id,timestamp,focus_score,posture_quality,engagement_signal,confidence,note) VALUES (?,?,?,?,?,?,?)`);
const insTag  = db.prepare('INSERT INTO habit_tags (session_id,tag) VALUES (?,?)');
const insAbs  = db.prepare('INSERT INTO experiment_absences (session_id,tag) VALUES (?,?)');
const insMeta = db.prepare(`INSERT OR REPLACE INTO session_metadata (session_id,sleep_quality,energy_level,caffeine,stress,noise,task_type,task_clarity) VALUES (?,?,?,?,?,?,?,?)`);

const NOTES = ['focused on screen','leaning forward','steady posture','relaxed but attentive',
  'slight fidgeting','neutral expression','eyes on screen','slightly distracted',
  'deep in thought','looks engaged','glancing away','upright and alert'];

function signals(s) {
  if (s >= 80) return ['upright',  'deep_focus',  0.88 + rand()*0.09];
  if (s >= 65) return ['upright',  'active',      0.76 + rand()*0.10];
  if (s >= 50) return ['neutral',  'active',      0.65 + rand()*0.10];
  if (s >= 35) return ['neutral',  'distracted',  0.55 + rand()*0.10];
  return              ['slumped',  'distracted',  0.44 + rand()*0.12];
}

// ─── Insert all data in one transaction ───────────────────────────────────────
db.transaction(() => {
  sessions.forEach((s, idx) => {
    const { dAgo, hour, ex, sc, med, sleep, energy, caf, stress, noise, task_type, task_clarity } = s;
    const base = baseFocus(ex, sc, med, sleep, energy, caf, stress, noise);
    const sid  = `s${String(idx + 1).padStart(3, '0')}`;
    const durMin  = ri(40, 100);
    const startedAt = msts(dAgo, hour);
    const endedAt   = startedAt + durMin * 60000;
    const dateStr   = new Date(startedAt).toISOString().slice(0, 10);

    // 12 captures per session — realistic arc with mean reversion
    const capScores = [];
    let cur = base + g() * 5;
    for (let i = 0; i < 12; i++) {
      cur += (base - cur) * 0.12 + g() * 4;
      cur = clamp(Math.round(cur), 10, 100);
      const capTs = Math.round(startedAt + (i / 12) * durMin * 60000);
      const [posture, engagement, conf] = signals(cur);
      insCap.run(sid, capTs, cur, posture, engagement, Math.round(conf * 100) / 100, rc(NOTES));
      capScores.push(cur);
    }
    const avgFocus  = Math.round(capScores.reduce((a, b) => a + b, 0) / capScores.length * 10) / 10;
    const peakFocus = Math.max(...capScores);

    insSess.run(sid, dateStr, startedAt, endedAt, avgFocus, peakFocus, capScores.length, durMin * 60);

    // Experiment conditions
    if (startedAt >= exEx.created_at) {
      if (ex === 1) insTag.run(sid, 'morning_exercise');
      else          insAbs.run(sid, 'morning_exercise');
    }
    if (startedAt >= exSc.created_at) {
      if (sc === 1) insTag.run(sid, 'late_night_screens');
      else          insAbs.run(sid, 'late_night_screens');
    }
    if (dAgo <= 70 && dAgo >= 20) {
      if (med === 1) insTag.run(sid, 'meditation');
      else           insAbs.run(sid, 'meditation');
    }

    insMeta.run(sid, sleep, energy, caf, stress, noise, task_type, task_clarity);
  });
})();

const sc2 = db.prepare('SELECT COUNT(*) as n FROM sessions').get().n;
const cc2 = db.prepare('SELECT COUNT(*) as n FROM captures').get().n;
console.log(`Seeded ${sc2} sessions, ${cc2} captures`);

const { computeExperimentCorrelation } = require('./db');
for (const tag of ['morning_exercise', 'late_night_screens', 'meditation']) {
  const c = computeExperimentCorrelation(tag);
  console.log(`  [${tag}] r=${c.r !== null ? c.r.toFixed(3) : 'null'} n=${c.n} avg_with=${c.avg_with} avg_without=${c.avg_without}`);
}
