const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const dbDir = path.join(os.homedir(), '.locus');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'locus.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migrations
try { db.exec('ALTER TABLE experiments ADD COLUMN closed_at INTEGER'); } catch (_) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS captures (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    focus_score INTEGER NOT NULL,
    posture_quality TEXT,
    engagement_signal TEXT,
    confidence REAL,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    started_at INTEGER,
    ended_at INTEGER,
    avg_focus REAL,
    peak_focus INTEGER,
    duration_seconds INTEGER,
    capture_count INTEGER
  );

  CREATE TABLE IF NOT EXISTS habit_tags (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    tag TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS experiments (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_at INTEGER,
    description TEXT,
    closed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS experiment_absences (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    tag TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_captures_session ON captures(session_id);
  CREATE INDEX IF NOT EXISTS idx_captures_timestamp ON captures(timestamp);
  CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
  CREATE INDEX IF NOT EXISTS idx_habit_tags_session ON habit_tags(session_id);
  CREATE INDEX IF NOT EXISTS idx_habit_tags_tag ON habit_tags(tag);
  CREATE INDEX IF NOT EXISTS idx_exp_absences_session ON experiment_absences(session_id);
  CREATE INDEX IF NOT EXISTS idx_exp_absences_tag ON experiment_absences(tag);

  CREATE TABLE IF NOT EXISTS session_metadata (
    session_id TEXT PRIMARY KEY,
    sleep_quality INTEGER,
    energy_level INTEGER,
    caffeine INTEGER,
    stress INTEGER,
    noise INTEGER,
    task_type TEXT,
    task_clarity INTEGER
  );
`);

function insertCapture(data) {
  const stmt = db.prepare(`
    INSERT INTO captures (session_id, timestamp, focus_score, posture_quality, engagement_signal, confidence, note)
    VALUES (@session_id, @timestamp, @focus_score, @posture_quality, @engagement_signal, @confidence, @note)
  `);
  return stmt.run(data);
}

function upsertSession(sessionId, updates) {
  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!existing) {
    const startedAt = updates.started_at || Date.now();
    const date = new Date(startedAt).toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO sessions (id, date, started_at, avg_focus, peak_focus, duration_seconds, capture_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, date, startedAt, updates.avg_focus || null, updates.peak_focus || null, updates.duration_seconds || 0, updates.capture_count || 0);
  } else {
    const fields = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE sessions SET ${fields} WHERE id = @id`).run({ ...updates, id: sessionId });
  }
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
}

function getSession(sessionId) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
}

function getRecentSessions(limit = 20) {
  return db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?').all(limit);
}

function getFocusArc(sessionId) {
  const session = getSession(sessionId);
  if (!session) return [];
  const captures = db.prepare(
    'SELECT timestamp, focus_score FROM captures WHERE session_id = ? ORDER BY timestamp'
  ).all(sessionId);
  if (!captures.length) return [];
  const startTime = session.started_at || captures[0].timestamp;
  return captures.map(c => ({
    elapsed: Math.round((c.timestamp - startTime) / 1000),
    avg_focus: c.focus_score,
  }));
}

