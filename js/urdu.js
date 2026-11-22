// Urdu script -> the words the request readers know (nlp.js patterns, nlu.js model), so a request spoken or typed in Urdu
// ("پانچ مرلہ، دو منزلہ، تین کمرے، کار پورچ") fills the form like "5 marla, double storey, 3 bedroom, car porch".
// Speech recognition in Urdu (ur-PK) writes English building words in Urdu letters (بیڈ روم, کچن, پورچ), so those are mapped too.
// Text without Urdu letters is returned unchanged.

const DIGITS = { '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9, '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9 };
const NUMS = {
  'ڈیڑھ': 1.5, 'ڈھائی': 2.5, 'اڑھائی': 2.5, 'ایک': 1, 'دو': 2, 'تین': 3, 'چار': 4, 'پانچ': 5, 'چھ': 6, 'چھے': 6, 'سات': 7, 'آٹھ': 8, 'نو': 9, 'دس': 10,
  'گیارہ': 11, 'بارہ': 12, 'تیرہ': 13, 'چودہ': 14, 'پندرہ': 15, 'سولہ': 16, 'سترہ': 17, 'اٹھارہ': 18, 'انیس': 19, 'بیس': 20, 'پچیس': 25,
  'تیس': 30, 'بتیس': 32, 'پینتیس': 35, 'چالیس': 40, 'پینتالیس': 45, 'پچاس': 50, 'پچپن': 55, 'ساٹھ': 60, 'پینسٹھ': 65, 'ستر': 70,
  'پچھتر': 75, 'اسی': 80, 'پچاسی': 85, 'نوے': 90, 'سو': 100,
};
// longest phrases first; values are what the English readers understand
const PHRASES = [
  ['دو منزلہ', ' double storey '], ['ڈبل سٹوری', ' double storey '], ['ڈبل اسٹوری', ' double storey '], ['ڈبل سٹوریز', ' double storey '],
  ['ایک منزلہ', ' single storey '], ['سنگل سٹوری', ' single storey '], ['سنگل اسٹوری', ' single storey '],
  ['الگ سیڑھیاں', ' separate stairs '], ['علیحدہ سیڑھیاں', ' separate stairs '], ['الگ سیڑھی', ' separate stairs '], ['باہر سے سیڑھیاں', ' separate stairs '],
  ['ٹی وی لاؤنج', ' tv lounge '], ['ٹی وی لاونج', ' tv lounge '], ['ڈرائنگ روم', ' drawing room '], ['ڈرائینگ روم', ' drawing room '],
  ['ڈائننگ روم', ' dining '], ['کار پورچ', ' car porch '], ['گاڑی کا پورچ', ' car porch '], ['گاڑیوں کا پورچ', ' car porch '],
  ['بیڈ روم', ' bedroom '], ['بیڈرومز', ' bedroom '], ['بیڈروم', ' bedroom '], ['بیڈ رومز', ' bedroom '],
  ['واش رومز', ' bath '], ['واش روم', ' bath '], ['باتھ رومز', ' bath '], ['باتھ روم', ' bath '], ['غسل خانے', ' bath '], ['غسل خانہ', ' bath '],
  ['باورچی خانہ', ' kitchen '], ['سرونٹ کوارٹر', ' servant room '], ['اوپر والی منزل', ' first floor '], ['پہلی منزل', ' first floor '],
  ['گراؤنڈ فلور', ' ground floor '], ['فرسٹ فلور', ' first floor '], ['کے بغیر', ' without '],
];
const WORDS = {
  'مرلہ': 'marla', 'مرلے': 'marla', 'مرلا': 'marla', 'مرلوں': 'marla', 'کنال': 'kanal', 'کنالیں': 'kanal',
  'کمرے': 'bedroom', 'کمرہ': 'bedroom', 'کمروں': 'bedroom', 'بیڈ': 'bed', 'بیڈز': 'bed', 'باتھ': 'bath', 'باتھز': 'bath', 'واشروم': 'bath',
  'منزل': 'floor', 'منزلیں': 'floors', 'منزلہ': 'storey', 'فلور': 'floor', 'فلورز': 'floors', 'سٹوری': 'storey', 'اسٹوری': 'storey',
  'کچن': 'kitchen', 'ڈرائنگ': 'drawing', 'لاؤنج': 'lounge', 'لاونج': 'lounge', 'ڈائننگ': 'dining', 'پورچ': 'porch', 'گاڑی': 'car', 'گاڑیاں': 'cars',
  'گاڑیوں': 'cars', 'کار': 'car', 'کاریں': 'cars', 'لان': 'lawn', 'گیراج': 'garage', 'سیڑھیاں': 'stairs', 'سیڑھی': 'stairs', 'سٹور': 'store',
  'سٹڈی': 'study', 'ٹیرس': 'terrace', 'چھت': 'roof', 'بالکونی': 'balcony', 'ڈوپلیکس': 'duplex', 'سنگل': 'single', 'ڈبل': 'double',
  'اوپر': 'upstairs', 'نیچے': 'downstairs', 'فٹ': 'ft', 'فیٹ': 'ft', 'بائی': 'x', 'ایکس': 'x', 'ضرب': 'x', 'پلاٹ': 'plot', 'گھر': 'house',
  'اور': 'and', 'ساتھ': 'with', 'بغیر': 'without', 'نہیں': 'no', 'الگ': 'separate', 'علیحدہ': 'separate', 'سامنے': 'front', 'پیچھے': 'back',
};
const FILLER = new Set(['کا', 'کی', 'کے', 'میں', 'ہے', 'ہیں', 'چاہیے', 'چاہئے', 'والا', 'والی', 'والے', 'ہو', 'جس', 'مجھے', 'ہمیں', 'بنا', 'دیں', 'ایسا', 'کوئی', 'بھی', 'سے']);
const URDU = /[؀-ۿ]/;

/** Urdu-script request -> English/Roman request words; anything else unchanged. */
export function fromUrdu(text) {
  if (!text || !URDU.test(text)) return text;
  let t = ` ${text.replace(/[۰-۹٠-٩]/g, (c) => DIGITS[c]).replace(/[،؛]/g, ' , ').replace(/۔/g, ' . ')} `;
  for (const [a, b] of PHRASES) t = t.split(a).join(b);
  return t.split(/\s+/).map((w) => {
    if (!w) return '';
    if (w in NUMS) return String(NUMS[w]);
    if (w in WORDS) return WORDS[w];
    if (FILLER.has(w)) return '';
    return w;
  }).join(' ').replace(/\s+/g, ' ').trim();
}
