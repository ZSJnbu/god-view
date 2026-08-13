import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

const minimumHeight = 120;
const defaultHeight = 200;
const keyboardStep = 24;

export function ResizableAgentPane(props: {
  readonly height: number;
  readonly onResize: (height: number) => void;
  readonly onResizeEnd: (height: number) => void;
  readonly children: ReactNode;
}): React.JSX.Element {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const maximumHeight = (): number => Math.max(minimumHeight, window.innerHeight - 220);
  const clamp = (height: number): number =>
    Math.round(Math.min(maximumHeight(), Math.max(minimumHeight, height)));
  const apply = (height: number, persist = false): void => {
    const next = clamp(height);
    props.onResize(next);
    if (persist) props.onResizeEnd(next);
  };

  const startDragging = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const separator = event.currentTarget;
    separator.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = paneRef.current?.getBoundingClientRect().height ?? props.height;
    const onMove = (moveEvent: PointerEvent): void => {
      apply(startHeight + startY - moveEvent.clientY);
    };
    const onEnd = (endEvent: PointerEvent): void => {
      separator.releasePointerCapture(endEvent.pointerId);
      separator.removeEventListener('pointermove', onMove);
      separator.removeEventListener('pointerup', onEnd);
      separator.removeEventListener('pointercancel', onEnd);
      props.onResizeEnd(clamp(paneRef.current?.getBoundingClientRect().height ?? props.height));
    };
    separator.addEventListener('pointermove', onMove);
    separator.addEventListener('pointerup', onEnd);
    separator.addEventListener('pointercancel', onEnd);
  };

  return (
    <div
      className="agent-pane"
      ref={paneRef}
      style={{ height: clamp(props.height) }}
      data-testid="agent-pane"
    >
      <div
        className="agent-pane__separator"
        role="separator"
        aria-label="调整地图与 Agent 输出的高度"
        aria-orientation="horizontal"
        aria-valuemin={minimumHeight}
        aria-valuemax={maximumHeight()}
        aria-valuenow={clamp(props.height)}
        tabIndex={0}
        title="上下拖动调整视窗；双击恢复默认高度"
        onPointerDown={startDragging}
        onDoubleClick={() => {
          apply(defaultHeight, true);
        }}
        onKeyDown={(event) => {
          const changes: Record<string, number> = {
            ArrowUp: props.height + keyboardStep,
            ArrowDown: props.height - keyboardStep,
            Home: minimumHeight,
            End: maximumHeight(),
          };
          const next = changes[event.key];
          if (next === undefined) return;
          event.preventDefault();
          apply(next, true);
        }}
      >
        <span aria-hidden="true" />
      </div>
      {props.children}
    </div>
  );
}
