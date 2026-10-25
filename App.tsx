import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Linking, Modal, Pressable, ScrollView, StatusBar, StyleSheet, TextInput, View} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {AudioClip, behaviors, calls, Cat, Context, Cue, cueInfo, emptyContext, initialStore, Intent, intents, interpret, places, Session, Store, uid} from './src/domain';
import {loadStore, saveStore} from './src/storage';
import {removeAudio} from './src/audioFiles';
import {Playback, Recorder} from './src/Recorder';
import {Button, C, Card, Chips, Icon, IconName, s, T} from './src/ui';
import {TranslatorScreen} from './src/translation/TranslatorScreen';

type Tab = 'home' | 'listen' | 'speak' | 'history' | 'cats' | 'translate';
const tabs: {id:Tab; title:string; icon:IconName}[] = [
  {id:'home',title:'خانه',icon:'grid-outline'}, {id:'listen',title:'بشنو',icon:'mic-outline'},
  {id:'speak',title:'بگو',icon:'chatbubble-ellipses-outline'}, {id:'translate',title:'ترجمه',icon:'language-outline'}, {id:'history',title:'دفترچه',icon:'book-outline'}, {id:'cats',title:'گربه‌ها',icon:'paw-outline'},
];
const date = (iso: string) => new Date(iso).toLocaleDateString('fa-IR', {month:'long', day:'numeric', hour:'2-digit', minute:'2-digit'});
export default function App() {return <SafeAreaProvider><CatTalk/></SafeAreaProvider>;}
function CatTalk() {
  const [store, setStore] = useState<Store>(initialStore);
  const storeRef = useRef(store);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<Tab>('home');
  const [notice, setNotice] = useState('');
  const [science, setScience] = useState(false);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [context, setContext] = useState<Context>(emptyContext);
  const [clip, setClip] = useState<AudioClip>();
  const [result, setResult] = useState<Session>();
  const [confirm, setConfirm] = useState<{message:string; action:() => Promise<void>}>();
  const [activeCue, setActiveCue] = useState<Cue['kind']>();
  const [trialCue, setTrialCue] = useState<string>();
  const queue = useRef(Promise.resolve());
  const scroll = useRef<ScrollView>(null);
  async function load() {try {const loaded = await loadStore(); setStore(loaded); storeRef.current = loaded; setReady(true); setLoadError('');} catch {setLoadError('داده‌های محلی خوانده نشدند. برای جلوگیری از ازدست‌رفتن اطلاعات، ذخیره‌سازی متوقف است.');}}
  useEffect(() => {void load();}, []);
  // Serialize read-modify-write transactions; commit UI only after durable storage succeeds.
  function update(fn: (old: Store) => Store): Promise<void> {
    const next = queue.current.then(async () => {
      const value = fn(storeRef.current);
      await saveStore(value); storeRef.current = value; setStore(value);
    });
    queue.current = next.catch(() => {});
    return next;
  }
  async function guarded(action: () => Promise<void>) {
    setSaving(true);
    try {await action();} catch {setNotice('ذخیره انجام نشد. فضای دستگاه یا مجوز ذخیره‌سازی را بررسی کنید و دوباره تلاش کنید.');}
    finally {setSaving(false);}
  }
  const cat = store.cats.find(c => c.id === store.selectedCatId) || store.cats[0];
  const sessions = store.sessions.filter(v => v.catId === cat?.id);
  const cues = store.cues.filter(v => v.catId === cat?.id);
  function navigate(next: Tab) { if (recording || saving) {setNotice('ابتدا ضبط یا ذخیرهٔ جاری را تمام کنید.'); return;} setTab(next); setTrialCue(undefined); scroll.current?.scrollTo({y:0, animated:false}); }
  async function discardDraft() {if (clip) await removeAudio(clip.uri); setClip(undefined); setResult(undefined); setContext(emptyContext);}
  async function chooseCat(id: string) {await update(old => ({...old,selectedCatId:id})); await discardDraft();}
  async function saveSession() {
    if (!cat) {navigate('cats'); return;}
    await guarded(async () => {
      const session:Session = {id:uid(), catId:cat.id, createdAt:new Date().toISOString(), context:{...context}, audio:clip, result:interpret(context,cat.id,storeRef.current.sessions)};
      await update(old => ({...old,sessions:[session,...old.sessions]}));
      setResult(session); setClip(undefined);
    });
  }
  async function deleteSession(session:Session) {await update(old => ({...old,sessions:old.sessions.filter(v => v.id !== session.id)})); if (session.audio) await removeAudio(session.audio.uri); if (result?.id === session.id) setResult(undefined);}
  async function deleteCat(target:Cat) {
    const old = storeRef.current;
    const files = [...old.sessions.filter(v => v.catId === target.id).map(v => v.audio?.uri),...old.cues.filter(v => v.catId === target.id).map(v => v.audio.uri)].filter(Boolean) as string[];
    await update(value => {const cats = value.cats.filter(c => c.id !== target.id); return {...value,cats,selectedCatId: value.selectedCatId === target.id ? cats[0]?.id || '' : value.selectedCatId,sessions:value.sessions.filter(v => v.catId !== target.id),cues:value.cues.filter(v => v.catId !== target.id)};});
    await Promise.all(files.map(removeAudio)); await discardDraft();
  }
  const header = <View style={styles.header}><View style={s.row}><View style={styles.logo}><Icon name="paw" color={C.green}/></View><View><T style={{fontSize:22,fontWeight:'800',lineHeight:27,textAlign:'left'}}>CatTalk</T><T style={{fontSize:10,color:C.muted}}>کمی نزدیک‌تر به دنیای گربه‌ات</T></View></View><Pressable accessibilityRole="button" accessibilityLabel="دربارهٔ علم و حریم خصوصی" onPress={() => setScience(true)} style={styles.info}><Icon name="information-outline" size={20}/></Pressable></View>;
  if (!ready) return <SafeAreaView style={styles.safe}><View style={{padding:32,flex:1,justifyContent:'center',gap:20}}>{loadError ? <><T>{loadError}</T><Button title="تلاش دوباره" onPress={() => void load()}/></> : <><ActivityIndicator color={C.green}/><T style={{textAlign:'center'}}>دفترچهٔ گربه‌ها آماده می‌شود…</T></>}</View></SafeAreaView>;
  return <SafeAreaView style={styles.safe} edges={['top','bottom']}><StatusBar barStyle="dark-content" backgroundColor={C.bg}/><View style={styles.shell}>
    {header}
    {!!notice && <Pressable accessibilityRole="button" onPress={() => setNotice('')} style={styles.notice}><T accessibilityRole="alert" style={{fontSize:13}}>{notice} ×</T></Pressable>}
    <ScrollView ref={scroll} style={{flex:1}} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {tab === 'home' && <>
        <View><T style={s.muted}>یک گفت‌وگوی کوچک، یک رابطهٔ نزدیک‌تر</T><T style={s.title}>{cat ? `دنیای ${cat.name} را بهتر بشناس` : 'هر میو، شروع یک ارتباط'}</T></View>
        <Pressable accessibilityRole="button" accessibilityLabel="بازکردن ترجمهٔ فارسی و ژاپنی" onPress={() => navigate('translate')} style={[styles.translationBanner,s.between]}><View style={{flex:1}}><T style={{fontWeight:'700',fontSize:17}}>فارسی ↔ 日本語</T><T style={s.muted}>ترجمهٔ زندهٔ متن، هنگام تایپ</T></View><Icon name="language-outline" size={29}/></Pressable>
        <View style={styles.hero}>
          <View style={s.between}><View style={[s.badge,{backgroundColor:'#FFFFFF80'}]}><T style={{fontSize:11}}>همراه ارتباط با گربه</T></View><Icon name="sparkles-outline" color={C.green}/></View>
          <View style={styles.catArt}><View style={styles.halo}/><T style={styles.catEmoji}>🐈</T><View style={styles.bubble}><T style={{fontSize:13}}>میو… من اینجام!</T></View></View>
          <T style={{fontSize:25,fontWeight:'800',lineHeight:37}}>بشنو. مشاهده کن. نزدیک‌تر شو.</T>
          <T style={{color:'#416651',fontSize:14}}>صدایش را ثبت کن، موقعیتش را بشناس و یک برداشت محتاطانه بگیر.</T>
          <Button title={cat ? 'صدای گربه‌ام را ثبت کنم' : 'اول، گربه‌ام را معرفی کنم'} icon={cat ? 'mic-outline' : 'add'} onPress={() => navigate(cat ? 'listen' : 'cats')}/>
        </View>
        <View style={styles.duo}>
          <Pressable accessibilityRole="button" style={[styles.tile,{backgroundColor:'#E9EDE2'}]} onPress={() => navigate(cat ? 'speak' : 'cats')}><Icon name="chatbubble-ellipses-outline"/><T style={{fontWeight:'700',fontSize:17}}>نوبت توست</T><T style={s.muted}>پیام‌های آشنا، با صدای خودت</T><Icon name="arrow-back" size={18}/></Pressable>
          <Pressable accessibilityRole="button" style={[styles.tile,{backgroundColor:'#F1E8DB'}]} onPress={() => navigate('history')}><Icon name="book-outline"/><T style={{fontWeight:'700',fontSize:17}}>دفترچهٔ مشترک</T><T style={s.muted}>{sessions.length.toLocaleString('fa-IR')} مشاهده ثبت شده</T><Icon name="arrow-back" size={18}/></Pressable>
        </View>
        <Card><View style={s.row}><Icon name="leaf-outline"/><T style={s.subtitle}>یک قدم برای امروز</T></View><T>آرام پلک بزن و به گربه فرصت بده خودش نزدیک شود. پاسخ‌ندادن هم یک مشاهدهٔ ارزشمند است.</T><Pressable onPress={() => setScience(true)}><T style={{color:C.green,fontSize:13}}>این پیشنهاد از کجا آمده؟ ←</T></Pressable></Card>
        <View style={s.row}><Icon name="shield-checkmark-outline" size={18} color={C.muted}/><T style={[s.muted,{flex:1}]}>محلی و خصوصی • بدون ارسال صدا به سرور</T></View>
      </>}
      {tab === 'listen' && <>
        <View><T style={s.muted}>گربه به انسان / ثبت و تفسیر</T><T style={s.title}>این بار چه می‌گوید؟</T><T style={s.muted}>{cat ? `مشاهده برای ${cat.name}` : 'ابتدا یک گربه اضافه کنید.'}</T></View>
        {!cat ? <Button title="افزودن گربه" onPress={() => navigate('cats')}/> : result ? <>
          <ResultCard session={result}/>
          <Feedback session={store.sessions.find(v => v.id === result.id) || result} onSave={(feedback,outcome) => update(old => ({...old,sessions:old.sessions.map(v => v.id === result.id ? {...v,feedback,outcome} : v)}))}/>
          <Button title="ثبت مشاهدهٔ تازه" icon="add" onPress={() => {setResult(undefined);setContext(emptyContext);}}/>
        </> : <>
          <Card style={{backgroundColor:C.mint}}><View style={s.between}><T style={s.subtitle}>۱. صدایش را نگه دار</T><Icon name="mic-outline"/></View><T style={s.muted}>ضبط اختیاری است. این نسخه معنای صدا را تحلیل نمی‌کند؛ برداشت از مشاهدات مرحلهٔ بعد ساخته می‌شود.</T>
            {clip ? <><Playback clip={clip}/><Button title="حذف ضبط و تلاش دوباره" secondary small onPress={() => void guarded(async () => {await removeAudio(clip.uri);setClip(undefined);})}/></> : <Recorder onBusy={setRecording} onRecorded={async value => setClip(value)}/>}
          </Card>
          <Card><T style={s.subtitle}>۲. چه چیزی می‌بینی؟</T><T style={s.muted}>پیش از دیدن برداشت، مشاهدات خودت را ثبت کن.</T><T style={{fontWeight:'700'}}>گربه کجاست؟</T><Chips options={places} value={context.place} onChange={place => setContext(v => ({...v,place}))}/><T style={{fontWeight:'700'}}>زبان بدنش چطور است؟</T><Chips options={behaviors} value={context.behavior} onChange={behavior => setContext(v => ({...v,behavior}))}/><T style={{fontWeight:'700'}}>چه صدایی شنیدی؟</T><Chips options={calls} value={context.call} onChange={call => setContext(v => ({...v,call}))}/></Card>
          <Button title={saving ? 'در حال ذخیره…' : 'ثبت و مشاهدهٔ برداشت'} icon="sparkles-outline" disabled={saving || recording} onPress={() => void saveSession()}/>
          <T style={[s.muted,{textAlign:'center'}]}>بدون درصد اطمینان ساختگی، بدون ترجمهٔ قطعی</T>
        </>}
      </>}
      {tab === 'speak' && <>
        <View><T style={s.muted}>انسان به گربه / نشانه‌های آموختنی</T><T style={s.title}>با صدای آشنای تو</T><T style={s.muted}>پیام کوتاه، موقعیت ثابت و فرصت یادگیری.</T></View>
        <Card style={{backgroundColor:C.amber}}><View style={s.row}><Icon name="bulb-outline"/><T style={{flex:1,fontSize:13}}>این پیام‌ها میوی ترجمه‌شده نیستند. گربه می‌تواند با تمرین، صدای شما را به یک رویداد مرتبط کند؛ موفقیت تضمین‌شده نیست.</T></View></Card>
        {!cat ? <Button title="افزودن گربه" onPress={() => navigate('cats')}/> : (Object.keys(cueInfo) as Cue['kind'][]).map(kind => {
          const info = cueInfo[kind]; const cue = cues.find(v => v.kind === kind);
          return <Card key={`${cat.id}-${kind}`} disabled={recording && activeCue !== kind}><View style={s.between}><View style={s.row}><Icon name={info.icon}/><T style={s.subtitle}>{info.title}</T></View><T style={s.muted}>{cat.name}</T></View><T style={s.muted}>{info.guide}</T>
            {activeCue === kind ? <Recorder maxSeconds={8} title="ضبط پیام من" onBusy={setRecording} onRecorded={async audio => {
              await update(old => ({...old,cues:[...old.cues.filter(v => !(v.catId === cat.id && v.kind === kind)),{id:uid(),catId:cat.id,kind,audio,trials:0,responses:0}]}));
              setActiveCue(undefined); if (cue) await removeAudio(cue.audio.uri).catch(() => {});
            }}/> : cue ? <><Playback clip={cue.audio}/><T style={s.muted}>{cue.responses.toLocaleString('fa-IR')} واکنش مرتبط از {cue.trials.toLocaleString('fa-IR')} مشاهدهٔ ثبت‌شده؛ این آمار دقت ترجمه نیست.</T>
              {trialCue === cue.id ? <><T style={{fontSize:13}}>آیا واکنش مرتبط با پیام دیدی؟</T><View style={s.row}>{[true,false].map(yes => <View style={{flex:1}} key={String(yes)}><Button small secondary title={yes ? 'بله، مرتبط بود' : 'نه / نامشخص'} onPress={() => void guarded(async () => {await update(old => ({...old,cues:old.cues.map(v => v.id === cue.id ? {...v,trials:v.trials+1,responses:v.responses+(yes ? 1 : 0)} : v)}));setTrialCue(undefined);})}/></View>)}</View></> : <Button title="ثبت نتیجهٔ یک تعامل" secondary small onPress={() => setTrialCue(cue.id)}/>}
              <Button title="جایگزینی پیام و شروع شمارش تازه" secondary small disabled={recording} onPress={() => setActiveCue(kind)}/>
            </> : <Button title="ساخت پیام با صدای خودم" secondary icon="mic-outline" disabled={recording} onPress={() => setActiveCue(kind)}/>}
            {activeCue === kind && !recording && <Button title="انصراف" secondary small onPress={() => setActiveCue(undefined)}/>}
          </Card>;
        })}
      </>}
      {tab === 'history' && <>
        <View><T style={s.muted}>مشاهده‌های کوچک، شناخت بیشتر</T><T style={s.title}>دفترچهٔ {cat?.name || 'گربه‌ها'}</T></View>
        {sessions.length === 0 ? <Card style={{paddingVertical:36}}><Icon name="book-outline" size={36}/><T style={s.subtitle}>اولین صفحه هنوز خالی است</T><T style={s.muted}>هر مشاهده و نتیجه‌اش اینجا باقی می‌ماند؛ حتی وقتی برداشت «نامشخص» باشد.</T><Button title="ثبت اولین مشاهده" onPress={() => navigate(cat ? 'listen' : 'cats')}/></Card> : sessions.map(session => <Card key={session.id}><View style={s.between}><T style={s.muted}>{date(session.createdAt)}</T><Pressable accessibilityRole="button" accessibilityLabel="حذف این مشاهده" hitSlop={12} onPress={() => setConfirm({message:'این مشاهده و صدای آن از دستگاه حذف شود؟',action:() => deleteSession(session)})}><Icon name="trash-outline" size={19} color={C.muted}/></Pressable></View><T style={s.subtitle}>{intents[session.result.intent]}</T><T style={s.muted}>{places[session.context.place]} • {behaviors[session.context.behavior]}</T><T style={{fontSize:13}}>{session.result.action}</T>{session.audio && <Playback clip={session.audio}/>}<Feedback session={session} onSave={(feedback,outcome) => update(old => ({...old,sessions:old.sessions.map(v => v.id === session.id ? {...v,feedback,outcome} : v)}))}/></Card>)}
      </>}
      {tab === 'cats' && <>
        <View><T style={s.muted}>هر گربه، دنیای خودش را دارد</T><T style={s.title}>دوست‌های کوچک من</T></View>
        {store.cats.map(target => <Card key={target.id} style={target.id === cat?.id ? {borderColor:C.green,backgroundColor:'#EFF5EC'} : undefined}><View style={s.between}><View style={s.row}><View style={styles.avatar}><Icon name="paw-outline" size={27}/></View><View><T style={s.subtitle}>{target.name}</T><T style={s.muted}>{target.age ? `${target.age} ساله` : 'سن ثبت نشده'} • {store.sessions.filter(v => v.catId === target.id).length.toLocaleString('fa-IR')} مشاهده</T></View></View><Pressable accessibilityRole="button" accessibilityLabel={`حذف ${target.name}`} hitSlop={12} onPress={() => setConfirm({message:`پروفایل ${target.name} و تمام صداها و مشاهدات مرتبط حذف شود؟`,action:() => deleteCat(target)})}><Icon name="trash-outline" size={19} color={C.danger}/></Pressable></View>{target.id === cat?.id ? <T style={{fontSize:12,color:C.green}}>● پروفایل انتخاب‌شده</T> : <Button secondary small title="انتخاب این گربه" onPress={() => void guarded(() => chooseCat(target.id))}/>}</Card>)}
        <CatForm onAdd={async (name,age) => {const id=uid(); await update(old => ({...old,cats:[...old.cats,{id,name,age}],selectedCatId:id})); await discardDraft();setNotice('پروفایل ساخته شد. حالا می‌توانید اولین مشاهده را ثبت کنید.');}}/>
        <Card><View style={s.row}><Icon name="lock-closed-outline"/><T style={s.subtitle}>داده‌ها پیش خودت می‌مانند</T></View><T style={s.muted}>صداها، پیام‌ها و دفترچه روی همین دستگاه ذخیره می‌شوند. حذف اپ یا پاک‌کردن داده‌های مرورگر ممکن است آن‌ها را حذف کند. هیچ آپلود خودکاری وجود ندارد.</T><Button title="روش کار و منابع علمی" secondary small onPress={() => setScience(true)}/></Card>
      </>}
      {tab === 'translate' && <TranslatorScreen/>}
      <T style={{textAlign:'center',fontSize:10,color:'#8A978E',paddingTop:10}}>CATTALK · برای رابطه‌ای آگاهانه‌تر</T>
    </ScrollView>
    <View style={styles.nav}>{tabs.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.title} accessibilityState={{selected:tab === item.id,disabled:recording}} onPress={() => navigate(item.id)} style={styles.navItem}><View style={[styles.navIcon,tab === item.id && {backgroundColor:C.mint}]}><Icon name={item.icon} size={23} color={tab === item.id ? C.green : '#8B968E'}/></View><T style={{fontSize:11,lineHeight:19,color:tab === item.id ? C.green : C.muted,fontWeight:tab === item.id ? '700' : '400'}}>{item.title}</T></Pressable>)}</View>
  </View>
  <Modal visible={science} animationType="slide" onRequestClose={() => setScience(false)}><SafeAreaView style={styles.safe}><View style={styles.shell}><View style={styles.header}><T style={s.subtitle}>علم، محدودیت‌ها و حریم خصوصی</T><Button small secondary title="بستن" onPress={() => setScience(false)}/></View><ScrollView contentContainerStyle={styles.content}><Science/></ScrollView></View></SafeAreaView></Modal>
  <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => !saving && setConfirm(undefined)}><View style={styles.overlay}><Card style={{width:'100%',maxWidth:420}}><Icon name="trash-outline" color={C.danger}/><T>{confirm?.message}</T><Button title={saving ? 'در حال حذف…' : 'حذف از دستگاه'} danger disabled={saving} onPress={() => void guarded(async () => {await confirm?.action();setConfirm(undefined);})}/><Button title="انصراف" secondary disabled={saving} onPress={() => setConfirm(undefined)}/></Card></View></Modal>
  </SafeAreaView>;
}