function getKeyMoments(sessionId) {
  const captures = db.prepare(
    'SELECT timestamp, focus_score, engagement_signal, note FROM captures WHERE session_id = ? ORDER BY timestamp'
  ).all(sessionId);
  if (!captures.length) return [];

  const moments = [];
  const session = getSession(sessionId);
  const startTime = session?.started_at || captures[0].timestamp;

  // Slow start: focus < 60 for first 3+ minutes
  const firstThreeMin = captures.filter(c => c.timestamp - startTime < 3 * 60000);
  if (firstThreeMin.length >= 2) {
    const avgFirst3 = firstThreeMin.reduce((a, c) => a + c.focus_score, 0) / firstThreeMin.length;
    if (avgFirst3 < 60) {
      moments.push({
        type: 'slow_start',
        timestamp: captures[0].timestamp,
        title: 'Slow start',
        description: `Focus averaged ${Math.round(avgFirst3)} in the first ${firstThreeMin.length} captures`,
        sentiment: 'negative',
      });
    }
  }

  // Deep focus streak: consecutive minutes above 80
  let maxStreak = 0;
  let currentStreak = 0;
  let streakStart = null;
  let bestStreakStart = null;
  for (const c of captures) {
    if (c.focus_score >= 80) {
      if (currentStreak === 0) streakStart = c.timestamp;
      currentStreak++;
      if (currentStreak > maxStreak) {
        maxStreak = currentStreak;
        bestStreakStart = streakStart;
      }
    } else {
      currentStreak = 0;
    }
  }
  if (maxStreak >= 3) {
    moments.push({
      type: 'deep_focus_streak',
      timestamp: bestStreakStart,
      title: `Deep focus streak (${maxStreak} captures)`,
      description: `Maintained focus above 80 for ${maxStreak} consecutive readings`,
      sentiment: 'positive',
    });
  }

  // Distraction events: score drops > 20pts
  for (let i = 1; i < captures.length; i++) {
    const drop = captures[i - 1].focus_score - captures[i].focus_score;
    if (drop > 20) {
      // Look for recovery: score rises > 15pts after drop
      let recoveryTime = null;
      for (let j = i + 1; j < captures.length; j++) {
        if (captures[j].focus_score - captures[i].focus_score > 15) {
          recoveryTime = Math.round((captures[j].timestamp - captures[i].timestamp) / 60000);
          break;
        }
      }
      moments.push({
        type: 'distraction',
        timestamp: captures[i].timestamp,
        title: 'Distraction event',
        description: recoveryTime !== null
          ? `Focus dropped ${drop}pts — recovered in ${recoveryTime} min`
          : `Focus dropped ${drop}pts`,
        sentiment: 'negative',
        recovery_minutes: recoveryTime,
      });
    }
  }

  // Recovery events: score rises > 15pts after a drop
  for (let i = 1; i < captures.length; i++) {
    if (captures[i].focus_score - captures[i - 1].focus_score > 15) {
      // Only flag if there was a distraction before
      const prevLow = captures[i - 1].focus_score < 60;
      if (prevLow) {
        moments.push({
          type: 'recovery',
          timestamp: captures[i].timestamp,
          title: 'Recovery',
          description: `Focus rebounded from ${captures[i - 1].focus_score} to ${captures[i].focus_score}`,
          sentiment: 'positive',
        });
      }
    }
  }

  // Strong finish: last 5 captures avg higher than session avg
  if (captures.length >= 5) {
    const last5 = captures.slice(-5);
    const last5Avg = last5.reduce((a, c) => a + c.focus_score, 0) / last5.length;
    const sessionAvg = captures.reduce((a, c) => a + c.focus_score, 0) / captures.length;
    if (last5Avg > sessionAvg + 5) {
      moments.push({
        type: 'strong_finish',
        timestamp: last5[0].timestamp,
        title: 'Strong finish',
        description: `Last 5 captures averaged ${Math.round(last5Avg)} vs session avg ${Math.round(sessionAvg)}`,
        sentiment: 'positive',
      });
    }
  }

  return moments.sort((a, b) => a.timestamp - b.timestamp);
}

function addHabitTag(sessionId, tag) {
  const exists = db.prepare('SELECT id FROM habit_tags WHERE session_id = ? AND tag = ?').get(sessionId, tag);
  if (!exists) {
    db.prepare('INSERT INTO habit_tags (session_id, tag) VALUES (?, ?)').run(sessionId, tag);
  }
}

function getHabitTags(sessionId) {
  return db.prepare('SELECT tag FROM habit_tags WHERE session_id = ?').all(sessionId).map(r => r.tag);
}

function setSessionTags(sessionId, tags) {
  db.prepare('DELETE FROM habit_tags WHERE session_id = ?').run(sessionId);
  for (const tag of tags) addHabitTag(sessionId, tag);
}

function setExperimentAbsences(sessionId, tags) {
  db.prepare('DELETE FROM experiment_absences WHERE session_id = ?').run(sessionId);
  for (const tag of tags) {
    db.prepare('INSERT INTO experiment_absences (session_id, tag) VALUES (?, ?)').run(sessionId, tag);
  }
}

function setSessionMetadata(sessionId, meta) {
  const { sleep_quality, energy_level, caffeine, stress, noise, task_type, task_clarity } = meta;
  const exists = db.prepare('SELECT session_id FROM session_metadata WHERE session_id = ?').get(sessionId);
  if (exists) {
    db.prepare(`UPDATE session_metadata SET sleep_quality=?,energy_level=?,caffeine=?,stress=?,noise=?,task_type=?,task_clarity=? WHERE session_id=?`)
      .run(sleep_quality ?? null, energy_level ?? null, caffeine ?? null, stress ?? null, noise ?? null, task_type ?? null, task_clarity ?? null, sessionId);
  } else {
    db.prepare(`INSERT INTO session_metadata (session_id,sleep_quality,energy_level,caffeine,stress,noise,task_type,task_clarity) VALUES (?,?,?,?,?,?,?,?)`)
      .run(sessionId, sleep_quality ?? null, energy_level ?? null, caffeine ?? null, stress ?? null, noise ?? null, task_type ?? null, task_clarity ?? null);
  }
}

