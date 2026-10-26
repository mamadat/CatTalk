import {TranslationRequest} from '../../shared/translation';
import {Transport} from './controller';

/** Incremental sentence boundaries: never re-speak previously emitted text. */
export class SentenceBuffer {
  private pending='';
  push(delta:string,final=false):string[] {
    this.pending+=delta;const result:string[]=[];
    while(this.pending.length) {
      const end=/[。！？!؟\n]|\.(?=\s)/u.exec(this.pending);
      let length=end ? end.index+end[0].length : 0;
      if (!length && this.pending.length>260) {
        const space=this.pending.lastIndexOf(' ',240);length=space>100 ? space+1 : 240;
        const code=this.pending.charCodeAt(length-1);if(code>=0xD800 && code<=0xDBFF)length--;
      }
      if(!length && final)length=this.pending.length;
      if(!length)break;
      const sentence=this.pending.slice(0,length).trim();this.pending=this.pending.slice(length);
      if(sentence)result.push(sentence);
    }
    return result;
  }
}
export interface VoiceTurnState {phase:'idle'|'transcribing'|'translating'|'speaking'|'done'|'error';transcript:string;translation:string;error?:string;firstTextMs?:number;firstAudioMs?:number;elapsedMs?:number;}
export const emptyVoiceState:VoiceTurnState={phase:'idle',transcript:'',translation:''};
export interface SpeechSession {enqueue(text:string):void;drain():Promise<void>;stop():void;}
export type SpeechFactory=(signal:AbortSignal,onStart:()=>void)=>SpeechSession;
export class VoiceTurnController {
  private generation=0;private abort?:AbortController;private speech?:SpeechSession;
  constructor(private transport:Transport,private makeSpeech:SpeechFactory,private publish:(state:VoiceTurnState)=>void) {}
  stop() {this.generation++;this.abort?.abort();this.speech?.stop();}
  async run(request:Omit<TranslationRequest,'text'>,getTranscript:(signal:AbortSignal)=>Promise<string>) {
    this.stop();const generation=this.generation;const abort=new AbortController();this.abort=abort;
    const current=()=>generation===this.generation && !abort.signal.aborted;
    const state:VoiceTurnState={phase:'transcribing',transcript:'',translation:''};const started=Date.now();
    const update=()=>{if(current())this.publish({...state});};update();
    const sentences=new SentenceBuffer();
    const speech=this.makeSpeech(abort.signal,()=>{if(!current())return;state.firstAudioMs ??= Date.now()-started;update();});this.speech=speech;
    try {
      const text=await getTranscript(abort.signal);if(!current())return;
      if(!text.trim())throw new Error('گفتار قابل‌تشخیصی دریافت نشد.');
      if(text.length>2000)throw new Error('ویس طولانی است؛ آن را به بخش‌های کوتاه‌تر تقسیم کنید.');
      state.transcript=text;state.phase='translating';update();let complete=false;
      await this.transport({...request,text},abort.signal,event=>{
        if(!current())return;
        if(event.type==='error')throw new Error(event.message);
        if(event.type==='delta') {
          state.translation+=event.text;state.firstTextMs ??= Date.now()-started;update();
          for(const sentence of sentences.push(event.text))speech.enqueue(sentence);
        } else if(event.type==='complete') {complete=true;for(const sentence of sentences.push('',true))speech.enqueue(sentence);}
      });
      if(!current())return;if(!complete)throw new Error('ترجمه پیش از تکمیل قطع شد.');
      state.phase='speaking';update();await speech.drain();if(!current())return;
      state.phase='done';state.elapsedMs=Date.now()-started;update();
    } catch(error) {
      if(!current())return;speech.stop();state.phase='error';state.error=error instanceof Error?error.message:'ترجمهٔ صوتی انجام نشد.';update();throw error;
    }
  }
}
