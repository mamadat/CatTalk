// Real app UI with explicit speech-recognition/TTS and HTTP test fixtures.
// No cloud keys are used and these checks do not measure model accuracy/latency.
const {createRequire}=require('node:module');const {existsSync,mkdirSync}=require('node:fs');const {join}=require('node:path');const assert=require('node:assert/strict');
let pw;try{pw=require('playwright');}catch{pw=createRequire(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'))('playwright');}
async function run(){
 const fallback=process.env.VOICE_CAPTURE_FALLBACK==='1';
 const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';const browser=await pw.chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'],...(existsSync(chrome)?{executablePath:chrome}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[],requests=[],transcriptions=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(fallback=>{
  window.__spoken=[];window.__recognizers=[];
  Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{voiceURI:'ja-fixture',name:'Japanese TEST',lang:'ja-JP',localService:true},{voiceURI:'fa-fixture',name:'Persian TEST',lang:'fa-IR',localService:true}],addEventListener(){},removeEventListener(){},cancel(){},speak(message){window.__spoken.push({text:message.text,language:message.lang});setTimeout(()=>message.onstart?.({}),0);setTimeout(()=>message.onend?.({}),15);}},configurable:true});
  window.SpeechSynthesisUtterance=class{};
  window.SpeechRecognition=fallback?undefined:class{
   start(){window.__recognizers.push(this);}abort(){};
  };
  if(fallback)window.webkitSpeechRecognition=undefined;
 },fallback);
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
  assert.equal(transcriptions.length,1);assert.equal(transcriptions[0].language,'fa');assert.equal(requests.at(-1).mode,'fast');
  assert.deepEqual(await page.evaluate(()=>window.__spoken.map(v=>v.text)),['こんにちは。','明日行きます。']);
  await page.getByRole('button',{name:'جابه‌جایی زبان‌ها',exact:true}).click();
  await radio('میکروفون زنده').click();await button('شروع مکالمهٔ زنده').click();
  if(fallback){
   await page.getByText('ترجمهٔ صوتی کامل شد',{exact:true}).waitFor({timeout:20000});
   assert.equal(transcriptions.length,2);assert.equal(transcriptions.at(-1).language,'ja');assert.ok(Buffer.from(transcriptions.at(-1).audioBase64,'base64').length>500);
   assert.equal(requests.at(-1).source,'ja');await button('پایان مکالمهٔ زنده').click();
  }else{
  await page.waitForFunction(()=>window.__recognizers.length>0);
  assert.equal(await page.evaluate(()=>window.__recognizers.at(-1).lang),'ja-JP');
  await page.evaluate(()=>{const result=[{transcript:'こんにちは'}];result.isFinal=false;window.__recognizers.at(-1).onresult({resultIndex:0,results:[result]});});
  await page.getByTestId('voice-interim').waitFor();const count=requests.length;await page.waitForTimeout(200);assert.equal(requests.length,count);
  await page.evaluate(()=>{const result=[{transcript:'こんにちは。'}];result.isFinal=true;window.__recognizers.at(-1).onresult({resultIndex:0,results:[result]});});
  await page.getByText('ترجمهٔ صوتی کامل شد',{exact:true}).waitFor();assert.equal(requests.at(-1).source,'ja');assert.equal(transcriptions.length,1);
  assert.equal((await page.evaluate(()=>window.__spoken)).at(-1).language,'fa-IR');
  await button('پایان مکالمهٔ زنده').click();const recognizers=await page.evaluate(()=>window.__recognizers.length);await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.__recognizers.length),recognizers);
  }
  await button('پخش دوبارهٔ ترجمه').click();await button('پخش دوبارهٔ ترجمه').waitFor();
  mkdirSync('artifacts',{recursive:true});await page.getByText('بگو، ترجمه‌اش را بشنو',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:fallback?'artifacts/voice-recording-mobile.png':'artifacts/voice-mobile.png'});
  await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log((fallback?'REAL BROWSER MICROPHONE CAPTURE: ':'')+'PASS: voice upload, transcription, immediate translation, sentence playback, JA/FA microphone direction, interim filtering, stopping, replay, 320px layout. Speech and cloud responses are test fixtures.');
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
