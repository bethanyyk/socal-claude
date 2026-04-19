const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const {
  insertCapture,
  upsertSession,
  getSession,
  getRecentSessions,
  getFocusArc,
  getKeyMoments,
  setSessionTags,
  getHabitTags,
  computeExperimentCorrelation,
  getDailyAverages,
  getCorrelationHistory,
  db,
} = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function getCurrentSession() {
  return db.prepare('SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get();
}

function getExperimentsWithStats() {
  const exps = db.prepare('SELECT * FROM experiments ORDER BY created_at DESC').all();
  return exps.map(e => ({
    ...e,
    correlation: computeExperimentCorrelation(e.tag),
    history: getCorrelationHistory(e.tag),
  }));
}

wss.on('connection', (ws) => {
  const current = getCurrentSession();
  if (current) {
    ws.send(JSON.stringify({ type: 'session_start', session_id: current.id, session: current }));
  }
});

// POST /api/capture
app.post('/api/capture', (req, res) => {
  const { session_id, focus_score, posture_quality, engagement_signal, confidence, note, timestamp } = req.body;
  if (!session_id || focus_score === undefined) return res.status(400).json({ error: 'Missing required fields' });

  const ts = timestamp || Date.now();
  insertCapture({ session_id, timestamp: ts, focus_score, posture_quality, engagement_signal, confidence, note });

  // Update rolling session stats
  const allCaptures = db.prepare('SELECT focus_score FROM captures WHERE session_id = ?').all(session_id);
  const scores = allCaptures.map(c => c.focus_score);
  const avg_focus = scores.reduce((a, b) => a + b, 0) / scores.length;
  const peak_focus = Math.max(...scores);
  const session = getSession(session_id);
  const duration_seconds = session?.started_at ? Math.round((ts - session.started_at) / 1000) : 0;

  upsertSession(session_id, {
    avg_focus: Math.round(avg_focus * 10) / 10,
    peak_focus,
    capture_count: scores.length,
    duration_seconds,
  });

  const captureData = { session_id, timestamp: ts, focus_score, posture_quality, engagement_signal, confidence, note };
  broadcast({ type: 'capture', data: captureData });
  res.json({ ok: true });
});

// POST /api/session/start
app.post('/api/session/start', (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });
  upsertSession(session_id, { started_at: Date.now() });
  broadcast({ type: 'session_start', session_id });
  res.json({ ok: true, session_id });
});

// POST /api/session/end
app.post('/api/session/end', (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

  const session = getSession(session_id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const now = Date.now();
  const duration_seconds = session.started_at ? Math.round((now - session.started_at) / 1000) : 0;
  upsertSession(session_id, { ended_at: now, duration_seconds });
  broadcast({ type: 'session_end', session_id });
  res.json({ ok: true });
});

// GET /api/session/current
app.get('/api/session/current', (req, res) => {
  const session = getCurrentSession();
  if (!session) return res.json({ session: null });
  const tags = getHabitTags(session.id);
  res.json({ session: { ...session, tags } });
});

// GET /api/session/:id
app.get('/api/session/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  const tags = getHabitTags(session.id);
  res.json({ session: { ...session, tags } });
});

// GET /api/session/:id/arc
app.get('/api/session/:id/arc', (req, res) => {
  res.json({ arc: getFocusArc(req.params.id) });
});

// GET /api/session/:id/moments
app.get('/api/session/:id/moments', (req, res) => {
  res.json({ moments: getKeyMoments(req.params.id) });
});

// POST /api/session/:id/tags
app.post('/api/session/:id/tags', (req, res) => {
  const { tags } = req.body;
  if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' });
  setSessionTags(req.params.id, tags);
  const experiments = getExperimentsWithStats();
  broadcast({ type: 'experiments_updated', experiments });
  res.json({ ok: true, tags });
});

// GET /api/history
app.get('/api/history', (req, res) => {
  const sessions = getRecentSessions(50);
  const daily = getDailyAverages();
  const sessionsWithTags = sessions.map(s => ({ ...s, tags: getHabitTags(s.id) }));
  res.json({ sessions: sessionsWithTags, daily });
});

// GET /api/experiments
app.get('/api/experiments', (req, res) => {
  res.json({ experiments: getExperimentsWithStats() });
});

// POST /api/experiments
app.post('/api/experiments', (req, res) => {
  const { name, tag, description } = req.body;
  if (!name || !tag) return res.status(400).json({ error: 'name and tag required' });
  db.prepare('INSERT INTO experiments (name, tag, created_at, description) VALUES (?, ?, ?, ?)')
    .run(name, tag.toLowerCase().replace(/\s+/g, '_'), Date.now(), description || '');
  const experiments = getExperimentsWithStats();
  broadcast({ type: 'experiments_updated', experiments });
  res.json({ ok: true, experiments });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Locus server running on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
});
