import React,{useEffect,useRef,useState} from 'react';
import {AppState,View} from 'react-native';
import {AudioModule,RecordingPresets,setAudioModeAsync,useAudioRecorder,useAudioRecorderState} from 'expo-audio';
import {Button,C,T} from '../ui';
import {MicrophoneProps} from './Microphone.types';
import {PauseDetector} from './vad';
import {removeVoiceTemp} from './voiceFiles';
import {inputLevel} from './sessions';
export function Microphone(props:MicrophoneProps) {
  const latest=useRef(props);latest.current=props;
  const recorder=useAudioRecorder({...RecordingPresets.HIGH_QUALITY,sampleRate:16000,numberOfChannels:1,bitRate:32000,isMeteringEnabled:true});
  const state=useAudioRecorderState(recorder,100);
  const [active,setActive]=useState(false),[phase,setPhase]=useState('');
  const wanted=useRef(false),generation=useRef(0),working=useRef(false),recording=useRef(false),vad=useRef<PauseDetector|undefined>(undefined);
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const startedAt=useRef(0);
  const actions=useRef({stop:()=>{},finish:(_speech:boolean)=>{}});
  async function stop(cancel=true) {wanted.current=false;generation.current++;clearTimeout(timer.current);setActive(false);latest.current.onActiveChange(false);setPhase('');if(recording.current){recording.current=false;await recorder.stop().catch(()=>{});if(recorder.uri)await removeVoiceTemp(recorder.uri).catch(()=>{});}await setAudioModeAsync({allowsRecording:false,playsInSilentMode:true});if(cancel)latest.current.onCancel('stop');}
  useEffect(()=>{const sub=AppState.addEventListener('change',s=>{if(s!=='active')actions.current.stop();});return()=>{sub.remove();wanted.current=false;generation.current++;clearTimeout(timer.current);latest.current.onActiveChange(false);if(recording.current)void recorder.stop().then(()=>{if(recorder.uri)void removeVoiceTemp(recorder.uri).catch(()=>{});}).catch(()=>{});void setAudioModeAsync({allowsRecording:false,playsInSilentMode:true});};},[recorder]);
  useEffect(()=>{if(props.disabled && wanted.current)void stop();},[props.disabled]);
  async function listen(id:number) {
    if(id!==generation.current || !wanted.current)return;
    try {await setAudioModeAsync({allowsRecording:true,playsInSilentMode:true});await recorder.prepareToRecordAsync();
      if(id!==generation.current || !wanted.current){await recorder.stop().catch(()=>{});return;}
      recorder.record();recording.current=true;startedAt.current=Date.now();vad.current=new PauseDetector(startedAt.current);setPhase('گوش می‌دهم… پس از ۳ ثانیه سکوت ترجمه می‌کنم');
    } catch {await stop();latest.current.onError('ضبط آغاز نشد؛ مجوز و دسترسی میکروفون را بررسی کنید.');}
  }
  async function finish(speech:boolean) {
    if(working.current || !recording.current)return;working.current=true;const id=generation.current;
    try {const captureStart=startedAt.current;recording.current=false;await recorder.stop();const endedAt=Date.now();await setAudioModeAsync({allowsRecording:false,playsInSilentMode:true});const uri=recorder.uri;
      if(latest.current.continuous){working.current=false;if(wanted.current&&id===generation.current)timer.current=setTimeout(()=>void listen(id),80);}
      if(uri){try {if(speech && id===generation.current && wanted.current){if(!latest.current.continuous)setPhase('ترجمه و پخش؛ میکروفون موقتاً متوقف است');await latest.current.onAudio(uri,'audio/mp4',{startedAt:captureStart,endedAt});}} finally {await removeVoiceTemp(uri).catch(()=>{});}}
    } catch(error) {if(id===generation.current){working.current=false;await stop();latest.current.onError(error instanceof Error?error.message:'پردازش صدا ناموفق بود.');}}
    finally {if(!latest.current.continuous){working.current=false;if(wanted.current && id===generation.current)timer.current=setTimeout(()=>void listen(id),180);}}
  }
  actions.current={stop:()=>void stop(),finish:speech=>void finish(speech)};
  useEffect(()=>{if(!state.isRecording || !recording.current || !vad.current)return;const decision=vad.current.update(state.metering ?? -100,Date.now());if(decision!=='wait')actions.current.finish(decision==='speech');},[state.durationMillis,state.isRecording,state.metering]);
  async function start() {
    latest.current.onCancel('start');
    if(!props.audioReady){latest.current.onError('ابتدا موتور تشخیص گفتار انتخابی را آماده کنید؛ موتور محلی به نصب مدل نیاز دارد.');return;}
    const permission=await AudioModule.requestRecordingPermissionsAsync();if(!permission.granted){latest.current.onError('دسترسی میکروفون را در تنظیمات دستگاه فعال کنید.');return;}
    wanted.current=true;const id=++generation.current;setActive(true);latest.current.onActiveChange(true);await listen(id);
  }
  return <View style={{gap:10}}><Button title={active?'پایان مکالمهٔ زنده':'شروع مکالمهٔ زنده'} icon={active?'stop-circle-outline':'mic-outline'} disabled={props.disabled} onPress={()=>void(active?stop():start())}/>{active&&state.isRecording&&<><Button secondary small title="ترجمهٔ همین عبارت" onPress={()=>void finish(true)}/><T style={{fontSize:12,color:C.muted}}>شدت ورودی: {Math.round(state.metering??-100)} dB · {inputLevel(state.metering??-100)==='weak'?'کم یا سکوت':inputLevel(state.metering??-100)==='loud'?'زیاد؛ میکروفون را دورتر بگیرید':'صدا دریافت می‌شود'} · شاخص شدت، تضمین وضوح گفتار نیست.</T></>} {!!phase&&<T style={{color:C.green,fontSize:12}}>{phase}</T>}<T style={{color:C.muted,fontSize:12}}>ضبط کامل هر نوبت تا ۳ ثانیه سکوت؛ حداکثر ۲ دقیقه گفتار پیوسته. {props.continuous?'ضبط نوبت بعدی هنگام پردازش ادامه دارد؛ مرز نوبت‌ها وقفهٔ کوتاه ضبط دارد.':'بازگشت خودکار به شنیدن پس از پخش.'} پیش از پایان مکالمه، «ترجمهٔ همین عبارت» را بزنید تا عبارت آخر ثبت شود.</T></View>;
}
