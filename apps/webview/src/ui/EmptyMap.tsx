import type { CoverageReport } from '@god-view/protocol';

export interface EmptyMapProps {
  readonly coverage: CoverageReport | undefined;
  readonly onGenerateAgentTask: () => void;
  readonly onCopyAgentSetup: () => void;
  readonly onConfigureAgent: (agent: 'codex' | 'claude-code') => void;
}

/** 空地图只展示当前真正可用的初始化入口，不伪造尚未接线的 Adapter。 */
export function EmptyMap({
  coverage,
  onGenerateAgentTask,
  onCopyAgentSetup,
  onConfigureAgent,
}: EmptyMapProps): React.JSX.Element {
  const total = (coverage?.classified ?? 0) + (coverage?.unclassified ?? 0);
  return (
    <section className="empty-map" aria-labelledby="empty-map-title">
      <div className="empty-map__content">
        <p className="empty-map__eyebrow">尚未建立项目地图</p>
        <h1 id="empty-map-title">让 Agent 基于代码事实创建第一版地图</h1>
        <p>
          God View 不需要账号，也不会索取 Agent 密钥。插件已经只读生成工作区清单；
          语义模块需要由你已授权的 Agent 通过 God View 工具声明。
        </p>

        <dl className="empty-map__facts" aria-label="首次建图范围">
          <div>
            <dt>第一方文件</dt>
            <dd>{total}</dd>
          </div>
          <div>
            <dt>等待归类</dt>
            <dd>{coverage?.unclassified ?? 0}</dd>
          </div>
          <div>
            <dt>规则排除</dt>
            <dd>{coverage?.excluded ?? 0}</dd>
          </div>
        </dl>

        <div className="empty-map__actions">
          <button
            className="empty-map__primary"
            type="button"
            onClick={() => {
              onConfigureAgent('claude-code');
            }}
          >
            配置 Claude Code
          </button>
          <button
            className="empty-map__primary"
            type="button"
            onClick={() => {
              onConfigureAgent('codex');
            }}
          >
            配置 Codex
          </button>
          <button className="chip" type="button" onClick={onGenerateAgentTask}>
            生成初始化任务
          </button>
          <button className="chip" type="button" onClick={onCopyAgentSetup}>
            复制手动接入命令
          </button>
        </div>
        <p className="empty-map__note">
          Gateway 已随扩展安装，不需要本仓库或单独下载。接入配置由你选择是否执行；God View
          配置动作会先确认数据边界和将写入的 Agent 配置，并在完成后复验。已经打开的 Agent
          会话不会热加载新工具，必须退出后在当前目录重开。当前仍不支持由插件主动调用 Agent。
        </p>
      </div>
    </section>
  );
}
