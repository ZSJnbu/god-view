import { useEffect, useMemo, useState } from 'react';
import type { CoverageReport } from '@god-view/protocol';
import type { AgentConfigurationView, ConfigurableAgent } from '@god-view/webview-bridge';

export interface EmptyMapProps {
  readonly coverage: CoverageReport | undefined;
  readonly agents: readonly AgentConfigurationView[];
  readonly selectedAgent: ConfigurableAgent | undefined;
  readonly onGenerateAgentTask: () => void;
  readonly onCopyAgentSetup: () => void;
  readonly onConfigureAgent: (agent: ConfigurableAgent) => void;
  readonly onRefreshAgentStatus: () => void;
  readonly onStartInitialization: (agent: ConfigurableAgent) => void;
  readonly onReplayHistory: () => void;
  /** 无 Git 工作区没有提交历史可放，入口必须明确禁用而不是点了没反应。 */
  readonly hasGit: boolean;
}

/** 首次建图由官方 Agent 终端执行，God View 只提供 MCP、hook 与画布反馈。 */
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
          God View 不需要账号，也不会索取 Agent 密钥。点击后会打开官方 Codex/Claude
          终端；对话、权限申请和会话恢复都由它原生处理。
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
            disabled={activeAgent === undefined}
            onClick={() => {
              if (activeAgent !== undefined) props.onStartInitialization(activeAgent.agent);
            }}
          >
            在原生终端启动首次建图
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
          {/* 还没有地图时，Git 历史本身就能先讲清楚这个项目是怎么长起来的。 */}
          <button
            className="chip"
            type="button"
            disabled={!props.hasGit}
            title={props.hasGit ? '按提交回放项目结构的成长过程' : '当前不是 Git 工作区'}
            onClick={props.onReplayHistory}
          >
            历史回放
          </button>
        </div>
        {activeAgent === undefined && (
          <p className="empty-map__note">请先配置并复验至少一个 Agent，才能自动启动首次建图。</p>
        )}

        <p className="empty-map__note">
          Gateway 已随扩展安装。配置会写入所选 Agent 的 MCP 与 UserPromptSubmit hook； 已有 Agent
          会话不会热加载新配置，需要退出后重新打开。
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
