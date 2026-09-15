# parse-goal

Turns a sentence into the same structured profile fields the tap wizard fills
in. It is a parser, not a planner — `computePlan()` in `index.html` still does
every calculation, and the response is assembled field by field from a fixed
whitelist, so a calorie target or a workout name cannot reach the client even
if the model emits one.

The app has not been deployed against this yet. Until the steps below are done,
the free-text screen will fail its call and drop every user into the working
seven-step wizard with a short explanation — which is the designed behaviour,
not an outage.

## What you need

- The Supabase CLI, linked to project `kfoifswvyjppywyeurrq`.
- An Anthropic API key.

## 1. Run the schema

Paste `supabase-schema.sql` into the Supabase SQL Editor and run it. The whole
file is safe to re-run; the new part is at the bottom — `parse_goal_calls` and
`claim_parse_goal_call()`.

Check it took:

```sql
select proname, prosecdef from pg_proc where proname = 'claim_parse_goal_call';
-- expect one row with prosecdef = true
```

## 2. Set the secrets

```bash
supabase secrets set ANTHROPIC_API_KEY=<your key>
supabase secrets set ALLOWED_ORIGIN=https://fgo-ai.github.io
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected by the platform — do not
set those yourself.

`ALLOWED_ORIGIN` is the CORS allow-list. It is optional: unset, the function
falls back to the `SITE_ORIGIN` constant in `index.ts`, which is the real site.
It never falls back to `*`. Set it only when you need a different origin, such
as local testing.

## 3. Deploy

```bash
supabase functions deploy parse-goal
```

## 4. Check it end to end

Sign in to the live app, open Goal Analysis, and send one of the example chips.
You should land on the confirm screen with the fields pre-filled. Then check the
Supabase function logs for a `200`.

To exercise the rate limit, send eleven descriptions inside an hour — the
eleventh should come back `429` and the app should show the wizard saying so.

## Cost

One call per description, `claude-opus-5` at `effort: "low"`, capped at 2000
output tokens with a ~500 character input. The per-user cap is **10 calls an
hour**, enforced in Postgres (`claim_parse_goal_call`, a constant in the
function body — not a parameter the caller can raise). To change it, edit
`hourly_limit` in `supabase-schema.sql` and re-run the file.

Nothing else in the app calls a model. If you want a cheaper model here, that
is a one-line change to `model:` in `index.ts` — it was left on the default
rather than downgraded on your behalf.

## What is not wired

Server-side refusal `fallbacks` are not set. The documented structured-output
helper (`messages.parse`) and the beta `fallbacks` parameter are not documented
together, and guessing that binding risked a 400 on every request. A refusal is
instead detected explicitly (`stop_reason === "refusal"`) and returned as
`unusable`, which drops the user into the wizard — the same guaranteed path
every other failure uses. Worth revisiting if refusals ever show up in the logs;
for a fitness-goal parser they should be vanishingly rare.

## Shape of the response

```
200  { parsed: {...}, remaining: 7 }   parsed and validated
200  { blocked: true, message }        safety gate — fixed wording, no plan
200  { error: "unusable" }             nothing usable came back
400  { error: "input" }                empty or over 500 characters
401  { error: "auth" }                 no valid session
429  { error: "rate", resetAt }        per-user hourly cap
502  { error: "upstream" }             the model call failed
503  { error: "upstream" }             misconfigured (missing key or RPC)
```

The client treats every one of these except the first two as "show the wizard,
say why". See `INTAKE_FALLBACK` in `index.html`.
