import {MAX_AUDIO_BYTES} from '../../shared/voice';
import {File,Paths} from 'expo-file-system';
export async function readVoiceFile(uri:string):Promise<{base64:string;size:number}> {const file=new File(uri);if(file.size>MAX_AUDIO_BYTES)throw new Error('حداکثر حجم ویس ۶ مگابایت است.');return {base64:await file.base64(),size:file.size};}
export async function temporarySpeech(base64:string) {
  const file=new File(Paths.cache,`cattalk-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  file.write(base64,{encoding:'base64'});
  return {uri:file.uri,dispose:()=>{if(file.exists)file.delete();}};
}
export async function removeVoiceTemp(uri:string) {if(uri.startsWith(Paths.cache.uri)){const file=new File(uri);if(file.exists)file.delete();}}
