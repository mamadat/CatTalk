/* Optional browser integration test. Requires a running web build and Playwright.
   Uses a separate browser context and Chromium's synthetic microphone input. */
const {createRequire} = require('node:module');
const {existsSync, mkdirSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');
let playwright;
try { playwright = require('playwright'); }
catch {
  const runtime = join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
  playwright = createRequire(runtime)('playwright');
}
async function run() {
  const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await playwright.chromium.launch({headless:true, ...(existsSync(chrome) ? {executablePath:chrome} : {}), args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  const context = await browser.newContext({viewport:{width:390,height:844}});
  const page = await context.newPage();
  const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  const button = name => page.getByRole('button',{name,exact:true});
  const tab = name => page.getByRole('tab',{name,exact:true});
  const radio = name => page.getByRole('radio',{name,exact:true});
  async function profile(name) {
    await page.getByLabel('نام گربه',{exact:true}).fill(name);
    await button('افزودن پروفایل').click();
    await page.getByText(name,{exact:true}).waitFor();
  }
  try {
    await page.addInitScript(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.__holdCapture=false;window.__ownedStreams=[];navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);window.__ownedStreams.push(stream);if(window.__holdCapture){window.__holdCapture=false;return new Promise(resolve=>{window.__releaseCapture=()=>resolve(stream);});}return stream;};});
    await page.goto(process.env.CATTALK_URL || 'http://localhost:8082', {waitUntil:'networkidle'});
    await button('اول، گربه‌ام را معرفی کنم').click();
    await page.getByLabel('سن گربه',{exact:true}).fill('۲');
    await profile('نارنج');
    await tab('بشنو').click();
    assert.equal(await tab('بشنو').getAttribute('aria-selected'),'true');
    await page.evaluate(()=>window.__holdCapture=true);await button('شروع ضبط').click();await page.waitForFunction(()=>!!window.__releaseCapture);await button('لغو انتظار مجوز ضبط').click();await page.evaluate(()=>window.__releaseCapture());await page.waitForFunction(()=>window.__ownedStreams[0].getTracks().every(t=>t.readyState==='ended'));
    await button('شروع ضبط').click();
    await button('پایان و ذخیرهٔ ضبط').waitFor();
    await page.waitForTimeout(1400);
    await button('پایان و ذخیرهٔ ضبط').click();
    await page.getByRole('button',{name:/شنیدن صدا/}).waitFor();
    assert.equal(await page.evaluate(()=>window.__ownedStreams.every(stream=>stream.getTracks().every(t=>t.readyState==='ended'))),true);
    await radio('کنار ظرف غذا').click();
    await radio('به من نگاه می‌کند').click();
    await button('ثبت و مشاهدهٔ برداشت').click();
    await page.getByText('انتظار غذا',{exact:true}).waitFor();
    await button('بعدش چه اتفاقی افتاد؟').click();
    await radio('انتظار غذا').click();
    await page.getByLabel('نتیجهٔ قابل مشاهده',{exact:true}).fill('بعد از آماده‌شدن غذا به سمت ظرف رفت.');
    await button('ذخیرهٔ بازخورد').click();
    await tab('دفترچه').click();
    await page.getByText('نتیجه: بعد از آماده‌شدن غذا به سمت ظرف رفت.',{exact:false}).waitFor();
    await page.reload({waitUntil:'networkidle'});
    await tab('دفترچه').click();
    await page.getByRole('button',{name:/شنیدن صدا/}).click();
    await button('توقف پخش').waitFor();
    await button('توقف پخش').click();
    await tab('بگو').click();
    await button('ساخت پیام با صدای خودم').first().click();
    await button('ضبط پیام من').click();
    await button('پایان و ذخیرهٔ ضبط').waitFor();
    await page.waitForTimeout(1400);
    await button('پایان و ذخیرهٔ ضبط').click();
    await button('ثبت نتیجهٔ یک تعامل').click();
    await button('بله، مرتبط بود').click();
    await page.getByText('۱ واکنش مرتبط از ۱ مشاهدهٔ ثبت‌شده؛ این آمار دقت ترجمه نیست.',{exact:true}).waitFor();
    await tab('گربه‌ها').click();
    await profile('پشمک');
    await tab('دفترچه').click();
    await page.getByText('اولین صفحه هنوز خالی است',{exact:true}).waitFor();
    await tab('گربه‌ها').click();
    await button('حذف نارنج').click();
    await button('حذف از دستگاه').click();
    await page.getByText('نارنج',{exact:true}).waitFor({state:'detached'});
    await page.reload({waitUntil:'networkidle'});
    await tab('گربه‌ها').click();
    await page.getByText('پشمک',{exact:true}).waitFor();
    assert.equal(await page.getByText('نارنج',{exact:true}).count(),0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    await tab('خانه').click();
    mkdirSync('artifacts',{recursive:true});
    await page.screenshot({path:'artifacts/smoke-mobile.png'});
    assert.deepEqual(errors,[]);
    console.log('PASS: profile, microphone, playback, feedback, reload persistence, cues, cat isolation, cascade deletion, mobile layout; no browser errors.');
  } finally {await browser.close();}
}
run().catch(error => {console.error(error);process.exitCode=1;});
