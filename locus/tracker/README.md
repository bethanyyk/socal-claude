# Locus Tracker

Background process that captures webcam images every 10 seconds, scores them with Claude, and posts results to the Locus server.

## Usage

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=your_key_here
python main.py
```

## Flags

### `--session-id <UUID>`
Manually specify a session UUID. By default a new UUID is generated at startup. Useful for resuming a named session or coordinating with external tooling.

```bash
python main.py --session-id 550e8400-e29b-41d4-a716-446655440000
```

### `--mock`
Run without a webcam or Claude API. Generates random but plausible focus scores so you can test the full web app without hardware.

```bash
python main.py --mock
```

Mock mode is useful for:
- Testing the UI and database before setting up the camera
- Demoing Locus to others
- CI / integration testing

## Session boundary detection

The tracker automatically detects session boundaries:

- **Session end**: If `focus_score < 20` for 3 consecutive captures (~30 seconds), the tracker posts `/api/session/end` and marks the session inactive.
- **Session resume**: If `focus_score >= 40` after a gap, the tracker generates a new session UUID and posts `/api/session/start`.

## Engagement signals

| Signal | Meaning |
|---|---|
| `deep_focus` | Deeply engaged — still, forward-leaning, eyes locked on screen |
| `active` | Attentive and productive — may be typing, moving naturally |
| `distracted` | Visibly off-task — looking away, restless, or slumped |
| `away` | Not at desk or head down, clearly disengaged or absent |

## Troubleshooting

- **Webcam not found**: Ensure no other app is using the camera. Try unplugging and re-plugging.
- **Claude API error**: Check that `ANTHROPIC_API_KEY` is set and valid.
- **Server connection refused**: Make sure the Locus server is running (`cd server && node index.js`).
