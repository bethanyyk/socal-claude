#!/usr/bin/env node
'use strict';
// Direct-DB seed — fast, single transaction, ~30 sessions over 60 days.
// Run from: C:/socal-claude/locus/server
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
function ri(lo, hi) { return Math.floor(rand() * (hi - lo + 1)) + lo; }
function rc(arr) { return arr[Math.floor(rand() * arr.length)]; }
function gauss() { return Math.sqrt(-2 * Math.log(rand() + 1e-10)) * Math.cos(2 * Math.PI * rand()); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

const NOW = Date.now();
const DAY = 86400000;
function ts(dAgo, hour) {
  const d = new Date(NOW - dAgo * DAY);
  d.setHours(hour, ri(0, 45), 0, 0);
  return d.getTime();
}

// ─── Wipe ─────────────────────────────────────────────────────────────────────
db.exec(`
  DELETE FROM captures;
  DELETE FROM habit_tags;
  DELETE FROM experiment_absences;
  DELETE FROM session_metadata;
  DELETE FROM sessions;
  DELETE FROM experiments;
`);

// ─── Experiments ─────────────────────────────────────────────────────────────
const insExp = db.prepare('INSERT INTO experiments (name, tag, description, created_at, closed_at) VALUES (?,?,?,?,?)');
insExp.run('Morning exercise',   'morning_exercise',   'Did you exercise before this session?',  ts(62,8), null);
insExp.run('Late-night screens', 'late_night_screens', 'Did you use screens after 10pm?',        ts(62,8), null);
insExp.run('Morning meditation', 'meditation',         '10-min meditation before work',          ts(50,8), ts(20,8));

const [exExercise, exScreens, exMed] = db.prepare('SELECT * FROM experiments ORDER BY id').all();

// ─── Session data ─────────────────────────────────────────────────────────────
// [daysAgo, hour, ex(1/0/-1), sc(1/0/-1), med(1/0/-1), sleep, energy, caf, stress, noise, taskIdx, clarity]
const DEFS = [
  // Weeks 9-8 (~62-49 days ago) — exercise + screens tracked; no meditation yet
  [62, 9,  1, 0, -1,  4,4,1,1,0, 0,4],
  [61,10,  0, 1, -1,  3,3,2,1,1, 2,3],
  [60, 9,  1, 0, -1,  5,5,0,0,0, 0,5],
  [59, 8,  0, 1, -1,  2,2,2,2,2, 1,2],
  [58, 9,  1, 0, -1,  4,4,1,0,0, 0,4],
  [57, 9,  0, 1, -1,  3,3,1,1,1, 3,3],
  [56, 8,  1, 0, -1,  4,4,1,0,0, 0,4],
  [55, 9,  0, 0, -1,  3,3,1,1,1, 2,3],
  [54,10,  0, 1, -1,  2,2,2,2,2, 1,2],
  [53, 9,  1, 0, -1,  5,5,0,0,0, 0,5],
  [52, 8,  0, 1, -1,  3,3,1,1,1, 0,3],
  [51, 9,  1, 0, -1,  4,4,1,0,0, 0,4],
  [50,10,  0, 1, -1,  2,3,2,2,1, 3,2],

  // Weeks 7-4 (~49-22 days ago) — all 3 experiments tracked; meditation balanced
  [49, 9,  1, 0, 1,   5,5,0,0,0, 0,5],  // ex+med → high
  [48,10,  0, 1, 0,   2,2,2,2,2, 1,2],  // sc, no-med → low
  [47, 9,  1, 0, 0,   4,4,1,0,0, 0,4],  // ex, no-med → high
  [46, 8,  0, 1, 1,   2,2,1,2,1, 2,2],  // sc+med → low (med doesn't help)
  [45, 9,  0, 0, 1,   3,3,1,0,1, 0,3],  // baseline+med → moderate
  [44,10,  0, 0, 0,   3,3,1,1,0, 3,3],  // baseline → moderate
  [43, 9,  1, 0, 1,   5,4,0,0,0, 0,5],  // ex+med → high
  [42, 8,  0, 1, 0,   3,3,2,1,1, 1,3],  // sc → low
  [41, 9,  1, 0, 0,   4,5,1,0,0, 0,4],  // ex → high
  [40,10,  0, 0, 1,   3,3,1,0,0, 2,3],  // baseline+med → moderate
  [39, 9,  0, 1, 1,   2,2,2,2,2, 2,2],  // sc+med → low
  [38, 9,  1, 0, 1,   5,5,0,0,0, 0,5],  // ex+med → high
  [37, 8,  0, 1, 0,   2,2,2,2,2, 1,2],  // sc → low
  [36,10,  0, 0, 0,   3,3,1,1,1, 3,3],  // baseline → moderate
  [35, 9,  1, 0, 0,   4,4,1,0,0, 0,4],  // ex → high
  [34, 9,  0, 0, 1,   3,4,0,0,0, 0,3],  // baseline+med → moderate
  [33, 8,  1, 0, 1,   5,5,0,0,0, 0,5],  // ex+med → high
  [32,10,  0, 1, 0,   2,2,2,2,2, 2,2],  // sc → low
  [31, 9,  1, 0, 0,   4,4,1,1,0, 0,4],  // ex → high
  [30, 9,  0, 1, 1,   2,3,1,2,1, 1,2],  // sc+med → low
  [29, 9,  0, 0, 0,   3,3,1,0,1, 3,3],  // baseline → moderate
  [28, 8,  1, 0, 1,   5,5,0,0,0, 0,5],  // ex+med → high (last med session)

  // Weeks 3-1 (~27-2 days ago) — exercise + screens only
  [27, 9,  0, 1, -1,  2,2,2,2,2, 2,2],
  [26,10,  1, 0, -1,  5,5,0,0,0, 0,5],
  [25, 9,  0, 1, -1,  3,3,1,1,1, 1,3],
  [24, 8,  1, 0, -1,  4,4,1,0,0, 0,4],
  [23, 9,  0, 1, -1,  2,2,2,2,2, 3,2],
  [22,10,  1, 0, -1,  5,4,0,0,0, 0,5],
  [21, 9,  0, 0, -1,  3,3,1,1,1, 2,3],
  [20, 8,  1, 0, -1,  4,5,1,0,0, 0,4],
  [19, 9,  0, 1, -1,  2,2,2,2,2, 1,2],
  [18,10,  1, 0, -1,  5,5,0,0,0, 0,5],
  [17, 9,  0, 1, -1,  3,3,1,1,1, 3,3],
  [16, 8,  1, 0, -1,  4,4,1,0,0, 0,4],
  [15, 9,  0, 1, -1,  2,3,2,2,1, 2,2],
  [14,10,  1, 0, -1,  5,5,0,0,0, 0,5],
  [13, 9,  0, 1, -1,  3,3,1,1,2, 1,3],
  [12, 8,  1, 0, -1,  4,4,1,0,0, 0,4],
  [11, 9,  0, 1, -1,  2,2,2,2,2, 2,2],
  [10,10,  1, 0, -1,  5,5,0,0,0, 0,5],
  [ 9, 9,  0, 1, -1,  3,3,1,1,1, 3,3],
  [ 8, 8,  1, 0, -1,  4,4,1,0,0, 0,4],
  [ 7, 9,  0, 1, -1,  2,2,2,2,2, 1,2],
  [ 6,10,  1, 0, -1,  5,5,0,0,0, 0,5],
  [ 5, 9,  0, 0, -1,  3,3,1,1,1, 2,3],
  [ 4, 8,  1, 0, -1,  4,4,1,0,0, 0,4],
  [ 3, 9,  0, 1, -1,  2,3,2,2,1, 1,2],
  [ 2,10,  1, 0, -1,  5,5,0,0,0, 0,5],
  [ 1, 9,  0, 1, -1,  3,3,1,1,1, 3,3],
];

const TASK_TYPES = ['deep_work', 'meetings', 'admin', 'creative'];
const NOTES = ['focused on screen','leaning forward','steady posture','relaxed but attentive',
  'slight fidgeting','neutral expression','eyes on screen','slightly distracted'];

const insSession = db.prepare(`INSERT INTO sessions (id,date,started_at,ended_at,avg_focus,peak_focus,capture_count,duration_seconds) VALUES (?,?,?,?,?,?,?,?)`);
const insCapture = db.prepare(`INSERT INTO captures (session_id,timestamp,focus_score,posture_quality,engagement_signal,confidence,note) VALUES (?,?,?,?,?,?,?)`);
const insTag     = db.prepare('INSERT INTO habit_tags (session_id,tag) VALUES (?,?)');
const insAbs     = db.prepare('INSERT INTO experiment_absences (session_id,tag) VALUES (?,?)');
const insMeta    = db.prepare(`INSERT OR REPLACE INTO session_metadata (session_id,sleep_quality,energy_level,caffeine,stress,noise,task_type,task_clarity) VALUES (?,?,?,?,?,?,?,?)`);

function focus(ex, sc, med, sleep, energy, caf, stress, noise) {
  let f = 60;
  if (ex  === 1) f += 14;
  if (sc  === 1) f -= 12;
  if (med === 1) f += gauss() * 2;
  f += (sleep  - 3) * 3.5 + (energy - 3) * 2.5 - caf * 1.5 - stress * 3 - noise * 2 + gauss() * 5;
  return clamp(Math.round(f), 20, 98);
}

function signals(s) {
  if (s >= 80) return ['upright','deep_focus',  0.87];
  if (s >= 65) return ['upright','active',       0.77];
  if (s >= 50) return ['neutral','active',       0.67];
  if (s >= 35) return ['neutral','distracted',   0.57];
  return              ['slumped','distracted',   0.47];
}

db.transaction(() => {
  DEFS.forEach((def, idx) => {
    const [dAgo, hour, ex, sc, med, sleep, energy, caf, stress, noise, taskIdx, clarity] = def;
    const base = focus(ex, sc, med, sleep, energy, caf, stress, noise);
    const sid  = `s${String(idx + 1).padStart(3, '0')}`;
    const durMin = ri(45, 90);
    const startedAt = ts(dAgo, hour);
    const endedAt   = startedAt + durMin * 60000;
    const dateStr   = new Date(startedAt).toISOString().slice(0, 10);

    // 8 captures per session — fast
    const capScores = [];
    let cur = base + gauss() * 4;
    for (let i = 0; i < 8; i++) {
      cur += (base - cur) * 0.1 + gauss() * 4;
      cur = clamp(Math.round(cur), 10, 100);
      const capTs = startedAt + (i / 8) * durMin * 60000;
      const [posture, engagement, conf] = signals(cur);
      insCapture.run(sid, Math.round(capTs), cur, posture, engagement, Math.round((conf + rand() * 0.1) * 100) / 100, rc(NOTES));
      capScores.push(cur);
    }
    const avgFocus  = Math.round(capScores.reduce((a, b) => a + b, 0) / capScores.length * 10) / 10;
    const peakFocus = Math.max(...capScores);

    insSession.run(sid, dateStr, startedAt, endedAt, avgFocus, peakFocus, capScores.length, durMin * 60);

    // Experiment tags
    if (startedAt >= exExercise.created_at) {
      if (ex === 1) insTag.run(sid, 'morning_exercise');
      else if (ex === 0) insAbs.run(sid, 'morning_exercise');
    }
    if (startedAt >= exScreens.created_at) {
      if (sc === 1) insTag.run(sid, 'late_night_screens');
      else if (sc === 0) insAbs.run(sid, 'late_night_screens');
    }
    const medActive = startedAt >= exMed.created_at && startedAt <= exMed.closed_at;
    if (medActive) {
      if (med === 1) insTag.run(sid, 'meditation');
      else if (med === 0) insAbs.run(sid, 'meditation');
    }

    insMeta.run(sid, sleep, energy, caf, stress, noise, TASK_TYPES[taskIdx], clarity);
  });
})();

const sc = db.prepare('SELECT COUNT(*) as n FROM sessions').get().n;
const cc = db.prepare('SELECT COUNT(*) as n FROM captures').get().n;
console.log(`Done: ${sc} sessions, ${cc} captures`);

// Quick correlation check
const { computeExperimentCorrelation } = require('./db');
for (const tag of ['morning_exercise','late_night_screens','meditation']) {
  const c = computeExperimentCorrelation(tag);
  console.log(`  [${tag}] r=${c.r !== null ? c.r.toFixed(3) : 'null'} n=${c.n} avg_with=${c.avg_with} avg_without=${c.avg_without}`);
}
