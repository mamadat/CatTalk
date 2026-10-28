import {spawn,ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync} from 'node:fs';
import {basename,isAbsolute,resolve} from 'node:path';
import {TranscribeRequest} from '../shared/voice';
import {TranslationError} from '../shared/translation';

export interface LocalVoiceStatus {configured:boolean;model:string;qualityModel:string;local:true;message:string;availableModes:{fast:boolean;accurate:boolean};}
export interface LocalTranscriber {status:LocalVoiceStatus;refresh:()=>Promise<LocalVoiceStatus>;transcribe:(request:TranscribeRequest,signal:AbortSignal)=>Promise<{text:string;model:string}>;dispose:()=>void;}
interface Job {id:number;request:TranscribeRequest;signal:AbortSignal;resolve:(value:{text:string;model:string})=>void;reject:(error:unknown)=>void;cancel:()=>void;timer?:ReturnType<typeof setTimeout>;}
const failure=(code:string,message:string,status=503)=>new TranslationError(code,message,status);
const errors:Record<string,[string,number]>={
 NO_SPEECH:['گفتار قابل‌تشخیصی پیدا نشد؛ ورودی میکروفون را بررسی کنید.',422],
 AUDIO_DECODE:['خواندن فایل صوتی ممکن نشد؛ WAV، MP3، M4A یا WebM معتبر انتخاب کنید.',400],
 AUDIO_SIZE:['حداکثر حجم ویس ۶ مگابایت است.',413],
 AUDIO_DURATION:['صدای محلی باید حداکثر ۱۲۵ ثانیه باشد؛ ویس را کوتاه‌تر کنید.',413],
 LONG_TRANSCRIPT:['متن ویس از ۲۰۰۰ نویسه بیشتر شد؛ نوبت کوتاه‌تری بفرستید.',413],
 LOCAL_MODEL_MISSING:['مدل محلی این حالت نصب نشده است؛ راه‌انداز Start-LocalVoice.ps1 را اجرا کنید.',503],
};

