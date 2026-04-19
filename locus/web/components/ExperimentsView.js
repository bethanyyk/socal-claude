'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
} from 'chart.js';
import { useWs } from './WebSocketContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

// Abramowitz & Stegun approximation for the standard normal CDF
function normalCDF(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const phi = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-z * z / 2) * poly;
  return z >= 0 ? phi : 1 - phi;
}

// Two-tailed t-test for Pearson r
function calcConfidence(r, n) {
  if (r === null || n < 3) return null;
  const absR = Math.min(Math.abs(r), 0.9999);
  const t = absR * Math.sqrt(n - 2) / Math.sqrt(1 - absR * absR);
  const p = 2 * (1 - normalCDF(t));
  return Math.min(99, Math.round((1 - p) * 100));
}

function interpColor(r) {
  if (r === null) return '#A09E99';
  return Math.abs(r) < 0.2 ? '#A09E99' : Math.abs(r) < 0.4 ? '#7b9ce2' : '#1D9E75';
}

function scoreColor(score) {
  if (score >= 70) return '#1D9E75';
  if (score >= 45) return '#7b9ce2';
  return '#C24220';
}

function formatDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function ExperimentCard({ exp, selected, onClick, muted }) {
  const r = exp.correlation?.r;
  const barWidth = r !== null ? Math.min(Math.abs(r) * 100, 100) : 0;
  return (
    <button
      onClick={onClick}
      className="w-full text-left card p-3 mb-2 transition-all hover:shadow-sm"
      style={{ border: selected ? '1px solid #7b9ce2' : '0.5px solid rgba(0,0,0,0.1)', background: selected ? '#F5F8FE' : '#FFFFFF', opacity: muted && !selected ? 0.6 : 1 }}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-sm font-medium" style={{ color: '#1A1917' }}>{exp.name}</p>
          <p className="text-xs mt-0.5" style={{ color: '#A09E99' }}>
            tag: <span style={{ fontFamily: '"DM Mono", monospace' }}>{exp.tag}</span>
          </p>
        </div>
        <div className="text-right">
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#F5F4F0', color: interpColor(r), fontFamily: '"DM Mono", monospace' }}>
            {r !== null ? `r=${r.toFixed(2)}` : 'n/a'}
          </span>
          <p className="text-xs mt-0.5" style={{ color: '#A09E99' }}>
            {exp.correlation?.sessions_with ?? 0}↑ · {exp.correlation?.sessions_without ?? 0}↓
          </p>
        </div>
      </div>
      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#F5F4F0' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${barWidth}%`, background: interpColor(r) }} />
      </div>
    </button>
  );
}

