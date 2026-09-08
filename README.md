# Blackhole Fitness

A single-file fitness web app with a real-time ray-traced black hole as its living background.

## Features

- **Real-time black hole background** — a WebGL fragment shader ray-traces a Schwarzschild black hole every frame: gravitational lensing that wraps the starfield around the shadow, a razor-thin Doppler-brightened accretion disk, a bright photon ring, a pure-black event horizon, plasma flares, and layered orbital motion. Scrolling corkscrews you inward; tapping tugs you closer.
- **Goal Analysis** — a six-step wizard that computes a personalized blueprint from your body and lifestyle: calorie target (Mifflin-St Jeor → TDEE), macro split, BMI, a 12-week projection, per-meal breakdown, and a balanced full-body training week (legs and cardio always included).
- **Workout Library** — 80+ sessions across four goals, each organized by specialized focus (upper body, lower body, cardio, etc.), with a full exercise arsenal of 240+ movements behind every session.
- **Calorie Tracker** — MyFitnessPal-style logging: a 160+ food database across 10 categories, adjustable servings, meal sections (breakfast/lunch/dinner/snack), recents, favorites, and custom foods.
- **Activity Log** — every completed workout and the calories burned.
- **Guests persist nothing.** Your plan, food log, and workout history live in memory for the session and are gone on reload. That is deliberate: it means the app never leaves health data on a device belonging to someone who never asked it to.
- **Signing in is what makes data durable.** A signed-in user's data is written to their Supabase row and mirrored to a `localStorage` cache so the app boots instantly before the cloud pull resolves. It follows them to any device they sign into; "Clear my data" removes both copies.
- **Signing out wipes the local cache**, so the next person to use the device as a guest cannot read the previous user's data out of storage. Nothing is lost — it is still in the account.
- **Targets adapt to you.** The formula (Mifflin-St Jeor × activity) is only the opening guess. Once about two weeks of weigh-ins and food logs overlap, the app infers your real daily expenditure from logged intake against your smoothed weight trend and moves the target toward it — weekly, at most 150 kcal a step, never more than 500 kcal from the formula, never below the 1,300 kcal floor, and never without saying what changed and why. You can decline and stay on the formula.
- **Weight is shown as a trend, not a reading.** The line is a rolling weighted average of your weigh-ins; the dots are what the scale said. Daily scale weight moves 1–2 kg on water and sodium alone, which is why the raw number is not the headline.
- **Net calories is off by default.** Adding today's training burn to the target is opt-in, because burn figures are estimates and eating them all back is a common way to stall. A measured target already absorbs average training, so the two together can double-count.
- **Macros can be set in grams** on the plan page. Calories follow the grams, the percentage split is shown alongside, and one tap resets to the recommendation.
- The background adapts its render quality to measured frame time across five tiers. It learns the display's real refresh interval rather than assuming 60 Hz, picks a starting tier from the device profile before the first frame, probes upward when it is pinned at vsync and retreats with a growing cooldown if that drops frames — so it can recover from a bad start as well as step down. `__bhPerf()` in the console reports the live tier and frame time. It honours `prefers-reduced-motion` by rendering a single static frame.
- The black hole is a real-time approximation designed for phones and laptops, not a physically exact render.
