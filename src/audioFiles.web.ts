export async function persistAudio(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ذخیرهٔ صدا ناموفق بود.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}
export async function removeAudio(_uri: string) { /* Data URIs are removed with their parent record. */ }
