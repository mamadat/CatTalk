import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { PROMPT_VERSION, TranslationError, TranslationMode, validateTranslation } from '../shared/translation';
import { TranslationProvider } from './provider';

export interface ServerConfig {
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
async function readBody(req:IncomingMessage) {
  let size=0; const chunks:Buffer[]=[];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new TranslationError('BODY_TOO_LARGE','حجم درخواست بیش از حد مجاز است.',413);
    chunks.push(Buffer.from(chunk));
  }
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
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
    if (req.method === 'GET' && pathname === '/api/translation/status') {
      if (!authenticated(req,config.accessToken)) {json(res,401,{code:'UNAUTHORIZED',message:'توکن اتصال به سرور درست نیست.'});return;}
      json(res,200,{service:'cattalk-translation',configured:config.configured,requiresToken:!!config.accessToken,models:config.models,promptVersion:PROMPT_VERSION});return;
    }
    if (req.method !== 'POST' || pathname !== '/api/translate') {
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
    if (!config.configured) {json(res,503,{code:'NOT_CONFIGURED',message:'سرویس ترجمه هنوز فعال نشده است. OPENAI_API_KEY را در .env سرور تنظیم و سرور را دوباره اجرا کنید.'});return;}
    const now=Date.now();
    for (const [key,bucket] of rates) if (bucket.reset < now) rates.delete(key);
    const ip=req.socket.remoteAddress || 'local';
    const bucket=rates.get(ip) || {count:0,reset:now+60000};
    if (bucket.count >= (config.maxRequestsPerMinute ?? 30) || active >= 4) {res.setHeader('Retry-After','5');json(res,429,{code:'BUSY',message:'درخواست‌ها زیاد شده‌اند؛ چند لحظه مکث کنید.'});return;}
    bucket.count++;rates.set(ip,bucket);
    const controller=new AbortController();
    let timedOut=false;
    const timer=setTimeout(() => {timedOut=true;controller.abort();},config.timeoutMs ?? 45000);
    const closed=() => controller.abort();
    res.on('close',closed);active++;
    try {
      const request=validateTranslation(await readBody(req));
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
