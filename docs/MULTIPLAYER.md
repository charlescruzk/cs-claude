# Multiplayer

Opt-in, peer-to-peer-ish deathmatch over a dependency-free WebSocket relay. It is
**off by default**: with no room joined the game opens no socket, spawns no remote
players, and behaves exactly like the single-player build.

---

## Quick start

Two terminals, one machine (or one machine plus anyone who can reach it):

```bash
# 1. the relay
node scripts/relay.mjs          # listens on ws://localhost:8081
                                # health check: http://localhost:8081/health

# 2. the game
npm run serve                   # http://127.0.0.1:8080
```

Open the page, and on the **click-to-play** screen use the **Multiplayer** panel:

1. Type a name (16 chars) and a room code (8 chars, `A-Z0-9`), or press **New** for
   a random one. Both are remembered in `localStorage`.
2. Press **Join**. The status line reports what happened.
3. Click anywhere else on the overlay to lock the pointer and play.

Everyone who types the same room code lands in the same room (max 10). Leave with
the **Leave** button, or by closing the tab.

### Pointing at a different relay

`?relay=` overrides the default `ws://localhost:8081`:

```
http://127.0.0.1:8080/?relay=ws://192.168.1.50:8081
http://127.0.0.1:8080/?relay=192.168.1.50:8081        # bare host:port gets ws://
https://example.github.io/cs-browser/?relay=wss://relay.example.com
```

`http://` and `https://` forms are rewritten to `ws://` / `wss://`.

### Mixed content — the one that bites on GitHub Pages

An **https** page may not open a **ws://** socket; the browser blocks it, usually
with no useful error. Browsers exempt loopback (`ws://localhost`, `ws://127.0.0.1`)
as a trustworthy origin, so **a relay running on your own machine does work from
the live https site**. Any other host needs `wss://` behind real TLS.

`netClient.js` detects the https + non-loopback + `ws://` combination *before*
constructing the socket and reports it as a specific error in the panel rather than
letting the connection fail silently.

---

## Architecture

```
browser A                    node scripts/relay.mjs                 browser B
─────────                    ──────────────────────                 ─────────
main.js                        rooms: Map<code, Set<conn>>          main.js
  ├─ NetClient  ──── ws ────►  stamps {id}, forwards verbatim ──►   NetClient
  ├─ RemotePlayers             'hit' is routed to one peer          RemotePlayers
  └─ NetMenu                   validates nothing                    NetMenu
```

| File | Role |
| --- | --- |
| `scripts/relay.mjs` | RFC 6455 server written from scratch (no npm). Handshake, frame parser that buffers across TCP boundaries, rooms, id stamping, `hit` routing. |
| `src/net/protocol.js` | The shared wire vocabulary. Pure: no DOM, no Three.js, no imports. Pack/unpack, the flag bitfield, the tuning constants, wrap-safe angle lerp. |
| `src/net/netClient.js` | One socket, a 20 Hz send pump driven by the game's own `dt`, settable handlers. Nothing throws out of a socket callback. |
| `src/net/remotePlayers.js` | Peer meshes, the snapshot buffer and interpolation, and the `box`/`headBox`/`onHit` targets the local hitscan resolves against. |
| `src/hud/netMenu.js` | The join panel inside `#lock-overlay`. |
| `src/main.js` | Wires the four together and drives them from the frame loop. |

### Wire protocol

All JSON. Field names are one letter because state goes out 20 times a second.

```jsonc
// client -> server, once
{ "t": "join", "room": "ABCD", "name": "charles" }

// server -> the joiner
{ "t": "joined", "id": "a1b2c3d4", "room": "ABCD", "peers": [ { "id": "...", "name": "...", "team": "t" } ] }
{ "t": "team",  "team": "ct" }

// server -> the rest of the room
{ "t": "peer", "id": "...", "name": "...", "team": "t" }   // someone arrived
{ "t": "left", "id": "..." }                               // someone dropped

// client -> server -> other peers, 20 Hz
{ "t": "s", "p": [x, y, z], "y": yaw, "a": pitch, "f": flags, "id": "..." }
//   p rounded to 2 dp (1 cm), y/a to 3 dp. flags: 1 = crouching, 2 = dead.

// client -> server -> other peers, once per trigger pull (not per pellet)
{ "t": "shot", "o": [x, y, z], "d": [x, y, z], "w": "rifle", "id": "..." }

// client -> server -> ONE peer, routed by `to`
{ "t": "hit", "to": "<victim id>", "dmg": 34, "hs": false, "w": "rifle", "id": "..." }
```

