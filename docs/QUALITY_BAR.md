# The Grade A bar for cs-browser

A standing definition of "done" for this repo. It is deliberately **binary and evidence-based**:
every gate is either met or not, and you prove it by pasting command output, not by asserting
it. "It looks right to me" is not evidence.

Use this with the iteration protocol at the bottom. The protocol is capped at **three passes**
on purpose — a rubric with no ceiling burns unlimited effort chasing diminishing returns.

---

## The gates

Each gate has a name, a rule, and how you prove it.

### G1 — Syntax
`npm run check` passes for every file.
**Evidence:** paste the final line.

### G2 — No runtime errors
`npm run probe` exits 0 with `(no code errors)` and every existing behaviour assertion still
`true`.
**Evidence:** paste the `EXCEPTIONS` block and the count of assertions.

### G3 — No regressions
No behaviour assertion that was `true` before your change is `false` after it. A changed
assertion value is a regression until proven to be an intended improvement.
**Evidence:** name any assertion whose value changed, and why that is correct.

### G4 — Scope
You edited only the files you were told you own.
**Evidence:** paste `git status --short`.

### G5 — No per-frame allocation
Nothing on a path that runs every frame allocates: no object or array literals, no `new`, no
`.clone()`, no `.map()`/`.filter()`/`.slice()`, no template strings built per frame. Module-level
scratch objects mutated in place are the established pattern here — see `src/core/physics.js:16`
and `src/main.js` scratch vectors.
**Evidence:** name every function that runs per frame in your diff and state what it allocates
(the answer must be "nothing").

### G6 — No DOM churn
No `document.createElement` outside a constructor or a one-time build step. Elements are
created once and reused; visibility and text are toggled, never rebuilt.
**Evidence:** paste `grep -n "createElement" <your files>` and show each hit is in a
constructor or build method.

### G7 — Null-safe
Every `getElementById` result is guarded before use. A missing element must degrade silently,
never throw — an exception in a HUD update runs every frame and takes the game down.
**Evidence:** show the guard for each lookup.

### G8 — State resets
Any state you introduce is cleared on the transitions that should clear it: round reset,
player death, respawn. No indicator survives into a state where it is meaningless.
**Evidence:** name each piece of state and where it is reset.

### G9 — Root cause, not symptom
If your feature exposes an existing defect, you fix the defect at its source rather than
compensating for it downstream. Compensating code is a permanent tax on everyone who reads
the file afterwards.
**Evidence:** state the root cause you found and where you fixed it.

### G10 — Size and shape
Every file under ~300 lines, one concern per file, named exports, `const` by default,
comments explain *why* not *what*, and the file reads like its neighbours.
**Evidence:** paste `wc -l` for each file you touched or created.

### G11 — Proven by the harness
You added at least one probe assertion that would fail if your feature broke. A feature with
no assertion is a feature that will silently regress.
**Evidence:** paste the new assertion's output line.

### G12 — Honest limitations
You state plainly what you could **not** verify. This repo has shipped green-but-broken code
twice; a claim of "verified" that rests on `npm run check` alone is worse than no claim.
**Evidence:** a written list of what needs a human.

---

## The iteration protocol

**Pass 1 — Implement.** Build the feature. Run `npm run check` and `npm run probe`.

**Pass 2 — Self-audit.** Go through G1–G12 **in order**. For each, write the gate name, PASS or
FAIL, and the evidence. Do not summarise — paste the actual output. Then fix every FAIL.

**Pass 3 — Re-audit.** Repeat the audit on the fixed code.

**Then stop.** If any gate still fails after pass 3, do **not** keep iterating. Report:

- which gate fails
- what you tried
- what you believe the fix requires

Mark it `[!]` in `docs/PROGRESS.md` and hand it back. Three passes is the budget. A gate that
survives three honest attempts needs a human decision, not a fourth attempt.

**Report the final grade as a fraction**, e.g. `11/12 — G5 FAIL`. Do not round up, and do not
claim A unless all twelve pass. A truthful `11/12` is more useful than a false `12/12`; the
whole point of the bar is that the number can be trusted.
