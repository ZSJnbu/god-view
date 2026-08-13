import type { AppStore } from '../app-store.js';
import { useAppState } from './use-app-state.js';

export function MapPlaybackControls(props: { readonly store: AppStore }): React.JSX.Element | null {
  const playback = useAppState(props.store).playback;
  if (playback.sessionFrameCount === 0 && playback.pendingCount === 0) return null;
  const behind = playback.authoritativeRevision - playback.renderedRevision;
  return (
    <section className="map-playback" aria-label="地图变更时间线">
      <div>
        <strong>
          {playback.replaying
            ? '正在回放本次会话'
            : playback.pendingCount > 0
              ? '正在渐进绘制'
              : '已跟上最新地图'}
        </strong>
        <span>
          画面 r{playback.renderedRevision} · 权威 r{playback.authoritativeRevision}
          {behind > 0 ? ` · 待播放 ${String(playback.pendingCount)} 步` : ''}
        </span>
      </div>
      <div className="map-playback__actions">
        <label>
          速度
          <select
            aria-label="地图播放速度"
            value={String(playback.speed)}
            onChange={(event) => {
              props.store.setMapPlaybackSpeed(Number(event.target.value) as 0.5 | 1 | 2);
            }}
          >
            <option value="0.5">慢速</option>
            <option value="1">正常</option>
            <option value="2">快速</option>
          </select>
        </label>
        {playback.status === 'playing' ? (
          <button
            type="button"
            className="chip"
            onClick={() => {
              props.store.pauseMapPlayback();
            }}
          >
            暂停
          </button>
        ) : (
          <button
            type="button"
            className="chip"
            disabled={playback.pendingCount === 0}
            onClick={() => {
              props.store.resumeMapPlayback();
            }}
          >
            继续
          </button>
        )}
        <button
          type="button"
          className="chip"
          disabled={playback.pendingCount === 0}
          onClick={() => {
            props.store.stepMapPlayback();
          }}
        >
          下一步
        </button>
        <button
          type="button"
          className="chip"
          disabled={playback.sessionFrameCount === 0}
          onClick={() => {
            props.store.replayMapSession();
          }}
        >
          回放本次会话
        </button>
        <button
          type="button"
          className="chip"
          disabled={behind === 0}
          onClick={() => {
            props.store.showLatestMapRevision();
          }}
        >
          跳到最新
        </button>
      </div>
    </section>
  );
}
