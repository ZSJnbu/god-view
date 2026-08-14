import type { WebviewCommand } from '@god-view/webview-bridge';
import type { NativeAgentPurpose } from '../native-agent-host.js';

export function purposeForCommand(
  command: Extract<
    WebviewCommand,
    { type: 'startInitialization' | 'startReinitialization' | 'startMapCompletion' }
  >,
): NativeAgentPurpose {
  if (command.type === 'startReinitialization') return 'reinitialization';
  if (command.type === 'startMapCompletion')
    return command.target === 'groups' ? 'group_completion' : 'file_completion';
  return 'initialization';
}
