# Blackhole Fitness

A single-file fitness web app with a real-time raytraced black hole as its living background. No build step, no dependencies to install, no server required — just open `index.html`.

## Features

- **Real-time black hole background** — a WebGL fragment shader raytraces a Schwarzschild black hole every frame: gravitational lensing that wraps the starfield around the shadow, a razor-thin Doppler-brightened accretion disk, a bright photon ring, a pure-black event horizon, plasma flares, and layered orbital motion. Scrolling corkscrews you inward; tapping tugs you closer.
- **Goal Analysis** — a six-step wizard that computes a personalized blueprint from your body and lifestyle: calorie target (Mifflin-St Jeor → TDEE), macro split, BMI, a 12-week projection, per-meal breakdown, and a balanced full-body training week (legs and cardio always included).
- **Workout Library** — 80+ sessions across four goals, each organized by specialized focus (upper body, lower body, cardio, etc.), with a full exercise arsenal of 240+ movements behind every session.
- **Calorie Tracker** — MyFitnessPal-style logging: a 160+ food database across 10 categories, adjustable servings, meal sections (breakfast/lunch/dinner/snack), recents, favorites, and custom foods.
- **Activity Log** — every completed workout and the calories burned.

## Running it

Open `index.html` in any modern browser. That's it.

For local development you can also serve it:

```bash
# Python
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying with GitHub Pages

1. Push this repo to GitHub.
2. In the repo, go to **Settings → Pages**.
3. Under **Source**, pick your default branch (`main`) and the `/ (root)` folder.
4. Save. Your app goes live at `https://<your-username>.github.io/<repo-name>/`.

Because the app is named `index.html`, GitHub Pages serves it automatically.

## Tech

Plain HTML, CSS, and JavaScript in one file. The background uses [Three.js](https://threejs.org/) (loaded from a CDN) to run a custom GLSL fragment shader. Everything else is vanilla — no framework, no bundler.

## Notes

- App state (your plan, food log, favorites) lives in memory for the session and resets on refresh. Persistence via `localStorage` is a natural next step.
- The black hole is a real-time approximation designed for phones and laptops, not a physically exact render.
