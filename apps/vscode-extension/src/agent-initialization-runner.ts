/* eslint-disable max-lines -- Agent CLI streaming, verification and persistent conversation share one lifecycle state machine. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type {
  AgentConversationMessage,
  AgentConversationView,
  AgentQuestion,
  AgentRunView,
  ConfigurableAgent,
} from '@god-view/webview-bridge';

const questionPrefix = 'GOD_VIEW_USER_QUESTION:';
const resultPrefix = 'GOD_VIEW_INITIALIZATION_RESULT:';
const maximumOutputLines = 200;
const capacityRetryDelayMs = 250;
const authoritativeStateRetryMs = 100;
const authoritativeStateAttempts = 30;
export type AgentRunPurpose =
  | 'initialization'
  | 'reinitialization'
  | 'group_completion'
  | 'file_completion'
  | 'project_chat'
  | 'annotation_answer'
  | 'approved_change';

export interface AgentInitializationRunnerOptions {
  readonly workspaceRoot: string;
  readonly task: (purpose: AgentRunPurpose) => string;
  readonly projectChatTask?: (message: string) => string;
  readonly annotationTask?: (annotationId: string) => string | undefined;
  readonly annotationAnswered?: (annotationId: string) => boolean;
  readonly approvedChangeTask?: (proposalId: string) => string | undefined;
  readonly approvedChangeCompleted?: (proposalId: string) => boolean;
  readonly authorize: (agent: ConfigurableAgent) => Promise<boolean>;
  readonly onUpdate: (run: AgentRunView) => void;
  readonly onConversationUpdate?: (conversation: AgentConversationView) => void;
  readonly now?: () => string;
  readonly spawnProcess?: typeof spawn;
  readonly verificationRetryMs?: number;
  readonly verificationAttempts?: number;
  readonly initialConversation?: AgentConversationView;
}

interface ActiveRun {
  readonly runId: string;
  readonly agent: ConfigurableAgent;
  readonly output: string[];
  readonly task: string;
  readonly purpose: AgentRunPurpose;
  readonly annotationId: string | undefined;
  readonly proposalId: string | undefined;
  process: ReturnType<typeof spawn> | undefined;
  sessionId: string | undefined;
  question: AgentQuestion | undefined;
  cancelled: boolean;
  failed: boolean;
  failureDetail: string | undefined;
  terminal: boolean;
  verified: boolean;
  capacityRetries: number;
  capacityFailureObserved: boolean;
  observedToolActivity: boolean;
  structuredOutputObserved: boolean;
  authenticationFailureObserved: boolean;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  completionClaim: Record<string, unknown> | undefined;
  readonly rawOutput: string[];
}

/** 启动一个受控的只读 Agent 会话，并把机器可读事件转换成有限的 UI 输出。 */
export class AgentInitializationRunner {
  readonly #options: AgentInitializationRunnerOptions;
  readonly #spawnProcess: typeof spawn;
  readonly #now: () => string;
  #active: ActiveRun | undefined;
  readonly #threadId: string;
  readonly #conversationMessages: AgentConversationMessage[] = [];
  #conversationSession:
    { readonly agent: ConfigurableAgent; readonly sessionId: string } | undefined;
  #conversation: AgentConversationView | undefined;
  #lastRun: AgentRunView | undefined;
  #lastRawOutput: readonly string[] = [];

  constructor(options: AgentInitializationRunnerOptions) {
    this.#options = options;
    this.#spawnProcess = options.spawnProcess ?? spawn;
    this.#now = options.now ?? (() => '');
    this.#threadId = options.initialConversation?.threadId ?? randomUUID();
    if (options.initialConversation !== undefined) {
      this.#conversationMessages.push(...options.initialConversation.messages);
      const { activeRunId: _activeRunId, ...restored } = options.initialConversation;
      this.#conversation = { ...restored, state: 'idle' };
    }
  }

  get activeRunId(): string | undefined {
    return this.#active?.runId;
  }

  get conversation(): AgentConversationView | undefined {
    return this.#conversation;
  }

  get lastRun(): AgentRunView | undefined {
    return this.#lastRun;
  }

  get lastRawOutput(): readonly string[] {
    return this.#lastRawOutput;
  }

  timestamp(): string {
    return this.#now();
  }

