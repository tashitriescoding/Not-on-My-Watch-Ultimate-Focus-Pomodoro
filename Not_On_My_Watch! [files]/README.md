# Not on my watch

A study timer that only runs while you're in view of your laptop camera.

## Files
- `index.html` – page structure
- `styles.css` – layout, light/dark theme, flashing alarm overlay
- `app.js` – camera, presence detection, timer state machine, alarm sound, banned items
- `package.json` – optional, for the `npm start` shortcut

## Run it
Camera access needs `localhost` or HTTPS, so serve the folder instead of opening the file directly:

    python -m http.server 8000      # then open http://localhost:8000
    # or
    npm start

No build step and no dependencies.

## How it works (app.js)
- **Presence:** each 500 ms a 96x72 frame is sampled. Uses the browser `FaceDetector` API when available, otherwise a skin-tone pixel ratio (`skinRatio`).
- **State machine** (`S.mode`): `idle`, `studying`, `alert`, `longbreak`, `break`, `paused`, `ready`. `tick()` runs every 250 ms and advances time only in `studying`.
- **Alarm:** leaves view longer than the grace period -> `alert` + flashing overlay + WebAudio square-wave alarm. Away longer than "Long break after" -> `longbreak`, resumes on return.
- **Pomodoro:** a round completes after N minutes of *actual* study time, then a 5-minute break starts.
- **Banned items:** `capBtn` stores the dominant hue of the dashed box. `sample()` counts frame pixels near that hue; over 2% of the frame for 8 s triggers an alert.

## Background use
- **Web Worker ticker:** `tick()` and `poll()` are driven by a worker timer, so they keep running when the tab is hidden. Falls back to `setInterval` if workers are blocked.
- **Floating timer:** the *Float timer* button opens an always-on-top Document Picture-in-Picture window (Chrome/Edge 116+) showing the clock and status. It flashes yellow/red on distraction and has an *I'm back* button.
- **Notifications:** permission is requested on Start. Distraction, round-complete and break-over events send a desktop notification.
- Keep the camera tab open (it can be in a background tab or its own window, but don't close it).

## Tuning
- Presence sensitivity: threshold `0.03` in `sample()`.
- Item sensitivity: `0.02` in `sample()`, 8000 ms in `tick()`, hue tolerance `tol:18` in the capture handler.

## Known limits
Colour-based item matching is crude. For real object detection (e.g. phone), add TensorFlow.js + COCO-SSD and bundle the model locally.