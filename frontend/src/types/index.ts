export type Role='STUDENT'|'FACULTY'|'ADMIN';
export interface User{ id:string; name:string; email:string; role:Role; avatar?:string; department?:string; batch?:string; }
export interface ApiResponse<T>{success:boolean;data:T;message?:string}
