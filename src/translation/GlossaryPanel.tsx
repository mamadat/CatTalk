import React,{useState} from 'react';
import {TextInput} from 'react-native';
import {Language} from '../../shared/translation';
import {Button,C,Card,Chips,s,T} from '../ui';
import {PreferencesAPI} from './preferences';
import {uid} from '../domain';
export function GlossaryPanel({preferences}:{preferences:PreferencesAPI}) {
 const [open,setOpen]=useState(false),[source,setSource]=useState<Language>('fa'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(){setBusy(true);setError('');try{if(!from.trim()||!to.trim())throw new Error('هر دو واژه یا عبارت را وارد کنید.');await preferences.update(data=>{const terms=data.terms.filter(t=>!(t.sourceLanguage===source&&t.source===from.trim()));if(terms.length>=200)throw new Error('حداکثر ۲۰۰ اصطلاح قابل ذخیره است.');return {...data,terms:[...terms,{id:uid(),sourceLanguage:source,targetLanguage:source==='fa'?'ja':'fa',source:from.trim(),target:to.trim()}]};});setFrom('');setTo('');}catch(e){setError(e instanceof Error?e.message:'ذخیره نشد.');}finally{setBusy(false);}}
 return <Card><Button small secondary title={open?'بستن واژه‌نامهٔ شخصی':`واژه‌نامهٔ شخصی · ${preferences.data.terms.length.toLocaleString('fa-IR')} اصطلاح`} icon="book-outline" onPress={()=>setOpen(v=>!v)}/>
  {open&&<><T style={s.muted}>روی دستگاه ذخیره می‌شود. فقط اصطلاحات مرتبط با متن فعلی به موتور سازگار فرستاده می‌شوند؛ تغییر واژه‌نامه، پاسخ‌های قدیمی حافظهٔ ترجمه را جدا می‌کند.</T><Chips options={{fa:'فارسی به ژاپنی',ja:'ژاپنی به فارسی'}} value={source} onChange={setSource}/><TextInput accessibilityLabel="واژهٔ مبدا واژه‌نامه" value={from} onChangeText={setFrom} maxLength={80} placeholder="نام یا اصطلاح مبدا" style={s.input}/><TextInput accessibilityLabel="معادل دلخواه واژه‌نامه" value={to} onChangeText={setTo} maxLength={80} placeholder="معادل موردنظر شما" style={s.input}/><Button small title="ذخیرهٔ اصطلاح" disabled={!preferences.ready||busy} onPress={()=>void save()}/>
  {preferences.data.terms.map(term=><Card key={term.id} style={{padding:12,borderRadius:12}}><T selectable>{term.source} → {term.target}</T><T style={s.muted}>{term.sourceLanguage} → {term.targetLanguage}</T><Button small secondary title={`حذف اصطلاح ${term.source}`} disabled={busy} onPress={()=>{setBusy(true);void preferences.update(data=>({...data,terms:data.terms.filter(t=>t.id!==term.id)})).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}/></Card>)}</>}
  {!!(preferences.error||error)&&<T style={{color:C.danger}}>{preferences.error||error}</T>}
 </Card>;
}
