import { MinigameId } from './Minigame';

export interface StageConfig {
  index: number;
  minigameId: MinigameId;
  customOptions?: Record<string, unknown>;
}
