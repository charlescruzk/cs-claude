// Dependency-free WebSocket relay server for cs-browser multiplayer.
//
//   node scripts/relay.mjs [port]        # default 8081
//
// Node ships a WebSocket *client* but no server, and this project forbids npm
// dependencies, so RFC 6455 is implemented here: the HTTP upgrade handshake, frame
// parsing (including messages split across TCP packets), and frame writing.
//
// The server is a RELAY, not an authority: it validates nothing about game state and
// simply forwards each client's messages to the other members of its room, stamping
// the sender's id. That is a deliberate v1 scope — see docs/MULTIPLAYER.md.
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

const PORT = Number(process.argv[2]) || 8081;
const GUID = '258EAFA5-E914-47DA-95CA-5AB0DC85B11F';
const MAX_ROOM = 10;          // players per room
const MAX_FRAME = 64 * 1024;  // a state packet is ~200 bytes; this is very generous

/** roomCode -> Set<conn> */
const rooms = new Map();

const server = createServer((req, res) => {
  // A tiny health endpoint so you can confirm the relay is up from a browser.
  if (req.url === '/health') {
    const body = JSON.stringify({
      ok: true,
      rooms: [...rooms].map(([code, set]) => ({ code, players: set.size })),
    });
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(body);
    return;
  }
  res.writeHead(426).end('This endpoint speaks WebSocket only.');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();

  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);      // latency over throughput: this is a game
  socket.setKeepAlive(true, 15000); // a client that vanishes without a FIN (lid closed,
                                    // dropped Wi-Fi, NAT timeout) would otherwise hold
                                    // its room slot indefinitely

  const conn = { socket, id: randomUUID().slice(0, 8), name: 'player', room: null, buf: Buffer.alloc(0), frag: null, alive: true };

  socket.on('data', (chunk) => {
    conn.buf = Buffer.concat([conn.buf, chunk]);
    // A TCP read can contain a partial frame, one frame, or several. Drain every
    // complete frame and leave the remainder buffered for the next read.
    for (;;) {
      const frame = readFrame(conn.buf);
      if (!frame) break;
      conn.buf = conn.buf.subarray(frame.size);
      if (frame.opcode === 0x8) { closeConn(conn); return; }
      if (frame.opcode === 0x9) { socket.write(encodeFrame(frame.payload, 0xA)); continue; }
      if (frame.opcode === 0xA) continue; // pong: nothing to do

      // Text/binary may arrive fragmented: a first frame with FIN clear, then any
      // number of continuation frames (opcode 0x0), the last with FIN set. Without
      // reassembly the first fragment is handed to JSON.parse as if it were whole.
      if (frame.opcode === 0x1 || frame.opcode === 0x2) {
        if (frame.fin) { if (frame.opcode === 0x1) handleMessage(conn, frame.payload.toString('utf8')); continue; }
        conn.frag = { opcode: frame.opcode, chunks: [frame.payload], size: frame.payload.length };
        continue;
      }
      if (frame.opcode === 0x0) {
        if (!conn.frag) { closeConn(conn); return; } // continuation with nothing to continue
        conn.frag.chunks.push(frame.payload);
        conn.frag.size += frame.payload.length;
        if (conn.frag.size > MAX_FRAME) { closeConn(conn); return; }
        if (!frame.fin) continue;
        const whole = Buffer.concat(conn.frag.chunks);
        const wasText = conn.frag.opcode === 0x1;
        conn.frag = null;
        if (wasText) handleMessage(conn, whole.toString('utf8'));
        continue;
      }
    }
    if (conn.buf.length > MAX_FRAME) closeConn(conn); // runaway / hostile client
  });

  // 'end' is the one that matters. An HTTP-upgraded socket is half-open capable, so
  // when the peer sends FIN the server side stays writable and 'close' does NOT fire
  // until we destroy it ourselves — which is what closeConn does. Listening only for
  // 'close'/'error' therefore leaks the connection on every clean disconnect: the
  // player keeps their room slot and their hit box lives on in every peer's world.
  socket.on('end', () => closeConn(conn));
  socket.on('error', () => closeConn(conn));
  socket.on('close', () => closeConn(conn));
});

// --- framing -----------------------------------------------------------------

