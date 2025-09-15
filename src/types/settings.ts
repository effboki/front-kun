// src/types/settings.ts
// 店舗設定（UIドラフト）と Firestore 保存形の“型の一本化”＋相互変換（tasks を含む）

// ========== 共通型（コース & タスク） ==========
export type CourseTask = {
  timeOffset: number; // 分（開始からの相対）
  label: string;
  bgColor: string;
};

export type CourseDef = {
  name: string;
  tasks: CourseTask[];
};

export type AreaDef = {
  id: string;        // 例: 'area_1f'
  name: string;      // 例: '1F'
  tables: string[];  // 重複所属OK
  color?: string;
  icon?: string;
};

// ========== MiniTasks / Wave (新規) ==========
export type WaveConfig = {
  threshold: number;          // 忙しさの閾値
  bucketMinutes: number;      // 5分刻み（まずは5固定想定でもOK）
  minCalmMinutes: number;     // Calm と見なす連続分
  notifyDelayMinutes: number; // Calm開始 + X分で通知
  mode?: 'fixed' | 'maxRatio' | 'percentile' | 'hybrid'; // しきい値の出し方
  percentile?: number;    // パーセンタイル（例: 30）
  maxRatio?: number;      // ピーク比（例: 0.3 = 30%）
  hysteresisPct?: number; // 二段しきい値の抜け側（例: 10 = +10%）
};

export type MiniTaskTemplate = {
  id: string;
  label: string;
  active: boolean;
  order: number;
};

// ========== Firestore 側（親が保存・読込で扱う型） ==========
export type StoreSettings = {
  courses?: any[];
  positions?: (string | { name: string })[];
  tables?: string[];
  plans?: string[];
  tasksByPosition?: Record<string, Record<string, string[]>>;
  eatOptions?: string[];
  drinkOptions?: string[];
  areas?: AreaDef[];
  miniTasksByPosition?: Record<string, MiniTaskTemplate[]>;
  wave?: WaveConfig;
  updatedAt?: number;
};

// ========== UI 側（子コンポーネントが扱うドラフト型） ==========
export type UIPosition = { id: string; name: string };
export type UIPlan = { id: string; name: string; type: 'eat' | 'drink' | 'other'; price?: number };

export type StoreSettingsValue = {
  courses: CourseDef[];
  positions: string[];
  tables: string[];
  areas?: AreaDef[];
  plans: string[];
  tasksByPosition?: Record<string, Record<string, string[]>>;
  eatOptions?: string[];
  drinkOptions?: string[];
  miniTasksByPosition?: Record<string, MiniTaskTemplate[]>;
  wave?: WaveConfig;
};

// ========== 変換ユーティリティ ==========

/**
 * courses を安全に正規化（unknown -> CourseDef[]）
 * - name: string が無ければ除外
 * - tasks: 配列でなければ空配列
 * - task: {timeOffset:number, label:string, bgColor:string} に整形し、timeOffset 昇順にソート
 */
export const sanitizeCourses = (arr: unknown): CourseDef[] => {
  if (!Array.isArray(arr)) return [];
  const out: CourseDef[] = [];
  for (const c of arr as any[]) {
    const name = typeof c?.name === 'string' ? c.name : (typeof c === 'string' ? c : '');
    if (!name) continue;
    const rawTasks = Array.isArray(c?.tasks) ? c.tasks : [];
    const tasks: CourseTask[] = (rawTasks as any[])
      .map((t) => {
        const label = typeof t?.label === 'string' ? t.label : '';
        if (!label) return null;
        const timeOffsetNum = Number(t?.timeOffset);
        const timeOffset = Number.isFinite(timeOffsetNum) ? timeOffsetNum : 0;
        const bgColor = typeof t?.bgColor === 'string' ? t.bgColor : 'bg-gray-100/80';
        return { timeOffset, label, bgColor };
      })
      .filter((v): v is CourseTask => !!v)
      .sort((a, b) => a.timeOffset - b.timeOffset);
    out.push({ name, tasks });
  }
  return out;
};

