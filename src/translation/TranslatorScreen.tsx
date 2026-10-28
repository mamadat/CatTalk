import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Platform,Pressable,Share,StyleSheet,Switch,TextInput,View} from 'react-native';
import {ProviderId,providerNames,localProviders,providerSupportsOptions,Language,languageNames,MAX_TEXT_LENGTH,modeNames,toneNames,TranslationMode,TranslationRequest,TranslationStatus,TranslationTone} from '../../shared/translation';
import {Button,C,Card,Chips,Icon,s,T} from '../ui';
import {checkTranslationServer,createTranslationTransport,normalizeServerUrl} from './client';
import {ChatPanel,SharedChatText} from '../messaging/ChatPanel';
import {VoicePanel} from './VoicePanel';
import {emptyLiveState,LiveTranslationController} from './controller';
import {useTranslationPreferences} from './preferences';
import {enrichRequest} from './enhancements';
import {GlossaryPanel} from './GlossaryPanel';
import {QualityReview} from './QualityReview';
import {Alternatives} from './Alternatives';
import {ScreenshotPanel} from './ScreenshotPanel';
import {TravelPanel} from './TravelPanel';
import {SessionPanel} from './SessionPanel';
import {SavePhraseButton} from './SavePhraseButton';
import {OpenAISetup} from './OpenAISetup';
import {Transport} from './controller';
import {createTranslationMemory} from './memory';

