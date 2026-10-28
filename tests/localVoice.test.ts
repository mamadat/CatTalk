import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {AddressInfo} from 'node:net';
import {PythonWhisper} from '../server/localVoice';
import {createVoiceService} from '../server/voice';
import {createTranslationServer} from '../server/app';
import {DEFAULT_MODELS} from '../server/provider';
import {TranscribeRequest,validateAudio} from '../shared/voice';
const signal=()=>new AbortController().signal;
function request(text:string,extra:Partial<TranscribeRequest>={}):TranscribeRequest{return {provider:'whisperlocal',language:'fa',mimeType:'audio/wav',audioBase64:Buffer.from(text).toString('base64'),...extra};}
function setup(quality=true,timeoutMs=3000){
 const root=mkdtempSync(join(tmpdir(),'cattalk-whisper-test-'));
 for(const mode of quality?['fast','quality']:['fast']){mkdirSync(join(root,mode));for(const name of ['model.bin','config.json','tokenizer.json'])writeFileSync(join(root,mode,name),'fixture');}
 const local=new PythonWhisper({LOCAL_WHISPER_PYTHON:process.execPath,LOCAL_WHISPER_MODEL:join(root,'fast'),LOCAL_WHISPER_QUALITY_MODEL:join(root,'quality')},{workerPath:resolve('tests/fixtures/whisper-worker.cjs'),timeoutMs});
 return {local,cleanup(){local.dispose();rmSync(root,{recursive:true,force:true});}};
}
test('local audio validates only known languages and no arbitrary local URLs or model paths from clients',()=>{
 assert.equal(validateAudio(request('صدا')).provider,'whisperlocal');
 assert.throws(()=>validateAudio({...request('x'),language:'en'}));assert.throws(()=>validateAudio({...request('x'),provider:'http://remote'}));
 assert.ok(!('model' in validateAudio({...request('x'),model:'http://remote/model'})));
});
test('local health distinguishes mode availability and exposes only public model labels',async()=>{
 const fixture=setup(false);try{const status=await fixture.local.refresh();assert.equal(status.configured,true);assert.deepEqual(status.availableModes,{fast:true,accurate:false});assert.ok(!JSON.stringify(status).includes(tmpdir()));await assert.rejects(fixture.local.transcribe(request('hello',{recognition:'accurate'}),signal()));}finally{fixture.cleanup();}
 const absent=new PythonWhisper({LOCAL_WHISPER_PYTHON:resolve('.local/missing-python')});try{assert.equal((await absent.refresh()).configured,false);}finally{absent.dispose();}
});
test('persistent local worker handles both directions and never receives provider credentials',async()=>{
 const fixture=setup();const before=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='PRIVATE-TEST-KEY';
 try{const first=await fixture.local.transcribe(request('pid'),signal()),again=await fixture.local.transcribe(request('pid'),signal());assert.equal(first.text,again.text);
  assert.equal((await fixture.local.transcribe(request('سلام'),signal())).text,'fa: سلام');assert.equal((await fixture.local.transcribe(request('こんにちは',{language:'ja',recognition:'accurate'}),signal())).text,'ja: こんにちは');
  assert.equal((await fixture.local.transcribe(request('secrets'),signal())).text,'no secrets');assert.equal((await fixture.local.transcribe(request('offline'),signal())).text,'1');
 }finally{if(before===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=before;fixture.cleanup();}
});
test('cancellation kills active local inference and the next job starts in a fresh process',async()=>{
 const fixture=setup();try{const first=await fixture.local.transcribe(request('pid'),signal()),abort=new AbortController();
  const hanging=fixture.local.transcribe(request('hang'),abort.signal);const observed=assert.rejects(hanging,/لغو/);await sleep(50);const next=fixture.local.transcribe(request('pid'),signal());abort.abort();await observed;assert.notEqual((await next).text,first.text);
 }finally{fixture.cleanup();}
});
test('local queue caps at three, queued cancellation never runs, and active cancellation releases the remaining job',async()=>{
 const fixture=setup();try{await fixture.local.refresh();const active=new AbortController(),queued=new AbortController();
  const one=fixture.local.transcribe(request('hang'),active.signal),two=fixture.local.transcribe(request('ignored'),queued.signal);const cancelled=Promise.allSettled([one,two]);
  const third=fixture.local.transcribe(request('third'),signal());await assert.rejects(fixture.local.transcribe(request('fourth'),signal()),/صف/);queued.abort();active.abort();await cancelled;assert.equal((await third).text,'fa: third');
 }finally{fixture.cleanup();}
});
test('local timeouts terminate work; protocol failure and oversized replies never become transcripts',async()=>{
 const fixture=setup(true,900);try{
  await assert.rejects(fixture.local.transcribe(request('hang'),signal()),/طول کشید/);
  for(const text of ['malformed','crash','oversize'])await assert.rejects(fixture.local.transcribe(request(text),signal()));
  assert.equal((await fixture.local.transcribe(request('بعدی'),signal())).text,'fa: بعدی');
 }finally{fixture.cleanup();}
});
test('already-cancelled requests do no work, and disposal rejects outstanding local jobs',async()=>{
 const fixture=setup();try{const abort=new AbortController();abort.abort();await assert.rejects(fixture.local.transcribe(request('pid'),abort.signal));
  const work=fixture.local.transcribe(request('hang'),signal());const observed=assert.rejects(work);await sleep(60);fixture.local.dispose();await observed;
 }finally{fixture.cleanup();}
});
test('local speech gateway is private, independent of cloud keys and never falls back to cloud',async()=>{
 const fixture=setup();let network=0;const voice=createVoiceService({},async()=>{network++;throw new Error('Must not reach cloud');},fixture.local);
 const server=createTranslationServer({configured:false,models:DEFAULT_MODELS,allowedOrigins:[],accessToken:'token',voice},async()=>{});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const post=(body:unknown,auth=true)=>fetch(url+'/api/transcribe',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer token'}:{})},body:JSON.stringify(body)});
 try{assert.equal((await post(request('صدا'),false)).status,401);const status=await(await fetch(url+'/api/translation/status',{headers:{Authorization:'Bearer token'}})).json();assert.equal(status.voice.transcription.whisperlocal.configured,true);
  const response=await post(request('متن'));assert.equal(response.status,200);assert.equal((await response.json()).text,'fa: متن');assert.equal(network,0);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));fixture.cleanup();}
});
