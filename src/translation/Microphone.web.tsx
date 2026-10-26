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
  const Recognition=typeof window!=='undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : undefined;
  function stop(cancel=true) {wanted.current=false;generation.current++;clearTimeout(timer.current);cleanup.current();cleanup.current=()=>{};setActive(false);latest.current.onActiveChange(false);setPhase('');latest.current.onInterim('');if(cancel)latest.current.onCancel();}
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
    setPhase('گوش می‌دهم… پس از هر عبارت مکث کنید');
    if(Recognition) {
      const recognition=new Recognition();let delivered=false;
      recognition.lang=latest.current.language==='fa'?'fa-IR':'ja-JP';recognition.continuous=true;recognition.interimResults=true;recognition.maxAlternatives=1;
      cleanup.current=()=>{recognition.onend=null;recognition.onresult=null;recognition.onerror=null;recognition.abort();};
      recognition.onresult=(event:any)=>{
        if(id!==generation.current || delivered)return;
        let interim='',final='';for(let i=event.resultIndex;i<event.results.length;i++){const result=event.results[i];if(result.isFinal)final+=result[0].transcript;else interim+=result[0].transcript;}
        latest.current.onInterim(interim);
        if(final.trim()){delivered=true;cleanup.current();latest.current.onInterim('');void deliver(()=>latest.current.onText(final.trim()),id);}
      };
      recognition.onerror=(event:any)=>{if(id!==generation.current)return;if(event.error==='no-speech' || event.error==='aborted')return;fail(event.error==='not-allowed'?'دسترسی میکروفون داده نشد؛ تنظیمات مرورگر را بررسی کنید.':'تشخیص گفتار مرورگر در دسترس نیست؛ ورودی «فایل ویس» یا مرورگر دیگری را امتحان کنید.');};
      recognition.onend=()=>{if(id===generation.current && wanted.current && !delivered && !processing.current)timer.current=setTimeout(()=>void listen(id),300);};
      try {recognition.start();}catch{fail('میکروفون آغاز نشد؛ دسترسی مرورگر را بررسی کنید.');}
      return;
    }
    if(!latest.current.audioReady){fail('این مرورگر تشخیص گفتار زنده ندارد؛ کلید تشخیص گفتار را تنظیم کنید یا از Chrome استفاده کنید.');return;}
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
  return <View style={{gap:10}}><Button title={active?'پایان مکالمهٔ زنده':'شروع مکالمهٔ زنده'} icon={active?'stop-circle-outline':'mic-outline'} disabled={props.disabled} onPress={()=>active?stop():start()}/>{!!phase&&<T style={{color:C.green,fontSize:12}}>{phase}</T>}<T style={{color:C.muted,fontSize:12}}>{Recognition?'تشخیص گفتار مرورگر؛ ممکن است صدا به سرویس مرورگر ارسال شود.':'ضبط عبارت‌های کوتاه با تشخیص مکث و ارسال به سرویس انتخابی.'}</T></View>;
}
