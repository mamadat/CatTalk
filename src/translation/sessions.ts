import {Language} from '../../shared/translation';
export type TurnPhase='queued'|'transcribing'|'reviewing'|'translating'|'done'|'error'|'cancelled';
export interface SessionTurn {id:string;source:Language;target:Language;startedMs:number;endedMs:number;phase:TurnPhase;original:string;translated:string;modelTranslation?:string;edited?:boolean;error?:string;queuedMs?:number;sttMs?:number;translationMs?:number;firstTextMs?:number;totalMs?:number;reviewed?:boolean;requiresReview?:boolean;model?:string;promptVersion?:string;}
const cancelled=()=>new Error('پردازش این نوبت لغو شد.');
interface Job {work:(signal:AbortSignal)=>Promise<void>;abort:AbortController;resolve:()=>void;reject:(e:unknown)=>void;}
/** One upstream turn at a time; bounded raw audio backlog, never a silent drop. */
export class TurnQueue {
 private pending:Job[]=[];private active?:Job;
 constructor(private capacity=3,private changed:(count:number)=>void=()=>{}){}
 add(work:Job['work']):Promise<void>{
  if(this.size>=this.capacity)return Promise.reject(new Error('صف صدا پر شد؛ ضبط متوقف شد. متن نوبت‌ها را بررسی و پس از پایان پردازش دوباره شروع کنید.'));
  return new Promise((resolve,reject)=>{this.pending.push({work,abort:new AbortController(),resolve,reject});this.changed(this.size);this.pump();});
 }
 get size(){return this.pending.length+(this.active?1:0);}
 cancel(){const active=this.active;this.active=undefined;if(active){active.abort.abort();active.reject(cancelled());}for(const job of this.pending.splice(0)){job.abort.abort();job.reject(cancelled());}this.changed(0);}
 private pump(){if(this.active)return;const job=this.pending.shift();if(!job)return;this.active=job;
  Promise.resolve().then(()=>{if(job.abort.signal.aborted)throw cancelled();return job.work(job.abort.signal);}).then(job.resolve,job.reject).finally(()=>{if(this.active!==job)return;this.active=undefined;this.changed(this.size);this.pump();});
 }
}
export function subtitleTime(ms:number){const n=Math.max(0,Math.floor(ms));const hours=Math.floor(n/3600000),minutes=Math.floor(n/60000)%60,seconds=Math.floor(n/1000)%60;return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')},${String(n%1000).padStart(3,'0')}`;}
export function sessionSRT(turns:SessionTurn[]){return turns.filter(t=>t.phase==='done'&&(!t.requiresReview||t.reviewed)).map((t,index)=>`${index+1}\n${subtitleTime(t.startedMs)} --> ${subtitleTime(Math.max(t.startedMs+1000,t.endedMs))}\n${t.translated.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}\n`).join('\n');}
export function sessionJSON(title:string,turns:SessionTurn[]){return JSON.stringify({format:'cattalk-session-v1',title,exportedAt:new Date().toISOString(),timing:'capture relative to session; processing includes network',turns},null,2);}
export function inputLevel(db:number){return !Number.isFinite(db)||db< -55?'weak':db> -2.5?'loud':'present';}
export function spokenHints(language:Language,terms:{sourceLanguage:Language;source:string}[]){const values:string[]=[];for(const term of terms){if(term.sourceLanguage!==language||values.includes(term.source)||term.source.length>40)continue;const candidate=[...values,term.source].join(', ');if(utf8Size(candidate)>160)continue;values.push(term.source);if(values.length===8)break;}return values;}
export function utf8Size(text:string){let count=0;for(const c of text){const point=c.codePointAt(0)!;count+=point<128?1:point<2048?2:point<65536?3:4;}return count;}
