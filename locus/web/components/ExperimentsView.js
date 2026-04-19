'use client';

import { useState } from 'react';
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

function interpCorrelation(r, stats) {
  if (r === null) {
    if (stats) {
      if ((stats.sessions_with ?? 0) === 0) return 'No "present" sessions yet — mark this condition as present in a future session';
      if ((stats.sessions_without ?? 0) === 0) return 'No "absent" sessions yet — you need a control group to detect an effect';
    }
    return 'Need sessions on more days — keep logging';
  }
  const abs = Math.abs(r);
  if (abs < 0.2) return 'No clear signal yet — keep logging';
  if (abs < 0.4) return 'Weak signal emerging';
  if (abs < 0.6) return 'Moderate effect — worth paying attention to';
  return 'Strong signal — this habit genuinely matters for you';
}

function interpColor(r) {
  if (r === null) return '#A09E99';
  const abs = Math.abs(r);
  if (abs < 0.2) return '#A09E99';
  if (abs < 0.4) return '#BA7517';
  return '#1D9E75';
}

function ExperimentCard({ exp, selected, onClick }) {
  const r = exp.correlation?.r;
  const n = exp.correlation?.n || 0;
  const barWidth = r !== null ? Math.min(Math.abs(r) * 100, 100) : 0;

  return (
    <button
      onClick={onClick}
      className="w-full text-left card p-3 mb-2 transition-all hover:shadow-sm"
      style={{
        border: selected ? '1px solid #BA7517' : '0.5px solid rgba(0,0,0,0.1)',
        background: selected ? '#FFFDF8' : '#FFFFFF',
      }}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-sm font-medium" style={{ color: '#1A1917' }}>{exp.name}</p>
          <p className="text-xs mt-0.5" style={{ color: '#A09E99' }}>
            tag: <span style={{ fontFamily: '"DM Mono", monospace' }}>{exp.tag}</span>
          </p>
        </div>
        <div className="text-right">
          <span
            className="text-xs px-1.5 py-0.5 rounded"
            style={{
              background: '#F5F4F0',
              color: interpColor(r),
              fontFamily: '"DM Mono", monospace',
            }}
          >
            {r !== null ? `r=${r.toFixed(2)}` : 'n/a'}
          </span>
          <p className="text-xs mt-0.5" style={{ color: '#A09E99' }}>
            {exp.correlation?.sessions_with ?? 0}↑ · {exp.correlation?.sessions_without ?? 0}↓
          </p>
        </div>
      </div>
      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#F5F4F0' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${barWidth}%`, background: interpColor(r) }}
        />
      </div>
    </button>
  );
}

function CorrelationChart({ exp }) {
  const history = exp.correlation_history || exp.history || [];
  if (history.length < 2) {
    return (
      <div className="py-12 text-center text-sm" style={{ color: '#A09E99' }}>
        Need at least 2 tracked sessions (some present, some absent) to plot a trend.
      </div>
    );
  }

  const chartData = {
    labels: history.map(p => `S${p.session_index}`),
    datasets: [{
      label: 'Correlation r',
      data: history.map(p => p.r),
      borderColor: '#BA7517',
      tension: 0.3,
      borderWidth: 2,
      pointRadius: 2,
      pointBackgroundColor: '#BA7517',
    }],
  };
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#A09E99', font: { family: '"DM Mono", monospace', size: 10 }, maxTicksLimit: 8 },
        border: { display: false },
      },
      y: {
        min: -1, max: 1,
        grid: { color: 'rgba(0,0,0,0.04)' },
        ticks: { color: '#A09E99', font: { family: '"DM Mono", monospace', size: 10 }, stepSize: 0.5 },
        border: { display: false },
      },
    },
  };

  return (
    <div style={{ height: '200px' }}>
      <Line data={chartData} options={chartOptions} />
    </div>
  );
}

