import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {AddressInfo} from 'node:net';
import {createVoiceService} from '../server/voice';
import {MAX_AUDIO_BYTES,validateAudio,validateSpeech} from '../shared/voice';
import {createTranslationServer} from '../server/app';
import {DEFAULT_MODELS} from '../server/provider';
import {PauseDetector} from '../src/translation/vad';
import {SentenceBuffer,SpeechSession,VoiceTurnController,VoiceTurnState} from '../src/translation/voiceController';
import {TranslationEvent,TranslationRequest} from '../shared/translation';
const audio={provider:'groq',language:'fa',mimeType:'audio/webm',audioBase64:Buffer.from('test audio fixture').toString('base64')};
const request:TranslationRequest={provider:'groq',text:'',source:'fa',target:'ja',mode:'fast',tone:'preserve',context:''};
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
test('audio validates format, base64 size and only Persian/Japanese',()=>{
  assert.deepEqual(validateAudio({...audio,mimeType:'audio/webm;codecs=opus'}),audio);
  for(const v of [{...audio,language:'en'},{...audio,mimeType:'text/html'},{...audio,provider:'__proto__'},{...audio,audioBase64:'!@@@'},{...audio,audioBase64:'A'.repeat(MAX_AUDIO_BYTES*2)}])assert.throws(()=>validateAudio(v));
  assert.throws(()=>validateSpeech({text:'x'.repeat(601),language:'fa'}));assert.throws(()=>validateSpeech({text:'hello',language:'en'}));
});
test('Groq transcription passes original audio, known language and cancellation without logging secrets',async()=>{
  let called=false;const signal=new AbortController().signal;
  const service=createVoiceService({GROQ_API_KEY:'private-key'},async(url,init)=>{
    called=true;assert.equal(String(url),'https://api.groq.com/openai/v1/audio/transcriptions');assert.equal(init?.signal,signal);
    const body=init?.body as FormData;assert.equal(body.get('language'),'fa');assert.equal(body.get('model'),'whisper-large-v3-turbo');
    assert.equal(await (body.get('file') as Blob).text(),'test audio fixture');return json({text:'سلام، فردا می‌آیم.'});
  });
  assert.equal((await service.transcribe(audio,signal)).text,'سلام، فردا می‌آیم.');assert.ok(called);
  assert.ok(!JSON.stringify(service.capabilities).includes('private-key'));
});
test('Gemini uses stateless audio input and only completed model output, never thoughts',async()=>{
  const service=createVoiceService({GEMINI_API_KEY:'test'},async(_url,init)=>{
    const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.input[1].data,audio.audioBase64);
    return json({status:'completed',steps:[{type:'thought',content:[{type:'text',text:'hidden reasoning'}]},{type:'model_output',content:[{type:'text',text:'こんにちは'}]}]});
  });
  assert.equal((await service.transcribe({...audio,provider:'gemini',language:'ja'},new AbortController().signal)).text,'こんにちは');
});
test('Gemini speech requests WAV and respects target language',async()=>{
  const service=createVoiceService({GEMINI_API_KEY:'test'},async(_url,init)=>{
    const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.response_format.mime_type,'audio/wav');
    assert.equal(body.input[0].content[0].text,'سلام');assert.match(body.input[0].content[0].annotations[0].style,/Persian/);
    return json({status:'completed',steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/wav',data:'UklGRg=='}]}]});
  });
  assert.equal((await service.speech({text:'سلام',language:'fa'},new AbortController().signal)).mimeType,'audio/wav');
});
test('voice services reject missing key, silence, excessive transcript, incomplete response and quota errors',async()=>{
  let calls=0;const empty=createVoiceService({},async()=>{calls++;return json({});});await assert.rejects(empty.transcribe(audio,new AbortController().signal));assert.equal(calls,0);
  for(const text of ['', 'x'.repeat(2001)])await assert.rejects(createVoiceService({GROQ_API_KEY:'test'},async()=>json({text})).transcribe(audio,new AbortController().signal));
  await assert.rejects(createVoiceService({GEMINI_API_KEY:'test'},async()=>json({status:'failed'})).transcribe({...audio,provider:'gemini'},new AbortController().signal));
  await assert.rejects(createVoiceService({GROQ_API_KEY:'secret'},async()=>new Response('private details',{status:429})).transcribe(audio,new AbortController().signal),e=>e instanceof Error&&!e.message.includes('private details'));
});
test('sentence buffer emits each sentence once, retains tail and preserves decimal numbers',()=>{
  const buffer=new SentenceBuffer();assert.deepEqual(buffer.push('今日は'),[]);assert.deepEqual(buffer.push('晴れです。明日'),'今日は晴れです。'.split('\n'));
  assert.deepEqual(buffer.push('は雨です。'),['明日は雨です。']);assert.deepEqual(buffer.push('',true),[]);
  assert.deepEqual(buffer.push('عدد ۱.۵ است'),[]);assert.deepEqual(buffer.push('',true),['عدد ۱.۵ است']);
});
test('pause detection keeps long speech and short pauses, and ends only after 3s silence',()=>{
  const vad=new PauseDetector(0);
  assert.equal(vad.update(-20,100),'wait');assert.equal(vad.update(-20,400),'wait');
  assert.equal(vad.update(-70,1000),'wait');assert.equal(vad.update(-70,3300),'wait');
  assert.equal(vad.update(-20,3350),'wait'); // resume before the silence deadline
  assert.equal(vad.update(-70,6000),'wait');assert.equal(vad.update(-70,6350),'speech');
  const long=new PauseDetector(0);for(let time=0;time<60000;time+=100)assert.equal(long.update(-20,time),'wait');
  assert.equal(long.update(-70,62899),'wait');assert.equal(long.update(-70,62900),'speech');
  assert.equal(new PauseDetector(0).update(-100,10000),'empty');
});
test('brief noise is discarded after silence and cannot hold the microphone for two minutes',()=>{
 const vad=new PauseDetector(0);assert.equal(vad.update(-20,100),'wait');assert.equal(vad.update(-100,3099),'wait');assert.equal(vad.update(-100,3100),'empty');
 const recovered=new PauseDetector(0);recovered.update(-20,100);recovered.update(-20,300);assert.equal(recovered.update(-100,3300),'speech');
});
test('recording duration cap includes leading silence so local STT never receives a 129-second turn',()=>{
 for(const limit of [20000,120000]){const vad=new PauseDetector(0,3000,limit);assert.equal(vad.update(-100,9000),'wait');for(let time=9500;time<limit;time+=100)assert.equal(vad.update(-20,time),'wait');assert.equal(vad.update(-20,limit),'speech');}
});
test('voice pipeline waits for complete full-context translation before speaking',async()=>{
  const spoken:string[]=[],states:VoiceTurnState[]=[];let finish!:()=>void;
  const controller=new VoiceTurnController(async(r,_signal,emit)=>{
    assert.equal(r.text,'سلام، فردا می‌آیم');
    emit({type:'delta',text:'こんにちは。'});assert.deepEqual(spoken,[]);
    await new Promise<void>(resolve=>{finish=resolve;});emit({type:'delta',text:'明日行きます'});
    assert.deepEqual(spoken,[]);emit({type:'complete',model:'test',promptVersion:'test'});
    assert.deepEqual(spoken,[]); // no playback until transport also returns successfully
  },(_signal,onStart)=>({enqueue(text){spoken.push(text);onStart();},async drain(){},stop(){}}),v=>states.push(v));
  const work=controller.run(request,async()=> 'سلام، فردا می‌آیم');await sleep(5);finish();await work;
  assert.deepEqual(spoken,['こんにちは。','明日行きます']);assert.equal(states.at(-1)?.phase,'done');assert.ok(states.at(-1)?.firstAudioMs!==undefined);
});
test('voice cancellation suppresses late transcript and output; broken stream stops queued speech',async()=>{
  const states:VoiceTurnState[]=[];let transcript!:(text:string)=>void;let calls=0,stops=0;
  const session:SpeechSession={enqueue(){},async drain(){},stop(){stops++;}};
  const controller=new VoiceTurnController(async()=>{calls++;},()=>session,v=>states.push(v));
  const work=controller.run(request,()=>new Promise(resolve=>{transcript=resolve;}));controller.stop();transcript('stale');await work;
  assert.equal(calls,0);assert.equal(states.at(-1)?.transcript,'');
  let enqueued=0;const broken=new VoiceTurnController(async(_r,_s,emit)=>emit({type:'delta',text:'途中。'}),()=>({...session,enqueue(){enqueued++;}}),v=>states.push(v));
  await assert.rejects(broken.run(request,async()=> 'سلام'));assert.equal(states.at(-1)?.phase,'error');assert.ok(stops>=2);assert.equal(enqueued,0);
});
test('audio endpoints require gateway token, validate input, allow STT independently of translation and cancel upstream',async()=>{
  let aborted=false;
  const service=createVoiceService({GROQ_API_KEY:'test'},async(_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));})));
  const server=createTranslationServer({configured:false,models:DEFAULT_MODELS,allowedOrigins:[],accessToken:'token',voice:service,timeoutMs:30},async()=>{});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const post=(body:unknown,token=true)=>fetch(url+'/api/transcribe',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer token'}:{})},body:JSON.stringify(body)});
    assert.equal((await post(audio,false)).status,401);assert.equal((await post({...audio,language:'en'})).status,400);
    const response=await post(audio);assert.equal(response.status,504);assert.ok(aborted);
    assert.equal((await post({x:'A'.repeat(9*1024*1024)})).status,413);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
