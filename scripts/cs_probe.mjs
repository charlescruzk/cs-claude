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
     // Headless Chrome has no real pointer, so requestPointerLock() throws
     // WrongDocumentError and input.locked never becomes true — the combat loop
     // (gated on it) would never run. Stub pointer lock so the click-to-lock path
     // "succeeds" and the full runtime is exercised on this GPU-less run.
   await send('Page.addScriptToEvaluateOnNewDocument', { source: [
     "document._plEl = null;",
     "Object.defineProperty(document, 'pointerLockElement', { configurable: true, get() { return document._plEl; } });",
     "const _rq = function () { document._plEl = this; document.dispatchEvent(new Event('pointerlockchange')); };",
     "const _ex = function () { document._plEl = null; document.dispatchEvent(new Event('pointerlockchange')); };",
     "for (const P of [Element.prototype, HTMLElement.prototype]) { P.requestPointerLock = _rq; P.exitPointerLock = _ex; }",
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
   ws.close();

   try { server.kill('SIGKILL'); } catch { /* already gone */ }
   try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
   }

main().catch((e) => {
  console.log('PROBE ERROR: ' + (e && e.message ? e.message : e));
  process.exit(1);
   });
