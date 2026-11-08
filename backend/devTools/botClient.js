const { actionKey, makeActions, seededRandom } = require('./botActions');

function emitAck(socket, event, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, payload, (err, response) => {
      if (err) return reject(new Error(`${event}: acknowledgement timed out`));
      if (!response?.ok) return reject(new Error(`${event}: ${response?.error || 'rejected'}`));
      resolve(response);
    });
  });
}

function startBot(socket, config, log = console.log) {
  const { roomCode, userId, index = 0, seed = 'trailer', scripts = {},
    minDelayMs = 2500, maxDelayMs = 6000, disconnectAfterMs, reconnectAfterMs = 1500 } = config;
  const playerId = config.playerId;
  const label = config.displayName || userId;
  let state, timer, ready = false, stopped = false, pending = null;
  let joining = 0;
  const completed = new Set();
  const roundNumbers = new Map();
  const counters = new Map();
  const lifecycleTimers = [];
  const cancel = () => { clearTimeout(timer); timer = null; pending = null; };

  function update(next) {
    if (next.roomCode !== roomCode || stopped) return;
    state = next;
    const key = actionKey(state);
    if (pending && pending !== key) cancel();
    if (!ready || !key || pending || completed.has(key)) return;
    const r = state.currentRoundState;
    const roundKey = `${state.currentStageIndex}:${r.id}`;
    if (!roundNumbers.has(roundKey)) {
      const group = `${state.currentStageIndex}:${r.minigameId}`;
      roundNumbers.set(roundKey, counters.get(group) || 0);
      counters.set(group, (counters.get(group) || 0) + 1);
    }
    const script = scripts[r.minigameId]?.[roundNumbers.get(roundKey)] || {};
    const rng = seededRandom(`${seed}:${userId}:${state.currentStageIndex}:${roundNumbers.get(roundKey)}:${r.currentSnippetIndex ?? ''}`);
    const delay = script.delayMs ?? Math.round(minDelayMs + rng() * (maxDelayMs - minDelayMs));
    if (!Number.isFinite(delay) || delay < 0) {
      completed.add(key);
      log(`[${label}] invalid delayMs`);
      return;
    }
    const generation = joining;
    pending = key;
    timer = setTimeout(async () => {
      // Re-read the latest server state, including answers restored on reconnect.
      if (!ready || joining !== generation || actionKey(state) !== key || pending !== key) return;
      try {
        const actions = makeActions(state, playerId, script, rng, index);
        for (const action of actions) {
          if (!ready || joining !== generation || pending !== key || actionKey(state) !== key) break;
          await emitAck(socket, action.event, { roomCode, ...action.payload });
          log(`[${label}] ${action.event.split(':').pop()} accepted (${r.minigameId})`);
        }
      } catch (err) {
        // Never blindly retry an acknowledgement timeout: the action may have landed.
        log(`[${label}] ${err.message}`);
      } finally {
        if (joining === generation) {
          completed.add(key);
          if (pending === key) cancel();
        }
      }
    }, delay);
  }

  socket.on('gameStateUpdated', update);
  socket.on('connect', async () => {
    const attempt = ++joining;
    ready = false;
    cancel();
    try {
      const joined = await emitAck(socket, 'joinRoom', { roomCode });
      if (joined.players.some(p => p.userId === userId && p.playerId !== playerId)) {
        throw new Error('This database user already has another player in this room');
      }
      const response = await emitAck(socket, 'playerJoinGame', { roomCode });
      if (stopped || !socket.connected || attempt !== joining) return;
      ready = true;
      completed.clear();
      log(`[${label}] joined ${roomCode} as ${playerId}`);
      if (response.state) update(response.state);
    } catch (err) {
      log(`[${label}] join failed: ${err.message}`);
      socket.emit('leaveRoom', { roomCode });
      socket.disconnect();
    }
  });
  socket.on('disconnect', reason => {
    joining++;
    ready = false;
    cancel();
    log(`[${label}] disconnected: ${reason}`);
  });
  socket.on('connect_error', err => log(`[${label}] connection failed: ${err.message}`));
  socket.io.on('reconnect_attempt', n => log(`[${label}] reconnect attempt ${n}`));
  if (disconnectAfterMs != null) lifecycleTimers.push(setTimeout(() => {
    if (stopped) return;
    socket.disconnect();
    lifecycleTimers.push(setTimeout(() => { if (!stopped) socket.connect(); }, reconnectAfterMs));
  }, disconnectAfterMs));
  socket.connect();
  return () => {
    stopped = true;
    ready = false;
    cancel();
    lifecycleTimers.forEach(clearTimeout);
    if (socket.connected) socket.emit('leaveRoom', { roomCode });
    socket.disconnect();
  };
}
module.exports = { startBot, emitAck };