The server stamps `id` on everything it forwards and **never echoes a message back
to its sender**.

### The clock

Snapshot timestamps are the **local receive time** (`Date.now()` at the moment the
message arrives). No timestamp is ever carried on the wire, and there is no
clock-sync handshake. If a sender's clock were trusted, a peer skewed by 200 ms
would sit permanently in the future or the past for everyone else, and no amount of
interpolation would fix it.

### Interpolation

Each remote player keeps a buffer of `{ t, pos, yaw, pitch, flags }`, capped at 20
entries and drained from the front (a backgrounded tab keeps receiving while its
rAF loop is throttled, so an uncapped buffer grows without bound).

Rendering happens at `now - 100 ms`: find the two snapshots bracketing that time and
lerp between them. 100 ms covers two missed 50 ms packets before anything is
visible, at the cost of seeing everyone a tenth of a second in the past.

Three details that are easy to get wrong, and how they are handled:

- **Buffer underrun** (render time is newer than the newest snapshot): **freeze** at
  the newest snapshot. No extrapolation, ever. Guessing where a silent player *would*
  be slides them through walls and leaves a phantom hit box where nobody is standing.
  For a shooter, a frozen-but-honest position beats a smooth lie.
- **Yaw wrap**: lerping raw yaw from `+3.10` to `-3.10` spins the model 355° the
  wrong way. `lerpAngle` takes the shortest signed delta,
  `d = ((to - from + π) mod 2π) - π`, folding the negative case back up by 2π first
  because JS `%` keeps the sign of the dividend.
- **Zero-length spans**: two snapshots stamped in the same millisecond would divide
  by zero; `alpha` is guarded and clamped.

### Local vs remote — three independent guards

Shooting yourself must be impossible, so it is prevented three times over:

1. The relay never sends a message back to the connection that sent it.
2. The client drops any message whose `id` equals its own (a future authoritative
   server might echo).
3. The local player is never inserted into `RemotePlayers`, so it is never rendered
   to itself and never appears in its own targets array.

### Hit boxes

A remote player's boxes are the bot's exactly — body `0.8 × 1.8 × 0.8` from the
feet, head `0.4³` on top — so a shot that would kill a bot-shaped silhouette kills a
peer standing in the same place. They are rewritten in place every frame, never
reallocated, and a removed peer's box goes with its mesh.

---

## Trust model — read this before you care about the result

**The relay is a dumb pipe. It validates nothing.**

Hit registration is entirely client-side and trust-based:

1. The **shooter's** client runs `resolveShot` locally against its own interpolated
   view of where the peers are.
2. On a hit it sends `{ t:'hit', to, dmg, hs, w }` to that one peer.
3. The **victim's** client applies it through `PlayerState.takeDamage`.

A remote player's `onHit` applies **no** damage locally — it only reports the hit up
so the message can be sent. Your health lives on your machine and nowhere else.

### What this means

This is **trivially cheatable**, and not by a determined attacker — by anyone who
opens devtools:

- A modified client can send `{ t:'hit', to:'<anyone>', dmg:1000, hs:true }` at will,
  with no shot fired and no line of sight. An aimbot needs no aim.
- A modified client can ignore every incoming `hit` and simply never lose health.
- Positions are self-reported: a client can send coordinates it is not at, or stop
  sending and stand still forever for everyone else (the interpolator freezes it).
- Because each shooter resolves against its own ~100 ms-delayed view of the world,
  two players can honestly disagree about whether a shot connected. There is no
  authority to break the tie and no lag compensation.

**Play this with people you know.** It is a party trick, not a competitive shooter.

### Why it is built this way

