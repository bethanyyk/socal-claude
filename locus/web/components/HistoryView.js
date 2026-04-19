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
  const widthPct = Math.max(4, Math.min(100, duration / 36));

  return (
    <Link href={`/session/${session.id}`} className="group relative inline-block" style={{ width: `${widthPct}%`, minWidth: '28px', maxWidth: '120px' }}>
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
    <div className="py-3" style={{ borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
      <div className="flex items-center gap-4 mb-2">
        <span className="text-xs w-28 flex-shrink-0" style={{ color: '#6B6A65', fontFamily: '"DM Mono", monospace' }}>
          {label}
        </span>
        {avgScore !== null && (
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#F5F4F0', color: scoreColor(avgScore), fontFamily: '"DM Mono", monospace' }}>
            avg {avgScore}
          </span>
        )}
        {tags?.map(tag => (
          <span key={tag} className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#F5E6C8', color: '#BA7517' }}>
            {tag.replace(/_/g, ' ')}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1 flex-wrap ml-28">
        {sessions.map(s => <SessionSegment key={s.id} session={s} />)}
        {sessions.length === 0 && (
          <span className="text-xs" style={{ color: '#A09E99' }}>No sessions</span>
        )}
      </div>
    </div>
  );
}

function CalendarView({ sessions }) {
  const [selectedDate, setSelectedDate] = useState(null);

  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const days = [];
  for (let i = 34; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d);
  }

  const firstDow = days[0].getDay();
  const padded = [...Array(firstDow).fill(null), ...days];

  const byDate = {};
  for (const s of sessions) {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  }

  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

  const selectedSessions = selectedDate ? (byDate[selectedDate] || []) : [];
  const selectedLabel = selectedDate
    ? new Date(selectedDate + 'T12:00:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    : null;

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="text-center py-1 text-xs" style={{ color: '#A09E99' }}>{d}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 gap-1 mb-1">
          {week.map((day, di) => {
            if (!day) return <div key={di} />;
            const dateStr = day.toISOString().slice(0, 10);
            const daySessions = byDate[dateStr] || [];
            const avgScore = daySessions.length
              ? Math.round(daySessions.reduce((a, s) => a + (s.avg_focus || 0), 0) / daySessions.length)
              : null;
            const isToday = day.toDateString() === new Date().toDateString();
            const isSelected = dateStr === selectedDate;

            return (
              <button
                key={di}
                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                className="rounded-component flex flex-col items-center justify-center py-1.5 transition-all"
                style={{
                  background: isSelected ? '#1A1917' : avgScore !== null ? scoreColor(avgScore) + '22' : '#F5F4F0',
                  border: isToday && !isSelected ? '1.5px solid #BA7517' : '1.5px solid transparent',
                  minHeight: '48px',
                  cursor: daySessions.length > 0 ? 'pointer' : 'default',
                }}
              >
                <span className="text-xs leading-none mb-0.5" style={{ color: isSelected ? '#FFFFFF' : '#A09E99', fontFamily: '"DM Mono", monospace' }}>
                  {day.getDate()}
                </span>
                {avgScore !== null ? (
                  <span className="text-xs font-medium leading-none" style={{ color: isSelected ? '#FFFFFF' : scoreColor(avgScore), fontFamily: '"DM Mono", monospace' }}>
                    {avgScore}
                  </span>
                ) : (
                  <span className="text-xs leading-none" style={{ color: isSelected ? '#666' : '#D4D2CE' }}>·</span>
                )}
                {daySessions.length > 1 && (
                  <span className="text-xs leading-none mt-0.5" style={{ color: isSelected ? '#CCC' : '#A09E99' }}>×{daySessions.length}</span>
                )}
              </button>
            );
          })}
        </div>
      ))}

      {/* Day detail card */}
      {selectedDate && (
        <div className="mt-4 p-4 rounded-component" style={{ background: '#F5F4F0' }}>
          <p className="text-xs font-medium mb-3" style={{ color: '#6B6A65' }}>{selectedLabel}</p>
          {selectedSessions.length === 0 ? (
            <p className="text-xs" style={{ color: '#A09E99' }}>No sessions on this day.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedSessions.map(s => {
                const score = s.avg_focus ? Math.round(s.avg_focus) : 0;
                const duration = s.duration_seconds || 0;
                const widthPct = Math.max(4, Math.min(100, duration / 36));
                return (
                  <Link
                    key={s.id}
                    href={`/session/${s.id}`}
                    className="group relative inline-block"
                    style={{ width: `${widthPct}%`, minWidth: '60px', maxWidth: '140px' }}
                  >
                    <div
                      className="h-10 rounded-component flex items-center justify-center transition-opacity group-hover:opacity-80"
                      style={{ background: scoreColor(score), opacity: 0.9 }}
                    >
                      <span className="text-white text-sm font-medium" style={{ fontFamily: '"DM Mono", monospace' }}>
                        {score}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HistoryView() {
  const [daily, setDaily] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // 'list' | 'calendar'

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

  const sessionsByDate = {};
  for (const s of sessions) {
    if (!sessionsByDate[s.date]) sessionsByDate[s.date] = [];
    sessionsByDate[s.date].push(s);
  }

  const allDates = Array.from(new Set([
    ...daily.map(d => d.date),
    ...Object.keys(sessionsByDate),
  ])).sort((a, b) => b.localeCompare(a));

  const last38 = [...daily].slice(-38);
  const chartData = {
    labels: last38.map(d => {
      const dt = new Date(d.date + 'T12:00:00');
      return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }),
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
    return <div className="py-12 text-center text-sm" style={{ color: '#A09E99' }}>Loading history…</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-lora text-xl" style={{ color: '#1A1917' }}>History</h1>
        <div className="flex gap-1">
          {['list', 'calendar'].map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="px-3 py-1 rounded-full text-xs font-medium transition-all"
              style={{
                background: view === v ? '#1A1917' : '#F5F4F0',
                color: view === v ? '#FFFFFF' : '#6B6A65',
              }}
            >
              {v === 'list' ? 'List' : 'Calendar'}
            </button>
          ))}
        </div>
      </div>

      {/* Daily focus trend chart */}
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

      <div className="card p-4">
        {allDates.length === 0 ? (
          <p className="text-sm text-center py-8" style={{ color: '#A09E99' }}>
            No sessions yet. Start the tracker to begin.
          </p>
        ) : view === 'calendar' ? (
          <CalendarView sessions={sessions} />
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
