# Roadmap

The goal is a browser game that *feels* like Counter-Strike 1.6: fast movement, hitscan
weapons with recoil, round-based T vs CT play, buy phases, a bomb objective. We get there
in phases. Each phase is playable on its own and never depends on unfinished work from a
later phase.

## P0 — "It's a shooter" (single-player vs bots, one map)

Playable in a browser with zero install. One blockout map, one player, a handful of bots,
two weapons, round loop, HUD. Detailed task list: `docs/P0_SPEC.md`.

Done when a person can open the page, run around dust-style geometry, shoot bots, get
shot, and see rounds start and end with a winner.

Non-goals for P0: multiplayer, real textures, sounds, buy menu, bomb, grenades, models.

## P1 — "It's Counter-Strike" (game systems)

- Buy menu (B) with money, kill rewards, round-loss bonus, real CS 1.6 weapon prices
- Full weapon roster tiering: pistols (USP, Glock, Deagle), rifles (AK-47, M4A1), AWP,
  shotgun, SMG; per-weapon recoil patterns and spread tables approximating 1.6 feel
- Bomb objective: plant at A/B, defuse, kit, timer, explosion win condition
- Grenades: HE, flash, smoke (particle sprites)
- Armor + helmet, damage falloff, headshot multiplier, hitboxes (head/body/legs)
- Sound: footsteps, gunshots, reload, radio-style round announcements (original audio)
- Proper map: full de_dust2-inspired layout with lighting, simple texture atlas
- Bot improvements: navmesh/waypoint graph, cover, objective awareness

## P2 — "Play with friends" (networking)

- Authoritative Node.js server (WebSocket), 20-tick snapshot + client-side prediction
- Lag compensation for hitscan (server rewinds hitboxes)
- Lobby, server browser, team select, scoreboard sync
- Bots fill empty slots server-side

## P3 — "Polish and ship"

- Persistent stats, settings menu (sensitivity, FOV, keybinds, crosshair)
- Second map (aztec/inferno-inspired), map voting
- Spectator mode, demo recording (input replay)
- Performance: instancing, LOD, mobile fallback investigation
- Accessibility and localization pass

## Guiding principles

1. Playable at the end of every task, not just every phase.
2. Vanilla ES modules, no build step, until P2 forces a server package.
3. Data over code: maps, weapons, bots are plain JS objects in `src/**/data*.js`.
4. Original assets only. "Inspired by," never copied from, Valve's game.
