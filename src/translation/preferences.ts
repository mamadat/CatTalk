import {useCallback,useEffect,useRef,useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ContactProfile,GlossaryTerm} from './enhancements';
import {toneNames} from '../../shared/translation';
import {SavedPhrase,validSavedPhrase} from './travel';
const KEY='cattalk.translation.preferences.v1';
export interface TranslationPreferences {version:1;terms:GlossaryTerm[];profiles:ContactProfile[];saved?:SavedPhrase[];}
export const emptyPreferences:TranslationPreferences={version:1,terms:[],profiles:[]};
export function validatePreferences(value:unknown):TranslationPreferences {
 const v=value as TranslationPreferences;
 if(!v||v.version!==1||!Array.isArray(v.terms)||v.terms.length>200||!Array.isArray(v.profiles)||v.profiles.length>50)throw new Error('تنظیمات ترجمه قابل خواندن نیست؛ دادهٔ قبلی بازنویسی نشده است.');
 if(v.saved!==undefined&&(!Array.isArray(v.saved)||v.saved.length>100||v.saved.some(p=>!validSavedPhrase(p))))throw new Error('عبارت‌های ذخیره‌شده معتبر نیستند.');
 for(const term of v.terms)if(!term||typeof term.id!=='string'||!['fa','ja'].includes(term.sourceLanguage)||!['fa','ja'].includes(term.targetLanguage)||term.sourceLanguage===term.targetLanguage||typeof term.source!=='string'||!term.source.trim()||term.source.length>80||typeof term.target!=='string'||!term.target.trim()||term.target.length>80)throw new Error('واژه‌نامهٔ ذخیره‌شده معتبر نیست.');
 for(const p of v.profiles)if(!p||typeof p.id!=='string'||p.id.length>256||typeof p.name!=='string'||!p.name.trim()||p.name.length>80||!Object.hasOwn(toneNames,p.tone)||typeof p.contextEnabled!=='boolean')throw new Error('پروفایل مخاطب معتبر نیست.');
 return v;
}
export function useTranslationPreferences(){
 const [data,setData]=useState(emptyPreferences),[ready,setReady]=useState(false),[error,setError]=useState('');const current=useRef(emptyPreferences),loaded=useRef(false),queue=useRef(Promise.resolve());
 useEffect(()=>{let alive=true;AsyncStorage.getItem(KEY).then(raw=>{const next=raw?validatePreferences(JSON.parse(raw)):emptyPreferences;if(alive){current.current=next;loaded.current=true;setData(next);setReady(true);}}).catch(()=>{if(alive)setError('خواندن تنظیمات ترجمه ناموفق بود؛ برای حفظ دادهٔ قبلی، ذخیره‌سازی متوقف است.');});return()=>{alive=false;};},[]);
 const update=useCallback((change:(data:TranslationPreferences)=>TranslationPreferences)=>{
  const next=queue.current.then(async()=>{if(!loaded.current)throw new Error('تنظیمات محلی هنوز قابل ویرایش نیست.');const value=validatePreferences(change(current.current));await AsyncStorage.setItem(KEY,JSON.stringify(value));current.current=value;setData(value);});queue.current=next.catch(()=>{});return next;
 },[]);
 return {data,ready,error,update};
}
export type PreferencesAPI=ReturnType<typeof useTranslationPreferences>;
