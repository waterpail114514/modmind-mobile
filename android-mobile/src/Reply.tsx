import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { native } from './bridge'
export default function Reply({text,onFile}:{text:string;onFile(path:string):void}){
  const html=useMemo(()=>DOMPurify.sanitize(marked.parse(text,{async:false}) as string,{ALLOWED_TAGS:['p','br','strong','em','del','code','pre','blockquote','ul','ol','li','a','h1','h2','h3','h4','hr','table','thead','tbody','tr','td','th'],ALLOWED_ATTR:['href','title']}),[text])
  return <div className="reply-markdown" dangerouslySetInnerHTML={{__html:html}} onClick={event=>{
    const anchor=(event.target as HTMLElement).closest('a');if(!anchor)return
    event.preventDefault();const href=anchor.getAttribute('href')||''
    if(/^https:\/\//i.test(href))void native('openUrl',{url:href}).catch(()=>{})
    else if(href&&!/^(?:[a-z]+:|\/)/i.test(href)){try{onFile(decodeURIComponent(href))}catch{onFile(href)}}
  }}/>
}
