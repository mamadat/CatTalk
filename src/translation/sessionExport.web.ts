export async function exportSessionFile(text:string,format:'json'|'srt'){
 const uri=URL.createObjectURL(new Blob([text],{type:format==='json'?'application/json;charset=utf-8':'application/x-subrip;charset=utf-8'}));
 try{const link=document.createElement('a');link.href=uri;link.download=`cattalk-session.${format}`;link.click();}finally{setTimeout(()=>URL.revokeObjectURL(uri),1000);}
}
