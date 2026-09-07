// Dev-only verification probe (NOT imported by the game — no build step, no runtime
// dependency). Starts a static server, loads index.html in headless Chrome over the
// DevTools Protocol, clicks "Click to play", and dumps the post-click state:
// console logs, uncaught exceptions, and the on-screen #boot-status text. Use it when
// the Bash/command classifier (or a browser) is not available to you.
//
//   node scripts/cs_probe.mjs
//
// Needs: Node >= 21 (global WebSocket/fetch), a Chrome at the path below, and python3.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8080;
const CDP = 9333;
// A per-run cache-buster so a stale index.html isn't served from Chrome's disk cache.
const URL = `http://127.0.0.1:${PORT}/index.html?cb=${Date.now()}`;

async function main() {
   // 1) static server
   const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
     cwd: ROOT, stdio: 'ignore',
     });

     // 2) headless chrome with a remote-debugging port
   const chrome = spawn(CHROME, [
     '--headless', `--remote-debugging-port=${CDP}`,
     '--no-sandbox', '--disable-dev-shm-usage',
     // Software WebGL via SwiftShader so the renderer can boot with no GPU.
     '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
     '--ignore-gpu-blocklist',
     'about:blank',
     ], { stdio: 'ignore' });

   const jget = async (path, tries = 60) => {
     for (let i = 0; i < tries; i++) {
       try {
         const r = await fetch(`http://127.0.0.1:${CDP}${path}`);
         return await r.json();
        } catch { await sleep(200); }
       }
     return null;
     };

   const ver = await jget('/json/version');
   if (!ver) throw new Error('Chrome DevTools endpoint never came up (Chrome installed?)');

   // Chrome 111+ requires PUT for /json/new (a GET now returns a non-JSON warning).
   const target = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
   const ws = new WebSocket(target.webSocketDebuggerUrl);
   await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

   let id = 0;
   const pending = new Map();
   const logs = [];
   const errors = [];
   ws.onmessage = (ev) => {
     const m = JSON.parse(ev.data);
     if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
     if (m.method === 'Runtime.consoleAPICalled') {
       const txt = m.params.args.map((a) => a.value ?? a.description ?? a.type ?? '').join(' ');
       logs.push(`[console.${m.params.type}] ${txt}`);
       } else if (m.method === 'Runtime.exceptionThrown') {
       const d = m.params.exceptionDetails;
       const st = d.stackTrace ? d.stackTrace.callFrames.map((f) => `${f.url}:${f.lineNumber}:${f.columnNumber}`).join('\n  at ') : '';
       errors.push('EXCEPTION: ' + (d.exception?.description || d.exception?.value || d.text) + ` [url=${d.url || '?'} line=${d.lineNumber ?? '?'}]` + (st ? '\n  at ' + st : ''));
       } else if (m.method === 'Log.entryAdded') {
       logs.push(`[log:${m.params.entry.level}] ${m.params.entry.text}`);
       }
    };
   const send = (method, params = {}) => new Promise((res) => {
     const mid = ++id; pending.set(mid, res);
     ws.send(JSON.stringify({ id: mid, method, params }));
    });

   await send('Runtime.enable');
   await send('Log.enable');
   await send('Page.enable');
   // The ?cb param busts index.html's cache, but the module imports it pulls in
   // (/src/...) are separate requests. Headless Chrome without a --user-data-dir
   // can still serve those from a persistent HTTP cache, which shows up as a
   // stale module (e.g. a settingsMenu.js without the render-scale controls).
   // Disable the cache for the whole session so every module loads from disk.
   await send('Network.enable');
   await send('Network.setCacheDisabled', { cacheDisabled: true });
     // Headless Chrome has no real pointer, so requestPointerLock() throws
     // WrongDocumentError and input.locked never becomes true — the combat loop
     // (gated on it) would never run. Stub pointer lock so the click-to-lock path
     // "succeeds" and the full runtime is exercised on this GPU-less run.
   await send('Page.addScriptToEvaluateOnNewDocument', { source: [
     "document._plEl = null;",
     "Object.defineProperty(document, 'pointerLockElement', { configurable: true, get() { return document._plEl; } });",
     "const _rq = function () { document._plEl = this; document.dispatchEvent(new Event('pointerlockchange')); };",
     "const _ex = function () { document._plEl = null; document.dispatchEvent(new Event('pointerlockchange')); };",
     // requestPointerLock is an Element method; exitPointerLock is a Document method.
     // Stubbing the latter onto Element lets a wrong call site pass the probe.
     "for (const P of [Element.prototype, HTMLElement.prototype]) { P.requestPointerLock = _rq; }",
     "Document.prototype.exitPointerLock = _ex;",
       ].join('\n') });
   await send('Page.navigate', { url: URL });
   await sleep(4500); // module load + the 1.5 s boot check

   await send('Runtime.evaluate', {
     expression: "var el=document.querySelector('#lock-overlay'); if(el) el.click(); 'clicked'",
     });
   await sleep(1200);

   const state = await send('Runtime.evaluate', {
     expression: `JSON.stringify({
       hasGame: !!window.__game,
       threeRev: (window.__game && window.__game.three) || null,
       overlayHidden: !!(document.querySelector('#lock-overlay') && document.querySelector('#lock-overlay').classList.contains('hidden')),
       roundState: (window.__game && window.__game.round && window.__game.round.state) || null,
       botCount: (window.__game && window.__game.botManager && window.__game.botManager.bots && window.__game.botManager.bots.length) || null,
       bootStatus: (document.querySelector('#boot-status') && document.querySelector('#boot-status').textContent || '').slice(0, 1200),
       })`,
     returnByValue: true,
     });

   console.log('=== CONSOLE / LOGS ===');
   console.log(logs.length ? logs.join('\n') : '(none)');
    // A GPU-less headless run can't make a WebGL context — that's an environment limit,
    // not a code fault. So report code errors and flag the WebGL one separately.
   const codeErrors = errors.filter((e) => !/WebGL context/i.test(e));
   console.log('\n=== EXCEPTIONS ===');
   if (codeErrors.length) {
     console.log('CODE ERRORS:');
     console.log(codeErrors.join('\n'));
      } else {
     console.log('(no code errors)');
     if (errors.length) console.log('[env] WebGL context unavailable in this headless run — expected without a GPU; run a browser for full boot.');
      }
   console.log('\n=== POST-CLICK STATE ===');
   console.log(state && state.result ? state.result.value : '(eval failed)');

      // P1-1 behavior, proven without a code change: import resolveShot and fire it
      // straight at a bot with the camera→bot aim and NO colliders, so the weapon's
      // damage (not map geometry) is what's under test. A sniper must one-shot a
      // 100-HP bot; a shotgun's 8-pellet fan-out must land several hits and kill it.
   const behavior = await send('Runtime.evaluate', {
     expression: `(async () => {
        const g = window.__game; if (!g) return { error: 'no game' };
        const resolveShot = (await import('/src/weapons/hitscan.js')).resolveShot;
        const cam = g.engine.camera; const bot = g.botManager.bots[0];
        const origin = bot.box.min.clone(); cam.getWorldPosition(origin);
        const dir = bot.pos.clone(); dir.y = 0.9; dir.sub(origin).normalize();
        const defs = g.weapon.defs; const shot = defs[2], sniper = defs[3];
        const out = { sniperDef: sniper.name, shotDef: shot.name, shotPellets: shot.pellets || 1 };
        bot.health = 100; bot.dead = false;
        out.sniperKilled = !!resolveShot(origin, dir, [], [bot], sniper) && bot.dead;
        bot.health = 100; bot.dead = false;
        let landed = 0;
        for (let i = 0; i < out.shotPellets; i++) {
          const r = resolveShot(origin, dir, [], [bot], shot);
          if (r && r.kind === 'target' && !bot.dead) landed++;
          if (bot.dead) break;
        }
        out.shotLanded = landed; out.shotKilled = bot.dead;
        return out;
      })()`,
     returnByValue: true,
     awaitPromise: true,
    });
   console.log('\n=== BEHAVIOR (P1-1) ===');
   console.log(behavior && behavior.result ? behavior.result.value : '(behavior eval failed)');

       // P1-2 scope: holding RMB on the sniper scopes (spread forced to 0); a
       // non-scoped weapon ignores RMB. Proven without a code change.
   const scope = await send('Runtime.evaluate', {
     expression: `(() => {
        const w = window.__game.weapon;
        const out = {};
        w.index = 3; w.spread = 0.03; // sniper, with simulated accumulated spread
        w._scope({ mouseDown: [false, false, true] });
        out.sniperScoped = w.scoped;            // expect true
        out.spreadForced0 = w.spread === 0;     // expect true (0.03 -> 0)
        w._scope({ mouseDown: [false, false, false] });
        out.releasedUnscoped = w.scoped === false; // expect true
        w.index = 0; w._scope({ mouseDown: [false, false, true] });
        out.pistolIgnores = w.scoped === false; // expect true (no scoped flag)
        return out;
      })()`,
     returnByValue: true,
   });
   console.log('\n=== BEHAVIOR (P1-2 scope) ===');
   console.log(scope && scope.result ? scope.result.value : '(scope eval failed)');

        // P1-3 economy: Kevlar halves non-headshot damage (armor absorbs the
        // dropped half), headshots bypass armor, a player kill adds money
        // (+300, +100 headshot), and a round reset keeps money/armor.
   const econ = await send('Runtime.evaluate', {
     expression: `(() => {
        const g = window.__game; if (!g) return { error: 'no game' };
        const out = {};
        const p = g.player;
        p.reset(); p.armor = 100; p.health = 100; p.alive = true;
        p.takeDamage(100, false);            // halved -> 50 health, armor 50
        out.kevlarHalved = p.health === 50;
        out.armorAbsorbed = p.armor === 50;
        p.takeDamage(50, true);              // headshot bypasses armor: full 50
        out.headshotBypass = p.health === 0 && p.armor === 50;
        p.money = 0;
        g.events.emit('kill', { killer: 'player', victim: 'bot', weapon: null, headshot: false });
        out.moneyOnKill = p.money === 300;
        g.events.emit('kill', { killer: 'player', victim: 'bot', weapon: null, headshot: true });
        out.moneyOnHeadshot = p.money === 700;   // 300 + (300 + 100)
        p.money = 1234; p.armor = 75;
        p.reset();                            // only health/alive reset
        out.moneyPersists = p.money === 1234;
        out.armorPersists = p.armor === 75;
        return out;
       })()`,
     returnByValue: true,
    });
   console.log('\n=== BEHAVIOR (P1-3 econ) ===');
   console.log(econ && econ.result ? econ.result.value : '(econ eval failed)');

         // P1-4 buy menu: B opens the panel in freeze; buying Kevlar shows armor
         // 100 and deducts 250; unaffordable items grey out; the panel is inert
         // outside freeze and auto-closes on live. Proven without a code change.
   const buy = await send('Runtime.evaluate', {
     expression: `(() => {
        const g = window.__game; if (!g) return { error: 'no game' };
        const out = {};
        const p = g.player, wm = g.buyMenu, r = g.round, inp = g.input;
        r.state = 'freeze'; wm.close();
        inp._pressed.clear(); inp._pressed.add('KeyB');
        wm.update(0.016, inp);
        out.opensInFreeze = wm.panel.style.display !== 'none';
        p.money = 800; p.armor = 0;
        wm._buy(wm.items[0]);
        out.kevlarArmor = p.armor === 100;
        out.kevlarMoney = p.money === 550;
        p.money = 100; wm._refresh();
        out.kevGreyed = wm.items[0].button.disabled;      // 100 < 250
        out.magOk = !wm.items[2].button.disabled;          // 100 >= 100
        const m = p.money; wm._buy(wm.items[0]);
        out.unclickable = p.money === m;
        p.money = 800; p.armor = 0; r.state = 'live';
        wm._buy(wm.items[0]);
        out.inertOutsideFreeze = p.armor === 0 && p.money === 800;
        r.state = 'live'; wm.open();
        inp._pressed.clear();
        wm.update(0.016, inp);
        out.closesOnLive = wm.panel.style.display === 'none';
        return out;
        })()`,
     returnByValue: true,
     });
   console.log('\n=== BEHAVIOR (P1-4 buy) ===');
   console.log(buy && buy.result ? buy.result.value : '(buy eval failed)');

          // P1-5 tacticals: G throws a frag that arcs, detonates (floor/fuse),
          // fires its onImpact (a 'tactical' event), and is pruned from the live
          // set; a second throw is ignored while the first is in flight.
   const tac = await send('Runtime.evaluate', {
     expression: `(async () => {
        const g = window.__game; if (!g) return { error: 'no game' };
        const out = {};
        const m = g.projectiles;
        let impact = null;
        const onTac = (e) => { impact = e; };
        g.events.on('tactical', onTac);
        g.input._pressed.clear(); g.input._pressed.add('KeyG');
        g.tactical.update(0.016, g.input, g.engine.camera);
        out.threwFrag = m.list.length === 1;
        g.input._pressed.add('KeyG');
        g.tactical.update(0.016, g.input, g.engine.camera);
        out.oneAtATime = m.list.length === 1;
        let steps = 0;
        while (m.list.length > 0 && steps < 400) { m.update(0.016, g.map.colliders); steps++; }
        out.impactFired = !!impact;
        out.impactKind = impact ? impact.kind : null;
        out.removed = m.list.length === 0;
        out.steppedUnderFuse = steps < 400;
        g.events.off('tactical', onTac);
        return out;
         })()`,
     returnByValue: true,
     awaitPromise: true,
      });
   console.log('\n=== BEHAVIOR (P1-5 tactical) ===');
   console.log(tac && tac.result ? tac.result.value : '(tactical eval failed)');

           // P1-6 effects: a frag damages a nearby bot (falloff by distance), leaves
           // a far bot and the thrower untouched, and throws a prunable explosion; a
           // flash whiteouts when the player sees the impact, fades, and is ignored
           // out of range.
   const eff = await send('Runtime.evaluate', {
     expression: `(() => {
        const g = window.__game; if (!g) return { error: 'no game' };
        const out = {};
        const e = g.effects, bm = g.botManager;
        const near = bm.bots[0]; near.dead = false; near.health = 100;
        const far = bm.bots[1]; far.dead = false; far.health = 100;
        far.pos.set(near.pos.x + 50, 0, near.pos.z);
        g.player.health = 100; g.player.alive = true;
        // Park the thrower 50 m away so the frag provably cannot reach them:
        // with self-damage (FIX_PROMPT_13) a frag at the thrower's feet hurts
        // them, so this assertion now means "out of range, no damage".
        const origPos = g.controller.pos.clone();
        g.controller.pos.set(near.pos.x + 50, 0, near.pos.z);
        const impact = near.pos.clone(); impact.y = 0.2;
        g.events.emit('tactical', { kind: 'frag', pos: impact });
        out.fragDamaged = near.health < 100;
        out.farUntouched = far.health === 100;
        out.noSelfDamage = g.player.health === 100 && g.player.alive;
        out.explosionSpawned = e._explosions.length >= 1;
        for (let i = 0; i < 40; i++) e.update(0.05);
        out.explosionPruned = e._explosions.length === 0;
        const eye = g.controller.pos;
        const seen = eye.clone(); seen.y += g.controller.eye;
        g.events.emit('tactical', { kind: 'flash', pos: seen });
        out.flashWhiteout = e.whiteout === 1;
        e.update(0.016);
        out.flashFading = e.whiteout < 1;
        e.whiteout = 0; e._whiteoutLeft = 0;
        const farFlash = eye.clone(); farFlash.y += 1.6; farFlash.x += 30;
        g.events.emit('tactical', { kind: 'flash', pos: farFlash });
        out.flashOutOfRange = e.whiteout === 0;
        g.controller.pos.copy(origPos);
        return out;
        })()`,
     returnByValue: true,
      });
   console.log('\n=== BEHAVIOR (P1-6 effects) ===');
   console.log(eff && eff.result ? eff.result.value : '(effects eval failed)');

                // P1-7 HUD: the [B] buy hint shows only in the freeze phase, and the
                // tactical chips dim a nade while it is in flight (not held in hand),
                // re-lighting once its slot frees. Proven without a code change.
   const p17 = await send('Runtime.evaluate', {
     expression: `(() => {
        const g = window.__game; if (!g) return { error: 'no game' };
        const out = {};
        const r = g.round, hud = g.hud, t = g.tactical;
        const base = { player: g.player, weapon: g.weapon, round: r,
          spread: 0, scoped: false, whiteout: 0, flash: 0 };
        const step = () => hud.update(0.016,
          Object.assign({ tactical: t.ready() }, base));
           // Free any leftover slot the P1-5 throw left in flight so the chips start held.
        t._frag = null; t._flash = null;
           // Buy hint: visible in freeze, hidden once live.
        r.state = 'freeze'; step();
        out.buyHintFreeze = hud.buyHint.style.display === 'block';
        r.state = 'live'; step();
        out.buyHintLive = hud.buyHint.style.display === 'none';
           // Both chips held at rest; throwing a frag dims its chip until the slot frees.
        out.bothHeld = !hud.tdFrag.classList.contains('dim')
           && !hud.tdFlash.classList.contains('dim');
        g.input._pressed.clear(); g.input._pressed.add('KeyG');
        t.update(0.016, g.input, g.engine.camera);
        out.fragThrew = t._frag !== null;
        step();
        out.fragDimmed = hud.tdFrag.classList.contains('dim');
        t._frag.alive = false; t._frag = null;
        step();
        out.fragRelit = !hud.tdFrag.classList.contains('dim');
        g.input._pressed.clear();
        r.state = 'freeze';
        return out;
         })()`,
    returnByValue: true,
      });
   console.log('\n=== BEHAVIOR (P1-7 hud) ===');
   console.log(p17 && p17.result ? p17.result.value : '(p1-7 eval failed)');

            // FIX_PROMPT_10 hit feedback: exactly one 'hit' event per damage
            // instance (the G9 double-emit fix), and the hitmarker lifecycle —
            // shows on a hit, hides after its duration, headshots look different
            // from body shots, and a kill beats a hit on the same frame.
   const hit = await send('Runtime.evaluate', {
     expression: `(async () => {
        const g = window.__game; if (!g) return { error: 'no game' };
        const out = {};
        const resolveShot = (await import('/src/weapons/hitscan.js')).resolveShot;
        const cam = g.engine.camera; const bot = g.botManager.bots[0];
        const origin = bot.box.min.clone(); cam.getWorldPosition(origin);
        const dir = bot.pos.clone(); dir.y = 0.9; dir.sub(origin).normalize();
        // G9: one 'hit' per bullet. A single resolved shot at a bot must fire
        // exactly one 'hit' — the assertion that would have caught the double emit.
        bot.health = 100; bot.dead = false;
        let hits = 0;
        const onHit = () => hits++;
        g.events.on('hit', onHit);
        resolveShot(origin, dir, [], [bot], g.weapon.defs[0]);
        g.events.off('hit', onHit);
        out.oneHitPerBullet = hits === 1;
        // Marker lifecycle: shows on a hit, hides after its duration.
        const hm = g.hitmarker;
        hm._hide();
        g.events.emit('hit', { target: bot, damage: 10, headshot: false });
        out.markerShowsOnHit = hm.root.style.display === 'block';
        hm.update(0.2); // past the 0.11 s body duration
        out.markerHidesAfter = hm.root.style.display === 'none';
        // A hit on the player (being hurt) is not a landed shot — no marker.
        g.events.emit('hit', { target: 'player', damage: 10, headshot: false });
        out.playerHurtNoMarker = hm.root.style.display === 'none';
        // Headshot is visually distinct from a body shot (colour and size).
        g.events.emit('hit', { target: bot, damage: 10, headshot: false });
        const bodyColor = hm._ticks[0].style.backgroundColor;
        const bodyWidth = parseInt(hm._ticks[0].style.width, 10);
        g.events.emit('hit', { target: bot, damage: 40, headshot: true });
        const headColor = hm._ticks[0].style.backgroundColor;
        const headWidth = parseInt(hm._ticks[0].style.width, 10);
        out.headshotDistinct = bodyColor !== headColor || headWidth > bodyWidth;
        // A kill on the same frame as a hit shows the kill — the stronger signal.
        g.events.emit('hit', { target: bot, damage: 10, headshot: false });
        g.events.emit('kill', { killer: 'player', victim: bot.name, weapon: null, headshot: false });
        const killWidth = parseInt(hm._ticks[0].style.width, 10);
        out.killBeatsHit = hm._state === 'kill' && killWidth > headWidth;
        hm._hide();
        return out;
        })()`,
     returnByValue: true,
     awaitPromise: true,
     });
   console.log('\n=== BEHAVIOR (hit feedback) ===');
   console.log(hit && hit.result ? hit.result.value : '(hit feedback eval failed)');

            // FIX_PROMPT_11 damage feedback: a player hit carries the attacker's
            // position as a snapshot (not a live reference), floating damage
            // numbers merge rapid hits on one target, and the near-death vignette
            // stays capped so 5 HP is tense, not blinding.
   const dmg = await send('Runtime.evaluate', {
     expression: `(async () => {
        const g = window.__game; if (!g) return { error: 'no game' };
        const out = {};
        const cam = g.engine.camera; const bot = g.botManager.bots[0];
        const p = g.player;
        // --- Task 1: the attacker's position rides the hit event, as a snapshot ---
        p.reset();
        let captured = null;
        const onHit = (e) => { if (e.target === 'player') captured = e; };
        g.events.on('hit', onHit);
        p.takeDamage(12, false, null, bot.name, bot.pos);
        g.events.off('hit', onHit);
        out.hitCarriesOrigin = !!captured
           && Number.isFinite(captured.fromX) && Number.isFinite(captured.fromZ);
        // The payload must be a snapshot: moving the bot after the event must not
        // change what the listener saw. A live Vector3 reference would track it.
        const fx = captured.fromX, fz = captured.fromZ;
        const botPos = bot.pos.clone();
        bot.pos.set(bot.pos.x + 100, 0, bot.pos.z + 100);
        out.originIsSnapshot = captured.fromX === fx && captured.fromZ === fz;
        bot.pos.copy(botPos);
        // --- Task 2: floating damage numbers ---
        const dn = g.damageNumbers;
        const scratch = bot.box.min.clone(); cam.getWorldPosition(scratch);
        const fwd = bot.pos.clone(); cam.getWorldDirection(fwd);
        dn._clear();
        bot.pos.set(scratch.x + fwd.x * 5, 0, scratch.z + fwd.z * 5);
        g.events.emit('hit', { target: bot, damage: 10, headshot: false });
        out.numberOnEnemyHit = dn._active.length === 1;
        dn._clear();
        for (let i = 0; i < 8; i++) {
          g.events.emit('hit', { target: bot, damage: 10, headshot: false });
        }
        out.pelletsMergeToOne = dn._active.length === 1;
        dn._clear();
        bot.pos.set(scratch.x - fwd.x * 5, 0, scratch.z - fwd.z * 5);
        g.events.emit('hit', { target: bot, damage: 10, headshot: false });
        out.behindCameraSkipped = dn._active.length === 0;
        dn._clear();
        // --- Task 3: a threat wedge needs an origin; without one, show nothing ---
        const dd = g.damageDirection;
        dd._clear();
        g.events.emit('hit', { target: 'player', damage: 10, headshot: false });
        out.noOriginNoWedge = dd._active.length === 0;
        dd._clear();
        // --- FIX_PROMPT_12: the threat indicator is an edge-anchored glow ---
        // The glow element is a full-viewport square (200vmax), so its bounding
        // box is at least the viewport's larger dimension — not a small wedge.
        const px = g.controller.pos.x, pz = g.controller.pos.z;
        g.events.emit('hit', { target: 'player', damage: 10, headshot: false,
          fromX: px + 1, fromZ: pz });
        const rect = dd._active[0].el.getBoundingClientRect();
        const vmax = Math.max(window.innerWidth, window.innerHeight);
        out.glowIsEdgeAnchored = rect.width >= vmax && rect.height >= vmax;
        dd._clear();
        // The gradient's final colour stop must sit at or before 55% of the
        // gradient ray, so the glow provably cannot reach the middle of the
        // screen. Parse the injected stylesheet, not the live element.
        const styleEl = document.getElementById('damage-direction-style');
        const css = styleEl ? styleEl.textContent : '';
        // NOTE: the regex backslashes are doubled because this whole block is a
        // template literal — a single \s would be dropped to s before the browser
        // ever sees it.
        const stops = [...css.matchAll(/rgba\\([^)]*\\)\\s+([\\d.]+)%/g)]
          .map((m) => parseFloat(m[1]));
        const lastStop = stops.length ? stops[stops.length - 1] : 100;
        out.centreStaysClear = lastStop <= 55;
        // A 50-damage hit must read brighter than a 10-damage hit from the same
        // bearing (same angle, so the only difference is the damage scale).
        g.events.emit('hit', { target: 'player', damage: 10, headshot: false,
          fromX: px + 1, fromZ: pz });
        const lowOp = parseFloat(dd._active[0].el.style.opacity);
        dd._clear();
        g.events.emit('hit', { target: 'player', damage: 50, headshot: false,
          fromX: px + 1, fromZ: pz });
        const highOp = parseFloat(dd._active[0].el.style.opacity);
        out.opacityScalesWithDamage = highOp > lowOp;
        dd._clear();
        // Four hits from four bearings (right, left, behind, ahead) must not
        // white out the screen: the summed opacity of all live glows is capped.
        g.events.emit('hit', { target: 'player', damage: 50, headshot: false,
          fromX: px + 1, fromZ: pz });
        g.events.emit('hit', { target: 'player', damage: 50, headshot: false,
          fromX: px - 1, fromZ: pz });
        g.events.emit('hit', { target: 'player', damage: 50, headshot: false,
          fromX: px, fromZ: pz + 1 });
        g.events.emit('hit', { target: 'player', damage: 50, headshot: false,
          fromX: px, fromZ: pz - 1 });
        const sum = dd._active.reduce((s, w) => s + parseFloat(w.el.style.opacity), 0);
        out.fourDirectionsCapped = sum <= 0.6;
        dd._clear();
        // --- Task 4: the near-death vignette is capped at 0.55 ---
        p.health = 1; p.alive = true;
        const base = { player: p, weapon: g.weapon, round: g.round,
          spread: 0, scoped: false, whiteout: 0, flash: 0 };
        g.hud.update(0.016, Object.assign({ tactical: false }, base));
        out.vignetteCappedAtLowHealth =
           parseFloat(g.hud.lowHp.style.opacity) <= 0.55;
        p.health = 100;
        return out;
        })()`,
     returnByValue: true,
     awaitPromise: true,
     });
   console.log('\n=== BEHAVIOR (damage feedback) ===');
   console.log(dmg && dmg.result ? dmg.result.value : '(damage feedback eval failed)');

           // FIX_PROMPT_13 grenades: a frag damages bots in the open (falloff by
           // distance), is blocked by walls, and hurts the thrower; a flash blinds
           // bots by line of sight and facing, and the blind state holds fire,
           // wears off, and clears on respawn. The field is controlled — the real
           // map colliders are swapped out so only the walls we add matter.
   const gren = await send('Runtime.evaluate', {
     expression: `(() => {
        const g = window.__game; if (!g) return { error: 'no game' };
        const out = {};
        const e = g.effects, bm = g.botManager;
        const botA = bm.bots[0], botB = bm.bots[1];
        const realColliders = e.colliders;
        const origPos = g.controller.pos.clone();
        e.colliders = [];
        botA.dead = false; botA.health = 100; botA.blindTimer = 0;
        botB.dead = false; botB.health = 100; botB.blindTimer = 0;
        // --- frag: open field, falloff, self-damage ---
        const blast = g.controller.pos.clone().set(0, 0.2, 0);
        botA.pos.set(1, 0, 0);   // 1 m from the blast, in the open
        botB.pos.set(7, 0, 0);   // 7 m from the blast, in the open
        g.player.health = 100; g.player.alive = true;
        g.controller.pos.set(0, 0, 0); // thrower at the blast
        g.events.emit('tactical', { kind: 'frag', pos: blast });
        out.fragDamagesNearby = botA.health < 100;
        out.fragFalloff = botA.health < botB.health; // 1 m bot took more than 7 m bot
        out.fragHurtsThrower = g.player.health < 100;
        // --- frag: a wall between blast and target protects it ---
        botA.health = 100; botB.health = 100;
        const wall = { min: g.controller.pos.clone().set(3, 0, -2),
                       max: g.controller.pos.clone().set(3.1, 3, 2) };
        e.colliders = [wall];
        botA.pos.set(5, 0, 0); // 5 m, wall at x=3 between blast and bot
        g.events.emit('tactical', { kind: 'frag', pos: blast });
        out.fragBlockedByWall = botA.health === 100;
        // thrower behind the same wall — reset health first, the frag above
        // already hit the player standing at the blast
        g.player.health = 100; g.player.alive = true;
        g.controller.pos.set(5, 0, 0);
        g.events.emit('tactical', { kind: 'frag', pos: blast });
        out.fragSpareThrowerBehindWall = g.player.health === 100;
        // --- flash: LOS blinds, walls block, facing matters ---
        e.colliders = [];
        botA.dead = false; botA.health = 100; botA.blindTimer = 0;
        botB.dead = false; botB.health = 100; botB.blindTimer = 0;
        const flashPos = g.controller.pos.clone().set(0, 1.6, 0);
        botA.pos.set(3, 0, 0); botA.yaw = Math.PI / 2;   // facing the flash
        botB.pos.set(3, 0, 0); botB.yaw = -Math.PI / 2;  // facing away
        g.events.emit('tactical', { kind: 'flash', pos: flashPos });
        out.flashBlindsBot = botA.blindTimer > 0;
        out.flashFacingMatters = botA.blindTimer > botB.blindTimer;
        botA.blindTimer = 0; botB.blindTimer = 0;
        e.colliders = [wall];
        botA.pos.set(5, 0, 0); botA.yaw = Math.PI / 2;
        g.events.emit('tactical', { kind: 'flash', pos: flashPos });
        out.flashBlockedByWall = botA.blindTimer === 0;
        // --- blind behaviour: holds fire, wears off, clears on respawn ---
        e.colliders = [];
        botA.dead = false; botA.health = 100;
        botA.blindTimer = 3.0; botA.state = 'patrol'; botA.losTimer = 0;
        botA.pos.set(0, 0, 0);
        g.controller.pos.set(5, 0, 0);
        g.player.health = 100; g.player.alive = true;
        botA.update(1.0, g.controller, []); // still heavily blind (2.0 > 1.575)
        out.blindBotHoldsFire = g.player.health === 100;
        botA.blindTimer = 2.0; botA.state = 'patrol'; botA.losTimer = 0;
        botA.pos.set(0, 0, 0);
        g.player.health = 1000; g.player.alive = true; // recovery may land a few hits
        let steps = 0;
        while (botA.blindTimer > 0 && steps < 100) { botA.update(0.1, g.controller, []); steps++; }
        out.blindWearsOff = botA.blindTimer === 0 && botA.state === 'engage' && botA.hasLOS;
        botA.blindTimer = 2.0;
        botA.spawnAt({ x: 0, z: 0 });
        out.respawnClearsBlind = botA.blindTimer === 0;
        // restore the field for whatever follows
        e.colliders = realColliders;
        g.controller.pos.copy(origPos);
        g.player.health = 100; g.player.alive = true;
        return out;
        })()`,
     returnByValue: true,
     });
   console.log('\n=== BEHAVIOR (grenades) ===');
   console.log(gren && gren.result ? gren.result.value : '(grenades eval failed)');

           // FIX_PROMPT_14 post stack: the composer exists on a normal load,
           // OutputPass precedes SMAAPass (the ordering rule that locks in the
           // display-referred SMAA), a simulated resize keeps the composer's
           // targets matched to the renderer's drawing buffer, the render-scale
           // setting doubles the pixel ratio, and Effects=Off bypasses the
           // composer. The scale is normalized to 1.0 first so the assertions
           // are deterministic whatever a previous run persisted.
   const post = await send('Runtime.evaluate', {
     expression: `(() => {
        const g = window.__game; if (!g) return { error: 'no game' };
        const out = {};
        const e = g.engine;
        const sm = g.settingsMenu;
        out.smCtor = sm ? sm.constructor.name : null;
        out.smKeys = sm ? Object.keys(sm) : null;
        if (!sm || !sm.scaleEl) return out;
        sm.scaleEl.value = '1';
        sm.scaleEl.dispatchEvent(new Event('change'));
        out.composerActive = !!e.composer;
        if (e.composer) {
          const passes = e.composer.passes;
          const outIdx = passes.findIndex((p) => p.constructor.name === 'OutputPass');
          const smaaIdx = passes.findIndex((p) => p.constructor.name === 'SMAAPass');
          out.passOrderCorrect = outIdx >= 0 && smaaIdx >= 0 && outIdx < smaaIdx;
        } else {
          out.passOrderCorrect = false;
        }
        e._onResize();
        const c = e.composer && e.composer.composer;
        out.resizeKeepsTargets = !!c && c.renderTarget1.width === e.renderer.domElement.width
          && c.renderTarget1.height === e.renderer.domElement.height;
        sm.scaleEl.value = '2';
        sm.scaleEl.dispatchEvent(new Event('change'));
        out.renderScaleApplies = e.renderer.getPixelRatio() === 2;
        sm.scaleEl.value = '1';
        sm.scaleEl.dispatchEvent(new Event('change'));
        sm.fxEl.value = 'off';
        sm.fxEl.dispatchEvent(new Event('change'));
        out.effectsOffBypasses = e._postOn === false;
        sm.fxEl.value = 'high';
        sm.fxEl.dispatchEvent(new Event('change'));
        out.effectsRestored = e._postOn === true;
        return out;
        })()`,
     returnByValue: true,
     });
   console.log('\n=== BEHAVIOR (post stack) ===');
   if (post && post.result && post.result.value !== undefined) {
     console.log(post.result.value);
   } else if (post && post.exceptionDetails) {
     console.log('EXCEPTION: ' + (post.exceptionDetails.exception?.description
       || post.exceptionDetails.text));
   } else {
     console.log('(post stack eval failed)', JSON.stringify(post));
   }

           // ?post=0: the escape hatch. Reload with the flag and confirm the
           // composer is skipped and the direct render path still works. The
           // pointer-lock stub was injected on new-document, so it survives this
           // navigation; any exceptions the post=0 page throws are reported too.
   const errCountBefore = errors.length;
   await send('Page.navigate', { url: URL + '&post=0' });
   await sleep(4500);
   const post0 = await send('Runtime.evaluate', {
     expression: `(() => {
        const g = window.__game; if (!g) return { error: 'no game' };
        let renderWorks = true;
        try { g.engine._render(); } catch (err) { renderWorks = false; }
        return { composerNull: g.engine.composer === null, renderWorks };
        })()`,
     returnByValue: true,
     });
   console.log('--- ?post=0 escape hatch ---');
   console.log(post0 && post0.result ? post0.result.value : '(post=0 eval failed)');
   const newErrors = errors.slice(errCountBefore);
   if (newErrors.length) {
     console.log('--- ?post=0 exceptions ---');
     console.log(newErrors.join('\n'));
     }
   ws.close();

   try { server.kill('SIGKILL'); } catch { /* already gone */ }
   try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
   }

main().catch((e) => {
  console.log('PROBE ERROR: ' + (e && e.message ? e.message : e));
  process.exit(1);
   });
