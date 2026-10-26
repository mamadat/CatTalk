import React,{useEffect,useRef,useState} from 'react';
import {View} from 'react-native';
import {Button,C,T} from '../ui';
import {MicrophoneProps} from './Microphone.types';
import {PauseDetector} from './vad';

export function Microphone(props:MicrophoneProps) {
  const latest=useRef(props);latest.current=props;
  const [active,setActive]=useState(false),[phase,setPhase]=useState('');
  const wanted=useRef(false),processing=useRef(false),generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const cleanup=useRef<()=>void>(()=>{});
  function stop(cancel=true) {wanted.current=false;generation.current++;clearTimeout(timer.current);cleanup.current();cleanup.current=()=>{};setActive(false);latest.current.onActiveChange(false);setPhase('');if(cancel)latest.current.onCancel();}
  useEffect(()=>{const hidden=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hidden);return()=>{document.removeEventListener('visibilitychange',hidden);wanted.current=false;generation.current++;clearTimeout(timer.current);cleanup.current();latest.current.onActiveChange(false);};},[]);
  useEffect(()=>{if(props.disabled && wanted.current)stop();},[props.disabled]);
  function fail(message:string) {stop();latest.current.onError(message);}
  async function deliver(work:()=>Promise<void>,id:number) {
    if(id!==generation.current || !wanted.current)return;
    processing.current=true;setPhase('ترجمه و پخش؛ میکروفون موقتاً متوقف است');
    try {await work();} catch(error) {if(id===generation.current)fail(error instanceof Error?error.message:'پردازش صدا ناموفق بود.');}
    finally {processing.current=false;if(id===generation.current && wanted.current)timer.current=setTimeout(()=>void listen(id),180);}
  }
  async function listen(id:number) {
    if(!wanted.current || id!==generation.current)return;
    setPhase('گوش می‌دهم… پس از ۳ ثانیه سکوت ترجمه می‌کنم');
    if(!latest.current.audioReady){fail('برای ترجمهٔ کل گفتار، کلید سرویس تشخیص گفتار انتخابی را در .env تنظیم کنید.');return;}
    let openedStream:MediaStream|undefined,openedContext:AudioContext|undefined;
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      openedStream=stream;
      if(!wanted.current || id!==generation.current){stream.getTracks().forEach(t=>t.stop());return;}
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
      const recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:32000});
      const context=new AudioContext(),source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();openedContext=context;source.connect(analyser);analyser.fftSize=1024;
      const samples=new Float32Array(analyser.fftSize),vad=new PauseDetector(Date.now()),chunks:Blob[]=[];let sending=false;
      const release=()=>{stream.getTracks().forEach(t=>t.stop());source.disconnect();void context.close().catch(()=>{});};
      const poll=setInterval(()=>{analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length);const decision=vad.update(20*Math.log10(rms || 0.000001),Date.now());if(decision!=='wait'){sending=decision==='speech';clearInterval(poll);recorder.stop();}},100);
      cleanup.current=()=>{clearInterval(poll);recorder.onstop=null;if(recorder.state!=='inactive')recorder.stop();release();};
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      recorder.onerror=()=>fail('ضبط مرورگر قطع شد؛ دوباره تلاش کنید.');
      recorder.onstop=()=>{clearInterval(poll);release();cleanup.current=()=>{};if(id!==generation.current || !wanted.current)return;
        if(!sending){timer.current=setTimeout(()=>void listen(id),100);return;}
        const blob=new Blob(chunks,{type:recorder.mimeType || 'audio/webm'}),uri=URL.createObjectURL(blob);
        void deliver(async()=>{try{await latest.current.onAudio(uri,blob.type);}finally{URL.revokeObjectURL(uri);}},id);
      };
      recorder.start();
    } catch {openedStream?.getTracks().forEach(t=>t.stop());if(openedContext?.state!=='closed')void openedContext?.close().catch(()=>{});if(id===generation.current)fail('دسترسی به میکروفون ممکن نشد؛ از localhost یا HTTPS استفاده کنید.');}
  }
  function start() {latest.current.onCancel();wanted.current=true;processing.current=false;const id=++generation.current;setActive(true);latest.current.onActiveChange(true);void listen(id);}
  return <View style={{gap:10}}><Button title={active?'پایان مکالمهٔ زنده':'شروع مکالمهٔ زنده'} icon={active?'stop-circle-outline':'mic-outline'} disabled={props.disabled} onPress={()=>active?stop():start()}/>{!!phase&&<T style={{color:C.green,fontSize:12}}>{phase}</T>}<T style={{color:C.muted,fontSize:12}}>ضبط کامل هر نوبت تا ۳ ثانیه سکوت؛ حداکثر ۲ دقیقه گفتار پیوسته. سپس کل صدا به سرویس انتخابی فرستاده می‌شود.</T></View>;
}