function ResultCard({session}: {session: Session}) {return <Card><View style={s.badge}><T style={{fontSize:11}}>فرضیهٔ زمینه‌محور • اعتبارسنجی‌نشده</T></View><T style={s.title}>{intents[session.result.intent]}</T>{session.result.reasons.map(reason => <T key={reason} style={{fontSize:13}}>• {reason}</T>)}{!!session.result.alternatives.length && <T style={s.muted}>برداشت دیگر: {session.result.alternatives.map(v => intents[v]).join('، ')}</T>}<View style={s.divider}/><T style={{fontWeight:'700'}}>قدم بعدی</T><T>{session.result.action}</T>{session.audio && <Playback clip={session.audio}/>}<T style={s.muted}>این برداشت از اطلاعات ثبت‌شدهٔ شما ساخته شده، نه از تشخیص خودکار معنای صدا.</T></Card>;}
function Feedback({session,onSave}: {session:Session;onSave:(feedback:Intent,outcome:string) => Promise<void>}) {
  const [editing,setEditing] = useState(false); const [feedback,setFeedback] = useState<Intent>(session.feedback || 'unknown'); const [outcome,setOutcome] = useState(session.outcome || ''); const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  return <View style={{gap:10}}>{editing ? <><T style={{fontWeight:'700'}}>برداشت خودت بعد از مشاهده چیست؟</T><Chips options={intents} value={feedback} onChange={setFeedback}/><TextInput accessibilityLabel="نتیجهٔ قابل مشاهده" multiline maxLength={500} value={outcome} onChangeText={setOutcome} placeholder="چه اتفاقی افتاد؟ مثلاً بعد از بازشدن در، عبور کرد." placeholderTextColor={C.muted} style={[s.input,{minHeight:88,textAlignVertical:'top'}]}/><Button title={busy ? 'در حال ثبت…' : 'ذخیرهٔ بازخورد'} disabled={busy} secondary small onPress={() => {setBusy(true);setError('');onSave(feedback,outcome.trim()).then(() => setEditing(false)).catch(() => setError('ذخیره انجام نشد؛ دوباره تلاش کنید.')).finally(() => setBusy(false));}}/>{!!error && <T style={{color:C.danger}}>{error}</T>}<Button title="انصراف" secondary small disabled={busy} onPress={() => setEditing(false)}/></> : <>{session.feedback && <T style={s.muted}>برداشت شما: {intents[session.feedback]}{session.outcome ? `\nنتیجه: ${session.outcome}` : ''}</T>}<Button title={session.feedback ? 'ویرایش بازخورد' : 'بعدش چه اتفاقی افتاد؟'} icon="create-outline" secondary small onPress={() => setEditing(true)}/></>}</View>;
}
function CatForm({onAdd}: {onAdd:(name:string,age:string) => Promise<void>}) {
  const [name,setName]=useState(''); const [age,setAge]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  return <Card><T style={s.subtitle}>یک دوست تازه اضافه کن</T><TextInput accessibilityLabel="نام گربه" value={name} onChangeText={setName} maxLength={30} placeholder="اسم گربه‌ات چیست؟" placeholderTextColor={C.muted} style={s.input}/><TextInput accessibilityLabel="سن گربه" value={age} onChangeText={setAge} maxLength={5} keyboardType="decimal-pad" placeholder="سن به سال (اختیاری)" placeholderTextColor={C.muted} style={s.input}/><Button title={busy ? 'در حال ذخیره…' : 'افزودن پروفایل'} icon="add" disabled={busy || !name.trim()} onPress={() => {
    const normalized=age.replace(/[۰-۹]/g,c => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace('٫','.');
    if (age && (!Number.isFinite(Number(normalized)) || Number(normalized) < 0 || Number(normalized) > 40)) {setError('سن را به سال و بین صفر تا ۴۰ وارد کنید.');return;}
    setBusy(true);setError('');onAdd(name.trim(),age.trim()).then(() => {setName('');setAge('');}).catch(() => setError('ذخیرهٔ پروفایل ناموفق بود.')).finally(() => setBusy(false));
  }}/>{!!error && <T style={{color:C.danger}}>{error}</T>}</Card>;
}
function Science() {
  const sources = [
    ['مرور ارتباط صوتی گربه‌ها · ۲۰۲۰','https://pubmed.ncbi.nlm.nih.gov/32017479/'],
    ['طبقه‌بندی سه موقعیت صوتی · ۲۰۱۹','https://pmc.ncbi.nlm.nih.gov/articles/PMC6719916/'],
    ['دیتاست CatMeows · ۲۰۲۰','https://zenodo.org/records/4008297'],
    ['پلک‌زدن آهسته · ۲۰۲۰','https://www.nature.com/articles/s41598-020-73426-0'],
    ['تشخیص گفتار صاحب گربه · ۲۰۲۲','https://pubmed.ncbi.nlm.nih.gov/36280656/'],
    ['ارتباط چندحسی · ۲۰۲۳','https://pmc.ncbi.nlm.nih.gov/articles/PMC10177025/'],
    ['یادگیری ارتباط واژه و تصویر · ۲۰۲۴','https://www.nature.com/articles/s41598-024-74006-2'],
  ];
  return <><Card style={{backgroundColor:C.mint}}><T style={s.title}>شناخت بیشتر، ادعای کمتر.</T><T>CatTalk یک دفترچهٔ ارتباط و دستیار فرضیه‌سازی است. در نسخهٔ فعلی هیچ مدل آموزش‌دیدهٔ تشخیص معنای میو، تشخیص نوع صدا یا تحلیل ویدئو فعال نیست.</T></Card><Card><T style={s.subtitle}>برداشت‌ها چگونه ساخته می‌شوند؟</T><T>قواعد شفاف از مکان و رفتار گزارش‌شده استفاده می‌کنند. فیس‌کردن یا دورشدن، پیشنهاد فاصله‌دادن را در اولویت قرار می‌دهد. خرخر و میوی تنها به معنی شادی یا گرسنگی فرض نمی‌شوند.</T><T>پس از حداقل سه بازخورد در موقعیت مشابه برای همان گربه، توافق بازخوردها می‌تواند وزن یک برداشت موجود را کمی افزایش دهد. این سازگاری ساده، آموزش مدل صوتی یا اعتبارسنجی علمی نیست.</T><T>دقت گزارش‌شدهٔ پژوهش‌های محدود را نمی‌توان دقت این اپ دانست. تشخیص درد، بیماری و ترجمهٔ جمله‌به‌جملهٔ صدای گربه خارج از توان این نسخه است.</T></Card><Card><T style={s.subtitle}>داده‌ها و ضبط</T><T>صدا و اطلاعات بخش گربه‌ها فقط محلی ذخیره می‌شوند؛ آپلود صدا وجود ندارد. در بخش جداگانهٔ ترجمهٔ فارسی–ژاپنی، متن و زمینهٔ واردشده برای پردازش به سرویس OpenAI ارسال می‌شوند. ضبط با درخواست شما آغاز و حداکثر پس از ۲۰ ثانیه متوقف می‌شود. برای پیام انسانی این حد ۸ ثانیه است.</T><T>در مرورگر، میکروفون به HTTPS یا localhost نیاز دارد. پاک‌کردن داده‌های مرورگر یا حذف اپ ممکن است دفترچه را حذف کند. هنگام پخش پیام، اگر گربه دور شد یا تنش نشان داد، پخش را متوقف کنید.</T></Card><Card><T style={s.subtitle}>منابع پایه</T><T style={s.muted}>این پژوهش‌ها الهام‌بخش طراحی‌اند و آزمون اثربخشی این اپ نیستند.</T>{sources.map(([title,url]) => <Pressable key={url} accessibilityRole="link" onPress={() => void Linking.openURL(url)} style={{paddingVertical:10,borderBottomWidth:1,borderColor:C.line}}><T style={{fontSize:14,color:C.green}}>{title} ↗</T></Pressable>)}</Card></>;
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg}, shell:{flex:1,width:'100%',maxWidth:560,alignSelf:'center',backgroundColor:C.bg},
  header:{paddingHorizontal:24,paddingVertical:16,flexDirection:'row-reverse',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderColor:C.line},
  logo:{height:44,width:44,borderRadius:15,backgroundColor:C.mint,alignItems:'center',justifyContent:'center'}, info:{height:38,width:38,borderRadius:19,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center'},
  content:{padding:22,gap:20,paddingBottom:30}, hero:{backgroundColor:'#DEEBCF',borderRadius:28,padding:23,gap:14,overflow:'hidden'},
  catArt:{height:168,alignItems:'center',justifyContent:'center'}, halo:{position:'absolute',width:153,height:153,borderRadius:90,backgroundColor:'#F0F6E6'}, catEmoji:{fontSize:108,lineHeight:148,textAlign:'center'},bubble:{position:'absolute',right:0,top:14,backgroundColor:'#FFFFFFD9',paddingHorizontal:12,paddingVertical:6,borderRadius:15,borderBottomLeftRadius:2,transform:[{rotate:'-5deg'}]},
  duo:{flexDirection:'row-reverse',gap:12},tile:{flex:1,padding:17,borderRadius:22,gap:9,alignItems:'flex-end'},
  avatar:{height:52,width:52,borderRadius:18,alignItems:'center',justifyContent:'center',backgroundColor:'#DFEBD7'},
  translationBanner:{backgroundColor:'#E7ECE2',borderWidth:1,borderColor:'#D7E2D3',borderRadius:21,padding:17},
  nav:{flexDirection:'row-reverse',borderTopWidth:1,borderColor:C.line,backgroundColor:'#FCFCF9',paddingHorizontal:8,paddingTop:9,paddingBottom:10}, navItem:{flex:1,alignItems:'center',gap:3}, navIcon:{paddingHorizontal:10,paddingVertical:6,borderRadius:14},
  notice:{paddingHorizontal:20,paddingVertical:10,backgroundColor:C.amber},overlay:{flex:1,backgroundColor:'#18392E77',alignItems:'center',justifyContent:'center',padding:25},
});
