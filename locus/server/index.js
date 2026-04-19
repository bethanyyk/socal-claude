const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const {
  insertCapture,
  upsertSession,
  getSession,
  getRecentSessions,
  getFocusArc,
  getKeyMoments,
  setSessionTags,
  setExperimentAbsences,
  getHabitTags,
  computeExperimentCorrelation,
  getDailyAverages,
  getCorrelationHistory,
  db,
} = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

let anthropic;
try {
  anthropic = new Anthropic();
} catch (e) {
  console.warn('Anthropic client not initialized — set ANTHROPIC_API_KEY for browser-based tracking');
}

const FOCUS_SYSTEM_PROMPT = `You are an attention and focus analyzer. You receive a webcam image of someone \
working at their computer. Analyze their posture, facial expression, body language, \
and any visible behavioral signals to estimate their current focus level.

Respond ONLY with a valid JSON object in this exact format, nothing else:
{
  "focus_score": <integer 0-100>,
  "posture_quality": <"upright"|"neutral"|"slumped">,
  "engagement_signal": <"deep_focus"|"active"|"distracted"|"away">,
  "confidence": <float 0.0-1.0>,
  "note": <one short phrase describing what you observed, max 8 words>
}

Scoring guide:
- 85-100: Upright, leaning forward slightly, still, eyes on screen
- 65-84: Generally attentive, minor fidgeting or neutral posture
- 40-64: Visible distraction, slumped, looking away, restless
- 0-39:  Not at desk, head down, clearly disengaged or absent`;

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
  const absent_experiment_tags = db.prepare(
    'SELECT tag FROM experiment_absences WHERE session_id = ?'
  ).all(session.id).map(r => r.tag);
  res.json({ session: { ...session, tags, absent_experiment_tags } });
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
  const { tags, experiment_absences } = req.body;
  if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' });
  setSessionTags(req.params.id, tags);
  if (Array.isArray(experiment_absences)) {
    setExperimentAbsences(req.params.id, experiment_absences);
  }
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

// GET /api/sessions/by-experiment/:tag
app.get('/api/sessions/by-experiment/:tag', (req, res) => {
  const { tag } = req.params;
  const present = db.prepare(`
    SELECT s.*, 'present' AS condition FROM sessions s
    JOIN habit_tags ht ON s.id = ht.session_id
    WHERE ht.tag = ? ORDER BY s.started_at DESC LIMIT 30
  `).all(tag).map(s => ({ ...s, condition: 'present' }));
  const absent = db.prepare(`
    SELECT s.*, 'absent' AS condition FROM sessions s
    JOIN experiment_absences ea ON s.id = ea.session_id
    WHERE ea.tag = ? ORDER BY s.started_at DESC LIMIT 30
  `).all(tag).map(s => ({ ...s, condition: 'absent' }));
  const sessions = [...present, ...absent].sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
  res.json({ sessions });
});

// POST /api/experiments
app.post('/api/experiments', (req, res) => {
  const { name, tag, description } = req.body;
  if (!name || !tag) return res.status(400).json({ error: 'name and tag required' });
  const count = db.prepare('SELECT COUNT(*) as n FROM experiments').get().n;
  if (count >= 3) return res.status(400).json({ error: 'Maximum of 3 active experiments allowed. Complete or delete one first.' });
  db.prepare('INSERT INTO experiments (name, tag, created_at, description) VALUES (?, ?, ?, ?)')
    .run(name, tag.toLowerCase().replace(/\s+/g, '_'), Date.now(), description || '');
  const experiments = getExperimentsWithStats();
  broadcast({ type: 'experiments_updated', experiments });
  res.json({ ok: true, experiments });
});

// POST /api/capture/frame — browser sends a base64 JPEG; server calls Claude and stores the result
app.post('/api/capture/frame', async (req, res) => {
  const { session_id, image_b64 } = req.body;
  if (!session_id || !image_b64) return res.status(400).json({ error: 'Missing session_id or image_b64' });
  if (!anthropic) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on server' });

  let scoreData;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: FOCUS_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image_b64 } },
          { type: 'text', text: 'Analyze this webcam image and return the JSON score.' },
        ],
      }],
    });
    let text = message.content[0].text.trim();
    if (text.includes('```')) text = text.split('```')[1].replace(/^json/, '').trim();
    scoreData = JSON.parse(text);
  } catch (e) {
    console.error('Claude scoring error:', e.message);
    return res.status(500).json({ error: 'Claude scoring failed: ' + e.message });
  }

  const ts = Date.now();
  const payload = {
    session_id,
    timestamp: ts,
    focus_score: scoreData.focus_score,
    posture_quality: scoreData.posture_quality,
    engagement_signal: scoreData.engagement_signal,
    confidence: scoreData.confidence,
    note: scoreData.note,
  };

  insertCapture(payload);

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

  broadcast({ type: 'capture', data: payload });
  res.json({ ok: true, score: scoreData });
});

// POST /api/reset — wipe all collected data
app.post('/api/reset', (req, res) => {
  db.exec('DELETE FROM captures; DELETE FROM sessions; DELETE FROM habit_tags; DELETE FROM experiments;');
  broadcast({ type: 'reset' });
  res.json({ ok: true });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Locus server running on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
});
