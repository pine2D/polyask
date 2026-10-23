import { requestDecisionNavigation } from "./decision-navigation";
import type { CommandId } from "../shared/commands";
import { externalNavigationBlocked } from './external-navigation-lock';

export type CommandActions = Partial<Record<CommandId, () => void>>;

export function executeCommand(id: CommandId, actions: CommandActions): boolean {
  if (externalNavigationBlocked()) return false;
  const action = actions[id];
  if (!action) return false;
  requestDecisionNavigation(action, { kind: 'command', id });
  return true;
}