function ExperimentDetail({ exp, sessions, onClose }) {
  const c = exp.correlation || {};
  const r = c.r ?? null;
  const r2 = r !== null ? Math.round(r * r * 100) : null;
  const conf = calcConfidence(r, c.n);
  const diff = c.avg_with != null && c.avg_without != null ? c.avg_with - c.avg_without : null;
  const hasBoth = (c.sessions_with ?? 0) > 0 && (c.sessions_without ?? 0) > 0;

  // Plain-language status
  let headline, detail, headlineColor;
  if (!c.sessions_with && !c.sessions_without) {
    headline = 'No sessions tracked yet';
    detail = 'After each session, mark this condition as Present or Absent in the post-session form.';
    headlineColor = '#A09E99';
  } else if (!c.sessions_with) {
    headline = 'No "present" sessions yet';
    detail = `You have ${c.sessions_without} absent session${c.sessions_without !== 1 ? 's' : ''}. Log some sessions where this condition applied.`;
    headlineColor = '#7b9ce2';
  } else if (!c.sessions_without) {
    headline = 'No "absent" sessions yet';
    detail = `You have ${c.sessions_with} present session${c.sessions_with !== 1 ? 's' : ''}. To compare, also log sessions without this condition — that's your control group.`;
    headlineColor = '#7b9ce2';
  } else if (r === null) {
    headline = 'Collecting data…';
    detail = `${c.sessions_with} present · ${c.sessions_without} absent. A pattern will emerge as you add more sessions.`;
    headlineColor = '#A09E99';
  } else {
    const absD = Math.abs(Math.round(diff));
    headline = `Focus is ${absD} pts ${diff > 0 ? 'higher' : 'lower'} when present`;
    detail = conf !== null
      ? `${conf}% confident this is a real effect (not random variation).`
      : '';
    headlineColor = diff > 0 ? '#1D9E75' : '#C24220';
  }

  // Chart
  const history = exp.history || [];
  const hasChart = history.length >= 2;
  const chartData = hasChart ? {
    labels: history.map(p => `#${p.session_index}`),
    datasets: [{
      label: 'r',
      data: history.map(p => p.r),
      borderColor: '#7b9ce2',
      tension: 0.3,
      borderWidth: 2,
      pointRadius: 2.5,
      pointBackgroundColor: '#7b9ce2',
    }],
  } : null;
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => `r = ${ctx.raw?.toFixed(3) ?? '—'}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#A09E99', font: { family: '"DM Mono", monospace', size: 10 }, maxTicksLimit: 8 }, border: { display: false } },
      y: { min: -1, max: 1, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { color: '#A09E99', font: { family: '"DM Mono", monospace', size: 10 }, stepSize: 0.5 }, border: { display: false } },
    },
  };

  const presentSessions = sessions.filter(s => s.condition === 'present');
  const absentSessions = sessions.filter(s => s.condition === 'absent');

  return (
    <div className="card p-5" style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 180px)' }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-0.5">
        <p className="font-lora text-lg" style={{ color: '#1A1917' }}>{exp.name}</p>
        {exp.closed_at ? (
          <span className="text-xs px-2 py-1 rounded-full flex-shrink-0 mt-0.5" style={{ background: '#F5F4F0', color: '#A09E99' }}>
            Closed {new Date(exp.closed_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        ) : r !== null && onClose ? (
          <button
            onClick={onClose}
            className="text-xs px-3 py-1 rounded-full flex-shrink-0 mt-0.5 transition-opacity hover:opacity-70"
            style={{ background: '#F5F4F0', color: '#6B6A65' }}
          >
            Close experiment
          </button>
        ) : null}
      </div>
      {exp.description && <p className="text-sm mb-4" style={{ color: '#6B6A65' }}>{exp.description}</p>}

      {/* Plain-language headline */}
      <div className="rounded-component p-4 mb-4" style={{ background: '#F5F4F0' }}>
        <p className="text-sm font-medium mb-1" style={{ color: headlineColor }}>{headline}</p>
        {detail && <p className="text-xs" style={{ color: '#6B6A65' }}>{detail}</p>}

        {/* Avg focus comparison */}
        {hasBoth && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-component p-3 text-center" style={{ background: '#FFFFFF' }}>
              <p className="text-xs mb-1" style={{ color: '#A09E99' }}>Avg focus · Present</p>
              <p className="font-mono text-2xl font-medium" style={{ color: '#1D9E75' }}>{c.avg_with ?? '—'}</p>
              <p className="text-xs mt-0.5" style={{ color: '#A09E99' }}>{c.sessions_with} session{c.sessions_with !== 1 ? 's' : ''}</p>
            </div>
            <div className="rounded-component p-3 text-center" style={{ background: '#FFFFFF' }}>
              <p className="text-xs mb-1" style={{ color: '#A09E99' }}>Avg focus · Absent</p>
              <p className="font-mono text-2xl font-medium" style={{ color: '#6B6A65' }}>{c.avg_without ?? '—'}</p>
              <p className="text-xs mt-0.5" style={{ color: '#A09E99' }}>{c.sessions_without} session{c.sessions_without !== 1 ? 's' : ''}</p>
            </div>
          </div>
        )}
      </div>

      {/* Stats row */}
      {r !== null && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="rounded-component p-2.5" style={{ background: '#F5F4F0' }}>
            <p className="text-xs mb-1" style={{ color: '#A09E99' }}>Correlation r</p>
            <p className="font-mono text-base font-medium" style={{ color: interpColor(r) }}>
              {r > 0 ? '+' : ''}{r.toFixed(3)}
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#A09E99' }}>
              {Math.abs(r) < 0.2 ? 'No pattern' : Math.abs(r) < 0.4 ? 'Weak' : Math.abs(r) < 0.6 ? 'Moderate' : 'Strong'}
              {r > 0 ? ', positive' : ', negative'}
            </p>
          </div>
          <div className="rounded-component p-2.5" style={{ background: '#F5F4F0' }}>
            <p className="text-xs mb-1" style={{ color: '#A09E99' }}>Explained (r²)</p>
            <p className="font-mono text-base font-medium" style={{ color: interpColor(r) }}>{r2}%</p>
            <p className="text-xs mt-0.5" style={{ color: '#A09E99' }}>of focus variation linked to this condition</p>
          </div>
          {conf !== null && (
            <div className="rounded-component p-2.5" style={{ background: '#F5F4F0' }}>
              <p className="text-xs mb-1" style={{ color: '#A09E99' }}>Confidence</p>
              <p className="font-mono text-base font-medium" style={{ color: conf >= 90 ? '#1D9E75' : conf >= 75 ? '#7b9ce2' : '#A09E99' }}>
                {conf}%
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#A09E99' }}>
                {conf >= 95 ? 'Very likely real' : conf >= 80 ? 'Probably real' : 'Uncertain — need more data'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Correlation trend */}
      <div className="mb-4">
        <p className="text-xs font-medium mb-1" style={{ color: '#1A1917' }}>Correlation trend</p>
        <p className="text-xs mb-3" style={{ color: '#A09E99' }}>
          Shows how the correlation (r) changes as you log more sessions.
          Above 0 = condition helps focus; below 0 = condition hurts. Closer to ±1 = stronger effect.
        </p>
        {hasChart ? (
          <div style={{ height: '160px' }}>
            <Line data={chartData} options={chartOptions} />
          </div>
        ) : (
          <div className="py-6 text-center rounded-component" style={{ background: '#F5F4F0' }}>
            <p className="text-xs" style={{ color: '#A09E99' }}>
              Appears after you have at least 2 tracked sessions with a mix of present and absent.
            </p>
          </div>
        )}
      </div>

      {/* Sessions in this experiment */}
      {sessions.length > 0 && (
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: '#1A1917' }}>Sessions in this experiment</p>
          {[{ label: 'Present', list: presentSessions, badge: { bg: '#D1F0E7', color: '#1D9E75' } },
            { label: 'Absent', list: absentSessions, badge: { bg: '#EBEBEB', color: '#6B6A65' } }]
            .filter(g => g.list.length > 0)
            .map(({ label, list, badge }) => (
              <div key={label} className="mb-3">
                <p className="text-xs mb-1.5" style={{ color: '#A09E99' }}>{label}</p>
                {list.map(s => {
                  const score = s.avg_focus ? Math.round(s.avg_focus) : null;
                  return (
                    <Link
                      key={s.id}
                      href={`/session/${s.id}`}
                      className="flex items-center justify-between py-2 px-3 rounded-component mb-1 transition-opacity hover:opacity-75"
                      style={{ background: '#F5F4F0' }}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: badge.bg, color: badge.color }}>
                          {label}
                        </span>
                        <span className="text-xs" style={{ color: '#6B6A65', fontFamily: '"DM Mono", monospace' }}>
                          {formatDateTime(s.started_at)}
                        </span>
                        {s.duration_seconds > 0 && (
                          <span className="text-xs" style={{ color: '#A09E99' }}>{formatDuration(s.duration_seconds)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {score !== null && (
                          <span className="font-mono text-sm font-medium" style={{ color: scoreColor(score) }}>{score}</span>
                        )}
                        <span className="text-xs" style={{ color: '#A09E99' }}>→</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ))}
        </div>
      )}

      {/* Close hint when not yet closeable */}
      {!exp.closed_at && r === null && (
        <div className="mt-4 pt-4" style={{ borderTop: '0.5px solid rgba(0,0,0,0.08)' }}>
          <p className="text-xs" style={{ color: '#A09E99' }}>
            Can be closed once you have data from both present and absent sessions.
          </p>
        </div>
      )}
      {!exp.closed_at && r !== null && (
        <div className="mt-4 pt-4" style={{ borderTop: '0.5px solid rgba(0,0,0,0.08)' }}>
          <p className="text-xs" style={{ color: '#A09E99' }}>
            Closing frees a slot for a new experiment. Analysis results are preserved.
          </p>
        </div>
      )}
    </div>
  );
}

export default function ExperimentsView() {
  const { experiments, setExperiments } = useWs();
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', tag: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [expSessions, setExpSessions] = useState([]);

  const active = experiments.filter(e => !e.closed_at);
  const archived = experiments.filter(e => e.closed_at);
  const defaultExp = active[0] || archived[0] || null;
  const selectedExp = experiments.find(e => e.id === selected) || defaultExp;

  useEffect(() => {
    if (!selectedExp) return;
    setExpSessions([]);
    fetch(`/api/sessions/by-experiment/${selectedExp.tag}`)
      .then(r => r.json())
      .then(({ sessions }) => setExpSessions(sessions || []))
      .catch(() => {});
  }, [selectedExp?.tag]);

  async function createExperiment(e) {
    e.preventDefault();
    if (!form.name || !form.tag) return;
    setSaving(true);
    try {
      const res = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      if (data.experiments) setExperiments(data.experiments);
      setForm({ name: '', tag: '', description: '' });
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  async function closeExperiment(exp) {
    setClosing(true);
    try {
      const res = await fetch(`/api/experiments/${exp.id}/close`, { method: 'POST' });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      if (data.experiments) setExperiments(data.experiments);
    } finally {
      setClosing(false);
    }
  }

  const allEmpty = experiments.length === 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-lora text-xl" style={{ color: '#1A1917' }}>Experiments</h1>
          {active.length >= 3 && (
            <p className="text-xs mt-0.5" style={{ color: '#A09E99' }}>
              3 active — close one to add another (requires data from both groups).
            </p>
          )}
        </div>
        {active.length < 3 && (
          <button
            onClick={() => setShowForm(s => !s)}
            className="px-3 py-1.5 rounded-component text-sm font-medium transition-colors"
            style={{ background: '#7b9ce2', color: '#fff' }}
          >
            + New experiment
          </button>
        )}
      </div>

      {showForm && (
        <div className="card p-4 mb-4">
          <p className="text-sm font-medium mb-1" style={{ color: '#1A1917' }}>New experiment</p>
          <p className="text-xs mb-3" style={{ color: '#A09E99' }}>
            An experiment tracks whether one condition (e.g. morning exercise) consistently affects your focus.
            After sessions, you'll mark each one as "Present" or "Absent" for this condition.
          </p>
          {active.length === 2 && (
            <div className="rounded-component p-3 mb-3" style={{ background: '#7b9ce2', border: '0.5px solid rgba(0,0,0,0.1)' }}>
              <p className="text-xs font-medium mb-0.5" style={{ color: '#fff' }}>This will be your third active experiment</p>
              <p className="text-xs" style={{ color: '#fff' }}>
                You won't be able to add more until one is closed — and an experiment can only be closed once you've collected data from both present and absent sessions. Make sure you're ready to commit.
              </p>
            </div>
          )}
          <form onSubmit={createExperiment} className="space-y-2">
            <input
              className="w-full px-3 py-2 text-sm rounded-component surface outline-none"
              style={{ border: '0.5px solid rgba(0,0,0,0.15)', color: '#1A1917' }}
              placeholder="Name (e.g. 'Morning exercise')"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required
            />
            <input
              className="w-full px-3 py-2 text-sm rounded-component surface outline-none font-mono"
              style={{ border: '0.5px solid rgba(0,0,0,0.15)', color: '#1A1917' }}
              placeholder="Tag (e.g. 'exercise') — used to link sessions"
              value={form.tag}
              onChange={e => setForm(f => ({ ...f, tag: e.target.value }))}
              required
            />
            <input
              className="w-full px-3 py-2 text-sm rounded-component surface outline-none"
              style={{ border: '0.5px solid rgba(0,0,0,0.15)', color: '#1A1917' }}
              placeholder="Hypothesis (optional, e.g. 'I focus better after exercising')"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving} className="px-4 py-1.5 text-sm rounded-component font-medium" style={{ background: '#7b9ce2', color: '#fff', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving…' : 'Create'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-1.5 text-sm rounded-component" style={{ background: '#F5F4F0', color: '#6B6A65' }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {allEmpty ? (
        <div className="card p-8 text-center">
          <p className="font-lora text-lg mb-2" style={{ color: '#1A1917' }}>No experiments yet</p>
          <p className="text-sm max-w-md mx-auto" style={{ color: '#6B6A65' }}>
            Experiments test whether a specific condition — like morning coffee, exercise, or sleep quality — actually affects your focus scores.
            You'll need sessions both with and without the condition to see a result.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          <div>
            {active.map(exp => (
              <ExperimentCard
                key={exp.id}
                exp={exp}
                selected={selected === exp.id || (!selected && exp === defaultExp)}
                onClick={() => setSelected(exp.id)}
              />
            ))}
            {archived.length > 0 && (
              <div className="mt-3">
                <p className="text-xs mb-2 px-1" style={{ color: '#A09E99' }}>Archived</p>
                {archived.map(exp => (
                  <ExperimentCard
                    key={exp.id}
                    exp={exp}
                    selected={selected === exp.id}
                    onClick={() => setSelected(exp.id)}
                    muted
                  />
                ))}
              </div>
            )}
          </div>
          {selectedExp && (
            <ExperimentDetail
              exp={selectedExp}
              sessions={expSessions}
              onClose={!selectedExp.closed_at && selectedExp.correlation?.r !== null
                ? () => closeExperiment(selectedExp)
                : null}
            />
          )}
        </div>
      )}
    </div>
  );
}
