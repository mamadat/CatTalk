import React from 'react';
import {View} from 'react-native';
import {C,T} from '../ui';
import {inspectFidelity} from './enhancements';
export function QualityReview({source,target}:{source:string;target:string}) {
 const warnings=inspectFidelity(source,target);if(!warnings.length)return null;
 return <View testID="translation-quality-warnings" style={{padding:12,borderRadius:12,backgroundColor:C.amber,gap:6}}><T style={{fontWeight:'700'}}>نیاز به بازبینی</T>{warnings.map(v=><T key={v.kind} style={{fontSize:12,lineHeight:22}}>{v.message}</T>)}<T style={{fontSize:11,color:C.muted}}>بررسی محلی است؛ هشدار یا نبود هشدار، تضمین صحت معنی نیست.</T></View>;
}
