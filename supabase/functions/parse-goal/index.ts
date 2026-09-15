/*
 * parse-goal — free-text intake for Goal Analysis.
 *
 * THE ONE RULE: this function is a PARSER, not a calculator. It turns a
 * sentence into the same structured profile fields the tap wizard produces,
 * and nothing else. computePlan() in index.html still does every calculation.
 * The model never emits calorie targets, macro grams, workout names or a
 * schedule — the response is assembled field by field from a fixed whitelist
 * below, so anything else the model invents cannot reach the client even if
 * it tries.
 *
 * The API key lives here because index.html ships to the browser: anything in
 * it is public. This function holds the key, requires a signed-in user, and
 * rate limits per user.
 *
 * Deploy:  supabase functions deploy parse-goal
 * Secrets: supabase secrets set ANTHROPIC_API_KEY=<your key>
 *          supabase secrets set ALLOWED_ORIGIN=https://fgo-ai.github.io
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";
import { z } from "npm:zod@3";

/* ── the contract ──────────────────────────────────────────────────────────
   These lists are the whole vocabulary. They mirror index.html exactly:
   GOALS, the day counts pageDays offers, EQUIP_LEVELS, EQUIP_VOCAB, the
   experience ids, and AVOID_VOCAB. A value outside them is dropped, never
   coerced into the nearest match — a wrong guess here silently builds the
   wrong plan, whereas a null just asks the user on the confirm screen. */
const GOALS = ["lose", "gain", "endure", "maintain"] as const;
const DAY_COUNTS = [3, 4, 5, 6] as const;
const EQUIP = ["none", "basic", "gym"] as const;
const EQUIP_DETAIL = [
  "none", "dumbbell", "barbell", "machine", "cardio-machine",
  "kettlebell", "bands", "pool", "bike", "specialty",
] as const;
const EXP = ["beginner", "intermediate", "advanced"] as const;
const AVOID = ["running", "jumping", "overhead", "heavy-spinal", "swimming"] as const;

/* Where the app actually lives. ALLOWED_ORIGIN overrides it for local work,
   but an unset secret must not silently open the endpoint to every site —
   a stolen token plus "*" is a working cross-origin call. */
const SITE_ORIGIN = "https://fgo-ai.github.io";

const MAX_TEXT = 500;
const MAX_UNPARSED = 5;
const MAX_SUMMARY = 240;

/* The model is asked for this shape. Everything is nullable because "the user
   did not say" is a real and common answer, and the confirm screen is built to
   show an unanswered field rather than a guessed one. */
const ParsedSchema = z.object({
  goal: z.enum(GOALS).nullable(),
  days: z.number().int().nullable(),
  equip: z.enum(EQUIP).nullable(),
  equipDetail: z.array(z.enum(EQUIP_DETAIL)),
  exp: z.enum(EXP).nullable(),
  trainingDays: z.array(z.number().int()).nullable(),
  avoid: z.array(z.enum(AVOID)),
  concern: z.boolean(),
  confidence: z.object({
    goal: z.number(), days: z.number(), equip: z.number(), exp: z.number(),
  }),
  unparsed: z.array(z.string()),
  summary: z.string(),
});

const SYSTEM = `You convert a person's description of their training goals into structured fields for a fitness app. You are a parser. You never plan, advise, or calculate.

Fill only these fields:

goal — "lose" (fat loss), "gain" (build muscle), "endure" (cardio/stamina/race training), "maintain" (stay fit, general health).
days — how many days a week they can train, as a number: 3, 4, 5 or 6. If they say a number outside that range, pick the nearest of 3/4/5/6 and lower your confidence. If they give no number, null.
equip — "none" (bodyweight only), "basic" (dumbbells, bands, kettlebell, home setup), "gym" (full gym, barbells, machines).
equipDetail — the specific kit they actually named, from: none, dumbbell, barbell, machine, cardio-machine, kettlebell, bands, pool, bike, specialty. Empty array if they named nothing specific. Do not infer a full gym's contents from the word "gym" — leave equipDetail empty and set equip to "gym".
exp — "beginner" (under a year), "intermediate" (1-3 years), "advanced" (3+ years).
trainingDays — if and only if they name specific weekdays, the day indices with Monday = 0 through Sunday = 6, sorted. Otherwise null. "three days a week" is a count, not specific days — that is the days field, and trainingDays stays null.
avoid — movement patterns they said they cannot or will not do, from: running, jumping, overhead, heavy-spinal, swimming. Map plainly: bad knees or shin splints or "no high impact" implies running and jumping; a bad back or a disc injury implies heavy-spinal; a shoulder problem implies overhead. Only include what their words actually support.
concern — true if the text suggests disordered eating or self-harm. Otherwise false.
confidence — 0.0 to 1.0 per field, for goal, days, equip and exp. Use a low value when you inferred rather than read. If a field is null, its confidence is 0.
unparsed — short plain-language phrases for anything meaningful you could NOT map to a field above: deadlines, race entries, target weights, body-part goals, medical conditions, anything else. This is how the app stays honest about what it ignored, so do not leave something out just because there was no field for it. At most ${MAX_UNPARSED} items.
summary — one sentence, under ${MAX_SUMMARY} characters, restating what you understood in plain language. No numbers you were not given. Never mention calories, macros or specific workouts.

Rules:
- Never output calorie targets, macronutrient amounts, workout names, exercise prescriptions or a weekly schedule. Those are computed by the app from a formula, not by you.
- A stated rate or deadline ("lose 30 lb by June", "cut to 1000 calories") goes in unparsed. It never changes goal, days, equip or exp.
- Do not fill a field the text does not support. Null is a correct, useful answer; a guess is not.`;

