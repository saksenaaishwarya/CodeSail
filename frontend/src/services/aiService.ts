import {api} from './apiClient';
export interface GenerateQuestionRequest{topic:string;subtopic:string;difficulty:string;questionType:string;language:string;learningObjective:string;constraints:string;additionalInstructions:string}
export const aiService={generate:(payload:GenerateQuestionRequest)=>api('/ai/questions/generate',{method:'POST',body:JSON.stringify(payload)})};
