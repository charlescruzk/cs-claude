// End-to-end test for scripts/relay.mjs.
//
//   node scripts/relay_test.mjs
//
// Uses a hand-written RFC 6455 client rather than Node's global WebSocket: undici
// offers permessage-deflate and does not cope with a server that declines it, so it
// cannot talk to this relay (browsers handle a declined extension correctly).
// Everything here is Node built-ins — no dependencies, consistent with CLAUDE.md.
import { spawn } from 'node:child_process';
import net from 'node:net';
import crypto from 'node:crypto';

const PORT = 8099;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass) => results.push({ name, pass });

// --- a minimal client -------------------------------------------------------
function clientFrame(text) {
  const b = Buffer.from(text, 'utf8');
  const mask = crypto.randomBytes(4);
  let head;
  if (b.length < 126) { head = Buffer.alloc(2); head[1] = 0x80 | b.length; }
  else { head = Buffer.alloc(4); head[1] = 0x80 | 126; head.writeUInt16BE(b.length, 2); }
  head[0] = 0x81; // FIN + text
  const payload = Buffer.from(b);
  for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  return Buffer.concat([head, mask, payload]);
}

function connect() {
  return new Promise((resolve) => {
    const sock = net.connect(PORT, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    const client = { sock, got: [], send: (o) => sock.write(clientFrame(JSON.stringify(o))) };
    let shook = false;
    let acc = Buffer.alloc(0);
    sock.on('connect', () => sock.write(
      `GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    sock.on('data', (d) => {
      if (!shook) {
        const i = d.indexOf('\r\n\r\n');
        if (i < 0) return;
        shook = true;
        acc = Buffer.concat([acc, d.subarray(i + 4)]);
        resolve(client);
      } else acc = Buffer.concat([acc, d]);
      for (;;) {
        if (acc.length < 2) break;
        const op = acc[0] & 0x0f;
        let len = acc[1] & 0x7f;
        let off = 2;
        if (len === 126) { if (acc.length < 4) break; len = acc.readUInt16BE(2); off = 4; }
        if (acc.length < off + len) break;
        const text = acc.subarray(off, off + len).toString('utf8');
        acc = acc.subarray(off + len);
        if (op === 1) { try { client.got.push(JSON.parse(text)); } catch { /* ignore */ } }
      }
    });
    sock.on('error', () => resolve(client));
  });
}

// --- the run ----------------------------------------------------------------
const server = spawn('node', ['scripts/relay.mjs', String(PORT)], { stdio: 'ignore' });
await sleep(700);

const A = await connect();
A.send({ t: 'join', room: 'test', name: 'alice' });
await sleep(200);
const B = await connect();
B.send({ t: 'join', room: 'TEST', name: 'bob' });
await sleep(300);

const aJoined = A.got.find((m) => m.t === 'joined');
const bJoined = B.got.find((m) => m.t === 'joined');
check('handshake + joined carries an id', !!aJoined?.id && !!bJoined?.id);
check('room code normalised to uppercase', aJoined?.room === 'TEST' && bJoined?.room === 'TEST');
check('late joiner sees the existing peer', !!bJoined?.peers?.some((p) => p.name === 'alice'));
check('existing player notified of the arrival', A.got.some((m) => m.t === 'peer' && m.name === 'bob'));
check('teams alternate', A.got.find((m) => m.t === 'team')?.team !== B.got.find((m) => m.t === 'team')?.team);

A.got.length = 0; B.got.length = 0;
A.send({ t: 's', p: [1, 2, 3], y: 0.5, a: 0.1, f: 0 });
await sleep(200);
check('state reaches the peer, stamped with the sender id',
  B.got.some((m) => m.t === 's' && m.id === aJoined.id && m.p[0] === 1));
check('sender never receives its own state back', !A.got.some((m) => m.t === 's'));

A.got.length = 0; B.got.length = 0;
A.send({ t: 'hit', to: bJoined.id, dmg: 34, hs: false });
await sleep(200);
check('hit is routed to the named victim only',
  B.got.some((m) => m.t === 'hit' && m.dmg === 34) && !A.got.some((m) => m.t === 'hit'));

// Server-reserved types must never be relayed from a client, or a peer could
// overwrite another player's local connection id.
A.got.length = 0;
B.send({ t: 'joined', id: 'HACKED', room: 'TEST', peers: [] });
B.send({ t: 'team', team: 'ct' });
B.send({ t: 'peer', id: 'HACKED', name: 'evil' });
await sleep(250);
check('spoofed server-reserved types are not relayed',
  !A.got.some((m) => m.t === 'joined' || m.t === 'team' || m.t === 'peer'));

B.got.length = 0;
B.send({ t: 'join', room: 'OTHER', name: 'bob' });
await sleep(200);
check('a second join is refused', B.got.some((m) => m.t === 'error'));
const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
check('repeat join leaks no room slot', health.rooms.length === 1 && health.rooms[0].players === 2);

B.got.length = 0;
A.sock.destroy();
await sleep(400);
check('peers are told about a disconnect', B.got.some((m) => m.t === 'left' && m.id === aJoined.id));
const after = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
check('room shrinks on disconnect', after.rooms[0]?.players === 1);

B.sock.destroy();
await sleep(200);
server.kill('SIGKILL');

for (const r of results) console.log(`${r.pass ? 'ok  ' : 'FAIL'}  ${r.name}`);
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