function getSessionMetadata(sessionId) {
  return db.prepare('SELECT * FROM session_metadata WHERE session_id = ?').get(sessionId) || null;
}

// --- OLS helpers for confounder-adjusted partial correlation ---
function _dot(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }

function _matMul(A, B) {
  return A.map(row => B[0].map((_, j) => row.reduce((s, _, k) => s + row[k] * B[k][j], 0)));
}

function _solveLinear(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-10) return null;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = M[row][col] / pivot;
      for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function _olsResiduals(C, y) {
  const n = y.length;
  const mean = y.reduce((s, v) => s + v, 0) / n;
  if (!C.length || !C[0].length) return y.map(v => v - mean);
  const X = C.map(row => [1, ...row]);
  const k = X[0].length;
  const Xt = Array.from({ length: k }, (_, j) => X.map(row => row[j]));
  const XtX = _matMul(Xt, X);
  const Xty = Xt.map(row => _dot(row, y));
  const beta = _solveLinear(XtX, Xty);
  if (!beta) return y.map(v => v - mean);
  return y.map((v, i) => v - _dot(X[i], beta));
}

function _pearson(x, y) {
  const n = x.length;
  const xm = x.reduce((s, v) => s + v, 0) / n;
  const ym = y.reduce((s, v) => s + v, 0) / n;
  const num = x.reduce((s, v, i) => s + (v - xm) * (y[i] - ym), 0);
  const den = Math.sqrt(x.reduce((s, v) => s + (v - xm) ** 2, 0) * y.reduce((s, v) => s + (v - ym) ** 2, 0));
  return den === 0 ? null : Math.round((num / den) * 1000) / 1000;
}

function computeExperimentCorrelation(tag) {
  // Count ALL explicitly tagged sessions for the display numbers
  const sessions_with = db.prepare(
    'SELECT COUNT(*) AS n FROM habit_tags WHERE tag = ?'
  ).get(tag).n;
  const sessions_without = db.prepare(
    'SELECT COUNT(*) AS n FROM experiment_absences WHERE tag = ?'
  ).get(tag).n;

  // Only use sessions with focus data for the actual correlation math
  const present = db.prepare(`
    SELECT s.avg_focus FROM sessions s
    JOIN habit_tags ht ON s.id = ht.session_id
    WHERE ht.tag = ? AND s.avg_focus IS NOT NULL
  `).all(tag);
  const absent = db.prepare(`
    SELECT s.avg_focus FROM sessions s
    JOIN experiment_absences ea ON s.id = ea.session_id
    WHERE ea.tag = ? AND s.avg_focus IS NOT NULL
  `).all(tag);

  const avg_with = present.length
    ? Math.round(present.reduce((a, s) => a + s.avg_focus, 0) / present.length)
    : null;
  const avg_without = absent.length
    ? Math.round(absent.reduce((a, s) => a + s.avg_focus, 0) / absent.length)
    : null;

  if (present.length === 0 || absent.length === 0) {
    return { r: null, n: sessions_with + sessions_without, sessions_with, sessions_without, avg_with, avg_without };
  }

  const x = [...present.map(() => 1), ...absent.map(() => 0)];
  const y = [...present.map(s => s.avg_focus), ...absent.map(s => s.avg_focus)];
  const n = x.length;
  const xMean = x.reduce((a, b) => a + b, 0) / n;
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const num = x.reduce((sum, xi, i) => sum + (xi - xMean) * (y[i] - yMean), 0);
  const den = Math.sqrt(
    x.reduce((s, xi) => s + (xi - xMean) ** 2, 0) *
    y.reduce((s, yi) => s + (yi - yMean) ** 2, 0)
  );
  const r = den === 0 ? null : Math.round((num / den) * 1000) / 1000;

  // Confounder-adjusted partial correlation
  const NUMERIC_CONF = ['sleep_quality', 'energy_level', 'caffeine', 'stress', 'noise', 'task_clarity'];
  const MIN_N = 8;

  const presentMeta = db.prepare(`
    SELECT s.avg_focus, m.sleep_quality, m.energy_level, m.caffeine, m.stress, m.noise, m.task_clarity
    FROM sessions s
    JOIN habit_tags ht ON s.id = ht.session_id
    LEFT JOIN session_metadata m ON s.id = m.session_id
    WHERE ht.tag = ? AND s.avg_focus IS NOT NULL
  `).all(tag).map(s => ({ ...s, cond: 1 }));

  const absentMeta = db.prepare(`
    SELECT s.avg_focus, m.sleep_quality, m.energy_level, m.caffeine, m.stress, m.noise, m.task_clarity
    FROM sessions s
    JOIN experiment_absences ea ON s.id = ea.session_id
    LEFT JOIN session_metadata m ON s.id = m.session_id
    WHERE ea.tag = ? AND s.avg_focus IS NOT NULL
  `).all(tag).map(s => ({ ...s, cond: 0 }));

  const allMeta = [...presentMeta, ...absentMeta];

  const confoundersUsed = NUMERIC_CONF.filter(c => {
    const filled = allMeta.filter(s => s[c] !== null && s[c] !== undefined).length;
    return filled >= MIN_N && filled / allMeta.length >= 0.5;
  });

  let r_adjusted = null, n_adjusted = null;
  if (confoundersUsed.length >= 1) {
    const complete = allMeta.filter(s => confoundersUsed.every(c => s[c] !== null && s[c] !== undefined));
    if (complete.length >= MIN_N) {
      const yAdj = complete.map(s => s.avg_focus);
      const xAdj = complete.map(s => s.cond);
      const C = complete.map(s => confoundersUsed.map(c => s[c]));
      const y_res = _olsResiduals(C, yAdj);
      const x_res = _olsResiduals(C, xAdj);
      r_adjusted = _pearson(x_res, y_res);
      n_adjusted = complete.length;
    }
  }

  return { r, n: sessions_with + sessions_without, sessions_with, sessions_without, avg_with, avg_without, r_adjusted, n_adjusted, confounders_used: confoundersUsed };
}

