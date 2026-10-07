import { useRef, useState } from 'react';
import type { SiteDefinition, SiteKey } from '../shared/contracts';
import type { DesktopCopy } from '../shared/copy';
import type { SiteHealth } from '../shared/site-health';
import { useWorkbenchGuide, type WorkbenchGuideOptions } from './use-workbench-guide';
import { WorkbenchGuideInvite, WorkbenchGuidePanel } from './workbench-guide';

interface GuideFlowOptions extends WorkbenchGuideOptions {
  readonly copy: DesktopCopy; readonly sites: readonly SiteDefinition[];
  readonly health: Readonly<Partial<Record<SiteKey, SiteHealth>>>;
  readonly onOpen: () => void; readonly onChooseSites: () => void;
  readonly onCheckSites: (sites: readonly SiteKey[]) => void;
  readonly onFocusSite: (site: SiteKey) => void; readonly onFocusPrompt: () => void;
}
export function useWorkbenchGuideFlow(options: GuideFlowOptions) {
  const guide = useWorkbenchGuide(options);
  const [open, setOpen] = useState(false);
  const archive = useRef<{ id: string; questionId: string; request: number } | null>(null);
  if (!guide.pendingNavigation || guide.pendingNavigation.request !== archive.current?.request) archive.current = null;
  const dismiss = () => { guide.dismiss(); setOpen(false); archive.current = null; };
  return {
    invite: <WorkbenchGuideInvite copy={options.copy} model={guide.model} onOpen={() => { setOpen(true); options.onOpen(); }} onDismiss={dismiss} />,
    panel: open ? <WorkbenchGuidePanel {...options} model={guide.model} pending={guide.pendingNavigation !== null}
      onChooseSites={() => { setOpen(false); options.onChooseSites(); }} onRead={() => { guide.navigate('read'); }}
      onCompare={() => { guide.navigate('compare'); }} onDismiss={dismiss} /> : null,
    readAccepted: guide.acknowledgeRead,
    cancel: (request?: number) => { if (guide.cancelNavigation(request)) archive.current = null; },
    archiveCreated: (id: string, mode: 'read' | 'compare', questionId: string, answerIds: readonly string[]) => {
      const pending = guide.pendingNavigation;
      if (!pending || pending.mode !== 'compare') return;
      if (mode !== 'compare' || pending.questionId !== questionId || answerIds.length !== 2 ||
        !pending.answerIds.every(answerId => answerIds.includes(answerId))) { guide.cancelNavigation(pending.request); return; }
      archive.current = { id, questionId, request: pending.request };
    },
    archiveEntered: (id: string, mode: string) => {
      const pending = archive.current;
      if (pending && pending.id === id && mode === 'compare') {
        guide.acknowledgeCompare(pending.questionId, pending.request, id); archive.current = null;
      }
    },
    invalidate: () => { archive.current = null; setOpen(false); guide.invalidate(); }
  };
}
