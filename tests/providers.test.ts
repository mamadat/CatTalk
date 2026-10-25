import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createChatProvider,createProviderRegistry,providerDefaults} from '../server/providers';
import {TranslationEvent,TranslationRequest,validateTranslation} from '../shared/translation';
import {createTranslationServer} from '../server/app';
import {AddressInfo} from 'node:net';
const request:TranslationRequest={provider:'gemini',text:'سلام',source:'fa',target:'ja',mode:'balanced',tone:'preserve',context:''};
const chunk=(value:unknown)=>`data: ${JSON.stringify(value)}\n\n`;
const success=()=>new Response(': heartbeat\n\n'+chunk({model:'actual-model',choices:[{delta:{reasoning:'hidden',content:'こんにちは'},finish_reason:null}]})+chunk({choices:[{delta:{},finish_reason:'stop'}]})+'data: [DONE]\n\n');
for (const id of ['gemini','groq','openrouter'] as const) test(`${id}: streams only translation, uses own key/endpoint, passes abort signal`,async()=>{
  const events:TranslationEvent[]=[];const abort=new AbortController();let body:any;
  const provider=createChatProvider(id,{apiKey:'test-key',models:providerDefaults[id]},async(url,init)=>{
    const expected={gemini:'generativelanguage.googleapis.com',groq:'api.groq.com',openrouter:'openrouter.ai'};
    assert.equal(new URL(String(url)).hostname,expected[id]);
    assert.equal((init?.headers as any).Authorization,'Bearer test-key');assert.equal(init?.signal,abort.signal);
    body=JSON.parse(String(init?.body));return success();
  });
  await provider({...request,provider:id},abort.signal,e=>events.push(e));
  assert.equal(body.stream,true);assert.equal(body.model,providerDefaults[id].balanced);
  assert.equal(JSON.parse(body.messages[1].content).source_text,'سلام');
  assert.deepEqual(events[0],{type:'delta',text:'こんにちは'});
  assert.equal(events.at(-1)?.type,'complete');
  if (events.at(-1)?.type==='complete') assert.equal((events.at(-1) as any).model,'actual-model');
  assert.ok(!JSON.stringify(events).includes('hidden'));
});
test('chat adapters reject truncated, refused, length-limited and error streams',async()=>{
  for (const body of [chunk({choices:[{delta:{content:'partial'}}]}),chunk({choices:[{delta:{refusal:'no'}}]}),chunk({choices:[{delta:{content:'partial'},finish_reason:'length'}]}),chunk({error:{message:'secret'}})]) {
    const events:TranslationEvent[]=[];
    await assert.rejects(createChatProvider('gemini',{apiKey:'test',models:providerDefaults.gemini},async()=>new Response(body))(request,new AbortController().signal,e=>events.push(e)));
    assert.ok(!events.some(e=>e.type==='complete'));
  }
});
test('OpenRouter Free blocks paid model overrides before making a request',async()=>{
  let called=false;
  await assert.rejects(createChatProvider('openrouter',{apiKey:'test',models:{...providerDefaults.openrouter,balanced:'paid-model'}},async()=>{called=true;return success();})(request,new AbortController().signal,()=>{}),/فقط/);
  assert.equal(called,false);
});
test('registry isolates credentials, missing key never falls back, invalid provider rejected',async()=>{
  const calls:string[]=[];
  const registry=createProviderRegistry({GEMINI_API_KEY:'gemini-only',GROQ_API_KEY:'groq-only'},async(_url,init)=>{calls.push((init?.headers as any).Authorization);return success();});
  await registry.translate(request,new AbortController().signal,()=>{});
  await registry.translate({...request,provider:'groq'},new AbortController().signal,()=>{});
  await assert.rejects(registry.translate({...request,provider:'openai'},new AbortController().signal,()=>{}));
  assert.deepEqual(calls,['Bearer gemini-only','Bearer groq-only']);
  assert.ok(!JSON.stringify(registry.providers).includes('only'));
  for (const provider of ['__proto__','constructor','https://evil.example',{},null]) assert.throws(()=>validateTranslation({...request,provider}));
});
test('gateway selects configured provider and rejects only the unconfigured choice',async()=>{
  let called=0;const registry=createProviderRegistry({GROQ_API_KEY:'private-key'},async()=>{called++;return success();});
  const server=createTranslationServer({configured:true,models:providerDefaults.openai,providers:registry.providers,allowedOrigins:[]},registry.translate);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const status=await (await fetch(url+'/api/translation/status')).text();assert.ok(!status.includes('private-key'));
    const post=(provider:string)=>fetch(url+'/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,provider})});
    assert.equal((await post('gemini')).status,503);
    const response=await post('groq');assert.equal(response.status,200);assert.ok((await response.text()).includes('こんにちは'));
    assert.equal(called,1);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