  recordUserMessage(agent: ConfigurableAgent, message: string): void {
    this.#conversationMessages.push(conversationMessage('user', message, this.#now()));
    this.#conversation = {
      threadId: this.#threadId,
      agent,
      state: 'idle',
      messages: [...this.#conversationMessages],
    };
    this.#options.onConversationUpdate?.(this.#conversation);
  }

  async start(
    agent: ConfigurableAgent,
    purpose: AgentRunPurpose = 'initialization',
    subjectId?: string,
  ): Promise<'started' | 'active' | 'not_ready'> {
    if (this.#active !== undefined && !this.#active.terminal) return 'active';
    if (!(await this.#options.authorize(agent))) return 'not_ready';
    const task =
      purpose === 'annotation_answer' && subjectId !== undefined
        ? this.#options.annotationTask?.(subjectId)
        : purpose === 'approved_change' && subjectId !== undefined
          ? this.#options.approvedChangeTask?.(subjectId)
          : this.#options.task(purpose);
    if (task === undefined) return 'not_ready';
    const run: ActiveRun = {
      runId: randomUUID(),
      agent,
      output: [],
      task,
      purpose,
      annotationId: purpose === 'annotation_answer' ? subjectId : undefined,
      proposalId: purpose === 'approved_change' ? subjectId : undefined,
      process: undefined,
      sessionId: undefined,
      question: undefined,
      cancelled: false,
      failed: false,
      failureDetail: undefined,
      terminal: false,
      verified: false,
      capacityRetries: 0,
      capacityFailureObserved: false,
      observedToolActivity: false,
      structuredOutputObserved: false,
      authenticationFailureObserved: false,
      retryTimer: undefined,
      completionClaim: undefined,
      rawOutput: [],
    };
    this.#active = run;
    this.#publish(run, 'starting', startingDetail(purpose));
    this.#launch(run, this.#initialPrompt(run.task, purpose));
    return 'started';
  }

  async sendMessage(
    agent: ConfigurableAgent,
    message: string,
  ): Promise<'started' | 'active' | 'not_ready'> {
    const active = this.#active;
    if (active !== undefined && !active.terminal) {
      if (active.purpose !== 'project_chat' || active.question === undefined) return 'active';
      this.#conversationMessages.push(
        conversationMessage('user', message, this.#now(), active.runId),
      );
      active.question = undefined;
      this.#publish(active, 'starting', '正在继续对话…');
      this.#launch(active, message, true);
      return 'started';
    }
    if (!(await this.#options.authorize(agent))) return 'not_ready';
    const task = this.#options.projectChatTask?.(message);
    if (task === undefined) return 'not_ready';
    const sessionId =
      this.#conversationSession?.agent === agent ? this.#conversationSession.sessionId : undefined;
    const run: ActiveRun = {
      runId: randomUUID(),
      agent,
      output: [],
      task,
      purpose: 'project_chat',
      annotationId: undefined,
      proposalId: undefined,
      process: undefined,
      sessionId,
      question: undefined,
      cancelled: false,
      failed: false,
      failureDetail: undefined,
      terminal: false,
      verified: false,
      capacityRetries: 0,
      capacityFailureObserved: false,
      observedToolActivity: false,
      structuredOutputObserved: false,
      authenticationFailureObserved: false,
      retryTimer: undefined,
      completionClaim: undefined,
      rawOutput: [],
    };
    this.#active = run;
    this.#conversationMessages.push(conversationMessage('user', message, this.#now(), run.runId));
    this.#publish(
      run,
      'starting',
      sessionId === undefined ? '正在连接项目 Agent…' : '正在继续对话…',
    );
    this.#launch(run, task, sessionId !== undefined);
    return 'started';
  }

  answer(runId: string, answer: string): boolean {
    const run = this.#active;
    if (
      run?.runId !== runId ||
      run.question === undefined ||
      run.question.scopeExpansion !== undefined ||
      run.sessionId === undefined
    ) {
      return false;
    }
    run.question = undefined;
    this.#append(run, `用户选择：${answer}`);
    this.#publish(run, 'starting', '正在把选择交给 Agent 并恢复任务…');
    this.#launch(
      run,
      `用户对上一条问题的回答是：${answer}\n请继续完成${purposeName(run.purpose)}任务。`,
      true,
    );
    return true;
  }

  answerScopeExpansion(
    runId: string,
    requestId: string,
    decision: 'approved' | 'rejected',
  ): boolean {
    const run = this.#active;
    const request = run?.question?.scopeExpansion;
    if (run?.runId !== runId || request?.requestId !== requestId || run.sessionId === undefined) {
      return false;
    }
    run.question = undefined;
    const approved = decision === 'approved';
    this.#append(
      run,
      approved
        ? `用户已批准扩围：${request.requestedFiles.join(', ')}`
        : `用户已拒绝扩围：${request.requestedFiles.join(', ')}`,
    );
    this.#publish(
      run,
      'starting',
      approved ? '扩围已批准，正在恢复同一会话…' : '扩围已拒绝，正在恢复同一会话…',
    );
    this.#launch(
      run,
      approved
        ? `God View 已记录用户批准。以下文件现在已加入当前 ChangeSet 的 approvedScope：${request.requestedFiles.join(', ')}。请在同一个 changeSetId 下继续实现；如还需其他文件，必须再次先调用 request_scope_expansion。`
        : `God View 已记录用户拒绝。不得修改以下文件：${request.requestedFiles.join(', ')}。请保持原 approvedScope，调整实现方案并继续；若无法完成，请如实以 interrupted 或 failed 结束 ChangeSet。`,
      true,
    );
    return true;
  }

