import { fetch as expoFetch } from 'expo/fetch';
import { SSEParser } from '../../shared/sse';
import { TranslationEvent, TranslationStatus,localProviders,ProviderId } from '../../shared/translation';
import { Transport } from './controller';

export function normalizeServerUrl(input:string) {
  const url=new URL(input.trim());
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) throw new Error('نشانی اصلی سرور را وارد کنید؛ مثلاً https://translate.example.com');
  return url.origin;
}
const headers=(token:string):Record<string,string> => token.trim() ? {Authorization:`Bearer ${token.trim()}`} : {};
async function errorMessage(response:{json:() => Promise<any>}) {try {const data=await response.json();return typeof data.message === 'string' ? data.message : 'پاسخ سرور معتبر نیست.';} catch {return 'پاسخ سرور معتبر نیست.';}}
export async function checkTranslationServer(url:string,token:string,signal:AbortSignal):Promise<TranslationStatus> {
  const response=await expoFetch(`${normalizeServerUrl(url)}/api/translation/status`,{headers:headers(token),signal});
  if (!response.ok) throw new Error(await errorMessage(response));
  const status=await response.json();
  if (status.service !== 'cattalk-translation' || typeof status.configured !== 'boolean') throw new Error('این نشانی مربوط به سرور ترجمهٔ CatTalk نیست.');
  return status;
}
export function createTranslationTransport(url:string,token:string):Transport {
  return async (request,signal,emit) => {
    const abort=new AbortController();
    const cancel=() => abort.abort();
    signal.addEventListener('abort',cancel,{once:true});
    if (signal.aborted) abort.abort();
    let timedOut=false;
    const timer=setTimeout(() => {timedOut=true;abort.abort();},localProviders.includes(request.provider as ProviderId)?185000:50000);
    let reader:ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response=await expoFetch(`${normalizeServerUrl(url)}/api/translate`,{method:'POST',signal:abort.signal,headers:{'Content-Type':'application/json',...headers(token)},body:JSON.stringify(request)});
      if (!response.ok) throw new Error(await errorMessage(response));
      if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('سرور پاسخ زندهٔ معتبر برنگرداند.');
      let completed=false;
      const parser=new SSEParser(data => {
        const event:TranslationEvent=JSON.parse(data);
        if (event.type === 'delta' && typeof event.text === 'string') emit(event);
        else if (event.type === 'complete' && typeof event.model === 'string') {completed=true;emit(event);}
        else if (event.type === 'error' && typeof event.message === 'string') throw new Error(event.message);
        else throw new Error('قالب ترجمهٔ دریافتی معتبر نیست.');
      });
      reader=response.body.getReader();
      const decoder=new TextDecoder();
      while (true) {
        const chunk=await reader.read();if (chunk.done) break;
        if (signal.aborted) throw new DOMException('Aborted','AbortError');
        parser.push(decoder.decode(chunk.value,{stream:true}));
        if (completed) break;
      }
      parser.push(decoder.decode());
      if (!completed) throw new Error('اتصال پیش از تکمیل ترجمه قطع شد.');
    } catch (error) {
      if (signal.aborted) throw error;
      if (timedOut) throw new Error('زمان انتظار تمام شد؛ اتصال را بررسی کنید یا حالت سریع‌تر را امتحان کنید.');
      if (error instanceof TypeError) throw new Error('اتصال به سرور ترجمه برقرار نشد؛ نشانی و شبکه را بررسی کنید.');
      throw error;
    } finally {clearTimeout(timer);signal.removeEventListener('abort',cancel);await reader?.cancel().catch(() => {});reader?.releaseLock();}
  };
}
