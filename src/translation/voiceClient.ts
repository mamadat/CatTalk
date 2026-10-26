import {fetch as expoFetch} from 'expo/fetch';
import {Language} from '../../shared/translation';
import {TranscribeRequest} from '../../shared/voice';
import {normalizeServerUrl} from './client';
export async function voicePost(url:string,token:string,path:'transcribe'|'speech',body:unknown,signal:AbortSignal):Promise<any> {
  const timeout=new AbortController();const cancel=()=>timeout.abort();signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  const timer=setTimeout(cancel,45000);
  try {
    const response=await expoFetch(`${normalizeServerUrl(url)}/api/${path}`,{method:'POST',signal:timeout.signal,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw new Error(data.message || 'پردازش صوتی انجام نشد.');return data;
  } catch(error) {if(signal.aborted)throw error;if(timeout.signal.aborted)throw new Error('زمان انتظار سرویس صوتی تمام شد.');if(error instanceof TypeError)throw new Error('ارتباط با سرور صوتی برقرار نشد.');throw error;}
  finally {clearTimeout(timer);signal.removeEventListener('abort',cancel);}
}
export async function transcribeVoice(url:string,token:string,body:TranscribeRequest,signal:AbortSignal) {
  const data=await voicePost(url,token,'transcribe',body,signal);if(typeof data.text!=='string')throw new Error('متن گفتار دریافتی معتبر نیست.');return data.text;
}
export async function requestSpeech(url:string,token:string,text:string,language:Language,signal:AbortSignal) {
  const data=await voicePost(url,token,'speech',{text,language},signal);if(typeof data.audioBase64!=='string' || data.mimeType!=='audio/wav')throw new Error('صدای دریافتی معتبر نیست.');return data.audioBase64 as string;
}
