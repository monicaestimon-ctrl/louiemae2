"""Measures how far the camera moves in each frame of the phone film transitions.

    python3 scripts/measure-transition-pace.py [film ...]

The generated clay-to-colour shots (assets/phone-transitions/<film>.mp4) ease in and
out: the camera starts fast and slows to a stop. scripts/build-film-frames.mjs retimes
each one to a constant pace using these measurements, so it writes them to
assets/phone-transitions/pace.json as the cumulative camera travel at every frame.
Run it after adding or replacing a transition. Needs opencv-python-headless and numpy.
"""
import json, os, sys
import cv2, numpy as np

DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'phone-transitions')

def travel(path):
    cap, prev, out = cv2.VideoCapture(path), None, [0.0]
    while True:
        ok, frame = cap.read()
        if not ok: break
        g = cv2.cvtColor(cv2.resize(frame, (240, 320), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        if prev is not None:
            flow = cv2.calcOpticalFlowFarneback(prev, g, None, 0.5, 3, 21, 3, 5, 1.2, 0)
            out.append(out[-1] + float(np.median(np.linalg.norm(flow, axis=2))))
        prev = g
    return [round(v, 3) for v in out]

pace_path = os.path.join(DIR, 'pace.json')
pace = json.load(open(pace_path)) if os.path.exists(pace_path) else {}
films = sys.argv[1:] or sorted(f[:-4] for f in os.listdir(DIR) if f.endswith('.mp4'))
for film in films:
    pace[film] = travel(os.path.join(DIR, film + '.mp4'))
    print(f'{film}: {len(pace[film])} frames, travel {pace[film][-1]:.1f}')
json.dump(dict(sorted(pace.items())), open(pace_path, 'w'), indent=0)
