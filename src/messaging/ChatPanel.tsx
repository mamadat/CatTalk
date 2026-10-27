import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,AppState,Linking,Modal,Platform,Share,Switch,TextInput,View} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {InboxMessage,MessageDraft,MessagingPlatform,MessagingStatus,messagingNames,personalChatURL} from '../../shared/messaging';
import {Language,MAX_TEXT_LENGTH,TranslationRequest,TranslationTone,toneNames,providerSupportsOptions} from '../../shared/translation';
import {Button,C,Card,Chips,s,T} from '../ui';
import {emptyLiveState,LiveTranslationController,Transport} from '../translation/controller';
import {PreferencesAPI} from '../translation/preferences';
import {ConversationContext} from '../translation/enhancements';
import {QualityReview} from '../translation/QualityReview';
import {Alternatives} from '../translation/Alternatives';
import {uid} from '../domain';
import {messagingAPI} from './client';

export interface SharedChatText {id:string;text:string;}
export function ChatPanel({url,token,request,ready,transport,shared,onHandled,preferences}:{url:string;token:string;request:TranslationRequest;ready:boolean;transport:Transport;preferences:PreferencesAPI;shared?:SharedChatText;onHandled?:()=>void}) {
 const [method,setMethod]=useState<'personal'|'direct'>('personal'),[platform,setPlatform]=useState<MessagingPlatform>('telegram');
 const [incoming,setIncoming]=useState(''),[source,setSource]=useState<Language>('ja'),[outgoing,setOutgoing]=useState(''),[phone,setPhone]=useState('');
 const [received,setReceived]=useState(emptyLiveState),[reply,setReply]=useState(emptyLiveState),[auto,setAuto]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [enabled,setEnabled]=useState(false),[online,setOnline]=useState<MessagingStatus>(),[messages,setMessages]=useState<InboxMessage[]>([]),[selected,setSelected]=useState<string>();
 const [checking,setChecking]=useState(false),[busy,setBusy]=useState(false),[draft,setDraft]=useState<MessageDraft>(),[refresh,setRefresh]=useState(0);
 const incomingRef=useRef<TextInput>(null),outgoingRef=useRef<TextInput>(null);const [composing,setComposing]=useState({incoming:false,outgoing:false});
 const [personalProfile,setPersonalProfile]=useState('none'),[profileName,setProfileName]=useState(''),[contactTone,setContactTone]=useState<TranslationTone>('preserve'),[contextOn,setContextOn]=useState(false),[showContact,setShowContact]=useState(false),[contextRevision,setContextRevision]=useState(0),[personalMessageId,setPersonalMessageId]=useState(uid);
 const history=useRef(new ConversationContext());
 const operation=useRef(0),handled=useRef<string|undefined>(undefined);
 const incomingController=useMemo(()=>new LiveTranslationController(transport,setReceived),[transport]);
 const outgoingController=useMemo(()=>new LiveTranslationController(transport,setReply),[transport]);
 useEffect(()=>()=>{incomingController.dispose();outgoingController.dispose();operation.current++;},[incomingController,outgoingController]);
 const item=messages.find(v=>v.id===selected&&v.platform===platform);
 const sourceText=method==='direct'?item?.text || '':incoming;
 const profileId=method==='direct'?`direct:${platform}:${item?.peerId || 'none'}`:personalProfile;
 const contactProfile=preferences.data.profiles.find(v=>v.id===profileId);
 const canRemember=method==='direct'?!!item:personalProfile!=='none';
 const currentMessageId=method==='direct'?item?.id || 'none':personalMessageId;
 const supportsContext=providerSupportsOptions(request.provider || 'openai');
 useEffect(()=>{setProfileName(contactProfile?.name || (method==='direct'?item?.peerName || '':''));setContactTone(contactProfile?.tone || request.tone);setContextOn(contactProfile?.contextEnabled || false);},[profileId,contactProfile?.name,contactProfile?.tone,contactProfile?.contextEnabled,request.tone]);
 const incomingContext=contextOn&&canRemember&&supportsContext?history.current.note(profileId,request.context,currentMessageId):request.context;
 const replyContext=contextOn&&canRemember&&supportsContext?history.current.note(profileId,request.context,undefined,sourceText?{id:currentMessageId,role:'incoming',text:sourceText}:undefined):request.context;
 const effectiveTone=supportsContext?contactTone:'preserve';
 const incomingRequest=useMemo(()=>({...request,text:sourceText,source,target:source==='ja'?'fa' as const:'ja' as const,tone:effectiveTone,context:incomingContext}),[request.provider,request.mode,effectiveTone,incomingContext,source,sourceText]);
 const replyRequest=useMemo(()=>({...request,text:outgoing,source:source==='ja'?'fa' as const:'ja' as const,target:source,tone:effectiveTone,context:replyContext}),[request.provider,request.mode,effectiveTone,replyContext,source,outgoing]);
 function rememberReply(){rememberCurrent();if(contextOn&&canRemember&&outgoing.trim()){history.current.put(profileId,{id:`reply:${currentMessageId}`,role:'outgoing',text:outgoing});setContextRevision(v=>v+1);setNotice('پاسخ تأییدشده در زمینهٔ همین مخاطب نگه داشته شد.');}}
 function rememberCurrent(){if(contextOn&&canRemember&&sourceText.trim()){history.current.put(profileId,{id:currentMessageId,role:'incoming',text:sourceText});setContextRevision(v=>v+1);}}
 async function saveProfile(){setError('');try{if(!profileName.trim())throw new Error('نام مخاطب را وارد کنید.');if(method==='direct'&&!item)throw new Error('ابتدا پیام مخاطب را انتخاب کنید.');const id=method==='direct'?profileId:personalProfile==='none'?`personal:${platform}:${uid()}`:personalProfile;await preferences.update(data=>{const profiles=data.profiles.filter(p=>p.id!==id);if(profiles.length>=50)throw new Error('حداکثر ۵۰ پروفایل قابل ذخیره است.');return {...data,profiles:[...profiles,{id,name:profileName.trim(),tone:contactTone,contextEnabled:contextOn}]};});if(method==='personal')setPersonalProfile(id);setNotice('پروفایل روی دستگاه ذخیره شد.');}catch(e){setError(e instanceof Error?e.message:'پروفایل ذخیره نشد.');}}
 useEffect(()=>{incomingController.update(ready?incomingRequest:null,auto&&!composing.incoming);},[incomingController,incomingRequest,ready,auto,composing.incoming]);
 useEffect(()=>{outgoingController.update(ready?replyRequest:null,auto&&!composing.outgoing);},[outgoingController,replyRequest,ready,auto,composing.outgoing]);
 useEffect(()=>{
  if(Platform.OS!=='web')return;const cleanup:(()=>void)[]=[];
  for(const [key,ref]of [['incoming',incomingRef],['outgoing',outgoingRef]] as const){const node=ref.current as unknown as HTMLElement|null;const start=()=>setComposing(old=>({...old,[key]:true})),end=()=>setComposing(old=>({...old,[key]:false}));node?.addEventListener?.('compositionstart',start);node?.addEventListener?.('compositionend',end);cleanup.push(()=>{node?.removeEventListener?.('compositionstart',start);node?.removeEventListener?.('compositionend',end);});}
  return()=>cleanup.forEach(fn=>fn());
 },[method]);
 useEffect(()=>{operation.current++;setDraft(undefined);},[method,platform,selected,source,outgoing,transport,profileId,contactTone,contextOn,request.provider,request.mode,request.tone,request.context]);
 useEffect(()=>{if(!shared || handled.current===shared.id)return;handled.current=shared.id;setMethod('personal');if(shared.text.length>MAX_TEXT_LENGTH){setError('متن اشتراک‌شده طولانی است؛ بخش کوتاه‌تری از پیام را انتخاب کنید.');onHandled?.();return;}rememberCurrent();setPersonalProfile('none');setPersonalMessageId(uid());setOutgoing('');setIncoming(shared.text);setSource('ja');setNotice('پیام اشتراک‌شده وارد شد؛ زبان پیام را بررسی کنید.');onHandled?.();},[shared?.id]);
 useEffect(()=>{
  if(method!=='direct'||!enabled)return;let alive=true,timer:ReturnType<typeof setTimeout>|undefined;const abort=new AbortController();
  async function poll(){if(!alive)return;setChecking(true);try{
   const state:MessagingStatus=await messagingAPI(url,token,'status','GET',undefined,abort.signal);
   const data=await messagingAPI(url,token,'inbox','GET',undefined,abort.signal);if(!alive)return;
   setOnline(state);setMessages(data.messages || []);setSelected(old=>old || data.messages?.find((v:InboxMessage)=>v.platform===platform)?.id);setError('');
  }catch(e){if(alive&&!abort.signal.aborted)setError(e instanceof Error?e.message:'دریافت پیام انجام نشد.');}finally{if(alive){setChecking(false);timer=setTimeout(()=>void poll(),5000);}}}
  void poll();return()=>{alive=false;abort.abort();clearTimeout(timer);};
 },[method,enabled,url,token,refresh,platform]);
 useEffect(()=>{const sub=AppState.addEventListener('change',next=>{if(next!=='active'){setEnabled(false);incomingController.update(null);outgoingController.update(null);operation.current++;setDraft(undefined);}});return()=>sub.remove();},[incomingController,outgoingController]);
 async function paste(){try{const value=await Clipboard.getStringAsync();if(value.length>MAX_TEXT_LENGTH)throw new Error('متن بیش از ۲۰۰۰ نویسه است؛ بخش کوتاه‌تری را کپی کنید.');setIncoming(value);setNotice('متن از کلیپ‌بورد وارد شد.');}catch(e){setError(e instanceof Error?e.message:'چسباندن انجام نشد؛ متن را دستی وارد کنید.');}}
 async function copy(value:string){try{await Clipboard.setStringAsync(value);setNotice('کپی شد.');}catch{setError('کپی انجام نشد؛ متن خروجی را انتخاب کنید.');}}
 async function openPersonal(){
  if(reply.phase!=='done')return;setError('');
  try{const url=personalChatURL(platform,reply.text,phone);if(platform==='instagram')await Clipboard.setStringAsync(reply.text);await Linking.openURL(url);setNotice(platform==='instagram'?'ترجمه کپی شد؛ آن را در دایرکت مخاطب بچسبانید و ارسال کنید.':'پیش‌نویس در پیام‌رسان باز شد؛ مخاطب را انتخاب و ارسال را خودتان تأیید کنید.');}catch(e){setError(e instanceof Error?e.message:'بازکردن پیام‌رسان ممکن نشد؛ ترجمه را کپی کنید.');}
 }
 async function prepare(){
  if(!item||reply.phase!=='done')return;setBusy(true);setError('');const id=++operation.current;
  try{const value:MessageDraft=await messagingAPI(url,token,'drafts','POST',{messageId:item.id,text:reply.text});if(id===operation.current)setDraft(value);}catch(e){if(id===operation.current)setError(e instanceof Error?e.message:'ساخت پیش‌نویس انجام نشد.');}finally{setBusy(false);}
 }
 async function send(){
  if(!draft)return;setBusy(true);setError('');const id=operation.current;
  try{const result=await messagingAPI(url,token,'send','POST',{draftId:draft.id});if(id!==operation.current)return;if(!result.sent)throw new Error('ارسال تأیید نشد.');rememberCurrent();if(contextOn&&canRemember){history.current.put(profileId,{id:uid(),role:'outgoing',text:outgoing});setContextRevision(v=>v+1);}setNotice('ارسال پیام توسط سرویس تأیید شد.');setDraft(undefined);setOutgoing('');}catch(e){if(id===operation.current)setError(e instanceof Error?e.message:'وضعیت ارسال مشخص نیست؛ پیام‌رسان را بررسی کنید.');}finally{setBusy(false);}
 }
 async function clearInbox(){setBusy(true);try{await messagingAPI(url,token,'inbox','DELETE');setMessages([]);setSelected(undefined);setDraft(undefined);setNotice('صندوق حافظهٔ سرور پاک شد؛ پیام‌های داخل پیام‌رسان حذف نشدند.');}catch(e){setError(e instanceof Error?e.message:'پاک‌سازی ناموفق بود.');}finally{setBusy(false);}}
 return <>
  <Card style={{backgroundColor:'#EEF3E9'}}><T style={s.subtitle}>مترجم گفت‌وگوها</T><Chips options={{personal:'حساب شخصی / اشتراک پیام',direct:'اتصال رسمی مستقیم'}} value={method} onChange={value=>{setMethod(value);setEnabled(false);}}/><Chips options={messagingNames} value={platform} onChange={value=>{rememberCurrent();setPlatform(value);setSelected(undefined);setPersonalProfile('none');setIncoming('');setOutgoing('');setPersonalMessageId(uid());}}/>
   <T style={s.muted}>{method==='personal'?'پیام را از پیام‌رسان با CatTalk به اشتراک بگذارید یا کپی کنید. پاسخ ترجمه‌شده پس از بازبینی به پیام‌رسان منتقل می‌شود.':'صندوق پیام برای ربات/Business تلگرام، WhatsApp Business و Instagram حرفه‌ای است؛ نیازمند مجوز، توکن و وب‌هوک HTTPS. این اتصال به همهٔ چت‌های حساب شخصی دسترسی ندارد.'}</T>
   {method==='personal'&&<T style={{fontSize:12,color:C.muted}}>{Platform.OS==='web'?'در پیش‌نمایش وب، پیام را کپی و اینجا بچسبانید. دریافت از Share گوشی به نسخهٔ نصب‌شدنی نیاز دارد.':'گزینهٔ CatTalk در اشتراک‌گذاری متن به development build یا نسخهٔ نصب‌شدهٔ جدید نیاز دارد؛ در Expo Go فعال نیست.'} اینستاگرام ممکن است متن دایرکت را قابل اشتراک نکند؛ از کپی استفاده کنید.</T>}
   <Chips options={{ja:'پیام دریافتی ژاپنی / پاسخ فارسی',fa:'پیام دریافتی فارسی / پاسخ ژاپنی'}} value={source} onChange={setSource}/>
   <View style={s.row}><Switch accessibilityLabel="ترجمهٔ خودکار پیام‌های چت" value={auto} onValueChange={setAuto}/><T style={s.muted}>ترجمهٔ خودکار پیام انتخاب‌شده و پاسخ هنگام تایپ</T></View>
  </Card>
  <Card><Button small secondary title={showContact?'بستن تنظیمات مخاطب':'پروفایل لحن و زمینهٔ مخاطب'} onPress={()=>setShowContact(v=>!v)}/>
   {showContact&&<>{method==='personal'&&<Chips options={{none:'بدون پروفایل',...Object.fromEntries(preferences.data.profiles.filter(p=>p.id.startsWith(`personal:${platform}:`)).map(p=>[p.id,p.name]))}} value={personalProfile} onChange={id=>{rememberCurrent();setPersonalProfile(id);setIncoming('');setOutgoing('');setPersonalMessageId(uid());}}/>}
   <TextInput accessibilityLabel="نام پروفایل مخاطب" value={profileName} onChangeText={setProfileName} maxLength={80} placeholder="نام مخاطب؛ مثلاً همکار ژاپنی" style={s.input}/><Chips options={toneNames} value={contactTone} onChange={setContactTone}/>
   <View style={s.row}><Switch accessibilityLabel="استفاده از زمینهٔ محدود همین مخاطب" value={contextOn} disabled={!supportsContext} onValueChange={value=>{setContextOn(value);if(!value){history.current.clear(profileId);setContextRevision(v=>v+1);}}}/><T style={s.muted}>زمینهٔ محدود همین مخاطب؛ اختیاری</T></View>
   <T style={s.muted}>لحن در پروفایل روی دستگاه ذخیره می‌شود. زمینه حداکثر ۳ پیام کاملِ قابل جاگیری در ۵۰۰ نویسه است و فقط در حافظهٔ همین صفحه می‌ماند. برای حساب شخصی، پروفایل را ذخیره کنید و بعد از هر پیام «پیام بعدی» را بزنید. پاسخ حساب شخصی فقط با دکمهٔ «این پاسخ را ارسال کرده‌ام» وارد زمینه می‌شود. متن زمینه همراه ترجمه به موتور انتخابی فرستاده می‌شود.</T>
   {!supportsContext&&<T style={s.muted}>این موتور لحن و زمینهٔ سفارشی را پشتیبانی نمی‌کند.</T>}
   <Button small title="ذخیرهٔ پروفایل مخاطب" disabled={!preferences.ready} onPress={()=>void saveProfile()}/>
   {contactProfile&&<Button small secondary title="حذف پروفایل مخاطب" onPress={()=>void preferences.update(data=>({...data,profiles:data.profiles.filter(p=>p.id!==profileId)})).then(()=>{history.current.clear(profileId);setContextRevision(v=>v+1);setPersonalProfile('none');}).catch(e=>setError(e.message))}/>}
   <Button small secondary title="پاک‌کردن زمینهٔ همین مخاطب" onPress={()=>{history.current.clear(profileId);setContextRevision(v=>v+1);}}/></>}
   <T style={s.muted}>{contactProfile?`مخاطب: ${contactProfile.name} · ${toneNames[effectiveTone]}`:'پروفایل ذخیره‌شده‌ای برای این مخاطب انتخاب نشده است.'}{contextOn&&canRemember&&supportsContext?' · زمینه فعال':''}</T>
  </Card>
  {method==='direct'&&<Card><T style={s.subtitle}>صندوق اتصال رسمی</T><View style={s.row}><Switch accessibilityLabel="دریافت پیام از اتصال رسمی" value={enabled} onValueChange={setEnabled}/><T style={s.muted}>دریافت در همین صفحه، هر ۵ ثانیه</T>{checking&&<ActivityIndicator color={C.green}/>}</View>
   <T style={s.muted}>{online?.platforms[platform].configured?'تنظیمات سرور کامل است؛ رسیدن وب‌هوک و اعتبار مجوز حساب جداگانه بررسی می‌شوند.':online?`تنظیمات لازم: ${online.platforms[platform].missing.join('، ')}`:'برای بررسی اتصال، توکن خصوصی سرور را در «تنظیم اتصال» پایین صفحه وارد کنید و دریافت را روشن کنید.'}</T>
   <T style={s.muted}>{platform==='telegram'?'ربات معمولی فقط چت‌های مجاز خود و پیام‌های فورواردشده به خودش را می‌بیند؛ حساب Business متصل فقط چت‌های اعطاشده را می‌بیند.':platform==='whatsapp'?'اتصال با WhatsApp Business Platform؛ پاسخ متنی در مهلت مجاز مکالمه و با رعایت تعرفه و سیاست حساب.':'فقط حساب Instagram حرفه‌ای با مجوز پیام‌رسانی؛ مخاطب باید مکالمه را شروع کرده باشد.'}</T>
   {messages.filter(v=>v.platform===platform).slice(0,30).map(v=><Button key={v.id} small secondary title={`${v.id===selected?'✓ ':''}${v.peerName}: ${v.text.slice(0,55)}`} onPress={()=>{rememberCurrent();setSelected(v.id);setOutgoing('');}}/>)}
   {!messages.some(v=>v.platform===platform)&&<T style={s.muted}>پیامی در صندوق نیست؛ چت‌های قدیمی به‌صورت خودکار وارد نمی‌شوند.</T>}
   <Button small secondary title="بررسی اتصال و پیام‌ها" onPress={()=>{setEnabled(true);setRefresh(v=>v+1);}}/><Button small secondary title="پاک‌کردن صندوق موقت سرور" disabled={!online||busy} onPress={()=>void clearInbox()}/>
  </Card>}
  <Card><T style={s.subtitle}>پیام دریافتی</T>{item&&method==='direct'&&<T style={s.muted}>از {item.peerName} · شناسهٔ مخاطب {item.peerId}</T>}
   {method==='personal'?<><TextInput ref={incomingRef} accessibilityLabel="متن پیام دریافتی چت" value={incoming} onChangeText={value=>{incomingController.update(null);setIncoming(value);}} maxLength={MAX_TEXT_LENGTH} multiline placeholder="پیام طرف مقابل را اینجا وارد کنید…" style={[s.input,{minHeight:110,textAlign:source==='fa'?'right':'left'}]}/><Button small secondary title="پیام بعدی؛ نگه‌داشتن زمینهٔ قبلی" onPress={()=>{rememberCurrent();setIncoming('');setOutgoing('');setPersonalMessageId(uid());}}/><Button secondary small title="چسباندن پیام کپی‌شده" icon="clipboard-outline" onPress={()=>void paste()}/></>:<T selectable>{item?.text || 'یک پیام از صندوق انتخاب کنید.'}</T>}
   <Button small title="ترجمهٔ پیام دریافتی" disabled={!ready||!sourceText.trim()||composing.incoming||['waiting','translating'].includes(received.phase)} onPress={()=>incomingController.update(incomingRequest,true,true)}/>
   {['waiting','translating'].includes(received.phase)&&<ActivityIndicator color={C.green}/>}
   <T testID="chat-incoming-translation" selectable style={{fontSize:17,lineHeight:30}}>{received.text || 'ترجمهٔ پیام اینجا نمایش داده می‌شود.'}</T>{received.error&&<T style={{color:C.danger}}>{received.error}</T>}
   {received.phase==='done'&&<QualityReview source={sourceText} target={received.text}/>}
  </Card>
  <Card><T style={s.subtitle}>پاسخ شما</T><TextInput ref={outgoingRef} accessibilityLabel="پاسخ برای ترجمه در چت" value={outgoing} onChangeText={value=>{outgoingController.update(null);setOutgoing(value);}} multiline maxLength={MAX_TEXT_LENGTH} placeholder={source==='ja'?'پاسخ فارسی خود را بنویسید…':'日本語で返信を入力…'} style={[s.input,{minHeight:110,textAlign:source==='ja'?'right':'left'}]}/>
   <Button small title="ترجمهٔ پاسخ" disabled={!ready||!outgoing.trim()||composing.outgoing||['waiting','translating'].includes(reply.phase)} onPress={()=>outgoingController.update(replyRequest,true,true)}/>
   {['waiting','translating'].includes(reply.phase)&&<ActivityIndicator color={C.green}/>}
   <T testID="chat-outgoing-translation" selectable style={{fontSize:17,lineHeight:30,textAlign:source==='ja'?'left':'right'}}>{reply.text || 'پیش‌نمایش پاسخ ترجمه‌شده'}</T>{reply.error&&<T style={{color:C.danger}}>{reply.error}</T>}
   {reply.phase==='done'&&<><QualityReview source={outgoing} target={reply.text}/><Alternatives request={replyRequest} result={reply.text} transport={transport} onChoose={value=>{outgoingController.update(null);setReply(old=>({...old,phase:'done',text:value}));}}/></>}
   {method==='personal'&&platform==='whatsapp'&&<TextInput accessibilityLabel="شمارهٔ اختیاری مخاطب واتس‌اپ" value={phone} onChangeText={setPhone} placeholder="شماره با کد کشور؛ اختیاری" keyboardType="phone-pad" style={s.input}/>}
   {method==='personal'&&contextOn&&canRemember&&<Button small secondary title="این پاسخ را ارسال کرده‌ام؛ حفظ در زمینه" disabled={reply.phase!=='done'} onPress={rememberReply}/>}
   <Button secondary small title="کپی پاسخ ترجمه‌شده" disabled={reply.phase!=='done'} onPress={()=>void copy(reply.text)}/>
   {method==='personal'?<><Button title={platform==='instagram'?'کپی و بازکردن دایرکت اینستاگرام':`بازکردن پیش‌نویس در ${messagingNames[platform]}`} disabled={reply.phase!=='done'} onPress={()=>void openPersonal()}/>{Platform.OS!=='web'&&<Button small secondary title="اشتراک پاسخ با برنامهٔ دلخواه" disabled={reply.phase!=='done'} onPress={()=>void Share.share({message:reply.text}).catch(()=>setError('اشتراک پاسخ ناموفق بود.'))}/>}</>:<Button title="پیش‌نمایش ارسال پاسخ مستقیم" disabled={!item||reply.phase!=='done'||busy||!online?.platforms[platform].configured} onPress={()=>void prepare()}/>}
  </Card>
  {!!error&&<T accessibilityRole="alert" style={{color:C.danger}}>{error}</T>}{!!notice&&<T accessibilityLiveRegion="polite" style={{color:C.green}}>{notice}</T>}
  <T style={s.muted}>فقط متن واردشده یا چت‌هایی که به اتصال رسمی مجوز داده‌اید پردازش می‌شوند. متن برای ترجمه به موتور انتخاب‌شده می‌رود. ارسال پاسخ مستقیم پس از تأیید پیش‌نمایش شما انجام می‌شود.</T>
  <Modal visible={!!draft} transparent animationType="fade" onRequestClose={()=>{if(!busy)setDraft(undefined);}}><View style={{flex:1,justifyContent:'center',padding:24,backgroundColor:'#0006'}}><Card><T style={s.subtitle}>تأیید ارسال پیام</T><T>مقصد: {draft?.peerName} ({draft?.peerId})</T><T>{draft&&messagingNames[draft.platform]}</T><T selectable testID="chat-send-preview">{draft?.text}</T>{draft&&<QualityReview source={outgoing} target={draft.text}/>}<Button title={busy?'در حال ارسال…':'تأیید و ارسال همین متن'} disabled={busy} onPress={()=>void send()}/><Button secondary title="انصراف از ارسال" disabled={busy} onPress={()=>setDraft(undefined)}/></Card></View></Modal>
 </>;
}
