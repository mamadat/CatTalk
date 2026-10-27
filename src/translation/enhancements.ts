import {Language,TranslationRequest,TranslationTone,providerSupportsOptions} from '../../shared/translation';
export interface GlossaryTerm {id:string;sourceLanguage:Language;targetLanguage:Language;source:string;target:string;}
export interface ContactProfile {id:string;name:string;tone:TranslationTone;contextEnabled:boolean;}
export function matchedTerms(request:TranslationRequest,terms:GlossaryTerm[]) {
 return terms.filter(term=>{
  if(term.sourceLanguage!==request.source || term.targetLanguage!==request.target)return false;
  const escaped=term.source.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return request.source==='fa'?new RegExp(`(?<![\\p{L}\\p{N}\\p{M}\\u200c])${escaped}(?![\\p{L}\\p{N}\\p{M}\\u200c])`,'iu').test(request.text):request.text.includes(term.source);
 }).sort((a,b)=>b.source.length-a.source.length).slice(0,12).map(({source,target})=>({source,target}));
}
export function enrichRequest(request:TranslationRequest,terms:GlossaryTerm[]):TranslationRequest {
 if(!providerSupportsOptions(request.provider || 'openai'))return request;
 const glossary=matchedTerms(request,terms);return glossary.length?{...request,glossary}:request;
}
interface ContextTurn {id:string;role:'incoming'|'outgoing';text:string;}
export class ConversationContext {
 private scopes=new Map<string,ContextTurn[]>();
 put(scope:string,turn:ContextTurn){const turns=this.scopes.get(scope)||[];this.scopes.delete(scope);this.scopes.set(scope,[...turns.filter(t=>t.id!==turn.id),turn].slice(-6));while(this.scopes.size>30)this.scopes.delete(this.scopes.keys().next().value!);}
 note(scope:string,manual:string,excludeId?:string,current?:ContextTurn){
  let result=manual;const chosen:string[]=[];
  const turns=[...(this.scopes.get(scope)||[]).filter(t=>!current||t.id!==current.id),...(current?[current]:[])];
  for(const turn of turns.reverse().filter(t=>t.id!==excludeId).slice(0,3)){
   const line=`${turn.role==='incoming'?'پیام دریافتی':'پاسخ ارسال‌شده'}: ${turn.text}`;
   if(result.length+chosen.join('\n').length+line.length+2>500)break;chosen.unshift(line);
  }
  if(chosen.length)result+=(result?'\n':'')+chosen.join('\n');return result;
 }
 clear(scope?:string){if(scope)this.scopes.delete(scope);else this.scopes.clear();}
}
export interface FidelityWarning {kind:'numbers'|'links'|'placeholders';message:string;}
const protectedPattern=/https?:\/\/[^\s<>"«»]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\{\{[^{}\n]{1,80}\}\}|\{[^{}\n]{1,80}\}|%(?:\d+\$)?[sdif]/gu;
const digits=(text:string)=>text.replace(/[۰-۹٠-٩０-９]/g,char=>String('۰۱۲۳۴۵۶۷۸۹'.includes(char)?'۰۱۲۳۴۵۶۷۸۹'.indexOf(char):'٠١٢٣٤٥٦٧٨٩'.includes(char)?'٠١٢٣٤٥٦٧٨٩'.indexOf(char):'０１２３４５６７８９'.indexOf(char)));
function tokens(text:string){return Array.from(text.matchAll(protectedPattern),m=>m[0].replace(/[،。؛!?؟]+$/u,''));}
function counts(items:string[]){const map=new Map<string,number>();for(const value of items)map.set(value,(map.get(value)||0)+1);return map;}
export function inspectFidelity(source:string,target:string):FidelityWarning[] {
 const result:FidelityWarning[]=[];const before=counts(tokens(source)),after=counts(tokens(target));
 for(const kind of ['links','placeholders'] as const){const missing=Array.from(before).filter(([value,count])=>(/^https?:|@/.test(value)?'links':'placeholders')===kind && (after.get(value)||0)<count);if(missing.length)result.push({kind,message:kind==='links'?'لینک یا نشانی ایمیل ورودی در خروجی عیناً حفظ نشده است؛ بررسی کنید.':'جای‌نگهدارهایی مثل {name} یا %s در خروجی تغییر کرده‌اند؛ بررسی کنید.'});}
 const numbers=(value:string)=>digits(value.replace(protectedPattern,' ')).match(/[+-]?\d+(?:[.,٫٬،]\d+)*/g)?.map(v=>v.replace(/[٬,،]/g,'').replace(/٫/g,'.')).sort()||[];
 if(JSON.stringify(numbers(source))!==JSON.stringify(numbers(target)))result.push({kind:'numbers',message:'نمایش یا تعداد اعداد ورودی و خروجی متفاوت است؛ مبلغ، تاریخ و تعداد را بررسی کنید. تغییر شیوهٔ نوشتن عدد هم ممکن است این هشدار را ایجاد کند.'});
 return result;
}
