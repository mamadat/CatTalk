import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {AddressInfo} from 'node:net';
import {createMessagingService} from '../server/messaging';
import {createTranslationServer} from '../server/app';
import {DEFAULT_MODELS} from '../server/provider';
import {personalChatURL,MessagingPlatform} from '../shared/messaging';
const time=1780000000000;
const env={TRANSLATION_ACCESS_TOKEN:'gateway-secret',TELEGRAM_BOT_TOKEN:'telegram-secret',TELEGRAM_WEBHOOK_SECRET:'telegram-hook',TELEGRAM_ALLOWED_CHAT_IDS:'123',META_GRAPH_VERSION:'v25.0',WHATSAPP_ACCESS_TOKEN:'wa-secret',WHATSAPP_PHONE_NUMBER_ID:'500',WHATSAPP_APP_SECRET:'wa-sign',WHATSAPP_VERIFY_TOKEN:'wa-verify',INSTAGRAM_ACCESS_TOKEN:'ig-secret',INSTAGRAM_ACCOUNT_ID:'600',INSTAGRAM_APP_SECRET:'ig-sign',INSTAGRAM_VERIFY_TOKEN:'ig-verify'};
const telegram={message:{message_id:1,date:time/1000,chat:{id:123},from:{id:7,first_name:'Test'},text:'こんにちは。'}};
const whatsapp={object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'500'},contacts:[{wa_id:'819012345678',profile:{name:'Customer'}}],messages:[{id:'wa1',from:'819012345678',timestamp:String(time/1000),type:'text',text:{body:'こんにちは。'}}]}}]}]};
const instagram={object:'instagram',entry:[{id:'600',messaging:[{sender:{id:'700'},recipient:{id:'600'},timestamp:time,message:{mid:'ig1',text:'こんにちは。'}}]}]};
function deliver(service:ReturnType<typeof createMessagingService>,platform:MessagingPlatform,payload:unknown){const raw=Buffer.from(JSON.stringify(payload));service.receive(platform,raw,platform==='telegram'?{'x-telegram-bot-api-secret-token':'telegram-hook'}:{'x-hub-signature-256':`sha256=${createHmac('sha256',platform==='whatsapp'?'wa-sign':'ig-sign').update(raw).digest('hex')}`});}
test('personal chat links escape translated text and reject malformed WhatsApp recipients',()=>{
 const body='こんにちは & /? # +';assert.equal(new URL(personalChatURL('telegram',body)).searchParams.get('text'),body);assert.equal(new URL(personalChatURL('whatsapp',body,'+81 90 1234 5678')).pathname,'/819012345678');assert.throws(()=>personalChatURL('whatsapp',body,'javascript:bad'));assert.equal(personalChatURL('instagram',body),'https://www.instagram.com/direct/inbox/');
});
test('official channels reject unverified webhooks and never expose credentials in status',()=>{
 const service=createMessagingService(env,fetch,()=>time);
 assert.throws(()=>service.receive('telegram',Buffer.from(JSON.stringify(telegram)),{}));assert.throws(()=>service.receive('whatsapp',Buffer.from(JSON.stringify(whatsapp)),{'x-hub-signature-256':'sha256=bad'}));
 for(const secret of ['gateway-secret','telegram-secret','wa-secret','ig-secret','wa-sign','ig-sign'])assert.ok(!JSON.stringify(service.status()).includes(secret));
 assert.equal(service.challenge('whatsapp',new URLSearchParams('hub.mode=subscribe&hub.verify_token=wa-verify&hub.challenge=1234')),'1234');assert.throws(()=>service.challenge('instagram',new URLSearchParams('hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1234')));
});
test('webhooks accept only own/allowed chats, deduplicate, replace edits and skip echoes',()=>{
 const service=createMessagingService(env,fetch,()=>time);
 for(const [platform,payload]of [['telegram',telegram],['whatsapp',whatsapp],['instagram',instagram]] as const){deliver(service,platform,payload);deliver(service,platform,payload);}
 assert.equal(service.list().length,3);
 deliver(service,'telegram',{edited_message:{...telegram.message,text:'Edited'}});assert.equal(service.list().find(v=>v.platform==='telegram')?.text,'Edited');
 deliver(service,'telegram',{message:{...telegram.message,message_id:2,chat:{id:999}}});
 deliver(service,'instagram',{...instagram,entry:[{...instagram.entry[0],messaging:[{...instagram.entry[0].messaging[0],message:{mid:'echo',text:'own reply',is_echo:true}}]}]});
 deliver(service,'whatsapp',{...whatsapp,entry:[{changes:[{value:{...whatsapp.entry[0].changes[0].value,metadata:{phone_number_id:'wrong'}}}]}]});
 assert.equal(service.list().length,3);
});
test('reply drafts bind exact text and recipient, require incoming chat and expire',async()=>{
 let now=time;const service=createMessagingService(env,fetch,()=>now);deliver(service,'telegram',telegram);const message=service.list()[0];
 assert.throws(()=>service.draft({messageId:'unknown',text:'Hello',peerId:'attacker'}));const draft=service.draft({messageId:message.id,text:'こんにちは',peerId:'attacker'});assert.equal(draft.peerId,'123');assert.equal(draft.text,'こんにちは');now+=600001;await assert.rejects(service.send(draft.id));
});
for(const platform of ['telegram','whatsapp','instagram'] as const)test(`${platform}: explicit draft send routes official API and is idempotent`,async()=>{
 let calls=0;const service=createMessagingService(env,async(url,init)=>{calls++;const body=JSON.parse(String(init?.body));
  if(platform==='telegram'){assert.match(String(url),/^https:\/\/api.telegram.org\/bot/);assert.equal(body.chat_id,'123');assert.equal(body.text,'翻訳');}
  else if(platform==='whatsapp'){assert.equal(String(url),'https://graph.facebook.com/v25.0/500/messages');assert.equal(body.to,'819012345678');assert.equal(body.text.body,'翻訳');}
  else{assert.equal(String(url),'https://graph.instagram.com/v25.0/600/messages');assert.equal(body.recipient.id,'700');assert.equal(body.message.text,'翻訳');}
  return new Response(JSON.stringify(platform==='telegram'?{ok:true,result:{message_id:100}}:{message_id:'sent'}));
 },()=>time);deliver(service,platform,platform==='telegram'?telegram:platform==='whatsapp'?whatsapp:instagram);assert.equal(calls,0);
 const draft=service.draft({messageId:service.list()[0].id,text:'翻訳'});const [a,b]=await Promise.all([service.send(draft.id),service.send(draft.id)]);assert.ok(a.sent&&b.sent);assert.equal(calls,1);
});
test('uncertain network sends never auto-retry the same draft',async()=>{
 let calls=0;const service=createMessagingService(env,async()=>{calls++;throw new TypeError('contains secret endpoint');},()=>time);deliver(service,'telegram',telegram);const draft=service.draft({messageId:service.list()[0].id,text:'Hello'});
 for(let n=0;n<2;n++)await assert.rejects(service.send(draft.id),e=>e instanceof Error&&!e.message.includes('secret endpoint'));assert.equal(calls,1);
});
test('HTTP inbox and send endpoints require the private gateway token; webhooks require own signature',async()=>{
 const service=createMessagingService(env,async()=>new Response(JSON.stringify({ok:true})),()=>time);const server=createTranslationServer({configured:false,models:DEFAULT_MODELS,accessToken:'gateway-secret',messaging:service,allowedOrigins:[]},async()=>{});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try{
  assert.equal((await fetch(url+'/api/messaging/inbox')).status,401);
  assert.equal((await fetch(url+'/api/webhooks/telegram',{method:'POST',body:JSON.stringify(telegram)})).status,403);
  assert.equal((await fetch(url+'/api/webhooks/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'telegram-hook'},body:JSON.stringify(telegram)})).status,200);
  const response=await fetch(url+'/api/messaging/inbox',{headers:{Authorization:'Bearer gateway-secret'}});assert.equal((await response.json()).messages.length,1);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
