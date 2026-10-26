import {useEffect,useRef} from 'react';
import {ShareIntentModule,useShareIntent} from 'expo-share-intent';
export function ShareBridge({onText,onError}:{onText:(text:string)=>void;onError:(error:string)=>void}) {
 const latest=useRef({onText,onError});latest.current={onText,onError};
 const {hasShareIntent,shareIntent,resetShareIntent,error}=useShareIntent({disabled:!ShareIntentModule,resetOnBackground:false,debug:false});
 useEffect(()=>{
  if(!hasShareIntent)return;const value=shareIntent.text;
  if(typeof value==='string'&&value.length>2000)latest.current.onError('متن اشتراک‌شده بیش از ۲۰۰۰ نویسه است؛ بخش کوتاه‌تری را انتخاب یا کپی کنید.');
  else if(typeof value==='string'&&value.trim())latest.current.onText(value);
  else latest.current.onError('در این نسخه، متن پیام را با CatTalk به اشتراک بگذارید؛ اگر اشتراک متن ممکن نیست، آن را کپی و در بخش چت بچسبانید.');
  resetShareIntent();
 },[hasShareIntent,shareIntent]);
 useEffect(()=>{if(error)latest.current.onError('دریافت پیام اشتراکی انجام نشد؛ کپی و چسباندن را امتحان کنید.');},[error]);
 return null;
}
