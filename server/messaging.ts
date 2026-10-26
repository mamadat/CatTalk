import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {InboxMessage,MessageDraft,MessagingPlatform,MessagingStatus,messagePlatform} from '../shared/messaging';
import {TranslationError} from '../shared/translation';

const same=(a:string,b:string)=>{const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
const text=(value:unknown,max=2000)=>typeof value==='string'?value.slice(0,max):'';
export function createMessagingService(env:Record<string,string|undefined>,fetchImpl:typeof fetch=fetch,now=Date.now) {
 const token=env.TRANSLATION_ACCESS_TOKEN?.trim() || '';
 const graph=env.META_GRAPH_VERSION || '';const validGraph=/^v\d+\.\d+$/.test(graph);
 const allowedTelegram=new Set((env.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',').map(v=>v.trim()).filter(Boolean));
 const keys={telegram:env.TELEGRAM_BOT_TOKEN || '',whatsapp:env.WHATSAPP_ACCESS_TOKEN || '',instagram:env.INSTAGRAM_ACCESS_TOKEN || ''};
 const secrets={telegram:env.TELEGRAM_WEBHOOK_SECRET || '',whatsapp:env.WHATSAPP_APP_SECRET || '',instagram:env.INSTAGRAM_APP_SECRET || ''};
 const verifyTokens={whatsapp:env.WHATSAPP_VERIFY_TOKEN || '',instagram:env.INSTAGRAM_VERIFY_TOKEN || ''};
 const accountIds={whatsapp:env.WHATSAPP_PHONE_NUMBER_ID || '',instagram:env.INSTAGRAM_ACCOUNT_ID || ''};
 const missing:Record<MessagingPlatform,string[]>={telegram:[],whatsapp:[],instagram:[]};
 if(!keys.telegram)missing.telegram.push('TELEGRAM_BOT_TOKEN');if(!secrets.telegram)missing.telegram.push('TELEGRAM_WEBHOOK_SECRET');if(!allowedTelegram.size)missing.telegram.push('TELEGRAM_ALLOWED_CHAT_IDS');
 for(const platform of ['whatsapp','instagram'] as const){const prefix=platform.toUpperCase();if(!keys[platform])missing[platform].push(`${prefix}_ACCESS_TOKEN`);if(!secrets[platform])missing[platform].push(`${prefix}_APP_SECRET`);if(!verifyTokens[platform])missing[platform].push(`${prefix}_VERIFY_TOKEN`);if(!/^\d+$/.test(accountIds[platform]))missing[platform].push(platform==='whatsapp'?'WHATSAPP_PHONE_NUMBER_ID':'INSTAGRAM_ACCOUNT_ID');if(!validGraph)missing[platform].push('META_GRAPH_VERSION');}
 for(const platform of Object.keys(missing) as MessagingPlatform[])if(!token)missing[platform].push('TRANSLATION_ACCESS_TOKEN');
 const inbox=new Map<string,InboxMessage>();
 const drafts=new Map<string,MessageDraft>();const sends=new Map<string,Promise<{sent:boolean}>>();
 const lastReceived:Partial<Record<MessagingPlatform,number>>={};const seen=new Map<string,number>();const businessOwners=new Map<string,string>();
 function prune(){const cutoff=now()-86400000;for(const [id,v]of inbox)if(v.receivedAt<cutoff)inbox.delete(id);for(const [id,time]of seen)if(time<cutoff)seen.delete(id);for(const [id,draft]of drafts)if(draft.expiresAt<now()){drafts.delete(id);sends.delete(id);}}
 function status():MessagingStatus{return {protected:!!token,platforms:Object.fromEntries((Object.keys(missing) as MessagingPlatform[]).map(p=>[p,{configured:missing[p].length===0,lastReceivedAt:lastReceived[p],missing:missing[p]}])) as MessagingStatus['platforms']};}
 function ensure(platform:MessagingPlatform){if(missing[platform].length)throw new TranslationError('MESSAGING_NOT_CONFIGURED','تنظیمات اتصال رسمی این پیام‌رسان هنوز کامل نشده است.',503);}
 function add(platform:MessagingPlatform,externalId:string,peerId:string,peerName:string,body:string,eventAt:number,connectionId?:string,edited=false){
  if(!externalId || !peerId || !body.trim() || body.length>2000 || !Number.isFinite(eventAt) || eventAt>now()+300000 || eventAt<now()-86400000)return;
  const key=JSON.stringify([platform,connectionId || '',peerId,externalId]);
  if(seen.has(key)&&!edited)return;
  const existing=Array.from(inbox.values()).find(v=>v.platform===platform&&v.peerId===peerId&&v.externalId===externalId&&v.connectionId===connectionId);
  if(existing&&existing.text===body)return;
  const value:InboxMessage={id:existing?.id || randomUUID(),platform,externalId,peerId,peerName:peerName || peerId,text:body,eventAt,receivedAt:now(),...(connectionId?{connectionId}:{})};
  inbox.set(value.id,value);seen.set(key,now());lastReceived[platform]=now();
  while(inbox.size>100)inbox.delete(inbox.keys().next().value!);while(seen.size>1000)seen.delete(seen.keys().next().value!);
 }
 function verify(platform:MessagingPlatform,raw:Buffer,headers:Record<string,string|string[]|undefined>){
  ensure(platform);
  if(platform==='telegram'){const actual=headers['x-telegram-bot-api-secret-token'];return typeof actual==='string'&&same(actual,secrets.telegram);}
  const actual=headers['x-hub-signature-256'];return typeof actual==='string'&&same(actual,`sha256=${createHmac('sha256',secrets[platform]).update(raw).digest('hex')}`);
 }
 function challenge(platform:MessagingPlatform,query:URLSearchParams){
  if(platform==='telegram')throw new TranslationError('INVALID_CHALLENGE','این مسیر برای تأیید تلگرام نیست.');ensure(platform);
  const challenge=query.get('hub.challenge') || '';
  if(query.get('hub.mode')!=='subscribe'||!same(query.get('hub.verify_token') || '',verifyTokens[platform])||challenge.length>256)throw new TranslationError('WEBHOOK_AUTH','تأیید وب‌هوک ناموفق بود.',403);return challenge;
 }
 function receive(platform:MessagingPlatform,raw:Buffer,headers:Record<string,string|string[]|undefined>){
  if(!verify(platform,raw,headers))throw new TranslationError('WEBHOOK_AUTH','امضای وب‌هوک معتبر نیست.',403);
  let payload:any;try{payload=JSON.parse(raw.toString('utf8'));}catch{throw new TranslationError('INVALID_JSON','درخواست معتبر نیست.');}prune();
  if(platform==='telegram'){
   if(payload.business_connection?.id&&payload.business_connection?.user?.id){businessOwners.set(String(payload.business_connection.id),String(payload.business_connection.user.id));while(businessOwners.size>100)businessOwners.delete(businessOwners.keys().next().value!);return;}
   const message=payload.business_message || payload.edited_business_message || payload.message || payload.edited_message;
   if(!message||message.from?.is_bot||message.sender_business_bot||!allowedTelegram.has(String(message.chat?.id)))return;
   if(message.business_connection_id&&String(message.from?.id)===(env.TELEGRAM_BUSINESS_OWNER_ID || businessOwners.get(String(message.business_connection_id))))return;
   add(platform,String(message.message_id || ''),String(message.chat.id),text(message.chat.title || [message.from?.first_name,message.from?.last_name].filter(Boolean).join(' '),150),typeof message.text==='string'?message.text:'',Number(message.date)*1000,text(message.business_connection_id,200)||undefined,!!(payload.edited_message||payload.edited_business_message));
  }else if(platform==='whatsapp'&&payload.object==='whatsapp_business_account'){
   for(const entry of Array.isArray(payload.entry)?payload.entry:[])for(const change of Array.isArray(entry.changes)?entry.changes:[]){const value=change.value;if(String(value?.metadata?.phone_number_id)!==accountIds.whatsapp)continue;for(const m of Array.isArray(value.messages)?value.messages:[]){if(m.type!=='text')continue;const contact=value.contacts?.find((c:any)=>c.wa_id===m.from);add(platform,text(m.id,256),text(m.from,32),text(contact?.profile?.name,150),typeof m.text?.body==='string'?m.text.body:'',Number(m.timestamp)*1000);}}
  }else if(platform==='instagram'&&payload.object==='instagram'){
   for(const entry of Array.isArray(payload.entry)?payload.entry:[]){if(String(entry.id)!==accountIds.instagram)continue;for(const m of Array.isArray(entry.messaging)?entry.messaging:[]){if(m.message?.is_echo || String(m.sender?.id)===accountIds.instagram || String(m.recipient?.id)!==accountIds.instagram)continue;add(platform,text(m.message?.mid,256),text(m.sender?.id,64),text(m.sender?.id,64),typeof m.message?.text==='string'?m.message.text:'',Number(m.timestamp));}}
  }
 }
 function list(){prune();return Array.from(inbox.values()).sort((a,b)=>b.receivedAt-a.receivedAt);}
 function draft(input:unknown):MessageDraft {
  prune();const value=input as {messageId?:string;text?:string};const message=inbox.get(value?.messageId || '');
  if(!message||typeof value.text!=='string'||!value.text.trim()||value.text.length>2000)throw new TranslationError('INVALID_DRAFT','پیام مقصد یا متن پاسخ معتبر نیست.');
  ensure(message.platform);
  if(now()-message.eventAt>=86400000)throw new TranslationError('REPLY_WINDOW','مهلت پاسخ متنی این مکالمه گذشته است؛ از خود پیام‌رسان استفاده کنید.',409);
  if(drafts.size>=100)throw new TranslationError('DRAFT_LIMIT','پیش‌نویس‌ها زیاد شده‌اند؛ کمی بعد تلاش کنید.',429);
  const valueDraft:MessageDraft={id:randomUUID(),messageId:message.id,platform:message.platform,peerId:message.peerId,peerName:message.peerName,text:value.text,expiresAt:now()+600000};drafts.set(valueDraft.id,valueDraft);return valueDraft;
 }
 async function send(draftId:unknown){
  prune();if(typeof draftId!=='string')throw new TranslationError('INVALID_DRAFT','پیش‌نویس معتبر نیست.');
  const previous=sends.get(draftId);if(previous)return previous;
  const prepared=drafts.get(draftId),message=prepared&&inbox.get(prepared.messageId);
  if(!prepared||!message)throw new TranslationError('DRAFT_EXPIRED','پیش‌نویس منقضی شده است؛ دوباره پیش‌نمایش بگیرید.',409);
  ensure(message.platform);if(now()-message.eventAt>=86400000)throw new TranslationError('REPLY_WINDOW','مهلت پاسخ متنی گذشته است.',409);
  const work=(async()=>{
   let endpoint:string,body:unknown;const platform=message.platform;
   if(platform==='telegram'){endpoint=`https://api.telegram.org/bot${keys.telegram}/sendMessage`;body={chat_id:message.peerId,text:prepared.text,...(message.connectionId?{business_connection_id:message.connectionId}:{})};}
   else if(platform==='whatsapp'){endpoint=`https://graph.facebook.com/${graph}/${accountIds.whatsapp}/messages`;body={messaging_product:'whatsapp',to:message.peerId,type:'text',text:{body:prepared.text}};}
   else{endpoint=`https://graph.instagram.com/${graph}/${accountIds.instagram}/messages`;body={recipient:{id:message.peerId},message:{text:prepared.text}};}
   let response:Response;
   try{response=await fetchImpl(endpoint,{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',...(platform!=='telegram'?{Authorization:`Bearer ${keys[platform]}`}:{})},body:JSON.stringify(body)});}catch{throw new TranslationError('SEND_UNCERTAIN','وضعیت ارسال مشخص نیست؛ پیش از تلاش دوباره، پیام‌رسان را بررسی کنید.',502);}
   if(!response.ok){await response.body?.cancel();throw new TranslationError('SEND_REJECTED','ارسال پذیرفته نشد؛ مجوز حساب، سهمیه و مهلت پاسخ را بررسی کنید.',502);}
   const data=await response.json();if(platform==='telegram'&&!data.ok)throw new TranslationError('SEND_REJECTED','تلگرام ارسال را نپذیرفت.',502);
   return {sent:true};
  })();sends.set(draftId,work);return work;
 }
 function clear(){inbox.clear();drafts.clear();sends.clear();}
 return {status,challenge,receive,list,draft,send,clear};
}
export type MessagingService=ReturnType<typeof createMessagingService>;
