import { StageConfig } from "./StageConfig";
import { RoomState } from "./RoomState";

export interface ServerToClientEvents {
  roomUpdated: (room: RoomState) => void;
  stagePlanUpdated: (payload: { stagePlan: StageConfig[] }) => void;
  gameStateUpdated: (state: RoomState) => void;
}

export interface ClientToServerEvents {
  hostJoin: (payload: { roomCode: string }, cb?: (res: any) => void) => void;
  joinRoom: (payload: { roomCode: string; displayName: string }, cb?: any) => void;
  enterStageConfig: (payload: { roomCode: string }, cb?: any) => void;
  updateStagePlan: (payload: { roomCode: string; stagePlan: StageConfig[] }, cb?: any) => void;
  lockStagePlanAndStart: (payload: { roomCode: string }, cb?: any) => void;
}
