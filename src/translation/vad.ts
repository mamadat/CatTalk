/** Conservative pause detector; thresholds can be tuned on real devices. */
export class PauseDetector {
  private started:number;private firstVoice?:number;private lastVoice?:number;
  constructor(now:number,private silenceMs=600,private maxMs=7000) {this.started=now;}
  update(db:number,now:number):'wait'|'speech'|'empty' {
    if(db>-42) {this.firstVoice ??= now;this.lastVoice=now;}
    if(this.firstVoice!==undefined && this.lastVoice!==undefined && now-this.started>=700 && ((now-this.lastVoice>=this.silenceMs && this.lastVoice-this.firstVoice>=180) || now-this.firstVoice>=this.maxMs))return 'speech';
    if(now-this.started>=10000)return this.firstVoice===undefined?'empty':'speech';
    return 'wait';
  }
}
