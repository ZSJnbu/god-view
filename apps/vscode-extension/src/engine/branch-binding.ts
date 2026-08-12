import { join } from 'node:path';
import type { Identifier, ProtocolValidator } from '@god-view/protocol';
import { currentProtocolVersion } from '@god-view/protocol';
import {
  FileEventLog,
  FileSnapshotStore,
  GraphRepository,
  resolveBranchStorage,
  writeFileAtomic,
  type RestoreReport,
} from '@god-view/storage';

export interface BranchBindingOptions {
  readonly workspaceId: Identifier;
  /** 扩展全局存储根，按 workspaceId + branchKey 再分目录。 */
  readonly storageRoot: string;
  /** 工作区内的 `.godview` 目录，会话描述写在这里。 */
  readonly runtimeDir: string;
  readonly validator: ProtocolValidator;
  readonly now: () => string;
  /** 原始事件和已解决对话正文的默认保留天数。 */
  readonly retentionDays?: number;
}

export interface BindResult {
  /** 是否真的换了分支。同分支重复绑定不重开仓库。 */
  readonly changed: boolean;
  readonly branchKey: Identifier;
  readonly report: RestoreReport | undefined;
  readonly retention:
    | {
        readonly prunedEvents: number;
        readonly retainedEvents: number;
        readonly redactedAnnotations: number;
      }
    | undefined;
}

interface ActiveBinding {
  readonly branchKey: Identifier;
  readonly repository: GraphRepository;
}

/**
 * 分支到仓库的绑定。
 *
 * 地图状态按 workspace + 分支隔离（TECHNICAL_ARCHITECTURE.md §8.2）。分支是**运行期
 * 可变**的：用户随时可能 checkout。绑定关系因此必须能重建，否则切分支后事件会继续
 * 追加到上一个分支的日志里——那是静默的数据归属错误，用户看不到任何异常。
 *
 * 本类刻意不依赖 `vscode`：分支绑定是整个扩展里最容易出错、也最需要回归测试的一段，
 * 把它留在 Extension Host 里就只能靠人工验证。
 */
export class BranchBinding {
  readonly #options: BranchBindingOptions;
  #active: ActiveBinding | undefined;

  constructor(options: BranchBindingOptions) {
    this.#options = options;
  }

  get branchKey(): Identifier | undefined {
    return this.#active?.branchKey;
  }

  /** 尚未绑定时抛错：调用方必须先 bind，不允许对"某个分支"含糊地写入。 */
  get repository(): GraphRepository {
    const active = this.#active;
    if (active === undefined) {
      throw new Error('BranchBinding 尚未绑定分支');
    }
    return active.repository;
  }

  get repositoryOrUndefined(): GraphRepository | undefined {
    return this.#active?.repository;
  }

  /**
   * 绑定到指定分支。
   *
   * 已经绑定在同一分支时直接返回，不重开仓库——否则每次 Git 状态刷新都会重放整个
   * 事件日志。切换分支时先 flush 旧仓库，保证已接受的事件不会因为切换而丢失。
   */
  async bind(input: {
    readonly branchKey: Identifier;
    readonly baseGitRevision?: string;
  }): Promise<BindResult> {
    const active = this.#active;
    if (active?.branchKey === input.branchKey) {
      return {
        changed: false,
        branchKey: input.branchKey,
        report: undefined,
        retention: undefined,
      };
    }
    // 先把上一个分支的待写入刷干净，再切换绑定。
    await active?.repository.flush();

    const layout = resolveBranchStorage(
      this.#options.storageRoot,
      this.#options.workspaceId,
      input.branchKey,
    );
    const { repository, report } = await GraphRepository.open({
      workspaceId: this.#options.workspaceId,
      branchKey: input.branchKey,
      eventLog: new FileEventLog(
        layout.eventLogFile,
        layout.quarantineFile,
        this.#options.validator,
      ),
      snapshotStore: new FileSnapshotStore(layout.snapshotFile, this.#options.validator),
      now: this.#options.now,
      ...(input.baseGitRevision === undefined ? {} : { baseGitRevision: input.baseGitRevision }),
    });
    const cutoff = retentionCutoff(this.#options.now(), this.#options.retentionDays ?? 30);
    const retention = await repository.compact(cutoff);
    this.#active = { branchKey: input.branchKey, repository };

    // 会话描述必须与绑定同时更新：Gateway 读它来决定事件盖哪个 branchKey，
    // 描述滞后会让新分支的事件被打上旧分支的标签。
    await this.#publishSessionDescriptor(input.branchKey);

    return { changed: true, branchKey: input.branchKey, report, retention };
  }

  async flush(): Promise<void> {
    await this.#active?.repository.flush();
  }

  async #publishSessionDescriptor(branchKey: Identifier): Promise<void> {
    await writeFileAtomic(
      join(this.#options.runtimeDir, 'session.json'),
      JSON.stringify({
        workspaceId: this.#options.workspaceId,
        branchKey,
        protocolVersion: currentProtocolVersion,
      }),
    );
  }
}

function retentionCutoff(now: string, retentionDays: number): string {
  const time = Date.parse(now);
  if (!Number.isFinite(time) || !Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error('retentionDays 与当前时间必须有效');
  }
  return new Date(time - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}
