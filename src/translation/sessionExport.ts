import {Directory,File,Paths} from 'expo-file-system';
import * as Sharing from 'expo-sharing';
/** Files are created only after an explicit export; retained briefly for share consumers. */
export async function exportSessionFile(text:string,format:'json'|'srt'){
 if(!await Sharing.isAvailableAsync())throw new Error('اشتراک فایل روی این دستگاه در دسترس نیست.');
 const folder=new Directory(Paths.cache,'cattalk-session-exports');folder.create({idempotent:true,intermediates:true});
 const ownFiles=folder.list().filter((entry):entry is File=>entry instanceof File&&/^cattalk-session-\d+-[a-z0-9]+\.(json|srt)$/.test(entry.name)).sort((a,b)=>Number(b.name.split('-')[2])-Number(a.name.split('-')[2]));
 ownFiles.forEach((file,index)=>{if(index>=4||Date.now()-Number(file.name.split('-')[2])>86400000)file.delete();});
 const file=new File(folder,`cattalk-session-${Date.now()}-${Math.random().toString(36).slice(2)}.${format}`);file.write(text);
 await Sharing.shareAsync(file.uri,{mimeType:format==='json'?'application/json':'application/x-subrip',UTI:format==='json'?'public.json':'public.plain-text',dialogTitle:'ذخیره یا اشتراک خروجی جلسه'});
}