/** positions: string[] | {name:string}[] -> string[] (trim + empty除去) */
export const toPositionNames = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return (v as any[])
    .map((p) => {
      if (typeof p === 'string') return p.trim();
      const name = p && typeof p.name === 'string' ? p.name : '';
      return name.trim();
    })
    .filter((s) => !!s);
};

/** 安全な文字列配列化（trim + 空要素除去） */
const toStringList = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return (v as any[])
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => !!s);
};

/** tasksByPosition の配列要素を文字列に限定（undefined/null を除去） */
const sanitizeTasksByPosition = (
  obj: unknown
): Record<string, Record<string, string[]>> | undefined => {
  if (!obj || typeof obj !== 'object') return undefined;
  const out: Record<string, Record<string, string[]>> = {};
  for (const [pos, m] of Object.entries(obj as Record<string, unknown>)) {
    if (!m || typeof m !== 'object') continue;
    const inner: Record<string, string[]> = {};
    for (const [course, arr] of Object.entries(m as Record<string, unknown>)) {
      if (Array.isArray(arr)) {
        const list = (arr as any[])
          .map((s) => (typeof s === 'string' ? s.trim() : ''))
          .filter((s) => !!s);
        inner[course] = list;
      }
    }
    out[pos] = inner;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

/** miniTasksByPosition を安全に正規化（unknown -> Record<pos, MiniTaskTemplate[]>） */
const sanitizeMiniTasksByPosition = (
  obj: unknown
): Record<string, MiniTaskTemplate[]> | undefined => {
  if (!obj || typeof obj !== 'object') return undefined;

  const slug = (s: string) =>
    s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');

  const out: Record<string, MiniTaskTemplate[]> = {};
  for (const [pos, arr] of Object.entries(obj as Record<string, unknown>)) {
    if (!Array.isArray(arr)) continue;
    const list: MiniTaskTemplate[] = [];
    (arr as any[]).forEach((t, i) => {
      const label = typeof t?.label === 'string' ? t.label.trim() : '';
      if (!label) return;
      const idRaw = typeof t?.id === 'string' ? t.id.trim() : '';
      const id = idRaw || `auto_${slug(label)}_${i}`;
      const active = typeof t?.active === 'boolean' ? t.active : true;
      const orderNum = Number((t as any)?.order);
      const order = Number.isFinite(orderNum) ? orderNum : i;
      list.push({ id, label, active, order });
    });
    if (list.length) out[pos] = list.sort((a, b) => a.order - b.order);
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

/** wave を安全に正規化（unknown -> WaveConfig | undefined） */
const sanitizeWave = (obj: unknown): WaveConfig | undefined => {
  if (!obj || typeof obj !== 'object') return undefined;
  const n = (v: any, def: number) => {
    const num = Number(v);
    return Number.isFinite(num) ? num : def;
  };
  const modeRaw = (obj as any).mode;
  const mode: 'fixed' | 'maxRatio' | 'percentile' | 'hybrid' =
    modeRaw === 'fixed' || modeRaw === 'maxRatio' || modeRaw === 'percentile' || modeRaw === 'hybrid' ? modeRaw : 'hybrid';
  const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const pRaw = n((obj as any).percentile, 30);
  const rRaw = Number((obj as any).maxRatio);
  const p = clampNum(pRaw, 10, 50);
  const r = clampNum(Number.isFinite(rRaw) ? rRaw : 0.3, 0.1, 0.5);
  return {
    threshold: n((obj as any).threshold, 50),
    bucketMinutes: n((obj as any).bucketMinutes, 5),
    minCalmMinutes: 15,
    notifyDelayMinutes: 3,
    mode,
    percentile: p,
    maxRatio: r,
    hysteresisPct: 0,
  };
};

/** areas を安全に正規化（unknown -> AreaDef[]） */
export const sanitizeAreas = (arr: unknown): AreaDef[] => {
  if (!Array.isArray(arr)) return [];
  const out: AreaDef[] = [];
  for (const a of arr as any[]) {
    const idRaw = typeof a?.id === 'string' ? a.id.trim() : '';
    const nameRaw = typeof a?.name === 'string' ? a.name.trim() : '';
    if (!idRaw || !nameRaw) continue;
    const tables = toStringList(a?.tables);
    const color = typeof a?.color === 'string' ? a.color : undefined;
    const icon = typeof a?.icon === 'string' ? a.icon : undefined;
    out.push({ id: idRaw, name: nameRaw, tables, color, icon });
  }
  return out;
};

/** Firestore → UI（不足フィールドは安全な既定値に、courses は正規化） */
export const toUISettings = (fs: StoreSettings): StoreSettingsValue => {
  // コース: 不完全でも sanitizeCourses で正規化
  const courses: CourseDef[] = sanitizeCourses(fs?.courses);

  // positions: string[] / {name}[] → string[]（trim）＋ 重複除去
  const positions = Array.from(new Set(toPositionNames(fs?.positions)));

  // tables/plans/eatOptions/drinkOptions は文字列配列化
  const tables: string[] = toStringList(fs?.tables);
  const plans: string[] = toStringList(fs?.plans);
  const eatOptions: string[] = toStringList(fs?.eatOptions);
  const drinkOptions: string[] = toStringList(fs?.drinkOptions);

  // tasksByPosition はオブジェクトならそのまま、無ければ {}
  const tasksByPosition: Record<string, Record<string, string[]>> =
    fs && typeof fs.tasksByPosition === 'object' && fs.tasksByPosition !== null
      ? (fs.tasksByPosition as Record<string, Record<string, string[]>>)
      : {};

  const areas: AreaDef[] = sanitizeAreas(fs?.areas);

  // miniTasks & wave
  const miniTasksByPosition: Record<string, MiniTaskTemplate[]> =
    sanitizeMiniTasksByPosition((fs as any)?.miniTasksByPosition) ?? {};
  const waveCfg = sanitizeWave((fs as any)?.wave);

  return { courses, positions, tables, plans, tasksByPosition, eatOptions, drinkOptions, areas, miniTasksByPosition, wave: waveCfg };
};

/**
 * UI → Firestore
 * - courses は sanitizeCourses で正規化してから保存
 * - “空で上書きしない”原則：空配列なら undefined を入れて送らない
 */
export const toFirestorePayload = (ui: StoreSettingsValue): StoreSettings => {
  const courses = sanitizeCourses(ui.courses);

  const positions = toPositionNames(ui.positions);
  const tables = toStringList(ui.tables);
  const plans = toStringList(ui.plans);
  const eatOptions = toStringList(ui.eatOptions);
  const drinkOptions = toStringList(ui.drinkOptions);

  const tasksByPosition = sanitizeTasksByPosition(ui.tasksByPosition);
  const areas = sanitizeAreas(ui.areas as unknown);

  const miniTasksByPosition = sanitizeMiniTasksByPosition((ui as any)?.miniTasksByPosition);
  const wave = sanitizeWave((ui as any)?.wave);

  const payload: StoreSettings = {
    courses: courses.length > 0 ? courses : undefined,
    positions: positions.length > 0 ? positions : undefined,
    tables: tables.length > 0 ? tables : undefined,
    plans: plans.length > 0 ? plans : undefined,
    eatOptions: eatOptions.length > 0 ? eatOptions : undefined,
    drinkOptions: drinkOptions.length > 0 ? drinkOptions : undefined,
    tasksByPosition: tasksByPosition,
    areas: areas.length > 0 ? areas : undefined,
    miniTasksByPosition,
    wave,
    updatedAt: Date.now(),
  };

  return payload;
};

// ========== 既定値 & UI既定適用 ==========
export const DEFAULT_WAVE: WaveConfig = {
  threshold: 50,
  bucketMinutes: 5,
  minCalmMinutes: 15,
  notifyDelayMinutes: 3,
  mode: 'hybrid',
  percentile: 30,
  maxRatio: 0.3,
  hysteresisPct: 0,
};

export const ensureStoreSettingsDefaults = (v: StoreSettingsValue): StoreSettingsValue => ({
  ...v,
  miniTasksByPosition: v.miniTasksByPosition ?? {},
  wave: v.wave ?? DEFAULT_WAVE,
});