  cancel(runId: string): boolean {
    const run = this.#active;
    if (run?.runId !== runId) return false;
    run.cancelled = true;
    if (run.retryTimer !== undefined) clearTimeout(run.retryTimer);
    run.retryTimer = undefined;
    run.process?.kill('SIGTERM');
    run.process = undefined;
    run.terminal = true;
    this.#publish(
      run,
      'cancelled',
      `用户已停止${purposeName(run.purpose)}；已写入的地图事件会保留。`,
    );
    return true;
  }

  dispose(): void {
    if (this.#active?.retryTimer !== undefined) clearTimeout(this.#active.retryTimer);
    this.#active?.process?.kill('SIGTERM');
    this.#active = undefined;
  }

  #initialPrompt(task: string, purpose: AgentRunPurpose): string {
    if (purpose === 'project_chat') return task;
    if (purpose === 'annotation_answer') {
      return [
        task,
        '',
        '附加交互规则：本任务不得修改用户源码。开始前必须确认本会话同时具有 get_map 和 answer_annotation；缺少任一工具就立即失败，不要只在终端打印答案。',
        '必须调用 answer_annotation 成功回写当前标注后，用且仅用一行输出：',
        `${resultPrefix}{"status":"completed","annotationId":"标注 ID"}`,
        `若无法回写，输出：${resultPrefix}{"status":"failed","message":"原因"}。`,
      ].join('\n');
    }
    if (purpose === 'approved_change') {
      return [
        task,
        '',
        '附加交互规则：这是用户已经批准范围的可写任务。必须先调用 start_approved_change，并记住返回的 changeSetId 与 approvedScope。',
        '在执行 Edit、Write、重定向输出、格式化或任何可能写文件的命令之前，逐一核对目标路径。若准备修改 approvedScope 外的文件，必须先调用 request_scope_expansion，提供当前 changeSetId、最新 get_map 的 baseMapRevision、完整新增文件列表和具体原因。工具调用成功后立即结束本轮，不得先写这些文件；等待 God View 用户批准或拒绝。只有批准后恢复的同一会话才可写入新增范围，拒绝后必须保持原范围。',
        '修改代码后，必须运行方案中的验证；随后用同一 changeSetId 更新受影响的 God View 节点和关系，明确记录职责、路径、依赖与数据流变化。',
        '最后调用 complete_change。只有 complete_change 成功且最终 get_map 显示 ChangeSet 已结束，才输出且仅输出一行：',
        `${resultPrefix}{"status":"completed","proposalId":"方案 ID"}`,
        `若无法完成或发生越界，输出：${resultPrefix}{"status":"failed","message":"原因"}。`,
      ].join('\n');
    }
    return [
      task,
      '',
      '附加交互规则：本任务不得修改用户源码。若必须让用户选择，请不要猜测；用且仅用一行输出：',
      `${questionPrefix}{"question":"问题","options":[{"id":"recommended","label":"推荐选项","description":"影响"}]}`,
      'options 必须有 2–3 项，然后结束本轮。其余情况下继续完成任务并在最后简述建图结果。',
      `最终再次调用 get_map，确认节点已可见且覆盖率符合任务要求后，用且仅用一行输出：${resultPrefix}{"status":"completed","mapRevision":1,"nodes":5,"unclassified":0}`,
      `若最终复核不通过，输出：${resultPrefix}{"status":"failed","message":"原因"}。不要把 MCP accepted 当作地图已落库。`,
    ].join('\n');
  }

  #launch(run: ActiveRun, prompt: string, resume = false): void {
    const command = commandFor(
      run.agent,
      this.#options.workspaceRoot,
      prompt,
      run.sessionId,
      resume,
      run.purpose,
    );
    const child = this.#spawnProcess(command.executable, command.args, {
      cwd: this.#options.workspaceRoot,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    run.process = child;
    this.#publish(
      run,
      'running',
      resume ? 'Agent 已恢复，继续执行…' : 'Agent 已启动，正在分析项目…',
    );
    let stdout = '';
    let stderr = '';
    const consume = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
      if (stream === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
      const source = stream === 'stdout' ? stdout : stderr;
      const parts = source.split(/\r?\n/u);
      const tail = parts.pop() ?? '';
      if (stream === 'stdout') stdout = tail;
      else stderr = tail;
      for (const line of parts) this.#consumeLine(run, line);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      consume(chunk, 'stdout');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      consume(chunk, 'stderr');
    });
    child.on('error', (error) => {
      if (run.cancelled || run.terminal) return;
      run.process = undefined;
      run.terminal = true;
      this.#append(run, `启动失败：${error.message}`);
      this.#publish(run, 'failed', '无法启动 Agent CLI。');
    });
    child.on('close', (code) => {
      void this.#finishProcess(run, code, resume, prompt, stdout, stderr);
    });
  }

  // eslint-disable-next-line complexity -- terminal process outcomes intentionally converge in one lifecycle boundary.
  async #finishProcess(
    run: ActiveRun,
    code: number | null,
    resume: boolean,
    prompt: string,
    stdout: string,
    stderr: string,
  ): Promise<void> {
    if (stdout.trim() !== '') this.#consumeLine(run, stdout);
    if (stderr.trim() !== '') this.#consumeLine(run, stderr);
    run.process = undefined;
    if (run.cancelled || run.terminal) return;
    if (this.#shouldRetryCapacityFailure(run, resume)) {
      run.capacityRetries += 1;
      run.capacityFailureObserved = false;
      run.failed = false;
      run.failureDetail = undefined;
      run.sessionId = undefined;
      this.#append(run, '当前模型暂时满载，将创建一个全新的 Agent 会话并自动重试一次。');
      this.#publish(run, 'starting', '模型暂时满载，正在安全重试（仅一次）…');
      run.retryTimer = setTimeout(() => {
        run.retryTimer = undefined;
        if (run.cancelled || run.terminal || run.process !== undefined) return;
        this.#launch(run, prompt);
      }, capacityRetryDelayMs);
      return;
    }
    if (run.question !== undefined) {
      this.#publish(run, 'awaiting_input', 'Agent 正在等待你的选择。');
    } else if (code === 0 && !run.failed && run.completionClaim !== undefined) {
      this.#publish(run, 'running', 'Agent 已完成写入，正在等待权威地图同步…');
      const verification = await this.#waitForAuthoritativeCompletion(run);
      if (verification === 'cancelled') return;
      if (verification === 'verified') {
        run.verified = true;
        run.terminal = true;
        this.#commitConversationRun(run);
        this.#publish(run, 'completed', completedDetail(run.purpose));
      } else {
        const message = verificationFailureMessage(run.purpose);
        run.failed = true;
        this.#append(run, message);
        run.terminal = true;
        this.#commitConversationRun(run);
        this.#publish(run, 'failed', message);
      }
    } else if (code === 0 && !run.failed && (run.verified || run.purpose === 'project_chat')) {
      run.terminal = true;
      this.#commitConversationRun(run);
      this.#publish(run, 'completed', completedDetail(run.purpose));
    } else {
      run.terminal = true;
      this.#commitConversationRun(run);
      this.#publish(
        run,
        'failed',
        run.failed
          ? (run.failureDetail ?? 'Agent 报告执行错误，请检查下方输出。')
          : code === 0
            ? 'Agent 已退出，但没有通过最终 get_map 复核，不能标记为完成。'
            : `Agent 退出码：${String(code ?? 'unknown')}`,
      );
    }
  }

  async #waitForAuthoritativeCompletion(
    run: ActiveRun,
  ): Promise<'verified' | 'cancelled' | 'timeout'> {
    const attempts = this.#options.verificationAttempts ?? authoritativeStateAttempts;
    const retryMs = this.#options.verificationRetryMs ?? authoritativeStateRetryMs;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (run.cancelled || run.terminal || run.completionClaim === undefined) return 'cancelled';
      if (this.#isVerifiedCompletion(run, run.completionClaim)) return 'verified';
      if (attempt + 1 < attempts) await wait(retryMs);
    }
    return 'timeout';
  }

  // eslint-disable-next-line complexity -- normalizes two nested CLI stream formats plus control markers.
  #consumeLine(run: ActiveRun, raw: string): void {
    const line = raw.trim();
    if (line === '') return;
    run.rawOutput.push(line.slice(0, 100_000));
    if (run.rawOutput.length > maximumOutputLines) run.rawOutput.shift();
    if (/selected model is at capacity/iu.test(line)) run.capacityFailureObserved = true;
    if (line.includes(questionPrefix) || line.includes(resultPrefix)) {
      run.structuredOutputObserved = true;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      if (isAuthenticationFailureMessage(line)) {
        run.failed = true;
        run.authenticationFailureObserved = true;
      }
      this.#append(run, line);
      this.#detectQuestion(run, line);
      this.#detectResult(run, line);
      return;
    }
    const record = asRecord(parsed);
    if (containsToolActivity(parsed)) run.observedToolActivity = true;
    const sessionId = stringValue(record?.['session_id']) ?? stringValue(record?.['thread_id']);
    if (sessionId !== undefined) run.sessionId = sessionId;
    if (isFailureEvent(record)) {
      run.failed = true;
      if (isAuthenticationFailureMessage(line)) run.authenticationFailureObserved = true;
    }
    for (const text of extractTexts(parsed)) {
      this.#detectScopeExpansion(run, text);
      this.#append(run, summarizeToolPayload(text));
      this.#detectQuestion(run, text);
      this.#detectResult(run, text);
    }
    const progress = progressLabel(record);
    if (progress !== undefined) this.#append(run, progress);
    this.#publish(run, 'running');
  }

  #detectScopeExpansion(run: ActiveRun, text: string): void {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{')) return;
    try {
      const record = asRecord(JSON.parse(trimmed) as unknown);
      const request = asRecord(record?.['scopeExpansionRequest']);
      const requestedFiles = Array.isArray(request?.['requestedFiles'])
        ? request['requestedFiles'].filter((path): path is string => typeof path === 'string')
        : [];
      if (
        record?.['accepted'] === true &&
        request?.['status'] === 'pending' &&
        typeof request['id'] === 'string' &&
        typeof request['changeSetId'] === 'string' &&
        typeof request['reason'] === 'string' &&
        requestedFiles.length > 0 &&
        requestedFiles.length === (request['requestedFiles'] as unknown[]).length
      ) {
        run.question = {
          question: 'Agent 需要修改批准范围外的文件，是否允许扩大本次 ChangeSet 范围？',
          options: [
            {
              id: 'approved',
              label: '批准并继续',
              description: '把列出的文件加入本次批准范围，并恢复同一个 Agent 会话。',
            },
            {
              id: 'rejected',
              label: '拒绝扩围',
              description: '保持原范围，Agent 不得修改这些文件。',
            },
          ],
          scopeExpansion: {
            requestId: request['id'],
            changeSetId: request['changeSetId'],
            requestedFiles,
            reason: request['reason'],
          },
        };
      }
    } catch {
      // 不是扩围工具结果，继续按普通输出处理。
    }
  }

  #shouldRetryCapacityFailure(run: ActiveRun, resume: boolean): boolean {
    return (
      run.agent === 'codex' &&
      !resume &&
      run.capacityRetries === 0 &&
      run.capacityFailureObserved &&
      !run.observedToolActivity &&
      !run.structuredOutputObserved &&
      !run.authenticationFailureObserved &&
      run.question === undefined &&
      !run.verified
    );
  }

  #detectQuestion(run: ActiveRun, text: string): void {
    const index = text.indexOf(questionPrefix);
    if (index < 0) return;
    try {
      const parsed = JSON.parse(text.slice(index + questionPrefix.length).trim()) as unknown;
      const record = asRecord(parsed);
      const options = Array.isArray(record?.['options'])
        ? record['options'].map(asQuestionOption).filter((one) => one !== undefined)
        : [];
      if (typeof record?.['question'] === 'string' && options.length >= 2 && options.length <= 3) {
        run.question = { question: record['question'], options };
      }
    } catch {
      // 非法标记只是普通输出，不能让运行状态卡在等待输入。
    }
  }

  #detectResult(run: ActiveRun, text: string): void {
    const index = text.indexOf(resultPrefix);
    if (index < 0) return;
    try {
      const record = asRecord(JSON.parse(text.slice(index + resultPrefix.length).trim()));
      if (record?.['status'] === 'completed') {
        if (run.purpose === 'annotation_answer' || run.purpose === 'approved_change') {
          if (this.#claimMatchesSubject(run, record)) run.completionClaim = record;
          else {
            run.failed = true;
            this.#append(run, 'Agent 返回的完成标记与当前任务不匹配。');
          }
        } else if (this.#isVerifiedCompletion(run, record)) run.verified = true;
        else {
          run.failed = true;
          this.#append(run, verificationFailureMessage(run.purpose));
        }
      }
      if (record?.['status'] === 'failed') {
        run.failed = true;
        const message = stringValue(record['message']);
        if (message !== undefined) {
          run.failureDetail = message;
          this.#append(run, `最终复核失败：${message}`);
        }
      }
    } catch {
      run.failed = true;
      this.#append(run, 'Agent 返回的最终复核标记无法解析。');
    }
  }

  #claimMatchesSubject(run: ActiveRun, record: Record<string, unknown>): boolean {
    return run.purpose === 'annotation_answer'
      ? run.annotationId !== undefined && record['annotationId'] === run.annotationId
      : run.proposalId !== undefined && record['proposalId'] === run.proposalId;
  }

  #isVerifiedCompletion(run: ActiveRun, record: Record<string, unknown>): boolean {
    if (run.purpose === 'annotation_answer') {
      return (
        run.annotationId !== undefined &&
        record['annotationId'] === run.annotationId &&
        this.#options.annotationAnswered?.(run.annotationId) === true
      );
    }
    if (run.purpose === 'approved_change') {
      return (
        run.proposalId !== undefined &&
        record['proposalId'] === run.proposalId &&
        this.#options.approvedChangeCompleted?.(run.proposalId) === true
      );
    }
    return (
      isNonNegativeInteger(record['mapRevision']) &&
      record['mapRevision'] > 0 &&
      isNonNegativeInteger(record['nodes']) &&
      record['nodes'] > 0 &&
      isNonNegativeInteger(record['unclassified'])
    );
  }

  #append(run: ActiveRun, line: string): void {
    const clean = removeControlCharacters(line).trim();
    if (clean === '' || clean.startsWith(questionPrefix) || clean.startsWith(resultPrefix)) return;
    const clipped = clean.slice(0, 2_000);
    // Codex/Claude 的 stream-json 可能在父 result 与嵌套 content 同时携带同一文本。
    // 相邻完全重复或一方只是另一方的包装时，只保留信息更完整的一份。
    const previous = run.output.at(-1);
    if (previous === clipped) return;
    if (previous !== undefined && clipped.includes(previous)) run.output.pop();
    else if (previous?.includes(clipped) === true) return;
    run.output.push(clipped);
    if (run.output.length > maximumOutputLines)
      run.output.splice(0, run.output.length - maximumOutputLines);
  }

  #publish(run: ActiveRun, state: AgentRunView['state'], detail?: string): void {
    this.#lastRun = {
      runId: run.runId,
      agent: run.agent,
      state,
      output: [...run.output],
      ...(run.question === undefined ? {} : { question: run.question }),
      ...(detail === undefined ? {} : { detail }),
      restartRequired: state === 'completed' && run.purpose === 'initialization',
      purpose: run.purpose,
      ...(run.annotationId === undefined ? {} : { annotationId: run.annotationId }),
      ...(run.proposalId === undefined ? {} : { proposalId: run.proposalId }),
    };
    this.#options.onUpdate(this.#lastRun);
    this.#publishConversation(run, state);
  }

  #commitConversationRun(run: ActiveRun): void {
    this.#lastRawOutput = [...run.rawOutput];
    if (run.sessionId !== undefined) {
      this.#conversationSession = { agent: run.agent, sessionId: run.sessionId };
    }
    if (run.output.length > 0) {
      this.#conversationMessages.push(
        conversationMessage(
          run.purpose === 'project_chat' ? 'agent' : 'activity',
          run.output.join('\n'),
          this.#now(),
          run.runId,
        ),
      );
    }
  }

  #publishConversation(run: ActiveRun, state: AgentRunView['state']): void {
    const active = ['starting', 'running', 'awaiting_input'].includes(state);
    const live =
      !active || run.output.length === 0
        ? []
        : [
            conversationMessage(
              run.purpose === 'project_chat' ? 'agent' : 'activity',
              run.output.join('\n'),
              this.#now(),
              run.runId,
              `live-${run.runId}`,
            ),
          ];
    this.#conversation = {
      threadId: this.#threadId,
      agent: run.agent,
      state:
        state === 'awaiting_input'
          ? 'awaiting_input'
          : run.purpose === 'approved_change' && active
            ? 'editing'
            : state === 'failed'
              ? 'failed'
              : active
                ? 'running'
                : 'idle',
      messages: [...this.#conversationMessages, ...live],
      ...(active ? { activeRunId: run.runId } : {}),
    };
    this.#options.onConversationUpdate?.(this.#conversation);
  }
}

