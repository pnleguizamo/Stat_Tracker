import React, { useEffect, useRef, useState } from 'react';
import { MINIGAME_CATALOG } from '../constants/minigameCatalog';
import { MinigameId } from 'types/game';

type Props = {
  minigameId: MinigameId;
  options: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
};

const StageOptionPanel: React.FC<Props> = ({ minigameId, options, onChange, disabled }) => {
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const entry = MINIGAME_CATALOG.find((m) => m.id === minigameId);
  const schema = entry?.optionSchema;

  useEffect(() => {
    if (!expanded) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        setExpanded(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [expanded]);

  useEffect(() => {
    if (disabled) {
      setExpanded(false);
    }
  }, [disabled]);

  if (!schema?.length) return null;

  return (
    <div className="game-shell-slot-options-wrap" ref={panelRef}>
      <button
        type="button"
        className="game-shell-options-trigger"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        disabled={disabled}
        aria-expanded={expanded}
        aria-label="Stage options"
        title="Stage options"
      >
        <span className="game-shell-options-dot" />
        <span className="game-shell-options-dot" />
        <span className="game-shell-options-dot" />
      </button>
      <div className={`game-shell-slot-options${expanded ? ' is-expanded' : ''}`}>
        {schema.map((field) => (
          <div key={field.key} className="game-shell-option-row">
            <label className="game-shell-option-label">{field.label}</label>
            {field.type === 'select' ? (
              <select
                className="game-shell-select"
                value={String(options[field.key] ?? field.default)}
                disabled={disabled}
                onChange={(e) => {
                  const raw = e.target.value;
                  const opt = field.options?.find((o) => String(o.value) === raw);
                  onChange(field.key, opt ? opt.value : raw);
                }}
              >
                {field.options?.map((opt) => (
                  <option key={String(opt.value)} value={String(opt.value)}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                className="game-shell-input game-shell-input--option"
                value={String(options[field.key] ?? field.default)}
                min={field.min}
                max={field.max}
                step={field.step}
                disabled={disabled}
                onChange={(e) => onChange(field.key, Number(e.target.value))}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default StageOptionPanel;
