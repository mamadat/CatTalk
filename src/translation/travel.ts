import {Language} from '../../shared/translation';
export interface SavedPhrase {id:string;source:Language;target:Language;original:string;translated:string;}
export const travelCategories={all:'همه',transport:'مسیر و حمل‌ونقل',hotel:'اقامت',food:'رستوران',conversation:'گفتگو',help:'درخواست کمک',saved:'ذخیره‌های من'} as const;
export const travelPhrases=[
 {id:'hello',category:'conversation',fa:'سلام.',ja:'こんにちは。'},
 {id:'thanks',category:'conversation',fa:'خیلی ممنونم.',ja:'ありがとうございます。'},
 {id:'repeat',category:'conversation',fa:'لطفاً دوباره بگویید.',ja:'もう一度言ってください。'},
 {id:'slower',category:'conversation',fa:'لطفاً کمی آهسته‌تر صحبت کنید.',ja:'もう少しゆっくり話してください。'},
 {id:'write',category:'conversation',fa:'لطفاً آن را بنویسید.',ja:'書いていただけますか。'},
 {id:'machine',category:'conversation',fa:'من از برنامهٔ ترجمه استفاده می‌کنم. لطفاً نوبتی صحبت کنیم.',ja:'翻訳アプリを使っています。交代で話しましょう。'},
 {id:'station',category:'transport',fa:'ایستگاه قطار کجاست؟',ja:'駅はどこですか。'},
 {id:'airport',category:'transport',fa:'می‌خواهم به فرودگاه بروم.',ja:'空港に行きたいです。'},
 {id:'ticket',category:'transport',fa:'از کجا می‌توانم بلیت بخرم؟',ja:'切符はどこで買えますか。'},
 {id:'toilet',category:'transport',fa:'سرویس بهداشتی کجاست؟',ja:'トイレはどこですか。'},
 {id:'reservation',category:'hotel',fa:'من رزرو دارم.',ja:'予約しています。'},
 {id:'checkout',category:'hotel',fa:'ساعت تخلیهٔ اتاق چه زمانی است؟',ja:'チェックアウトは何時ですか。'},
 {id:'wifi',category:'hotel',fa:'رمز وای‌فای چیست؟',ja:'Wi-Fiのパスワードは何ですか。'},
 {id:'menu',category:'food',fa:'لطفاً منو را بدهید.',ja:'メニューをください。'},
 {id:'water',category:'food',fa:'لطفاً آب بدهید.',ja:'水をください。'},
 {id:'bill',category:'food',fa:'لطفاً صورت‌حساب را بدهید.',ja:'お会計をお願いします。'},
 {id:'ingredients',category:'food',fa:'این غذا چه موادی دارد؟',ja:'この料理には何が入っていますか。'},
 {id:'help',category:'help',fa:'لطفاً به من کمک کنید.',ja:'助けてください。'},
 {id:'lost',category:'help',fa:'راه را گم کرده‌ام.',ja:'道に迷いました。'},
 {id:'interpreter',category:'help',fa:'آیا می‌توانید یک مترجم پیدا کنید؟',ja:'通訳を探していただけますか。'},
] as const;
export function validSavedPhrase(p:SavedPhrase){return !!p&&typeof p.id==='string'&&p.id.length<=100&&['fa','ja'].includes(p.source)&&['fa','ja'].includes(p.target)&&p.source!==p.target&&typeof p.original==='string'&&!!p.original.trim()&&p.original.length<=2000&&typeof p.translated==='string'&&!!p.translated.trim()&&p.translated.length<=4000;}
