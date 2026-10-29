import {MAX_SUBTITLE_BYTES} from './subtitles';
export async function readSubtitleFile(uri:string){const response=await fetch(uri);const blob=await response.blob();if(blob.size>MAX_SUBTITLE_BYTES)throw new Error('حداکثر حجم زیرنویس ۱ مگابایت است.');return blob.text();}
export function releaseMediaFile(uri:string){if(uri.startsWith('blob:'))URL.revokeObjectURL(uri);}
