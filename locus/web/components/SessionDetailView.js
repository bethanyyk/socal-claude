'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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

function scoreColor(score) {
  if (score >= 70) return '#1D9E75';
  if (score >= 45) return '#BA7517';
  return '#993C1D';
}

function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatDuration(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
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

const COMMON_TAGS = ['coffee', 'exercise', 'good_sleep', 'late_screens', 'music', 'pomodoro', 'fasting', 'meditation'];

export default function SessionDetailView({ sessionId }) {
  const { experiments } = useWs();
  const [session, setSession] = useState(null);
  const [arc, setArc] = useState([]);
  const [moments, setMoments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    Promise.all([
      fetch(`/api/session/${sessionId}`).then(r => r.json()),
      fetch(`/api/session/${sessionId}/arc`).then(r => r.json()),
      fetch(`/api/session/${sessionId}/moments`).then(r => r.json()),
    ]).then(([{ session: s }, { arc: a }, { moments: m }]) => {
      setSession(s || null);
      setArc(a || []);
      setMoments(m || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return <div className="py-12 text-center text-sm" style={{ color: '#A09E99' }}>Loading…</div>;
  }
  if (!session) {
    return <div className="py-12 text-center text-sm" style={{ color: '#993C1D' }}>Session not found.</div>;
  }

  const score = session.avg_focus ? Math.round(session.avg_focus) : null;
  const tags = session.tags || [];
  const absentExpTags = session.absent_experiment_tags || [];

  const experimentStatuses = experiments.map(exp => ({
    exp,
    status: tags.includes(exp.tag) ? 'present' : absentExpTags.includes(exp.tag) ? 'absent' : 'not_tracked',
  }));
  const trackedExperiments = experimentStatuses.filter(e => e.status !== 'not_tracked');
  const nonExpTags = tags.filter(t => !experiments.some(e => e.tag === t) && COMMON_TAGS.includes(t));

  // Chart
  const arcLabels = arc.map(p => {
    const e = p.elapsed ?? (p.minute * 60);
    const m = Math.floor(e / 60);
    return m > 0 ? `${m}m` : `${e}s`;
  });
  const chartData = {
    labels: arcLabels,
    datasets: [{
      data: arc.map(p => p.avg_focus),
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
        min: 0, max: 100,
        grid: { color: 'rgba(0,0,0,0.04)' },
        ticks: { color: '#A09E99', font: { family: '"DM Mono", monospace', size: 11 }, stepSize: 25 },
        border: { display: false },
      },
    },
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/history" className="text-xs mb-5 inline-block hover:opacity-70 transition-opacity" style={{ color: '#A09E99' }}>
        ← Back to history
      </Link>

      {/* Session header */}
      <div className="card p-5 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-lora text-xl mb-0.5" style={{ color: '#1A1917' }}>
              {formatDate(session.started_at)}
            </p>
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
          <p className="text-xs mt-2" style={{ color: '#6B6A65' }}>
            Peak: <span style={{ fontFamily: '"DM Mono", monospace', color: '#1A1917' }}>{session.peak_focus}</span>
          </p>
        )}
      </div>

      {/* Focus arc */}
      {arc.length > 1 && (
        <div className="card p-4 mb-4">
          <p className="text-sm font-medium mb-3" style={{ color: '#1A1917' }}>Focus arc</p>
          <div style={{ height: '140px' }}>
            <Line data={chartData} options={chartOptions} />
          </div>
        </div>
      )}

      {/* Key moments */}
      {moments.length > 0 && (
        <div className="card p-4 mb-4">
          <p className="text-sm font-medium mb-1" style={{ color: '#1A1917' }}>Key moments</p>
          {moments.map((m, i) => <KeyMomentCard key={i} moment={m} />)}
        </div>
      )}

      {/* Experiment conditions */}
      {trackedExperiments.length > 0 && (
        <div className="card p-4 mb-4">
          <p className="text-sm font-medium mb-3" style={{ color: '#1A1917' }}>Experiment conditions</p>
          {trackedExperiments.map(({ exp, status }) => (
            <div
              key={exp.id}
              className="flex items-center justify-between py-2"
              style={{ borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}
            >
              <div>
                <p className="text-sm" style={{ color: '#1A1917' }}>{exp.name}</p>
                <p className="text-xs" style={{ color: '#A09E99' }}>{exp.tag.replace(/_/g, ' ')}</p>
              </div>
              <span
                className="text-xs font-medium px-2.5 py-1 rounded-full"
                style={{
                  background: status === 'present' ? '#D1F0E7' : '#F5F4F0',
                  color: status === 'present' ? '#1D9E75' : '#6B6A65',
                }}
              >
                {status === 'present' ? 'Present' : 'Absent'}
              </span>
            </div>
          ))}
          {experimentStatuses.filter(e => e.status === 'not_tracked').map(({ exp }) => (
            <div key={exp.id} className="flex items-center justify-between py-2" style={{ borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
              <div>
                <p className="text-sm" style={{ color: '#A09E99' }}>{exp.name}</p>
                <p className="text-xs" style={{ color: '#D4D2CE' }}>{exp.tag.replace(/_/g, ' ')}</p>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: '#F5F4F0', color: '#D4D2CE' }}>
                Not tracked
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Other conditions */}
      {nonExpTags.length > 0 && (
        <div className="card p-4">
          <p className="text-sm font-medium mb-3" style={{ color: '#1A1917' }}>Conditions</p>
          <div className="flex flex-wrap gap-2">
            {nonExpTags.map(tag => (
              <span key={tag} className="px-3 py-1 rounded-full text-xs font-medium" style={{ background: '#F5E6C8', color: '#BA7517' }}>
                {tag.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
