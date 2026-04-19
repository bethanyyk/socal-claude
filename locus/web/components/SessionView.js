'use client';

import { useEffect, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from 'chart.js';
import { useWs } from './WebSocketContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

const COMMON_TAGS = ['coffee', 'exercise', 'good_sleep', 'late_screens', 'music', 'pomodoro', 'fasting', 'meditation'];
const CAPTURE_INTERVAL_MS = 10_000;

function scoreColor(score) {
  if (score >= 70) return '#1D9E75';
  if (score >= 45) return '#BA7517';
  return '#993C1D';
}

function formatDuration(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MomentDot({ sentiment }) {
  const colors = { positive: '#1D9E75', negative: '#993C1D', neutral: '#BA7517' };
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0 mt-1"
      style={{ background: colors[sentiment] || colors.neutral }}
    />
  );
}

function KeyMomentCard({ moment }) {
  return (
    <div className="flex gap-3 py-2" style={{ borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
      <MomentDot sentiment={moment.sentiment} />
      <div>
        <p className="text-sm font-medium" style={{ color: '#1A1917' }}>{moment.title}</p>
        <p className="text-xs" style={{ color: '#6B6A65' }}>{moment.description}</p>
        <p className="text-xs mt-0.5" style={{ color: '#A09E99', fontFamily: '"DM Mono", monospace' }}>
          {formatTime(moment.timestamp)}
        </p>
      </div>
    </div>
  );
}

function buildNudgeQuestions(moments) {
  const questions = [];
  if (moments.find(m => m.type === 'slow_start')) {
    questions.push({
      id: 'slow_start',
      question: 'You had a slow start — what do you think contributed?',
      options: ['rushed morning', 'poor sleep', 'felt distracted', 'nothing unusual'],
    });
  }
  if (moments.find(m => m.type === 'deep_focus_streak')) {
    questions.push({
      id: 'deep_focus',
      question: 'You hit a strong focus streak — what helped?',
      options: ['no distractions', 'interesting task', 'good conditions', 'momentum'],
    });
  }
  if (moments.find(m => m.type === 'distraction')) {
    questions.push({
      id: 'distraction',
      question: 'There were some distractions — what caused them?',
      options: ['notifications', 'environment', 'task fatigue', 'unclear next step'],
    });
  }
  if (moments.find(m => m.type === 'recovery')) {
    questions.push({
      id: 'recovery',
      question: 'You recovered well from a dip — what helped?',
      options: ['took a break', 'task switch', 'self-discipline', 'removed distraction'],
    });
  }
  return questions;
}

function SessionComplete({ session, moments, experiments, initialTags, onSubmit }) {
  const [tags, setTags] = useState(initialTags || []);
  const [absentExps, setAbsentExps] = useState(new Set());
  const [reflections, setReflections] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const score = session.avg_focus ? Math.round(session.avg_focus) : null;
  const nudgeQuestions = buildNudgeQuestions(moments);

  function toggleTag(tag) {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  }

  function handleExpPresent(exp) {
    setTags(prev => prev.includes(exp.tag) ? prev.filter(t => t !== exp.tag) : [...prev, exp.tag]);
    setAbsentExps(prev => { const s = new Set(prev); s.delete(exp.id); return s; });
  }

  function handleExpAbsent(exp) {
    setTags(prev => prev.filter(t => t !== exp.tag));
    setAbsentExps(prev => {
      const s = new Set(prev);
      if (s.has(exp.id)) s.delete(exp.id);
      else s.add(exp.id);
      return s;
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    const absentExpTags = experiments.filter(e => absentExps.has(e.id)).map(e => e.tag);
    await onSubmit(tags, absentExpTags);
  }

  return (
    <div className="max-w-xl mx-auto py-8">
      {/* Session summary */}
      <div className="card p-6 mb-6">
        <div className="flex items-end justify-between mb-2">
          <div>
            <p className="font-lora text-xl mb-0.5" style={{ color: '#1A1917' }}>Session complete</p>
            <p className="text-xs" style={{ color: '#A09E99', fontFamily: '"DM Mono", monospace' }}>
              {formatTime(session.started_at)}
              {session.ended_at ? ` → ${formatTime(session.ended_at)}` : ''}
              {' · '}{formatDuration(session.duration_seconds)}
              {session.capture_count ? ` · ${session.capture_count} captures` : ''}
            </p>
          </div>
          {score !== null && (
            <div className="text-right">
              <p className="font-lora font-medium" style={{ fontSize: '2.5rem', lineHeight: 1, color: scoreColor(score) }}>
                {score}
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#A09E99' }}>avg focus</p>
            </div>
          )}
        </div>
        {session.peak_focus && (
          <p className="text-xs" style={{ color: '#6B6A65' }}>
            Peak: <span style={{ fontFamily: '"DM Mono", monospace', color: '#1A1917' }}>{session.peak_focus}</span>
          </p>
        )}
      </div>

      {/* Conditions */}
      <div className="card p-5 mb-4">
        <p className="text-sm font-medium mb-0.5" style={{ color: '#1A1917' }}>What was present today?</p>
        <p className="text-xs mb-3" style={{ color: '#A09E99' }}>Select all that applied</p>
        <div className="flex flex-wrap gap-2">
          {COMMON_TAGS.map(tag => {
            const active = tags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className="px-3 py-1.5 rounded-full text-xs transition-all"
                style={{
                  background: active ? '#BA7517' : '#F5F4F0',
                  color: active ? '#FFFFFF' : '#6B6A65',
                  fontWeight: active ? 500 : 400,
                }}
              >
                {tag.replace(/_/g, ' ')}
              </button>
            );
          })}
        </div>
      </div>

      {/* Experiments */}
      {experiments.length > 0 && (
        <div className="card p-5 mb-4">
          <p className="text-sm font-medium mb-0.5" style={{ color: '#1A1917' }}>Experiment conditions</p>
          <p className="text-xs mb-3" style={{ color: '#A09E99' }}>
            Both "present" and "absent" sessions build your dataset. Leave blank if this session wasn't part of the experiment.
          </p>
          {experiments.map((exp, i) => {
            const isPresent = tags.includes(exp.tag);
            const isAbsent = absentExps.has(exp.id);
            const c = exp.correlation;
            return (
              <div
                key={exp.id}
                className="flex items-center justify-between py-2.5"
                style={{ borderBottom: i < experiments.length - 1 ? '0.5px solid rgba(0,0,0,0.06)' : 'none' }}
              >
                <div>
                  <p className="text-sm" style={{ color: '#1A1917' }}>{exp.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: '#A09E99' }}>
                    {c?.sessions_with ?? 0} present · {c?.sessions_without ?? 0} absent so far
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleExpPresent(exp)}
                    className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                    style={{
                      background: isPresent ? '#1D9E75' : '#F5F4F0',
                      color: isPresent ? '#FFFFFF' : '#6B6A65',
                    }}
                  >
                    Present
                  </button>
                  <button
                    onClick={() => handleExpAbsent(exp)}
                    className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                    style={{
                      background: isAbsent ? '#6B6A65' : '#F5F4F0',
                      color: isAbsent ? '#FFFFFF' : '#6B6A65',
                    }}
                  >
                    Absent
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reflection */}
      {nudgeQuestions.length > 0 && (
        <div className="card p-5 mb-6">
          <p className="text-sm font-medium mb-3" style={{ color: '#1A1917' }}>Quick reflection</p>
          {nudgeQuestions.map((q, i) => (
            <div key={q.id} className={i < nudgeQuestions.length - 1 ? 'mb-4' : ''}>
              <p className="text-sm mb-2" style={{ color: '#6B6A65' }}>{q.question}</p>
              <div className="flex flex-wrap gap-1.5">
                {q.options.map(opt => (
                  <button
                    key={opt}
                    onClick={() => setReflections(prev => ({ ...prev, [q.id]: opt }))}
                    className="px-2.5 py-1 rounded-full text-xs transition-all"
                    style={{
                      background: reflections[q.id] === opt ? '#BA7517' : '#F5F4F0',
                      color: reflections[q.id] === opt ? '#FFFFFF' : '#6B6A65',
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-3 rounded-component text-sm font-medium transition-opacity"
        style={{
          background: '#BA7517',
          color: '#FFFFFF',
          opacity: submitting ? 0.6 : 1,
          cursor: submitting ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting ? 'Saving…' : 'Done — start new session →'}
      </button>
    </div>
  );
}

function LocusNudge({ moments, sessionAvg, globalAvg }) {
  const nudges = [];

  const slowStart = moments.find(m => m.type === 'slow_start');
  if (slowStart) {
    nudges.push({
      id: 'slow_start',
      question: 'You had a slow start. Was anything different this morning?',
      options: ['rushed morning', 'felt distracted', 'nothing unusual'],
    });
  }

  const streak = moments.find(m => m.type === 'deep_focus_streak');
  if (streak) {
    nudges.push({
      id: 'long_streak',
      question: 'Strong focus streak detected — want to design an experiment around it?',
      options: ['design experiment'],
    });
  }

  const recovery = moments.find(m => m.type === 'recovery');
  if (recovery) {
    nudges.push({
      id: 'fast_recovery',
      question: `You recovered well after a distraction. What helped?`,
      options: ['environment change', 'self-discipline', 'task switch'],
    });
  }

  if (!nudges.length) return null;

  return (
    <div className="mt-4">
      <p className="text-xs font-medium mb-2" style={{ color: '#A09E99', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Locus asks
      </p>
      {nudges.slice(0, 2).map(n => (
        <div key={n.id} className="card p-3 mb-2">
          <p className="text-sm mb-2" style={{ color: '#1A1917' }}>{n.question}</p>
          <div className="flex flex-wrap gap-1.5">
            {n.options.map(opt => (
              <button
                key={opt}
                className="px-2.5 py-1 rounded-full text-xs border transition-colors hover:bg-amber-50"
                style={{ border: '0.5px solid rgba(0,0,0,0.15)', color: '#6B6A65' }}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExperimentUpdateCard({ exp, prevR, highlighted }) {
  const r = exp.correlation?.r;
  const oldR = prevR ?? null;
  const diff = r !== null && oldR !== null ? r - oldR : null;

  function interp(val) {
    if (val === null) return 'No data yet';
    const abs = Math.abs(val);
    if (abs < 0.2) return 'No clear signal yet';
    if (abs < 0.4) return 'Weak signal emerging';
    if (abs < 0.6) return 'Moderate effect';
    return 'Strong signal';
  }

  return (
    <div className={`card p-3 mb-2 transition-all ${highlighted ? 'pulse-amber' : ''}`}>
      <div className="flex items-start justify-between mb-1.5">
        <p className="text-sm font-medium" style={{ color: '#1A1917' }}>{exp.name}</p>
        <span
          className="text-xs px-1.5 py-0.5 rounded"
          style={{
            background: r === null ? '#F5F4F0' : Math.abs(r) >= 0.4 ? '#D1F0E7' : '#F5E6C8',
            color: r === null ? '#A09E99' : Math.abs(r) >= 0.4 ? '#1D9E75' : '#BA7517',
            fontFamily: '"DM Mono", monospace',
          }}
        >
          {r !== null ? `r=${r.toFixed(2)}` : 'n/a'}
        </span>
      </div>
      {diff !== null && (
        <p className="text-xs mb-1" style={{ color: diff > 0 ? '#1D9E75' : '#993C1D' }}>
          {diff > 0 ? '↑' : '↓'} {Math.abs(diff).toFixed(3)} this session
        </p>
      )}
      <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: '#F5F4F0' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(Math.abs(r || 0) * 100, 100)}%`, background: '#BA7517' }}
        />
      </div>
      <p className="text-xs mt-1" style={{ color: '#6B6A65' }}>{interp(r)}</p>
    </div>
  );
}

export default function SessionView() {
  const { currentSession, setCurrentSession, latestCapture, experiments } = useWs();
  const [arc, setArc] = useState([]);
  const [globalArc, setGlobalArc] = useState([]);
  const [moments, setMoments] = useState([]);
  const [tags, setTags] = useState([]);
  const [prevExperiments, setPrevExperiments] = useState({});
  const [highlightedExps, setHighlightedExps] = useState(new Set());

  // Webcam tracking state
  const [trackerActive, setTrackerActive] = useState(false);
  const [postSessionActive, setPostSessionActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const webcamDisplayRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const captureIntervalRef = useRef(null);
  const trackingSessionIdRef = useRef(null);
  const postSessionIdRef = useRef(null);

  const sessionId = currentSession?.id;
  const isComplete = currentSession && currentSession.ended_at;

  // Attach stream to video element — fires on trackerActive change AND when currentSession
  // is first set (because the video element only mounts after currentSession becomes non-null)
  useEffect(() => {
    if (trackerActive && webcamDisplayRef.current && streamRef.current) {
      webcamDisplayRef.current.srcObject = streamRef.current;
    }
  }, [trackerActive, sessionId]);

  // If session ends externally (e.g. Python tracker), stop the webcam stream
  useEffect(() => {
    if (isComplete && trackerActive) {
      clearInterval(captureIntervalRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      trackingSessionIdRef.current = null;
      setTrackerActive(false);
    }
  }, [isComplete]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearInterval(captureIntervalRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  async function startTracking() {
    setCameraError(null);
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;

      const newSessionId = crypto.randomUUID();
      trackingSessionIdRef.current = newSessionId;

      await fetch('/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: newSessionId }),
      });

      setTrackerActive(true);

      setTimeout(() => captureAndSend(), 2000);
      captureIntervalRef.current = setInterval(() => captureAndSend(), CAPTURE_INTERVAL_MS);
    } catch (e) {
      setCameraError(e.message || 'Could not access camera');
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    } finally {
      setStarting(false);
    }
  }

  function captureAndSend() {
    const video = webcamDisplayRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !trackingSessionIdRef.current) return;
    // Fallback: set srcObject if the useEffect fired before the video element mounted
    if (!video.srcObject && streamRef.current) {
      video.srcObject = streamRef.current;
    }
    if (!video.srcObject) return;

    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, 640, 480);

    canvas.toBlob(blob => {
      if (!blob) return;
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        fetch('/api/capture/frame', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: trackingSessionIdRef.current, image_b64: base64 }),
        }).catch(err => console.error('Capture send failed:', err));
      };
      reader.readAsDataURL(blob);
    }, 'image/jpeg', 0.85);
  }

  async function stopTracking() {
    clearInterval(captureIntervalRef.current);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    postSessionIdRef.current = trackingSessionIdRef.current;
    trackingSessionIdRef.current = null;

    setTrackerActive(false);
    setPostSessionActive(true);
  }

  // Fetch arc + moments when session changes
  useEffect(() => {
    if (!sessionId) return;
    Promise.all([
      fetch(`/api/session/${sessionId}/arc`).then(r => r.json()),
      fetch(`/api/session/${sessionId}/moments`).then(r => r.json()),
    ]).then(([{ arc: a }, { moments: m }]) => {
      setArc(a || []);
      setMoments(m || []);
    }).catch(() => {});

    setTags(currentSession?.tags || []);
  }, [sessionId]);

  // Refresh arc + moments on each new capture (via WS)
  useEffect(() => {
    if (!sessionId || !latestCapture) return;
    fetch(`/api/session/${sessionId}/arc`)
      .then(r => r.json())
      .then(({ arc: a }) => setArc(a || [])).catch(() => {});
    fetch(`/api/session/${sessionId}/moments`)
      .then(r => r.json())
      .then(({ moments: m }) => setMoments(m || [])).catch(() => {});
  }, [latestCapture]);

  // Poll arc + moments every 10s while webcam is active (fallback if WS chain breaks)
  useEffect(() => {
    if (!sessionId || !trackerActive) return;
    const poll = setInterval(() => {
      fetch(`/api/session/${sessionId}/arc`)
        .then(r => r.json())
        .then(({ arc: a }) => { if (a?.length) setArc(a); }).catch(() => {});
      fetch(`/api/session/${sessionId}/moments`)
        .then(r => r.json())
        .then(({ moments: m }) => setMoments(m || [])).catch(() => {});
    }, 10_000);
    return () => clearInterval(poll);
  }, [sessionId, trackerActive]);

  useEffect(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then(({ sessions }) => {
        if (!sessions?.length) return;
        setGlobalArc([]);
      }).catch(() => {});
  }, []);

  // Detect experiment updates and trigger highlight
  useEffect(() => {
    if (!experiments?.length) return;
    const newHighlights = new Set();
    const newPrev = {};
    for (const exp of experiments) {
      const old = prevExperiments[exp.id];
      const r = exp.correlation?.r;
      newPrev[exp.id] = r;
      if (old !== undefined && old !== r) newHighlights.add(exp.id);
    }
    if (newHighlights.size > 0) {
      setHighlightedExps(newHighlights);
      setTimeout(() => setHighlightedExps(new Set()), 1500);
    }
    setPrevExperiments(newPrev);
  }, [experiments]);

  async function saveTags(newTags) {
    setTags(newTags);
    if (!sessionId) return;
    await fetch(`/api/session/${sessionId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: newTags }),
    });
  }

  function toggleTag(tag) {
    const next = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag];
    saveTags(next);
  }

  const score = currentSession?.avg_focus ? Math.round(currentSession.avg_focus) : null;
  const isActive = currentSession && !currentSession.ended_at;

  // Chart data — arc is now per-capture with elapsed seconds
  const arcLabels = arc.map(p => {
    const e = p.elapsed ?? (p.minute * 60);
    const m = Math.floor(e / 60);
    return m > 0 ? `${m}m` : `${e}s`;
  });
  const arcData = arc.map(p => p.avg_focus);
  const chartData = {
    labels: arcLabels,
    datasets: [{
      label: 'This session',
      data: arcData,
      borderColor: '#BA7517',
      backgroundColor: 'rgba(186,117,23,0.08)',
      fill: true,
      tension: 0.35,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
    }],
  };
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#A09E99', font: { family: '"DM Mono", monospace', size: 11 }, maxTicksLimit: 8 },
        border: { display: false },
      },
      y: {
        min: 0,
        max: 100,
        grid: { color: 'rgba(0,0,0,0.04)' },
        ticks: { color: '#A09E99', font: { family: '"DM Mono", monospace', size: 11 }, stepSize: 25 },
        border: { display: false },
      },
    },
  };

  const hiddenCapture = <canvas ref={canvasRef} style={{ display: 'none' }} />;

  // ── No active session ─────────────────────────────────────────────────────
  if (!currentSession) {
    return (
      <>
        {hiddenCapture}
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="font-lora text-2xl mb-2" style={{ color: '#1A1917' }}>No active session</p>
          <p className="text-sm mb-8" style={{ color: '#6B6A65' }}>
            Start a session to begin capturing your attention data.
          </p>
          <button
            onClick={startTracking}
            disabled={starting}
            className="px-8 py-3 rounded-component text-sm font-medium transition-opacity"
            style={{
              background: '#BA7517',
              color: '#FFFFFF',
              opacity: starting ? 0.6 : 1,
              cursor: starting ? 'not-allowed' : 'pointer',
            }}
          >
            {starting ? 'Starting…' : 'Start session'}
          </button>
          {cameraError && (
            <p className="text-sm mt-4" style={{ color: '#993C1D' }}>Camera error: {cameraError}</p>
          )}
          <p className="text-xs mt-6" style={{ color: '#A09E99' }}>
            or run <code style={{ fontFamily: '"DM Mono", monospace' }}>python tracker/main.py</code> in your terminal
          </p>
        </div>
      </>
    );
  }

  // ── Post-session form (webcam stopped by user, session not yet ended) ─────
  if (postSessionActive && currentSession) {
    return (
      <>
        {hiddenCapture}
        <SessionComplete
          session={currentSession}
          moments={moments}
          experiments={experiments}
          initialTags={tags}
          onSubmit={async (finalTags, absentExpTags) => {
            const sid = postSessionIdRef.current || sessionId;
            if (sid) {
              await fetch('/api/session/end', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sid }),
              }).catch(() => {});
              await fetch(`/api/session/${sid}/tags`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: finalTags, experiment_absences: absentExpTags }),
              }).catch(() => {});
            }
            postSessionIdRef.current = null;
            setPostSessionActive(false);
            setCurrentSession(null);
          }}
        />
      </>
    );
  }

  // ── Session complete (ended externally, e.g. Python tracker) ─────────────
  if (isComplete) {
    return (
      <>
        {hiddenCapture}
        <SessionComplete
          session={currentSession}
          moments={moments}
          experiments={experiments}
          initialTags={tags}
          onSubmit={async (finalTags, absentExpTags) => {
            if (sessionId) {
              await fetch(`/api/session/${sessionId}/tags`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: finalTags, experiment_absences: absentExpTags }),
              }).catch(() => {});
            }
            setCurrentSession(null);
          }}
        />
      </>
    );
  }

  // ── Active session ────────────────────────────────────────────────────────
  return (
    <>
      {hiddenCapture}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Left column */}
        <div>
          {/* Session header */}
          <div className="card p-5 mb-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: isActive ? '#1D9E75' : '#A09E99' }}
                  />
                  <span className="text-sm font-medium" style={{ color: '#6B6A65' }}>
                    {isActive ? 'Session active' : 'Session complete'}
                  </span>
                </div>
                <p className="text-xs" style={{ color: '#A09E99', fontFamily: '"DM Mono", monospace' }}>
                  {formatTime(currentSession.started_at)}
                  {currentSession.ended_at ? ` → ${formatTime(currentSession.ended_at)}` : ''}
                  {' · '}
                  {formatDuration(currentSession.duration_seconds)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {trackerActive && (
                  <button
                    onClick={stopTracking}
                    className="px-3 py-1 rounded-full text-xs font-medium transition-opacity hover:opacity-80"
                    style={{ background: '#993C1D', color: '#FFFFFF' }}
                  >
                    Stop session
                  </button>
                )}
                {!trackerActive && isActive && (
                  <button
                    onClick={startTracking}
                    disabled={starting}
                    className="px-3 py-1 rounded-full text-xs font-medium transition-opacity hover:opacity-80"
                    style={{ background: '#BA7517', color: '#FFFFFF', opacity: starting ? 0.6 : 1 }}
                  >
                    {starting ? 'Starting…' : 'Start browser tracking'}
                  </button>
                )}
                {score !== null && (
                  <div className="text-right">
                    <p
                      className="font-lora font-medium"
                      style={{ fontSize: '2.5rem', lineHeight: 1, color: scoreColor(score) }}
                    >
                      {score}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#A09E99' }}>avg focus</p>
                  </div>
                )}
              </div>
            </div>
            {currentSession.peak_focus && (
              <p className="text-xs mt-2" style={{ color: '#6B6A65' }}>
                Peak: <span style={{ fontFamily: '"DM Mono", monospace', color: '#1A1917' }}>{currentSession.peak_focus}</span>
                {' · '}
                Captures: <span style={{ fontFamily: '"DM Mono", monospace', color: '#1A1917' }}>{currentSession.capture_count || 0}</span>
              </p>
            )}
          </div>

          {/* Focus arc chart */}
          {arc.length > 0 && (
            <div className="card p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium" style={{ color: '#1A1917' }}>Focus arc</p>
                <div className="flex items-center gap-4 text-xs" style={{ color: '#A09E99' }}>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-6 h-0.5 rounded" style={{ background: '#BA7517' }} />
                    this session
                  </span>
                </div>
              </div>
              <div style={{ height: '140px' }}>
                <Line data={chartData} options={chartOptions} />
              </div>
            </div>
          )}

          {/* Key moments */}
          {moments.length > 0 && (
            <div className="card p-4 mb-4">
              <p className="text-sm font-medium mb-3" style={{ color: '#1A1917' }}>Key moments</p>
              {moments.map((m, i) => <KeyMomentCard key={i} moment={m} />)}
            </div>
          )}

          {/* Habit tagging — hidden while webcam is active */}
          {!trackerActive && (
            <div className="card p-4 mb-4">
              <p className="text-sm font-medium mb-3" style={{ color: '#1A1917' }}>Tag this session</p>
              <div className="flex flex-wrap gap-2">
                {COMMON_TAGS.map(tag => {
                  const active = tags.includes(tag);
                  const inExperiment = experiments.some(e => e.tag === tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className="px-3 py-1 rounded-full text-xs transition-all"
                      style={{
                        background: active ? '#BA7517' : '#F5F4F0',
                        color: active ? '#FFFFFF' : '#6B6A65',
                        border: inExperiment && !active ? '1px solid #BA7517' : '0.5px solid transparent',
                        fontWeight: active ? 500 : 400,
                        boxShadow: inExperiment && active ? '0 0 0 2px rgba(186,117,23,0.3)' : 'none',
                      }}
                    >
                      {tag.replace(/_/g, ' ')}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Locus asks — hidden while webcam is active */}
          {!trackerActive && <LocusNudge moments={moments} sessionAvg={score} />}
        </div>

        {/* Right column */}
        <div>
          {/* Live webcam feed */}
          {trackerActive && (
            <div className="card p-4 mb-4 overflow-hidden">
              <p className="text-xs font-medium mb-2" style={{ color: '#A09E99', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Live feed
              </p>
              <video
                ref={webcamDisplayRef}
                autoPlay
                muted
                playsInline
                className="w-full rounded"
                style={{ aspectRatio: '4/3', objectFit: 'cover', background: '#1A1917' }}
              />
            </div>
          )}

          {/* Live capture */}
          {latestCapture && (
            <div className="card p-4 mb-4">
              <p className="text-xs font-medium mb-2" style={{ color: '#A09E99', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Latest reading
              </p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm" style={{ color: '#6B6A65' }}>
                    {latestCapture.engagement_signal?.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs mt-0.5 italic" style={{ color: '#A09E99' }}>"{latestCapture.note}"</p>
                </div>
                <span className="font-mono text-2xl font-medium" style={{ color: scoreColor(latestCapture.focus_score) }}>
                  {latestCapture.focus_score}
                </span>
              </div>
            </div>
          )}

          {/* Experiment cards — hidden while webcam is active */}
          {!trackerActive && experiments.length > 0 && (
            <div className="card p-4 mb-4">
              <p className="text-xs font-medium mb-3" style={{ color: '#A09E99', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Experiments updated by this session
              </p>
              {experiments.map(exp => (
                <ExperimentUpdateCard
                  key={exp.id}
                  exp={exp}
                  prevR={prevExperiments[exp.id] ?? null}
                  highlighted={highlightedExps.has(exp.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
