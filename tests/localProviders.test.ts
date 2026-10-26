import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AddressInfo} from 'node:net';
import {createOllamaProvider,createLibreProvider,localURL} from '../server/localProviders';
import {createProviderRegistry,providerDefaults} from '../server/providers';
import {createTranslationServer} from '../server/app';
import {TranslationEvent,TranslationRequest} from '../shared/translation';
const request:TranslationRequest={provider:'translategemma',text:'سلام، فردا نمی‌آیم.',source:'fa',target:'ja',mode:'balanced',tone:'preserve',context:''};
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const stream=(text:string)=>{
 const bytes=new TextEncoder().encode(text);return new Response(new ReadableStream({start(c){for(let n=0;n<bytes.length;n++)c.enqueue(bytes.slice(n,n+1));c.close();}}));
};
const translationStream=()=>stream(JSON.stringify({message:{content:'明日は'},done:false})+'\n'+JSON.stringify({message:{content:'行きません。'},done:true,done_reason:'stop'}));
test('local engines accept only loopback origins, no credentials or redirect targets',()=>{
 assert.equal(localURL('http://localhost:11434'),'http://localhost:11434');
 for(const url of ['https://example.com','http://127.0.0.1.evil.example','http://user:secret@localhost:5000','file:///etc/passwd','http://localhost:5000/path','http://localhost:5000/?key=secret'])assert.throws(()=>localURL(url));
});
for(const id of ['translategemma','qwenlocal'] as const)test(`${id}: no key, local NDJSON UTF-8 streaming, correct full source and cancellation`,async()=>{
 const events:TranslationEvent[]=[];const signal=new AbortController().signal;
 const provider=createOllamaProvider(id,'http://127.0.0.1:11434',providerDefaults[id],async(url,init)=>{
  assert.equal(String(url),'http://127.0.0.1:11434/api/chat');assert.equal(init?.signal,signal);assert.equal(init?.redirect,'error');assert.ok(!(init?.headers as any).Authorization);
  const body=JSON.parse(String(init?.body));assert.equal(body.stream,true);
  if(id==='translategemma'){assert.equal(body.messages.length,1);assert.equal(body.messages[0].role,'user');assert.ok(body.messages[0].content.endsWith(request.text));}
  else{assert.equal(body.think,false);assert.equal(JSON.parse(body.messages[1].content).source_text,request.text);}
  return translationStream();
 });
 await provider({...request,provider:id},signal,e=>events.push(e));
 assert.equal(events.filter(e=>e.type==='delta').map(e=>e.text).join(''),'明日は行きません。');assert.equal(events.at(-1)?.type,'complete');
});
test('local streaming rejects incomplete/error/length-limited replies and cloud models',async()=>{
 for(const text of [JSON.stringify({message:{content:'partial'},done:false}),JSON.stringify({message:{content:'partial'},done:true,done_reason:'length'}),JSON.stringify({error:'secret details'})]) {
  const events:TranslationEvent[]=[];await assert.rejects(createOllamaProvider('qwenlocal','http://localhost:11434',providerDefaults.qwenlocal,async()=>stream(text))(request,new AbortController().signal,e=>events.push(e)));
  assert.ok(!events.some(e=>e.type==='complete'));
 }
 for(const model of ['qwen3:cloud','qwen3:4b-cloud']){
  let called=false;await assert.rejects(createOllamaProvider('qwenlocal','http://localhost:11434',{balanced:model,fast:model,quality:model},async()=>{called=true;return translationStream();})(request,new AbortController().signal,()=>{}));assert.equal(called,false);
 }
});
test('LibreTranslate sends full plain text with no API key; unsupported tone/context are rejected',async()=>{
 let called=0;const provider=createLibreProvider('http://127.0.0.1:5000',async(url,init)=>{
  called++;assert.equal(String(url),'http://127.0.0.1:5000/translate');assert.deepEqual(JSON.parse(String(init?.body)),{q:request.text,source:'fa',target:'ja',format:'text'});return json({translatedText:'明日は行きません。'});
 });
 const events:TranslationEvent[]=[];await provider(request,new AbortController().signal,e=>events.push(e));assert.equal(events.at(-1)?.type,'complete');
 await assert.rejects(provider({...request,tone:'polite'},new AbortController().signal,()=>{}));
 await assert.rejects(provider({...request,context:'context'},new AbortController().signal,()=>{}));assert.equal(called,1);
});
test('health checks require installed local models and both Libre directions; no missing-key fallback',async()=>{
 let cloudCalls=0;
 const registry=createProviderRegistry({},async(url)=>{
  if(String(url).endsWith('/api/tags'))return json({models:[{name:'translategemma:4b'},{name:'qwen3:4b',remote_host:'https://cloud.example'}]});
  if(String(url).endsWith('/languages'))return json([{code:'fa',targets:['en','ja']},{code:'ja',targets:['en','fa']}]);
  cloudCalls++;return new Response('',{status:503});
 });
 const status=await registry.refreshProviders();assert.equal(status.translategemma.configured,true);assert.equal(status.qwenlocal.configured,false);assert.equal(status.libretranslate.configured,true);assert.equal(status.gemini.configured,false);
 await assert.rejects(registry.translate({...request,provider:'gemini'},new AbortController().signal,()=>{}));assert.equal(cloudCalls,0);
 const offline=createProviderRegistry({},async()=>{throw new TypeError('offline');});const unavailable=await offline.refreshProviders();assert.equal(unavailable.translategemma.configured,false);assert.equal(unavailable.libretranslate.configured,false);
 const missing=createProviderRegistry({},async(url)=>String(url).endsWith('/languages')?json([{code:'fa',targets:['en']}]):json({models:[]}));assert.equal((await missing.refreshProviders()).libretranslate.configured,false);
});
test('gateway works with local engine and zero cloud keys; health exposes no engine URLs',async()=>{
 const registry=createProviderRegistry({},async(url)=>{
  if(String(url).endsWith('/api/tags'))return json({models:[{name:'translategemma:4b'}]});
  if(String(url).endsWith('/languages'))return json([]);
  return translationStream();
 });
 const server=createTranslationServer({configured:false,models:providerDefaults.openai,providers:registry.providers,refreshProviders:registry.refreshProviders,allowedOrigins:[]},registry.translate);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try{
  const status=await(await fetch(url+'/api/translation/status')).json();assert.equal(status.configured,true);assert.equal(status.providers.translategemma.configured,true);assert.ok(!JSON.stringify(status).includes('11434'));
  const response=await fetch(url+'/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});assert.equal(response.status,200);assert.ok((await response.text()).includes('行きません。'));
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
