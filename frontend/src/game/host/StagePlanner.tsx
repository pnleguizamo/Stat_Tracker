import React, { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../../socket';
import { useNavigate, useParams } from 'react-router-dom';
import { StageConfig, MinigameId } from 'types/game';
import '../../styles/gameShell.css';

type DragState = {
  minigameId: MinigameId;
  pointerId: number;
  width: number;
  height: number;
  x: number;
  y: number;
  sourceX: number;
  sourceY: number;
  offsetX: number;
  offsetY: number;
  phase: 'dragging' | 'snapback' | 'snaptarget';
};

const StagePlanner: React.FC = () => {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const [stagePlan, setStagePlan] = useState<StageConfig[]>([
    { index: 0, minigameId: 'HEARDLE' },
    { index: 1, minigameId: 'WHO_LISTENED_MOST' },
    { index: 2, minigameId: 'GUESS_SPOTIFY_WRAPPED' },
  ]);
  const [activeDropSlot, setActiveDropSlot] = useState<number | null>(null);
  const [recentlyDroppedSlot, setRecentlyDroppedSlot] = useState<number | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dropAnimationTimeoutRef = useRef<number | null>(null);
  const snapBackTimeoutRef = useRef<number | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const stagePlanRef = useRef<StageConfig[]>(stagePlan);
  const slotRefs = useRef<Record<number, HTMLDivElement | null>>({});

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
  }, [roomCode]);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    stagePlanRef.current = stagePlan;
  }, [stagePlan]);

  useEffect(() => {
    return () => {
      if (dropAnimationTimeoutRef.current) {
        window.clearTimeout(dropAnimationTimeoutRef.current);
        dropAnimationTimeoutRef.current = null;
      }
      if (snapBackTimeoutRef.current) {
        window.clearTimeout(snapBackTimeoutRef.current);
        snapBackTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!dragState?.pointerId || dragState.phase !== 'dragging') return;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = prevUserSelect;
    };
  }, [dragState?.pointerId, dragState?.phase]);

  const handleReorderOrChange = useCallback((newPlan: StageConfig[]) => {
    setStagePlan(newPlan);
    socket.emit('updateStagePlan', { roomCode, stagePlan: newPlan });
  }, [roomCode]);

  const handleBeginMatch = () => {
    socket.emit('lockStagePlanAndStart', { roomCode }, (res: any) => {
      if (res?.ok) {
        navigate(`/game/host/${roomCode}/play`);
      }
    });
  };

  const MINIGAMES: { id: MinigameId; name: string; desc?: string }[] = [
    { id: 'WHO_LISTENED_MOST', name: 'Who Listened Most' },
    { id: 'GUESS_SPOTIFY_WRAPPED', name: 'Guess the Wrapped' },
    { id: 'HEARDLE', name: 'Heardle' },
    // { id: 'FIRST_PLAY', name: 'First Play' },
    // { id: 'GENRE_GUESS', name: 'Genre Guess' },
    // { id: 'GRAPH_GUESS', name: 'Graph Guess' },
    // { id: 'OUTLIER_MODE', name: 'Outlier Mode' },
  ];

  function findDropSlot(clientX: number, clientY: number): number | null {
    for (const i of [0, 1, 2]) {
      const el = slotRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return i;
      }
    }
    return null;
  }

  const finishDrag = useCallback((dropSlot: number | null, minigameId: MinigameId) => {
    const currentDrag = dragStateRef.current;
    if (dropSlot !== null) {
      const newPlan = [...stagePlanRef.current];
      newPlan[dropSlot] = { index: dropSlot, minigameId };
      handleReorderOrChange(newPlan);
      setRecentlyDroppedSlot(dropSlot);
      if (dropAnimationTimeoutRef.current) {
        window.clearTimeout(dropAnimationTimeoutRef.current);
      }
      dropAnimationTimeoutRef.current = window.setTimeout(() => {
        setRecentlyDroppedSlot(null);
        dropAnimationTimeoutRef.current = null;
      }, 280);

      const targetEl = slotRefs.current[dropSlot];
      const targetRect = targetEl?.getBoundingClientRect();
      if (currentDrag && targetRect) {
        const targetX = targetRect.left + 12;
        const targetY = targetRect.top + Math.max(0, (targetRect.height - currentDrag.height) / 2);
        setDragState({
          ...currentDrag,
          x: targetX,
          y: targetY,
          phase: 'snaptarget',
        });
      } else {
        setDragState(null);
      }

      if (snapBackTimeoutRef.current) {
        window.clearTimeout(snapBackTimeoutRef.current);
      }
      snapBackTimeoutRef.current = window.setTimeout(() => {
        setDragState(null);
        setActiveDropSlot(null);
        snapBackTimeoutRef.current = null;
      }, 420);
      return;
    }

    setActiveDropSlot(null);
    setDragState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        x: prev.sourceX,
        y: prev.sourceY,
        phase: 'snapback',
      };
    });
    if (snapBackTimeoutRef.current) {
      window.clearTimeout(snapBackTimeoutRef.current);
    }
    snapBackTimeoutRef.current = window.setTimeout(() => {
      setDragState(null);
      snapBackTimeoutRef.current = null;
    }, 240);
  }, [handleReorderOrChange]);

  function onPointerDownMinigame(e: React.PointerEvent<HTMLDivElement>, minigameId: MinigameId) {
    if (e.pointerType !== 'touch' && e.button !== 0) return;
    e.preventDefault();
    if (snapBackTimeoutRef.current) {
      window.clearTimeout(snapBackTimeoutRef.current);
      snapBackTimeoutRef.current = null;
    }
    const sourceEl = e.currentTarget;
    const rect = sourceEl.getBoundingClientRect();
    const nextDrag: DragState = {
      minigameId,
      pointerId: e.pointerId,
      width: rect.width,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      sourceX: rect.left,
      sourceY: rect.top,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      phase: 'dragging',
    };
    setDragState(nextDrag);
    setActiveDropSlot((prev) => {
      const next = findDropSlot(e.clientX, e.clientY);
      return prev === next ? prev : next;
    });
  }

  useEffect(() => {
    if (!dragState?.pointerId || dragState.phase !== 'dragging') return;

    const handlePointerMove = (e: PointerEvent) => {
      const current = dragStateRef.current;
      if (!current || current.pointerId !== e.pointerId || current.phase !== 'dragging') return;
      e.preventDefault();
      const nextX = e.clientX - current.offsetX;
      const nextY = e.clientY - current.offsetY;
      setDragState({ ...current, x: nextX, y: nextY });
      setActiveDropSlot((prev) => {
        const next = findDropSlot(e.clientX, e.clientY);
        return prev === next ? prev : next;
      });
    };

    const handlePointerUp = (e: PointerEvent) => {
      const current = dragStateRef.current;
      if (!current || current.pointerId !== e.pointerId || current.phase !== 'dragging') return;
      const dropSlot = findDropSlot(e.clientX, e.clientY);
      finishDrag(dropSlot, current.minigameId);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState?.pointerId, dragState?.phase, finishDrag]);

  const draggedMinigame = dragState ? MINIGAMES.find((m) => m.id === dragState.minigameId) : null;

  return (
    <div className={`game-shell-layout${dragState?.phase === 'dragging' ? ' is-pointer-dragging' : ''}`}>
      <div className="game-shell-content">
        <div className="game-shell-surface" style={{ marginBottom: '1rem' }}>
          <h2 className="player-title">Stage Planner{roomCode ? ` — Room ${roomCode}` : ''}</h2>
          <div className="game-shell-muted">Drag a minigame from the catalog onto a stage slot.</div>
        </div>

        <div className="game-shell-two-col">
          <section className="game-shell-surface">
            <h3 className="game-shell-section-title">Minigame Catalog</h3>
            <div className="game-shell-list">
              {MINIGAMES.map((m) => (
                <div
                  key={m.id}
                  onPointerDown={(e) => onPointerDownMinigame(e, m.id)}
                  className={`game-shell-draggable${dragState?.minigameId === m.id ? ' is-source-hidden' : ''}`}
                >
                  <div style={{ fontWeight: 700 }}>{m.name}</div>
                  {m.desc && <div className="game-shell-muted" style={{ fontSize: 12 }}>{m.desc}</div>}
                </div>
              ))}
            </div>
          </section>

          <section className="game-shell-surface">
            <h3 className="game-shell-section-title">Stages</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[0, 1, 2].map((i) => {
                const config = stagePlan.find((s) => s.index === i) || { index: i, minigameId: 'WHO_LISTENED_MOST' };
                const assigned = MINIGAMES.find((m) => m.id === config.minigameId);
                return (
                  <div
                    key={i}
                    ref={(el) => {
                      slotRefs.current[i] = el;
                    }}
                    className={`game-shell-slot${activeDropSlot === i ? ' is-drop-target' : ''}${
                      recentlyDroppedSlot === i ? ' is-dropped' : ''
                    }`}
                  >
                    <div className="game-shell-stage-text">
                      <div className="game-shell-stage-index">Stage {i + 1}</div>
                      <div className="game-shell-stage-name">
                        {assigned ? assigned.name : String(config.minigameId)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 18 }}>
              <button className="game-shell-button" onClick={handleBeginMatch}>Lock & Start Match</button>
            </div>
          </section>
        </div>
      </div>
      {dragState && draggedMinigame && (
        <div
          className={`game-shell-draggable game-shell-drag-float${
            dragState.phase === 'snapback' ? ' is-snapback' : dragState.phase === 'snaptarget' ? ' is-snaptarget' : ''
          }`}
          style={{
            width: dragState.width,
            height: dragState.height,
            transform: `translate3d(${dragState.x}px, ${dragState.y}px, 0)`,
          }}
        >
          <div style={{ fontWeight: 700 }}>{draggedMinigame.name}</div>
          {draggedMinigame.desc && <div className="game-shell-muted" style={{ fontSize: 12 }}>{draggedMinigame.desc}</div>}
        </div>
      )}
    </div>
  );
};

export default StagePlanner;
