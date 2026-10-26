import {ProviderId,ProviderStatus,TranslationError,TranslationMode,TranslationRequest,PROMPT_VERSION} from '../shared/translation';
import {TranslationProvider} from './provider';
import {buildTranslationInput} from './prompt';

type LocalId='translategemma'|'qwenlocal'|'libretranslate';
export function localURL(value:string) {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname!=='/')throw new Error('Local translation engines must use a loopback origin, without credentials or a path.');
  return url.origin;
}
async function responseJSON(response:Response,limit=1024*1024) {
  if(!response.body)throw new TranslationError('LOCAL_RESPONSE','پاسخ موتور محلی خالی است.',502);
  const reader=response.body.getReader();let size=0;const parts:Uint8Array[]=[];
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>limit)throw new TranslationError('LOCAL_RESPONSE','پاسخ موتور محلی بیش از حد بزرگ است.',502);parts.push(chunk.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
function noOptions(request:TranslationRequest) {
  if(request.context.trim() || request.tone!=='preserve')throw new TranslationError('LOCAL_OPTIONS','این موتور فقط ترجمهٔ مستقیم با حفظ لحن دارد؛ زمینه را خالی و لحن را «حفظ لحن متن» انتخاب کنید.');
}
export function createOllamaProvider(id:'translategemma'|'qwenlocal',url:string,models:Record<TranslationMode,string>,fetchImpl:typeof fetch=fetch):TranslationProvider {
  const origin=localURL(url);
  return async(request,signal,emit)=>{
    const model=models[request.mode];
    if(model.toLowerCase().includes('cloud'))throw new TranslationError('LOCAL_ONLY','در بخش رایگان محلی، مدل ابری مجاز نیست.');
    let messages:{role:string;content:string}[];
    if(id==='translategemma') {
      noOptions(request);
      const languages={fa:'Persian',ja:'Japanese'};
      messages=[{role:'user',content:`Translate from ${languages[request.source]} (${request.source}) into ${languages[request.target]} (${request.target}). Keep the original meaning, tone, names, numbers, and unfinished phrases. Return the translation only, with no comments.\n\n\n${request.text}`}];
    } else {const input=buildTranslationInput(request);messages=[{role:'system',content:input.instructions},...input.input];}
    let response:Response;
    try{response=await fetchImpl(`${origin}/api/chat`,{method:'POST',signal,redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages,stream:true,keep_alive:'10m',...(id==='qwenlocal'?{think:false}:{}),options:{temperature:0.1,num_ctx:4096,num_predict:4096}})});}
    catch(error){if(signal.aborted)throw error;throw new TranslationError('LOCAL_OFFLINE','Ollama در دسترس نیست؛ آن را اجرا و مدل محلی را دانلود کنید.',503);}
    if(!response.ok){await response.body?.cancel();throw new TranslationError('LOCAL_MODEL','مدل محلی در دسترس نیست؛ نام مدل و دانلود آن در Ollama را بررسی کنید.',503);}
    if(!response.body)throw new TranslationError('LOCAL_RESPONSE','جریان مدل محلی دریافت نشد.',502);
    const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',output='',completed=false;
    const parse=(line:string)=>{
      if(!line.trim())return;const event=JSON.parse(line);
      if(event.error)throw new TranslationError('LOCAL_GENERATION','اجرای مدل محلی ناموفق بود؛ حافظه و مدل را بررسی کنید.',502);
      if(completed) return;
      if(typeof event.message?.content==='string') {output+=event.message.content;if(output.length>24000)throw new TranslationError('LOCAL_LENGTH','خروجی مدل محلی بیش از حد طولانی شد.',502);emit({type:'delta',text:event.message.content});}
      if(event.done){if(event.done_reason && event.done_reason!=='stop')throw new TranslationError('INCOMPLETE','مدل محلی ترجمه را کامل نکرد؛ متن را کوتاه‌تر کنید.',502);completed=true;}
    };
    try {
      while(true){const item=await reader.read();if(item.done)break;pending+=decoder.decode(item.value,{stream:true});let newline:number;while((newline=pending.indexOf('\n'))>=0){parse(pending.slice(0,newline));pending=pending.slice(newline+1);}if(pending.length>262144)throw new TranslationError('LOCAL_RESPONSE','قالب پاسخ مدل محلی معتبر نیست.',502);if(completed)break;}
      pending+=decoder.decode();if(pending.trim())parse(pending);
      if(signal.aborted)throw new DOMException('Aborted','AbortError');
      if(!completed || !output.trim())throw new TranslationError('INCOMPLETE','جریان مدل محلی پیش از تکمیل قطع شد.',502);
      emit({type:'complete',model,promptVersion:id==='translategemma'?'translategemma-local-v1':PROMPT_VERSION});
    }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  };
}
export function createLibreProvider(url:string,fetchImpl:typeof fetch=fetch):TranslationProvider {
  const origin=localURL(url);
  return async(request,signal,emit)=>{
    noOptions(request);let response:Response;
    try{response=await fetchImpl(`${origin}/translate`,{method:'POST',signal,redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:request.text,source:request.source,target:request.target,format:'text'})});}
    catch(error){if(signal.aborted)throw error;throw new TranslationError('LOCAL_OFFLINE','LibreTranslate محلی در دسترس نیست؛ سرویس آن را اجرا کنید.',503);}
    if(!response.ok){await response.body?.cancel();throw new TranslationError('LOCAL_TRANSLATE','ترجمهٔ محلی انجام نشد؛ نصب زبان‌های fa و ja و en را بررسی کنید.',502);}
    const data=await responseJSON(response,131072);
    if(typeof data.translatedText!=='string' || !data.translatedText.trim() || data.translatedText.length>24000)throw new TranslationError('LOCAL_RESPONSE','ترجمهٔ معتبر از موتور محلی دریافت نشد.',502);
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    emit({type:'delta',text:data.translatedText});emit({type:'complete',model:'Argos Translate (local)',promptVersion:'libretranslate-local-v1'});
  };
}
export function createLocalEngines(env:Record<string,string|undefined>,models:Record<ProviderId,Record<TranslationMode,string>>,fetchImpl:typeof fetch=fetch) {
  const ollama=localURL(env.OLLAMA_URL || 'http://127.0.0.1:11434'),libre=localURL(env.LIBRETRANSLATE_URL || 'http://127.0.0.1:5000');
  const handlers:Record<LocalId,TranslationProvider>={translategemma:createOllamaProvider('translategemma',ollama,models.translategemma,fetchImpl),qwenlocal:createOllamaProvider('qwenlocal',ollama,models.qwenlocal,fetchImpl),libretranslate:createLibreProvider(libre,fetchImpl)};
  const status={} as Record<LocalId,ProviderStatus>;
  for(const id of Object.keys(handlers) as LocalId[])status[id]={configured:false,models:models[id],message:'موتور محلی هنوز بررسی نشده است.'};
  let checkedAt=0;let checking:Promise<void>|undefined;
  async function check() {
    if(checking)return checking;if(Date.now()-checkedAt<3000)return;
    checking=(async()=>{
      const get=async(url:string)=>{const signal=AbortSignal.timeout(1500);const response=await fetchImpl(url,{signal,redirect:'error'});if(!response.ok)throw new Error('offline');return responseJSON(response);};
      await Promise.allSettled([
        (async()=>{try {
          const data=await get(`${ollama}/api/tags`);const installed=new Set<string>((data.models || []).filter((v:any)=>!v.remote_host && !v.remote_model).map((v:any)=>v.name));
          for(const id of ['translategemma','qwenlocal'] as const){const availableModes={} as Record<TranslationMode,boolean>;for(const mode of ['balanced','quality','fast'] as const){const name=models[id][mode];availableModes[mode]=!name.toLowerCase().includes('cloud') && installed.has(name.includes(':')?name:`${name}:latest`);}const configured=Object.values(availableModes).some(Boolean);status[id]={configured,models:models[id],availableModes,message:configured?'موتور و مدل محلی نصب و در دسترس‌اند.':`مدل نصب نشده؛ ابتدا ollama pull ${models[id].balanced} را اجرا کنید.`};}
        }catch{for(const id of ['translategemma','qwenlocal'] as const)status[id]={configured:false,models:models[id],message:'Ollama اجرا نشده است؛ راهنمای مدل‌های رایگان محلی را ببینید.'};}})(),
        (async()=>{try {
          const data=await get(`${libre}/languages`);if(!Array.isArray(data))throw new Error('invalid');
          const supports=(from:string,to:string)=>data.some((v:any)=>v.code===from && Array.isArray(v.targets) && v.targets.includes(to));
          const configured=supports('fa','ja') && supports('ja','fa');status.libretranslate={configured,models:models.libretranslate,message:configured?'LibreTranslate محلی و هر دو جهت زبان آماده‌اند.':'سرویس فعال است؛ مدل‌های fa، ja و en و مسیر هر دو جهت را نصب کنید.'};
        }catch{status.libretranslate={configured:false,models:models.libretranslate,message:'LibreTranslate اجرا نشده است؛ راهنمای مدل‌های رایگان محلی را ببینید.'};}})(),
      ]);checkedAt=Date.now();
    })();try{await checking;}finally{checking=undefined;}
  }
  return {handlers,status,check};
}