// Parse one frame from `buf`, or null when it does not yet hold a complete one.
// Returns { opcode, payload, size } where `size` is the bytes consumed.
function readFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0];
  const b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let off = 2;

  // RFC 6455: control frames (0x8-0xF) carry at most 125 bytes and are never
  // fragmented. Without this a client can send a 64 KB ping and have it echoed back.
  if ((opcode & 0x8) !== 0 && (len > 125 || !fin)) return kill(buf);

  if (len === 126) {
    if (buf.length < off + 2) return null;
    len = buf.readUInt16BE(off);
    // Check the DECLARED length, not the accumulated buffer — a legal max-size frame
    // is larger on the wire than its payload once header and mask are counted.
    if (len > MAX_FRAME) return kill(buf);
    off += 2;
  } else if (len === 127) {
    if (buf.length < off + 8) return null;
    const big = buf.readBigUInt64BE(off);
    if (big > BigInt(MAX_FRAME)) return kill(buf);
    len = Number(big);
    off += 8;
  }

  let mask = null;
  if (masked) {
    if (buf.length < off + 4) return null;
    mask = buf.subarray(off, off + 4);
    off += 4;
  }
  if (buf.length < off + len) return null;

  const payload = Buffer.from(buf.subarray(off, off + len));
  // Clients MUST mask; unmask in place.
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  return { fin, opcode, payload, size: off + len };
}

// A frame we refuse to process: report it as a close so the caller drops the socket.
function kill(buf) {
  return { fin: true, opcode: 0x8, payload: Buffer.alloc(0), size: buf.length };
}

// Server-to-client frames are never masked.
function encodeFrame(payload, opcode = 0x1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const n = body.length;
  let head;
  if (n < 126) {
    head = Buffer.alloc(2);
    head[1] = n;
  } else if (n < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  head[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([head, body]);
}

function send(conn, obj) {
  if (!conn.alive) return;
  try {
    conn.socket.write(encodeFrame(JSON.stringify(obj)));
  } catch {
    closeConn(conn);
  }
}

function broadcast(room, obj, exceptId = null) {
  const set = rooms.get(room);
  if (!set) return;
  for (const peer of set) if (peer.id !== exceptId) send(peer, obj);
}

// --- protocol ----------------------------------------------------------------

function handleMessage(conn, text) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return; // malformed input is ignored, never fatal
  }
  if (!msg || typeof msg.t !== 'string') return;

  if (msg.t === 'join') {
    // Join is once per connection. A second join would add this conn to a new room's
    // Set while closeConn only ever cleans up conn.room, leaving a dead entry in the
    // old room forever.
    if (conn.room) return send(conn, { t: 'error', reason: 'already joined' });
    const code = String(msg.room || '').toUpperCase().slice(0, 8) || 'LOBBY';
    const set = rooms.get(code) || new Set();
    if (set.size >= MAX_ROOM) return send(conn, { t: 'error', reason: 'room full' });

    conn.name = String(msg.name || 'player').slice(0, 16);
    conn.room = code;
    rooms.set(code, set);

    // Tell the newcomer who is already here, then tell the room about the newcomer.
    send(conn, {
      t: 'joined',
      id: conn.id,
      room: code,
      peers: [...set].map((p) => ({ id: p.id, name: p.name, team: p.team })),
    });
    conn.team = set.size % 2 === 0 ? 't' : 'ct'; // alternate teams as players arrive
    send(conn, { t: 'team', team: conn.team });
    broadcast(code, { t: 'peer', id: conn.id, name: conn.name, team: conn.team }, conn.id);
    set.add(conn);
    console.log(`[relay] ${conn.name} (${conn.id}) joined ${code} — ${set.size} in room`);
    return;
  }

  if (!conn.room) return; // everything below requires a room

  // Only these three types may originate from a client. Without this whitelist a peer
  // could send {t:'joined'} or {t:'team'} and the relay would forward it verbatim,
  // letting anyone overwrite another player's local connection id or team.
  if (msg.t !== 's' && msg.t !== 'shot' && msg.t !== 'hit') return;

  // Relay verbatim, stamped with the sender so peers can attribute it. The server
  // does not inspect or validate game state.
  msg.id = conn.id;
  if (msg.t === 'hit' && msg.to) {
    const set = rooms.get(conn.room);
    const target = set && [...set].find((p) => p.id === msg.to);
    if (target) send(target, msg);
    return;
  }
  broadcast(conn.room, msg, conn.id);
}

function closeConn(conn) {
  if (!conn.alive) return;
  conn.alive = false;
  try { conn.socket.destroy(); } catch { /* already gone */ }
  const set = conn.room && rooms.get(conn.room);
  if (set) {
    set.delete(conn);
    broadcast(conn.room, { t: 'left', id: conn.id });
    console.log(`[relay] ${conn.name} (${conn.id}) left ${conn.room} — ${set.size} remain`);
    if (set.size === 0) rooms.delete(conn.room);
  }
}

server.listen(PORT, () => {
  console.log(`[relay] listening on ws://localhost:${PORT}`);
  console.log(`[relay] health: http://localhost:${PORT}/health`);
});
