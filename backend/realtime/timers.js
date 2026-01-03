function ensureTimerBucket(room) {
  room.roundTimers = room.roundTimers || {};
  return room.roundTimers;
}

function clearRoundTimer(room, stageIndex) {
  if (!room?.roundTimers) return;
  const existing = room.roundTimers[stageIndex];
  if (existing?.handle) clearTimeout(existing.handle);
  delete room.roundTimers[stageIndex];
}

function scheduleRoundTimer(room, stageIndex, durationMs, onExpire) {
  const timers = ensureTimerBucket(room);
  if (timers[stageIndex]?.handle) {
    clearTimeout(timers[stageIndex].handle);
  }
  const expiresAt = Date.now() + durationMs;
  const handle = setTimeout(() => {
    delete timers[stageIndex];
    onExpire?.();
  }, durationMs);
  timers[stageIndex] = { handle, expiresAt };
  return expiresAt;
}

module.exports = {
  scheduleRoundTimer,
  clearRoundTimer,
};
