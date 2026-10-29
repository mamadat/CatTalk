import React,{useEffect,useRef,useState} from 'react';
import {View} from 'react-native';
import {AudioClip} from './domain';
import {persistAudio} from './audioFiles';
import {pauseCurrentAudio} from './Playback';
import {Button,C,T} from './ui';
export {Playback} from './Playback';

/** Own the browser stream so cancellation also releases a late permission grant. */
export function Recorder({onRecorded,onBusy,title='شروع ضبط',maxSeconds=20}:{onRecorded:(clip:AudioClip)=>Promise<void>;onBusy?:(busy:boolean)=>void;title?:string;maxSeconds?:number}){
 const latest=useRef({onRecorded,onBusy});latest.current={onRecorded,onBusy};
 const [phase,setPhase]=useState<'idle'|'opening'|'recording'|'saving'>('idle'),[seconds,setSeconds]=useState(0),[error,setError]=useState('');
 const mounted=useRef(true),generation=useRef(0),locked=useRef(false),opening=useRef(false),recorder=useRef<MediaRecorder|undefined>(undefined),stream=useRef<MediaStream|undefined>(undefined),started=useRef(0),timers=useRef<{poll?:ReturnType<typeof setInterval>;end?:ReturnType<typeof setTimeout>}>({});
 const actions=useRef({stop:()=>{},cancel:()=>{}});
 function release(){clearInterval(timers.current.poll);clearTimeout(timers.current.end);stream.current?.getTracks().forEach(t=>t.stop());stream.current=undefined;recorder.current=undefined;}
 function cancel(){generation.current++;opening.current=false;const current=recorder.current;if(current){current.onstop=null;if(current.state!=='inactive')current.stop();}release();locked.current=false;if(mounted.current)setPhase('idle');latest.current.onBusy?.(false);}
 useEffect(()=>{mounted.current=true;const hidden=()=>{if(document.hidden){if(recorder.current?.state==='recording')actions.current.stop();else if(opening.current)actions.current.cancel();}};document.addEventListener('visibilitychange',hidden);return()=>{mounted.current=false;document.removeEventListener('visibilitychange',hidden);actions.current.cancel();};},[]);
 function stop(){if(recorder.current?.state==='recording'){clearInterval(timers.current.poll);clearTimeout(timers.current.end);setPhase('saving');recorder.current.stop();}}
 actions.current={stop,cancel};
 async function start(){
  if(locked.current)return;locked.current=true;opening.current=true;const id=++generation.current;setError('');setPhase('opening');latest.current.onBusy?.(true);
  let opened:MediaStream|undefined;
  try{
   pauseCurrentAudio();opened=await navigator.mediaDevices.getUserMedia({audio:true});if(!mounted.current||id!==generation.current){opened.getTracks().forEach(t=>t.stop());return;}opening.current=false;stream.current=opened;
   const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
   const capture=new MediaRecorder(opened,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:128000}),chunks:Blob[]=[];recorder.current=capture;
   capture.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
   capture.onerror=()=>{if(id===generation.current){cancel();setError('ضبط مرورگر قطع شد؛ دوباره تلاش کنید.');}};
   capture.onstop=()=>{const duration=Math.min(maxSeconds,(Date.now()-started.current)/1000);release();if(!mounted.current||id!==generation.current)return;
    void (async()=>{let uri='';try{if(duration<1)throw new Error('ضبط خیلی کوتاه بود؛ دست‌کم یک ثانیه ضبط کنید.');uri=URL.createObjectURL(new Blob(chunks,{type:capture.mimeType||'audio/webm'}));const saved=await persistAudio(uri);if(mounted.current&&id===generation.current)await latest.current.onRecorded({uri:saved,seconds:duration});}
     catch(e){if(mounted.current&&id===generation.current)setError(e instanceof Error?e.message:'ذخیرهٔ صدا ناموفق بود.');}
     finally{if(uri)URL.revokeObjectURL(uri);if(id===generation.current){locked.current=false;if(mounted.current)setPhase('idle');latest.current.onBusy?.(false);}}
    })();
   };
   capture.start();started.current=Date.now();setSeconds(0);setPhase('recording');timers.current.poll=setInterval(()=>setSeconds((Date.now()-started.current)/1000),150);timers.current.end=setTimeout(stop,maxSeconds*1000);
  }catch(e){opened?.getTracks().forEach(t=>t.stop());if(mounted.current&&id===generation.current){cancel();setError('ضبط آغاز نشد؛ مجوز میکروفون و استفاده از HTTPS یا localhost را بررسی کنید.');}}
 }
 return <View style={{gap:14}}><View style={{height:52,flexDirection:'row',justifyContent:'center',alignItems:'center',gap:4}}>{Array.from({length:27},(_,i)=><View key={i} style={{width:5,borderRadius:4,backgroundColor:phase==='recording'?C.green:'#C9DAD0',height:phase==='recording'?8+33*(0.3+(i%7)/8):8+Math.sin(i*1.7)**2*24}}/>)}</View><T style={{textAlign:'center',color:C.muted,fontSize:12}}>{phase==='recording'?`در حال ضبط · ${Math.floor(seconds).toLocaleString('fa-IR')} ثانیه`:`حداکثر ${maxSeconds.toLocaleString('fa-IR')} ثانیه · ذخیره فقط روی دستگاه`}</T><Button disabled={phase==='opening'||phase==='saving'} title={phase==='opening'||phase==='saving'?'در حال آماده‌سازی…':phase==='recording'?'پایان و ذخیرهٔ ضبط':title} icon={phase==='recording'?'stop-circle-outline':'mic-outline'} onPress={()=>phase==='recording'?stop():void start()}/>{phase==='opening'&&<Button secondary small title="لغو انتظار مجوز ضبط" onPress={cancel}/>} {!!error&&<T accessibilityRole="alert" style={{color:C.danger,fontSize:13}}>{error}</T>}</View>;
}
