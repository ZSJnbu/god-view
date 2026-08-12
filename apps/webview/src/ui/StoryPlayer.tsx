import { useEffect } from 'react';
import type { GuidedStory } from '@god-view/protocol';
import { activeStory, activeStoryStep, type AppStore, type StorySpeed } from '../app-store.js';
import { useAppState } from './use-app-state.js';

const stepDurationMs = 5_000;
const storyTypeLabels: Record<GuidedStory['type'], string> = {
  project_intro: '30 秒认识项目',
  key_flow: '关键流程',
  change_replay: '本次变更回放',
};

export function StoryPlayer({ store }: { readonly store: AppStore }): React.JSX.Element | null {
  const state = useAppState(store);
  const stories = [...state.map.stories.values()];
  const story = activeStory(state);
  const step = activeStoryStep(state);

  useEffect(() => {
    if (state.story.status !== 'playing' || story === undefined || step === undefined) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      store.nextStoryStep();
    }, stepDurationMs / state.story.speed);
    return () => {
      window.clearTimeout(timer);
    };
  }, [state.story.status, state.story.speed, state.story.stepIndex, story, step, store]);

  if (stories.length === 0) {
    return null;
  }
  if (story === undefined || step === undefined) {
    return (
      <section className="story story--picker" aria-label="项目讲解">
        <strong>带我了解项目</strong>
        <div className="story__choices">
          {stories.map((candidate) => (
            <button
              type="button"
              className="chip"
              key={candidate.id}
              onClick={() => {
                store.playStory(candidate.id);
              }}
            >
              {storyTypeLabels[candidate.type]}：{candidate.title}
            </button>
          ))}
        </div>
      </section>
    );
  }

  const lastIndex = story.steps.length - 1;
  return (
    <section className="story story--active" aria-label="讲解播放器">
      <div className="story__summary">
        <strong>{story.title}</strong>
        <span>
          第 {state.story.stepIndex + 1} / {story.steps.length} 步
        </span>
      </div>
      <p className="story__caption" role="status" aria-live="polite">
        {step.caption}
      </p>
      <div className="story__controls">
        <button
          type="button"
          className="chip"
          disabled={state.story.stepIndex === 0}
          onClick={() => {
            store.previousStoryStep();
          }}
        >
          上一步
        </button>
        {state.story.status === 'playing' ? (
          <button
            type="button"
            className="chip chip--active"
            onClick={() => {
              store.pauseStory();
            }}
          >
            暂停
          </button>
        ) : (
          <button
            type="button"
            className="chip chip--active"
            onClick={() => {
              store.resumeStory();
            }}
          >
            继续
          </button>
        )}
        <button
          type="button"
          className="chip"
          disabled={state.story.stepIndex === lastIndex}
          onClick={() => {
            store.nextStoryStep();
          }}
        >
          下一步
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => {
            store.replayStory();
          }}
        >
          重播
        </button>
        <label className="story__speed">
          速度
          <select
            aria-label="讲解速度"
            value={state.story.speed}
            onChange={(event) => {
              store.setStorySpeed(parseSpeed(event.target.value));
            }}
          >
            <option value="0.5">0.5×</option>
            <option value="1">1×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2×</option>
          </select>
        </label>
        <button
          type="button"
          className="chip"
          onClick={() => {
            store.stopStory();
          }}
        >
          退出讲解
        </button>
      </div>
    </section>
  );
}

function parseSpeed(value: string): StorySpeed {
  switch (value) {
    case '0.5':
      return 0.5;
    case '1.5':
      return 1.5;
    case '2':
      return 2;
    default:
      return 1;
  }
}
