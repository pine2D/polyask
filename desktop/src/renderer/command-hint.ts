import { commandAccelerator, type CommandId } from "../shared/commands";
import { shortcutLabel } from "./shortcut-label";

export function commandHint(label: string, command: CommandId, isMac = false): string {
  const accelerator = commandAccelerator(command, isMac ? "darwin" : "win32");
  if (!accelerator) return label;
  return `${label} (${shortcutLabel(accelerator, isMac)})`;
}
