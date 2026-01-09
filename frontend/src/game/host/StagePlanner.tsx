import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from 'lib/api';
import { socket } from '../../socket';
import { useNavigate, useParams } from 'react-router-dom';
import { StageConfig, MinigameId } from 'types/game';


const StagePlanner: React.FC = () => {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const [stagePlan, setStagePlan] = useState<StageConfig[]>([
    { index: 0, minigameId: 'HEARDLE' },
    { index: 1, minigameId: 'WHO_LISTENED_MOST' },
    { index: 2, minigameId: 'GUESS_SPOTIFY_WRAPPED' },
  ]);

  useEffect(() => {
    const handleStagePlanUpdated = (payload: { stagePlan: StageConfig[] }) => {
      setStagePlan(payload.stagePlan);
    };
    socket.on('stagePlanUpdated', handleStagePlanUpdated);
    // ask server for current stage plan when mounting
    if (roomCode) {
      socket.emit('enterStageConfig', { roomCode }, (res: any) => {
        // ignoring callback; server will emit 'stagePlanUpdated'
      });
    }

    return () => {
      socket.off('stagePlanUpdated', handleStagePlanUpdated);
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

  const MINIGAMES: { id: MinigameId; name: string; desc?: string }[] = [
    { id: 'HEARDLE', name: 'Heardle' },
    { id: 'WHO_LISTENED_MOST', name: 'Who Listened Most' },
    { id: 'GUESS_SPOTIFY_WRAPPED', name: 'Guess the Wrapped' },
    { id: 'FIRST_PLAY', name: 'First Play' },
    { id: 'GENRE_GUESS', name: 'Genre Guess' },
    { id: 'GRAPH_GUESS', name: 'Graph Guess' },
    { id: 'OUTLIER_MODE', name: 'Outlier Mode' },
  ];

  function onDragStart(e: React.DragEvent, id: MinigameId) {
    e.dataTransfer.setData('text/plain', id);
  }

  function onDropToSlot(e: React.DragEvent, slotIndex: number) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') as MinigameId;
    if (!id) return;
    const newPlan = [...stagePlan];
    newPlan[slotIndex] = { index: slotIndex, minigameId: id };
    handleReorderOrChange(newPlan);
  }

  function onAllowDrop(e: React.DragEvent) {
    e.preventDefault();
  }

  return (
    <div>
      <h2 style={{ padding: '1rem 0' }}>Stage Planner{roomCode ? ` — Room ${roomCode}` : ''}</h2>

      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ flex: 1 }}>
          <h3>Minigame Catalog</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {MINIGAMES.map((m) => (
              <div
                key={m.id}
                draggable
                onDragStart={(e) => onDragStart(e, m.id)}
                style={{
                  padding: 8,
                  border: '1px solid #ddd',
                  borderRadius: 6,
                  background: '#fff',
                  cursor: 'grab',
                }}
              >
                <div style={{ fontWeight: 700 }}>{m.name}</div>
                {m.desc && <div style={{ fontSize: 12, color: '#666' }}>{m.desc}</div>}
              </div>
            ))}
          </div>
        </div>

        <div style={{ width: 420 }}>
          <h3>Stages</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[0, 1, 2].map((i) => {
              const config = stagePlan.find((s) => s.index === i) || { index: i, minigameId: 'WHO_LISTENED_MOST' };
              const assigned = MINIGAMES.find((m) => m.id === config.minigameId);
              return (
                <div
                  key={i}
                  onDrop={(e) => onDropToSlot(e, i)}
                  onDragOver={onAllowDrop}
                  style={{
                    minHeight: 72,
                    border: '2px dashed #bbb',
                    borderRadius: 8,
                    padding: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: '#fafafa',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, color: '#333', fontWeight: 700 }}>Stage {i + 1}</div>
                    <div style={{ fontSize: 13, color: '#555' }}>{assigned ? assigned.name : String(config.minigameId)}</div>
                  </div>
                  <div>
                    <button
                      onClick={() => {
                        // clear slot
                        const newPlan = [...stagePlan];
                        newPlan[i] = { index: i, minigameId: 'WHO_LISTENED_MOST' };
                        handleReorderOrChange(newPlan);
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 18 }}>
            <button onClick={handleBeginMatch}>Lock & Start Match</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StagePlanner;
