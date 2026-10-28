import React,{useEffect,useMemo,useRef,useState} from 'react';
import {AppState,Modal,ScrollView,Switch,TextInput,View} from 'react-native';
import {Language,TranslationRequest,TranslationStatus,languageNames,providerSupportsOptions} from '../../shared/translation';
import {STTProvider,sttNames} from '../../shared/voice';
import {Button,C,Card,Chips,s,T} from '../ui';
import {uid} from '../domain';
import {Transport} from './controller';
import {PreferencesAPI} from './preferences';
import {Microphone} from './Microphone';
import {CaptureTiming} from './Microphone.types';
import {readVoiceFile} from './voiceFiles';
import {transcribeVoice} from './voiceClient';
import {SessionTurn,TurnQueue,sessionJSON,sessionSRT,spokenHints,subtitleTime} from './sessions';
import {QualityReview} from './QualityReview';
import {exportSessionFile} from './sessionExport';
const phaseNames={queued:'در صف',transcribing:'تشخیص گفتار',reviewing:'بازبینی متن شنیده‌شده',translating:'در حال ترجمه',done:'کامل',error:'ناموفق',cancelled:'لغوشده'};
export function SessionPanel({url,token,request,status,ready,transport,preferences}:{url:string;token:string;request:TranslationRequest;status?:TranslationStatus;ready:boolean;transport:Transport;preferences:PreferencesAPI}){
 const [turns,setTurns]=useState<SessionTurn[]>([]),[pending,setPending]=useState(0),[active,setActive]=useState(false),[reset,setReset]=useState(0),[error,setError]=useState('');
 const [title,setTitle]=useState(''),[topic,setTopic]=useState(''),[typed,setTyped]=useState(''),[stt,setStt]=useState<STTProvider>('groq'),[recognition,setRecognition]=useState<'fast'|'accurate'>('accurate');
 const [useHints,setUseHints]=useState(false),[strict,setStrict]=useState(false),[large,setLarge]=useState(false);
 const origin=useRef<number|undefined>(undefined),records=useRef<SessionTurn[]>([]),reviewers=useRef(new Map<string,(value:string)=>void>()),alive=useRef(true);
 const queue=useMemo(()=>new TurnQueue(3,count=>{if(alive.current)setPending(count);}),[]);
 function update(id:string,patch:Partial<SessionTurn>){if(!alive.current)return;records.current=records.current.map(t=>t.id===id?{...t,...patch}:t);setTurns(records.current);}
 function cancel(){queue.cancel();for(const turn of records.current)if(!['done','error','cancelled'].includes(turn.phase))update(turn.id,{phase:'cancelled',error:'پردازش این نوبت لغو شد.'});}
 const supportsOptions=providerSupportsOptions(request.provider || 'openai');
 const context=supportsOptions?[request.context,topic].filter(Boolean).join('\n'):'';
 const contextValid=context.length<=500;
 const hints=useHints?spokenHints(request.source,preferences.data.terms):[];
 const identity=JSON.stringify([url,token,request.provider,request.mode,request.source,request.target,request.tone,context,stt,recognition,hints,strict]);
 useEffect(()=>{cancel();setReset(v=>v+1);setActive(false);return()=>queue.cancel();},[identity,transport]);
 useEffect(()=>{alive.current=true;const sub=AppState.addEventListener('change',next=>{if(next!=='active'){cancel();setReset(v=>v+1);setActive(false);setLarge(false);}});return()=>{alive.current=false;queue.cancel();sub.remove();};},[]);
 function makeTurn(original:string,timing?:CaptureTiming){
  if(records.current.length>=60)throw new Error('ظرفیت ۶۰ نوبت جلسه پر است؛ خروجی بگیرید و جلسهٔ تازه شروع کنید.');
  const now=Date.now();origin.current??=timing?.startedAt || now;
  const turn:SessionTurn={id:uid(),source:request.source,target:request.target,startedMs:Math.max(0,(timing?.startedAt || now)-origin.current),endedMs:Math.max(0,(timing?.endedAt || now)-origin.current),phase:'queued',original,translated:'',requiresReview:strict,reviewed:false};
  records.current=[...records.current,turn];setTurns(records.current);return turn;
 }
 function review(id:string,text:string,signal:AbortSignal){update(id,{phase:'reviewing',original:text});return new Promise<string>((resolve,reject)=>{const abort=()=>{reviewers.current.delete(id);reject(new Error('بازبینی لغو شد.'));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}reviewers.current.set(id,value=>{signal.removeEventListener('abort',abort);reviewers.current.delete(id);resolve(value);});});}
 async function enqueue(turn:SessionTurn,getText:(signal:AbortSignal)=>Promise<string>,audio=false){
  const enqueued=Date.now(),sourceRequest={...request,source:turn.source,target:turn.target,context};
  try{await queue.add(async signal=>{
   const started=Date.now();update(turn.id,{phase:audio?'transcribing':'translating',queuedMs:started-enqueued,error:undefined});
   let original=await getText(signal);if(signal.aborted)return;
   const sttMs=audio?Date.now()-started:0;
   if(audio&&turn.requiresReview)original=await review(turn.id,original,signal);
   if(signal.aborted)return;if(!original.trim()||original.length>2000)throw new Error('متن این نوبت باید بین ۱ و ۲۰۰۰ نویسه باشد.');
   update(turn.id,{phase:'translating',original,sttMs});
   const txStarted=Date.now();let translated='',complete=false,firstTextMs:number|undefined,model='',promptVersion='';
   await transport({...sourceRequest,text:original},signal,event=>{if(signal.aborted)return;if(event.type==='error')throw new Error(event.message);if(event.type==='delta'){firstTextMs??=Date.now()-txStarted;translated+=event.text;}else{complete=true;model=event.model;promptVersion=event.promptVersion;}});
   if(signal.aborted)return;if(!complete||!translated.trim())throw new Error('ترجمهٔ این نوبت کامل نشد.');
   update(turn.id,{phase:'done',translated,modelTranslation:translated,edited:false,model,promptVersion,translationMs:Date.now()-txStarted,firstTextMs,totalMs:Date.now()-enqueued,reviewed:false});
  });}catch(e){const current=records.current.find(t=>t.id===turn.id);if(current?.phase!=='cancelled')update(turn.id,{phase:'error',error:e instanceof Error?e.message:'پردازش نوبت انجام نشد.'});throw e;}
 }
 async function audio(uri:string,mimeType:string,timing?:CaptureTiming){
  const turn=makeTurn('',timing);const hintSnapshot=hints;
  await enqueue(turn,async signal=>{const file=await readVoiceFile(uri);if(signal.aborted)throw new Error('لغو شد.');return transcribeVoice(url,token,{provider:stt,language:turn.source,mimeType,audioBase64:file.base64,recognition,...(hintSnapshot.length?{hints:hintSnapshot}:{})},signal);},true);
 }
 async function translateTyped(){setError('');try{const turn=makeTurn(typed);const text=typed;setTyped('');await enqueue(turn,async()=>text);}catch(e){setError(e instanceof Error?e.message:'ترجمه انجام نشد.');}}
 async function exportSession(format:'json'|'srt'){
  const text=format==='json'?sessionJSON(title,records.current):sessionSRT(records.current);if(!text){setError('زیرنویس کامل و قابل انتشار وجود ندارد؛ در حالت بازبینی، ترجمه را تأیید کنید.');return;}
  try{await exportSessionFile(text,format);}catch(e){setError(e instanceof Error?e.message:'خروجی‌گرفتن انجام نشد.');}
 }
 const published=turns.filter(t=>t.phase==='done'&&(!t.requiresReview||t.reviewed)),last=published.at(-1);
 const sttChosen=useRef(false);
  useEffect(()=>{if(sttChosen.current||!status?.voice)return;if(status.voice.transcription.whisperlocal?.configured&&!status.voice.transcription.groq?.configured)setStt('whisperlocal');sttChosen.current=true;},[status?.voice]);
  const sttStatus=status?.voice?.transcription[stt];const localStt=stt==='whisperlocal';const sttReady=!!sttStatus?.configured&&sttStatus.availableModes?.[recognition]!==false;
 const controlsDisabled=active||pending>0;
 return <><Card><T style={s.subtitle}>جلسه و زیرنویس</T><T style={s.muted}>زیرنویس پس از کامل‌شدن هر نوبت ثابت می‌ماند. صدا تا ۳ ثانیه مکث جمع می‌شود و ضبط نوبت بعدی هنگام پردازش ادامه دارد؛ مرز نوبت‌ها وقفهٔ کوتاه دارد. این حالت صدای ترجمه پخش نمی‌کند تا دوباره ضبط نشود. هر بار زبان گوینده را از بالا انتخاب کنید؛ تفکیک خودکار چند گوینده ندارد.</T>
 <TextInput accessibilityLabel="عنوان جلسه" value={title} onChangeText={setTitle} maxLength={80} placeholder="عنوان برای خروجی جلسه" style={s.input}/>
 <TextInput accessibilityLabel="موضوع و زمینهٔ جلسه" value={topic} onChangeText={setTopic} editable={!controlsDisabled&&supportsOptions} multiline maxLength={500} placeholder="موضوع، نام سازمان یا زمینهٔ لازم برای رفع ابهام" style={s.input}/><T style={s.muted}>زمینهٔ جلسه با زمینهٔ دستی در مجموع {context.length}/۵۰۰ نویسه؛ هنگام ضبط قابل تغییر نیست.</T>{!supportsOptions&&<T style={s.muted}>موتور انتخابی زمینه و واژه‌نامه را پشتیبانی نمی‌کند.</T>}
 <Chips options={sttNames} value={stt} onChange={value=>{if(!controlsDisabled){sttChosen.current=true;setStt(value);}}}/>
 {(stt==='groq'||localStt)&&<Chips options={localStt?{fast:'محلی سریع‌تر',accurate:'محلی با جستجوی بیشتر'}:{fast:'Whisper سریع',accurate:'Whisper کامل'}} value={recognition} onChange={value=>{if(!controlsDisabled)setRecognition(value);}}/>}
 {localStt&&<T testID="session-stt-status" style={s.muted}>کاملاً رایگان در اجرای محلی؛ صدا روی رایانهٔ سرور پردازش می‌شود. {sttStatus?.message||'Start-LocalVoice.ps1 را اجرا و بررسی دوباره را بزنید.'}{sttStatus?.configured&&!sttReady?' مدل این حالت نصب نشده است.':''}</T>}
 <T style={s.muted}>{localStt?(recognition==='accurate'?sttStatus?.qualityModel:sttStatus?.model):stt==='groq'?(recognition==='accurate'?status?.voice?.transcription.groq.qualityModel || 'whisper-large-v3':status?.voice?.transcription.groq.model || 'whisper-large-v3-turbo'):'مدل Gemini تنظیم‌شدهٔ سرور'}؛ انتخاب مدل به‌معنای تضمین دقت نیست.</T>
 <View style={s.row}><Switch accessibilityLabel="راهنمای نام‌ها برای تشخیص گفتار جلسه" value={useHints} disabled={controlsDisabled} onValueChange={setUseHints}/><T style={s.muted}>ارسال نام‌های کوتاهِ همین زبان از واژه‌نامه به STT</T></View>{useHints&&<T style={s.muted}>راهنمای املای احتمالی: {hints.join('، ') || 'نام کوتاه قابل ارسال وجود ندارد.'}؛ فقط اگر شنیده شوند. حداکثر ۸ نام و ۱۶۰ بایت.</T>}
 <View style={s.row}><Switch accessibilityLabel="بازبینی انسانی جلسه پیش از انتشار زیرنویس" value={strict} disabled={controlsDisabled} onValueChange={setStrict}/><T style={s.muted}>بازبینی متن ویس و تأیید ترجمه پیش از انتشار زیرنویس</T></View>{strict&&<T style={s.muted}>ضبط در زمان بازبینی مکث می‌کند؛ این حالت نوبتی است. تأیید شما جای تأیید مترجم حرفه‌ای را نمی‌گیرد.</T>}
 <Microphone key={`${identity}-${reset}`} language={request.source} disabled={!ready||!sttReady||!contextValid||turns.length>=60} audioReady={sttReady} continuous={!strict} onAudio={audio} onCancel={()=>{}} onActiveChange={setActive} onError={message=>{setError(message);cancel();setReset(v=>v+1);setActive(false);}}/>
 <T accessibilityLiveRegion="polite" style={s.muted}>نوبت‌ها: {turns.length}/۶۰ · در صف و پردازش: {pending}/۳. با پرشدن صف، ضبط متوقف و خطا مشخص می‌شود؛ تلاش مجدد خودکار انجام نمی‌شود. پایان ضبط، پردازش نوبت‌های ثبت‌شده را لغو نمی‌کند.</T>
 <TextInput accessibilityLabel="متن نوبت جلسه" value={typed} onChangeText={setTyped} multiline maxLength={2000} style={s.input} placeholder="یا متن گوینده را اینجا وارد کنید"/><Button title="ترجمهٔ نوبت متنی جلسه" disabled={!ready||!contextValid||!typed.trim()||active||pending>=3||turns.length>=60} onPress={()=>void translateTyped()}/>
 {!contextValid&&<T style={{color:C.danger}}>مجموع زمینه از ۵۰۰ نویسه بیشتر است؛ آن را کوتاه کنید.</T>}
 <Button secondary small title="لغو صف و توقف ضبط جلسه" onPress={()=>{cancel();setReset(v=>v+1);setActive(false);}}/>
 </Card>
 <Card style={{backgroundColor:C.mint}}><T style={s.subtitle}>آخرین زیرنویس کامل</T><T testID="session-caption" selectable style={{fontSize:25,lineHeight:42}}>{last?.translated || 'منتظر نوبت کامل و در صورت نیاز تأیید بازبینی…'}</T><T style={s.muted}>{last?.original}</T><Button secondary small title="نمایش بزرگ زیرنویس جلسه" disabled={!last} onPress={()=>setLarge(true)}/></Card>
 {turns.map(turn=><Card key={turn.id}><T style={s.muted}>{subtitleTime(turn.startedMs)} · {languageNames[turn.source]} → {languageNames[turn.target]} · {phaseNames[turn.phase]}</T>
 {turn.phase==='reviewing'?<><TextInput accessibilityLabel={`بازبینی متن نوبت ${turn.id}`} value={turn.original} onChangeText={value=>update(turn.id,{original:value})} multiline maxLength={2000} style={s.input}/><Button title="تأیید متن شنیده‌شدهٔ جلسه و ترجمه" disabled={!turn.original.trim()} onPress={()=>reviewers.current.get(turn.id)?.(turn.original)}/></>:<T selectable>{turn.original}</T>}
 <T testID={`session-turn-${turn.id}`} selectable style={{fontSize:19,lineHeight:32}}>{turn.translated}</T>
 {turn.phase==='done'&&<><QualityReview source={turn.original} target={turn.translated}/><T style={{fontSize:11,color:C.muted}}>صف {turn.queuedMs||0} ms · تشخیص/آماده‌سازی {turn.sttMs||0} ms · ترجمه {turn.translationMs||0} ms · اولین متن {turn.firstTextMs??0} ms · کل پردازش {turn.totalMs||0} ms</T><T style={{fontSize:11,color:C.muted}}>{turn.model} · {turn.promptVersion} · زمان کل از ثبت نوبت؛ شامل صف، شبکه و انتظار بازبینی؛ بدون زمان ضبط و مکث</T>
 {turn.requiresReview&&<><TextInput accessibilityLabel={`اصلاح ترجمهٔ جلسه ${turn.id}`} value={turn.translated} onChangeText={value=>update(turn.id,{translated:value,reviewed:false,edited:true})} multiline maxLength={4000} style={s.input}/><Button small title={turn.reviewed?'بازبینی این نوبت تأیید شده':'تأیید بازبینی ترجمهٔ این نوبت'} disabled={turn.reviewed||!turn.translated.trim()} onPress={()=>update(turn.id,{reviewed:true})}/><T style={s.muted}>تا تأیید، در نمای بزرگ و SRT منتشر نمی‌شود؛ JSON پیش‌نویس و وضعیت را هم شامل می‌شود. متن اولیهٔ مدل و علامت ویرایش دستی در خروجی جدا باقی می‌مانند.</T></>}
 </>}{!!turn.error&&<T style={{color:C.danger}}>{turn.error}</T>}
 {(turn.phase==='done'||turn.phase==='error'||turn.phase==='cancelled')&&!!turn.original&&<Button small secondary title="ترجمهٔ مجدد همین نوبت جلسه" disabled={!ready||active||pending>0||!contextValid} onPress={()=>{const original=turn.original;update(turn.id,{phase:'queued',translated:'',modelTranslation:undefined,edited:false,model:undefined,promptVersion:undefined,reviewed:false,error:undefined,requiresReview:strict});void enqueue({...turn,requiresReview:strict},async()=>original).catch(e=>setError(e.message));}}/>}
 </Card>)}
 <Card><T style={s.muted}>متن جلسه فقط در حافظهٔ همین صفحه است؛ خروج از این حالت آن را پاک می‌کند. خروجی‌گرفتن، ذخیره یا اشتراک آن فقط با انتخاب شما انجام می‌شود. برای جلسات دیپلماتیک، حقوقی و رسمی از مترجم حرفه‌ای استفاده کنید.</T><Button small secondary title="خروجی متن و وضعیت جلسه JSON" disabled={controlsDisabled||!turns.length} onPress={()=>void exportSession('json')}/><Button small secondary title="خروجی زیرنویس تأییدشده SRT" disabled={controlsDisabled||!published.length} onPress={()=>void exportSession('srt')}/><Button small secondary danger title="پاک‌کردن جلسه و شروع تازه" disabled={controlsDisabled} onPress={()=>{records.current=[];setTurns([]);origin.current=undefined;setError('');}}/></Card>
 {!!error&&<T accessibilityRole="alert" style={{color:C.danger}}>{error}</T>}
 <Modal visible={large} animationType="fade" onRequestClose={()=>setLarge(false)}><View style={{flex:1,backgroundColor:'#122720',padding:24,paddingTop:50,gap:20}}><T style={{color:'#BCD5C6'}}>{title||'زیرنویس جلسه'} · فقط نوبت کامل</T><ScrollView style={{flex:1}}><T testID="session-large-caption" selectable style={{fontSize:36,lineHeight:60,color:'#FFFFFF'}}>{last?.translated}</T><T style={{color:'#BCD5C6'}}>{last?.original}</T></ScrollView><Button title="بستن نمایش بزرگ زیرنویس" onPress={()=>setLarge(false)}/><Button secondary small title="توقف ضبط و لغو صف از نمای بزرگ" onPress={()=>{cancel();setReset(v=>v+1);setActive(false);setLarge(false);}}/></View></Modal>
 </>;
}
