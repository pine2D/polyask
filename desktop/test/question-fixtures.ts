import { createHash } from "node:crypto";
import type { QuestionRecord, QuestionAnswerRecord } from "../src/shared/question-history";
export const questionFixture = (id = "q-a"): QuestionRecord => ({schema:4,id,text:"Example question",sites:["claude"],requestedTier:null,inputImageCount:0,createdAt:10,updatedAt:10,deviceId:"device-a"});
export const questionAnswerFixture = (questionId="q-a",attempt=1): QuestionAnswerRecord => ({schema:4,id:createHash("sha256").update(JSON.stringify([questionId,"claude",attempt])).digest("hex"),questionId,site:"claude",attempt,createdAt:10,updatedAt:10,deviceId:"device-a",submission:"submitted",submissionCode:null,conversationUrl:null,answerMarkdown:"Saved answer",capture:"complete",captureCode:null,capturedAt:10,truncated:false,sealedAt:10});
