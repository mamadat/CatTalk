import { TranslationEvent, TranslationRequest } from '../../shared/translation';
export type Phase = 'idle' | 'paused' | 'waiting' | 'translating' | 'done' | 'error';
export interface LiveState {phase:Phase; text:string; error?:string; model?:string; elapsedMs?:number; firstTokenMs?:number}
export type Transport = (request:TranslationRequest,signal:AbortSignal,emit:(event:TranslationEvent) => void) => Promise<void>;
export const emptyLiveState:LiveState={phase:'idle',text:''};

/** Cancellation plus generation IDs: even a transport ignoring abort cannot publish stale output. */
export class LiveTranslationController {
  private generation=0;
  private timer:ReturnType<typeof setTimeout> | undefined;
  private abort:AbortController | undefined;
  private disposed=false;
  constructor(private transport:Transport,private publish:(state:LiveState) => void,private debounceMs=450) {}
  update(request:TranslationRequest | null,enabled=true,immediate=false) {
    if (this.disposed) return;
    this.generation++; clearTimeout(this.timer); this.abort?.abort();
    if (!request?.text.trim()) {this.publish(emptyLiveState);return;}
    if (!enabled) {this.publish({phase:'paused',text:''});return;}
    this.publish({phase:'waiting',text:''});
    const generation=this.generation;
    this.timer=setTimeout(() => void this.run(request,generation),immediate ? 0 : this.debounceMs);
  }
  private async run(request:TranslationRequest,generation:number) {
    const abort=new AbortController();this.abort=abort;
    const current=() => !this.disposed && generation === this.generation && !abort.signal.aborted;
    let text='';let complete=false;let firstTokenMs:number | undefined;const started=Date.now();
    if (!current()) return;
    this.publish({phase:'translating',text:''});
    try {
      await this.transport(request,abort.signal,event => {
        if (!current()) return;
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'delta') {
          firstTokenMs ??= Date.now()-started;
          text += event.text;
          this.publish({phase:'translating',text,firstTokenMs});
        } else if (event.type === 'complete') {
          complete=true;
          this.publish({phase:'done',text,model:event.model,elapsedMs:Date.now()-started,firstTokenMs});
        }
      });
      if (current() && !complete) throw new Error('ترجمه پیش از تکمیل قطع شد؛ دوباره تلاش کنید.');
    } catch (error) {
      if (current()) this.publish({phase:'error',text:'',error:error instanceof Error ? error.message : 'ترجمه انجام نشد.'});
    }
  }
  dispose() {this.disposed=true;this.generation++;clearTimeout(this.timer);this.abort?.abort();}
}
