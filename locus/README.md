# Locus — attention research tool

Track your focus in real time, discover patterns, and run personal experiments to learn what habits genuinely move the needle for you.

## Prerequisites

- Node.js 18+
- Python 3.9+
- A webcam (or use `--mock` mode for testing)
- Anthropic API key

## Setup

### 1. Server

```bash
cd server
npm install
node index.js
```

The server runs on **http://localhost:3001** and exposes a REST API + WebSocket endpoint.

### 2. Web app

```bash
cd web
npm install
npm run dev
```

Open **http://localhost:3000** — the interface updates in real time as captures come in.

### 3. Tracker

In a separate terminal:

```bash
cd tracker
pip install -r requirements.txt
export ANTHROPIC_API_KEY=your_key_here   # or set in your shell profile
python main.py
```

Sessions appear automatically when the tracker detects you at your desk.

#### Testing without a webcam (mock mode)

```bash
python main.py --mock
```

This generates realistic focus data without needing a camera or API key.

## How it works

1. **Tracker** captures a webcam frame every 10 seconds and sends it to Claude for focus scoring.
2. **Server** stores captures in SQLite (`~/.locus/locus.db`), computes session stats, and broadcasts updates via WebSocket.
3. **Web app** shows live focus arc charts, key moments, habit tagging, and long-term experiment correlations.

## Views

| Route | Description |
|---|---|
| `/session` | Live session view — arc chart, key moments, habit tags, experiments |
| `/history` | All-time focus trend + per-day session breakdown |
| `/experiments` | Create experiments, track habit→focus correlations over time |

## Experiment workflow

1. Go to `/experiments` → **+ New experiment**
2. Name it (e.g. "Morning coffee") and set the tag (`coffee`)
3. After each session, tag it on the `/session` page
4. As data accumulates, the correlation chart shows whether the habit correlates with higher/lower focus

## Architecture

```
tracker/main.py   →  POST /api/capture
                  →  POST /api/session/start|end

server/index.js   →  SQLite (via better-sqlite3)
                  →  WebSocket broadcasts

web/ (Next.js)    ←  WebSocket (live updates)
                  ←  REST API (initial load)
```