const CORS = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

/* Fixed in code, never model-generated, and never shown alongside a plan. */
const SUPPORT_MESSAGE =
  "Some of what you wrote sounds like it might be about more than training, " +
  "so this app is going to step back rather than hand you a number. That is " +
  "not a judgement, and nothing is wrong with you for it.\n\n" +
  "If you want to talk to someone, findahelpline.com lists free, confidential " +
  "services in most countries. In the US you can call or text 988. For eating " +
  "concerns specifically, NEDA is at 1-800-931-2237 and Beat (UK) is at " +
  "0808 801 0677.\n\n" +
  "The questionnaire is still here whenever you want it.";

/* A deterministic floor under the model's own `concern` flag. Either one
   firing is enough. This exists because a safety gate that only works when an
   LLM cooperates is not a safety gate — and the phrasing it catches is the
   kind that should never reach a calorie calculator. */
const CONCERN_PATTERNS: RegExp[] = [
  /\b(anorexi|bulimi|orthorexi)/i,
  /\b(purge|purging|binge and purge|make myself (throw up|sick)|self[- ]induced vomit)/i,
  /\b(starv(e|ing) myself|stop eating (completely|altogether)|not eat(ing)? at all)/i,
  /* "my body(?! fat)" so that "I hate my body fat percentage" — a body
     composition statement — is not treated as a crisis signal, while
     "punish myself" and "hate myself" still are */
  /\b(hate|disgusted by|punish) (my body(?!\s*fat)|myself|my self)\b/i,
  /\b(kill myself|end (it|my life)|suicid|self[- ]harm|hurt myself|cut myself)\b/i,
  /\b(don'?t want to (be here|live|exist))\b/i,
];

/* A stated intake is a rate claim, not a crisis signal on its own — only a very
   low one counts, so the threshold lives here as a number rather than as a
   pattern. It was briefly an entry in the array above that the loop skipped by
   index, which anyone appending a pattern would have silently disabled. */
const VERY_LOW_KCAL = 1000;

function concerningText(text: string): boolean {
  if (CONCERN_PATTERNS.some((re) => re.test(text))) return true;
  const m = text.match(/(\d{3,4})\s*(?:cal|calorie|kcal)s?\s*(?:a|per)\s*day/i);
  return !!m && Number(m[1]) < VERY_LOW_KCAL;
}

const json = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS(origin), "Content-Type": "application/json" },
  });

const oneOf = <T extends readonly string[]>(v: unknown, list: T): T[number] | null =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T[number]) : null;

const conf = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;

