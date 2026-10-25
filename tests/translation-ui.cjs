// Browser integration with explicit test-only HTTP fixtures; no paid API calls.
const {createRequire}=require('node:module');
const {existsSync,mkdirSync}=require('node:fs');
const {join}=require('node:path');
const assert=require('node:assert/strict');
let pw;try {pw=require('playwright');} catch {pw=createRequire(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'))('playwright');}
async function run() {
  const chrome=process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser=await pw.chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const requests=[];
  const url=process.env.CATTALK_URL || 'http://localhost:8787';
  try {
    await page.goto(url);
    await page.getByRole('tab',{name:'ترجمه',exact:true}).click();
    await page.getByText('سرویس هنوز فعال نشده',{exact:true}).waitFor();
    const input=page.getByLabel('متن برای ترجمه',{exact:true});
    await input.fill('سلام');
    assert.equal(await page.getByRole('button',{name:'ترجمهٔ همین متن',exact:true}).isDisabled(),true);
    mkdirSync('artifacts',{recursive:true});
    await page.screenshot({path:'artifacts/translation-unconfigured.png',fullPage:true});
    await page.route('**/api/translation/status',route=>route.fulfill({json:{service:'cattalk-translation',configured:true,requiresToken:false,models:{balanced:'fixture',quality:'fixture',fast:'fixture'},promptVersion:'test-only',providers:Object.fromEntries(['gemini','groq','openrouter','openai'].map(id=>[id,{configured:id!=='openai',models:{balanced:'fixture',quality:'fixture',fast:'fixture'}}]))}}));
    await page.route('**/api/translate',async route=>{
      const data=route.request().postDataJSON();requests.push(data);
      const events=data.text==='خطا' ? [{type:'error',code:'TEST',message:'خطای آزمایشی اتصال'}] : [{type:'delta',text:data.source==='fa'?'こんにちは':'سلام'},{type:'complete',model:'TEST FIXTURE',promptVersion:'test-only'}];
      await route.fulfill({contentType:'text/event-stream',body:events.map(v=>'data: '+JSON.stringify(v)+'\n\n').join('')});
    });
    await page.getByRole('button',{name:'بررسی دوباره',exact:true}).click();
    await page.getByText('ترجمه کامل شد',{exact:true}).waitFor();
    assert.equal(await page.getByTestId('translation-output').innerText(),'こんにちは');
    assert.equal(requests.at(-1).provider,'gemini');
    await page.getByRole('radio',{name:'Groq',exact:true}).click();
    await page.getByText('ترجمه کامل شد',{exact:true}).waitFor();
    assert.equal(requests.at(-1).provider,'groq');
    await page.getByRole('radio',{name:'OpenRouter Free',exact:true}).click();
    await page.getByText('ترجمه کامل شد',{exact:true}).waitFor();
    assert.equal(requests.at(-1).provider,'openrouter');
    const beforeMissing=requests.length;
    await page.getByRole('radio',{name:'OpenAI',exact:true}).click();
    await page.waitForTimeout(650);
    assert.equal(requests.length,beforeMissing);
    assert.equal(await page.getByRole('button',{name:'ترجمهٔ همین متن',exact:true}).isDisabled(),true);
    await page.getByRole('radio',{name:'Google Gemini',exact:true}).click();
    await page.getByText('ترجمه کامل شد',{exact:true}).waitFor();
    await page.getByRole('button',{name:'جابه‌جایی زبان‌ها',exact:true}).click();
    await page.getByText('ترجمه کامل شد',{exact:true}).waitFor();
    assert.equal(await page.getByTestId('translation-output').innerText(),'سلام');
    assert.equal(requests.at(-1).source,'ja');assert.equal(requests.at(-1).text,'こんにちは');
    const count=requests.length;
    await input.dispatchEvent('compositionstart');await input.fill('にほん');
    await page.waitForTimeout(650);assert.equal(requests.length,count);
    await input.dispatchEvent('compositionend');await page.getByText('ترجمه کامل شد',{exact:true}).waitFor();
    assert.equal(requests.at(-1).text,'にほん');
    await page.getByRole('button',{name:'جابه‌جایی زبان‌ها',exact:true}).click();
    await input.fill('خطا');await page.getByText('خطای آزمایشی اتصال',{exact:true}).waitFor();
    assert.equal(await page.getByTestId('translation-output').innerText(),'ترجمه اینجا نمایش داده می‌شود.');
    await input.fill('سلام');await page.getByText('ترجمه کامل شد',{exact:true}).waitFor();
    await page.screenshot({path:'artifacts/translation-fixture-mobile.png',fullPage:true});
    await page.setViewportSize({width:320,height:740});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: provider switching and missing-key isolation, no-key state, FA/JA directions, typing translation, IME pause, error recovery, 320px layout. Translation responses are test fixtures.');
  } finally {await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
