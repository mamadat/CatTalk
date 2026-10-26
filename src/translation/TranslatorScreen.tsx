import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Platform,Pressable,Share,StyleSheet,Switch,TextInput,View} from 'react-native';
import {ProviderId,providerNames,Language,languageNames,MAX_TEXT_LENGTH,modeNames,toneNames,TranslationMode,TranslationRequest,TranslationStatus,TranslationTone} from '../../shared/translation';
import {Button,C,Card,Chips,Icon,s,T} from '../ui';
import {checkTranslationServer,createTranslationTransport,normalizeServerUrl} from './client';
import {VoicePanel} from './VoicePanel';
import {emptyLiveState,LiveTranslationController} from './controller';

function defaultUrl() {
  if (process.env.EXPO_PUBLIC_TRANSLATION_URL) return process.env.EXPO_PUBLIC_TRANSLATION_URL;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (['localhost','127.0.0.1'].includes(window.location.hostname)) return `${window.location.protocol}//${window.location.hostname}:8787`;
    return window.location.origin;
  }
  return '';
}
export function TranslatorScreen() {
  const [inputMode,setInputMode]=useState<'text'|'voice'>('text');
  const [provider,setProvider]=useState<ProviderId>('gemini');
  const [text,setText]=useState('');const [source,setSource]=useState<Language>('fa');
  const target:Language=source === 'fa' ? 'ja' : 'fa';
  const [mode,setMode]=useState<TranslationMode>('balanced');const [tone,setTone]=useState<TranslationTone>('preserve');
  const [context,setContext]=useState('');const [auto,setAuto]=useState(true);const [composing,setComposing]=useState(false);
  const [url,setUrl]=useState(defaultUrl);const [draftUrl,setDraftUrl]=useState(url);const [token,setToken]=useState('');const [draftToken,setDraftToken]=useState('');
  const [settings,setSettings]=useState(false);const [advanced,setAdvanced]=useState(false);const [connectionError,setConnectionError]=useState('');
  const [status,setStatus]=useState<TranslationStatus>();const [checking,setChecking]=useState(false);const [checkId,setCheckId]=useState(0);
  const [live,setLive]=useState(emptyLiveState);const [copyMessage,setCopyMessage]=useState('');
  const inputRef=useRef<TextInput>(null);
  const controller=useMemo(() => new LiveTranslationController(createTranslationTransport(url,token),setLive),[url,token]);
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
  },[]);
  const ready=status?.providers ? !!status.providers[provider]?.configured : provider === 'openai' && !!status?.configured;
  const selectedModel=status?.providers?.[provider]?.models[mode];
  const request=useMemo<TranslationRequest>(() => ({provider,text,source,target,mode,tone,context}),[provider,text,source,target,mode,tone,context]);
  useEffect(() => {controller.update(ready ? request : null,auto && !composing && inputMode === 'text');setCopyMessage('');},[controller,request,ready,auto,composing,inputMode]);
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
      <Chips options={providerNames} value={provider} onChange={value => {controller.update(null);setProvider(value);}}/>
      <T style={s.muted}>{provider === 'openai' ? 'API پولی؛ اعتبار حساب OpenAI لازم است.' : provider === 'openrouter' ? 'مدل‌های رایگان با سهمیهٔ محدود؛ مدل انتخابی خودکار است و کیفیت می‌تواند متفاوت باشد.' : 'سهمیهٔ رایگان محدود با کلید حساب؛ میزان سهمیه و دسترسی به حساب و منطقه بستگی دارد.'}</T>
      {provider === 'gemini' && <T style={s.muted}>در پلن رایگان Google، داده ممکن است برای بهبود محصولات استفاده شود.</T>}
      <T style={{fontSize:12,color:ready ? C.green : C.muted}}>{checking ? 'در حال بررسی…' : ready ? 'کلید این سرویس تنظیم شده؛ دسترسی مدل هنگام درخواست بررسی می‌شود.' : 'کلید این سرویس هنوز تنظیم نشده است.'}</T>
      {!!selectedModel && <T style={{fontSize:11,color:C.muted,textAlign:'left'}}>{selectedModel}</T>}
    </Card>
    <View style={ts.languageBar}>
      <View style={{flex:1,alignItems:'center'}}><T style={ts.language}>{languageNames[source]}</T><T style={s.muted}>متن شما</T></View>
      <Pressable accessibilityRole="button" accessibilityLabel="جابه‌جایی زبان‌ها" style={ts.swap} onPress={swap}><Icon name="swap-horizontal" color={C.green}/></Pressable>
      <View style={{flex:1,alignItems:'center'}}><T style={ts.language}>{languageNames[target]}</T><T style={s.muted}>ترجمه</T></View>
    </View>
    <Chips options={{text:'ترجمهٔ متن',voice:'ترجمهٔ صوتی'}} value={inputMode} onChange={setInputMode}/>
    {inputMode === 'voice' ? <VoicePanel url={url} token={token} status={status} request={request} ready={ready}/> : <>
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
      {!!copyMessage && <T style={s.muted}>{copyMessage}</T>}
    </Card>
    <Button title={live.phase === 'error' ? 'تلاش دوباره' : auto ? 'ترجمهٔ همین متن' : 'ترجمه کن'} icon="language-outline" disabled={!ready || !text.trim() || composing} onPress={() => controller.update(request,true,true)}/>
    </>}
    <Pressable accessibilityRole="button" onPress={() => setAdvanced(!advanced)} style={s.between}><T style={{fontWeight:'700'}}>لحن و کیفیت ترجمه</T><Icon name={advanced ? 'chevron-up' : 'chevron-down'} size={18}/></Pressable>
    {advanced && <Card><T style={{fontWeight:'700'}}>توازن سرعت و کیفیت</T><Chips options={modeNames} value={mode} onChange={setMode}/><T style={s.muted}>این حالت‌ها از مدل‌های تنظیم‌شدهٔ سرور استفاده می‌کنند؛ در Gemini و OpenRouter ممکن است هر سه یک مدل باشند. کیفیت این جفت‌زبان هنوز ارزیابی نشده است.</T><T style={{fontWeight:'700'}}>لحن</T><Chips options={toneNames} value={tone} onChange={setTone}/><TextInput accessibilityLabel="زمینهٔ اختیاری ترجمه" value={context} onChangeText={setContext} multiline maxLength={500} placeholder="زمینهٔ اختیاری: مثلاً ایمیل کاری به همکار ژاپنی" placeholderTextColor={C.muted} style={[s.input,{minHeight:80,textAlignVertical:'top'}]}/><T style={s.muted}>زمینه برای رفع ابهام فرستاده می‌شود و جزو خروجی ترجمه نیست.</T></Card>}
    <Card style={{backgroundColor:ready ? C.paper : C.amber}}>
      <View style={s.between}><View style={s.row}>{checking ? <ActivityIndicator color={C.green}/> : <Icon name={ready ? 'checkmark-circle-outline' : 'server-outline'}/>}<T style={{fontWeight:'700'}}>{checking ? 'در حال بررسی اتصال' : ready ? 'سرویس آماده است' : status ? 'سرویس هنوز فعال نشده' : 'اتصال به سرویس ترجمه'}</T></View></View>
      <T style={s.muted}>{connectionError || (ready ? `متن و زمینه به ${providerNames[provider]}${provider === 'openrouter' ? ' و ارائه‌دهندهٔ مدل آن' : ''} فرستاده می‌شوند. این بخش متن را در دفترچه یا سرور ذخیره نمی‌کند؛ سیاست پردازش همان ارائه‌دهنده اعمال می‌شود.` : `جای کلید آماده است: ${provider.toUpperCase()}_API_KEY را در فایل .env پروژه وارد کنید و سرور را دوباره اجرا کنید. کلید را در اپ وارد نکنید.`)}</T>
      <View style={s.row}><View style={{flex:1}}><Button secondary small title="بررسی دوباره" disabled={checking} onPress={() => setCheckId(v => v+1)}/></View><View style={{flex:1}}><Button secondary small title="تنظیم اتصال" onPress={() => setSettings(!settings)}/></View></View>
      {settings && <View style={{gap:12}}><TextInput accessibilityLabel="نشانی سرور ترجمه" value={draftUrl} onChangeText={setDraftUrl} autoCapitalize="none" autoCorrect={false} placeholder="https://translate.example.com" style={[s.input,{textAlign:'left',writingDirection:'ltr'}]}/><TextInput accessibilityLabel="توکن اتصال به سرور" value={draftToken} onChangeText={setDraftToken} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="توکن اتصال سرور، در صورت تنظیم" style={s.input}/><T style={s.muted}>این توکن با کلید سرویس هوش مصنوعی فرق دارد و فقط در حافظهٔ همین جلسه نگه داشته می‌شود. در موبایل نشانی سرور خودتان را وارد کنید؛ localhost گوشی به رایانه اشاره نمی‌کند.</T><Button small title="اعمال تنظیمات اتصال" onPress={() => {try {const normalized=normalizeServerUrl(draftUrl);setUrl(normalized);setToken(draftToken.trim());setSettings(false);setCheckId(v => v+1);} catch(error) {setConnectionError(error instanceof Error ? error.message : 'نشانی نامعتبر است.');}}}/></View>}
    </Card>
    <T style={[s.muted,{textAlign:'center'}]}>ترجمهٔ زنده به سرعت شبکه و مدل وابسته است. برای متن حساس، بازبینی انسانی لازم است.</T>
  </>;
}
const ts=StyleSheet.create({languageBar:{flexDirection:'row-reverse',alignItems:'center',backgroundColor:'#E5ECDF',borderRadius:21,padding:14},language:{fontSize:20,lineHeight:29,fontWeight:'700'},swap:{width:44,height:44,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:'#FFFFFFB0'},editor:{minHeight:145,padding:8,borderWidth:0,backgroundColor:'transparent',fontSize:18,lineHeight:30,textAlignVertical:'top'}});
