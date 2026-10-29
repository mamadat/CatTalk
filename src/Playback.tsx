import React, {useCallback,useEffect,useRef,useState} from 'react';
import {View} from 'react-native';
import {useAudioPlayer,useAudioPlayerStatus,setAudioModeAsync} from 'expo-audio';
import {AudioClip} from './domain';
import {Button,C,T} from './ui';
let pauseActive: (() => void) | undefined;

export function Playback({clip}: {clip: AudioClip}) {
  const player = useAudioPlayer(clip.uri);
  const status = useAudioPlayerStatus(player);
  const [error, setError] = useState('');
  const pause = useCallback(() => player.pause(),[player]);
  const currentPlayer=useRef<typeof player|undefined>(player);currentPlayer.current=player;
  useEffect(() => () => {if (pauseActive === pause) pauseActive = undefined;if(currentPlayer.current===player)currentPlayer.current=undefined;}, [pause,player]);
  async function toggle() {
    try {
      setError('');
      if (status.playing) player.pause();
      else {
        pauseActive?.(); pauseActive = pause;
        await setAudioModeAsync({allowsRecording:false, playsInSilentMode:true});
        if(currentPlayer.current!==player)return;
        if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.1)) await player.seekTo(0);
        if(currentPlayer.current!==player)return;
        player.play();
      }
    } catch { setError('پخش صدا ممکن نشد؛ دوباره تلاش کنید.'); }
  }
  return <View style={{gap:6}}><Button secondary small title={status.playing ? 'توقف پخش' : `شنیدن صدا · ${Math.round(clip.seconds).toLocaleString('fa-IR')} ثانیه`} icon={status.playing ? 'pause' : 'play'} onPress={toggle}/>{error ? <T style={{color:C.danger}}>{error}</T> : null}</View>;
}

export function pauseCurrentAudio(){pauseActive?.();pauseActive=undefined;}
