// UI-only integration. Translation, inbox and send APIs are explicit fixtures; no external messages are sent.
const {createRequire}=require('node:module');const {existsSync}=require('node:fs');const {join}=require('node:path');const assert=require('node:assert/strict');
let pw;try{pw=require('playwright');}catch{pw=createRequire(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'))('playwright');}
async function run(){
 const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';const browser=await pw.chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let drafts=0,sends=0;const calls=[];
 const models={balanced:'fixture',quality:'fixture',fast:'fixture'};
 await page.route('**/api/translation/status',route=>route.fulfill({json:{service:'cattalk-translation',configured:true,models,requiresToken:false,promptVersion:'test',providers:{gemini:{configured:true,models}}}}));
 await page.route('**/api/translate',route=>{const data=route.request().postDataJSON();calls.push(data);return route.fulfill({contentType:'text/event-stream',body:[{type:'delta',text:data.source==='ja'?'سلام، فردا می‌آیم.':'明日行きます。'},{type:'complete',model:'fixture',promptVersion:'test'}].map(v=>'data: '+JSON.stringify(v)+'\n\n').join('')});});
 await page.route('**/api/messaging/status',route=>route.fulfill({json:{protected:true,platforms:Object.fromEntries(['telegram','whatsapp','instagram'].map(id=>[id,{configured:true,missing:[]}]))}}));
 await page.route('**/api/messaging/inbox',route=>route.fulfill({json:{messages:['telegram','whatsapp','instagram'].map(platform=>({id:platform+'-1',platform,peerId:'123',peerName:'مخاطب آزمایشی',text:'こんにちは。',receivedAt:Date.now(),eventAt:Date.now(),externalId:'1'}))}}));
 await page.route('**/api/messaging/drafts',route=>{drafts++;const body=route.request().postDataJSON();return route.fulfill({json:{id:'draft-1',messageId:body.messageId,platform:body.messageId.split('-')[0],peerId:'123',peerName:'مخاطب آزمایشی',text:body.text,expiresAt:Date.now()+600000}});});
 await page.route('**/api/messaging/send',route=>{sends++;assert.equal(route.request().postDataJSON().draftId,'draft-1');return route.fulfill({json:{sent:true}});});
 const radio=name=>page.getByRole('radio',{name,exact:true}),button=name=>page.getByRole('button',{name,exact:true});
 try{
  await page.goto(process.env.CATTALK_URL||'http://localhost:8787');await page.getByRole('tab',{name:'ترجمه',exact:true}).click();await radio('مترجم چت').click();
  await page.getByLabel('متن پیام دریافتی چت',{exact:true}).fill('こんにちは。');await page.getByTestId('chat-incoming-translation').filter({hasText:'سلام، فردا می‌آیم.'}).waitFor();
  const beforeIME=calls.length;const incoming=page.getByLabel('متن پیام دریافتی چت',{exact:true});await incoming.dispatchEvent('compositionstart');await incoming.fill('にほん');await page.waitForTimeout(600);assert.equal(calls.length,beforeIME);await incoming.dispatchEvent('compositionend');await page.getByTestId('chat-incoming-translation').filter({hasText:'سلام، فردا می‌آیم.'}).waitFor();
  await page.getByLabel('پاسخ برای ترجمه در چت',{exact:true}).fill('فردا می‌آیم.');await page.getByTestId('chat-outgoing-translation').filter({hasText:'明日行きます。'}).waitFor();
  assert.ok(calls.some(v=>v.source==='ja'&&v.target==='fa'));assert.ok(calls.some(v=>v.source==='fa'&&v.target==='ja'));
  for(const name of ['واتس‌اپ','اینستاگرام','تلگرام'])await radio(name).click();
  assert.equal(sends,0);await radio('اتصال رسمی مستقیم').click();await button('بررسی اتصال و پیام‌ها').click();
  await page.getByRole('button',{name:/مخاطب آزمایشی: こんにちは/}).first().waitFor();
  await page.getByTestId('chat-incoming-translation').filter({hasText:'سلام، فردا می‌آیم.'}).waitFor();
  await page.getByLabel('پاسخ برای ترجمه در چت',{exact:true}).fill('فردا می‌آیم.');await page.getByTestId('chat-outgoing-translation').filter({hasText:'明日行きます。'}).waitFor();
  await button('پیش‌نمایش ارسال پاسخ مستقیم').click();await page.getByTestId('chat-send-preview').waitFor();assert.equal(drafts,1);assert.equal(sends,0);
  assert.equal(await page.getByTestId('chat-send-preview').innerText(),'明日行きます。');await button('تأیید و ارسال همین متن').click();await page.getByText('ارسال پیام توسط سرویس تأیید شد.',{exact:true}).waitFor();assert.equal(sends,1);
  await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log('PASS: personal incoming/outgoing JA/FA translation, platform selection, official inbox, exact recipient/text preview, no send before confirmation, single confirmed send, mobile layout. All cloud/send responses are fixtures.');
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