Fixing it requires an **authoritative server**: one that simulates movement, owns
every player's health, and does lag-compensated hit registration by rewinding the
world to what the shooter actually saw. That is a real game server — persistent
state, a fixed tick, and code that cannot live on GitHub Pages, which serves static
files and nothing else. The relay is the largest honest thing that fits inside "no
build step, no dependencies, static hosting".

The wire format is deliberately shaped so the upgrade is possible later: the client
already tolerates being echoed its own messages, and `hit` is already a directed
message rather than a broadcast, so an authoritative server could start validating
them without a protocol change.

---

## Failure modes and what you will see

| What happens | Behaviour |
| --- | --- |
| Relay not running | Red status line in the panel; the game keeps running single-player. Nothing throws. |
| https page + `ws://` non-loopback | A specific mixed-content error before any socket is opened. |
| Room full (10) | `error: room full` reported in the panel. |
| Connection drops mid-game | Every peer's mesh **and** hit box is removed — a stale box is a bullet sponge hanging in mid-air. Bots and the round loop carry on. |
| A peer stops sending | It freezes at its last known position. It is never auto-removed and never extrapolated. |
| A `state` arrives before its `peer` | A provisional body is created (named by id, CT colours); the later `peer` message fixes the name and team. |
| Someone opens the buy menu / loses pointer lock | Networking runs **outside** the pointer-lock gate, so they keep sending state and keep interpolating others. Pausing does not freeze you for everyone else. |

---

## Current limitations

Honest list of what is *not* wired up yet:

- **Teams are cosmetic.** The relay alternates `t`/`ct` as players arrive and peers
  are coloured accordingly, but the local player is always a T with CT bots, and
  there is no friendly fire check — you can shoot anyone.
- **The round loop is local.** Each client runs its own freeze/live/end timer and its
  own score. They are not synchronised, and a peer's death does not end your round.
- **Bots are local too.** Everyone sees their own squad; bots do not see or shoot
  peers, and peers do not appear in each other's bot AI.
- **Grenades are local.** Frag blast damage applies to bots only, never to peers.
- **No crouch model.** The `crouching` flag is transmitted and stored, but a crouched
  peer's mesh and hit box stay standing height — shrinking one without the other
  would make the model disagree with what you can shoot.
- **A peer's `shot` message is sent but not consumed.** The protocol carries it and
  `NetClient.onShot` is available, but nothing yet draws a tracer or plays a sound
  for someone else firing — you only see the damage you are told about.
- **No voice, no chat, no reconnect.** A dropped socket has to be re-joined by hand.

---

## Verification status — what is proven and what is not

**Proven, by `npm run relay:test` (13/13):** the RFC 6455 handshake; frame parsing with
masking; room join and normalisation; teams alternating; state relayed to peers and stamped
with the sender id; a sender never receiving its own state back; `hit` routed to one named
victim rather than broadcast; server-reserved message types (`joined`, `team`, `peer`) being
refused when they originate from a client; a repeated `join` leaking no room slot; and peers
being told about a disconnect with the room shrinking afterwards.

That test uses a hand-written WebSocket client rather than Node's global `WebSocket`. Node's
built-in client (undici) offers `permessage-deflate` and does not cope with this server
declining it, so it cannot connect. Browsers handle a declined extension correctly — this is
a limitation of Node's client, not of the relay.

**Proven, by `npm run probe`:** single-player is unchanged. Every P0/P1 behaviour assertion
is still true with multiplayer present but no room joined.

**NOT proven — needs a human with two real browsers:**

- That a browser completes the handshake against this relay. Headless Chrome in the
  development sandbox fails to open a `ws://localhost` socket even against a textbook-minimal
  server, so browser-side connection could not be verified here. The relay is correct per
  RFC 6455 and per the hand-written client; a real browser is the remaining unknown.
- Whether the live **https** GitHub Pages site can reach a `ws://localhost` relay. Browsers
  exempt loopback from mixed-content blocking, so it is expected to work, but confirm it
  rather than assume. Serving the game over `http://localhost` sidesteps the question
  entirely.
- Interpolation smoothness, the 100 ms delay feeling right, and hit registration landing
  where the shooter expects at real latency.

To test: run `npm run relay` in one terminal and `npm run serve` in another, then open
`http://127.0.0.1:8080` in two browser windows and join the same room code in both.