function defaultUrl() {
  if (process.env.EXPO_PUBLIC_TRANSLATION_URL) return process.env.EXPO_PUBLIC_TRANSLATION_URL;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (['localhost','127.0.0.1'].includes(window.location.hostname)) return `${window.location.protocol}//${window.location.hostname}:8787`;
    return window.location.origin;
  }
  return '';
}
export function TranslatorScreen({sharedChat,onSharedHandled}:{sharedChat?:SharedChatText;onSharedHandled?:()=>void}={}) {
  const [inputMode,setInputMode]=useState<'text'|'voice'|'chat'|'image'|'travel'|'session'>('text');
  const [provider,setProvider]=useState<ProviderId>('gemini');
  const [text,setText]=useState('');const [source,setSource]=useState<Language>('fa');
  const target:Language=source === 'fa' ? 'ja' : 'fa';
  const [mode,setMode]=useState<TranslationMode>('balanced');const [tone,setTone]=useState<TranslationTone>('preserve');
  const [context,setContext]=useState('');const [auto,setAuto]=useState(true);const [composing,setComposing]=useState(false);
  const [url,setUrl]=useState(defaultUrl);const [draftUrl,setDraftUrl]=useState(url);const [token,setToken]=useState('');const [draftToken,setDraftToken]=useState('');
  const [settings,setSettings]=useState(false);const [advanced,setAdvanced]=useState(false);const [connectionError,setConnectionError]=useState('');
  const [status,setStatus]=useState<TranslationStatus>();const [checking,setChecking]=useState(false);const [checkId,setCheckId]=useState(0);
  const [live,setLive]=useState(emptyLiveState);const [copyMessage,setCopyMessage]=useState('');
  const [memoryEnabled,setMemoryEnabled]=useState(true);
  const inputRef=useRef<TextInput>(null);
  useEffect(()=>{if(sharedChat)setInputMode('chat');},[sharedChat?.id]);
  const preferences=useTranslationPreferences();
  const revision=JSON.stringify([status?.promptVersion,status?.providers,status?.models]);
  const transport=useMemo<Transport>(()=>{const wire=createTranslationTransport(url,token);const base=memoryEnabled?createTranslationMemory(wire).transport:wire;return (request,signal,emit)=>base(enrichRequest(request,preferences.data.terms),signal,emit);},[url,token,revision,memoryEnabled,preferences.data.terms]);
  const controller=useMemo(() => new LiveTranslationController(transport,setLive),[transport]);
  useEffect(() => () => controller.dispose(),[controller]);
  useEffect(() => {
    const abort=new AbortController();let alive=true;
    setStatus(undefined);setConnectionError('');setChecking(true);
    const timer=setTimeout(() => abort.abort(),10000);
    if (!url) {setConnectionError('نشانی سرور ترجمه را در تنظیمات اتصال وارد کنید.');setChecking(false);clearTimeout(timer);return;}
    checkTranslationServer(url,token,abort.signal).then(value => {if (alive) setStatus(value);}).catch(error => {
      if (alive) setConnectionError(error instanceof Error && error.name !== 'AbortError' && !(error instanceof TypeError) ? error.message : 'سرور ترجمه در دسترس نیست. ابتدا سرور را اجرا و نشانی اتصال را بررسی کنید.');
    }).finally(() => {clearTimeout(timer);if (alive) setChecking(false);});
    return () => {alive=false;clearTimeout(timer);abort.abort();};
  },[url,token,checkId]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node=inputRef.current as unknown as HTMLElement | null;
    const start=() => setComposing(true);const end=() => setComposing(false);
    node?.addEventListener?.('compositionstart',start);node?.addEventListener?.('compositionend',end);
    return () => {node?.removeEventListener?.('compositionstart',start);node?.removeEventListener?.('compositionend',end);};
  },[inputMode]);
  const isLocal=localProviders.includes(provider);
  const supportsOptions=providerSupportsOptions(provider);
  const ready=status?.providers ? !!status.providers[provider]?.configured && status.providers[provider]?.availableModes?.[mode]!==false : provider === 'openai' && !!status?.configured;
  const selectedModel=status?.providers?.[provider]?.models[mode];
  const request=useMemo<TranslationRequest>(() => ({provider,text,source,target,mode,tone,context}),[provider,text,source,target,mode,tone,context]);
  useEffect(() => {controller.update(ready ? request : null,auto && !composing && inputMode === 'text');setCopyMessage('');},[controller,request,ready,auto,composing,inputMode]);
  function selectProvider(value:ProviderId) {controller.update(null);if(!providerSupportsOptions(value)){setContext('');setTone('preserve');}setProvider(value);}
  function changeText(value:string) {controller.update(null);setText(value);}
  function swap() {
    controller.update(null);
    const next=live.phase === 'done' ? live.text : text;
    setSource(target);setText(next.length <= MAX_TEXT_LENGTH ? next : '');
  }
  async function copy() {
    try {if (Platform.OS === 'web') await navigator.clipboard.writeText(live.text);else await Share.share({message:live.text});setCopyMessage('انجام شد.');}
    catch {setCopyMessage('کپی انجام نشد؛ متن خروجی را انتخاب کنید.');}
  }
  const phases={idle:'منتظر متن',paused:composing ? 'منتظر تکمیل تایپ ژاپنی' : 'ترجمهٔ خودکار متوقف است',waiting:'در انتظار پایان تایپ…',translating:'در حال ترجمه…',done:'ترجمه کامل شد',error:'ترجمه انجام نشد'};
  return <>
    <View><T style={s.muted}>فارسی ↔ ژاپنی / ترجمهٔ زندهٔ متن و صدا</T><T style={s.title}>کلماتت، آن‌سوی زبان</T><T style={s.muted}>تایپ کن، ویس بفرست یا صحبت کن؛ ترجمه را ببین و بشنو.</T></View>
    <Card><T style={{fontWeight:'700'}}>انتخاب هوش مصنوعی</T>
      <T style={{fontSize:12,color:C.green,fontWeight:'700'}}>کاملاً رایگان در اجرای محلی · ترجمهٔ متن بدون کلید API</T>
      <Chips options={{translategemma:providerNames.translategemma,qwenlocal:providerNames.qwenlocal,libretranslate:providerNames.libretranslate}} value={provider} onChange={selectProvider}/>
      <T style={{fontSize:12,color:C.muted}}>سرویس‌های ابری · سهمیهٔ رایگان محدود یا API پولی</T>
      <Chips options={{gemini:providerNames.gemini,groq:providerNames.groq,openrouter:providerNames.openrouter,openai:providerNames.openai}} value={provider} onChange={selectProvider}/>
      <T testID="provider-cost" style={{fontSize:13,color:isLocal?C.green:C.muted,fontWeight:'700'}}>{isLocal?'کاملاً رایگان در اجرای محلی؛ بدون هزینهٔ هر ترجمه و سهمیهٔ تجاری.':provider==='openai'?'API پولی؛ اعتبار حساب لازم است.':'سهمیهٔ رایگان محدود؛ کاملاً رایگان و نامحدود نیست.'}</T>
      {isLocal ? <T style={s.muted}>موتور روی رایانهٔ خودتان اجرا می‌شود؛ نصب و دانلود اولیه لازم است. سخت‌افزار، برق و میزبانی احتمالی هزینهٔ خودتان است. این برچسب مربوط به ترجمهٔ متن است.</T> : <T style={s.muted}>{provider==='openrouter'?'مسیریاب فقط مدل‌های رایگان را انتخاب می‌کند؛ سهمیه و کیفیت می‌توانند متفاوت باشند.':'دسترسی مدل و سهمیه به حساب و منطقه وابسته است.'}</T>}
      {provider==='libretranslate'&&<T style={s.muted}>ترجمه ممکن است از واسطهٔ انگلیسی عبور کند؛ لحن و زمینهٔ سفارشی پشتیبانی نمی‌شود.</T>}
      {provider==='translategemma'&&<T style={s.muted}>مدل تخصصی ترجمه؛ فعلاً حفظ لحن متن، بدون زمینه یا لحن سفارشی.</T>}
      {provider === 'gemini' && <T style={s.muted}>در پلن رایگان Google، داده ممکن است برای بهبود محصولات استفاده شود.</T>}
      <T style={{fontSize:12,color:ready ? C.green : C.muted}}>{checking ? 'در حال بررسی…' : isLocal ? status?.providers?.[provider]?.message || 'در حال بررسی موتور محلی؛ «بررسی دوباره» را بزنید.' : ready ? 'کلید این سرویس تنظیم شده؛ دسترسی مدل هنگام درخواست بررسی می‌شود.' : 'کلید این سرویس هنوز تنظیم نشده است.'}</T>
      {!!selectedModel && <T style={{fontSize:11,color:C.muted,textAlign:'left'}}>{selectedModel}</T>}
    </Card>
    {provider==='openai'&&<OpenAISetup/>}
    <View style={ts.languageBar}>
      <View style={{flex:1,alignItems:'center'}}><T style={ts.language}>{languageNames[source]}</T><T style={s.muted}>متن شما</T></View>
      <Pressable accessibilityRole="button" accessibilityLabel="جابه‌جایی زبان‌ها" style={ts.swap} onPress={swap}><Icon name="swap-horizontal" color={C.green}/></Pressable>
      <View style={{flex:1,alignItems:'center'}}><T style={ts.language}>{languageNames[target]}</T><T style={s.muted}>ترجمه</T></View>
    </View>
    <Chips options={{text:'ترجمهٔ متن',voice:'ترجمهٔ صوتی',chat:'مترجم چت',image:'تصویر و اسکرین‌شات',travel:'همراه سفر',session:'جلسه و زیرنویس'}} value={inputMode} onChange={setInputMode}/>
    {inputMode === 'travel' ? <TravelPanel preferences={preferences} language={source} onUse={(value,language)=>{controller.update(null);setSource(language);setText(value);setInputMode('text');}}/> : inputMode === 'session' ? <SessionPanel url={url} token={token} request={request} status={status} ready={ready} transport={transport} preferences={preferences}/> : inputMode === 'image' ? <ScreenshotPanel url={url} token={token} status={status} language={source} onUse={value=>{setText(value);setInputMode('text');}}/> : inputMode === 'chat' ? <ChatPanel url={url} token={token} request={request} ready={ready} transport={transport} preferences={preferences} shared={sharedChat} onHandled={onSharedHandled}/> : inputMode === 'voice' ? <VoicePanel url={url} token={token} status={status} request={request} ready={ready} transport={transport} preferences={preferences} onDirectionChange={value=>{controller.update(null);setSource(value);}}/> : <>
    <Card style={{padding:17}}>
      <View style={s.between}><T style={{fontWeight:'700'}}>{languageNames[source]}</T><Pressable accessibilityRole="button" accessibilityLabel="پاک‌کردن متن" onPress={() => changeText('')} hitSlop={10}><Icon name="close-circle-outline" color={C.muted}/></Pressable></View>
      <TextInput ref={inputRef} accessibilityLabel="متن برای ترجمه" value={text} onChangeText={changeText} multiline maxLength={MAX_TEXT_LENGTH} autoCorrect={false} placeholder={source === 'fa' ? 'متن فارسی را اینجا بنویس…' : '日本語を入力してください…'} placeholderTextColor="#9AA69F" style={[s.input,ts.editor,{textAlign:source === 'fa' ? 'right' : 'left',writingDirection:source === 'fa' ? 'rtl' : 'ltr'}]}/>
      <View style={s.between}><View style={s.row}><Switch accessibilityLabel="ترجمهٔ خودکار هنگام تایپ" value={auto} onValueChange={setAuto} trackColor={{false:'#D5DED7',true:'#93BFA5'}} thumbColor={C.green}/><T style={s.muted}>هنگام تایپ</T></View><T style={s.muted}>{text.length.toLocaleString('fa-IR')} / {MAX_TEXT_LENGTH.toLocaleString('fa-IR')}</T></View>
    </Card>
    <Card style={{backgroundColor:'#EAF2E8',borderColor:'#D7E5D5',minHeight:185}}>
      <View style={s.between}><T style={{fontWeight:'700'}}>{languageNames[target]}</T><View style={s.row}>{['waiting','translating'].includes(live.phase) && <ActivityIndicator size="small" color={C.green}/>}<T style={{fontSize:11,color:C.green}}>{phases[live.phase]}</T></View></View>
      <T testID="translation-output" selectable accessibilityLabel="متن ترجمه" style={{fontSize:18,lineHeight:32,minHeight:80,textAlign:target === 'fa' ? 'right' : 'left',writingDirection:target === 'fa' ? 'rtl' : 'ltr',color:live.text ? C.ink : '#87988B'}}>{live.text || (ready ? 'ترجمه اینجا نمایش داده می‌شود.' : 'پس از اتصال سرویس، ترجمه اینجا نمایش داده می‌شود.')}</T>
      {live.phase === 'error' && <T accessibilityRole="alert" style={{color:C.danger,fontSize:13}}>{live.error}</T>}
      {live.phase === 'translating' && live.text ? <T style={{fontSize:11,color:C.muted}}>در حال دریافت؛ متن هنوز کامل نشده است.</T> : null}
      {live.phase === 'done' && <><View style={s.divider}/><T style={{fontSize:11,color:C.muted}}>{live.model} · زمان دریافت {((live.elapsedMs || 0)/1000).toLocaleString('fa-IR',{maximumFractionDigits:1})} ثانیه</T><Button secondary small title={Platform.OS === 'web' ? 'کپی ترجمه' : 'اشتراک ترجمه'} icon="copy-outline" onPress={() => void copy()}/></>}
      {live.phase==='done'&&<><QualityReview source={text} target={live.text}/><SavePhraseButton preferences={preferences} source={source} target={target} original={text} translated={live.text}/></>}
    {!!copyMessage && <T style={s.muted}>{copyMessage}</T>}
    </Card>
    <Button title={live.phase === 'error' ? 'تلاش دوباره' : auto ? 'ترجمهٔ همین متن' : 'ترجمه کن'} icon="language-outline" disabled={!ready || !text.trim() || composing || ['waiting','translating'].includes(live.phase)} onPress={() => controller.update(request,true,true)}/>
    {live.phase==='done'&&<Alternatives request={request} result={live.text} transport={transport} onChoose={value=>{controller.update(null);setLive({...live,phase:'done',text:value});}}/>}
    </>}
    <GlossaryPanel preferences={preferences}/>
    {!supportsOptions&&preferences.data.terms.length>0&&<T style={s.muted}>واژه‌نامه، زمینه و پیشنهاد جایگزین روی موتور انتخابی فعال نیستند؛ موتور سازگار دیگری مثل Qwen یا یکی از سرویس‌های ابری انتخاب کنید.</T>}
    <View style={s.row}><Switch accessibilityLabel="استفاده از حافظهٔ موقت ترجمه" value={memoryEnabled} onValueChange={setMemoryEnabled}/><View style={{flex:1}}><T style={s.muted}>ترجمه‌های کاملاً یکسان تا ۲ دقیقه در حافظهٔ همین جلسه دوباره استفاده شوند.</T></View></View>
    <T style={{fontSize:11,color:C.muted}}>فقط پاسخ کامل با همان زبان، لحن، زمینه و مدل؛ بدون ذخیره در فایل. با خاموش‌کردن، ترجمهٔ تازه درخواست می‌شود.</T>
    <Pressable accessibilityRole="button" onPress={() => setAdvanced(!advanced)} style={s.between}><T style={{fontWeight:'700'}}>لحن و کیفیت ترجمه</T><Icon name={advanced ? 'chevron-up' : 'chevron-down'} size={18}/></Pressable>
    {advanced && <Card><T style={{fontWeight:'700'}}>توازن سرعت و کیفیت</T><Chips options={modeNames} value={mode} onChange={setMode}/><T style={s.muted}>این حالت‌ها از مدل‌های تنظیم‌شدهٔ سرور استفاده می‌کنند؛ در برخی سرویس‌ها از جمله مدل‌های محلی، هر سه حالت ممکن است یک مدل باشند. کیفیت این جفت‌زبان هنوز ارزیابی نشده است.</T>{supportsOptions&&<><T style={{fontWeight:'700'}}>لحن</T><Chips options={toneNames} value={tone} onChange={setTone}/><TextInput accessibilityLabel="زمینهٔ اختیاری ترجمه" value={context} onChangeText={setContext} multiline maxLength={500} placeholder="زمینهٔ اختیاری: مثلاً ایمیل کاری به همکار ژاپنی" placeholderTextColor={C.muted} style={[s.input,{minHeight:80,textAlignVertical:'top'}]}/><T style={s.muted}>زمینه برای رفع ابهام فرستاده می‌شود و جزو خروجی ترجمه نیست.</T></>}</Card>}
    <Card style={{backgroundColor:ready ? C.paper : C.amber}}>
      <View style={s.between}><View style={s.row}>{checking ? <ActivityIndicator color={C.green}/> : <Icon name={ready ? 'checkmark-circle-outline' : 'server-outline'}/>}<T style={{fontWeight:'700'}}>{checking ? 'در حال بررسی اتصال' : ready ? 'سرویس آماده است' : status ? 'سرویس هنوز فعال نشده' : 'اتصال به سرویس ترجمه'}</T></View></View>
      <T style={s.muted}>{connectionError || (isLocal ? ready ? 'متن برای پردازش به موتور روی همین رایانه فرستاده می‌شود؛ کلید یا سرویس ابری برای ترجمهٔ متن استفاده نمی‌شود.' : status?.providers?.[provider]?.message || 'موتور محلی را اجرا و سپس «بررسی دوباره» را بزنید؛ کلید API لازم نیست.' : ready ? `متن و زمینه به ${providerNames[provider]}${provider === 'openrouter' ? ' و ارائه‌دهندهٔ مدل آن' : ''} فرستاده می‌شوند. این بخش متن را در دفترچه یا سرور ذخیره نمی‌کند؛ سیاست همان ارائه‌دهنده اعمال می‌شود.` : `جای کلید آماده است: ${provider.toUpperCase()}_API_KEY را در .env وارد و سرور را دوباره اجرا کنید.`)}</T>
      <View style={s.row}><View style={{flex:1}}><Button secondary small title="بررسی دوباره" disabled={checking} onPress={() => setCheckId(v => v+1)}/></View><View style={{flex:1}}><Button secondary small title="تنظیم اتصال" onPress={() => setSettings(!settings)}/></View></View>
      {settings && <View style={{gap:12}}><TextInput accessibilityLabel="نشانی سرور ترجمه" value={draftUrl} onChangeText={setDraftUrl} autoCapitalize="none" autoCorrect={false} placeholder="https://translate.example.com" style={[s.input,{textAlign:'left',writingDirection:'ltr'}]}/><TextInput accessibilityLabel="توکن اتصال به سرور" value={draftToken} onChangeText={setDraftToken} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="توکن اتصال سرور، در صورت تنظیم" style={s.input}/><T style={s.muted}>این توکن با کلید سرویس هوش مصنوعی فرق دارد و فقط در حافظهٔ همین جلسه نگه داشته می‌شود. در موبایل نشانی سرور خودتان را وارد کنید؛ localhost گوشی به رایانه اشاره نمی‌کند.</T><Button small title="اعمال تنظیمات اتصال" onPress={() => {try {const normalized=normalizeServerUrl(draftUrl);setUrl(normalized);setToken(draftToken.trim());setSettings(false);setCheckId(v => v+1);} catch(error) {setConnectionError(error instanceof Error ? error.message : 'نشانی نامعتبر است.');}}}/></View>}
    </Card>
    <T style={[s.muted,{textAlign:'center'}]}>ترجمهٔ زنده به سرعت شبکه و مدل وابسته است. برای متن حساس، بازبینی انسانی لازم است.</T>
  </>;
}
const ts=StyleSheet.create({languageBar:{flexDirection:'row-reverse',alignItems:'center',backgroundColor:'#E5ECDF',borderRadius:21,padding:14},language:{fontSize:20,lineHeight:29,fontWeight:'700'},swap:{width:44,height:44,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:'#FFFFFFB0'},editor:{minHeight:145,padding:8,borderWidth:0,backgroundColor:'transparent',fontSize:18,lineHeight:30,textAlignVertical:'top'}});
