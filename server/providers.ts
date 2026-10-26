import {ProviderId,ProviderStatus,TranslationError,TranslationMode,PROMPT_VERSION} from '../shared/translation';
import {SSEParser} from '../shared/sse';
import {buildTranslationInput} from './prompt';
import {createOpenAIProvider,DEFAULT_MODELS,ProviderConfig,TranslationProvider} from './provider';
import {createLocalEngines} from './localProviders';

export const providerDefaults:Record<ProviderId,Record<TranslationMode,string>>={
  translategemma:{balanced:'translategemma:4b',quality:'translategemma:4b',fast:'translategemma:4b'},
  qwenlocal:{balanced:'qwen3:4b',quality:'qwen3:4b',fast:'qwen3:4b'},
  libretranslate:{balanced:'Argos Translate (local)',quality:'Argos Translate (local)',fast:'Argos Translate (local)'},
  openai:DEFAULT_MODELS,
  gemini:{balanced:'gemini-3.8-flash',quality:'gemini-3.8-flash',fast:'gemini-3.8-flash'},
  groq:{balanced:'openai/gpt-oss-120b',quality:'openai/gpt-oss-120b',fast:'openai/gpt-oss-20b'},
  openrouter:{balanced:'openrouter/free',quality:'openrouter/free',fast:'openrouter/free'},
};
const endpoints={gemini:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',groq:'https://api.groq.com/openai/v1/chat/completions',openrouter:'https://openrouter.ai/api/v1/chat/completions'};

export function createChatProvider(id:keyof typeof endpoints,config:ProviderConfig,fetchImpl:typeof fetch=fetch):TranslationProvider {
  return async (request,signal,emit) => {
    if (!config.apiKey) throw new TranslationError('NOT_CONFIGURED','کلید سرویس انتخاب‌شده را در .env سرور تنظیم کنید.',503);
    const model=config.models[request.mode];
    // This route is deliberately limited to free catalog entries, including env overrides.
    if (id==='openrouter' && model!=='openrouter/free' && !model.endsWith(':free')) throw new TranslationError('FREE_MODEL_REQUIRED','برای OpenRouter Free فقط openrouter/free یا شناسهٔ مدل با پسوند :free مجاز است.',400);
    const prompt=buildTranslationInput(request);
    const response=await fetchImpl(endpoints[id],{method:'POST',signal,headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({
      model,stream:true,max_tokens:4096,
      messages:[{role:'system',content:prompt.instructions},...prompt.input],
      ...(id==='groq' && model.startsWith('openai/gpt-oss-') ? {reasoning_effort:'low',include_reasoning:false} : {}),
    })});
    if (!response.ok) {
      await response.body?.cancel();
      if ([401,403].includes(response.status)) throw new TranslationError('PROVIDER_AUTH','کلید یا دسترسی حساب این سرویس معتبر نیست.',502);
      if (response.status===429) throw new TranslationError('PROVIDER_LIMIT','سهمیهٔ این سرویس تمام شده یا درخواست‌ها زیادند؛ کمی صبر کنید یا سرویس دیگری انتخاب کنید.',429);
      throw new TranslationError('PROVIDER_ERROR','سرویس پاسخ نداد؛ دسترسی حساب و نام مدل را بررسی کنید.',502);
    }
    if (!response.body) throw new TranslationError('EMPTY_STREAM','جریان ترجمه دریافت نشد.',502);
    let finished=false,done=false,output='',actualModel=model;
    const parser=new SSEParser(data=>{
      if (data==='[DONE]') {done=true;return;}
      const chunk=JSON.parse(data);
      if (chunk.error) throw new TranslationError('PROVIDER_ERROR','سرویس در میانهٔ ترجمه خطا داد؛ دوباره تلاش کنید.',502);
      if (typeof chunk.model==='string') actualModel=chunk.model;
      const choice=chunk.choices?.[0];if (!choice) return;
      if (choice.delta?.refusal) throw new TranslationError('REFUSED','سرویس برای این متن ترجمه ارائه نکرد.',422);
      const text=choice.delta?.content;
      if (typeof text==='string' && text) {
        output+=text;
        if (output.length>24000) throw new TranslationError('OUTPUT_TOO_LONG','خروجی بیش از حد طولانی شد.',502);
        emit({type:'delta',text});
      }
      if (choice.finish_reason) {
        if (choice.finish_reason!=='stop') throw new TranslationError('INCOMPLETE','ترجمه کامل نشد؛ متن را کوتاه‌تر کنید یا سرویس دیگری انتخاب کنید.',502);
        finished=true;
      }
    });
    const reader=response.body.getReader(),decoder=new TextDecoder();
    try {
      while (true) {const chunk=await reader.read();if (chunk.done) break;parser.push(decoder.decode(chunk.value,{stream:true}));if (done) break;}
      parser.push(decoder.decode());
      if (signal.aborted) throw new DOMException('Aborted','AbortError');
      if (!finished || !output.trim()) throw new TranslationError('INCOMPLETE','جریان ترجمه پیش از تکمیل قطع شد.',502);
      emit({type:'complete',model:actualModel,promptVersion:PROMPT_VERSION});
    } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  };
}

export function createProviderRegistry(env:Record<string,string|undefined>,fetchImpl:typeof fetch=fetch) {
  const providers={} as Record<ProviderId,ProviderStatus>;
  const handlers={} as Record<ProviderId,TranslationProvider>;
  const modelsByProvider={} as Record<ProviderId,Record<TranslationMode,string>>;
  for (const id of Object.keys(providerDefaults) as ProviderId[]) {
    const prefix=id.toUpperCase();const defaults=providerDefaults[id];
    const apiKey=env[`${prefix}_API_KEY`]?.trim() || '';
    const models={balanced:env[`${prefix}_TRANSLATION_MODEL`] || defaults.balanced,quality:env[`${prefix}_TRANSLATION_QUALITY_MODEL`] || defaults.quality,fast:env[`${prefix}_TRANSLATION_FAST_MODEL`] || defaults.fast};
    modelsByProvider[id]=models;
    if(['translategemma','qwenlocal','libretranslate'].includes(id))continue;
    providers[id]={configured:!!apiKey,models};
    handlers[id]=id==='openai' ? createOpenAIProvider({apiKey,models},fetchImpl) : createChatProvider(id as 'gemini'|'groq'|'openrouter',{apiKey,models},fetchImpl);
  }
  const local=createLocalEngines(env,modelsByProvider,fetchImpl);Object.assign(providers,local.status);Object.assign(handlers,local.handlers);
  async function refreshProviders(){await local.check();Object.assign(providers,local.status);return providers;}
  const translate:TranslationProvider=(request,signal,emit)=>{
    const id=request.provider || 'openai';
    if (!Object.hasOwn(handlers,id)) throw new TranslationError('INVALID_PROVIDER','سرویس انتخاب‌شده معتبر نیست.');
    return handlers[id](request,signal,emit);
  };
  return {providers,translate,refreshProviders};
}
