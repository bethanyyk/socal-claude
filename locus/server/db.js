const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const dbDir = path.join(os.homedir(), '.locus');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'locus.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
    description TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_captures_session ON captures(session_id);
  CREATE INDEX IF NOT EXISTS idx_captures_timestamp ON captures(timestamp);
  CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
  CREATE INDEX IF NOT EXISTS idx_habit_tags_session ON habit_tags(session_id);
  CREATE INDEX IF NOT EXISTS idx_habit_tags_tag ON habit_tags(tag);
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
    const date = new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO sessions (id, date, started_at, avg_focus, peak_focus, duration_seconds, capture_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, date, updates.started_at || Date.now(), updates.avg_focus || null, updates.peak_focus || null, updates.duration_seconds || 0, updates.capture_count || 0);
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

  const startTime = captures[0].timestamp;
  const buckets = {};
  for (const c of captures) {
    const minute = Math.floor((c.timestamp - startTime) / 60000);
    if (!buckets[minute]) buckets[minute] = [];
    buckets[minute].push(c.focus_score);
  }
  return Object.entries(buckets).map(([minute, scores]) => ({
    minute: parseInt(minute),
    avg_focus: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
  })).sort((a, b) => a.minute - b.minute);
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

function computeExperimentCorrelation(tag) {
  const dailyAvgs = getDailyAverages();
  if (dailyAvgs.length < 2) return { r: null, n: dailyAvgs.length, sessions_with: 0, sessions_without: 0, avg_with: null, avg_without: null };

  const withTag = dailyAvgs.filter(d => d.tags.includes(tag));
  const withoutTag = dailyAvgs.filter(d => !d.tags.includes(tag));

  const n = dailyAvgs.length;
  const x = dailyAvgs.map(d => d.tags.includes(tag) ? 1 : 0);
  const y = dailyAvgs.map(d => d.avg_focus);

  const xMean = x.reduce((a, b) => a + b, 0) / n;
  const yMean = y.reduce((a, b) => a + b, 0) / n;

  const num = x.reduce((sum, xi, i) => sum + (xi - xMean) * (y[i] - yMean), 0);
  const den = Math.sqrt(
    x.reduce((s, xi) => s + (xi - xMean) ** 2, 0) *
    y.reduce((s, yi) => s + (yi - yMean) ** 2, 0)
  );

  const r = den === 0 ? null : num / den;
  return {
    r: r !== null ? Math.round(r * 1000) / 1000 : null,
    n,
    sessions_with: withTag.length,
    sessions_without: withoutTag.length,
    avg_with: withTag.length ? Math.round(withTag.reduce((a, d) => a + d.avg_focus, 0) / withTag.length) : null,
    avg_without: withoutTag.length ? Math.round(withoutTag.reduce((a, d) => a + d.avg_focus, 0) / withoutTag.length) : null,
  };
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
  const dailyAvgs = getDailyAverages();
  const results = [];
  for (let i = 2; i <= dailyAvgs.length; i++) {
    const slice = dailyAvgs.slice(0, i);
    const x = slice.map(d => d.tags.includes(tag) ? 1 : 0);
    const y = slice.map(d => d.avg_focus);
    const n = slice.length;
    const xMean = x.reduce((a, b) => a + b, 0) / n;
    const yMean = y.reduce((a, b) => a + b, 0) / n;
    const num = x.reduce((s, xi, idx) => s + (xi - xMean) * (y[idx] - yMean), 0);
    const den = Math.sqrt(
      x.reduce((s, xi) => s + (xi - xMean) ** 2, 0) *
      y.reduce((s, yi) => s + (yi - yMean) ** 2, 0)
    );
    const r = den === 0 ? null : Math.round((num / den) * 1000) / 1000;
    results.push({ day_index: i - 1, r, date: slice[slice.length - 1].date });
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
  computeExperimentCorrelation,
  getDailyAverages,
  getCorrelationHistory,
};
