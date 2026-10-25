import { Directory, File, Paths } from 'expo-file-system';
import { uid } from './domain';
const directory = () => new Directory(Paths.document, 'cattalk-audio');
export async function persistAudio(uri: string): Promise<string> {
  const dir = directory();
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(uri);
  const dest = new File(dir, `${uid()}${file.extension || '.m4a'}`);
  file.copy(dest);
  return dest.uri;
}
export async function removeAudio(uri: string) {
  // Only delete recordings owned by this app, never caller-supplied external paths.
  if (uri.startsWith(directory().uri.replace(/\/+$/, '') + '/')) { const file = new File(uri); if (file.exists) file.delete(); }
}
