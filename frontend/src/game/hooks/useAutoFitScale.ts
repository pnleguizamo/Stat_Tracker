import { RefCallback, useCallback, useEffect, useRef, useState } from "react";

type UseAutoFitScaleOptions = {
  minScale?: number;
  maxScale?: number;
  allowUpscale?: boolean;
  contentVersion?: string | number | boolean | null;
};

type SyncScaleMode = "snap" | "animate";
type SyncScaleOptions = {
  mode?: SyncScaleMode;
};

const LERP = 0.35;
const SETTLE = 0.0015;
const BASE_GUARD = 0.0001;

const ZOOM_SUPPORTED =
  typeof CSS !== "undefined" && CSS.supports("zoom", "1");

export const useAutoFitScale = ({
  minScale = 0.1,
  maxScale = Number.POSITIVE_INFINITY,
  allowUpscale = true,
  contentVersion,
}: UseAutoFitScaleOptions = {}) => {
  const viewportNodeRef = useRef<HTMLDivElement | null>(null);
  const canvasNodeRef = useRef<HTMLDivElement | null>(null);
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null);
  const [canvasNode, setCanvasNode] = useState<HTMLDivElement | null>(null);

  const targetScaleRef = useRef(1);
  const currentScaleRef = useRef(1);
  const computeRafRef = useRef<number | null>(null);
  const animRafRef = useRef<number | null>(null);
  const firstSyncRef = useRef(true);
  const preferredModeRef = useRef<SyncScaleMode>("animate");

  const viewportRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
    viewportNodeRef.current = node;
    setViewportNode(node);
  }, []);

  const canvasRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
    canvasNodeRef.current = node;
    setCanvasNode(node);
  }, []);

  const applyScale = useCallback((scale: number) => {
    const canvas = canvasNodeRef.current;
    if (!canvas) return;

    if (ZOOM_SUPPORTED) {
      canvas.style.setProperty("zoom", String(scale));
      canvas.style.width = `calc(100% / ${scale})`;
    } else {
      // fallback if zoom not supported
      const vw =
        viewportNodeRef.current?.clientWidth ??
        canvas.parentElement?.clientWidth ??
        window.innerWidth;
      if (!vw) return;
      canvas.style.width = `${vw / scale}px`;
      canvas.style.transformOrigin = "top left";
      canvas.style.transform = `scale(${scale})`;
    }
  }, []);

  const animate = useCallback(() => {
    const current = currentScaleRef.current;
    const target = targetScaleRef.current;
    const diff = target - current;

    if (Math.abs(diff) < SETTLE) {
      currentScaleRef.current = target;
      applyScale(target);
      animRafRef.current = null;
      return;
    }

    const next = current + diff * LERP;
    currentScaleRef.current = next;
    applyScale(next);
    animRafRef.current = requestAnimationFrame(animate);
  }, [applyScale]);

  const stopAnimation = useCallback(() => {
    if (!animRafRef.current) return;
    cancelAnimationFrame(animRafRef.current);
    animRafRef.current = null;
  }, []);

  const syncScale = useCallback((options: SyncScaleOptions = {}) => {
    if (options.mode) preferredModeRef.current = options.mode;
    const mode = options.mode ?? preferredModeRef.current;
    
    if (computeRafRef.current) cancelAnimationFrame(computeRafRef.current);
    computeRafRef.current = requestAnimationFrame(() => {
      computeRafRef.current = null;
      const viewport = viewportNodeRef.current;
      const canvas = canvasNodeRef.current;
      if (!viewport || !canvas) return;

      const viewportHeight = viewport.clientHeight;
      const renderedHeight = canvas.getBoundingClientRect().height;
      const currentScale = Math.max(BASE_GUARD, currentScaleRef.current);
      const naturalHeight = renderedHeight / currentScale;
      if (!viewportHeight || !naturalHeight) return;

      let nextScale = viewportHeight / naturalHeight;
      if (!allowUpscale) nextScale = Math.min(1, nextScale);
      nextScale = Math.min(maxScale, Math.max(minScale, nextScale));
      const scaleDelta = Math.abs(nextScale - currentScaleRef.current);

      targetScaleRef.current = nextScale;

      if (firstSyncRef.current) {
        firstSyncRef.current = false;
        stopAnimation();
        currentScaleRef.current = nextScale;
        applyScale(nextScale);
        return;
      }

      if (scaleDelta < SETTLE) {
        stopAnimation();
        currentScaleRef.current = nextScale;
        return;
      }

      if (mode === "snap") {
        stopAnimation();
        currentScaleRef.current = nextScale;
        applyScale(nextScale);
        return;
      }

      if (!animRafRef.current) {
        animRafRef.current = requestAnimationFrame(animate);
      }
    });
  }, [allowUpscale, animate, applyScale, maxScale, minScale, stopAnimation]);

  useEffect(() => {
    syncScale();
    if (!viewportNode || !canvasNode) return;

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            for (const entry of entries) {
              if (entry.target !== viewportNodeRef.current) continue;
              if (preferredModeRef.current === "snap") continue;
              if (computeRafRef.current || animRafRef.current) continue;
              syncScale();
            }
          });
    observer?.observe(viewportNode);

    const onWindowResize = () => syncScale();
    window.addEventListener("resize", onWindowResize);

    return () => {
      if (computeRafRef.current) {
        cancelAnimationFrame(computeRafRef.current);
        computeRafRef.current = null;
      }
      stopAnimation();
      observer?.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [viewportNode, canvasNode, stopAnimation, syncScale]);

  useEffect(() => {
    if (contentVersion === undefined || !viewportNode || !canvasNode) return;
    syncScale();
    const rafId = window.requestAnimationFrame(() => syncScale());
    const timeoutId = window.setTimeout(() => syncScale(), 160);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
    };
  }, [contentVersion, viewportNode, canvasNode, syncScale]);

  return { viewportRef, canvasRef, syncScale };
};
