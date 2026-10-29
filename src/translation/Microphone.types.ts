import {Language} from '../../shared/translation';
export interface CaptureTiming {startedAt:number;endedAt:number;}
export interface MicrophoneProps {language:Language;disabled:boolean;audioReady:boolean;continuous?:boolean;maxTurnMs?:number;onAudio:(uri:string,mimeType:string,timing?:CaptureTiming)=>Promise<void>;onCancel:(reason?:'start'|'stop')=>void;onError:(message:string)=>void;onActiveChange:(active:boolean)=>void;}
