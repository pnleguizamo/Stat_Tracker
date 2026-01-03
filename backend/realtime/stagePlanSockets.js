const minigameRegistry = require('./minigames');

// TODOo determine if even necessary
const ensureStageState = async (room) => {
  try {
    if (!room || !room.stagePlan) return;
    const stageIndex = typeof room.currentStageIndex === 'number' ? room.currentStageIndex : 0;
    const stageConfig = room.stagePlan[stageIndex];
    if (!stageConfig) return;
    room.roundState = room.roundState || {};
    if (room.roundState[stageIndex]) return;

    const stageModule = minigameRegistry.modules?.[stageConfig.minigameId];
    if (stageModule?.createRoundState) {
      // await stageModule.createRoundState(room, { stageIndex });
      return;
    }

    room.roundState[stageIndex] = {
      id: `pending-${stageConfig.minigameId}-${Date.now()}`,
      prompt: {
        type: 'INFO',
        title: 'Coming soon',
        subtitle: stageConfig.minigameId,
        description: `${stageConfig.minigameId} is not available yet.`,
      },
      status: 'pending',
      answers: {},
    };
  } catch (err) {
    console.error('Ensure stage state failed ', err);
  }
};

function registerStagePlanListeners(io, socket, deps) {
  const { getRoom, updateStagePlan, startGame, getRoomPayload, broadcastGameState } = deps;

  socket.on('enterStageConfig', ({ roomCode }, cb) => {
    const room = getRoom(roomCode);
    if (!room) {
      cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      return;
    }
    room.phase = 'stageConfig';
    const payload = getRoomPayload(roomCode);
    io.to(payload.hostSocketId).emit('stagePlanUpdated', {
      stagePlan: room.stagePlan,
    });
    cb?.({ ok: true });
  });

  socket.on('updateStagePlan', async ({ roomCode, stagePlan }, cb) => {
    const updated = updateStagePlan(roomCode, stagePlan);
    if (!updated) {
      cb?.({ ok: false, error: 'INVALID_STAGE_PLAN' });
      return;
    }
    const payload = getRoomPayload(roomCode);
    io.to(payload.hostSocketId).emit('stagePlanUpdated', {
      stagePlan: updated.stagePlan,
    });
    if (!roomCode) {
      cb?.({ ok: false, error: 'ROOM_REQUIRED' });
      return;
    }
    const room = getRoom(roomCode);
    if (!room) {
      cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      return;
    }
    if (room.hostSocketId !== socket.id) {
      cb?.({ ok: false, error: 'NOT_HOST' });
      return;
    }

    // const started = startGame(roomCode);
    // if (!started) {
    //   cb?.({ ok: false, error: 'CANT_START' });
    //   return;
    // }

    await ensureStageState(room);
    broadcastGameState(roomCode); // TODOo Broadcast causes players to navigate prematurely (because of commented startGame)

    cb?.({ ok: true });
  });

  socket.on('lockStagePlanAndStart', async ({ roomCode }, cb) => {
    if (!roomCode) {
      cb?.({ ok: false, error: 'ROOM_REQUIRED' });
      return;
    }
    const room = getRoom(roomCode);
    if (!room) {
      cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      return;
    }
    if (room.hostSocketId !== socket.id) {
      cb?.({ ok: false, error: 'NOT_HOST' });
      return;
    }

    const started = startGame(roomCode);
    if (!started) {
      cb?.({ ok: false, error: 'CANT_START' });
      return;
    }

    await ensureStageState(started);
    broadcastGameState(roomCode);

    cb?.({ ok: true });
  });

  socket.on('advanceStageOrRound', async ({ roomCode } = {}, cb) => {
    if (!roomCode) {
      cb?.({ ok: false, error: 'ROOM_REQUIRED' });
      return;
    }
    const room = getRoom(roomCode);
    if (!room) {
      cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      return;
    }
    if (room.hostSocketId !== socket.id) {
      cb?.({ ok: false, error: 'NOT_HOST' });
      return;
    }
    if (typeof room.currentStageIndex !== 'number') {
      cb?.({ ok: false, error: 'NO_STAGE_ACTIVE' });
      return;
    }

    const nextIndex = room.currentStageIndex + 1;
    if (!room.stagePlan || nextIndex >= room.stagePlan.length) {
      room.phase = 'completed';
      broadcastGameState(roomCode);
      cb?.({ ok: true, completed: true });
      return;
    }

    room.currentStageIndex = nextIndex;
    room.roundState = room.roundState || {};
    delete room.roundState[nextIndex];
    await ensureStageState(room);
    broadcastGameState(roomCode);
    cb?.({ ok: true, currentStageIndex: room.currentStageIndex });
  });
}

module.exports = { registerStagePlanListeners };
