import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {SessionTurn,TurnQueue,inputLevel,sessionJSON,sessionSRT,spokenHints,subtitleTime,utf8Size} from '../src/translation/sessions';
import {travelPhrases,validSavedPhrase} from '../src/translation/travel';
import {validateAudio} from '../shared/voice';
import {createVoiceService} from '../server/voice';
const base:SessionTurn={id:'1',source:'fa',target:'ja',startedMs:1250,endedMs:4123,phase:'done',original:'سلام',translated:'こんにちは'};
const audio={provider:'groq',language:'fa',mimeType:'audio/webm',audioBase64:'YXVkaW8='};
test('bounded audio queue preserves order without overlapping paid requests',async()=>{
 const queue=new TurnQueue(3),events:string[]=[];let release!:()=>void;
 const one=queue.add(async()=>{events.push('start1');await new Promise<void>(r=>{release=r;});events.push('end1');});
 const two=queue.add(async()=>{events.push('start2');});const three=queue.add(async()=>{events.push('start3');});
 await assert.rejects(queue.add(async()=>{}),/صف صدا پر/);await sleep(5);assert.deepEqual(events,['start1']);release();await Promise.all([one,two,three]);assert.deepEqual(events,['start1','end1','start2','start3']);
});
test('cancellation promptly releases queued audio and aborts active work; stale work cannot block a new session',async()=>{
 const queue=new TurnQueue();let release!:()=>void,signal!:AbortSignal,newRan=false;
 const active=queue.add(async s=>{signal=s;await new Promise<void>(r=>{release=r;});});const pending=queue.add(async()=>assert.fail('cancelled pending must never run'));
 const cancelled=Promise.allSettled([active,pending]);await sleep(5);queue.cancel();assert.ok(signal.aborted);assert.deepEqual((await cancelled).map(v=>v.status),['rejected','rejected']);
 await queue.add(async()=>{newRan=true;});assert.ok(newRan);release();await sleep(5);assert.equal(queue.size,0);
});
test('a failed turn never retries itself and does not break explicitly queued following work',async()=>{
 const queue=new TurnQueue();let calls=0;const first=queue.add(async()=>{calls++;throw new Error('network');});const second=queue.add(async()=>{calls++;});await assert.rejects(first,/network/);await second;assert.equal(calls,2);
});
test('SRT includes only complete publishable turns and escapes markup, JSON retains errors and review state',()=>{
 const turns=[base,{...base,id:'2',phase:'error' as const,error:'failed'},{...base,id:'3',requiresReview:true,reviewed:false},{...base,id:'4',requiresReview:true,reviewed:true,translated:'<b>日本語</b>'}];
 const srt=sessionSRT(turns);assert.ok(srt.startsWith('1\n00:00:01,250 --> 00:00:04,123'));assert.ok(srt.includes('&lt;b&gt;日本語&lt;/b&gt;'));assert.equal((srt.match(/-->/g)||[]).length,2);
 const json=JSON.parse(sessionJSON('جلسه',turns));assert.equal(json.turns.length,4);assert.equal(json.turns[2].reviewed,false);assert.equal(subtitleTime(3661002),'01:01:01,002');assert.equal(subtitleTime(-2),'00:00:00,000');
});
test('spoken hints are explicit, language-specific, deduplicated and bounded by UTF-8 bytes and count',()=>{
 const terms=Array.from({length:20},(_,i)=>({sourceLanguage:'fa' as const,source:'نام'+i}));
 const hints=spokenHints('fa',[...terms,{sourceLanguage:'ja',source:'秘密'},terms[0],{sourceLanguage:'fa',source:'x'.repeat(41)}]);assert.equal(hints.length,8);assert.ok(!hints.includes('秘密'));assert.ok(utf8Size(hints.join(', '))<=160);
 assert.equal(utf8Size('آ猫😀'),9);assert.equal(new Set(hints).size,hints.length);
});
test('audio validation rejects excessive hints and unknown recognition modes without altering legacy requests',()=>{
 assert.deepEqual(validateAudio(audio),audio);
 for(const extra of [{recognition:'invented'},{hints:['猫'.repeat(40),'猫'.repeat(40)]},{hints:Array(9).fill('نام')},{hints:['']},{hints:[{secret:'x'}]}])assert.throws(()=>validateAudio({...audio,...extra}));
 assert.equal(validateAudio({...audio,recognition:'accurate',hints:['آذر']}).hints?.[0],'آذر');
});
test('full Whisper and spoken-name hints reach only the selected STT provider',async()=>{
 let calls=0;const service=createVoiceService({GROQ_API_KEY:'private',GROQ_STT_MODEL:'fast-model',GROQ_STT_QUALITY_MODEL:'full-model'},async(_url,init)=>{calls++;const form=init?.body as FormData;assert.equal(form.get('model'),'full-model');assert.equal(form.get('language'),'fa');assert.equal(form.get('prompt'),'آذر, سارا');return new Response(JSON.stringify({text:'آذر و سارا'}));});
 const result=await service.transcribe({...audio,recognition:'accurate',hints:['آذر','سارا']},new AbortController().signal);assert.equal(result.model,'full-model');assert.equal(calls,1);assert.ok(!JSON.stringify(service.capabilities).includes('private'));
});
test('travel phrasebook is fully bundled and saved phrases validate bounds and language direction',()=>{
 assert.equal(travelPhrases.length,20);assert.equal(new Set(travelPhrases.map(p=>p.id)).size,20);assert.ok(travelPhrases.every(p=>p.fa&&p.ja));
 const phrase={id:'x',source:'fa' as const,target:'ja' as const,original:'سلام',translated:'こんにちは'};assert.ok(validSavedPhrase(phrase));assert.ok(!validSavedPhrase({...phrase,target:'fa'}));assert.ok(!validSavedPhrase({...phrase,original:'x'.repeat(2001)}));
 assert.equal(inputLevel(-70),'weak');assert.equal(inputLevel(-20),'present');assert.equal(inputLevel(-1),'loud');assert.equal(inputLevel(NaN),'weak');
});
