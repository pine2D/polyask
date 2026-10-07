import type { PendingSynthesis } from '../shared/synthesis';

/** 只描述本次会话知道的发送背景，不加入保存或同步记录。 */
export interface SynthesisSession {
  readonly archiveId: string;
  readonly targetSite: PendingSynthesis['targetSite'];
  readonly sentAt: number;
  readonly purpose: 'synthesis' | 'followUp';
  readonly sourceUpdatedAt?: number;
}
export function matchingSynthesisSession(session: SynthesisSession | null | undefined,
  pending: PendingSynthesis | null): SynthesisSession | null {
  return session && pending && session.archiveId === pending.archiveId && session.targetSite === pending.targetSite
    && session.sentAt === pending.sentAt ? session : null;
}