function purposeName(purpose: AgentRunPurpose): string {
  return {
    initialization: '首次建图',
    reinitialization: '重新初始化',
    group_completion: '分组层级补全',
    file_completion: '关键文件关系补全',
    project_chat: '项目对话',
    annotation_answer: '标注解释',
    approved_change: '批准后编辑',
  }[purpose];
}

function startingDetail(purpose: AgentRunPurpose): string {
  return purpose === 'initialization'
    ? '正在启动新的 Agent 会话…'
    : `正在启动${purposeName(purpose)} Agent 会话…`;
}

function completedDetail(purpose: AgentRunPurpose): string {
  if (purpose === 'project_chat') return 'Agent 已回复，你可以继续追问。';
  if (purpose === 'annotation_answer') {
    return '标注分析已回写。若这是修改请求，请审核方案并批准文件范围；批准后 Agent 才会开始实现。';
  }
  return purpose === 'initialization'
    ? '首次建图任务已结束。请核对地图，并重启其他已打开的 Agent 会话。'
    : `${purposeName(purpose)}已完成并通过最终复核；地图已刷新。`;
}

function verificationFailureMessage(purpose: AgentRunPurpose): string {
  if (purpose === 'annotation_answer') {
    return 'Agent 报告完成，但等待权威地图同步后仍未找到该标注的回写答案。';
  }
  if (purpose === 'approved_change') {
    return 'Agent 报告完成，但等待权威地图同步后仍未形成待验收 Diff，或没有同步受影响的地图模块/关系。';
  }
  return 'Agent 返回的最终复核结果缺少合法的 revision、节点数或覆盖数字。';
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function conversationMessage(
  role: AgentConversationMessage['role'],
  body: string,
  createdAt: string,
  runId?: string,
  id: string = randomUUID(),
): AgentConversationMessage {
  return {
    id,
    role,
    body,
    createdAt,
    ...(runId === undefined ? {} : { runId }),
  };
}

function removeControlCharacters(value: string): string {
  let clean = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      clean += character;
    }
  }
  return clean;
}

