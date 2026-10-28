import React,{useEffect,useRef,useState} from 'react';
import {View} from 'react-native';
import {Button,C,T} from '../ui';
import {MicrophoneProps} from './Microphone.types';
import {PauseDetector} from './vad';
import {inputLevel} from './sessions';

export function Microphone(props:MicrophoneProps) {
  const latest=useRef(props);latest.current=props;
  const [active,setActive]=useState(false),[phase,setPhase]=useState(''),[level,setLevel]=useState(-100);
  const finish=useRef<(()=>void)|undefined>(undefined);
  const wanted=useRef(false),processing=useRef(false),generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const cleanup=useRef<()=>void>(()=>{});
  function stop(cancel=true) {wanted.current=false;generation.current++;clearTimeout(timer.current);cleanup.current();cleanup.current=()=>{};finish.current=undefined;setActive(false);latest.current.onActiveChange(false);setPhase('');if(cancel)latest.current.onCancel('stop');}
  useEffect(()=>{const hidden=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hidden);return()=>{document.removeEventListener('visibilitychange',hidden);wanted.current=false;generation.current++;clearTimeout(timer.current);cleanup.current();latest.current.onActiveChange(false);};},[]);
  useEffect(()=>{if(props.disabled && wanted.current)stop();},[props.disabled]);
  function fail(message:string) {stop();latest.current.onError(message);}
  async function deliver(work:()=>Promise<void>,id:number) {
    if(id!==generation.current || !wanted.current)return;
    processing.current=true;if(!latest.current.continuous)setPhase('ترجمه و پخش؛ میکروفون موقتاً متوقف است');
    try {await work();} catch(error) {if(id===generation.current)fail(error instanceof Error?error.message:'پردازش صدا ناموفق بود.');}
    finally {processing.current=false;if(!latest.current.continuous&&id===generation.current && wanted.current)timer.current=setTimeout(()=>void listen(id),180);}
  }
  async function listen(id:number) {
    if(!wanted.current || id!==generation.current)return;
    setPhase('گوش می‌دهم… پس از ۳ ثانیه سکوت ترجمه می‌کنم');
    if(!latest.current.audioReady){fail('ابتدا موتور تشخیص گفتار انتخابی را آماده کنید؛ موتور محلی به نصب مدل نیاز دارد.');return;}
    let openedStream:MediaStream|undefined,openedContext:AudioContext|undefined;
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      openedStream=stream;
      if(!wanted.current || id!==generation.current){stream.getTracks().forEach(t=>t.stop());return;}
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
      const recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:32000});
      const context=new AudioContext(),source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();openedContext=context;source.connect(analyser);analyser.fftSize=1024;
      const startedAt=Date.now(),samples=new Float32Array(analyser.fftSize),vad=new PauseDetector(startedAt),chunks:Blob[]=[];let sending=false,lastMeter=0;
      const release=()=>{stream.getTracks().forEach(t=>t.stop());source.disconnect();void context.close().catch(()=>{});};
      const poll=setInterval(()=>{analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length),db=20*Math.log10(rms || 0.000001);if(Date.now()-lastMeter>300){setLevel(db);lastMeter=Date.now();}const decision=vad.update(db,Date.now());if(decision!=='wait'){sending=decision==='speech';clearInterval(poll);recorder.stop();}},100);
      finish.current=()=>{if(recorder.state!=='inactive'){sending=true;clearInterval(poll);recorder.stop();}};
      cleanup.current=()=>{clearInterval(poll);recorder.onstop=null;if(recorder.state!=='inactive')recorder.stop();release();};
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      recorder.onerror=()=>fail('ضبط مرورگر قطع شد؛ دوباره تلاش کنید.');
      recorder.onstop=()=>{const endedAt=Date.now();finish.current=undefined;clearInterval(poll);release();cleanup.current=()=>{};if(id!==generation.current || !wanted.current)return;
        if(!sending){timer.current=setTimeout(()=>void listen(id),100);return;}
        const blob=new Blob(chunks,{type:recorder.mimeType || 'audio/webm'}),uri=URL.createObjectURL(blob);
        if(latest.current.continuous)timer.current=setTimeout(()=>void listen(id),80);
        void deliver(async()=>{try{await latest.current.onAudio(uri,blob.type,{startedAt,endedAt});}finally{URL.revokeObjectURL(uri);}},id);
      };
      recorder.start();
    } catch {openedStream?.getTracks().forEach(t=>t.stop());if(openedContext?.state!=='closed')void openedContext?.close().catch(()=>{});if(id===generation.current)fail('دسترسی به میکروفون ممکن نشد؛ از localhost یا HTTPS استفاده کنید.');}
  }
  function start() {latest.current.onCancel('start');wanted.current=true;processing.current=false;const id=++generation.current;setActive(true);latest.current.onActiveChange(true);void listen(id);}
  return <View style={{gap:10}}><Button title={active?'پایان مکالمهٔ زنده':'شروع مکالمهٔ زنده'} icon={active?'stop-circle-outline':'mic-outline'} disabled={props.disabled} onPress={()=>active?stop():start()}/>{active&&<><Button small secondary title="ترجمهٔ همین عبارت" onPress={()=>finish.current?.()}/><T testID="microphone-level" style={{fontSize:12,color:inputLevel(level)==='loud'?C.danger:C.muted}}>شدت ورودی: {Math.round(level)} dB · {inputLevel(level)==='weak'?'کم یا سکوت':inputLevel(level)==='loud'?'زیاد؛ میکروفون را دورتر بگیرید':'صدا دریافت می‌شود'} · شاخص شدت، تضمین وضوح گفتار نیست.</T></>}{!!phase&&<T style={{color:C.green,fontSize:12}}>{phase}</T>}<T style={{color:C.muted,fontSize:12}}>ضبط کامل هر نوبت تا ۳ ثانیه سکوت؛ حداکثر ۲ دقیقه گفتار پیوسته. {props.continuous?'پس از هر نوبت، ضبط بعدی هم‌زمان با پردازش ادامه می‌یابد؛ در مرز نوبت‌ها وقفهٔ کوتاه ضبط وجود دارد.':'سپس کل صدا به سرویس انتخابی فرستاده می‌شود.'} پایان مکالمه، عبارتِ هنوز ثبت‌نشده را کنار می‌گذارد؛ ابتدا «ترجمهٔ همین عبارت» را بزنید.</T></View>;
}
