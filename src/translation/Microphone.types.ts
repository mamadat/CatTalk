import {Language} from '../../shared/translation';
export interface MicrophoneProps {language:Language;disabled:boolean;audioReady:boolean;onText:(text:string)=>Promise<void>;onAudio:(uri:string,mimeType:string)=>Promise<void>;onInterim:(text:string)=>void;onCancel:()=>void;onError:(message:string)=>void;onActiveChange:(active:boolean)=>void;}
