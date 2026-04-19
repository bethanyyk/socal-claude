'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWs } from './WebSocketContext';
import { useEffect, useState } from 'react';

function StreakDot({ active }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full mr-0.5"
      style={{ background: active ? '#BA7517' : 'rgba(0,0,0,0.12)' }}
    />
  );
}

export default function Nav() {
  const pathname = usePathname();
  const { connected } = useWs();
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then(({ daily }) => {
        if (!daily?.length) return;
        // Count consecutive days from today backwards with ≥1 session
        const today = new Date().toISOString().slice(0, 10);
        const dates = new Set(daily.map(d => d.date));
        let count = 0;
        const d = new Date(today);
        while (dates.has(d.toISOString().slice(0, 10))) {
          count++;
          d.setDate(d.getDate() - 1);
        }
        setStreak(count);
      })
      .catch(() => {});
  }, []);

  const tabs = [
    { href: '/history', label: 'history' },
    { href: '/session', label: 'session' },
    { href: '/experiments', label: 'experiments' },
  ];

  return (
    <nav
      style={{ borderBottom: '0.5px solid rgba(0,0,0,0.1)' }}
      className="bg-white px-6 flex items-center justify-between h-12 sticky top-0 z-50"
    >
      {/* Logo */}
      <span className="font-lora text-lg font-medium tracking-tight select-none" style={{ color: '#1A1917' }}>
        lo<span style={{ color: '#BA7517' }}>·</span>cus
      </span>

      {/* Tabs */}
      <div className="flex items-center gap-1">
        {tabs.map(({ href, label }) => {
          const active = pathname === href || (href === '/session' && pathname === '/');
          return (
            <Link
              key={href}
              href={href}
              className="px-3 py-1 rounded-component text-sm transition-colors"
              style={{
                fontFamily: '"DM Sans", sans-serif',
                color: active ? '#1A1917' : '#6B6A65',
                background: active ? '#F5F4F0' : 'transparent',
                fontWeight: active ? 500 : 400,
              }}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {/* Streak + connection status */}
      <div className="flex items-center gap-3">
        {streak > 0 && (
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(streak, 7) }).map((_, i) => (
              <StreakDot key={i} active />
            ))}
            <span className="text-xs ml-1" style={{ color: '#6B6A65', fontFamily: '"DM Mono", monospace' }}>
              {streak}d
            </span>
          </div>
        )}
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: connected ? '#1D9E75' : '#993C1D' }}
          title={connected ? 'Connected' : 'Disconnected'}
        />
      </div>
    </nav>
  );
}
