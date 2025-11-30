import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from 'lib/api';
import { socket } from '../socket';
import { useNavigate, useParams } from 'react-router-dom';
import { RoomState, StageConfig, MinigameId } from "@game/shared";


export const StagePlanner: React.FC = () => {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const [stagePlan, setStagePlan] = useState<StageConfig[]>([
    { index: 0, minigameId: 'WHO_LISTENED_MOST' },
    { index: 1, minigameId: 'GENRE_GUESS' },
    { index: 2, minigameId: 'OUTLIER_MODE' },
  ]);

  useEffect(() => {
    const handleStagePlanUpdated = (payload: { stagePlan: StageConfig[] }) => {
      setStagePlan(payload.stagePlan);
    };
    socket.on('stagePlanUpdated', handleStagePlanUpdated);
    return () => {
        socket.off('stagePlanUpdated', handleStagePlanUpdated)
    };
  }, []);

  const handleReorderOrChange = (newPlan: StageConfig[]) => {
    setStagePlan(newPlan);
    socket.emit('updateStagePlan', { roomCode, stagePlan: newPlan });
  };

  const handleBeginMatch = () => {
    socket.emit('lockStagePlanAndStart', { roomCode }, (res: any) => {
      if (res?.ok) {
        navigate(`/game/host/${roomCode}/play`);
      }
    });
  };

  return (
    <div>
      {/* minigame catalog list + 3 stage slots UI here */}
      <button onClick={handleBeginMatch}>Begin Match</button>
    </div>
  );
};
