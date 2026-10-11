import {api} from './apiClient';
export type ExecutionState='queued'|'running'|'completed'|'failed'|'compilation_error'|'runtime_error'|'timeout';
export interface ExecutionRequest{submissionId:string;language:string;sourceCode:string;input?:string;testCaseId?:string}
export interface ExecutionResult{status:ExecutionState;stdout:string;stderr:string;exitCode:number|null;executionTime:number;memoryUsed:number}
export const executionService={run:(payload:ExecutionRequest)=>api<{success:boolean;data:ExecutionResult}>('/executions',{method:'POST',body:JSON.stringify(payload)})};