Deno.serve(async (req: Request) => {
  const origin = Deno.env.get("ALLOWED_ORIGIN") ?? SITE_ORIGIN;

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS(origin) });
  if (req.method !== "POST") return json({ error: "method" }, 405, origin);

  /* ── 1. a real signed-in user, or nothing ── */
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "auth" }, 401, origin);

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await supa.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "auth" }, 401, origin);

  /* ── 2. the input, before anything is spent on it ── */
  let text = "";
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text.trim() : "";
  } catch {
    return json({ error: "input" }, 400, origin);
  }
  if (!text || text.length > MAX_TEXT) return json({ error: "input" }, 400, origin);

  /* ── 3. the deterministic safety gate, before the paid call ──
     Checked here as well as on the model's own flag so that a crisis signal
     costs nothing and cannot be talked past. */
  if (concerningText(text)) {
    return json({ blocked: true, message: SUPPORT_MESSAGE }, 200, origin);
  }

  /* ── 4. configured at all? ──
     Checked before the quota is claimed, not after: a deploy missing its
     secret used to 503 while still spending one of the user's ten calls, so
     a misconfiguration quietly exhausted people's hour. */
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set");
    return json({ error: "upstream" }, 503, origin);
  }

  /* ── 5. rate limit — atomic, in Postgres, under the caller's own uid ── */
  const { data: claim, error: claimErr } = await supa.rpc("claim_parse_goal_call");
  if (claimErr) {
    console.error("rate limit rpc failed:", claimErr.message);
    return json({ error: "upstream" }, 503, origin);
  }
  const gate = Array.isArray(claim) ? claim[0] : claim;
  if (!gate?.allowed) {
    return json({ error: "rate", resetAt: gate?.reset_at ?? null }, 429, origin);
  }

  /* ── 6. the parse ── */
  let raw: z.infer<typeof ParsedSchema> | null = null;
  try {
    /* The client gives up at 20s (PARSE_TIMEOUT_MS). Bound this below that —
       9s x (1 retry + 1) = 18s worst case — so a slow call returns a 502 the
       client understands instead of being orphaned and billed for an answer
       no one is still waiting for. */
    const client = new Anthropic({ apiKey, timeout: 9_000, maxRetries: 1 });
    const res = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: text }],
      output_config: {
        effort: "low",                       /* a bounded extraction, not a hard problem */
        format: zodOutputFormat(ParsedSchema, "profile_fields"),
      },
    });
    /* A refusal is a successful HTTP 200 with no usable content — check it
       before reading anything. The client treats every non-parse outcome the
       same way: fall through to the wizard. */
    if (res.stop_reason === "refusal") {
      console.error("parse refused:", res.stop_details?.category ?? "unknown");
      return json({ error: "unusable" }, 200, origin);
    }
    raw = res.parsed_output ?? null;
  } catch (e) {
    /* message only — never the request body, which is the user's own words */
    console.error("anthropic call failed:", e instanceof Error ? e.message : "unknown");
    return json({ error: "upstream" }, 502, origin);
  }
  if (!raw) return json({ error: "unusable" }, 200, origin);

  /* ── 7. the model's flag, as a second chance at the same gate ── */
  if (raw.concern === true) {
    return json({ blocked: true, message: SUPPORT_MESSAGE }, 200, origin);
  }

  /* ── 8. rebuild the response from the whitelist ──
     Assembled field by field rather than passed through. This is what makes
     "the model never returns calories, macros, workouts or a schedule" a
     property of the code instead of a promise in a prompt: a field that is
     not constructed here does not exist in the response. */
  const days = typeof raw.days === "number" && (DAY_COUNTS as readonly number[]).includes(raw.days)
    ? raw.days : null;

  const trainingDays = Array.isArray(raw.trainingDays)
    ? [...new Set(raw.trainingDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
        .sort((a, b) => a - b)
    : null;

  const parsed = {
    goal: oneOf(raw.goal, GOALS),
    days,
    equip: oneOf(raw.equip, EQUIP),
    equipDetail: Array.isArray(raw.equipDetail)
      ? [...new Set(raw.equipDetail.filter((e) => (EQUIP_DETAIL as readonly string[]).includes(e)))]
      : [],
    exp: oneOf(raw.exp, EXP),
    /* a weekday list that does not match the day count is not usable as-is;
       drop it rather than hand the UI a half-answer it would have to repair */
    trainingDays: trainingDays && days && trainingDays.length === days ? trainingDays : null,
    avoid: Array.isArray(raw.avoid)
      ? [...new Set(raw.avoid.filter((a) => (AVOID as readonly string[]).includes(a)))]
      : [],
    confidence: {
      goal: conf(raw.confidence?.goal),
      days: conf(raw.confidence?.days),
      equip: conf(raw.confidence?.equip),
      exp: conf(raw.confidence?.exp),
    },
    unparsed: Array.isArray(raw.unparsed)
      ? raw.unparsed
          .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
          .slice(0, MAX_UNPARSED)
          .map((u) => u.trim().slice(0, 160))
      : [],
    summary: typeof raw.summary === "string" ? raw.summary.trim().slice(0, MAX_SUMMARY) : "",
  };

  /* A null field must not carry confidence — the UI leaves anything under its
     threshold unselected, and a confident null would defeat that. */
  if (!parsed.goal) parsed.confidence.goal = 0;
  if (!parsed.days) parsed.confidence.days = 0;
  if (!parsed.equip) parsed.confidence.equip = 0;
  if (!parsed.exp) parsed.confidence.exp = 0;

  const anything = parsed.goal || parsed.days || parsed.equip || parsed.exp
    || parsed.avoid.length || parsed.equipDetail.length;
  if (!anything) return json({ error: "unusable", summary: parsed.summary }, 200, origin);

  return json({ parsed, remaining: gate.remaining ?? null }, 200, origin);
});
