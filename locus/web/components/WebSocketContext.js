'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

const WsContext = createContext(null);

export function WebSocketProvider({ children }) {
  const [currentSession, setCurrentSession] = useState(null);
  const [latestCapture, setLatestCapture] = useState(null);
  const [experiments, setExperiments] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  const fetchInitialData = useCallback(async () => {
    try {
      const [sessionRes, expRes] = await Promise.all([
        fetch('/api/session/current'),
        fetch('/api/experiments'),
      ]);
      const { session } = await sessionRes.json();
      const { experiments: exps } = await expRes.json();
      if (session) setCurrentSession(session);
      if (exps) setExperiments(exps);
    } catch (e) {
      // Server not yet available — will retry via reconnect
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket('ws://localhost:3001/ws');
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      fetchInitialData();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'session_start':
            setCurrentSession(prev => ({
              ...(prev || {}),
              id: msg.session_id,
              started_at: Date.now(),
              ended_at: null,
              avg_focus: null,
              peak_focus: null,
              capture_count: 0,
              tags: [],
              ...msg.session,
            }));
            break;
          case 'session_end':
            setCurrentSession(prev => prev ? { ...prev, ended_at: Date.now() } : prev);
            break;
          case 'capture':
            setLatestCapture(msg.data);
            setCurrentSession(prev => {
              if (!prev || prev.id !== msg.data.session_id) return prev;
              const count = (prev.capture_count || 0) + 1;
              const prevTotal = (prev.avg_focus || msg.data.focus_score) * (count - 1);
              const avg = (prevTotal + msg.data.focus_score) / count;
              return {
                ...prev,
                avg_focus: Math.round(avg * 10) / 10,
                peak_focus: Math.max(prev.peak_focus || 0, msg.data.focus_score),
                capture_count: count,
                duration_seconds: prev.started_at ? Math.round((Date.now() - prev.started_at) / 1000) : 0,
              };
            });
            break;
          case 'experiments_updated':
            setExperiments(msg.experiments || []);
            break;
          case 'reset':
            setCurrentSession(null);
            setLatestCapture(null);
            setExperiments([]);
            break;
        }
      } catch (e) {
        console.error('WS message parse error', e);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }, [fetchInitialData]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return (
    <WsContext.Provider value={{ currentSession, setCurrentSession, latestCapture, experiments, setExperiments, connected }}>
      {children}
    </WsContext.Provider>
  );
}

export function useWs() {
  return useContext(WsContext);
}
