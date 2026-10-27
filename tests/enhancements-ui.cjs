// Real UI with explicit HTTP fixtures. No cloud or messaging accounts are contacted.
const {createRequire}=require('node:module');
const {existsSync,mkdirSync}=require('node:fs');
const {join}=require('node:path');
const assert=require('node:assert/strict');
const pw=createRequire(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'))('playwright');
async function run(){
 const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
 const browser=await pw.chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844}}),requests=[],errors=[];let transcriptions=0,images=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],addEventListener(){},removeEventListener(){},cancel(){},speak(m){setTimeout(()=>m.onend?.({}),0);}},configurable:true});window.SpeechSynthesisUtterance=class{};});
 const models={balanced:'fixture',quality:'fixture',fast:'fixture'};
 await page.route('**/api/translation/status',r=>r.fulfill({json:{service:'cattalk-translation',configured:true,models,requiresToken:false,promptVersion:'quality-test',providers:Object.fromEntries(['gemini','groq','openrouter','openai'].map(id=>[id,{configured:true,models}])),vision:{configured:true,model:'fixture'},voice:{transcription:{groq:{configured:true},gemini:{configured:true}},speech:{gemini:{configured:true}}}}}));
 await page.route('**/api/translate',r=>{const data=r.request().postDataJSON();requests.push(data);const text=data.alternative?(data.alternative.style==='fluent'?'明日は猫と行きます。':'明日、猫と一緒に行きます。'):data.source==='fa'?'猫です。':'سلام';return r.fulfill({contentType:'text/event-stream',body:[{type:'delta',text},{type:'complete',model:'FIXTURE',promptVersion:'test'}].map(v=>'data: '+JSON.stringify(v)+'\n\n').join('')});});
 await page.route('**/api/transcribe',r=>{transcriptions++;return r.fulfill({json:{text:'متن اشتباه'}});});
 await page.route('**/api/ocr',r=>{images++;assert.equal(r.request().postDataJSON().mimeType,'image/png');return r.fulfill({json:{text:'متن خوانده شده'}});});
 const button=name=>page.getByRole('button',{name,exact:true}),radio=name=>page.getByRole('radio',{name,exact:true});
 const wait=async predicate=>{for(let i=0;i<60;i++){if(predicate())return;await page.waitForTimeout(100);}assert.ok(predicate(),'expected request missing');};
 try{
  await page.goto(process.env.CATTALK_URL||'http://localhost:8787');await page.getByRole('tab',{name:'ترجمه',exact:true}).click();
  await page.getByRole('button',{name:/^واژه‌نامهٔ شخصی/}).click();
  await page.getByLabel('واژهٔ مبدا واژه‌نامه',{exact:true}).fill('گربه');await page.getByLabel('معادل دلخواه واژه‌نامه',{exact:true}).fill('猫');await button('ذخیرهٔ اصطلاح').click();await button('حذف اصطلاح گربه').waitFor();
  const input=()=>page.getByLabel('متن برای ترجمه',{exact:true});await input().fill('این گربه ۳ ساله است');await wait(()=>requests.some(r=>r.text==='این گربه ۳ ساله است'));
  assert.deepEqual(requests.at(-1).glossary,[{source:'گربه',target:'猫'}]);await page.getByTestId('translation-quality-warnings').waitFor();
  const before=requests.length;await page.waitForTimeout(650);assert.equal(requests.length,before,'alternatives must not run automatically');
  await button('دو ترجمهٔ جایگزین').click();await button('استفاده از پیشنهاد 2').waitFor();assert.equal(requests.length,before+2);assert.deepEqual(requests.slice(-2).map(r=>r.alternative.style),['fluent','precise']);
  await button('استفاده از پیشنهاد 1').click();assert.equal(await page.getByTestId('translation-output').innerText(),'明日は猫と行きます。');
  await input().fill('فردا می‌آیم');await wait(()=>requests.at(-1).text==='فردا می‌آیم');assert.equal(requests.at(-1).glossary,undefined);
  await page.reload();await page.getByRole('tab',{name:'ترجمه',exact:true}).click();await page.getByRole('button',{name:/^واژه‌نامهٔ شخصی/}).click();await button('حذف اصطلاح گربه').waitFor();

  await radio('ترجمهٔ صوتی').click();await button('تنظیمات تشخیص گفتار و صدا').click();await page.getByLabel('پخش خودکار ترجمهٔ صوتی',{exact:true}).click();await page.getByLabel('بازبینی متن ویس پیش از ترجمه',{exact:true}).click();await radio('ارسال فایل ویس').click();
  const wav=Buffer.alloc(48);wav.write('RIFF');wav.write('WAVE',8);const chooser=page.waitForEvent('filechooser');await button('انتخاب و ترجمهٔ ویس').click();await(await chooser).setFiles({name:'review.wav',mimeType:'audio/wav',buffer:wav});
  await page.getByText('منتظر بازبینی متن ویس',{exact:true}).waitFor();const count=requests.length;await page.waitForTimeout(600);assert.equal(requests.length,count);
  await page.getByLabel('اصلاح متن شنیده‌شدهٔ ویس',{exact:true}).fill('گربه فردا می‌آید');await button('تأیید متن ویس و ترجمه').click();await page.getByText('ترجمهٔ صوتی کامل شد',{exact:true}).waitFor();assert.equal(requests.at(-1).text,'گربه فردا می‌آید');assert.equal(transcriptions,1);
  await page.getByLabel('اصلاح متن شنیده‌شدهٔ ویس',{exact:true}).fill('امروز می‌آید');await button('ترجمهٔ متن اصلاح‌شده بدون ضبط دوباره').click();await wait(()=>requests.at(-1).text==='امروز می‌آید');assert.equal(transcriptions,1);

  await radio('مترجم چت').click();await button('پروفایل لحن و زمینهٔ مخاطب').click();await page.getByLabel('نام پروفایل مخاطب',{exact:true}).fill('همکار تست');await radio('محترمانه').click();await page.getByLabel('استفاده از زمینهٔ محدود همین مخاطب',{exact:true}).click();await button('ذخیرهٔ پروفایل مخاطب').click();await radio('همکار تست').waitFor();
  await page.getByLabel('متن پیام دریافتی چت',{exact:true}).fill('明日行きます');await wait(()=>requests.at(-1).text==='明日行きます');assert.equal(requests.at(-1).tone,'polite');await button('پیام بعدی؛ نگه‌داشتن زمینهٔ قبلی').click();
  await page.getByLabel('متن پیام دریافتی چت',{exact:true}).fill('何時ですか');await wait(()=>requests.at(-1).text==='何時ですか');assert.ok(requests.at(-1).context.includes('明日行きます'));
  await radio('بدون پروفایل').click();await page.getByLabel('متن پیام دریافتی چت',{exact:true}).fill('別の人');await wait(()=>requests.at(-1).text==='別の人');assert.ok(!requests.at(-1).context.includes('明日行きます'));
  await radio('واتس‌اپ').click();assert.equal(await page.getByLabel('متن پیام دریافتی چت',{exact:true}).inputValue(),'');assert.equal(await radio('همکار تست').count(),0);

  await radio('تصویر و اسکرین‌شات').click();const picker=page.waitForEvent('filechooser');await button('انتخاب اسکرین‌شات یا تصویر').click();await(await picker).setFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX7cAAAAASUVORK5CYII=','base64')});
  const ocr=page.getByLabel('متن خوانده‌شده از تصویر',{exact:true});await ocr.waitFor();assert.equal(images,1);await ocr.fill('گربه در تصویر');await button('استفاده از متن تصویر برای ترجمه').click();await wait(()=>requests.at(-1).text==='گربه در تصویر');assert.deepEqual(requests.at(-1).glossary,[{source:'گربه',target:'猫'}]);
  mkdirSync('artifacts',{recursive:true});await page.getByTestId('translation-output').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/enhancements-mobile.png'});await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log('PASS: glossary relevance/persistence, warnings, on-demand alternatives/selection, voice review/correction without STT repeat, isolated contact context/tone, OCR editing/translation and 320px layout. All model responses are fixtures.');
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