export default function ExperimentsView() {
  const { experiments, setExperiments } = useWs();
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', tag: '', description: '' });
  const [saving, setSaving] = useState(false);

  const selectedExp = experiments.find(e => e.id === selected) || experiments[0] || null;

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
      const { experiments: updated } = await res.json();
      if (updated) setExperiments(updated);
      setForm({ name: '', tag: '', description: '' });
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-lora text-xl" style={{ color: '#1A1917' }}>Experiments</h1>
          {experiments.length >= 3 && (
            <p className="text-xs mt-0.5" style={{ color: '#A09E99' }}>
              3-experiment limit reached — complete or delete one to add another.
            </p>
          )}
        </div>
        {experiments.length < 3 && (
          <button
            onClick={() => setShowForm(s => !s)}
            className="px-3 py-1.5 rounded-component text-sm font-medium transition-colors"
            style={{ background: '#BA7517', color: '#FFFFFF' }}
          >
            + New experiment
          </button>
        )}
      </div>

      {showForm && (
        <div className="card p-4 mb-4">
          <p className="text-sm font-medium mb-3" style={{ color: '#1A1917' }}>New experiment</p>
          <form onSubmit={createExperiment} className="space-y-2">
            <input
              className="w-full px-3 py-2 text-sm rounded-component surface outline-none"
              style={{ border: '0.5px solid rgba(0,0,0,0.15)', color: '#1A1917' }}
              placeholder="Name (e.g. 'Morning coffee')"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required
            />
            <input
              className="w-full px-3 py-2 text-sm rounded-component surface outline-none font-mono"
              style={{ border: '0.5px solid rgba(0,0,0,0.15)', color: '#1A1917' }}
              placeholder="Tag to track (e.g. 'coffee')"
              value={form.tag}
              onChange={e => setForm(f => ({ ...f, tag: e.target.value }))}
              required
            />
            <input
              className="w-full px-3 py-2 text-sm rounded-component surface outline-none"
              style={{ border: '0.5px solid rgba(0,0,0,0.15)', color: '#1A1917' }}
              placeholder="Description (optional)"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-1.5 text-sm rounded-component font-medium"
                style={{ background: '#BA7517', color: '#FFFFFF', opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Saving…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-1.5 text-sm rounded-component"
                style={{ background: '#F5F4F0', color: '#6B6A65' }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: experiment list */}
        <div>
          {experiments.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="text-sm" style={{ color: '#A09E99' }}>No experiments yet.</p>
              <p className="text-xs mt-1" style={{ color: '#A09E99' }}>
                Create one to start tracking how habits affect your focus.
              </p>
            </div>
          ) : (
            experiments.map(exp => (
              <ExperimentCard
                key={exp.id}
                exp={exp}
                selected={selected === exp.id || (!selected && exp === experiments[0])}
                onClick={() => setSelected(exp.id)}
              />
            ))
          )}
        </div>

        {/* Right: detail view */}
        {selectedExp && (
          <div className="card p-4">
            <div className="mb-4">
              <p className="font-lora text-lg" style={{ color: '#1A1917' }}>{selectedExp.name}</p>
              {selectedExp.description && (
                <p className="text-sm mt-0.5" style={{ color: '#6B6A65' }}>{selectedExp.description}</p>
              )}
            </div>

            <CorrelationChart exp={selectedExp} />

            <div className="mt-4 p-3 rounded-component surface">
              <p className="text-sm" style={{ color: interpColor(selectedExp.correlation?.r) }}>
                {interpCorrelation(selectedExp.correlation?.r, selectedExp.correlation)}
              </p>
              {selectedExp.correlation?.avg_with !== null && selectedExp.correlation?.avg_without !== null && (
                <div className="mt-2 grid grid-cols-2 gap-3 text-center">
                  <div>
                    <p className="text-xs" style={{ color: '#A09E99' }}>Present</p>
                    <p className="font-mono text-lg" style={{ color: '#1D9E75' }}>
                      {selectedExp.correlation.avg_with}
                    </p>
                    <p className="text-xs" style={{ color: '#A09E99' }}>
                      {selectedExp.correlation.sessions_with} days
                    </p>
                  </div>
                  <div>
                    <p className="text-xs" style={{ color: '#A09E99' }}>Absent</p>
                    <p className="font-mono text-lg" style={{ color: '#6B6A65' }}>
                      {selectedExp.correlation.avg_without}
                    </p>
                    <p className="text-xs" style={{ color: '#A09E99' }}>
                      {selectedExp.correlation.sessions_without} days
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
