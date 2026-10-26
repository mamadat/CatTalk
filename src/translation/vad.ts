export const VOICE_PAUSE_MS=3000;
export const MAX_VOICE_TURN_MS=120000;
/** Keep the complete utterance through short pauses; silence ends a turn. */
export class PauseDetector {
  private started:number;private firstVoice?:number;private lastVoice?:number;
  constructor(now:number,private silenceMs=VOICE_PAUSE_MS,private maxMs=MAX_VOICE_TURN_MS) {this.started=now;}
  update(db:number,now:number):'wait'|'speech'|'empty' {
    if(db>-42) {this.firstVoice ??= now;this.lastVoice=now;}
    if(this.firstVoice!==undefined && this.lastVoice!==undefined && now-this.started>=700 && ((now-this.lastVoice>=this.silenceMs && this.lastVoice-this.firstVoice>=180) || now-this.firstVoice>=this.maxMs))return 'speech';
    if(this.firstVoice===undefined && now-this.started>=10000)return 'empty';
    return 'wait';
  }
}
