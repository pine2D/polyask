import { useRef, useState } from "react";
import type { DesktopCopy } from "../shared/copy";
import type { SynthesisSendRequest } from "../shared/synthesis";
import type { DraftReceipt } from './draft-receipt';
import { shell } from './shell-api';
import { describeSynthesisSendCode, errorCode } from "../shared/status-copy";
import { useGlobalFeedback } from "./feedback-provider";
import type { useSynthesisFlow } from "./use-synthesis-flow";

export interface SynthesisEditorRequest {
  readonly archiveId: string;
  readonly followUpHost?: string;
  readonly revision: number;
}

/** 发送前恢复站点视图；失败动作只返回完整表单，不自动重发。 */
export function useSynthesisRecovery(copy: DesktopCopy, synthesis: ReturnType<typeof useSynthesisFlow>,
  prepareTarget: () => void, returnToArchive: () => void) {
  const { announce, setNoticeAction } = useGlobalFeedback();
  const revision = useRef(0);
  const resetEpoch = useRef(0);
  const [editorRequest, setEditorRequest] = useState<SynthesisEditorRequest | null>(null);
  const send = async (request: SynthesisSendRequest, receipt?: DraftReceipt): Promise<void> => {
    const operation = resetEpoch.current;
    const followUpHost = request.excerpt !== undefined ? request.selectedHosts[0] : undefined;
    const sentDraftVersion = synthesis.drafts.version(request.archiveId, followUpHost);
    try {
      await synthesis.send(request, prepareTarget);
      if (operation !== resetEpoch.current) return;
      synthesis.drafts.remove(request.archiveId, followUpHost, sentDraftVersion);
      const context = JSON.stringify([request.archiveId, followUpHost ?? null]);
      void Promise.resolve(receipt).then(async draft => {
        if (operation !== resetEpoch.current || draft?.kind !== 'synthesis' || draft.context !== context || !shell.listDrafts || !shell.removeDraft) return;
        const state = await shell.listDrafts('synthesis', context);
        if (operation !== resetEpoch.current || draft.deviceId !== state.deviceId) return;
        return shell.removeDraft(draft.id, draft.updatedAt, state.epoch);
      }).catch(() => { if (operation === resetEpoch.current) announce(copy.draftRemoveFailed); });
      setEditorRequest(null);
      announce(request.excerpt !== undefined ? copy.followUpSent : copy.synthesisSent);
    } catch (error) {
      if (operation !== resetEpoch.current) throw error;
      announce(describeSynthesisSendCode(copy, errorCode(error)));
      setNoticeAction({ label: copy.synthesisReturnToEdit, run: () => {
        setEditorRequest({ archiveId: request.archiveId, followUpHost, revision: ++revision.current });
        setNoticeAction(null); returnToArchive();
      } });
      throw error;
    }
  };
  const clear = () => { resetEpoch.current++; setEditorRequest(null); setNoticeAction(null); synthesis.clearDrafts(); };
  const consumeEditorRequest = () => setEditorRequest(null);
  return { send, editorRequest, clear, consumeEditorRequest };
}
