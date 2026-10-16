import { useEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import { ConfirmDialog } from './confirm-dialog';
import { registerDecisionNavigationGuard } from './decision-navigation';

const SETTINGS_COMMANDS = new Set(['open-settings', 'open-display-settings', 'open-data-settings', 'open-drive-diagnostics']);

/** 只持有未保存标志与离开意图，表单及密码仍由设置卡持有。 */
export function useProxyLeaveGuard(copy: DesktopCopy, dirty: boolean, onDiscard: () => void): React.JSX.Element | null {
  const latest = useRef({ dirty, onDiscard }); latest.current = { dirty, onDiscard };
  const pending = useRef<(() => void) | null>(null);
  const [open, setOpen] = useState(false);
  const cancel = () => { pending.current = null; setOpen(false); };
  useEffect(() => registerDecisionNavigationGuard((action, intent) => {
    if (pending.current) return; // 首个意图等待用户选择，后来的命令不能偷偷换掉目标。
    if (!latest.current.dirty || (intent?.kind === 'command' && SETTINGS_COMMANDS.has(intent.id))) { action(); return; }
    pending.current = action;
    setOpen(true);
  }), []);
  useEffect(() => { if (!dirty) cancel(); }, [dirty]);
  return open && dirty ? <ConfirmDialog copy={copy} title={copy.proxyLeaveTitle} message={copy.proxyLeaveMessage}
    cancelLabel={copy.proxyKeepEditing} confirmLabel={copy.proxyDiscardAndLeave} onCancel={cancel}
    onConfirm={() => {
      const action = pending.current;
      cancel();
      if (action) { latest.current.onDiscard(); action(); }
    }} /> : null;
}
