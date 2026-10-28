import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,AppState,Switch,TextInput,View} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {Language,TranslationRequest,TranslationStatus,localProviders} from '../../shared/translation';
import {MAX_AUDIO_BYTES,STTProvider,VoiceEngine,sttNames,speechNames} from '../../shared/voice';
import {Button,C,Card,Chips,s,T} from '../ui';
import {Transport} from './controller';
import {Microphone} from './Microphone';
import {readVoiceFile,removeVoiceTemp} from './voiceFiles';
import {transcribeVoice} from './voiceClient';
import {createSpeechSession,deviceVoice} from './speech';
import {QualityReview} from './QualityReview';
import {PreferencesAPI} from './preferences';
import {SavePhraseButton} from './SavePhraseButton';
import {spokenHints} from './sessions';
import {emptyVoiceState,SentenceBuffer,VoiceTurnController} from './voiceController';

export function VoicePanel({url,token,status,request,ready,transport,preferences,onDirectionChange}:{preferences:PreferencesAPI;onDirectionChange:(language:Language)=>void;url:string;token:string;status?:TranslationStatus;request:TranslationRequest;ready:boolean;transport:Transport}) {
  const [showSettings,setShowSettings]=useState(false);
  const [input,setInput]=useState<'microphone'|'file'>('microphone');const [stt,setStt]=useState<STTProvider>('groq');const [engine,setEngine]=useState<VoiceEngine>('device');const [voiceMode,setVoiceMode]=useState<'fast'|'balanced'>('balanced');
  const [autoplay,setAutoplay]=useState(true),[live,setLive]=useState(emptyVoiceState),[error,setError]=useState(''),[picking,setPicking]=useState(false),[micActive,setMicActive]=useState(false),[reset,setReset]=useState(0),[replaying,setReplaying]=useState(false);
  const [reviewEnabled,setReviewEnabled]=useState(false),[pauseOnWarnings,setPauseOnWarnings]=useState(true),[editedTranscript,setEditedTranscript]=useState('');
  const [facing,setFacing]=useState(false),[speechRate,setSpeechRate]=useState<'slow'|'normal'|'quick'>('normal'),[recognition,setRecognition]=useState<'fast'|'accurate'>('fast'),[useHints,setUseHints]=useState(false);
  const hints=useHints?spokenHints(request.source,preferences.data.terms):[];const hintsIdentity=JSON.stringify(hints);const rate={slow:.8,normal:1,quick:1.1}[speechRate];
  const reviewer=useRef<((text:string)=>void)|undefined>(undefined);
  useEffect(()=>{setEditedTranscript(live.transcript);},[live.transcript]);
  const [localVoice,setLocalVoice]=useState<string|undefined>();const replay=useRef<AbortController|undefined>(undefined);const fileGeneration=useRef(0);
  const controller=useMemo(()=>new VoiceTurnController(transport,(signal,onStart)=>createSpeechSession({engine,language:request.target,url,token,enabled:autoplay,rate},signal,onStart),setLive),[transport,url,token,engine,request.source,request.target,request.provider,request.tone,request.context,autoplay,stt,voiceMode,reviewEnabled,pauseOnWarnings,speechRate,recognition,hintsIdentity]);
  useEffect(()=>{setLive(emptyVoiceState);setError('');return()=>{fileGeneration.current++;controller.stop();replay.current?.abort();};},[controller]);
  useEffect(()=>{let alive=true;setLocalVoice(undefined);void deviceVoice(request.target).then(v=>{if(alive)setLocalVoice(v?.name || '');}).catch(()=>{if(alive)setLocalVoice('');});return()=>{alive=false;};},[request.target]);
  function cancel() {fileGeneration.current++;controller.stop();replay.current?.abort();setReplaying(false);setLive(value=>({...value,phase:'idle',error:undefined}));}
  function stopAll() {cancel();setReset(v=>v+1);setMicActive(false);}
  useEffect(()=>{const sub=AppState.addEventListener('change',next=>{if(next!=='active')stopAll();});return()=>sub.remove();},[controller]);
  const sttChosen=useRef(false);
  useEffect(()=>{if(sttChosen.current||!status?.voice)return;if(status.voice.transcription.whisperlocal?.configured&&!status.voice.transcription.groq?.configured)setStt('whisperlocal');sttChosen.current=true;},[status?.voice]);
  const sttStatus=status?.voice?.transcription[stt];const localStt=stt==='whisperlocal';const sttReady=!!sttStatus?.configured&&sttStatus.availableModes?.[recognition]!==false;
  const speechReady=engine==='device' || !!status?.voice?.speech.gemini.configured;
  async function runAudio(uri:string,mimeType:string) {
    setError('');await controller.run({...request,mode:voiceMode},async signal=>{
      const audio=await readVoiceFile(uri);if(signal.aborted)throw new DOMException('Aborted','AbortError');
      if(audio.size>MAX_AUDIO_BYTES)throw new Error('حداکثر حجم ویس ۶ مگابایت است.');
      return transcribeVoice(url,token,{provider:stt,language:request.source,mimeType,audioBase64:audio.base64,recognition,...(hints.length?{hints}:{})},signal);
    },{review:reviewEnabled?reviewTranscript:undefined,pauseOnWarnings});
  }
  function reviewTranscript(text:string,signal:AbortSignal):Promise<string> {
    setEditedTranscript(text);return new Promise((resolve,reject)=>{const cancel=()=>{reviewer.current=undefined;reject(new DOMException('Aborted','AbortError'));};signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return;}reviewer.current=value=>{signal.removeEventListener('abort',cancel);reviewer.current=undefined;resolve(value);};});
  }
  async function translateCorrection(){stopAll();setError('');try{await controller.run({...request,mode:voiceMode},async()=>editedTranscript,{pauseOnWarnings});}catch(e){setError(e instanceof Error?e.message:'ترجمه انجام نشد.');}}
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
    const session=createSpeechSession({engine,language:request.target,url,token,enabled:true,rate},abort.signal,()=>{});
    try {for(const sentence of new SentenceBuffer().push(live.translation,true))session.enqueue(sentence);await session.drain();}
    catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'پخش انجام نشد.');}
    finally {if(replay.current===abort){setReplaying(false);replay.current=undefined;}}
  }
  const busy=['transcribing','reviewing','translating','speaking'].includes(live.phase);
  const phases={idle:'آمادهٔ دریافت صدا',transcribing:'تبدیل گفتار به متن…',reviewing:'منتظر بازبینی متن ویس',translating:'ترجمهٔ زنده…',speaking:'در حال تکمیل پخش…',done:'ترجمهٔ صوتی کامل شد',error:'ترجمهٔ صوتی کامل نشد'};
  return <Card style={{backgroundColor:'#EEF3E9'}}>
    <T style={s.subtitle}>بگو، ترجمه‌اش را بشنو</T>
    {request.provider&&localProviders.includes(request.provider)&&<T style={s.muted}>ترجمهٔ متن با موتور محلی رایگان است؛ برای تشخیص گفتار بدون کلید، Faster Whisper محلی را انتخاب کنید؛ نصب اولیهٔ Python و مدل لازم است. صدای دستگاه کلید نمی‌خواهد.</T>}
    <Chips options={{microphone:'میکروفون زنده',file:'ارسال فایل ویس'}} value={input} onChange={value=>{stopAll();setInput(value);}}/>
    <T style={s.muted}>کل گفتار تا ۳ ثانیه سکوت جمع می‌شود، سپس یک‌جا ترجمه می‌شود. پخش پس از کامل‌شدن ترجمه آغاز می‌شود؛ هنگام ترجمه و پخش، میکروفون مکث می‌کند.</T>
    <T style={{fontWeight:'700'}}>موتور تشخیص گفتار</T><Chips options={sttNames} value={stt} onChange={value=>{sttChosen.current=true;stopAll();setStt(value);}}/>
    <T testID="stt-status" style={s.muted}>{localStt?`کاملاً رایگان در اجرای محلی؛ صدا به سرویس ابری ارسال نمی‌شود. ${sttStatus?.message||'Start-LocalVoice.ps1 را اجرا و «بررسی دوباره» را بزنید.'}${sttStatus?.configured&&!sttReady?' مدل این حالت نصب نشده است.':''}`:sttReady?'کلید تشخیص گفتار تنظیم شده است.':`برای فایل ویس و ضبط، ${stt.toUpperCase()}_API_KEY را در .env تنظیم کنید.`}</T>
    {localStt&&<T style={s.muted}>{recognition==='accurate'?sttStatus?.qualityModel:sttStatus?.model} · اجرا روی رایانهٔ سرور، نه داخل گوشی؛ شروع سرد و سخت‌افزار روی تأخیر اثر دارند.</T>}
    <Button small secondary title={showSettings?'بستن تنظیمات صدا':'تنظیمات تشخیص گفتار و صدا'} onPress={()=>setShowSettings(value=>!value)}/>
    {showSettings&&<>    <Chips options={{fast:'کمترین تأخیر',balanced:'متعادل'}} value={voiceMode} onChange={value=>{stopAll();setVoiceMode(value);}}/>
    
    
    {(stt==='groq'||localStt)&&<Chips options={localStt?{fast:'محلی سریع‌تر',accurate:'محلی با جستجوی بیشتر'}:{fast:'Whisper سریع',accurate:'Whisper کامل'}} value={recognition} onChange={value=>{stopAll();setRecognition(value);}}/>}
    <View style={s.row}><Switch accessibilityLabel="راهنمای نام‌ها برای تشخیص گفتار ویس" value={useHints} onValueChange={value=>{stopAll();setUseHints(value);}}/><T style={s.muted}>نام‌های کوتاه همین زبان از واژه‌نامه به STT فرستاده شوند</T></View>{useHints&&<T style={s.muted}>{hints.join('، ')||'نام کوتاه قابل ارسال وجود ندارد.'}؛ فقط راهنمای املای گفتار شنیده‌شده، بدون جایگزینی خودکار.</T>}
    <T style={{fontWeight:'700'}}>سرعت پخش صدا</T><Chips options={{slow:'آهسته',normal:'معمولی',quick:'کمی سریع‌تر'}} value={speechRate} onChange={value=>{stopAll();setSpeechRate(value);}}/>
    <T style={{fontWeight:'700'}}>صدای ترجمه</T><Chips options={speechNames} value={engine} onChange={value=>{stopAll();setEngine(value);}}/>
    <T style={s.muted}>{engine==='device' ? localVoice ? `صدای آماده: ${localVoice}` : localVoice==='' ? 'صدای این زبان روی دستگاه پیدا نشد؛ بستهٔ صدای زبان را نصب کنید یا Gemini را انتخاب کنید.' : 'در حال بررسی صدای دستگاه…' : 'متن ترجمه برای تولید صدا به Gemini ارسال می‌شود؛ کلید و سهمیهٔ جداگانهٔ مدل صوتی لازم است.'}</T>
    <View style={s.row}><Switch accessibilityLabel="پخش خودکار ترجمهٔ صوتی" value={autoplay} onValueChange={value=>{stopAll();setAutoplay(value);}}/><T style={s.muted}>پخش خودکار پس از تکمیل ترجمه</T></View>
    <View style={s.row}><Switch accessibilityLabel="بازبینی متن ویس پیش از ترجمه" value={reviewEnabled} onValueChange={value=>{stopAll();setReviewEnabled(value);}}/><T style={s.muted}>متن شنیده‌شده را پیش از ترجمه تأیید کنم</T></View>
    <View style={s.row}><Switch accessibilityLabel="توقف پخش هنگام هشدار عدد یا لینک" value={pauseOnWarnings} onValueChange={value=>{stopAll();setPauseOnWarnings(value);}}/><T style={s.muted}>در هشدار عدد یا لینک، پخش خودکار متوقف شود</T></View>
    </>}
    {!showSettings&&<T style={s.muted}>{engine==='device'?'پخش با صدای دستگاه':'پخش با صدای Gemini'} · {voiceMode==='fast'?'حالت سریع':'حالت متعادل'}{!sttReady?(localStt?' · موتور محلی این حالت آماده نیست':` · کلید ${stt.toUpperCase()} تنظیم نشده`):''}</T>}
    {!showSettings&&engine==='device'&&localVoice===''&&<T style={s.muted}>صدای این زبان نصب نیست؛ از تنظیمات صدا Gemini را انتخاب کنید یا بستهٔ صدای زبان را نصب کنید.</T>}
    <View style={s.row}><Switch accessibilityLabel="نمای رو‌به‌رو برای گفتگوی دو نفره" value={facing} onValueChange={setFacing}/><T style={s.muted}>نمای رو‌به‌رو · فارسی / 日本語</T></View>
    {facing&&<><View style={{transform:[{rotate:'180deg'}],backgroundColor:C.paper,padding:16,borderRadius:16,minHeight:125}}><T style={s.muted}>日本語</T><T testID="facing-japanese" selectable style={{fontSize:23,lineHeight:38,textAlign:'left'}}>{(request.source==='ja'?live.transcript:live.translation)||'翻訳がここに表示されます。'}</T><Button small secondary title="日本語で話す · گویندهٔ ژاپنی" onPress={()=>{stopAll();onDirectionChange('ja');}}/></View><View style={{backgroundColor:C.mint,padding:16,borderRadius:16,minHeight:125}}><T style={s.muted}>فارسی</T><T testID="facing-persian" selectable style={{fontSize:23,lineHeight:38}}>{(request.source==='fa'?live.transcript:live.translation)||'متن فارسی اینجا نمایش داده می‌شود.'}</T><Button small secondary title="فارسی صحبت می‌کنم · گویندهٔ فارسی" onPress={()=>{stopAll();onDirectionChange('fa');}}/></View><T style={s.muted}>نوبتی صحبت کنید. تغییر گوینده ضبط و پردازش فعلی را متوقف می‌کند؛ بعد از انتخاب زبان، شروع مکالمه را بزنید.</T></>}
    {input==='microphone' ? <Microphone key={`${request.source}-${request.provider}-${stt}-${engine}-${autoplay}-${reset}`} language={request.source} disabled={!ready || !sttReady || (autoplay&&!speechReady) || picking || replaying} audioReady={sttReady} onAudio={runAudio} onCancel={cancel} onError={setError} onActiveChange={setMicActive}/> : <><Button title={picking?'در حال پردازش ویس…':'انتخاب و ترجمهٔ ویس'} icon="attach-outline" disabled={!ready || !sttReady || (autoplay&&!speechReady) || picking || micActive || replaying} onPress={()=>void pick()}/><T style={s.muted}>MP3، M4A، WAV، OGG، WebM · حداکثر ۶ مگابایت؛ برای سرعت بهتر ویس کوتاه بفرستید.</T></>}
    <View style={s.row}>{busy&&<ActivityIndicator color={C.green}/>}<T style={{color:C.green,fontSize:12}}>{phases[live.phase]}</T></View>
    {!!live.transcript&&<><T style={{fontWeight:'700'}}>گفتار شنیده‌شده</T><T testID="voice-transcript" selectable style={{textAlign:request.source==='fa'?'right':'left'}}>{live.transcript}</T></>}
    {!!live.transcript&&<><TextInput accessibilityLabel="اصلاح متن شنیده‌شدهٔ ویس" value={editedTranscript} onChangeText={setEditedTranscript} maxLength={2000} multiline style={[s.input,{minHeight:85,textAlign:request.source==='fa'?'right':'left'}]}/>{live.phase==='reviewing'?<Button title="تأیید متن ویس و ترجمه" disabled={!editedTranscript.trim()} onPress={()=>reviewer.current?.(editedTranscript)}/>:<Button small secondary title="ترجمهٔ متن اصلاح‌شده بدون ضبط دوباره" disabled={busy||micActive||!editedTranscript.trim()||!ready} onPress={()=>void translateCorrection()}/>}</>}
    {!!live.translation&&<><T style={{fontWeight:'700'}}>ترجمهٔ گفتار</T><T testID="voice-translation" selectable style={{fontSize:18,lineHeight:31,textAlign:request.target==='fa'?'right':'left'}}>{live.translation}</T></>}
    {!!live.translation&&live.phase==='done'&&<><QualityReview source={live.transcript} target={live.translation}/><SavePhraseButton preferences={preferences} source={request.source} target={request.target} original={live.transcript} translated={live.translation}/></>}
    {live.pausedForReview&&<T style={{color:C.danger}}>پخش خودکار به‌دلیل هشدار متوقف شد؛ متن را بررسی کنید و در صورت تأیید «پخش دوبارهٔ ترجمه» را بزنید.</T>}
    {live.firstTextMs!==undefined&&<T style={{fontSize:11,color:C.muted}}>اولین متن: {(live.firstTextMs/1000).toLocaleString('fa-IR',{maximumFractionDigits:1})} ثانیه{live.firstAudioMs!==undefined?` · اولین صدا: ${(live.firstAudioMs/1000).toLocaleString('fa-IR',{maximumFractionDigits:1})} ثانیه`:''} از شروع پردازش عبارت</T>}
    {!!(error || live.error)&&<T accessibilityRole="alert" style={{color:C.danger,fontSize:13}}>{error || live.error}{live.translation&&live.phase==='error'?' بخشی از ترجمه ممکن است قبلاً پخش شده باشد.':''}</T>}
    <View style={s.row}><View style={{flex:1}}><Button small secondary title="توقف همهٔ صداها" onPress={stopAll}/></View><View style={{flex:1}}><Button small secondary title={replaying?'در حال پخش…':'پخش دوبارهٔ ترجمه'} disabled={!live.translation || busy || micActive || replaying || !speechReady} icon="volume-high-outline" onPress={()=>void playAgain()}/></View></View>
    <T style={{fontSize:11,color:C.muted}}>فایل و ضبط برای تشخیص گفتار به موتور انتخابی فرستاده می‌شوند؛ در حالت محلی، پردازش فقط روی رایانهٔ سرور است و در دفترچه ذخیره نمی‌شوند. صدای دستگاه به موتور گفتار سیستم وابسته است.</T>
  </Card>;
}
