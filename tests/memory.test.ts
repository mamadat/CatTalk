import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TranslationEvent,TranslationRequest} from '../shared/translation';
import {Transport} from '../src/translation/controller';
import {createTranslationMemory} from '../src/translation/memory';
const request:TranslationRequest={provider:'gemini',text:'سلام',source:'fa',target:'ja',mode:'balanced',tone:'preserve',context:''};
const signal=()=>new AbortController().signal;
const success:Transport=async(_r,_s,emit)=>{emit({type:'delta',text:'こんにちは'});emit({type:'complete',model:'test',promptVersion:'v1'});};
test('identical successful translations avoid another paid request and preserve exact output',async()=>{
 let calls=0;const memory=createTranslationMemory(async(...args)=>{calls++;await success(...args);});const first:TranslationEvent[]=[],again:TranslationEvent[]=[];
 await memory.transport(request,signal(),v=>first.push(v));await memory.transport(request,signal(),v=>again.push(v));
 assert.equal(calls,1);assert.deepEqual(again,first);memory.clear();await memory.transport(request,signal(),()=>{});assert.equal(calls,2);
});
test('any text, whitespace, language, tone, context, provider or mode difference calls the model',async()=>{
 let calls=0;const memory=createTranslationMemory(async(...args)=>{calls++;await success(...args);});
 const variants=[request,{...request,text:'سلام '},{...request,source:'ja' as const,target:'fa' as const},{...request,tone:'polite' as const},{...request,context:'دوست'},{...request,provider:'groq' as const},{...request,mode:'quality' as const}];
 for(const value of variants)await memory.transport(value,signal(),()=>{});assert.equal(calls,variants.length);
});
test('incomplete, failed or cancelled translations are never reused',async()=>{
 for(const failure of ['partial','throw','cancel']) {
  let calls=0;let abort=new AbortController();
  const memory=createTranslationMemory(async(_r,_s,emit)=>{calls++;emit({type:'delta',text:'途中'});if(failure==='throw')throw new Error('network');if(failure==='cancel'){emit({type:'complete',model:'test',promptVersion:'v1'});abort.abort();}});
  for(let i=0;i<2;i++){abort=new AbortController();await assert.rejects(memory.transport(request,abort.signal,()=>{}));}
  assert.equal(calls,2);
 }
});
test('entries expire and memory capacity evicts old results; separate sessions cannot share results',async()=>{
 let now=0,calls=0;const base:Transport=async(...args)=>{calls++;await success(...args);};
 const memory=createTranslationMemory(base,{now:()=>now,ttlMs:100,maxEntries:1});
 await memory.transport(request,signal(),()=>{});now=101;await memory.transport(request,signal(),()=>{});assert.equal(calls,2);
 await memory.transport({...request,text:'متن جدید'},signal(),()=>{});await memory.transport(request,signal(),()=>{});assert.equal(calls,4);
 await createTranslationMemory(base).transport(request,signal(),()=>{});assert.equal(calls,5);
});
test('already-aborted listeners never receive even a stored translation',async()=>{
 const memory=createTranslationMemory(success);await memory.transport(request,signal(),()=>{});const abort=new AbortController();abort.abort();let emitted=false;
 await assert.rejects(memory.transport(request,abort.signal,()=>{emitted=true;}));assert.equal(emitted,false);
});
