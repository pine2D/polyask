export const READING_COPY = {
  en: {
    readingTable: 'Table {count}', readingContextTable: '{context}, table {count}', readingContextParagraph: '{context}, paragraph {count}',
    readingCode: 'Code', readingCopyCode: 'Copy code', readingCodeCopied: 'Code copied',
    readingHighlightLimit: 'Code block too large to highlight.', readingHighlightUnsupported: 'No syntax highlighting for this language.',
    readingFormula: 'Formula', readingFormulaPreview: 'Render formula', readingFormulaSource: 'LaTeX source', readingFormulaLoading: 'Rendering formula…',
    readingFormulaFailed: 'Could not render formula.', readingFormulaLimit: 'Formula too large to render.',
    readingFormulaUnsupported: 'Unsupported LaTeX syntax.', readingFormulaBusy: 'Rendering another formula; try again.',
    readingFormulaTimeout: 'Formula render timed out.',
    readingLinkDetails: 'Show full URL', readingCopyLink: 'Copy link', readingLinkCopied: 'Link copied', readingCopyFailed: 'Could not copy.',
    readingDiagram: 'Mermaid diagram', readingPreview: 'Diagram', readingSource: 'Source', readingCopySource: 'Copy diagram code', readingSourceCopied: 'Diagram code copied',
    readingDiagramLoading: 'Rendering diagram…', readingDiagramFailed: 'Could not render diagram.',
    readingDiagramMissing: 'Could not extract diagram source from the page; open the live chat to view it.',
    readingDiagramLimit: 'Diagram too large to render.',
    readingZoomIn: 'Zoom in', readingZoomOut: 'Zoom out', readingZoomReset: 'Fit width',
    questionCopyLink: 'Copy chat URL', questionLinkCopied: 'Chat URL copied', questionOpenBrowser: 'Open chat in browser'
  },
  zhCN: {
    readingTable: '表格 {count}', readingContextTable: '{context}，表格 {count}', readingContextParagraph: '{context}，段落 {count}',
    readingCode: '代码', readingCopyCode: '复制代码', readingCodeCopied: '代码已复制',
    readingHighlightLimit: '代码块过长，未着色。', readingHighlightUnsupported: '该语言暂不支持着色。',
    readingFormula: '公式', readingFormulaPreview: '显示公式', readingFormulaSource: '公式源码', readingFormulaLoading: '正在渲染公式…',
    readingFormulaFailed: '公式渲染失败。', readingFormulaLimit: '公式过长，未渲染。',
    readingFormulaUnsupported: '含暂不支持的公式语法。', readingFormulaBusy: '正在渲染另一处公式，稍后再试。',
    readingFormulaTimeout: '公式渲染超时。',
    readingLinkDetails: '展开完整网址', readingCopyLink: '复制链接', readingLinkCopied: '链接已复制', readingCopyFailed: '复制失败。',
    readingDiagram: 'Mermaid 图表', readingPreview: '预览', readingSource: '源码', readingCopySource: '复制图表源码', readingSourceCopied: '图表源码已复制',
    readingDiagramLoading: '正在绘制图表…', readingDiagramFailed: '图表绘制失败。',
    readingDiagramMissing: '未能从原网页提取图表内容，需回原站对话查看。', readingDiagramLimit: '图表过大，未绘制。',
    readingZoomIn: '放大', readingZoomOut: '缩小', readingZoomReset: '适应宽度',
    questionCopyLink: '复制对话链接', questionLinkCopied: '对话链接已复制', questionOpenBrowser: '在系统浏览器中打开'
  },
  zhTW: {
    readingTable: '表格 {count}', readingContextTable: '{context}，表格 {count}', readingContextParagraph: '{context}，段落 {count}',
    readingCode: '程式碼', readingCopyCode: '複製程式碼', readingCodeCopied: '程式碼已複製',
    readingHighlightLimit: '程式碼區塊過長，未套用語法突顯。', readingHighlightUnsupported: '此語言暫不支援語法突顯。',
    readingFormula: '公式', readingFormulaPreview: '顯示公式', readingFormulaSource: '公式原始碼', readingFormulaLoading: '正在處理公式…',
    readingFormulaFailed: '公式顯示失敗。', readingFormulaLimit: '公式過長，未顯示。',
    readingFormulaUnsupported: '含暫不支援的公式語法。', readingFormulaBusy: '正在處理另一處公式，稍後再試。',
    readingFormulaTimeout: '公式顯示逾時。',
    readingLinkDetails: '展開完整網址', readingCopyLink: '複製連結', readingLinkCopied: '連結已複製', readingCopyFailed: '複製失敗。',
    readingDiagram: 'Mermaid 圖表', readingPreview: '預覽', readingSource: '原始碼', readingCopySource: '複製圖表原始碼', readingSourceCopied: '圖表原始碼已複製',
    readingDiagramLoading: '正在繪製圖表…', readingDiagramFailed: '圖表繪製失敗。',
    readingDiagramMissing: '未能從原網頁擷取圖表內容，需回原網站對話查看。', readingDiagramLimit: '圖表過大，未繪製。',
    readingZoomIn: '放大', readingZoomOut: '縮小', readingZoomReset: '符合寬度',
    questionCopyLink: '複製對話連結', questionLinkCopied: '對話連結已複製', questionOpenBrowser: '在系統瀏覽器中開啟'
  }
} as const;
