import { MIN_SITE_COLUMN_WIDTH } from "./display";
export const QUESTION_PANEL_WIDTH = 360;
// One useful site column plus panel, including the largest density's edge gaps.
export const QUESTION_PANEL_BREAKPOINT = QUESTION_PANEL_WIDTH + MIN_SITE_COLUMN_WIDTH + 16;
export const historyPanelWidth = (width: number, open: boolean): number =>
  open && width >= QUESTION_PANEL_BREAKPOINT ? QUESTION_PANEL_WIDTH : 0;
