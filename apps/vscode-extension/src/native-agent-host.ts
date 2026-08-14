import { Uri, window, type Disposable, type Terminal } from 'vscode';
import type { ConfigurableAgent } from '@god-view/webview-bridge';

export type NativeAgentPurpose =
  | 'initialization'
  | 'reinitialization'
  | 'group_completion'
  | 'file_completion'
  | 'project_chat'
  | 'annotation_answer'
  | 'approved_change';

export interface NativeAgentHostOptions {
  readonly workspaceRoot: string;
  readonly task: (purpose: NativeAgentPurpose) => string;
  readonly projectChatTask: (message: string) => string;
  readonly annotationTask: (annotationId: string) => string | undefined;
  readonly approvedChangeTask: (proposalId: string) => string | undefined;
  readonly authorize: (agent: ConfigurableAgent) => Promise<boolean>;
  readonly now: () => string;
}

/**
 * 只负责打开/复用官方 Codex 或 Claude Code TUI。
 *
 * 权限、会话历史、恢复和用户问答全部留在官方终端；God View 仅准备任务上下文，
 * 画布写入继续通过 MCP 完成。
 */
export class NativeAgentHost implements Disposable {
  readonly #options: NativeAgentHostOptions;
  readonly #terminals = new Map<ConfigurableAgent, Terminal>();
  readonly #closeListener: Disposable;
  #lastAgent: ConfigurableAgent | undefined;

  constructor(options: NativeAgentHostOptions) {
    this.#options = options;
    this.#closeListener = window.onDidCloseTerminal((terminal) => {
      for (const [agent, current] of this.#terminals) {
        if (current === terminal) this.#terminals.delete(agent);
      }
    });
  }

  async open(agent: ConfigurableAgent, prompt?: string): Promise<'opened' | 'not_ready'> {
    if (!(await this.#options.authorize(agent))) return 'not_ready';
    this.#lastAgent = agent;
    const existing = this.#terminals.get(agent);
    if (existing !== undefined) {
      existing.show(false);
      if (prompt !== undefined && prompt.trim() !== '') existing.sendText(prompt, true);
      return 'opened';
    }
    const terminal = window.createTerminal(
      nativeTerminalOptions(agent, this.#options.workspaceRoot, prompt),
    );
    this.#terminals.set(agent, terminal);
    terminal.show(false);
    return 'opened';
  }

  timestamp(): string {
    return this.#options.now();
  }

  start(
    agent: ConfigurableAgent,
    purpose: NativeAgentPurpose,
    subjectId?: string,
  ): Promise<'opened' | 'not_ready'> {
    const task =
      purpose === 'annotation_answer' && subjectId !== undefined
        ? this.#options.annotationTask(subjectId)
        : purpose === 'approved_change' && subjectId !== undefined
          ? this.#options.approvedChangeTask(subjectId)
          : this.#options.task(purpose);
    return task === undefined ? Promise.resolve('not_ready') : this.open(agent, task);
  }

  sendMessage(agent: ConfigurableAgent, message: string): Promise<'opened' | 'not_ready'> {
    return this.open(agent, this.#options.projectChatTask(message));
  }

  continueAfterScopeDecision(requestId: string, decision: 'approved' | 'rejected'): boolean {
    const terminal =
      this.#lastAgent === undefined ? undefined : this.#terminals.get(this.#lastAgent);
    if (terminal === undefined) return false;
    terminal.show(false);
    terminal.sendText(
      decision === 'approved'
        ? `God View 已批准扩围申请 ${requestId}。请调用 get_map 核对更新后的 approvedScope，然后继续当前 ChangeSet。`
        : `God View 已拒绝扩围申请 ${requestId}。请保持原 approvedScope，调整方案后继续；不得修改被拒绝的文件。`,
      true,
    );
    return true;
  }

  dispose(): void {
    this.#closeListener.dispose();
    for (const terminal of this.#terminals.values()) terminal.dispose();
    this.#terminals.clear();
    this.#lastAgent = undefined;
  }
}

export function nativeTerminalOptions(
  agent: ConfigurableAgent,
  workspaceRoot: string,
  prompt?: string,
): {
  readonly name: string;
  readonly cwd: Uri;
  readonly shellPath: string;
  readonly shellArgs: string[];
  readonly isTransient: boolean;
} {
  const initialPrompt =
    prompt?.trim() === '' || prompt === undefined
      ? '请先调用 God View MCP 的 get_map 获取当前画布，然后等待我的指令。'
      : prompt;
  return agent === 'codex'
    ? {
        name: 'God View · Codex',
        cwd: Uri.file(workspaceRoot),
        shellPath: 'codex',
        shellArgs: ['--cd', workspaceRoot, '--no-alt-screen', initialPrompt],
        isTransient: false,
      }
    : {
        name: 'God View · Claude Code',
        cwd: Uri.file(workspaceRoot),
        shellPath: 'claude',
        shellArgs: [
          '--name',
          'God View',
          '--append-system-prompt',
          'God View 只提供画布上下文和 MCP 工具。对话、权限申请、会话恢复与工具授权必须使用 Claude Code 原生机制；需要地图细节时先调用 get_map。',
          initialPrompt,
        ],
        isTransient: false,
      };
}
