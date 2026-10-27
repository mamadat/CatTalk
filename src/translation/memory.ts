import {TranslationEvent,TranslationRequest} from '../../shared/translation';
import {Transport} from './controller';

interface Entry {text:string;complete:Extract<TranslationEvent,{type:'complete'}>;expires:number;size:number;}
/** Exact, short-lived, memory-only reuse. A fresh instance isolates server/account/model revisions. */
export function createTranslationMemory(base:Transport,options:{ttlMs?:number;maxEntries?:number;maxChars?:number;now?:()=>number}={}) {
  const entries=new Map<string,Entry>();let chars=0;const now=options.now || Date.now;
  const ttlMs=options.ttlMs ?? 120000,maxEntries=options.maxEntries ?? 32,maxChars=options.maxChars ?? 64000;
  const key=(r:TranslationRequest)=>JSON.stringify([r.provider || 'openai',r.source,r.target,r.mode,r.tone,r.context,r.text,r.glossary || [],r.alternative || null]);
  function remove(k:string) {const entry=entries.get(k);if(entry)chars-=entry.size;entries.delete(k);}
  function clear() {entries.clear();chars=0;}
  const transport:Transport=async(request,signal,emit)=>{
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    const k=key(request);for(const [expired,entry] of entries)if(entry.expires<=now())remove(expired);
    const hit=entries.get(k);
    if(hit) {entries.delete(k);entries.set(k,hit);emit({type:'delta',text:hit.text});if(signal.aborted)throw new DOMException('Aborted','AbortError');emit({...hit.complete});return;}
    let text='';let complete:Extract<TranslationEvent,{type:'complete'}>|undefined;
    await base(request,signal,event=>{
      if(signal.aborted)return;
      if(event.type==='delta'){text+=event.text;emit(event);}
      else if(event.type==='complete')complete=event;
      else throw new Error(event.message);
    });
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    if(!complete || !text.trim())throw new Error('ترجمهٔ کامل دریافت نشد.');
    const size=k.length+text.length;
    if(size<=maxChars && maxEntries>0 && ttlMs>0) {
      remove(k);
      while(entries.size>=maxEntries || chars+size>maxChars){const oldest=entries.keys().next().value;if(oldest===undefined)break;remove(oldest);}
      entries.set(k,{text,complete:{...complete},expires:now()+ttlMs,size});chars+=size;
    }
    emit(complete);
  };
  return {transport,clear};
}
