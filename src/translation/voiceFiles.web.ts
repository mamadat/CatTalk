export async function readVoiceFile(uri:string):Promise<{base64:string;size:number}> {
  const response=await fetch(uri);const blob=await response.blob();return readVoiceBlob(blob);
}
export function readVoiceBlob(blob:Blob):Promise<{base64:string;size:number}> {
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('خواندن صدا ناموفق بود.'));reader.onload=()=>resolve({base64:String(reader.result).split(',')[1],size:blob.size});reader.readAsDataURL(blob);});
}
export async function temporarySpeech(base64:string) {
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const uri=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));return {uri,dispose:()=>URL.revokeObjectURL(uri)};
}
export async function removeVoiceTemp(uri:string) {if(uri.startsWith('blob:'))URL.revokeObjectURL(uri);}
