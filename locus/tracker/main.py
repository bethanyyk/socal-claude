#!/usr/bin/env python3
"""Locus attention tracker — captures webcam frames and scores focus via Claude."""

import argparse
import base64
import io
import json
import random
import sys
import time
import uuid
from datetime import datetime

import anthropic
import requests

try:
    import cv2
    OPENCV_AVAILABLE = True
except ImportError:
    OPENCV_AVAILABLE = False

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

CAPTURE_INTERVAL = 10  # seconds
SERVER_URL = "http://localhost:3001"
LOW_FOCUS_THRESHOLD = 20
LOW_FOCUS_CONSECUTIVE_LIMIT = 3
RESUME_THRESHOLD = 40

SYSTEM_PROMPT = """You are an attention and focus analyzer. You receive a webcam image of someone \
working at their computer. Analyze their posture, facial expression, body language, \
and any visible behavioral signals to estimate their current focus level.

Respond ONLY with a valid JSON object in this exact format, nothing else:
{
  "focus_score": <integer 0-100>,
  "posture_quality": <"upright"|"neutral"|"slumped">,
  "engagement_signal": <"deep_focus"|"active"|"distracted"|"away">,
  "confidence": <float 0.0-1.0>,
  "note": <one short phrase describing what you observed, max 8 words>
}

Scoring guide:
- 85-100: Upright, leaning forward slightly, still, eyes on screen
- 65-84: Generally attentive, minor fidgeting or neutral posture
- 40-64: Visible distraction, slumped, looking away, restless
- 0-39:  Not at desk, head down, clearly disengaged or absent"""


def capture_frame():
    """Capture a single frame from the default webcam."""
    if not OPENCV_AVAILABLE:
        raise RuntimeError("OpenCV not installed. Run: pip install opencv-python")
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Could not open webcam")
    try:
        ret, frame = cap.read()
        if not ret:
            raise RuntimeError("Failed to read frame from webcam")
        frame = cv2.resize(frame, (640, 480))
        return frame
    finally:
        cap.release()


def encode_frame_opencv(frame):
    """Encode OpenCV frame as base64 JPEG."""
    ret, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ret:
        raise RuntimeError("Failed to encode frame as JPEG")
    return base64.b64encode(buf.tobytes()).decode('utf-8')


def generate_mock_capture():
    """Generate a plausible random focus reading for testing without a webcam."""
    engagement_signals = ["deep_focus", "active", "distracted", "away"]
    posture_qualities = ["upright", "neutral", "slumped"]
    notes = [
        "leaning in, very still",
        "eyes on screen, good posture",
        "slight movement, attentive",
        "looking away briefly",
        "relaxed but engaged",
        "typing actively",
        "appears distracted",
        "head slightly bowed",
    ]

    # Generate a plausible score with some autocorrelation baked in via random walk
    score = random.randint(45, 95)
    if score >= 85:
        engagement = "deep_focus"
        posture = "upright"
    elif score >= 65:
        engagement = random.choice(["active", "deep_focus"])
        posture = random.choice(["upright", "neutral"])
    elif score >= 40:
        engagement = random.choice(["active", "distracted"])
        posture = random.choice(["neutral", "slumped"])
    else:
        engagement = random.choice(["distracted", "away"])
        posture = "slumped"

    return {
        "focus_score": score,
        "posture_quality": posture,
        "engagement_signal": engagement,
        "confidence": round(random.uniform(0.6, 0.95), 2),
        "note": random.choice(notes),
    }


def score_frame_claude(client, image_b64):
    """Send base64 image to Claude and parse the JSON focus score response."""
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=256,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": image_b64,
                        },
                    },
                    {"type": "text", "text": "Analyze this webcam image and return the JSON score."},
                ],
            }
        ],
    )
    text = message.content[0].text.strip()
    # Extract JSON in case there's extra whitespace or markdown fences
    if "```" in text:
        text = text.split("```")[1].lstrip("json").strip()
    return json.loads(text)


def post_capture(session_id, data):
    """POST capture data to the server."""
    payload = {
        "session_id": session_id,
        "focus_score": data["focus_score"],
        "posture_quality": data.get("posture_quality"),
        "engagement_signal": data.get("engagement_signal"),
        "confidence": data.get("confidence"),
        "note": data.get("note"),
        "timestamp": int(time.time() * 1000),
    }
    resp = requests.post(f"{SERVER_URL}/api/capture", json=payload, timeout=5)
    resp.raise_for_status()


def post_session_start(session_id):
    requests.post(f"{SERVER_URL}/api/session/start", json={"session_id": session_id}, timeout=5)


def post_session_end(session_id):
    requests.post(f"{SERVER_URL}/api/session/end", json={"session_id": session_id}, timeout=5)


def print_status(score_data):
    ts = datetime.now().strftime("%H:%M:%S")
    score = score_data.get("focus_score", "?")
    engagement = score_data.get("engagement_signal", "?")
    note = score_data.get("note", "")
    print(f"[{ts}] score={score} engagement={engagement} note={note}", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Locus attention tracker")
    parser.add_argument("--session-id", default=str(uuid.uuid4()), help="UUID for this session")
    parser.add_argument("--mock", action="store_true", help="Use mock data instead of webcam+Claude")
    args = parser.parse_args()

    session_id = args.session_id
    mock = args.mock

    client = None
    if not mock:
        client = anthropic.Anthropic()

    print(f"Locus tracker starting — session {session_id}", flush=True)
    if mock:
        print("Running in MOCK mode (no webcam or Claude API needed)", flush=True)

    # Signal session start
    try:
        post_session_start(session_id)
    except Exception as e:
        print(f"Warning: could not reach server to start session: {e}", flush=True)

    low_focus_streak = 0
    session_active = True

    while True:
        try:
            if mock:
                score_data = generate_mock_capture()
            else:
                frame = capture_frame()
                image_b64 = encode_frame_opencv(frame)
                score_data = score_frame_claude(client, image_b64)

            print_status(score_data)

            try:
                post_capture(session_id, score_data)
            except Exception as e:
                print(f"Warning: could not post capture: {e}", flush=True)

            focus_score = score_data.get("focus_score", 50)

            # Session boundary detection
            if focus_score < LOW_FOCUS_THRESHOLD:
                low_focus_streak += 1
                if low_focus_streak >= LOW_FOCUS_CONSECUTIVE_LIMIT and session_active:
                    print(f"Session ending — low focus for {low_focus_streak} consecutive captures", flush=True)
                    try:
                        post_session_end(session_id)
                    except Exception as e:
                        print(f"Warning: could not end session: {e}", flush=True)
                    session_active = False
            else:
                if focus_score >= RESUME_THRESHOLD and not session_active:
                    session_id = str(uuid.uuid4())
                    print(f"New session detected — session {session_id}", flush=True)
                    try:
                        post_session_start(session_id)
                    except Exception as e:
                        print(f"Warning: could not start new session: {e}", flush=True)
                    session_active = True
                low_focus_streak = 0

        except KeyboardInterrupt:
            print("\nTracker stopped by user.", flush=True)
            if session_active:
                try:
                    post_session_end(session_id)
                except Exception:
                    pass
            sys.exit(0)
        except Exception as e:
            print(f"Error in capture loop: {e}", flush=True)

        time.sleep(CAPTURE_INTERVAL)


if __name__ == "__main__":
    main()
