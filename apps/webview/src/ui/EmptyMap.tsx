import { useEffect, useMemo, useState } from 'react';
import type { CoverageReport } from '@god-view/protocol';
import type {
  AgentConfigurationView,
  AgentRunView,
  ConfigurableAgent,
} from '@god-view/webview-bridge';
import { AgentRunPanel } from './AgentRunPanel.js';

export interface EmptyMapProps {
  readonly coverage: CoverageReport | undefined;
  readonly agents: readonly AgentConfigurationView[];
  readonly selectedAgent: ConfigurableAgent | undefined;
  readonly run: AgentRunView | undefined;
  readonly onGenerateAgentTask: () => void;
  readonly onCopyAgentSetup: () => void;
  readonly onConfigureAgent: (agent: ConfigurableAgent) => void;
  readonly onRefreshAgentStatus: () => void;
  readonly onStartInitialization: (agent: ConfigurableAgent) => void;
  readonly onAnswerQuestion: (runId: string, answer: string) => void;
  readonly onCancelRun: (runId: string) => void;
}

/** 首次建图：配置、自动执行、进度和必要的人机选择都留在同一个可审计界面。 */
export function EmptyMap(props: EmptyMapProps): React.JSX.Element {
  const total = (props.coverage?.classified ?? 0) + (props.coverage?.unclassified ?? 0);
  const configured = props.agents.filter((agent) => agent.configuration === 'current');
  const [chosen, setChosen] = useState<ConfigurableAgent | undefined>(props.selectedAgent);
  const activeAgent = useMemo(
    () => configured.find((agent) => agent.agent === chosen) ?? configured[0],
    [chosen, configured],
  );

  useEffect(() => {
    props.onRefreshAgentStatus();
  }, [props.onRefreshAgentStatus]);
  useEffect(() => {
    if (props.selectedAgent !== undefined) setChosen(props.selectedAgent);
  }, [props.selectedAgent]);

  return (
    <section className="empty-map" aria-labelledby="empty-map-title">
      <div className="empty-map__content">
        <p className="empty-map__eyebrow">尚未建立项目地图</p>
        <h1 id="empty-map-title">让 Agent 基于代码事实创建第一版地图</h1>
        <p>
          God View 不需要账号，也不会索取 Agent 密钥。自动建图会启动一个新的只读/计划会话；
          它可以写地图事件，但不能修改你的项目源码。
        </p>

        <dl className="empty-map__facts" aria-label="首次建图范围">
          <div>
            <dt>第一方文件</dt>
            <dd>{total}</dd>
          </div>
          <div>
            <dt>等待归类</dt>
            <dd>{props.coverage?.unclassified ?? 0}</dd>
          </div>
          <div>
            <dt>规则排除</dt>
            <dd>{props.coverage?.excluded ?? 0}</dd>
          </div>
        </dl>

        <div className="empty-map__agents" aria-label="Agent 配置">
          {(['claude-code', 'codex'] as const).map((id) => {
            const status = props.agents.find((agent) => agent.agent === id);
            const current = status?.configuration === 'current';
            return (
              <div
                className={`empty-map__agent${current ? ' empty-map__agent--configured' : ''}`}
                key={id}
              >
                <button
                  className="empty-map__primary"
                  type="button"
                  onClick={() => {
                    props.onConfigureAgent(id);
                  }}
                  disabled={status?.installed === false}
                >
                  {current ? '✓ ' : ''}
                  {current ? status.displayName.replace(' CLI', '') : `配置 ${agentName(id)}`}
                </button>
                <p className="empty-map__agent-detail">
                  {status === undefined
                    ? '正在检查配置…'
                    : `${status.version ?? (status.installed ? '已检测到 CLI' : '未检测到 CLI')} · ${status.detail ?? configurationLabel(status.configuration)}`}
                </p>
                {current && <p className="empty-map__verified">✓ 当前工作区已配置并复验</p>}
              </div>
            );
          })}
        </div>

        {configured.length > 1 && (
          <fieldset className="empty-map__agent-picker">
            <legend>用于首次建图的 Agent</legend>
            {configured.map((agent) => (
              <label key={agent.agent}>
                <input
                  type="radio"
                  name="initialization-agent"
                  value={agent.agent}
                  checked={activeAgent?.agent === agent.agent}
                  onChange={() => {
                    setChosen(agent.agent);
                  }}
                />
                {agent.displayName}
              </label>
            ))}
          </fieldset>
        )}

        <div className="empty-map__actions">
          <button
            className="empty-map__primary"
            type="button"
            disabled={activeAgent === undefined || isRunActive(props.run)}
            onClick={() => {
              if (activeAgent !== undefined) props.onStartInitialization(activeAgent.agent);
            }}
          >
            {isRunActive(props.run) ? 'Agent 正在建图…' : '启动首次建图'}
          </button>
          <button className="chip" type="button" onClick={props.onGenerateAgentTask}>
            复制手动任务
          </button>
          <button className="chip" type="button" onClick={props.onCopyAgentSetup}>
            复制手动接入命令
          </button>
          <button className="chip" type="button" onClick={props.onRefreshAgentStatus}>
            刷新配置状态
          </button>
        </div>
        {activeAgent === undefined && (
          <p className="empty-map__note">请先配置并复验至少一个 Agent，才能自动启动首次建图。</p>
        )}

        {props.run !== undefined && (
          <AgentRunPanel
            run={props.run}
            onAnswer={props.onAnswerQuestion}
            onCancel={props.onCancelRun}
          />
        )}

        <p className="empty-map__note">
          Gateway 已随扩展安装。配置会写入所选 Agent 的 MCP 设置并立即复验；已有 Agent
          会话不会热加载新工具，需退出后在当前目录重开。
        </p>
      </div>
    </section>
  );
}

function agentName(agent: ConfigurableAgent): string {
  return agent === 'codex' ? 'Codex' : 'Claude Code';
}

function configurationLabel(state: AgentConfigurationView['configuration']): string {
  return {
    checking: '正在检查',
    missing: '尚未配置',
    current: '已配置',
    conflict: '配置冲突',
    error: '检查失败',
  }[state];
}

function isRunActive(run: AgentRunView | undefined): boolean {
  return run !== undefined && ['starting', 'running', 'awaiting_input'].includes(run.state);
}
