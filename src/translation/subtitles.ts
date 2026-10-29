import {subtitleTime} from './sessions';
export const MAX_SUBTITLE_BYTES=1024*1024;
export interface SubtitleCue {id:string;startMs:number;endMs:number;text:string;}
function timestamp(value:string){
 const m=/^(?:(\d{2,3}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value);
 if(!m||+m[2]>59||+m[3]>59)throw new Error('زمان قطعهٔ زیرنویس معتبر نیست.');
 return ((+(m[1]||0)*60+ +m[2])*60+ +m[3])*1000+ +m[4];
}
/** SRT and plain WebVTT only. No rendering HTML, styles, or executable markup. */
export function parseSubtitles(input:string):SubtitleCue[]{
 if(new TextEncoder().encode(input).length>MAX_SUBTITLE_BYTES)throw new Error('حداکثر حجم زیرنویس ۱ مگابایت است.');
 if(input.includes('\uFFFD'))throw new Error('رمزگذاری متن زیرنویس خوانده نشد؛ فایل را با UTF-8 ذخیره کنید.');
 const normalized=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
 const vtt=/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(normalized);
 const blocks=normalized.split(/\n[ \t]*\n/),cues:SubtitleCue[]=[];
 for(let block of blocks){
  if(vtt&&/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(block))continue;
  if(vtt&&/^(NOTE(?:[ \t]|\n|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block))continue;
  const lines=block.split('\n');let line=0;
  if(!lines[0].includes('-->'))line=1;
  const timing=/^(\S+)\s+-->\s+(\S+)(?:[ \t]+.*)?$/.exec(lines[line]||'');
  if(!timing)throw new Error(`ساختار زیرنویس در قطعهٔ ${cues.length+1} معتبر نیست؛ SRT یا VTT متنی UTF-8 انتخاب کنید.`);
  const startMs=timestamp(timing[1]),endMs=timestamp(timing[2]);
  if(endMs<=startMs||startMs<(cues.at(-1)?.startMs||0))throw new Error('زمان پایان باید پس از آغاز و ترتیب قطعه‌ها بر اساس زمان آغاز باشد.');
  const text=lines.slice(line+1).join('\n').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,entity=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '}[entity]||entity)).trim();
  if(!text||text.length>2000)throw new Error('هر قطعه باید ۱ تا ۲۰۰۰ نویسهٔ متنی داشته باشد.');
  cues.push({id:`cue-${cues.length+1}`,startMs,endMs,text});
  if(cues.length>3000)throw new Error('حداکثر ۳۰۰۰ قطعهٔ زیرنویس در یک فایل پشتیبانی می‌شود.');
 }
 if(!cues.length)throw new Error('قطعهٔ قابل ترجمه در فایل پیدا نشد.');return cues;
}
export function subtitleBatch(cues:SubtitleCue[],completed:ReadonlySet<string>,batchMode:boolean):SubtitleCue[]{
 const batch:SubtitleCue[]=[];let chars=0;
 for(const cue of cues){if(completed.has(cue.id))continue;const extra=cue.text.length+(batch.length?1:0);if(batch.length&&(batch.length>=(batchMode?8:1)||chars+extra>2000))break;batch.push(cue);chars+=extra;}
 return batch;
}
export function parseSubtitleTranslation(raw:string,expected:ReadonlyArray<{id:string}>):Map<string,string>{
 let data:any;try{data=JSON.parse(raw.trim().replace(/^```json\s*([\s\S]*?)\s*```$/,'$1'));}catch{throw new Error('مدل قالب معتبر زیرنویس برنگرداند؛ بسته ثبت نشد.');}
 if(!data||Object.keys(data).join()!=='cues'||!Array.isArray(data.cues)||data.cues.length!==expected.length)throw new Error('تعداد قطعه‌های پاسخ با زیرنویس یکسان نیست؛ بسته ثبت نشد.');
 const result=new Map<string,string>();data.cues.forEach((cue:any,i:number)=>{if(!cue||Object.keys(cue).length!==2||cue.id!==expected[i].id||typeof cue.text!=='string'||!cue.text.trim()||cue.text.length>8000)throw new Error('شناسه یا متن قطعهٔ ترجمه معتبر نیست؛ بسته ثبت نشد.');result.set(cue.id,cue.text.trim());});return result;
}
export function activeSubtitles(cues:SubtitleCue[],timeMs:number):SubtitleCue[]{return cues.filter(c=>c.startMs<=timeMs&&timeMs<c.endMs);}
export function translatedSRT(cues:SubtitleCue[],translations:ReadonlyMap<string,string>):string{
 return cues.filter(c=>translations.has(c.id)).map((c,i)=>`${i+1}\n${subtitleTime(c.startMs)} --> ${subtitleTime(c.endMs)}\n${translations.get(c.id)!.replace(/<[^>]*>/g,'').replace(/\r/g,'').split('\n').filter(line=>line.trim()).join('\n')}\n`).join('\n');
}
