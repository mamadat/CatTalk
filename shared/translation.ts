export type Language = 'fa' | 'ja';
export type TranslationMode = 'balanced' | 'quality' | 'fast';
export type TranslationTone = 'preserve' | 'polite' | 'casual';
export const providerNames = {gemini:'Google Gemini',groq:'Groq',openrouter:'OpenRouter Free',openai:'OpenAI'} as const;
export type ProviderId = keyof typeof providerNames;
export interface ProviderStatus {configured:boolean; models:Record<TranslationMode,string>;}
export const languageNames = { fa: 'فارسی', ja: '日本語' } as const;
export const modeNames = { balanced: 'متعادل', quality: 'دقت بیشتر', fast: 'سریع‌تر' } as const;
export const toneNames = { preserve: 'حفظ لحن متن', polite: 'محترمانه', casual: 'خودمانی' } as const;
export const MAX_TEXT_LENGTH = 2000;
export const PROMPT_VERSION = 'fa-ja-v1.0';
export interface TranslationRequest {
  provider?: ProviderId;
  text: string;
  source: Language;
  target: Language;
  mode: TranslationMode;
  tone: TranslationTone;
  context: string;
}
export type TranslationEvent =
  | { type: 'delta'; text: string }
  | { type: 'complete'; model: string; promptVersion: string }
  | { type: 'error'; code: string; message: string };
export interface TranslationStatus {
  providers?: Record<ProviderId,ProviderStatus>;
  service: 'cattalk-translation';
  configured: boolean;
  requiresToken: boolean;
  models: Record<TranslationMode, string>;
  promptVersion: string;
}
export class TranslationError extends Error {
  constructor(public code: string, message: string, public status = 400) {super(message); this.name = 'TranslationError';}
}
export function validateTranslation(input: unknown): TranslationRequest {
  if (!input || typeof input !== 'object') throw new TranslationError('INVALID_REQUEST', 'درخواست ترجمه معتبر نیست.');
  const value = input as Record<string, unknown>;
  if (value.provider !== undefined && (typeof value.provider !== 'string' || !Object.hasOwn(providerNames,value.provider))) throw new TranslationError('INVALID_PROVIDER','سرویس انتخاب‌شده معتبر نیست.');
  if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > MAX_TEXT_LENGTH) throw new TranslationError('INVALID_TEXT', `متن باید بین ۱ و ${MAX_TEXT_LENGTH} نویسه باشد.`);
  if (typeof value.source !== 'string' || typeof value.target !== 'string' || !['fa','ja'].includes(value.source) || !['fa','ja'].includes(value.target) || value.source === value.target) throw new TranslationError('INVALID_DIRECTION', 'جهت ترجمه باید فارسی به ژاپنی یا برعکس باشد.');
  if (typeof value.mode !== 'string' || typeof value.tone !== 'string' || !Object.hasOwn(modeNames, value.mode) || !Object.hasOwn(toneNames, value.tone)) throw new TranslationError('INVALID_OPTIONS', 'گزینه‌های ترجمه معتبر نیستند.');
  if (typeof value.context !== 'string' || value.context.length > 500) throw new TranslationError('INVALID_CONTEXT', 'زمینهٔ متن باید حداکثر ۵۰۰ نویسه باشد.');
  return {...(value.provider !== undefined ? {provider:value.provider as ProviderId} : {}),text:value.text, source:value.source as Language, target:value.target as Language, mode:value.mode as TranslationMode, tone:value.tone as TranslationTone, context:value.context};
}