function getDailyAverages() {
  const sessions = db.prepare('SELECT id, date, avg_focus FROM sessions WHERE avg_focus IS NOT NULL ORDER BY date').all();
  const byDate = {};
  for (const s of sessions) {
    if (!byDate[s.date]) byDate[s.date] = { date: s.date, scores: [], tags: new Set() };
    byDate[s.date].scores.push(s.avg_focus);
    const tags = getHabitTags(s.id);
    tags.forEach(t => byDate[s.date].tags.add(t));
  }
  return Object.values(byDate).map(d => ({
    date: d.date,
    avg_focus: Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length),
    tags: Array.from(d.tags),
  })).sort((a, b) => a.date.localeCompare(b.date));
}

function getCorrelationHistory(tag) {
  const tracked = db.prepare(`
    SELECT s.avg_focus, s.started_at, 1 AS present
    FROM sessions s JOIN habit_tags ht ON s.id = ht.session_id
    WHERE ht.tag = ? AND s.avg_focus IS NOT NULL
    UNION ALL
    SELECT s.avg_focus, s.started_at, 0 AS present
    FROM sessions s JOIN experiment_absences ea ON s.id = ea.session_id
    WHERE ea.tag = ? AND s.avg_focus IS NOT NULL
    ORDER BY started_at
  `).all(tag, tag);

  const results = [];
  for (let i = 2; i <= tracked.length; i++) {
    const slice = tracked.slice(0, i);
    const x = slice.map(s => s.present);
    const y = slice.map(s => s.avg_focus);
    const n = slice.length;
    const xMean = x.reduce((a, b) => a + b, 0) / n;
    const yMean = y.reduce((a, b) => a + b, 0) / n;
    const num = x.reduce((s, xi, idx) => s + (xi - xMean) * (y[idx] - yMean), 0);
    const den = Math.sqrt(
      x.reduce((s, xi) => s + (xi - xMean) ** 2, 0) *
      y.reduce((s, yi) => s + (yi - yMean) ** 2, 0)
    );
    const r = den === 0 ? null : Math.round((num / den) * 1000) / 1000;
    results.push({ session_index: i - 1, r });
  }
  return results;
}

module.exports = {
  db,
  insertCapture,
  upsertSession,
  getSession,
  getRecentSessions,
  getFocusArc,
  getKeyMoments,
  addHabitTag,
  getHabitTags,
  setSessionTags,
  setExperimentAbsences,
  setSessionMetadata,
  getSessionMetadata,
  computeExperimentCorrelation,
  getDailyAverages,
  getCorrelationHistory,
};
