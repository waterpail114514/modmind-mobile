import {rpc} from './bridge'
export const size=(bytes:number)=>bytes<1024*1024?Math.ceil(bytes/1024)+' KiB':(bytes/1024/1024).toFixed(1)+' MiB'
export async function waitJob(id:string,changed:(job:any)=>void){for(;;){const job=await rpc<any>('job',{operation:'status',jobId:id});changed(job);if(job.status==='completed')return job.result;if(job.status!=='running')throw Error(job.error||job.phase);await new Promise(r=>setTimeout(r,800))}}
