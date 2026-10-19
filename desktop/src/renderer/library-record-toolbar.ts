import { createContext } from 'react';

// 专注阅读时把记录操作放进顶栏的真实 DOM 顺序，正文仍留在原滚动容器。
export const LibraryRecordToolbar = createContext<HTMLElement | null>(null);
