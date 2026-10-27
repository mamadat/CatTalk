import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { PROMPT_VERSION, ProviderId, ProviderStatus, TranslationError, TranslationMode, validateTranslation,localProviders } from '../shared/translation';
import { TranslationProvider } from './provider';
import {VoiceService} from './voice';
import {MessagingService} from './messaging';
import {VisionService} from './vision';
import {messagePlatform} from '../shared/messaging';

export interface ServerConfig {
  messaging?:MessagingService;
  vision?:VisionService;
  refreshProviders?:()=>Promise<Record<ProviderId,ProviderStatus>>;
  voice?: VoiceService;
  providers?: Record<ProviderId,ProviderStatus>;
  configured: boolean;
  models: Record<TranslationMode,string>;
  accessToken?: string;
  allowedOrigins: string[];
  staticDirectory?: string;
  timeoutMs?: number;
  maxRequestsPerMinute?: number;
}
function json(res:ServerResponse,status:number,value:unknown) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function authenticated(req:IncomingMessage, token?:string) {
  if (!token) return true;
  const actual=Buffer.from(req.headers.authorization || '');
  const expected=Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual,expected);
}
async function readRaw(req:IncomingMessage,limit=16384) {
  if(Number(req.headers['content-length'] || 0)>limit) {req.resume();throw new TranslationError('BODY_TOO_LARGE','حجم درخواست بیش از حد مجاز است.',413);}
  let size=0; const chunks:Buffer[]=[];
  for await (const chunk of req.iterator({destroyOnReturn:false})) {
    size += chunk.length;
    if (size > limit) {req.resume();throw new TranslationError('BODY_TOO_LARGE','حجم درخواست بیش از حد مجاز است.',413);}
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function readBody(req:IncomingMessage,limit=16384) {
  const raw=await readRaw(req,limit);
  try {return JSON.parse(raw.toString('utf8'));}
  catch {throw new TranslationError('INVALID_JSON','درخواست قابل خواندن نیست.');}
}
export function createTranslationServer(config:ServerConfig, provider:TranslationProvider) {
  let active=0;
  const rates=new Map<string,{count:number;reset:number}>();
  return createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    const origin=req.headers.origin;
    if (origin) {
      if (!config.allowedOrigins.includes(origin)) {json(res,403,{code:'ORIGIN_DENIED',message:'این نشانی در تنظیمات سرور مجاز نیست.'});return;}
      res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600'});res.end();return;
    }
    let pathname:string;
    try {pathname=decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);}
    catch {json(res,400,{message:'نشانی نامعتبر است.'});return;}
    const webhook=pathname.match(/^\/api\/webhooks\/(telegram|whatsapp|instagram)$/);
    if(webhook && messagePlatform(webhook[1])) {
      try {
        if(!config.messaging)throw new TranslationError('MESSAGING_NOT_CONFIGURED','اتصال پیام‌رسان تنظیم نشده است.',503);
        if(req.method==='GET'){const result=config.messaging.challenge(webhook[1],new URL(req.url!,'http://localhost').searchParams);res.writeHead(200,{'Content-Type':'text/plain'});res.end(result);}
        else if(req.method==='POST'){const raw=await readRaw(req,524288);config.messaging.receive(webhook[1],raw,req.headers);json(res,200,{received:true});}
        else json(res,405,{message:'روش درخواست معتبر نیست.'});
      }catch(error){const e=error instanceof TranslationError?error:new TranslationError('WEBHOOK_ERROR','پردازش وب‌هوک ناموفق بود.');json(res,e.status,{code:e.code,message:e.message});}return;
    }
    if(pathname.startsWith('/api/messaging/')) {
      if(!config.accessToken){json(res,503,{message:'برای صندوق پیام خصوصی، TRANSLATION_ACCESS_TOKEN را روی سرور تنظیم کنید و همان توکن را در تنظیم اتصال اپ وارد کنید.'});return;}
      if(!authenticated(req,config.accessToken)){json(res,401,{message:'توکن اتصال به صندوق پیام معتبر نیست.'});return;}
      try {
        if(!config.messaging)throw new TranslationError('MESSAGING_NOT_CONFIGURED','اتصال پیام‌رسان هنوز تنظیم نشده است.',503);
        if(req.method==='GET'&&pathname==='/api/messaging/status')json(res,200,config.messaging.status());
        else if(req.method==='GET'&&pathname==='/api/messaging/inbox')json(res,200,{messages:config.messaging.list()});
        else if(req.method==='DELETE'&&pathname==='/api/messaging/inbox'){config.messaging.clear();json(res,200,{cleared:true});}
        else if(req.method==='POST'&&pathname==='/api/messaging/drafts')json(res,200,config.messaging.draft(await readBody(req)));
        else if(req.method==='POST'&&pathname==='/api/messaging/send'){const body=await readBody(req);json(res,200,await config.messaging.send(body?.draftId));}
        else json(res,404,{message:'مسیر پیام‌رسان پیدا نشد.'});
      }catch(error){const e=error instanceof TranslationError?error:new TranslationError('MESSAGING_ERROR','عملیات پیام‌رسان ناموفق بود.',502);json(res,e.status,{code:e.code,message:e.message});}return;
    }
    if (req.method === 'GET' && pathname === '/api/translation/status') {
      if (!authenticated(req,config.accessToken)) {json(res,401,{code:'UNAUTHORIZED',message:'توکن اتصال به سرور درست نیست.'});return;}
      const providers=config.refreshProviders ? await config.refreshProviders() : config.providers;
      json(res,200,{service:'cattalk-translation',configured:providers ? Object.values(providers).some(v=>v.configured) : config.configured,requiresToken:!!config.accessToken,models:config.models,providers,voice:config.voice?.capabilities,vision:config.vision?.status,promptVersion:PROMPT_VERSION});return;
    }
    const isVoice=['/api/transcribe','/api/speech','/api/ocr'].includes(pathname);
    if (req.method !== 'POST' || (!isVoice && pathname !== '/api/translate')) {
      if (req.method === 'GET' && config.staticDirectory && !pathname.startsWith('/api/')) {
        const root=resolve(config.staticDirectory);
        const file=resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile()) {
          const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css','.json':'application/json','.ttf':'font/ttf','.png':'image/png','.ico':'image/x-icon'};
          res.writeHead(200,{'Content-Type':mime[extname(file)] || 'application/octet-stream','Cache-Control': 'no-cache'});
          createReadStream(file).on('error',() => res.destroy()).pipe(res);return;
        }
      }
      json(res,404,{message:'مسیر پیدا نشد.'});return;
    }
    if (!authenticated(req,config.accessToken)) {json(res,401,{code:'UNAUTHORIZED',message:'توکن اتصال به سرور درست نیست.'});return;}
    if (!req.headers['content-type']?.startsWith('application/json')) {json(res,415,{message:'نوع درخواست باید JSON باشد.'});return;}
    if (!isVoice && !config.configured && !config.refreshProviders) {json(res,503,{code:'NOT_CONFIGURED',message:'یکی از موتورهای محلی را اجرا یا کلید یک سرویس ابری را تنظیم کنید.'});return;}
    const now=Date.now();
    for (const [key,bucket] of rates) if (bucket.reset < now) rates.delete(key);
    const ip=(req.socket.remoteAddress || 'local')+(isVoice ? ':voice' : ':text');
    const bucket=rates.get(ip) || {count:0,reset:now+60000};
    if (bucket.count >= (config.maxRequestsPerMinute ?? (isVoice?90:30)) || active >= 4) {res.setHeader('Retry-After','5');json(res,429,{code:'BUSY',message:'درخواست‌ها زیاد شده‌اند؛ چند لحظه مکث کنید.'});return;}
    bucket.count++;rates.set(ip,bucket);
    const controller=new AbortController();
    let timedOut=false;
    let timer=setTimeout(() => {timedOut=true;controller.abort();},config.timeoutMs ?? 45000);
    const closed=() => controller.abort();
    res.on('close',closed);active++;
    try {
      if (pathname==='/api/ocr') {if(!config.vision)throw new TranslationError('OCR_NOT_CONFIGURED','خواندن تصویر تنظیم نشده است.',503);const result=await config.vision.extract(await readBody(req,6*1024*1024),controller.signal);if(!controller.signal.aborted&&!res.destroyed)json(res,200,result);return;}
      if (isVoice) {
        if (!config.voice) throw new TranslationError('VOICE_NOT_CONFIGURED','سرویس صوتی هنوز تنظیم نشده است.',503);
        const input=await readBody(req,pathname==='/api/transcribe' ? 9*1024*1024 : 16384);
        const result=pathname==='/api/transcribe' ? await config.voice.transcribe(input,controller.signal) : await config.voice.speech(input,controller.signal);
        if (!controller.signal.aborted && !res.destroyed) json(res,200,result);
        return;
      }
      const request=validateTranslation(await readBody(req,65536));
      if(localProviders.includes(request.provider as ProviderId) && config.timeoutMs===undefined){clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;controller.abort();},180000);}
      const providers=config.refreshProviders ? await config.refreshProviders() : config.providers;
      const selected=providers?.[request.provider || 'openai'];
      if(selected?.availableModes?.[request.mode]===false)throw new TranslationError('MODEL_NOT_INSTALLED','مدل حالت انتخاب‌شده نصب نشده است؛ مدل را دانلود یا حالت دیگری انتخاب کنید.',503);
      if (providers && !selected?.configured) throw new TranslationError('NOT_CONFIGURED',selected?.message || 'سرویس انتخاب‌شده آماده نیست؛ تنظیمات یا مدل نصب‌شده را بررسی کنید.',503);
      if (controller.signal.aborted) return;
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no','Connection':'keep-alive'});
      res.flushHeaders();
      await provider(request,controller.signal,event => {
        if (!res.destroyed && !controller.signal.aborted) res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
    } catch (error) {
      if (!res.destroyed) {
        const failure=timedOut ? new TranslationError('TIMEOUT','ترجمه بیش از حد طول کشید؛ دوباره تلاش کنید.',504) : error instanceof TranslationError ? error : new TranslationError('NETWORK','اتصال به سرویس ترجمه برقرار نشد؛ شبکه و تنظیمات سرور را بررسی کنید.',502);
        const body={type:'error',code:failure.code,message:failure.message};
        if (res.headersSent) res.write(`data: ${JSON.stringify(body)}\n\n`); else json(res,failure.status,body);
      }
    } finally {clearTimeout(timer);res.off('close',closed);active--;if (!res.destroyed && !res.writableEnded) res.end();}
  });
}
