import React,{useState} from 'react';
import {Linking} from 'react-native';
import {Button,C,Card,s,T} from '../ui';

export function OpenAISetup(){
 const [error,setError]=useState('');
 async function open(url:string){setError('');try{await Linking.openURL(url);}catch{setError('بازکردن پیوند ممکن نشد؛ نشانی را از راهنمای OpenAI برنامه باز کنید.');}}
 return <Card><T style={s.subtitle}>راه‌اندازی ChatGPT / OpenAI</T>
  <T style={s.muted}>ترجمهٔ متن، پاسخ چت و متن استخراج‌شده از ویس با مدل‌های GPT از API رسمی OpenAI انجام می‌شود. برای ویس، تشخیص گفتار و پخش صدا از موتورهای انتخابی خودشان استفاده می‌کنند.</T>
  <T style={s.muted}>کلید را در فایل .env روی سرور، مقابل OPENAI_API_KEY قرار دهید؛ سپس سرور را دوباره اجرا و «بررسی دوباره» را بزنید. کلید را در چت یا تنظیم توکن اتصال اپ وارد نکنید.</T>
  <T testID="openai-billing-note" style={s.muted}>مصرف API هزینهٔ جدا دارد؛ اشتراک ChatGPT Plus یا Pro جای اعتبار API را نمی‌گیرد. دسترسی به مدل و اعتبار حساب هنگام درخواست بررسی می‌شوند.</T>
  <T testID="openai-region-note" style={s.muted}>ایران در فهرست رسمی کشورهای پشتیبانی‌شدهٔ OpenAI API نیست؛ ساخت کلید به‌تنهایی دسترسی از ایران را فراهم نمی‌کند.</T>
  <Button small secondary title="ساخت کلید OpenAI API" icon="key-outline" onPress={()=>void open('https://platform.openai.com/api-keys')}/>
  <Button small secondary title="تعرفهٔ رسمی OpenAI API" onPress={()=>void open('https://developers.openai.com/api/docs/pricing')}/>
  <Button small secondary title="کشورهای پشتیبانی‌شدهٔ OpenAI" onPress={()=>void open('https://developers.openai.com/api/docs/supported-countries')}/>
  {!!error&&<T style={{color:C.danger}}>{error}</T>}
 </Card>;
}
