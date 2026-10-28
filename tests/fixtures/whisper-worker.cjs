// Protocol fixture only: this is never a speech model or a production fallback.
const fs=require('node:fs'),path=require('node:path');
if(process.argv.includes('--probe')){
 const ready=p=>['model.bin','config.json','tokenizer.json'].every(n=>fs.existsSync(path.join(p,n)));
 console.log(JSON.stringify({runtime:true,fast:ready(process.env.CAT_WHISPER_FAST),accurate:ready(process.env.CAT_WHISPER_ACCURATE)}));
}else{
 require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line),text=Buffer.from(m.audioBase64,'base64').toString();
  if(text==='hang')return;
  if(text==='crash')process.exit(7);
  if(text==='malformed'){console.log('invalid-json');return;}
  const result=text==='pid'?String(process.pid):text==='oversize'?'x'.repeat(2001):text==='secrets'?(process.env.OPENAI_API_KEY||process.env.GROQ_API_KEY||process.env.TRANSLATION_ACCESS_TOKEN?'LEAK':'no secrets'):text==='offline'?process.env.HF_HUB_OFFLINE:`${m.language}: ${text}`;
  console.log(JSON.stringify({id:m.id,text:result}));
 });
}
