import {Language} from '../../shared/translation';
export interface MicrophoneProps {language:Language;disabled:boolean;audioReady:boolean;onAudio:(uri:string,mimeType:string)=>Promise<void>;onCancel:()=>void;onError:(message:string)=>void;onActiveChange:(active:boolean)=>void;}
