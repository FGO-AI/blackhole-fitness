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

## Account sync (optional)

Sign-in is **email + password**. An account is what makes the app remember anything: as a guest the app runs fully but persists nothing — reload and you start clean. To enable accounts on your own deployment:

1. Create a Supabase project.
2. Run [`supabase-schema.sql`](supabase-schema.sql) once in **SQL Editor**. It creates the `app_data` table (one JSONB row per user) and the Row Level Security policies that scope every read and write to `auth.uid()`.
3. In `index.html`, set the two constants near the top of the script block:

   ```js
   const SUPABASE_URL      = 'https://<your-project>.supabase.co';
   const SUPABASE_ANON_KEY = 'sb_publishable_…';
   ```

   Use the **publishable (anon)** key — it is designed to ship in client code, and RLS is what protects the data. Never put the secret/`service_role` key here; it bypasses RLS entirely.
4. Under **Authentication → Settings → Email**, turn **Confirm email** off — otherwise `signUp` returns no session and new accounts are stuck waiting on a verification mail the app has no flow for.
5. Under **Authentication → Settings → Password**, set the minimum length to **8** so it matches `MIN_PASSWORD` in `index.html`. Supabase defaults to 6; leaving them out of step means the form accepts passwords the server then rejects.
6. *(recommended)* Turn on CAPTCHA. Create a [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) site, paste the **secret** key into **Authentication → Attack Protection → CAPTCHA**, and put the **site** key into `TURNSTILE_SITE_KEY` in `index.html`. Both halves are required — the widget only renders once the site key is set, and Supabase only enforces it once the secret is set.

Leave the constants at their `YOUR_…` placeholders and the app stays in guest mode — `supa` is `null` and every sync path is skipped.

**Not built yet:** there is no password-reset flow. A user who forgets their password has to be reset from the Supabase dashboard. Adding one reintroduces an emailed redirect back into the app, which is when the redirect URL allow-list starts mattering again.

## Deploying with GitHub Pages

1. Push this repo to GitHub.
2. In the repo, go to **Settings → Pages**.
3. Under **Source**, pick your default branch (`main`) and the `/ (root)` folder. Double-check this — if it points at a feature branch, every push to `main` silently deploys nothing.
4. Save. Your app goes live at `https://<your-username>.github.io/<repo-name>/`.

Because the app is named `index.html`, GitHub Pages serves it automatically.

### Caching strategy, and the cache bump

`sw.js` splits its two jobs:

- **The document is network-first.** A navigation always tries the network, and only falls back to the cached copy of `index.html` when the fetch fails. A deploy therefore reaches people on their next load whether or not anyone bumped anything.
- **Everything else is cache-first** — icons, the manifest, the pinned CDN scripts. These are what make a cold offline load work, and none of them can strand you on an old app the way the document could.

Bumping the version on a commit that touches `index.html` is still worth doing, because `activate` deletes every cache whose key doesn't match and that's what clears superseded icons and stale CDN copies:

```js
const CACHE = 'bhf-v7';   // → 'bhf-v8', etc.
```

But it is now defense-in-depth for those secondary assets, not the app's only protection against staleness. This used to be the single point of failure: cache-first on the document meant a forgotten bump left every returning visitor on an old build permanently — which is exactly how two weeks of shipped work once went undelivered.

One transition note: a new `sw.js` only takes over after the browser has downloaded it, so the *first* load after any service-worker change still runs the previous worker's logic. The load after that gets the new behaviour.

## Tech

Plain HTML, CSS, and JavaScript in one file. The background uses [Three.js](https://threejs.org/) (loaded from a CDN) to run a custom GLSL fragment shader. Account sync uses [supabase-js](https://supabase.com/docs/reference/javascript) (also from a CDN). Everything else is vanilla — no framework, no bundler.

## Notes

- **Guests persist nothing.** Your plan, food log and workout history live in memory for the session and are gone on reload. That is deliberate: it means the app never leaves health data on a device belonging to someone who never asked it to.
- **Signing in is what makes data durable.** A signed-in user's data is written to their Supabase row and mirrored to a `localStorage` cache so the app boots instantly before the cloud pull resolves. It follows them to any device they sign into; "Clear my data" removes both copies.
- **Signing out wipes the local cache**, so the next person to use the device as a guest cannot read the previous user's data out of storage. Nothing is lost — it is still in the account.
- The background adapts its render quality to measured frame time across four tiers, and honours `prefers-reduced-motion` by rendering a single static frame.
- The black hole is a real-time approximation designed for phones and laptops, not a physically exact render.
