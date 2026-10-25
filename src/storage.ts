import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialStore, Store } from './domain';
const KEY = 'cattalk.local.v1';
export async function loadStore(): Promise<Store> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return initialStore;
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.cats) || !Array.isArray(data.sessions) || !Array.isArray(data.cues) || typeof data.selectedCatId !== 'string') {
    throw new Error('فرمت داده‌های ذخیره‌شده قابل خواندن نیست. داده‌ها بازنویسی نشده‌اند.');
  }
  return data;
}
export async function saveStore(store: Store) {
  await AsyncStorage.setItem(KEY, JSON.stringify(store));
}
