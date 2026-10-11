import {Role} from '@prisma/client';export interface AuthUser{id:string;email:string;role:Role;name:string}
declare global {namespace Express{interface Request{user?:AuthUser}}}
