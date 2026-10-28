import {Language,TranslationError} from './translation';
export type STTProvider='groq'|'gemini'|'whisperlocal';
export type VoiceEngine='device'|'gemini';
export const sttNames={whisperlocal:'Faster Whisper محلی · رایگان',groq:'Groq Whisper سریع',gemini:'Gemini'} as const;
export const speechNames={device:'صدای دستگاه · سریع‌تر',gemini:'صدای Gemini'} as const;
export const MAX_AUDIO_BYTES=6*1024*1024;
export const audioTypes:Record<string,string>={'audio/webm':'webm','audio/mp4':'m4a','audio/m4a':'m4a','audio/x-m4a':'m4a','audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/ogg':'ogg','audio/flac':'flac','audio/aac':'aac'};
export interface VoiceCapabilities {transcription:Record<STTProvider,{configured:boolean;model:string;qualityModel?:string;local?:boolean;message?:string;availableModes?:{fast:boolean;accurate:boolean}}>;speech:{gemini:{configured:boolean;model:string}};}
export interface TranscribeRequest {provider:STTProvider;language:Language;mimeType:string;audioBase64:string;recognition?:'fast'|'accurate';hints?:string[];}
export function validateAudio(input:unknown):TranscribeRequest {
  const v=input as TranscribeRequest;
  if (!v || !['groq','gemini','whisperlocal'].includes(v.provider) || !['fa','ja'].includes(v.language)) throw new TranslationError('INVALID_AUDIO_OPTIONS','زبان یا سرویس تشخیص گفتار معتبر نیست.');
  const mimeType=typeof v.mimeType==='string' ? v.mimeType.split(';')[0].toLowerCase() : '';
  if (!Object.hasOwn(audioTypes,mimeType)) throw new TranslationError('AUDIO_FORMAT','فرمت صدا پشتیبانی نمی‌شود؛ MP3، M4A، WAV، OGG یا WebM انتخاب کنید.');
  if (typeof v.audioBase64!=='string' || !v.audioBase64.length || v.audioBase64.length>Math.ceil(MAX_AUDIO_BYTES/3)*4 || v.audioBase64.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(v.audioBase64)) throw new TranslationError('AUDIO_SIZE','فایل صوتی معتبر با حجم حداکثر ۶ مگابایت انتخاب کنید.',413);
  if(v.recognition!==undefined&&!['fast','accurate'].includes(v.recognition))throw new TranslationError('INVALID_RECOGNITION','حالت تشخیص گفتار معتبر نیست.');
  if(v.hints!==undefined&&(!Array.isArray(v.hints)||v.hints.length>8||v.hints.some(x=>typeof x!=='string'||!x.trim()||x.length>40)||new TextEncoder().encode(v.hints.join(', ')).length>160))throw new TranslationError('INVALID_SPOKEN_TERMS','حداکثر ۸ نام کوتاه و مجموع ۱۶۰ بایت راهنمای گفتار مجاز است.');
  return {provider:v.provider,language:v.language,mimeType,audioBase64:v.audioBase64,...(v.recognition?{recognition:v.recognition}:{}),...(v.hints?.length?{hints:v.hints}:{})};
}
export function validateSpeech(input:unknown):{text:string;language:Language} {
  const v=input as {text:string;language:Language};
  if (!v || !['fa','ja'].includes(v.language) || typeof v.text!=='string' || !v.text.trim() || v.text.length>600) throw new TranslationError('INVALID_SPEECH','هر قطعهٔ گفتار باید بین ۱ و ۶۰۰ نویسه باشد.');
  return {text:v.text,language:v.language};
}
