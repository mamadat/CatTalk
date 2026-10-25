import { SSEParser } from '../shared/sse';
import { PROMPT_VERSION, TranslationError, TranslationEvent, TranslationMode, TranslationRequest } from '../shared/translation';
import { buildTranslationInput } from './prompt';

export interface ProviderConfig { apiKey: string; models: Record<TranslationMode,string>; }
export type TranslationProvider = (request: TranslationRequest, signal: AbortSignal, emit: (event: TranslationEvent) => void) => Promise<void>;
export const DEFAULT_MODELS = {balanced:'gpt-6.1-sol', quality:'gpt-6-astra', fast:'gpt-6-luna'};
export function createOpenAIProvider(config: ProviderConfig, fetchImpl: typeof fetch = fetch): TranslationProvider {
  return async (request, signal, emit) => {
    if (!config.apiKey) throw new TranslationError('NOT_CONFIGURED', 'سرویس ترجمه هنوز فعال نشده است. کلید API را در فایل .env سرور تنظیم کنید.', 503);
    const model = config.models[request.mode];
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method:'POST', signal,
      headers:{'Authorization':`Bearer ${config.apiKey}`, 'Content-Type':'application/json'},
      body: JSON.stringify({model, ...buildTranslationInput(request), stream:true, store:false, max_output_tokens:4096, reasoning:{effort:request.mode === 'fast' ? 'none' : 'low'}}),
    });
    if (!response.ok) {
      // Never forward an upstream response body: it may contain request details.
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new TranslationError('PROVIDER_AUTH', 'کلید API یا دسترسی این حساب به مدل معتبر نیست.', 502);
      if (response.status === 429) throw new TranslationError('PROVIDER_LIMIT', 'سهمیه یا محدودیت درخواست سرویس رسیده است؛ اعتبار حساب را بررسی کنید.', 429);
      if (response.status === 400 || response.status === 404) throw new TranslationError('MODEL_UNAVAILABLE', 'مدل یا تنظیمات انتخاب‌شده در این حساب در دسترس نیست. تنظیم مدل سرور را بررسی کنید.', 502);
      throw new TranslationError('PROVIDER_ERROR', 'سرویس مدل پاسخ نداد؛ کمی بعد دوباره تلاش کنید.', 502);
    }
    if (!response.body) throw new TranslationError('EMPTY_STREAM', 'جریان ترجمه دریافت نشد.', 502);
    let completed = false;
    let output = '';
    const parser = new SSEParser(data => {
      if (data === '[DONE]') return;
      const event = JSON.parse(data);
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        output += event.delta;
        if (output.length > 24000) throw new TranslationError('OUTPUT_TOO_LONG', 'خروجی بیش از حد طولانی شد؛ متن را کوتاه‌تر کنید.', 502);
        emit({type:'delta',text:event.delta});
      } else if (event.type === 'response.completed') {
        if (event.response?.status && event.response.status !== 'completed') throw new TranslationError('INCOMPLETE', 'ترجمه کامل نشد؛ دوباره تلاش کنید.', 502);
        completed = true;
      } else if (event.type === 'response.refusal.delta' || event.type === 'response.refusal.done') {
        throw new TranslationError('REFUSED', 'سرویس برای این متن ترجمه‌ای ارائه نکرد.', 422);
      } else if (['response.failed','response.incomplete','error'].includes(event.type)) {
        throw new TranslationError('INCOMPLETE', 'ترجمه کامل نشد؛ دوباره تلاش کنید یا متن را کوتاه‌تر کنید.', 502);
      }
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        parser.push(decoder.decode(chunk.value,{stream:true}));
        if (completed) break;
      }
      parser.push(decoder.decode());
      if (!completed || !output.trim()) throw new TranslationError('INCOMPLETE', 'جریان ترجمه پیش از تکمیل قطع شد؛ دوباره تلاش کنید.', 502);
      if (signal.aborted) throw new DOMException('Aborted','AbortError');
      emit({type:'complete',model,promptVersion:PROMPT_VERSION});
    } finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
  };
}
