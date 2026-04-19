'use client';

import { useEffect, useState } from 'react';
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
import Link from 'next/link';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

function scoreColor(score) {
  if (score >= 70) return '#1D9E75';
  if (score >= 45) return '#BA7517';
  return '#993C1D';
}

function formatDuration(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function SessionSegment({ session }) {
  const score = session.avg_focus ? Math.round(session.avg_focus) : 0;
  const duration = session.duration_seconds || 0;
  const widthPct = Math.max(4, Math.min(100, duration / 36)); // scale: 1hr = 100%

  return (
    <Link href={`/session`} className="group relative inline-block" style={{ width: `${widthPct}%`, minWidth: '28px', maxWidth: '120px' }}>
      <div
        className="h-8 rounded-component flex items-center justify-center transition-opacity group-hover:opacity-80"
        style={{ background: scoreColor(score), opacity: 0.85 }}
        title={`Score: ${score} · ${formatDuration(duration)}`}
      >
        <span className="text-white text-xs font-medium" style={{ fontFamily: '"DM Mono", monospace' }}>
          {score}
        </span>
      </div>
    </Link>
  );
}

function DayRow({ date, sessions, tags }) {
  const avgScore = sessions.length
    ? Math.round(sessions.reduce((a, s) => a + (s.avg_focus || 0), 0) / sessions.length)
    : null;

  const label = new Date(date + 'T12:00:00').toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric'
  });

  return (
    <div
      className="py-3"
      style={{ borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}
    >
      <div className="flex items-center gap-4 mb-2">
        <span className="text-xs w-28 flex-shrink-0" style={{ color: '#6B6A65', fontFamily: '"DM Mono", monospace' }}>
          {label}
        </span>
        {avgScore !== null && (
          <span
            className="text-xs px-1.5 py-0.5 rounded"
            style={{
              background: '#F5F4F0',
              color: scoreColor(avgScore),
              fontFamily: '"DM Mono", monospace',
            }}
          >
            avg {avgScore}
          </span>
        )}
        {tags?.map(tag => (
          <span
            key={tag}
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: '#F5E6C8', color: '#BA7517' }}
          >
            {tag.replace(/_/g, ' ')}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1 flex-wrap ml-28">
        {sessions.map(s => (
          <SessionSegment key={s.id} session={s} />
        ))}
        {sessions.length === 0 && (
          <span className="text-xs" style={{ color: '#A09E99' }}>No sessions</span>
        )}
      </div>
    </div>
  );
}

export default function HistoryView() {
  const [daily, setDaily] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then(({ daily: d, sessions: s }) => {
        setDaily(d || []);
        setSessions(s || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Group sessions by date
  const sessionsByDate = {};
  for (const s of sessions) {
    if (!sessionsByDate[s.date]) sessionsByDate[s.date] = [];
    sessionsByDate[s.date].push(s);
  }

  // All days (union of daily + sessions)
  const allDates = Array.from(new Set([
    ...daily.map(d => d.date),
    ...Object.keys(sessionsByDate),
  ])).sort((a, b) => b.localeCompare(a));

  // Chart data — last 38 days
  const last38 = [...daily].slice(-38);
  const chartLabels = last38.map(d => {
    const dt = new Date(d.date + 'T12:00:00');
    return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  });
  const chartData = {
    labels: chartLabels,
    datasets: [{
      label: 'Daily avg focus',
      data: last38.map(d => d.avg_focus),
      borderColor: '#BA7517',
      backgroundColor: 'rgba(186,117,23,0.07)',
      fill: true,
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
    }],
  };
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#A09E99', font: { family: '"DM Mono", monospace', size: 10 }, maxTicksLimit: 7 },
        border: { display: false },
      },
      y: {
        min: 0, max: 100,
        grid: { color: 'rgba(0,0,0,0.04)' },
        ticks: { color: '#A09E99', font: { family: '"DM Mono", monospace', size: 10 }, stepSize: 25 },
        border: { display: false },
      },
    },
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-sm" style={{ color: '#A09E99' }}>Loading history…</div>
    );
  }

  return (
    <div>
      <h1 className="font-lora text-xl mb-4" style={{ color: '#1A1917' }}>History</h1>

      {/* Daily focus chart */}
      {last38.length > 1 && (
        <div className="card p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium" style={{ color: '#1A1917' }}>Daily focus trend</p>
            <span className="text-xs" style={{ color: '#A09E99' }}>{last38.length} days</span>
          </div>
          <div style={{ height: '200px' }}>
            <Line data={chartData} options={chartOptions} />
          </div>
        </div>
      )}

      {/* Session feed */}
      <div className="card p-4">
        {allDates.length === 0 ? (
          <p className="text-sm text-center py-8" style={{ color: '#A09E99' }}>
            No sessions yet. Start the tracker to begin.
          </p>
        ) : (
          allDates.map(date => {
            const daySessions = sessionsByDate[date] || [];
            const dayData = daily.find(d => d.date === date);
            return (
              <DayRow
                key={date}
                date={date}
                sessions={daySessions}
                tags={dayData?.tags || []}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
