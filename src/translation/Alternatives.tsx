import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator} from 'react-native';
import {TranslationRequest,providerSupportsOptions} from '../../shared/translation';
import {Transport} from './controller';
import {Button,C,Card,s,T} from '../ui';
import {QualityReview} from './QualityReview';
export function Alternatives({request,result,transport,onChoose}:{request:TranslationRequest;result:string;transport:Transport;onChoose?:(value:string)=>void}){
 const [values,setValues]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');const abort=useRef<AbortController|undefined>(undefined),generation=useRef(0);const identity=JSON.stringify([request,result]);
 useEffect(()=>{generation.current++;abort.current?.abort();setValues([]);setError('');setBusy(false);return()=>{generation.current++;abort.current?.abort();};},[identity,transport]);
 async function load(){abort.current?.abort();const controller=new AbortController();abort.current=controller;const id=++generation.current;setBusy(true);setError('');setValues([]);const found:string[]=[];
  try{for(const style of ['fluent','precise'] as const){let translated='',complete=false;await transport({...request,alternative:{reference:result,style}},controller.signal,event=>{if(event.type==='delta')translated+=event.text;else if(event.type==='complete')complete=true;else throw new Error(event.message);});if(controller.signal.aborted||id!==generation.current)return;if(!complete)throw new Error('پیشنهاد کامل نشد.');if(translated.trim()&&translated!==result&&!found.includes(translated)){found.push(translated);setValues([...found]);}}
   if(!found.length&&id===generation.current)setError('مدل ترجمهٔ متفاوتِ قابل ارائه‌ای برنگرداند.');
  }catch(e){if(!controller.signal.aborted&&id===generation.current)setError(e instanceof Error?e.message:'پیشنهادها دریافت نشدند.');}finally{if(id===generation.current)setBusy(false);}
 }
 if(!providerSupportsOptions(request.provider || 'openai'))return <T style={s.muted}>این موتور پیشنهاد جایگزین ندارد.</T>;
 return <Card style={{padding:12,borderRadius:14}}><Button small secondary title={busy?'در حال گرفتن پیشنهاد…':'دو ترجمهٔ جایگزین'} disabled={busy||!result||result.length>4000} onPress={()=>void load()}/><T style={{fontSize:11,color:C.muted}}>فقط با درخواست شما؛ حداکثر دو درخواست ترجمه و هزینه/سهمیهٔ جدا. گزینه‌ها ممکن است تفاوت اندکی داشته باشند.</T>{busy&&<ActivityIndicator color={C.green}/>}{values.map((value,index)=><Card key={index} style={{padding:12,borderRadius:12}}><T selectable>{value}</T><QualityReview source={request.text} target={value}/>{onChoose&&<Button small secondary title={`استفاده از پیشنهاد ${index+1}`} onPress={()=>onChoose(value)}/>}</Card>)}{!!error&&<T style={{color:C.danger,fontSize:12}}>{error}</T>}</Card>;
}
