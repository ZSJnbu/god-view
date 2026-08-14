import { useState } from 'react';
import type { AgentRunView, ConfigurableAgent } from '@god-view/webview-bridge';

export function AgentRunPanel(props: {
  readonly run: AgentRunView;
  readonly onAnswer: (runId: string, answer: string) => void;
  readonly onScopeExpansionDecision?: (
    runId: string,
    requestId: string,
    changeSetId: string,
    decision: 'approved' | 'rejected',
  ) => void;
  readonly onCancel: (runId: string) => void;
  readonly compact?: boolean;
}): React.JSX.Element {
  const [answer, setAnswer] = useState<string>();
  const [customAnswer, setCustomAnswer] = useState('');
  const active = ['starting', 'running', 'awaiting_input'].includes(props.run.state);
  const purpose = purposeLabel(props.run.purpose);
  return (
    <section
      className={`agent-run agent-run--${props.run.state}${props.compact === true ? ' agent-run--compact' : ''}`}
      aria-label={`Agent ${purpose}进度`}
    >
      <header>
        <strong>
          {agentName(props.run.agent)} · {purpose} · {runStateLabel(props.run)}
        </strong>
        {active && (
          <button
            className="chip"
            type="button"
            onClick={() => {
              props.onCancel(props.run.runId);
            }}
          >
            停止
          </button>
        )}
      </header>
      {props.run.detail && <p role="status">{props.run.detail}</p>}
      {props.run.output.length > 0 && <pre aria-live="polite">{props.run.output.join('\n')}</pre>}
      {props.run.state === 'awaiting_input' && props.run.question !== undefined && (
        <fieldset className="agent-question">
          <legend>{props.run.question.question}</legend>
          {props.run.question.scopeExpansion !== undefined && (
            <div className="agent-question__scope">
              <strong>申请原因</strong>
              <p>{props.run.question.scopeExpansion.reason}</p>
              <strong>新增文件</strong>
              <ul>
                {props.run.question.scopeExpansion.requestedFiles.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
              <small>批准后会先更新权威 approvedScope，再恢复同一个 Agent 会话。</small>
            </div>
          )}
          {props.run.question.scopeExpansion === undefined &&
            props.run.question.options.map((option) => (
              <label key={option.id}>
                <input
                  type="radio"
                  name="agent-answer"
                  value={option.id}
                  checked={answer === option.id}
                  onChange={() => {
                    setAnswer(option.id);
                  }}
                />
                <span>
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
              </label>
            ))}
          {props.run.question.scopeExpansion === undefined ? (
            <>
              <button
                className="empty-map__primary"
                type="button"
                disabled={answer === undefined}
                onClick={() => {
                  if (answer !== undefined) props.onAnswer(props.run.runId, answer);
                }}
              >
                继续
              </button>
              <label className="agent-question__custom">
                或补充说明
                <textarea
                  rows={3}
                  maxLength={4000}
                  value={customAnswer}
                  placeholder="直接告诉 Agent 你的约束、选择或补充信息…"
                  onChange={(event) => {
                    setCustomAnswer(event.currentTarget.value);
                  }}
                />
              </label>
              <button
                className="chip"
                type="button"
                disabled={customAnswer.trim() === ''}
                onClick={() => {
                  const message = customAnswer.trim();
                  if (message !== '') props.onAnswer(props.run.runId, message);
                }}
              >
                发送补充说明
              </button>
            </>
          ) : (
            <div className="agent-question__scope-actions">
              <button
                className="empty-map__primary"
                type="button"
                onClick={() => {
                  const request = props.run.question?.scopeExpansion;
                  if (request !== undefined)
                    props.onScopeExpansionDecision?.(
                      props.run.runId,
                      request.requestId,
                      request.changeSetId,
                      'approved',
                    );
                }}
              >
                批准并继续
              </button>
              <button
                className="chip"
                type="button"
                onClick={() => {
                  const request = props.run.question?.scopeExpansion;
                  if (request !== undefined)
                    props.onScopeExpansionDecision?.(
                      props.run.runId,
                      request.requestId,
                      request.changeSetId,
                      'rejected',
                    );
                }}
              >
                拒绝扩围
              </button>
            </div>
          )}
        </fieldset>
      )}
      {props.run.restartRequired && (
        <p className="agent-run__success">
          ✓ {purpose}
          任务已结束，地图会自动刷新。请退出并重启其他已打开的 Agent 会话，以加载最新 MCP
          配置和地图。
        </p>
      )}
      {props.run.state === 'completed' &&
        (props.run.purpose ?? 'initialization') !== 'initialization' && (
          <p className="agent-run__success">✓ {purpose}已完成并通过复核，地图已刷新。</p>
        )}
      {props.run.state === 'failed' && (
        <p>自动执行失败。你可以保留上方输出用于诊断，或复制手动任务继续。</p>
      )}
    </section>
  );
}

function purposeLabel(purpose: AgentRunView['purpose']): string {
  return {
    initialization: '首次建图',
    reinitialization: '重新初始化',
    group_completion: '分组层级补全',
    file_completion: '关键文件关系补全',
    project_chat: '项目对话',
    annotation_answer: '标注解释子线程',
    approved_change: '项目编辑子线程',
  }[purpose ?? 'initialization'];
}

function agentName(agent: ConfigurableAgent): string {
  return agent === 'codex' ? 'Codex' : 'Claude Code';
}

function runStateLabel(run: AgentRunView): string {
  if (run.state === 'running' && run.purpose === 'annotation_answer') return '正在回答标注';
  if (run.state === 'running' && run.purpose === 'approved_change') return '正在编辑并同步视图';
  return {
    starting: '正在启动',
    running: '正在建图',
    awaiting_input: '等待选择',
    completed: '已完成',
    failed: '失败',
    cancelled: '已停止',
  }[run.state];
}
