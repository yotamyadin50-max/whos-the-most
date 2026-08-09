// Who's The Most, local server: static file host + WebSocket room sync.
// Deliberate deviation from the Builder's default zero-dependency static stack (see _process/07-builder-notes.md):
// live cross-phone room sync is the product's core mechanic and cannot exist as pure static HTML/CSS/JS.
// Same pattern already validated in O-output/07-sparkroom: one dependency (ws), no framework, no build step,
// no external account/service, room state held in memory only.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { QUESTIONS, CLUSTER_SIZE } = require('./pack.js');

const PORT = process.env.PORT || 8600;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

// Last-resort safety net, defense in depth alongside the specific server/wss/socket handlers
// below: log and keep the process alive instead of letting one bad request take the whole
// room-hosting server down for everyone currently connected.
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err.stack || err.message));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 20;
const VOTE_SECONDS = 15;
const COUNTDOWN_SECONDS = 3;
const RESULT_DISPLAY_MS = 4000;
const ROOM_IDLE_MS = 30 * 60 * 1000; // 30 minutes, per _process/02-site-planner-plan.md edge case 4
const RECONNECT_GRACE_MS = 60 * 1000; // per edge case 5

const AVATAR_COLORS = ['blue', 'pink', 'green', 'orange', 'yellow', 'cyan'];

