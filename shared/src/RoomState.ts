import { StageConfig } from "./StageConfig";

export type Phase =
  | "playerLobby"
  | "stageConfig"
  | "inGame"
  | "finished";

export interface RoomState {
  roomCode: string;
  hostSocketId: string;
  players: Record<string, { name: string }>;
  phase: Phase;
  stagePlan: StageConfig[];
  currentStageIndex: number | null;
}
