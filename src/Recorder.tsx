import React, {useEffect, useRef, useState} from 'react';
import { AppState, View } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { AudioClip } from './domain';
import { persistAudio, removeAudio } from './audioFiles';
import {Button, C, T} from './ui';

export {Playback} from './Playback';
import {pauseCurrentAudio} from './Playback';

export function Recorder({onRecorded, onBusy, title = 'شروع ضبط', maxSeconds = 20}: {onRecorded: (clip: AudioClip) => Promise<void>; onBusy?: (busy: boolean) => void; title?: string; maxSeconds?: number}) {
  const recorder = useAudioRecorder({...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true});
  const state = useAudioRecorderState(recorder, 150);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const active = useRef(false);
  const mounted=useRef(true),generation=useRef(0);
  const startTime = useRef(0);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => { onBusy?.(busy || state.isRecording); }, [busy, state.isRecording, onBusy]);
  useEffect(() => {
    mounted.current=true;
    const sub = AppState.addEventListener('change', next => { if (next !== 'active') {generation.current++;if(active.current)void stopRef.current();} });
    return () => {mounted.current=false;generation.current++;sub.remove();/* useAudioRecorder owns native disposal. */};
  }, [recorder]);
  async function stop() {
    if (lock.current || !active.current) return;
    lock.current = true; setBusy(true);
    let saved: string | undefined;
    try {
      const seconds = Math.min(maxSeconds, (Date.now() - startTime.current) / 1000);
      await recorder.stop(); active.current = false;
      if(!mounted.current)return;
      await setAudioModeAsync({allowsRecording:false, playsInSilentMode:true});
      if(!mounted.current)return;
      if (!recorder.uri || seconds < 1) throw new Error('ضبط خیلی کوتاه بود؛ دست‌کم یک ثانیه ضبط کنید.');
      saved = await persistAudio(recorder.uri);
      if(!mounted.current){await removeAudio(saved).catch(()=>{});return;}
      await onRecorded({uri:saved, seconds});
    } catch (e) {
      if (saved) await removeAudio(saved).catch(() => {});
      if(mounted.current)setError(e instanceof Error ? e.message : 'ذخیرهٔ صدا ناموفق بود.');
    } finally {active.current = false; lock.current = false;if(mounted.current){setBusy(false); onBusy?.(false);}}
  }
  stopRef.current = stop;
  useEffect(() => {
    if (!state.isRecording) return;
    const timer = setTimeout(() => void stopRef.current(), Math.max(0, maxSeconds * 1000 - (Date.now() - startTime.current)));
    return () => clearTimeout(timer);
  }, [state.isRecording, maxSeconds]);
  async function start() {
    if (lock.current) return;
    const id=++generation.current;const current=()=>mounted.current&&id===generation.current;
    lock.current = true; setBusy(true); setError('');
    try {
      pauseCurrentAudio();
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if(!current())return;
      if (!permission.granted) throw new Error('دسترسی میکروفون را در تنظیمات دستگاه یا مرورگر فعال کنید.');
      await setAudioModeAsync({allowsRecording:true, playsInSilentMode:true});
      if(!current())return;
      await recorder.prepareToRecordAsync();
      if(!current()){if(mounted.current)await recorder.stop().catch(()=>{});return;}
      recorder.record(); startTime.current = Date.now(); active.current = true;
    } catch (e) {if(current())setError(e instanceof Error ? e.message : 'ضبط آغاز نشد. میکروفون را بررسی کنید.');}
    finally {lock.current = false;if(mounted.current){setBusy(false);if(!active.current)void setAudioModeAsync({allowsRecording:false,playsInSilentMode:true}).catch(()=>{});}}
  }
  return <View style={{gap:14}}>
    <View style={{height:52, flexDirection:'row', justifyContent:'center', alignItems:'center', gap:4}}>
      {Array.from({length:27}, (_,i) => <View key={i} style={{width:5, borderRadius:4, backgroundColor:state.isRecording ? C.green : '#C9DAD0', height:state.isRecording ? 8 + Math.max(0, (state.metering ?? -22) + 55) * (0.3 + (i % 7) / 8) : 8 + Math.sin(i * 1.7) ** 2 * 24}}/>)}
    </View>
    <T style={{textAlign:'center', color:C.muted, fontSize:12}}>{state.isRecording ? `در حال ضبط · ${Math.floor(state.durationMillis / 1000).toLocaleString('fa-IR')} ثانیه` : `حداکثر ${maxSeconds.toLocaleString('fa-IR')} ثانیه · ذخیره فقط روی دستگاه`}</T>
    <Button disabled={busy} title={busy ? 'در حال آماده‌سازی…' : state.isRecording ? 'پایان و ذخیرهٔ ضبط' : title} icon={state.isRecording ? 'stop-circle-outline' : 'mic-outline'} onPress={() => void (state.isRecording ? stop() : start())}/>
    {!!error && <T accessibilityRole="alert" style={{color:C.danger, fontSize:13}}>{error}</T>}
  </View>;
}
