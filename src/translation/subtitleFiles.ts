import {File,Paths} from 'expo-file-system';
import {MAX_SUBTITLE_BYTES} from './subtitles';
export async function readSubtitleFile(uri:string){const file=new File(uri);if(file.size>MAX_SUBTITLE_BYTES)throw new Error('حداکثر حجم زیرنویس ۱ مگابایت است.');return file.text();}
export function releaseMediaFile(uri:string){if(uri.startsWith(Paths.cache.uri)){try{const file=new File(uri);if(file.exists)file.delete();}catch{/* OS cache cleanup can finish later if the picker still holds the file. */}}}
