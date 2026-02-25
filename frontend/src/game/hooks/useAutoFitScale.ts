import { RefCallback, useCallback, useEffect, useRef, useState } from "react";

type UseAutoFitScaleOptions = {
  epsilon?: number;
  minScale?: number;
  maxScale?: number;
  allowUpscale?: boolean;
};

const DEFAULT_EPSILON = 0.001;
const DEFAULT_MIN_SCALE = 0.1;
const DEFAULT_MAX_SCALE = Number.POSITIVE_INFINITY;
const BASE_SCALE_GUARD = 0.0001;

export const useAutoFitScale = ({
  epsilon = DEFAULT_EPSILON,
  minScale = DEFAULT_MIN_SCALE,
  maxScale = DEFAULT_MAX_SCALE,
  allowUpscale = true,
}: UseAutoFitScaleOptions = {}) => {
  const viewportNodeRef = useRef<HTMLDivElement | null>(null);
  const canvasNodeRef = useRef<HTMLDivElement | null>(null);
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null);
  const [canvasNode, setCanvasNode] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const rafIdRef = useRef<number | null>(null);

  const viewportRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
    viewportNodeRef.current = node;
    setViewportNode(node);
  }, []);

  const canvasRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
    canvasNodeRef.current = node;
    setCanvasNode(node);
  }, []);

  const syncScale = useCallback(() => {
    const viewportNode = viewportNodeRef.current;
    const canvasNode = canvasNodeRef.current;
    if (!viewportNode || !canvasNode) return;

    if (rafIdRef.current) window.cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = window.requestAnimationFrame(() => {
      const viewportHeight = viewportNode.clientHeight;
      const { height: renderedHeight } = canvasNode.getBoundingClientRect();
      const currentScale = Math.max(BASE_SCALE_GUARD, scaleRef.current);
      const baseHeight = renderedHeight / currentScale;
      if (!viewportHeight || !baseHeight) return;

      let nextScale = viewportHeight / baseHeight;
      if (!allowUpscale) {
        nextScale = Math.min(1, nextScale);
      }
      nextScale = Math.min(maxScale, Math.max(minScale, nextScale));

      setScale((previousScale) =>
        Math.abs(previousScale - nextScale) < epsilon ? previousScale : nextScale
      );
    });
  }, [allowUpscale, epsilon, maxScale, minScale]);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    syncScale();
    if (!viewportNode || !canvasNode) return;

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncScale);
    observer?.observe(viewportNode);
    observer?.observe(canvasNode);
    window.addEventListener("resize", syncScale);

    return () => {
      if (rafIdRef.current) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      observer?.disconnect();
      window.removeEventListener("resize", syncScale);
    };
  }, [canvasNode, syncScale, viewportNode]);

  return {
    viewportRef,
    canvasRef,
    scale,
    syncScale,
  };
};
