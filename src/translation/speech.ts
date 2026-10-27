import * as Speech from 'expo-speech';
import {Platform} from 'react-native';
import {createAudioPlayer,setAudioModeAsync} from 'expo-audio';
import {Language} from '../../shared/translation';
import {VoiceEngine} from '../../shared/voice';
import {SpeechSession} from './voiceController';
import {requestSpeech} from './voiceClient';
import {temporarySpeech} from './voiceFiles';

export async function deviceVoice(language:Language) {
  if(Platform.OS==='web') {
    if(typeof window==='undefined' || !window.speechSynthesis)return;
    const voices=await new Promise<SpeechSynthesisVoice[]>(resolve=>{
      const synth=window.speechSynthesis;
      const finish=()=>{clearTimeout(timer);synth.removeEventListener('voiceschanged',finish);resolve(synth.getVoices());};
      const timer=setTimeout(finish,1200);
      if(synth.getVoices().length)finish();else synth.addEventListener('voiceschanged',finish);
    });
    const voice=voices.find(v=>v.lang.toLowerCase().replace('_','-').startsWith(language));
    return voice ? {identifier:voice.voiceURI,name:voice.name} : undefined;
  }
  const voices=await Speech.getAvailableVoicesAsync();
  return voices.find(v=>v.language.toLowerCase().replace('_','-').startsWith(language));
}
export function createSpeechSession(options:{engine:VoiceEngine;language:Language;url:string;token:string;enabled:boolean;rate?:number},signal:AbortSignal,onStart:()=>void):SpeechSession {
  let chain=Promise.resolve();let failure:unknown;let stopped=false;let cancelPlayback:(()=>void)|undefined;
  const voice=options.engine==='device' && options.enabled ? deviceVoice(options.language).catch(()=>undefined) : Promise.resolve(undefined);
  // Errors remain observed even when a stream aborts before drain().
  async function say(text:string) {
    if(stopped || signal.aborted || !options.enabled)return;
    await setAudioModeAsync({allowsRecording:false,playsInSilentMode:true});
    if(options.engine==='device') {
      const selected=await voice;
      if(!selected)throw new Error(`صدای ${options.language==='fa'?'فارسی':'ژاپنی'} روی دستگاه موجود نیست؛ آن را نصب کنید یا صدای Gemini را انتخاب کنید.`);
      if(stopped || signal.aborted)return;
      await new Promise<void>((resolve,reject)=>{
        let settled=false;const timer=setTimeout(()=>{void Speech.stop();finish(new Error('پخش صدای دستگاه متوقف شد؛ پخش دوباره را امتحان کنید.'));},60000);
        const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);cancelPlayback=undefined;error?reject(error):resolve();};
        cancelPlayback=()=>{void Speech.stop();finish();};
        Speech.speak(text,{language:options.language==='fa'?'fa-IR':'ja-JP',voice:selected.identifier,rate:options.rate??1,onStart,onDone:()=>finish(),onStopped:()=>finish(),onError:()=>finish(new Error('پخش صدای دستگاه ناموفق بود؛ پخش دوباره یا صدای Gemini را امتحان کنید.'))});
      });
    } else {
      const base64=await requestSpeech(options.url,options.token,text,options.language,signal);
      if(stopped || signal.aborted)return;
      const file=await temporarySpeech(base64);const player=createAudioPlayer(file.uri);let sub:{remove:()=>void}|undefined;
      try {
        await new Promise<void>((resolve,reject)=>{
          let started=false,settled=false;const timer=setTimeout(()=>finish(new Error('پخش صدا بیش از حد طول کشید.')),60000);
          const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);cancelPlayback=undefined;error?reject(error):resolve();};
          cancelPlayback=()=>{player.pause();finish();};
          sub=player.addListener('playbackStatusUpdate',status=>{if(status.playing&&!started){started=true;onStart();}if(status.didJustFinish)finish();});
          if(stopped || signal.aborted)finish();else {player.setPlaybackRate(options.rate??1);player.play();}
        });
      } finally {sub?.remove();player.remove();file.dispose();}
    }
  }
  function stop() {stopped=true;cancelPlayback?.();signal.removeEventListener('abort',stop);}
  signal.addEventListener('abort',stop,{once:true});
  return {enqueue(text) {chain=chain.then(()=>{if(failure)return;return say(text);}).catch(error=>{failure=error;});},async drain(){await chain;signal.removeEventListener('abort',stop);if(failure)throw failure;},stop};
}
