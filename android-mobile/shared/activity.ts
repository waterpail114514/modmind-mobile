import type {AiActivity} from '../../src/shared/aiActivity'
export const mobileActivityLabel=(operation:string)=>({read:'读取文件',files:'查看目录',project:'读取项目信息',save:'编辑文件',restore:'恢复文件',move:'移动文件',remove_file:'移除文件',build:'构建项目',test:'运行项目测试',check:'检查项目',export:'导出整合包',archive:'归档项目',snapshot:'创建恢复点',restore_snapshot:'恢复编辑文件',search:'搜索项目',image_draft:'准备图片描述',image:'查看图片',images:'读取图片',image_apply:'保存图片',model_create:'创建模型',model_preview:'查看模型',models:'查看模型文件',note_save:'保存项目知识',notes:'读取项目知识',tasks:'检查构建状态',status:'检查后台操作',scan:'核算项目大小'} as Record<string,string>)[operation]||'处理项目'
export const mobileActivityKind=(operation:string):AiActivity['kind']=>['save','restore','move','remove_file','model_create','image_apply'].includes(operation)?'file':['build','archive','export'].includes(operation)?'build':['test','check'].includes(operation)?'test':operation==='search'?'search':'tool'
/** The MCP receipt completes before a background build/check; its card owns job progress. */
export function mobileAsyncReceipt(activity:AiActivity,operation:string,metadata?:Record<string,unknown>):AiActivity{
  if(!(metadata?.jobId||metadata?.taskId)||!['build','test','check','archive','snapshot','restore_snapshot'].includes(operation))return activity
  const names:Record<string,string>={build:'提交构建请求',test:'提交测试请求',check:'提交检查请求',archive:'提交归档请求',snapshot:'提交恢复点请求',restore_snapshot:'提交恢复请求'}
  return {...activity,kind:'tool',title:names[operation],status:'completed',completedAt:new Date().toISOString()}
}
