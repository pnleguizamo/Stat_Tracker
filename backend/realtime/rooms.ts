import { RoomState, StageConfig, MinigameId } from "@game/shared";

const rooms: Map<string, RoomState> = new Map();

export function getRoom(roomCode: string): RoomState | undefined {
  return rooms.get(roomCode);
}

export function updateStagePlan(
  roomCode: string,
  stagePlan: StageConfig[]
): RoomState | null {
  const room = rooms.get(roomCode);
  if (!room) return null;

  if (stagePlan.length !== 3) return null;

  room.stagePlan = stagePlan;
  room.phase = 'stageConfig';
  return room;
}

export function startGame(roomCode: string): RoomState | null {
  const room = rooms.get(roomCode);
  if (!room) return null;
  if (!room.stagePlan || room.stagePlan.length !== 3) return null;

  room.phase = 'inGame';
  room.currentStageIndex = 0;

  return room;
}
