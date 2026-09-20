import { commandAccelerator, type CommandId } from "../shared/commands";

export function commandHint(label: string, command: CommandId, isMac = false): string {
  const accelerator = commandAccelerator(command, isMac ? "darwin" : "win32");
  if (!accelerator) return label;
  const keys = accelerator.replace(/CmdOrCtrl|CommandOrControl/g, isMac ? "⌘" : "Ctrl")
    .replace(/Command/g, "⌘").replace(/Control/g, "Ctrl")
    .replace(/Alt/g, isMac ? "⌥" : "Alt");
  return `${label} (${keys})`;
}
