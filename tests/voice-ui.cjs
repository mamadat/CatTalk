// Real app UI and real MediaRecorder with synthetic microphone input. TTS/cloud use fixtures.
// No cloud keys are used and these checks do not measure model accuracy/latency.
const {createRequire}=require('node:module');const {existsSync,mkdirSync,writeFileSync}=require('node:fs');const {join}=require('node:path');const assert=require('node:assert/strict');
let pw;try{pw=require('playwright');}catch{pw=createRequire(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'))('playwright');}
async function run(){
 mkdirSync('artifacts',{recursive:true});
 const capturePath=join(process.cwd(),'artifacts','voice-pause-fixture.wav');
 const samples=16000*12;const capture=Buffer.alloc(44+samples*2);capture.write('RIFF',0);capture.writeUInt32LE(capture.length-8,4);capture.write('WAVEfmt ',8);capture.writeUInt32LE(16,16);capture.writeUInt16LE(1,20);capture.writeUInt16LE(1,22);capture.writeUInt32LE(16000,24);capture.writeUInt32LE(32000,28);capture.writeUInt16LE(2,32);capture.writeUInt16LE(16,34);capture.write('data',36);capture.writeUInt32LE(samples*2,40);
 for(let i=0;i<32000;i++)capture.writeInt16LE(Math.round(12000*Math.sin(2*Math.PI*440*i/16000)),44+i*2);
 writeFileSync(capturePath,capture);
 const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';const browser=await pw.chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${capturePath}`],...(existsSync(chrome)?{executablePath:chrome}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[],requests=[],transcriptions=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__spoken=[];
  Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{voiceURI:'ja-fixture',name:'Japanese TEST',lang:'ja-JP',localService:true},{voiceURI:'fa-fixture',name:'Persian TEST',lang:'fa-IR',localService:true}],addEventListener(){},removeEventListener(){},cancel(){},speak(message){window.__spoken.push({text:message.text,language:message.lang});setTimeout(()=>message.onstart?.({}),0);setTimeout(()=>message.onend?.({}),15);}},configurable:true});
  window.SpeechSynthesisUtterance=class{};
 });
 const models={balanced:'fixture',quality:'fixture',fast:'fixture'};
 await page.route('**/api/translation/status',route=>route.fulfill({json:{service:'cattalk-translation',configured:true,models,requiresToken:false,promptVersion:'test',providers:Object.fromEntries(['gemini','groq','openrouter','openai'].map(id=>[id,{configured:true,models}])),voice:{transcription:{groq:{configured:true,model:'fixture'},gemini:{configured:true,model:'fixture'}},speech:{gemini:{configured:true,model:'fixture'}}}}}));
 await page.route('**/api/transcribe',route=>{const data=route.request().postDataJSON();transcriptions.push(data);return route.fulfill({json:{text:data.language==='fa'?'سلام، فردا می‌آیم.':'こんにちは。',model:'test'}});});
 await page.route('**/api/translate',route=>{const data=route.request().postDataJSON();requests.push(data);const events=[{type:'delta',text:data.source==='fa'?'こんにちは。':'سلام.'},{type:'delta',text:data.source==='fa'?'明日行きます。':' فردا می‌آیم.'},{type:'complete',model:'TEST FIXTURE',promptVersion:'test'}];return route.fulfill({contentType:'text/event-stream',body:events.map(v=>'data: '+JSON.stringify(v)+'\n\n').join('')});});
 const radio=name=>page.getByRole('radio',{name,exact:true}),button=name=>page.getByRole('button',{name,exact:true});
 try{
  await page.goto(process.env.CATTALK_URL||'http://localhost:8787');await page.getByRole('tab',{name:'ترجمه',exact:true}).click();await radio('ترجمهٔ صوتی').click();
  await radio('ارسال فایل ویس').click();const chooser=page.waitForEvent('filechooser');await button('انتخاب و ترجمهٔ ویس').click();
  const wav=Buffer.alloc(44+3200);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(3200,40);
  await(await chooser).setFiles({name:'voice-test.wav',mimeType:'audio/wav',buffer:wav});
  await page.getByText('ترجمهٔ صوتی کامل شد',{exact:true}).waitFor();
  assert.equal(await page.getByTestId('voice-transcript').innerText(),'سلام، فردا می‌آیم.');assert.equal(await page.getByTestId('voice-translation').innerText(),'こんにちは。明日行きます。');
  assert.equal(transcriptions.length,1);assert.equal(transcriptions[0].language,'fa');assert.equal(requests.at(-1).mode,'balanced');
  assert.deepEqual(await page.evaluate(()=>window.__spoken.map(v=>v.text)),['こんにちは。','明日行きます。']);
  await page.getByRole('button',{name:'جابه‌جایی زبان‌ها',exact:true}).click();
  await radio('میکروفون زنده').click();await button('شروع مکالمهٔ زنده').click();
  const started=Date.now();
  await page.waitForTimeout(2000);assert.equal(transcriptions.length,1); // no old early-cut path
  await page.getByText('ترجمهٔ صوتی کامل شد',{exact:true}).waitFor({timeout:18000});
  assert.ok(Date.now()-started>=3000,'microphone must wait for the full silence window');
  assert.equal(transcriptions.length,2);assert.equal(transcriptions.at(-1).language,'ja');assert.ok(Buffer.from(transcriptions.at(-1).audioBase64,'base64').length>500);
  assert.equal(requests.at(-1).source,'ja');assert.equal((await page.evaluate(()=>window.__spoken)).at(-1).language,'fa-IR');
  await button('پایان مکالمهٔ زنده').click();const count=transcriptions.length;await page.waitForTimeout(500);assert.equal(transcriptions.length,count);
  await button('پخش دوبارهٔ ترجمه').click();await button('پخش دوبارهٔ ترجمه').waitFor();
  mkdirSync('artifacts',{recursive:true});await page.getByText('بگو، ترجمه‌اش را بشنو',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/voice-mobile.png'});
  await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log('PASS: complete voice upload, balanced mode, actual microphone capture until 3s silence, JA/FA direction, stopping, replay, 320px layout. Cloud responses and TTS are test fixtures.');
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
