import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,AppState,Switch,View} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {Language,TranslationRequest,TranslationStatus} from '../../shared/translation';
import {MAX_AUDIO_BYTES,STTProvider,VoiceEngine,sttNames,speechNames} from '../../shared/voice';
import {Button,C,Card,Chips,s,T} from '../ui';
import {createTranslationTransport} from './client';
import {Microphone} from './Microphone';
import {readVoiceFile,removeVoiceTemp} from './voiceFiles';
import {transcribeVoice} from './voiceClient';
import {createSpeechSession,deviceVoice} from './speech';
import {emptyVoiceState,SentenceBuffer,VoiceTurnController} from './voiceController';

export function VoicePanel({url,token,status,request,ready}:{url:string;token:string;status?:TranslationStatus;request:TranslationRequest;ready:boolean}) {
  const [showSettings,setShowSettings]=useState(false);
  const [input,setInput]=useState<'microphone'|'file'>('microphone');const [stt,setStt]=useState<STTProvider>('groq');const [engine,setEngine]=useState<VoiceEngine>('device');const [voiceMode,setVoiceMode]=useState<'fast'|'balanced'>('fast');
  const [autoplay,setAutoplay]=useState(true),[live,setLive]=useState(emptyVoiceState),[interim,setInterim]=useState(''),[error,setError]=useState(''),[picking,setPicking]=useState(false),[micActive,setMicActive]=useState(false),[reset,setReset]=useState(0),[replaying,setReplaying]=useState(false);
  const [localVoice,setLocalVoice]=useState<string|undefined>();const replay=useRef<AbortController|undefined>(undefined);const fileGeneration=useRef(0);
  const controller=useMemo(()=>new VoiceTurnController(createTranslationTransport(url,token),(signal,onStart)=>createSpeechSession({engine,language:request.target,url,token,enabled:autoplay},signal,onStart),setLive),[url,token,engine,request.source,request.target,request.provider,request.tone,request.context,autoplay,stt,voiceMode]);
  useEffect(()=>{setLive(emptyVoiceState);setError('');return()=>{fileGeneration.current++;controller.stop();replay.current?.abort();};},[controller]);
  useEffect(()=>{let alive=true;setLocalVoice(undefined);void deviceVoice(request.target).then(v=>{if(alive)setLocalVoice(v?.name || '');}).catch(()=>{if(alive)setLocalVoice('');});return()=>{alive=false;};},[request.target]);
  function cancel() {fileGeneration.current++;controller.stop();replay.current?.abort();setReplaying(false);setInterim('');setLive(value=>({...value,phase:'idle',error:undefined}));}
  function stopAll() {cancel();setReset(v=>v+1);setMicActive(false);}
  useEffect(()=>{const sub=AppState.addEventListener('change',next=>{if(next!=='active')stopAll();});return()=>sub.remove();},[controller]);
  const sttReady=!!status?.voice?.transcription[stt]?.configured;
  const speechReady=engine==='device' || !!status?.voice?.speech.gemini.configured;
  async function runTranscript(text:string) {setError('');await controller.run({...request,mode:voiceMode},async()=>text);}
  async function runAudio(uri:string,mimeType:string) {
    setError('');await controller.run({...request,mode:voiceMode},async signal=>{
      const audio=await readVoiceFile(uri);if(signal.aborted)throw new DOMException('Aborted','AbortError');
      if(audio.size>MAX_AUDIO_BYTES)throw new Error('حداکثر حجم ویس ۶ مگابایت است.');
      return transcribeVoice(url,token,{provider:stt,language:request.source,mimeType,audioBase64:audio.base64},signal);
    });
  }
  async function pick() {
    cancel();setError('');setPicking(true);const generation=fileGeneration.current;
    try {
      const result=await DocumentPicker.getDocumentAsync({type:'audio/*',copyToCacheDirectory:true,multiple:false,base64:false});
      if(result.canceled)return;const asset=result.assets[0];
      try {
        if(generation!==fileGeneration.current)return;
        if((asset.size || 0)>MAX_AUDIO_BYTES)throw new Error('حداکثر حجم ویس ۶ مگابایت است.');
        const extension=asset.name.split('.').pop()?.toLowerCase();const types:Record<string,string>={mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',webm:'audio/webm',flac:'audio/flac',aac:'audio/aac'};
        await runAudio(asset.uri,asset.mimeType || types[extension || ''] || 'application/octet-stream');
      } finally {await removeVoiceTemp(asset.uri).catch(()=>{});}
    } catch(e) {if(generation===fileGeneration.current)setError(e instanceof Error?e.message:'خواندن ویس ناموفق بود.');}
    finally {setPicking(false);}
  }
  async function playAgain() {
    cancel();setError('');setReplaying(true);const abort=new AbortController();replay.current=abort;
    const session=createSpeechSession({engine,language:request.target,url,token,enabled:true},abort.signal,()=>{});
    try {for(const sentence of new SentenceBuffer().push(live.translation,true))session.enqueue(sentence);await session.drain();}
    catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'پخش انجام نشد.');}
    finally {if(replay.current===abort){setReplaying(false);replay.current=undefined;}}
  }
  const busy=['transcribing','translating','speaking'].includes(live.phase);
  const phases={idle:'آمادهٔ دریافت صدا',transcribing:'تبدیل گفتار به متن…',translating:'ترجمهٔ زنده…',speaking:'در حال تکمیل پخش…',done:'ترجمهٔ صوتی کامل شد',error:'ترجمهٔ صوتی کامل نشد'};
  return <Card style={{backgroundColor:'#EEF3E9'}}>
    <T style={s.subtitle}>بگو، ترجمه‌اش را بشنو</T>
    <Chips options={{microphone:'میکروفون زنده',file:'ارسال فایل ویس'}} value={input} onChange={value=>{stopAll();setInput(value);}}/>
    <T style={s.muted}>جهت گفتار از زبان‌های انتخاب‌شده در بالا پیروی می‌کند. پس از هر عبارت کوتاه مکث کنید؛ هنگام پخش، شنیدن موقتاً متوقف می‌شود.</T>
    <Button small secondary title={showSettings?'بستن تنظیمات صدا':'تنظیمات تشخیص گفتار و صدا'} onPress={()=>setShowSettings(value=>!value)}/>
    {showSettings&&<>    <Chips options={{fast:'کمترین تأخیر',balanced:'متعادل'}} value={voiceMode} onChange={value=>{stopAll();setVoiceMode(value);}}/>
    <T style={{fontWeight:'700'}}>تشخیص گفتار فایل و ضبط</T><Chips options={sttNames} value={stt} onChange={value=>{stopAll();setStt(value);}}/>
    <T style={s.muted}>{sttReady?'کلید تشخیص گفتار تنظیم شده است.':`برای فایل ویس و ضبط، ${stt.toUpperCase()}_API_KEY را در .env تنظیم کنید.`}</T>
    <T style={{fontWeight:'700'}}>صدای ترجمه</T><Chips options={speechNames} value={engine} onChange={value=>{stopAll();setEngine(value);}}/>
    <T style={s.muted}>{engine==='device' ? localVoice ? `صدای آماده: ${localVoice}` : localVoice==='' ? 'صدای این زبان روی دستگاه پیدا نشد؛ بستهٔ صدای زبان را نصب کنید یا Gemini را انتخاب کنید.' : 'در حال بررسی صدای دستگاه…' : 'متن ترجمه برای تولید صدا به Gemini ارسال می‌شود؛ کلید و سهمیهٔ جداگانهٔ مدل صوتی لازم است.'}</T>
    <View style={s.row}><Switch accessibilityLabel="پخش خودکار ترجمهٔ صوتی" value={autoplay} onValueChange={value=>{stopAll();setAutoplay(value);}}/><T style={s.muted}>پخش خودکار جمله‌های آماده</T></View>
    </>}
    {!showSettings&&<T style={s.muted}>{engine==='device'?'پخش با صدای دستگاه':'پخش با صدای Gemini'} · {voiceMode==='fast'?'حالت سریع':'حالت متعادل'}{input==='file'&&!sttReady?` · کلید ${stt.toUpperCase()} تنظیم نشده`:''}</T>}
    {!showSettings&&engine==='device'&&localVoice===''&&<T style={s.muted}>صدای این زبان نصب نیست؛ از تنظیمات صدا Gemini را انتخاب کنید یا بستهٔ صدای زبان را نصب کنید.</T>}
    {input==='microphone' ? <Microphone key={`${request.source}-${request.provider}-${stt}-${engine}-${autoplay}-${reset}`} language={request.source} disabled={!ready || (autoplay&&!speechReady) || picking || replaying} audioReady={sttReady} onText={runTranscript} onAudio={runAudio} onInterim={setInterim} onCancel={cancel} onError={setError} onActiveChange={setMicActive}/> : <><Button title={picking?'در حال پردازش ویس…':'انتخاب و ترجمهٔ ویس'} icon="attach-outline" disabled={!ready || !sttReady || (autoplay&&!speechReady) || picking || micActive || replaying} onPress={()=>void pick()}/><T style={s.muted}>MP3، M4A، WAV، OGG، WebM · حداکثر ۶ مگابایت؛ برای سرعت بهتر ویس کوتاه بفرستید.</T></>}
    {!!interim&&<T testID="voice-interim" style={s.muted}>در حال شنیدن: {interim}</T>}
    <View style={s.row}>{busy&&<ActivityIndicator color={C.green}/>}<T style={{color:C.green,fontSize:12}}>{phases[live.phase]}</T></View>
    {!!live.transcript&&<><T style={{fontWeight:'700'}}>گفتار شنیده‌شده</T><T testID="voice-transcript" selectable style={{textAlign:request.source==='fa'?'right':'left'}}>{live.transcript}</T></>}
    {!!live.translation&&<><T style={{fontWeight:'700'}}>ترجمهٔ گفتار</T><T testID="voice-translation" selectable style={{fontSize:18,lineHeight:31,textAlign:request.target==='fa'?'right':'left'}}>{live.translation}</T></>}
    {live.firstTextMs!==undefined&&<T style={{fontSize:11,color:C.muted}}>اولین متن: {(live.firstTextMs/1000).toLocaleString('fa-IR',{maximumFractionDigits:1})} ثانیه{live.firstAudioMs!==undefined?` · اولین صدا: ${(live.firstAudioMs/1000).toLocaleString('fa-IR',{maximumFractionDigits:1})} ثانیه`:''} از شروع پردازش عبارت</T>}
    {!!(error || live.error)&&<T accessibilityRole="alert" style={{color:C.danger,fontSize:13}}>{error || live.error}{live.translation&&live.phase==='error'?' بخشی از ترجمه ممکن است قبلاً پخش شده باشد.':''}</T>}
    <View style={s.row}><View style={{flex:1}}><Button small secondary title="توقف همهٔ صداها" onPress={stopAll}/></View><View style={{flex:1}}><Button small secondary title={replaying?'در حال پخش…':'پخش دوبارهٔ ترجمه'} disabled={!live.translation || busy || micActive || replaying || !speechReady} icon="volume-high-outline" onPress={()=>void playAgain()}/></View></View>
    <T style={{fontSize:11,color:C.muted}}>فایل و ضبط برای تشخیص گفتار به سرویس انتخابی ارسال می‌شوند و در دفترچه ذخیره نمی‌شوند. صدای دستگاه به موتور گفتار سیستم وابسته است.</T>
  </Card>;
}
