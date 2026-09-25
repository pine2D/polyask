/** 显示层格式化；命令注册、搜索与 Electron accelerator 保持原值。 */
export function shortcutLabel(accelerator: string, isMac: boolean): string {
  const keys = accelerator.replace(/CommandOrControl|CmdOrCtrl/g, isMac ? 'Command' : 'Control').split('+');
  if (!isMac) return keys.map(key => key === 'Control' ? 'Ctrl' : key).join('+');
  const modifiers = ['Control', 'Alt', 'Shift', 'Command'];
  const symbols: Record<string, string> = {
    Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘', Enter: '↵', Return: '↵',
    Backspace: '⌫', Delete: '⌦', Escape: '⎋', Tab: '⇥', Up: '↑', Down: '↓',
    Left: '←', Right: '→', PageUp: '⇞', PageDown: '⇟', Home: '↖', End: '↘', Space: '␣', Plus: '+', Minus: '-'
  };
  return [...modifiers.filter(key => keys.includes(key)), ...keys.filter(key => !modifiers.includes(key))]
    .map(key => symbols[key] ?? key).join('');
}
