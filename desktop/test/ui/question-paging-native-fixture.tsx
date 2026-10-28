import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QuestionHistory } from '../../src/renderer/question-history';
import { FeedbackProvider } from '../../src/renderer/feedback-provider';
import { setShellApi } from '../../src/renderer/shell-api';
import { getCopy } from '../../src/shared/copy';
import '../../src/renderer/styles.css';
import '../../src/renderer/settings.css';
import '../../src/renderer/accessibility.css';
import '../../src/renderer/feedback.css';
const copy=getCopy('zh-CN'), noop=()=>{};
const questions=Array.from({length:40},(_,i)=>({schema:4,id:`q${i}`,createdAt:1000+i,updatedAt:1000+i,deviceId:'synthetic',text:`合成问题 ${i+1}：用于键盘翻页诊断`,sites:['claude'],requestedTier:null,inputImageCount:0}));
const answer=(q:any)=>({schema:4,id:`a-${q.id}`,questionId:q.id,site:'claude',attempt:1,createdAt:q.createdAt,updatedAt:q.createdAt,deviceId:'synthetic',submission:'submitted',submissionCode:null,conversationUrl:null,answerMarkdown:Array.from({length:100},(_,i)=>`第 ${i+1} 段合成回答。用于观察 PageDown 和 PageUp 的原生滚动行为。`).join('\n\n'),capture:'complete',captureCode:null,capturedAt:q.createdAt,sealedAt:q.createdAt,truncated:false});
setShellApi({setQuestionPanel:async()=>{},setSurface:noop,onQuestionSaveFailed:()=>noop,onQuestionAttachmentSaveFailed:()=>noop,
 listQuestions:async()=>({items:questions.map(q=>({...q,savedSites:1,answers:[answer(q)]})),cursor:null}),
 listLegacyQuestions:async()=>({items:[],cursor:null}),getQuestion:async(id:string)=>{const q=questions.find(q=>q.id===id)!;return {question:q,answers:[answer(q)],loadedAnswerId:answer(q).id};}} as any);
function App(){const[open,setOpen]=useState(true);return <FeedbackProvider copy={copy}><QuestionHistory open={open} copy={copy} sites={[{key:'claude',label:'Claude'}] as any} draft="" busy={false} onBlockingChange={noop} onOpen={()=>setOpen(true)} onClose={()=>setOpen(false)} onDraft={noop}/></FeedbackProvider>}
createRoot(document.getElementById('root')!).render(<App/>);
