import type { WebviewCommand } from '@god-view/webview-bridge';
import type { AgentRunPurpose } from '../agent-initialization-runner.js';

export function purposeForCommand(
  command: Extract<
    WebviewCommand,
    { type: 'startInitialization' | 'startReinitialization' | 'startMapCompletion' }
  >,
): AgentRunPurpose {
  if (command.type === 'startReinitialization') return 'reinitialization';
  if (command.type === 'startMapCompletion')
    return command.target === 'groups' ? 'group_completion' : 'file_completion';
  return 'initialization';
}
