import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
const root=path.resolve(import.meta.dirname,'..'),repo=path.dirname(root),require=createRequire(path.join(repo,'package.json')),ts=require('typescript')
// Read the exact desktop declarations rather than maintain a second rewritten prompt.
const source=await fs.readFile(path.join(root,'shared/desktopWorkflowSource.ts'),'utf8'),ast=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true)
const constants=[]
for(const statement of ast.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)if(['MANAGED_DOWNLOAD_POLICY','MANDATORY_CODING_WORKFLOW'].includes(declaration.name.getText(ast)))constants.push('const '+declaration.getText(ast))
if(constants.length!==2)throw Error('Desktop workflow prompt declarations changed; review mobile adapter')
const agentSource=await fs.readFile(path.join(repo,'src/main/externalAgents.ts'),'utf8'),agentAst=ts.createSourceFile('externalAgents.ts',agentSource,ts.ScriptTarget.Latest,true)
const identity=agentAst.statements.filter(s=>ts.isFunctionDeclaration(s)&&['agentIdentityPrompt','externalAgentLabel'].includes(s.name?.text)).map(s=>s.getText(agentAst)).join('\n')
if(!identity.includes('MODMIND IDENTITY AND CURRENT CONNECTION'))throw Error('Desktop identity prompt changed')
const result=await require('esbuild').build({stdin:{contents:`import{WORKBENCH_REQUEST_GUIDANCE}from'./src/shared/workbenchFlow';import{BEGINNER_AGENT_WORKFLOW_GUIDANCE}from'./src/main/beginnerAgentPolicy';import{WORKBENCH_SKILL_POLICY,WORKBENCH_SKILL_ROUTES}from'./src/main/workbenchSkillPolicy';import{AGENT_PROTECTION_INSTRUCTIONS}from'./src/main/agentProtection';import{PROJECT_REPLY_IMAGES_PROMPT}from'./src/shared/projectImages';import{PROJECT_REPLY_MODELS_PROMPT}from'./src/shared/projectModels';${constants.join(';')};export default{request:WORKBENCH_REQUEST_GUIDANCE,beginner:BEGINNER_AGENT_WORKFLOW_GUIDANCE,workflow:MANDATORY_CODING_WORKFLOW,skillPolicy:WORKBENCH_SKILL_POLICY,protection:AGENT_PROTECTION_INSTRUCTIONS,replyImages:PROJECT_REPLY_IMAGES_PROMPT,replyModels:PROJECT_REPLY_MODELS_PROMPT,routes:WORKBENCH_SKILL_ROUTES}`,resolveDir:repo},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'})
const prompts=(await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'))).default
const identityCode=await require('esbuild').transform(identity+`;export const identities={workspace:agentIdentityPrompt({kind:'codex',readOnly:false,model:'MODMIND_MODEL_PLACEHOLDER'}),inspiration:agentIdentityPrompt({kind:'codex',readOnly:true,model:'MODMIND_MODEL_PLACEHOLDER'})}`,{loader:'ts',format:'esm'})
prompts.identities=(await import('data:text/javascript;base64,'+Buffer.from(identityCode.code).toString('base64'))).identities
const files={}
async function scan(folder,relative=''){for(const e of await fs.readdir(folder,{withFileTypes:true})){const name=relative?relative+'/'+e.name:e.name,p=path.join(folder,e.name);if(e.isDirectory())await scan(p,name);else if(e.isFile()){const b=await fs.readFile(p);if(b.includes(0)||b.length>262144)throw Error('Unexpected skill resource '+name);files[name]=b.toString('utf8')}}}
await scan(path.join(repo,'resources/codex-skills'))
const studios={};for(const kind of ['mod','modpack']){const manifest=JSON.parse(await fs.readFile(path.join(repo,'feature-plugins/studio-'+kind+'/manifest.json'),'utf8'));studios[kind]=manifest.studios?.[0]?.ai||manifest.contributions?.studios?.[0]?.ai;if(!studios[kind])throw Error('Desktop studio schema changed')}
const body={format:1,prompts,studios,files},hash=createHash('sha256').update(JSON.stringify(body)).digest('hex')
await fs.mkdir(path.join(root,'dist/runtime'),{recursive:true});await fs.writeFile(path.join(root,'dist/runtime/desktop-ai.json'),JSON.stringify({...body,sha256:hash}))
console.log(JSON.stringify({desktopAiHash:hash,skillFiles:Object.keys(files).length}))
