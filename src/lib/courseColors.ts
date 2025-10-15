export type CourseColorKey = 'red' | 'blue' | 'yellow' | 'orange' | 'pink' | 'sky' | 'purple';

export type CourseColorOption = {
  key: CourseColorKey;
  label: string;
  hex: string;
  textHex: string;
};

export const COURSE_COLOR_OPTIONS: CourseColorOption[] = [
  { key: 'red', label: '赤', hex: '#fee2e2', textHex: '#b91c1c' },
  { key: 'blue', label: '青', hex: '#bfdbfe', textHex: '#1d4ed8' },
  { key: 'yellow', label: '黄色', hex: '#fef08a', textHex: '#ca8a04' },
  { key: 'orange', label: 'オレンジ', hex: '#fed7aa', textHex: '#c2410c' },
  { key: 'pink', label: 'ピンク', hex: '#fbcfe8', textHex: '#be185d' },
  { key: 'sky', label: '水色', hex: '#bae6fd', textHex: '#0369a1' },
  { key: 'purple', label: '紫', hex: '#e9d5ff', textHex: '#7c3aed' },
];

const COURSE_COLOR_SET = new Set<CourseColorKey>(COURSE_COLOR_OPTIONS.map((opt) => opt.key));

export const normalizeCourseColor = (value: unknown): CourseColorKey | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return COURSE_COLOR_SET.has(trimmed as CourseColorKey) ? (trimmed as CourseColorKey) : undefined;
};

export type CourseColorStyle = {
  background: string;
  text: string;
  border: string;
};

const DEFAULT_STYLE: CourseColorStyle = {
  background: '#f1f5f9',
  text: '#334155',
  border: '#cbd5f5',
};

const STYLE_MAP: Record<CourseColorKey, CourseColorStyle> = COURSE_COLOR_OPTIONS.reduce((acc, opt) => {
  acc[opt.key] = {
    background: opt.hex,
    text: opt.textHex,
    border: opt.textHex,
  };
  return acc;
}, {} as Record<CourseColorKey, CourseColorStyle>);

export const getCourseColorStyle = (key?: CourseColorKey | null): CourseColorStyle =>
  (key && STYLE_MAP[key]) ? STYLE_MAP[key] : DEFAULT_STYLE;

export const COURSE_COLOR_NONE_OPTION = { key: null as const, label: 'なし', hex: DEFAULT_STYLE.background, textHex: DEFAULT_STYLE.text };

