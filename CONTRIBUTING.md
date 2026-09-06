# Contributing

## Tests live in the repo, or they do not exist

Every verification harness written for a change is committed to [`tests/`](tests/)
**as part of that same change** — not as a follow-up. A harness that lives only
in the session that wrote it protects nothing once that session is gone; that
has already happened once here, and 379 assertions had to be recovered from a
conversation transcript.

Concretely, a task is not done until:

1. Its harness is a file in `tests/`, named for what it covers (`xss.test.js`,
   `auth.test.js`, …), runnable on its own with `node tests/<name>.test.js`.
2. It exits non-zero on any failure and prints each thing it checked — never a
   silent pass.
3. `node tests/run.js` is green.

## Discipline the existing tests follow — keep it

- **Test the shipped source, not a copy of it.** Every harness reads the real
  `index.html` (or `sw.js`), extracts the inline script, and drives the actual
  functions under a stubbed DOM. Do not reimplement the logic under test inside
  the test.
- **Never depend on the day the test runs.** Anything date-sensitive uses a
  frozen clock — the sandbox's `Date` is replaced with a `FakeDate` fixed at
  Wed 17 Jun 2026, 14:30 local — and hand-computed expectations. A test that
  reads the live clock is a test that fails on a Monday, or in March.
- **Label what an assertion actually proves.** The DOM, WebGL, supabase-js and
  the service worker runtime are all mocked. An assertion that a string reached
  a mock is proof of *wiring*, not of behaviour, and its label must say so —
  e.g. `the real shader SOURCE reached ShaderMaterial (string check — not
  GL-compiled)`, never `the shader compiled`. Claiming a mock proved real
  behaviour is a known failure mode in this project, not a hypothetical one.
- **A green suite is not a deploy check.** It proves the logic is correct. It
  proves nothing about what GitHub Pages is serving. See "Tests" in
  [README.md](README.md) for the checks that do.

## When a test finds a bug while you are doing something else

Report it; do not fix it in the same commit. Verification changes and product
changes are reviewed differently, and a fix bundled into a "move the tests"
commit is the kind of incidental edit that once introduced an XSS sink.
