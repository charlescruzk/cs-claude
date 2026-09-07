# FIX PROMPT 12 — cs-browser: make the damage direction actually readable

You are working in the `cs-browser` repo. Read `CLAUDE.md`, then read **`docs/QUALITY_BAR.md`**
in full before writing any code. Graded against those twelve gates, same three-pass protocol.

## Constraints

- **No build step. No npm install. No bundler. No new dependencies. No asset files.**
- Vanilla ES modules. `const` by default, `let` when reassigned, never `var`.
- Files under ~300 lines. Targeted edits only. **Never rewrite a working file.**
- **No subagents** — this is one file plus a probe assertion.
- Do NOT run any `git` command until the push block.

## Files you own

`src/hud/damageDirection.js`, `scripts/cs_probe.mjs`. Nothing else.

---

## What is wrong, precisely

The player cannot tell where incoming fire is coming from. **This is not a bug in the bearing
math — that part is correct and must not be changed.** It is a visual design failure, and the
spec that produced it was wrong.

Read the current constants at the top of `src/hud/damageDirection.js`:

```js
const RADIUS_FRACTION = 0.35;    // wedge sits 35% of the way centre → edge
const WEDGE = 40;                // px — wedge box size
const THICK = 8;                 // px — arc thickness (border width)
```

That renders a **40 × 40 pixel** element showing one 8-px arc segment, placed roughly a third
of the way from the centre of the screen. On a 1080p display that is a small red comma
floating near the middle of the view. It is nowhere near what Call of Duty, Battlefield or
Fortnite do.

**What those games actually do:** a large, soft red glow that bleeds inward from the *edge* of
the screen on the side the damage came from. It occupies a substantial arc of the border, it
is impossible to miss in peripheral vision, and it never obstructs the centre of the screen
where the player is aiming. That is the target.

### Do not touch the bearing math

`_onHit` computes:

```js
const angle = wrapPi(Math.atan2(p.fromX - c.pos.x, p.fromZ - c.pos.z) - c.yaw);
```

and `_place` positions with `sin(angle)` / `cos(angle)` and rotates by `Math.PI - angle`.
Those conventions agree with each other and with `_face()` in `src/bots/bot.js`: an attacker
directly ahead lands at the top of the screen, an attacker to the player's right lands on the
right. **Verify that for yourself before changing anything** — trace an attacker at
`(px + 1, pz)` with `yaw = 0` through both functions and confirm it resolves to the right-hand
side. If it does, keep the convention exactly as-is and change only the rendering. If your
trace disagrees, say so in your report with the arithmetic and stop rather than silently
flipping a sign.

---

## Task 1 — Replace the wedge with an edge glow

Keep the class, the event wiring, the pooling, the merge-by-bearing behaviour, the
`update(dt)` lifecycle and the reset-on-round-change logic. **Only the element's geometry,
CSS and placement change.**

### The approach

Instead of a small element positioned along a radius, use a **full-viewport-sized element,
centred, carrying a fixed gradient anchored at its own top edge, rotated about the centre by
the bearing.** Rotation moves the glow around the border; the gradient never has to be
recomputed, so a hit costs one `transform` write.

- Size each element `200vmax × 200vmax` and centre it with
  `left: 50%; top: 50%; transform: translate(-50%, -50%) rotate(<angle>rad)`. Oversizing past
  the viewport diagonal is what stops the corners showing as the element rotates.
- Background: a gradient whose hot edge sits at the element's **top**, fading to fully
  transparent well before the centre. Something of this shape —

  ```css
  background: radial-gradient(ellipse 60% 22% at 50% 0%,
                              rgba(255,40,40,0.55) 0%,
                              rgba(255,30,30,0.22) 45%,
                              rgba(255,0,0,0) 72%);
  ```

  Tune the stops so the glow reads clearly at the border and has **fully decayed by 55% of the
  way to the centre**. Verify that by reading your own gradient stops, not by eye.
- Rotate by the same value `_place` already computes for the old wedge, so an attacker ahead
  glows at the top of the screen and an attacker behind glows at the bottom.
- Keep `z-index: 6` and `pointer-events: none`.

### The readability guard — not optional

This is the same constraint that governs the near-death vignette in `src/hud/hud.js`, and for
the same reason. **The central 40% of the screen must stay completely clear.** A damage
indicator that obscures the target you are turning to shoot is a net loss no matter how
visible it is. State in your report how you verified the gradient has decayed to zero before
that radius.

Also cap the total: with four wedges live from four directions the screen must not go solid
red. Cap **combined** peak opacity at ~0.6 — either lower per-element opacity as more become
active, or clamp the sum.

### Scale with damage

A 12-damage pistol tap and a 60-damage burst should not look identical. Scale each element's
peak opacity by the hit's `damage`, mapping roughly 10 → 0.45 and 50+ → 1.0 of the element's
own maximum. The `hit` payload already carries `damage`.

**Done when:** taking fire from behind glows unmistakably along the bottom edge, from the left
along the left edge, and so on; the centre stays clear; four simultaneous directions do not
white out the screen; and the glow fades over the existing `DURATION`.

Commit: `fix: damage direction reads as an edge glow, not a small wedge`

---

## Task 2 — Prove the readability guard, per G11

Extend the existing `=== BEHAVIOR (damage feedback) ===` block. Keep every current assertion
passing and add:

- `glowIsEdgeAnchored` — an active element's computed size is at least the viewport's larger
  dimension (proving it is the oversized rotating element, not a small centred one)
- `centreStaysClear` — parse your gradient's final colour stop and assert its position is
  ≤ 55%, so the glow provably cannot reach the middle of the screen
- `opacityScalesWithDamage` — a 50-damage hit produces a higher element opacity than a
  10-damage hit from the same bearing
- `fourDirectionsCapped` — after four hits from four different bearings, the summed opacity of
  all active elements is ≤ 0.6

`centreStaysClear` is the important one: it turns the readability guard from a promise into a
check, the same way `oneHitPerBullet` turned the double-emit into a check.

Commit: `test: probe asserts the damage glow is edge-anchored and leaves the centre clear`

---

## End of run — verify and push

```bash
npm run check
npm run probe
git fetch origin
git push origin main
git rev-list --count origin/main..main     # must print 0
```

Plain fast-forward push. Do **not** use `--force`.

## What to report

1. The **final grade as a fraction**. Do not round up.
2. The **G1–G12 audit table** with pasted evidence.
3. **Your trace of the bearing convention** — attacker at `(px + 1, pz)`, `yaw = 0` — and
   whether it lands on the right-hand side. If it does not, the arithmetic, and no code change.
4. What needs a human by eye: whether the glow reads instantly in peripheral vision, and
   whether the centre genuinely stays clear while turning to fight back.

Stop at three passes whatever the result.