function commandFor(
  agent: ConfigurableAgent,
  workspaceRoot: string,
  prompt: string,
  sessionId: string | undefined,
  resume: boolean,
  purpose: AgentRunPurpose,
): { executable: string; args: string[] } {
  const writable = purpose === 'approved_change';
  if (agent === 'codex') {
    return {
      executable: 'codex',
      args:
        resume && sessionId !== undefined
          ? ['exec', 'resume', '--json', sessionId, prompt]
          : [
              'exec',
              '--json',
              '--sandbox',
              writable ? 'workspace-write' : 'read-only',
              '--skip-git-repo-check',
              '--cd',
              workspaceRoot,
              prompt,
            ],
    };
  }
  return {
    executable: 'claude',
    args: [
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      writable ? 'acceptEdits' : 'dontAsk',
      '--allowedTools',
      writable
        ? 'Read,Glob,Grep,Bash,Edit,Write,mcp__god-view__*'
        : 'Read,Glob,Grep,mcp__god-view__*',
      '--disallowedTools',
      writable ? 'NotebookEdit' : 'Bash,Edit,Write,NotebookEdit',
      ...(resume && sessionId !== undefined ? ['--resume', sessionId] : []),
      prompt,
    ],
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

// eslint-disable-next-line complexity -- safely recognizes multiple MCP response envelopes without trusting their schema.
function summarizeToolPayload(text: string): string {
  const trimmed = text.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return text;
  }
  const record = asRecord(parsed);
  if (record === undefined) {
    return 'God View 返回了结构化结果（界面已折叠，导出对话可查看原始输出）。';
  }
  if (isNonNegativeInteger(record['mapRevision']) && Array.isArray(record['nodes'])) {
    const coverage = asRecord(record['coverage']);
    const unclassified = isNonNegativeInteger(coverage?.['unclassified'])
      ? coverage['unclassified']
      : undefined;
    return (
      [
        `已读取权威地图：r${String(record['mapRevision'])}`,
        `${String(record['nodes'].length)} 个节点`,
        `${String(Array.isArray(record['edges']) ? record['edges'].length : 0)} 条关系`,
        ...(unclassified === undefined ? [] : [`${String(unclassified)} 个未分类文件`]),
      ].join(' · ') + '。'
    );
  }
  if (typeof record['accepted'] === 'boolean') {
    if (record['accepted']) {
      return isNonNegativeInteger(record['mapRevision'])
        ? `God View 写入已接受：地图推进至 r${String(record['mapRevision'])}。`
        : 'God View 写入已接受，正在等待权威地图同步。';
    }
    const errors = Array.isArray(record['errors']) ? record['errors'] : [];
    const first = asRecord(errors[0]);
    const code = stringValue(first?.['code']);
    const message = stringValue(first?.['message']);
    const reason = [code, message].filter((one) => one !== undefined).join('：');
    return reason === '' ? 'God View 拒绝了本次写入。' : `God View 拒绝写入：${reason}`;
  }
  return 'God View 返回了结构化结果（界面已折叠，导出对话可查看原始输出）。';
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function extractTexts(value: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (typeof value === 'string') return [];
  if (Array.isArray(value)) return value.flatMap((one) => extractTexts(one, depth + 1));
  const record = asRecord(value);
  if (record === undefined) return [];
  const direct = ['text', 'result'].flatMap((key) =>
    typeof record[key] === 'string' ? [record[key]] : [],
  );
  return [...direct, ...Object.values(record).flatMap((one) => extractTexts(one, depth + 1))];
}

function progressLabel(record: Record<string, unknown> | undefined): string | undefined {
  const type = stringValue(record?.['type']);
  if (type === 'thread.started' || (type === 'system' && record?.['subtype'] === 'init'))
    return 'Agent 会话已建立。';
  if (type === 'turn.started') return 'Agent 开始处理任务。';
  if (type === 'turn.completed') return 'Agent 本轮处理完成。';
  return undefined;
}

function isFailureEvent(record: Record<string, unknown> | undefined): boolean {
  const type = stringValue(record?.['type']);
  return (
    record?.['is_error'] === true ||
    type === 'error' ||
    type === 'turn.failed' ||
    (type === 'result' && record?.['subtype'] === 'error')
  );
}

function isAuthenticationFailureMessage(value: string): boolean {
  return (
    /\bnot logged in\b|\bauthentication failed\b|\bplease log in\b/iu.test(value) ||
    /\b401\s+unauthorized\b|\bunauthorized\s*:\s*(?:please\s+)?log in\b/iu.test(value)
  );
}

function containsToolActivity(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((one) => containsToolActivity(one, depth + 1));
  const record = asRecord(value);
  if (record === undefined) return false;
  const type = stringValue(record['type'])?.toLowerCase();
  const name = stringValue(record['name'])?.toLowerCase();
  if (isToolActivityType(type) || name?.startsWith('mcp__') === true) {
    return true;
  }
  return Object.values(record).some((one) => containsToolActivity(one, depth + 1));
}

function isToolActivityType(type: string | undefined): boolean {
  return [
    'mcp_tool_call',
    'tool_call',
    'tool_use',
    'function_call',
    'command_execution',
    'web_search',
  ].includes(type ?? '');
}

function asQuestionOption(value: unknown): AgentQuestion['options'][number] | undefined {
  const record = asRecord(value);
  return typeof record?.['id'] === 'string' && typeof record['label'] === 'string'
    ? {
        id: record['id'],
        label: record['label'],
        ...(typeof record['description'] === 'string'
          ? { description: record['description'] }
          : {}),
      }
    : undefined;
}
