import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import type { AgentFloatingBounds } from '@god-view/webview-bridge';

export function FloatingAgentPane(props: {
  readonly bounds: AgentFloatingBounds;
  readonly onChange: (bounds: AgentFloatingBounds) => void;
  readonly onChangeEnd: (bounds: AgentFloatingBounds) => void;
  readonly children: ReactNode;
}): React.JSX.Element {
  const clamp = (bounds: AgentFloatingBounds): AgentFloatingBounds => ({
    ...clampFloatingBounds(bounds, window.innerWidth, window.innerHeight),
  });
  const drag = (event: ReactPointerEvent<HTMLElement>): void => {
    if ((event.target as HTMLElement).closest('button') !== null) return;
    const origin = clamp(props.bounds);
    beginPointerGesture(
      event,
      (dx, dy) => clamp({ ...origin, x: origin.x + dx, y: origin.y + dy }),
      props,
    );
  };
  const resize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const origin = clamp(props.bounds);
    beginPointerGesture(
      event,
      (dx, dy) => clamp({ ...origin, width: origin.width + dx, height: origin.height + dy }),
      props,
    );
  };
  const moveByKeyboard = (event: ReactKeyboardEvent<HTMLElement>): void => {
    const step = event.shiftKey ? 40 : 12;
    const delta: Record<string, readonly [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const movement = delta[event.key];
    if (movement === undefined) return;
    event.preventDefault();
    const next = clamp({
      ...props.bounds,
      x: props.bounds.x + movement[0],
      y: props.bounds.y + movement[1],
    });
    props.onChange(next);
    props.onChangeEnd(next);
  };
  const bounds = clamp(props.bounds);
  return (
    <div
      className="agent-floating-pane"
      data-testid="agent-floating-pane"
      style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
    >
      <div
        className="agent-floating-pane__titlebar"
        role="toolbar"
        aria-label="Agent 浮窗标题栏"
        tabIndex={0}
        title="按住并拖动窗口；方向键微调位置，Shift + 方向键快速移动"
        onPointerDown={drag}
        onKeyDown={moveByKeyboard}
      >
        <span className="agent-floating-pane__grip" aria-hidden="true">
          ⠿
        </span>
        <strong>项目 Agent 浮动窗口</strong>
        <span>按住此标题栏拖动</span>
      </div>
      <div className="agent-floating-pane__content">{props.children}</div>
      <div
        className="agent-floating-pane__resize"
        role="separator"
        aria-label="调整 Agent 浮窗大小"
        onPointerDown={resize}
      />
    </div>
  );
}

export function clampFloatingBounds(
  bounds: AgentFloatingBounds,
  viewportWidth: number,
  viewportHeight: number,
): AgentFloatingBounds {
  const width = Math.min(Math.max(360, viewportWidth - 32), Math.max(360, bounds.width));
  const height = Math.min(Math.max(240, viewportHeight - 32), Math.max(240, bounds.height));
  return {
    width,
    height,
    x: Math.max(16, Math.min(viewportWidth - width - 16, bounds.x)),
    y: Math.max(16, Math.min(viewportHeight - height - 16, bounds.y)),
  };
}

function beginPointerGesture(
  event: ReactPointerEvent<HTMLElement>,
  next: (dx: number, dy: number) => AgentFloatingBounds,
  props: {
    readonly onChange: (bounds: AgentFloatingBounds) => void;
    readonly onChangeEnd: (bounds: AgentFloatingBounds) => void;
  },
): void {
  event.preventDefault();
  const target = event.currentTarget;
  target.setPointerCapture(event.pointerId);
  const start = { x: event.clientX, y: event.clientY };
  let latest = next(0, 0);
  const move = (one: PointerEvent): void => {
    latest = next(one.clientX - start.x, one.clientY - start.y);
    props.onChange(latest);
  };
  const end = (one: PointerEvent): void => {
    target.releasePointerCapture(one.pointerId);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', end);
    props.onChangeEnd(latest);
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}
