import React,{useState} from 'react';
import {Language} from '../../shared/translation';
import {Button,C,T} from '../ui';
import {uid} from '../domain';
import {PreferencesAPI} from './preferences';
export function SavePhraseButton({preferences,source,target,original,translated}:{preferences:PreferencesAPI;source:Language;target:Language;original:string;translated:string}){
 const [notice,setNotice]=useState('');const saved=(preferences.data.saved||[]).some(p=>p.source===source&&p.target===target&&p.original===original&&p.translated===translated);
 return <><Button small secondary title={saved?'در عبارت‌نامه ذخیره شده':'ذخیرهٔ این ترجمه برای سفر'} disabled={saved||!preferences.ready||!original.trim()||original.length>2000||!translated.trim()||translated.length>4000} onPress={()=>{setNotice('');void preferences.update(data=>{if((data.saved||[]).length>=100)throw new Error('حداکثر ۱۰۰ عبارت ذخیره می‌شود؛ ابتدا عبارتی را حذف کنید.');return {...data,saved:[...(data.saved||[]),{id:uid(),source,target,original,translated}]};}).then(()=>setNotice('متن مبدا و ترجمه روی همین دستگاه ذخیره شدند.')).catch(e=>setNotice(e.message));}}/>{!!notice&&<T style={{fontSize:12,color:C.muted}}>{notice}</T>}</>;
}
