export const places = { unknown: 'مشخص نیست', food: 'کنار ظرف غذا', door: 'کنار در', person: 'کنار من', toy: 'کنار اسباب‌بازی', unfamiliar: 'محیط ناآشنا' } as const;
export const behaviors = { unknown: 'مشخص نیست', relaxed: 'بدن آرام', approaching: 'نزدیک می‌شود', retreating: 'دور می‌شود / پنهان می‌شود', tense: 'بدن منقبض / گوش عقب', looking: 'به من نگاه می‌کند' } as const;
export const calls = { unknown: 'نمی‌دانم', meow: 'میو', repeated: 'میوهای تکراری', purr: 'خرخر', hiss: 'فیس / غرّش' } as const;
export type Intent = 'food' | 'social' | 'access' | 'play' | 'space' | 'unknown';
export const intents: Record<Intent, string> = { food: 'انتظار غذا', social: 'تمایل به تعامل', access: 'درخواست دسترسی', play: 'آمادگی برای بازی', space: 'نیاز احتمالی به فاصله', unknown: 'اطلاعات کافی نیست' };
export interface Context { place: keyof typeof places; behavior: keyof typeof behaviors; call: keyof typeof calls }
export interface Cat { id: string; name: string; age: string }
export interface AudioClip { uri: string; seconds: number }
export interface Interpretation { intent: Intent; alternatives: Intent[]; reasons: string[]; action: string; personalized: boolean; version: 'context-v1' }
export interface Session { id: string; catId: string; createdAt: string; context: Context; audio?: AudioClip; result: Interpretation; feedback?: Intent; outcome?: string }
export interface Cue { id: string; catId: string; kind: 'come' | 'food' | 'play'; audio: AudioClip; trials: number; responses: number }
export interface Store { version: 1; cats: Cat[]; selectedCatId: string; sessions: Session[]; cues: Cue[] }
export const initialStore: Store = { version: 1, cats: [], selectedCatId: '', sessions: [], cues: [] };
export const emptyContext: Context = { place: 'unknown', behavior: 'unknown', call: 'unknown' };
export function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
const actions: Record<Intent, string> = {
  food: 'روال و زمان غذا را بررسی کنید؛ صرف میوکردن دلیل افزایش غذا نیست. واکنش بعدی را ثبت کنید.',
  social: 'فرصت نزدیک‌شدن داوطلبانه بدهید و با آرامش پلک بزنید. اگر دور شد، تعامل را متوقف کنید.',
  access: 'بررسی کنید گربه به چه فضایی توجه دارد. فقط اگر امن است دسترسی بدهید و نتیجه را ثبت کنید.',
  play: 'اسباب‌بازی آشنا را پیشنهاد کنید و ببینید آیا داوطلبانه وارد بازی می‌شود.',
  space: 'تعامل و پخش صدا را متوقف کنید و به گربه فضا بدهید. این برداشت تشخیص درد یا بیماری نیست.',
  unknown: 'موقعیت و رفتار را دقیق‌تر مشاهده کنید. صدای ضبط‌شده به‌تنهایی در این نسخه تفسیر نمی‌شود.',
};
/** Transparent, unvalidated context rules. No acoustic/semantic AI is claimed. */
export function interpret(context: Context, catId: string, history: Session[]): Interpretation {
  const scores: Record<Intent, number> = { food: 0, social: 0, access: 0, play: 0, space: 0, unknown: 0 };
  const reasons: string[] = [];
  const add = (intent: Intent, amount: number, reason: string) => { scores[intent] += amount; reasons.push(reason); };
  if (context.place === 'food') add('food', 3, 'شما حضور کنار ظرف غذا را ثبت کردید.');
  if (context.place === 'door') add('access', 3, 'شما حضور کنار در را ثبت کردید.');
  if (context.place === 'toy') add('play', 3, 'شما حضور کنار اسباب‌بازی را ثبت کردید.');
  if (context.place === 'person') add('social', 1, 'گربه طبق مشاهدهٔ شما کنار شماست.');
  if (context.behavior === 'approaching') add('social', 2, 'شما نزدیک‌شدن گربه را مشاهده کردید.');
  if (context.behavior === 'looking' && context.place === 'person') add('social', 1, 'شما نگاه به خودتان را ثبت کردید.');
  const withdrawal = context.behavior === 'tense' || context.behavior === 'retreating' || context.call === 'hiss';
  if (withdrawal) add('space', 6, 'شما نشانهٔ اجتناب، تنش یا فیس‌کردن را گزارش کردید.');
  // Purring and repeated meows alone are deliberately not assigned a meaning.
  const comparable = history.filter(s => s.catId === catId && s.context.place === context.place && s.context.behavior === context.behavior && s.feedback && s.feedback !== 'unknown');
  let personalized = false;
  if (context.place !== 'unknown' && comparable.length >= 3 && !withdrawal) {
    const counts: Partial<Record<Intent, number>> = {};
    comparable.forEach(s => { counts[s.feedback!] = (counts[s.feedback!] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] / comparable.length >= 0.67 && scores[top[0] as Intent] > 0) {
      scores[top[0] as Intent] += 1; personalized = true;
      reasons.push('بازخوردهای قبلی شما در موقعیت مشابه از این برداشت حمایت می‌کنند؛ این بازخوردها اثبات علمی نیستند.');
    }
  }
  const ranked = (Object.keys(scores) as Intent[]).filter(k => k !== 'unknown').sort((a,b) => scores[b] - scores[a]);
  const first = ranked[0];
  const intent = scores[first] >= 2 ? first : 'unknown';
  return { intent, alternatives: intent === 'unknown' ? [] : ranked.filter(k => k !== intent && scores[k] > 0).slice(0, 2), reasons: intent === 'unknown' ? ['اطلاعات ثبت‌شده برای پیشنهاد یک برداشت کافی نیست.'] : reasons, action: actions[intent], personalized, version: 'context-v1' };
}
export const cueInfo = {
  come: { title: 'بیا پیش من', icon: 'hand-left-outline', guide: 'یک عبارت کوتاه را با صدای آرام خودتان ضبط کنید. ابتدا در فاصلهٔ نزدیک و همراه با تجربهٔ خوشایند از آن استفاده کنید. نزدیک‌شدن باید داوطلبانه باشد.' },
  food: { title: 'وقت غذاست', icon: 'restaurant-outline', guide: 'یک عبارت ثابت را پیش از وعدهٔ معمول غذا پخش کنید. برای آزمایش، غذا را به تأخیر نیندازید. در آزمون‌های بعدی توجه به محل غذا را ثبت کنید.' },
  play: { title: 'بازی کنیم؟', icon: 'tennisball-outline', guide: 'عبارت خودتان را همراه با ارائهٔ اسباب‌بازی آشنا تکرار کنید. بعداً بررسی کنید آیا بدون نشان‌دادن اسباب‌بازی هم واکنش مرتبط دیده می‌شود.' },
} as const;
