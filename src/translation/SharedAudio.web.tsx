import React,{useEffect,useRef,useState} from 'react';
import {View} from 'react-native';
import {Button,C,T} from '../ui';
import {MicrophoneProps} from './Microphone.types';
import {PauseDetector} from './vad';

/** Explicit display picker; only audio tracks are recorded or sent to STT. */
export function SharedAudio(props:MicrophoneProps){
 const latest=useRef(props);latest.current=props;
 const [active,setActive]=useState(false),[opening,setOpening]=useState(false),[phase,setPhase]=useState('');
 const wanted=useRef(false),generation=useRef(0),cleanup=useRef<()=>void>(()=>{}),finish=useRef<(()=>void)|undefined>(undefined);
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 function stop(){wanted.current=false;generation.current++;clearTimeout(timer.current);cleanup.current();cleanup.current=()=>{};finish.current=undefined;setActive(false);setOpening(false);setPhase('');latest.current.onActiveChange(false);latest.current.onCancel('stop');}
 useEffect(()=>()=>{wanted.current=false;generation.current++;clearTimeout(timer.current);cleanup.current();latest.current.onActiveChange(false);},[]);
 useEffect(()=>{if(props.disabled&&wanted.current)stop();},[props.disabled]);
 async function start(){
  if(!navigator.mediaDevices?.getDisplayMedia){latest.current.onError('دریافت صدای تب در این مرورگر در دسترس نیست؛ از مرورگر پشتیبان روی رایانه یا میکروفون استفاده کنید.');return;}
  latest.current.onCancel('start');setOpening(true);wanted.current=true;const id=++generation.current;
  let display:MediaStream|undefined,context:AudioContext|undefined;
  try{
   display=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser'},audio:true,systemAudio:'include',selfBrowserSurface:'exclude',surfaceSwitching:'exclude'} as DisplayMediaStreamOptions);
   if(id!==generation.current||!wanted.current){display.getTracks().forEach(t=>t.stop());return;}
   if(!display.getAudioTracks().length)throw new Error('منبع انتخاب‌شده صدا ندارد. دوباره انتخاب و گزینهٔ «Share tab audio / اشتراک صدا» را روشن کنید.');
   const audio=new MediaStream(display.getAudioTracks());context=new AudioContext();await context.resume();
   if(id!==generation.current||!wanted.current){display.getTracks().forEach(t=>t.stop());void context.close().catch(()=>{});return;}
   const source=context.createMediaStreamSource(audio),analyser=context.createAnalyser();analyser.fftSize=1024;source.connect(analyser);const samples=new Float32Array(analyser.fftSize);
   let recorder:MediaRecorder|undefined,closed=false,poll:ReturnType<typeof setInterval>|undefined;
   const release=()=>{if(closed)return;closed=true;clearInterval(poll);if(recorder){recorder.onstop=null;if(recorder.state!=='inactive')recorder.stop();}display?.getTracks().forEach(t=>t.stop());source.disconnect();void context?.close().catch(()=>{});};
   cleanup.current=release;
   const fail=(message:string)=>{if(id!==generation.current)return;stop();latest.current.onError(message);};
   display.getTracks().forEach(track=>track.addEventListener('ended',()=>{if(id===generation.current){stop();latest.current.onError('اشتراک صدا پایان یافت؛ نوبت ثبت‌نشده کنار گذاشته شد.');}},{once:true}));
   async function deliver(uri:string,mime:string,startedAt:number,endedAt:number){
    try{if(id===generation.current&&wanted.current)await latest.current.onAudio(uri,mime,{startedAt,endedAt});}
    catch(e){if(id===generation.current)fail(e instanceof Error?e.message:'پردازش صدای اشتراک‌شده انجام نشد.');}
    finally{URL.revokeObjectURL(uri);if(!latest.current.continuous&&id===generation.current&&wanted.current)timer.current=setTimeout(listen,80);}
   }
   function listen(){
    if(closed||id!==generation.current||!wanted.current)return;
    try{
    const startedAt=Date.now(),vad=new PauseDetector(startedAt,3000,latest.current.maxTurnMs||120000),chunks:Blob[]=[];let sending=false;
    const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(value=>MediaRecorder.isTypeSupported(value));
    recorder=new MediaRecorder(audio,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:48000});
    const current=recorder;
    const end=(send:boolean)=>{if(current.state==='inactive')return;sending=send;clearInterval(poll);current.stop();};
    finish.current=()=>end(true);
    poll=setInterval(()=>{analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length);const decision=vad.update(20*Math.log10(rms||1e-6),Date.now());if(decision!=='wait')end(decision==='speech');},100);
    current.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};current.onerror=()=>fail('ضبط صدای تب قطع شد؛ دوباره شروع کنید.');
    current.onstop=()=>{clearInterval(poll);finish.current=undefined;if(closed||id!==generation.current||!wanted.current)return;
     if(sending){const blob=new Blob(chunks,{type:current.mimeType||'audio/webm'}),uri=URL.createObjectURL(blob);if(latest.current.continuous)timer.current=setTimeout(listen,40);else setPhase('پردازش نوبت؛ دریافت بعدی پس از پایان بازبینی');void deliver(uri,blob.type,startedAt,Date.now());}
     else timer.current=setTimeout(listen,40);
    };
    current.start();setPhase('صدای اشتراک‌شده دریافت می‌شود؛ صفحه را برای ادامهٔ ضبط باز نگه دارید.');
    }catch{fail('شروع نوبت بعدی ضبط صدای تب ممکن نشد؛ اشتراک صدا متوقف شد. دوباره شروع کنید.');}
   }
   setActive(true);setOpening(false);latest.current.onActiveChange(true);listen();
  }catch(e){display?.getTracks().forEach(t=>t.stop());if(context?.state!=='closed')void context?.close().catch(()=>{});if(id===generation.current){stop();latest.current.onError(e instanceof Error&&e.name==='NotAllowedError'?'اشتراک صدا تأیید نشد یا لغو شد.':e instanceof Error?e.message:'دریافت صدای اشتراک‌شده ممکن نشد.');}}
 }
 return <View style={{gap:10}}><Button title={active?'پایان دریافت صدای تب':'انتخاب تب یا سیستم و شروع ترجمه'} icon={active?'stop-circle-outline':'desktop-outline'} disabled={props.disabled||opening} onPress={()=>active?stop():void start()}/>{opening&&<Button secondary small title="لغو انتظار انتخاب منبع صدا" onPress={stop}/>} {active&&<Button small secondary title="ثبت همین نوبت صدای تب" onPress={()=>finish.current?.()}/>} {!!phase&&<T style={{fontSize:12,color:C.green}}>{phase}</T>}<T style={{fontSize:12,color:C.muted}}>در پنجرهٔ مرورگر منبع و اشتراک صدا را انتخاب کنید. فقط صدا برای تشخیص گفتار فرستاده می‌شود؛ تصویر ضبط یا ارسال نمی‌شود. مرورگر ممکن است صدای پنجره یا سیستم را ارائه نکند. این حالت هنگام جابه‌جایی تب ادامه دارد؛ بستن صفحه یا Stop sharing آن را متوقف می‌کند.</T></View>;
}
