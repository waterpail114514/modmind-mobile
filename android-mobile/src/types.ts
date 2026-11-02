export type Studio = 'mod' | 'modpack'
export interface Project { id: string; name: string; namespace: string; kind: Studio; loader: string; minecraftVersion: string; createdAt: string }
export interface FileEntry { name: string; path: string; directory: boolean; size: number }
export interface Document { path: string; content: string; revision: string | null; exists: boolean; readOnly?: boolean }
export interface Artifact { id: string; name: string; size: number; sha256: string; projectId: string }
export interface Task { id: string; projectId: string; kind?:'build'|'project-test';evidence?:{gameVerified:false;projectTests?:string;count?:number;failed?:number;skipped?:number};status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; phase: string; startedAt: string; endedAt?: string; log: string; artifacts: Artifact[]; error?: string }
export interface Environment { connected: boolean; bundled: boolean; message?: string; version?: string; node?: string; java?: boolean }
export interface RpcError extends Error { code?: string }
