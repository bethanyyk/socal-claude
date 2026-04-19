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
    <div
      className={`card p-3 mb-2 transition-all ${highlighted ? 'pulse-amber' : ''}`}
    >
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
  const { currentSession, latestCapture, experiments } = useWs();
  const [arc, setArc] = useState([]);
  const [globalArc, setGlobalArc] = useState([]);
  const [moments, setMoments] = useState([]);
  const [tags, setTags] = useState([]);
  const [prevExperiments, setPrevExperiments] = useState({});
  const [highlightedExps, setHighlightedExps] = useState(new Set());
  const sessionId = currentSession?.id;

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

  // Refresh arc live on new captures
  useEffect(() => {
    if (!sessionId || !latestCapture) return;
    fetch(`/api/session/${sessionId}/arc`)
      .then(r => r.json())
      .then(({ arc: a }) => setArc(a || [])
      ).catch(() => {});
    fetch(`/api/session/${sessionId}/moments`)
      .then(r => r.json())
      .then(({ moments: m }) => setMoments(m || [])
      ).catch(() => {});
  }, [latestCapture]);

  // Fetch global average arc (all-time per minute avg)
  useEffect(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then(({ sessions }) => {
        // Build a rough all-time average by minute position (simplified)
        if (!sessions?.length) return;
        setGlobalArc([]); // placeholder — would need a dedicated endpoint
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
      if (old !== undefined && old !== r) {
        newHighlights.add(exp.id);
      }
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

  // Chart data
  const arcLabels = arc.map(p => `${p.minute}m`);
  const arcData = arc.map(p => p.avg_focus);
  const chartData = {
    labels: arcLabels,
    datasets: [
      {
        label: 'This session',
        data: arcData,
        borderColor: '#BA7517',
        backgroundColor: 'rgba(186,117,23,0.08)',
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
      },
    ],
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

  if (!currentSession) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="font-lora text-2xl mb-2" style={{ color: '#1A1917' }}>No active session</p>
        <p className="text-sm" style={{ color: '#6B6A65' }}>
          Start the tracker to begin capturing your attention data.
        </p>
        <pre className="mt-4 p-3 text-xs rounded-component surface" style={{ color: '#6B6A65' }}>
          python tracker/main.py --mock
        </pre>
      </div>
    );
  }

  return (
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

        {/* Habit tagging */}
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

        {/* Locus asks */}
        <LocusNudge moments={moments} sessionAvg={score} />
      </div>

      {/* Right column */}
      <div>
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
              <span
                className="font-mono text-2xl font-medium"
                style={{ color: scoreColor(latestCapture.focus_score) }}
              >
                {latestCapture.focus_score}
              </span>
            </div>
          </div>
        )}

        {/* Experiment cards */}
        {experiments.length > 0 && (
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
  );
}
