export const messagingNames={telegram:'تلگرام',whatsapp:'واتس‌اپ',instagram:'اینستاگرام'} as const;
export type MessagingPlatform=keyof typeof messagingNames;
export interface InboxMessage {id:string;platform:MessagingPlatform;peerId:string;peerName:string;text:string;receivedAt:number;eventAt:number;externalId:string;connectionId?:string;}
export interface MessagingStatus {protected:boolean;platforms:Record<MessagingPlatform,{configured:boolean;lastReceivedAt?:number;missing:string[]}>;}
export interface MessageDraft {id:string;messageId:string;platform:MessagingPlatform;peerId:string;peerName:string;text:string;expiresAt:number;}
export function messagePlatform(value:unknown):value is MessagingPlatform {return typeof value==='string' && Object.hasOwn(messagingNames,value);}
export function personalChatURL(platform:MessagingPlatform,text:string,phone='') {
  if(platform==='telegram')return `https://t.me/share/url?url=&text=${encodeURIComponent(text)}`;
  if(platform==='whatsapp') {
    const digits=phone.replace(/[\s()+-]/g,'');
    if(digits && !/^[1-9]\d{6,14}$/.test(digits))throw new Error('شمارهٔ واتس‌اپ را با کد کشور و ارقام انگلیسی وارد کنید.');
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  }
  return 'https://www.instagram.com/direct/inbox/';
}