const server = http.createServer((req, res) => {
  let filePath = req.url.split('?')[0];
  if (filePath === '/' || filePath.startsWith('/room/')) filePath = '/index.html';
  const full = path.join(__dirname, filePath);
  if (!full.startsWith(__dirname)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(full, (err, data) => {
    if (err) {
      // Explicit no-store on the error path specifically: with no Cache-Control at all, browsers
      // apply their own heuristic caching, and a transient 404 (a deploy mid-restart, a real
      // crash) can get cached client-side and then "stick" even once the server is healthy
      // again, exactly what happened live on the first Render deploy, 2026-08-09.
      res.writeHead(404, { 'Cache-Control': 'no-store' });
      return res.end('Not found');
    }
    const ext = path.extname(full);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

/** @type {Map<string, Room>} */
const rooms = new Map();

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, avoids misread-out-loud codes
  let code;
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}
function genId() { return Math.random().toString(36).slice(2, 10); }
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

function send(ws, msg) { if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); }
function activePlayers(room) { return [...room.players.values()].filter(p => p.connected); }
function broadcast(room, msg) { for (const p of activePlayers(room)) send(p.ws, msg); }
function publicPlayer(p) { return { id: p.id, name: p.displayName, color: p.color, connected: p.connected }; }
function publicPlayers(room) { return [...room.players.values()].map(publicPlayer); }

function uniqueDisplayName(room, rawName) {
  const base = (rawName || 'שחקן').trim().slice(0, 12) || 'שחקן';
  const taken = new Set([...room.players.values()].map(p => p.displayName));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function canStart(room) {
  const n = activePlayers(room).length;
  const missing = MIN_PLAYERS - n;
  if (missing > 0) {
    const reason = missing === 1 ? 'צריך עוד חבר אחד כדי להתחיל' : `צריך עוד לפחות ${missing} חברים כדי להתחיל`;
    return { ok: false, reason };
  }
  return { ok: true, reason: null };
}

function broadcastLobbyState(room) {
  const start = canStart(room);
  broadcast(room, {
    type: 'room_state', code: room.code, phase: room.phase, hostId: room.hostId,
    players: publicPlayers(room), questionCount: room.questionCount, canStart: start.ok, startBlockedReason: start.reason,
  });
}

function touchRoom(room) { room.lastActivity = Date.now(); }

// Picks N questions spread across topic clusters (school/food/phone/etc, CLUSTER_SIZE each),
// not flat random, so a single round can't accidentally clump onto one topic. Round-robins a
// shuffled cluster order, taking one not-yet-shown question per cluster per pass, per the
// user's explicit request for real topic variety within a round, 2026-08-09.
function pickRoundQuestions(room, n) {
  const clusterCount = Math.ceil(QUESTIONS.length / CLUSTER_SIZE);
  let available = QUESTIONS.map((_, i) => i).filter(i => !room.shownIndices.has(i));
  if (available.length < n) { room.shownIndices.clear(); available = QUESTIONS.map((_, i) => i); }

  const byCluster = Array.from({ length: clusterCount }, () => []);
  for (const i of available) byCluster[Math.floor(i / CLUSTER_SIZE)].push(i);
  for (let i = 0; i < byCluster.length; i++) byCluster[i] = shuffle(byCluster[i]);

  const picked = [];
  let clusterOrder = shuffle(byCluster.map((_, i) => i));
  let cursor = 0;
  while (picked.length < n) {
    if (cursor >= clusterOrder.length) {
      if (byCluster.every(list => list.length === 0)) break; // exhausted (can't happen for n <= 15 < 120)
      clusterOrder = shuffle(byCluster.map((_, i) => i).filter(i => byCluster[i].length > 0));
      cursor = 0;
      if (clusterOrder.length === 0) break;
    }
    const ci = clusterOrder[cursor++];
    const q = byCluster[ci].pop();
    if (q !== undefined) picked.push(q);
  }

  picked.forEach(i => room.shownIndices.add(i));
  return shuffle(picked).map(i => QUESTIONS[i]);
}

function createRoom(questionCount) {
  const code = genCode();
  const room = {
    code,
    players: new Map(), // id -> {id, ws, rawName, displayName, color, connected, disconnectTimer}
    hostId: null,
    joinOrder: [],
    questionCount,
    shownIndices: new Set(),
    roundQuestions: [],
    currentRoundIndex: -1,
    phase: 'lobby', // lobby | countdown | question | result | final
    votes: new Map(), // playerId -> targetPlayerId
    roundWins: {}, // playerId -> number of questions won
    totalVotesReceived: {}, // playerId -> total votes across the round
    personalHighlight: {}, // playerId -> {question, votes}
    pendingJoins: [], // {ws, rawName} queued while phase !== 'lobby'
    roundTimer: null,
    lastActivity: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function addPlayer(room, ws, rawName, { asHost } = {}) {
  const id = genId();
  const color = AVATAR_COLORS[room.joinOrder.length % AVATAR_COLORS.length];
  const displayName = uniqueDisplayName(room, rawName);
  const player = { id, ws, rawName, displayName, color, connected: true, disconnectTimer: null };
  room.players.set(id, player);
  room.joinOrder.push(id);
  if (asHost || !room.hostId) room.hostId = id;
  ws.roomCode = room.code;
  ws.playerId = id;
  touchRoom(room);
  return player;
}

function reassignHostIfNeeded(room) {
  const current = room.players.get(room.hostId);
  if (current && current.connected) return;
  const next = room.joinOrder.find(id => room.players.has(id) && room.players.get(id).connected);
  // Only actually hand host off when there's a real connected candidate to receive it.
  // If there isn't (e.g. the host is alone in the room and just refreshed their own page),
  // leave hostId pointing at the disconnected player: their own rejoin restores host status
  // naturally since it never moved, instead of the next stranger to join silently inheriting
  // it. Confirmed as a real bug 2026-08-09: a solo host reloading before anyone else joined
  // permanently lost host status to whoever joined next.
  if (next) room.hostId = next;
}

function removePlayer(room, playerId) {
  room.players.delete(playerId);
  room.joinOrder = room.joinOrder.filter(id => id !== playerId);
  reassignHostIfNeeded(room);
  touchRoom(room);
  if (room.players.size === 0) {
    setTimeout(() => { if (rooms.get(room.code) === room && room.players.size === 0) rooms.delete(room.code); }, 1000);
    return;
  }
  broadcastLobbyState(room);
}

function startCountdown(room) {
  room.phase = 'countdown';
  broadcast(room, { type: 'countdown', seconds: COUNTDOWN_SECONDS });
  clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => startQuestion(room), COUNTDOWN_SECONDS * 1000);
}

function startQuestion(room) {
  room.currentRoundIndex++;
  if (room.currentRoundIndex >= room.roundQuestions.length) return endGame(room);
  room.phase = 'question';
  room.votes.clear();
  const text = room.roundQuestions[room.currentRoundIndex];
  broadcast(room, {
    type: 'question', text, index: room.currentRoundIndex, total: room.roundQuestions.length,
    players: publicPlayers(room),
  });
  clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => resolveRound(room), VOTE_SECONDS * 1000);
}

function resolveRound(room) {
  if (room.phase !== 'question') return;
  clearTimeout(room.roundTimer);
  room.phase = 'result';
  const tally = {};
  for (const targetId of room.votes.values()) tally[targetId] = (tally[targetId] || 0) + 1;
  for (const [targetId, count] of Object.entries(tally)) {
    room.totalVotesReceived[targetId] = (room.totalVotesReceived[targetId] || 0) + count;
    const current = room.personalHighlight[targetId];
    if (!current || count > current.votes) {
      room.personalHighlight[targetId] = { question: room.roundQuestions[room.currentRoundIndex], votes: count };
    }
  }
  let max = 0;
  for (const c of Object.values(tally)) if (c > max) max = c;
  const winnerIds = max > 0 ? Object.keys(tally).filter(id => tally[id] === max) : [];
  for (const id of winnerIds) room.roundWins[id] = (room.roundWins[id] || 0) + 1;
  const winners = winnerIds.map(id => ({ id, name: room.players.get(id)?.displayName || '?', votes: max }));
  broadcast(room, { type: 'result', winners, tie: winners.length > 1, votedCount: room.votes.size });
  touchRoom(room);
  clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => startCountdown(room), RESULT_DISPLAY_MS);
}

function maybeEarlyResolve(room) {
  const total = activePlayers(room).length;
  broadcast(room, { type: 'vote_update', votedCount: room.votes.size, totalCount: total });
  if (room.votes.size >= total) resolveRound(room);
}

function endGame(room) {
  room.phase = 'final';
  const leaderboard = [...room.players.keys()]
    .map(id => ({ id, name: room.players.get(id).displayName, wins: room.roundWins[id] || 0 }))
    .sort((a, b) => b.wins - a.wins);
  const totalVotesTable = [...room.players.keys()]
    .map(id => ({ id, name: room.players.get(id).displayName, votes: room.totalVotesReceived[id] || 0 }))
    .sort((a, b) => b.votes - a.votes);
  const personalHighlights = {};
  for (const id of room.players.keys()) personalHighlights[id] = room.personalHighlight[id] || null;
  broadcast(room, { type: 'game_over', leaderboard, totalVotesTable, personalHighlights });
  touchRoom(room);
}

function flushPendingJoins(room) {
  if (!room.pendingJoins.length) return;
  const queued = room.pendingJoins;
  room.pendingJoins = [];
  for (const { ws, rawName } of queued) {
    if (room.players.size >= MAX_PLAYERS) { send(ws, { type: 'room_full' }); continue; }
    const player = addPlayer(room, ws, rawName);
    send(ws, { type: 'room_joined', code: room.code, playerId: player.id, hostId: room.hostId, phase: room.phase, players: publicPlayers(room) });
  }
  broadcastLobbyState(room);
}

function resetRoundState(room) {
  room.roundQuestions = [];
  room.currentRoundIndex = -1;
  room.votes.clear();
  room.roundWins = {};
  room.totalVotesReceived = {};
  room.personalHighlight = {};
}

// Node treats an unhandled 'error' event on any EventEmitter (the WebSocketServer, the HTTP
// server, or an individual client socket) as a fatal, process-crashing exception. Real internet
// traffic (a phone losing signal mid-connection, a proxy health check, a malformed upgrade
// request) triggers these constantly; local single-machine testing essentially never does,
// which is exactly why this was invisible until the real Render deploy. Confirmed live 2026-08-09:
// the deployed server was crash-looping (curl showed the site flapping between working and
// Render's "no-server" 404 for 100+ seconds straight, never stabilizing) from exactly this gap.
server.on('error', (err) => console.error('[http server error]', err.message));
wss.on('error', (err) => console.error('[wss error]', err.message));

// Keepalive heartbeat: a reverse proxy in front of the app (Render's, Cloudflare's) commonly
// closes a WebSocket connection that's carried no traffic for a while, even though the app
// itself is still healthy. A lobby with 2 people waiting for a 3rd, or someone reading the
// screen before typing their name, can easily sit idle long enough to hit that. Confirmed as a
// real user-facing bug live, 2026-08-09: "clicking Continue does nothing" once the room's been
// open a bit, because the socket had already been silently dropped with zero client feedback.
// Standard `ws` idiom: ping every client periodically; a client whose pong never comes back
// (genuinely dead, not just idle) gets terminated so its slot/room state can clean up properly
// via the existing disconnect handling below, instead of lingering as a phantom connection.
function heartbeat() { this.isAlive = true; }
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);
wss.on('close', () => clearInterval(heartbeatInterval));

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);
  ws.on('error', (err) => console.error('[client ws error]', err.message));
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create_room') {
      const count = [5, 10, 15].includes(msg.questionCount) ? msg.questionCount : 10;
      const room = createRoom(count);
      const player = addPlayer(room, ws, msg.name, { asHost: true });
      send(ws, { type: 'room_created', code: room.code, playerId: player.id, hostId: room.hostId, players: publicPlayers(room), questionCount: room.questionCount });
      return;
    }

    if (msg.type === 'join_room' || msg.type === 'rejoin') {
      const room = rooms.get((msg.code || '').toUpperCase());
      if (!room) return send(ws, { type: 'room_not_found' });

      if (msg.type === 'rejoin') {
        const existing = room.players.get(msg.playerId);
        if (!existing) return send(ws, { type: 'rejoin_failed' });
        clearTimeout(existing.disconnectTimer);
        existing.ws = ws; existing.connected = true;
        ws.roomCode = room.code; ws.playerId = existing.id;
        touchRoom(room);
        // Self-heals the rare case where the room's host slot was left dangling (every player
        // disconnected at once, none promoted since none were connected): re-derives a valid
        // host now that a real connected player exists again. A no-op whenever hostId already
        // points at someone connected (the common case), see reassignHostIfNeeded's own guard.
        reassignHostIfNeeded(room);
        send(ws, {
          type: 'room_joined', code: room.code, playerId: existing.id, hostId: room.hostId, phase: room.phase,
          players: publicPlayers(room), questionCount: room.questionCount,
          current: room.phase === 'question'
            ? { text: room.roundQuestions[room.currentRoundIndex], index: room.currentRoundIndex, total: room.roundQuestions.length }
            : null,
        });
        broadcastLobbyState(room);
        return;
      }

      if (room.phase !== 'lobby') { room.pendingJoins.push({ ws, rawName: msg.name }); return send(ws, { type: 'room_in_progress' }); }
      if (room.players.size >= MAX_PLAYERS) return send(ws, { type: 'room_full' });
      const player = addPlayer(room, ws, msg.name);
      send(ws, { type: 'room_joined', code: room.code, playerId: player.id, hostId: room.hostId, phase: room.phase, players: publicPlayers(room), questionCount: room.questionCount });
      broadcastLobbyState(room);
      return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room || !ws.playerId) return;
    touchRoom(room);

    if (msg.type === 'set_question_count') {
      if (ws.playerId !== room.hostId || room.phase !== 'lobby') return;
      if (![5, 10, 15].includes(msg.count)) return;
      room.questionCount = msg.count;
      broadcastLobbyState(room);
      return;
    }

    if (msg.type === 'start_game') {
      if (ws.playerId !== room.hostId || room.phase !== 'lobby') return;
      if (!canStart(room).ok) return;
      resetRoundState(room);
      room.roundQuestions = pickRoundQuestions(room, room.questionCount);
      startCountdown(room);
      return;
    }

    if (msg.type === 'vote') {
      if (room.phase !== 'question' || room.votes.has(ws.playerId)) return;
      if (!room.players.has(msg.targetPlayerId)) return;
      room.votes.set(ws.playerId, msg.targetPlayerId);
      maybeEarlyResolve(room);
      return;
    }

    if (msg.type === 'continue_playing') {
      if (room.phase !== 'final') return;
      room.phase = 'lobby';
      resetRoundState(room);
      flushPendingJoins(room);
      broadcastLobbyState(room);
      return;
    }

    if (msg.type === 'leave_room') {
      removePlayer(room, ws.playerId);
      ws.roomCode = null; ws.playerId = null;
      return;
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    if (!room || !ws.playerId) return;
    const player = room.players.get(ws.playerId);
    if (!player) return;
    player.connected = false;
    // Host reassignment happens immediately, not after the reconnect grace period, per
    // _process/02-site-planner-plan.md edge case 3: a disconnected host must not block the room.
    if (room.hostId === ws.playerId) reassignHostIfNeeded(room);
    broadcastLobbyState(room);
    player.disconnectTimer = setTimeout(() => {
      if (room.players.get(ws.playerId) === player && !player.connected) removePlayer(room, ws.playerId);
    }, RECONNECT_GRACE_MS);
  });
});

// Idle-room cleanup, per _process/02-site-planner-plan.md edge case 4.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - room.lastActivity > ROOM_IDLE_MS) rooms.delete(code);
  }
}, 5 * 60 * 1000);

// Explicit 0.0.0.0 bind, per Render's own hosting requirement, not just Node's default behavior.
server.listen(PORT, '0.0.0.0', () => console.log(`Who's The Most running on port ${PORT}`));