/** Private persistent process, serial bounded queue, local models only. No HTTP model URL. */
export class PythonWhisper implements LocalTranscriber {
 readonly status:LocalVoiceStatus;
 private python:string;private worker:string;private workerEnv:NodeJS.ProcessEnv;private child?:ChildProcessWithoutNullStreams;private buffer='';
 private queue:Job[]=[];private active?:Job;private serial=0;private closed=false;private refreshed=0;private probing?:Promise<LocalVoiceStatus>;private probes=new Set<ChildProcessWithoutNullStreams>();
 private exitHook?:()=>void;private timeoutMs:number;
 constructor(env:Record<string,string|undefined>,options:{workerPath?:string;timeoutMs?:number}={}){
  const root=resolve('.local/whisper');this.python=env.LOCAL_WHISPER_PYTHON || resolve(root,process.platform==='win32'?'venv/Scripts/python.exe':'venv/bin/python');
  this.worker=options.workerPath || resolve('scripts/whisper_worker.py');this.timeoutMs=options.timeoutMs ?? 300000;
  const fast=env.LOCAL_WHISPER_MODEL || 'small',quality=env.LOCAL_WHISPER_QUALITY_MODEL || fast;
  const modelPath=(name:string)=>isAbsolute(name)?resolve(name):resolve(root,'models',name);
  const device=env.LOCAL_WHISPER_DEVICE || 'cpu',compute=env.LOCAL_WHISPER_COMPUTE || (device==='cuda'?'float16':'int8');
  if(!['cpu','cuda'].includes(device)||!['int8','float32','float16','int8_float16'].includes(compute))throw new Error('Invalid local Whisper device or compute type');
  const threads=Number(env.LOCAL_WHISPER_THREADS || '4');if(!Number.isInteger(threads)||threads<1||threads>32)throw new Error('LOCAL_WHISPER_THREADS must be 1..32');
  // Deliberately do not give the worker cloud API keys or gateway credentials.
  this.workerEnv={...Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','HOME','LD_LIBRARY_PATH'].filter(key=>process.env[key]).map(key=>[key,process.env[key]])),NODE_ENV:process.env.NODE_ENV || 'production',PYTHONUTF8:'1',PYTHONUNBUFFERED:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',HF_HUB_DISABLE_PROGRESS_BARS:'1',DO_NOT_TRACK:'1',CAT_WHISPER_FAST:modelPath(fast),CAT_WHISPER_ACCURATE:modelPath(quality),CAT_WHISPER_DEVICE:device,CAT_WHISPER_COMPUTE:compute,CAT_WHISPER_THREADS:String(threads)};
  this.status={configured:false,model:`faster-whisper/${basename(fast)}`,qualityModel:`faster-whisper/${basename(quality)}`,local:true,availableModes:{fast:false,accurate:false},message:'برای نصب تشخیص گفتار محلی، Start-LocalVoice.ps1 را اجرا و سپس «بررسی دوباره» را بزنید.'};
 }
 async refresh(){
  if(this.closed)return this.status;if(this.probing)return this.probing;if(Date.now()-this.refreshed<10000)return this.status;
  this.probing=this.inspect().finally(()=>{this.probing=undefined;this.refreshed=Date.now();});return this.probing;
 }
 private async inspect(){
  const missing=()=>{this.status.configured=false;this.status.availableModes={fast:false,accurate:false};return this.status;};
  if(!existsSync(this.python)||!existsSync(this.worker)){this.status.message='برای نصب تشخیص گفتار محلی، Start-LocalVoice.ps1 را اجرا کنید.';return missing();}
  const result=await new Promise<any>(resolveProbe=>{
   const child=spawn(this.python,[this.worker,'--probe'],{env:this.workerEnv,windowsHide:true,stdio:['pipe','pipe','pipe']});this.probes.add(child);let output='',settled=false;
   const finish=(value:any)=>{if(settled)return;settled=true;clearTimeout(timer);this.probes.delete(child);child.kill();resolveProbe(value);};
   const timer=setTimeout(()=>finish(null),7000);child.stderr.resume();child.stdout.setEncoding('utf8');
   child.stdout.on('data',chunk=>{output+=chunk;if(output.length>16384)finish(null);});child.on('error',()=>finish(null));child.on('exit',code=>{try{finish(code===0?JSON.parse(output):null);}catch{finish(null);}});child.stdin.end();
  });
  if(this.closed)return missing();
  this.status.availableModes={fast:!!result?.runtime&&result.fast===true,accurate:!!result?.runtime&&result.accurate===true};this.status.configured=Object.values(this.status.availableModes).some(Boolean);
  this.status.message=this.status.configured?'تشخیص گفتار روی همین رایانه؛ بدون کلید API و هزینهٔ هر درخواست.':result?.runtime?'مدل گفتار نصب نشده یا ناقص است؛ Start-LocalVoice.ps1 را اجرا کنید.':'محیط Python یا کتابخانهٔ faster-whisper آماده نیست؛ Start-LocalVoice.ps1 را اجرا کنید.';return this.status;
 }
 async transcribe(request:TranscribeRequest,signal:AbortSignal){
  if(signal.aborted)throw failure('ABORTED','پردازش صدا لغو شد.',499);
  if(this.closed)throw failure('LOCAL_VOICE_CLOSED','سرویس محلی بسته شده است.');
  const status=await this.refresh();if(signal.aborted)throw failure('ABORTED','پردازش صدا لغو شد.',499);
  if(!status.availableModes[request.recognition || 'fast'])throw failure('LOCAL_VOICE_NOT_READY',status.configured?'مدل گفتار این حالت نصب نشده است؛ Start-LocalVoice.ps1 را با مدل انتخابی اجرا کنید.':status.message);
  if(this.queue.length+(this.active?1:0)>=3)throw failure('LOCAL_VOICE_BUSY','صف تشخیص گفتار محلی پر است؛ پس از پایان پردازش تلاش کنید.',429);
  return new Promise<{text:string;model:string}>((resolveJob,reject)=>{
   const job:Job={id:++this.serial,request,signal,resolve:resolveJob,reject,cancel:()=>this.abortJob(job)};
   signal.addEventListener('abort',job.cancel,{once:true});this.queue.push(job);this.pump();
  });
 }
 private settle(job:Job,error?:unknown,value?:{text:string;model:string}){clearTimeout(job.timer);job.signal.removeEventListener('abort',job.cancel);error?job.reject(error):job.resolve(value!);}
 private abortJob(job:Job){
  if(this.active===job){this.active=undefined;this.stopWorker();this.settle(job,failure('ABORTED','پردازش صدا لغو شد.',499));}
  else{const index=this.queue.indexOf(job);if(index<0)return;this.queue.splice(index,1);this.settle(job,failure('ABORTED','پردازش صدا لغو شد.',499));}
  setImmediate(()=>this.pump());
 }
 private stopWorker(){const child=this.child;this.child=undefined;this.buffer='';if(this.exitHook){process.removeListener('exit',this.exitHook);this.exitHook=undefined;}if(child){child.stdin.destroy();child.kill();}}
 private failed(child:ChildProcessWithoutNullStreams,code='LOCAL_RUNTIME'){
  if(this.child!==child)return;const active=this.active;this.active=undefined;this.stopWorker();if(active)this.settle(active,failure(code,'اجرای گفتار محلی انجام نشد؛ نصب Python، کتابخانه‌ها، حافظه و مدل را بررسی کنید.',502));setImmediate(()=>this.pump());
 }
 private startWorker(){
  const child=spawn(this.python,[this.worker],{env:this.workerEnv,windowsHide:true,stdio:['pipe','pipe','pipe']});this.child=child;this.buffer='';
  this.exitHook=()=>child.kill();process.once('exit',this.exitHook);child.stderr.resume();child.stdout.setEncoding('utf8');
  child.on('error',()=>this.failed(child));child.on('exit',()=>this.failed(child));child.stdin.on('error',()=>this.failed(child));
  child.stdout.on('data',chunk=>{
   if(this.child!==child)return;this.buffer+=chunk;if(this.buffer.length>32768){this.failed(child);return;}
   let end:number;while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);if(!line.trim())continue;
    try{const data=JSON.parse(line),job=this.active;if(!job||data.id!==job.id)throw new Error('Protocol');this.active=undefined;
     if(data.error){const mapped=errors[data.error];this.settle(job,failure(typeof data.error==='string'&&mapped?data.error:'LOCAL_RUNTIME',mapped?.[0] || 'مدل محلی اجرا نشد؛ وابستگی‌های Python، توان سخت‌افزار و مدل نصب‌شده را بررسی کنید.',mapped?.[1] || 502));}
     else if(typeof data.text!=='string'||!data.text.trim()||data.text.length>2000){this.settle(job,failure('LOCAL_RESPONSE','پاسخ گفتار محلی معتبر نیست.',502));}
     else this.settle(job,undefined,{text:data.text.trim(),model:job.request.recognition==='accurate'?this.status.qualityModel:this.status.model});
     this.pump();
    }catch{this.failed(child);return;}
   }
  });return child;
 }
 private pump(){
  if(this.closed||this.active)return;const job=this.queue.shift();if(!job)return;if(job.signal.aborted){this.settle(job,failure('ABORTED','پردازش لغو شد.',499));setImmediate(()=>this.pump());return;}
  this.active=job;const child=this.child || this.startWorker();job.timer=setTimeout(()=>{if(this.active!==job)return;this.active=undefined;this.stopWorker();this.settle(job,failure('LOCAL_VOICE_TIMEOUT','پردازش محلی بیش از حد طول کشید؛ مدل کوچک‌تر یا ویس کوتاه‌تر انتخاب کنید.',504));this.pump();},this.timeoutMs);
  child.stdin.write(JSON.stringify({id:job.id,language:job.request.language,audioBase64:job.request.audioBase64,recognition:job.request.recognition || 'fast',hints:job.request.hints || []})+'\n');
 }
 dispose(){this.closed=true;for(const child of this.probes)child.kill();this.probes.clear();const jobs=[...(this.active?[this.active]:[]),...this.queue];this.active=undefined;this.queue=[];this.stopWorker();for(const job of jobs)this.settle(job,failure('ABORTED','پردازش صدا لغو شد.',499));}
}
