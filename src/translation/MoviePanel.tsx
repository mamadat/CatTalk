import React,{useEffect,useMemo,useRef,useState} from 'react';
import {AppState,Modal,Platform,ScrollView,Switch,TextInput,View} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {useVideoPlayer,VideoView} from 'expo-video';
import {TranslationRequest,languageNames,providerSupportsOptions} from '../../shared/translation';
import {Button,C,Card,s,T} from '../ui';
import {Transport} from './controller';
import {SubtitleCue,activeSubtitles,MAX_SUBTITLE_BYTES,parseSubtitles,parseSubtitleTranslation,subtitleBatch,translatedSRT} from './subtitles';
import {readSubtitleFile,releaseMediaFile} from './subtitleFiles';
import {exportSessionFile} from './sessionExport';
import {subtitleTime} from './sessions';
import {QualityReview} from './QualityReview';

function wait(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new Error('لغو شد.'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}
export function MoviePanel({request,ready,transport}:{request:TranslationRequest;ready:boolean;transport:Transport}){
 const [cues,setCues]=useState<SubtitleCue[]>([]),[filename,setFilename]=useState(''),[translations,setTranslations]=useState(new Map<string,string>()),[busy,setBusy]=useState(false),[picking,setPicking]=useState(false),[error,setError]=useState('');
 const [video,setVideo]=useState(''),[videoName,setVideoName]=useState(''),[position,setPosition]=useState(0),[running,setRunning]=useState(false),[playing,setPlaying]=useState(false),[seek,setSeek]=useState('0'),[offset,setOffset]=useState(0),[showSource,setShowSource]=useState(true),[large,setLarge]=useState(false);
 const [page,setPage]=useState(0),[model,setModel]=useState('');
 const alive=useRef(true),pickerId=useRef(0),abort=useRef<AbortController|undefined>(undefined),ownedVideo=useRef(''),nextRequestAt=useRef(0);
 const player=useVideoPlayer(video||null,p=>{p.staysActiveInBackground=false;});
 const config=useMemo(()=>({provider:request.provider,source:request.source,target:request.target,mode:request.mode,tone:request.tone,context:request.context}),[request.provider,request.source,request.target,request.mode,request.tone,request.context]);
 useEffect(()=>{abort.current?.abort();setBusy(false);setTranslations(new Map());setError('');setModel('');},[config,transport]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;pickerId.current++;abort.current?.abort();if(Platform.OS==='web'&&ownedVideo.current)releaseMediaFile(ownedVideo.current);};},[]);
 useEffect(()=>{const sub=AppState.addEventListener('change',state=>{if(state!=='active'){setRunning(false);player.pause();}});return()=>sub.remove();},[player]);
 useEffect(()=>{player.timeUpdateEventInterval=video?0.2:0;setPlaying(false);if(!video)return;const time=player.addListener('timeUpdate',e=>setPosition(e.currentTime));const playback=player.addListener('playingChange',e=>setPlaying(e.isPlaying));const status=player.addListener('statusChange',e=>{if(e.error)setError('فیلم روی این دستگاه پخش نشد؛ قالب و کدک فایل را بررسی کنید یا از ساعت زیرنویس برای پخش‌کنندهٔ دیگر استفاده کنید.');});return()=>{time.remove();playback.remove();status.remove();/* Native useVideoPlayer releases the old player before this effect cleans up. */if(Platform.OS==='web'){player.timeUpdateEventInterval=0;player.pause();}};},[player,video]);
 useEffect(()=>{if(video||!running)return;const start=Date.now(),base=position;const timer=setInterval(()=>setPosition(base+(Date.now()-start)/1000),200);return()=>clearInterval(timer);},[video,running]);
 function pause(){abort.current?.abort();setBusy(false);}
 async function pickSubtitle(){const id=++pickerId.current;pause();setPicking(true);setError('');let uri='';try{
  const result=await DocumentPicker.getDocumentAsync({type:'*/*',base64:false,copyToCacheDirectory:true});if(result.canceled)return;const file=result.assets[0];uri=file.uri;
  if((file.size||0)>MAX_SUBTITLE_BYTES)throw new Error('حداکثر حجم زیرنویس ۱ مگابایت است.');
  if(!/\.(srt|vtt)$/i.test(file.name))throw new Error('فایل با پسوند SRT یا VTT و متن UTF-8 انتخاب کنید.');
  const parsed=parseSubtitles(await readSubtitleFile(uri));if(!alive.current||id!==pickerId.current)return;
  setCues(parsed);setFilename(file.name);setTranslations(new Map());setModel('');setPage(0);setPosition(0);setRunning(false);player.currentTime=0;
 }catch(e){if(alive.current&&id===pickerId.current)setError(e instanceof Error?e.message:'خواندن زیرنویس انجام نشد.');}finally{if(uri)releaseMediaFile(uri);if(alive.current&&id===pickerId.current)setPicking(false);}}
 async function pickVideo(){const id=++pickerId.current;setPicking(true);setError('');try{
  const result=await DocumentPicker.getDocumentAsync({type:'video/*',base64:false,copyToCacheDirectory:false});if(result.canceled)return;const file=result.assets[0];
  if(!alive.current||id!==pickerId.current){if(Platform.OS==='web')releaseMediaFile(file.uri);return;}
  player.pause();if(Platform.OS==='web'&&ownedVideo.current)releaseMediaFile(ownedVideo.current);ownedVideo.current=file.uri;setVideo(file.uri);setVideoName(file.name);setRunning(false);setPosition(0);
 }catch(e){if(alive.current&&id===pickerId.current)setError('انتخاب فیلم انجام نشد.');}finally{if(alive.current&&id===pickerId.current)setPicking(false);}}
 async function translate(){
  pause();const controller=new AbortController();abort.current=controller;const signal=controller.signal;setBusy(true);setError('');const results=new Map(translations),batchMode=providerSupportsOptions(config.provider||'openai');
  try{while(!signal.aborted){const batch=subtitleBatch(cues,new Set(results.keys()),batchMode);if(!batch.length)break;
   const delay=nextRequestAt.current-Date.now();if(delay>0)await wait(delay,signal);if(signal.aborted)return;
   nextRequestAt.current=Date.now()+2200;let text='',complete=false,name='';
   const input={...config,text:batch.map(c=>c.text).join('\n'),...(batchMode?{subtitleCues:batch.map(({id,text})=>({id,text}))}:{})};
   await transport(input,signal,e=>{if(signal.aborted)return;if(e.type==='error')throw new Error(e.message);if(e.type==='delta')text+=e.text;else{complete=true;name=e.model;}});
   if(signal.aborted||!alive.current)return;if(!complete||!text.trim())throw new Error('ترجمهٔ بسته کامل نشد؛ قطعه‌های قبلی حفظ شدند.');
   const translated=batchMode?parseSubtitleTranslation(text,batch):new Map([[batch[0].id,text.trim()]]);
   translated.forEach((value,id)=>results.set(id,value));setTranslations(new Map(results));setModel(name);
  }}catch(e){if(!signal.aborted&&alive.current)setError(e instanceof Error?e.message:'ترجمه انجام نشد.');}finally{if(abort.current===controller&&alive.current)setBusy(false);}
 }
 function seekTo(seconds:number){const next=Math.max(0,seconds);setRunning(false);setPosition(next);if(video)player.currentTime=next;}
 const current=activeSubtitles(cues,(position-offset)*1000),caption=current.map(c=>translations.get(c.id)||'… ترجمهٔ این قطعه آماده نیست').join('\n'),original=current.map(c=>c.text).join('\n');
 const captionView=<><T testID="movie-caption" selectable style={{color:'#FFFFFF',fontSize:large?30:23,lineHeight:large?50:38,textAlign:request.target==='fa'?'right':'left'}}>{caption||' '}</T>{showSource&&<T testID="movie-original" selectable style={{color:'#BCD5C6',fontSize:large?21:15,lineHeight:large?35:26}}>{original}</T>}</>;
 return <><Card><T style={s.subtitle}>فیلم و زیرنویس زمان‌دار</T><T style={s.muted}>فایل SRT یا VTT فارسی یا ژاپنی را ترجمه کنید و همراه فیلم محلی ببینید، یا ساعت زیرنویس را با پخش‌کنندهٔ دیگر هماهنگ کنید. پس از آماده‌شدن ترجمه، پخش و جابه‌جایی زمان درخواست تازه‌ای به AI نمی‌فرستند. برای صدای زندهٔ فیلم، در «جلسه و زیرنویس» میکروفون یا صدای تب را انتخاب کنید.</T>
 <Button title="انتخاب زیرنویس SRT یا VTT" icon="document-text-outline" disabled={picking||busy} onPress={()=>void pickSubtitle()}/><T style={s.muted}>{filename||'زیرنویسی انتخاب نشده'} · {cues.length} قطعه · فقط دو جهت فارسی و ژاپنی؛ زبان فایل را از بالا انتخاب کنید.</T>
 <T style={s.muted}>{providerSupportsOptions(request.provider||'openai')?'حداکثر ۸ قطعه در هر درخواست برای کاهش هزینهٔ پرامپت و استفاده از جمله‌های مجاور.':'موتور انتخابی هر قطعه را جدا ترجمه می‌کند و زمینهٔ قطعه‌های مجاور را ندارد.'} درخواست‌ها به‌ترتیب و با فاصلهٔ حداقل ۲٫۲ ثانیه آغاز می‌شوند؛ سهمیهٔ سرویس ممکن است کمتر باشد. ترجمهٔ فایل کامل می‌تواند زمان و هزینه داشته باشد.</T>
 <T testID="movie-progress" accessibilityLiveRegion="polite" style={s.muted}>ترجمهٔ کامل: {translations.size}/{cues.length}{model?` · ${model}`:''}</T>
 {busy?<Button secondary title="توقف ترجمه و حفظ قطعه‌های کامل" onPress={pause}/>:<Button title={translations.size?'ادامهٔ ترجمهٔ زیرنویس':'شروع ترجمهٔ زیرنویس'} disabled={!ready||!cues.length||translations.size===cues.length||picking} onPress={()=>void translate()}/>}
 <Button secondary small title={`خروجی SRT ترجمه‌شده (${translations.size}/${cues.length})`} disabled={busy||!translations.size} onPress={()=>{void exportSessionFile(translatedSRT(cues,translations),'srt').catch(e=>setError(e.message));}}/>
 <T style={s.muted}>خروجی فقط قطعه‌های کامل را با زمان اصلی دارد؛ فایل ناقص با تعداد بالا مشخص است. با تغییر موتور، جهت، لحن، زمینه یا واژه‌نامه، ترجمهٔ زیرنویس پاک می‌شود تا خروجی‌ها مخلوط نشوند. متن‌ها در حافظهٔ همین صفحه‌اند؛ پیش از خروج SRT بگیرید.</T></Card>
 <Card><Button secondary title="انتخاب فیلم محلی برای پخش" icon="videocam-outline" disabled={picking} onPress={()=>void pickVideo()}/><T style={s.muted}>{videoName||'بدون فیلم محلی؛ ساعت مستقل زیرنویس قابل استفاده است.'} فایل فیلم به سرور ارسال نمی‌شود؛ فقط متن زیرنویس ترجمه می‌شود. فایل دارای زیرنویس جدا لازم است؛ استخراج گفتار از فایل فیلم در این بخش فعال نیست.</T>
 {!!video?<><View style={{backgroundColor:'#000',borderRadius:14,overflow:'hidden'}}><VideoView player={player} style={{width:'100%',height:260}} contentFit="contain" nativeControls={false} playsInline fullscreenOptions={{enable:false}} allowsPictureInPicture={false}/><View pointerEvents="none" style={{position:'absolute',bottom:0,left:0,right:0,backgroundColor:'#000000BB',padding:12}}>{!large&&captionView}</View></View><Button secondary title={playing?'مکث فیلم':'پخش فیلم'} icon={playing?'pause-outline':'play-outline'} onPress={()=>{if(playing)player.pause();else player.play();}}/><View style={s.row}><Button secondary small title="فیلم ۱۰ ثانیه عقب" onPress={()=>seekTo(Math.max(0,player.currentTime-10))}/><Button secondary small title="فیلم ۱۰ ثانیه جلو" onPress={()=>seekTo(Math.min(Number.isFinite(player.duration)&&player.duration>0?player.duration:360000,player.currentTime+10))}/></View></>:<View style={{backgroundColor:'#122720',padding:16,borderRadius:14,minHeight:90}}>{!large&&captionView}</View>}
 <T testID="movie-clock" style={s.muted}>زمان پخش: {subtitleTime(position*1000)} · تأخیر زیرنویس: {offset.toFixed(1)} ثانیه</T>
 {!video&&<Button secondary title={running?'مکث ساعت زیرنویس':'شروع ساعت زیرنویس'} disabled={!cues.length} onPress={()=>setRunning(v=>!v)}/>}
 <TextInput accessibilityLabel="رفتن به ثانیهٔ فیلم" value={seek} onChangeText={setSeek} keyboardType="decimal-pad" style={s.input}/><Button secondary small title="هماهنگ‌کردن با ثانیهٔ واردشده" disabled={!Number.isFinite(Number(seek))||Number(seek)<0||Number(seek)>360000} onPress={()=>seekTo(Number(seek))}/>
 <View style={s.row}><Button secondary small title="زیرنویس ۰٫۵ ثانیه زودتر" disabled={offset<=-120} onPress={()=>setOffset(n=>n-0.5)}/><Button secondary small title="زیرنویس ۰٫۵ ثانیه دیرتر" disabled={offset>=120} onPress={()=>setOffset(n=>n+0.5)}/></View>
 <View style={s.row}><Switch accessibilityLabel="نمایش متن اصلی زیرنویس فیلم" value={showSource} onValueChange={setShowSource}/><T style={s.muted}>نمایش هم‌زمان متن اصلی</T></View>
 <Button secondary small title="نمایش بزرگ زیرنویس فیلم" disabled={!cues.length} onPress={()=>setLarge(true)}/>
 {!!video&&<Button secondary small title="بستن فیلم و استفاده از ساعت زیرنویس" onPress={()=>{player.pause();setVideo('');setVideoName('');setRunning(false);if(Platform.OS==='web'&&ownedVideo.current)releaseMediaFile(ownedVideo.current);ownedVideo.current='';}}/>}</Card>
 {!!cues.length&&<Card><T style={s.subtitle}>بازبینی قطعه‌های {page*10+1} تا {Math.min(cues.length,(page+1)*10)}</T>{cues.slice(page*10,page*10+10).map(c=><View key={c.id} style={{gap:6,paddingVertical:10,borderBottomWidth:1,borderBottomColor:C.line}}><Button secondary small title={`رفتن به ${subtitleTime(c.startMs)}`} onPress={()=>seekTo(c.startMs/1000+offset)}/><T selectable>{c.text}</T><T selectable>{translations.get(c.id)||'هنوز ترجمه نشده'}</T>{translations.has(c.id)&&<QualityReview source={c.text} target={translations.get(c.id)!}/>}</View>)}<View style={s.row}><Button small secondary title="قطعه‌های قبلی" disabled={page===0} onPress={()=>setPage(n=>n-1)}/><Button small secondary title="قطعه‌های بعدی" disabled={(page+1)*10>=cues.length} onPress={()=>setPage(n=>n+1)}/></View></Card>}
 {!!error&&<T accessibilityRole="alert" style={{color:C.danger}}>{error}</T>}
 <Modal visible={large} onRequestClose={()=>setLarge(false)} animationType="fade"><View style={{flex:1,backgroundColor:'#122720',padding:24,paddingTop:50,gap:20}}><T style={{color:'#BCD5C6'}}>زیرنویس فیلم · {languageNames[request.source]} → {languageNames[request.target]}</T><ScrollView style={{flex:1}}>{large&&captionView}</ScrollView><Button title="بستن نمایش بزرگ زیرنویس فیلم" onPress={()=>setLarge(false)}/>{!video&&<Button secondary title={running?'مکث ساعت زیرنویس':'شروع ساعت زیرنویس'} onPress={()=>setRunning(v=>!v)}/>}</View></Modal>
 </>;
}
