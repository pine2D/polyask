import { useState } from "react";
import { useGlobalFeedback } from "./feedback-provider";

export interface Feedback {
  /** 读屏播报文本；同一句连播两次时靠 `announcementSeq` 让 live region 重挂，否则 React 不重渲染、读屏也不再播。 */
  readonly announcement: string;
  readonly announcementSeq: number;
  readonly announce: (text: string, visible?: boolean, transient?: boolean) => void;
  /** 工作区抽屉里站点动作（复制报告/重载/清缓存）的可见反馈；抽屉没有设置页那样的状态脚注，只靠读屏播报对明眼用户是零反馈。 */
  readonly healthFeedback: string;
  readonly noteHealth: (text: string) => void;
}

export function useFeedback(): Feedback {
  const { announcement, announcementSeq, announce } = useGlobalFeedback();
  const [healthFeedback, setHealthFeedback] = useState("");
  const noteHealth = (text: string): void => { setHealthFeedback(text); announce(text); };
  return { announcement, announcementSeq, announce, healthFeedback, noteHealth };
}
