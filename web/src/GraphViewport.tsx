import { type ReactNode, useRef, useState } from 'react';

interface Props {
  width: number;
  height: number;
  children: ReactNode;
  overlay?: ReactNode;
}

interface PanState {
  x: number;
  y: number;
  zoom: number;
}

interface DragState {
  pointerX: number;
  pointerY: number;
  panX: number;
  panY: number;
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.2;
const INITIAL_PAN = 20;

export function GraphViewport({ width, height, children, overlay }: Props) {
  const [pan, setPan] = useState<PanState>({ x: INITIAL_PAN, y: INITIAL_PAN, zoom: 1 });
  const [panning, setPanning] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const zoomFactor = Math.exp(-event.deltaY * 0.0015);

    setPan((current) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.zoom * zoomFactor));
      const scaleDelta = zoom / current.zoom;
      return {
        zoom,
        x: mouseX - scaleDelta * (mouseX - current.x),
        y: mouseY - scaleDelta * (mouseY - current.y),
      };
    });
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, a, input, textarea, [data-nopan]')) return;

    dragRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const drag = dragRef.current;
    setPan((current) => ({
      ...current,
      x: drag.panX + event.clientX - drag.pointerX,
      y: drag.panY + event.clientY - drag.pointerY,
    }));
  }

  function stopPanning(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resetView() {
    setPan({ x: INITIAL_PAN, y: INITIAL_PAN, zoom: 1 });
  }

  return (
    <div
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopPanning}
      onPointerCancel={stopPanning}
      onDoubleClick={resetView}
      style={{
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        position: 'relative',
        background: 'var(--bg)',
        backgroundImage: 'radial-gradient(var(--dot) 1px, transparent 1px)',
        backgroundSize: `${22 * pan.zoom}px ${22 * pan.zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
        cursor: panning ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
    >
      <div
        style={{
          position: 'relative',
          width,
          height,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${pan.zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
      {overlay}
    </div>
  );
}
