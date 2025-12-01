// src/types/settings.ts
// 店舗設定（UIドラフト）と Firestore 保存形の“型の一本化”＋相互変換（tasks を含む）

// ========== 共通型（コース & タスク） ==========
import { normalizeCourseColor, type CourseColorKey } from '@/lib/courseColors';
import { DEFAULT_POSITION_LABEL } from '@/constants/positions';

export type CourseTask = {
  timeOffset: number; // 分（開始からの相対）
  timeOffsetEnd?: number; // 分（終了。省略時は timeOffset と同じ）
  label: string;
  bgColor: string;
};

export type CourseDef = {
  name: string;
  /** 滞在時間（分）。未指定時はアプリ側のデフォルト（例: 120分）を適用 */
  stayMinutes?: number;
  tasks: CourseTask[];
  color?: CourseColorKey;
};

export type AreaDef = {
  id: string;        // 例: 'area_1f'
  name: string;      // 例: '1F'
  tables: string[];  // 重複所属OK
  color?: string;
  icon?: string;
};

export type TableCapacityMap = Record<string, number>;

export type EatDrinkOption = {
  label: string;
  color?: CourseColorKey | null;
};

type UnknownRecord = Record<string, unknown>;

export type ScheduleConfig = {
  dayStartHour: number; // 0-47 を想定（跨ぎ運用も許容）
  dayEndHour: number;   // 0-47 を想定（跨ぎ運用も許容）
};

export type SeatOptimizerConfig = {
  basePrompt: string;
  tags: string[];
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
  courses?: unknown;
  positions?: unknown;
  tables?: unknown;
  tableCapacities?: unknown;
  floorLayoutBase?: unknown;
  floorLayoutDaily?: unknown;
  plans?: unknown;
  tasksByPosition?: unknown;
  eatOptions?: unknown;
  drinkOptions?: unknown;
  areas?: unknown;
  miniTasksByPosition?: unknown;
  wave?: unknown;
  schedule?: unknown;
  seatOptimizer?: unknown;
  updatedAt?: number | null;
};

// ========== UI 側（子コンポーネントが扱うドラフト型） ==========
export type UIPosition = { id: string; name: string };
export type UIPlan = { id: string; name: string; type: 'eat' | 'drink' | 'other'; price?: number };

export type StoreSettingsValue = {
  courses: CourseDef[];
  positions: string[];
  tables: string[];
  tableCapacities?: TableCapacityMap;
  floorLayoutBase?: Record<string, unknown>;
  floorLayoutDaily?: Record<string, Record<string, unknown>>;
  areas?: AreaDef[];
  plans: string[];
  tasksByPosition?: Record<string, Record<string, string[]>>;
  eatOptions?: EatDrinkOption[];
  drinkOptions?: EatDrinkOption[];
  miniTasksByPosition?: Record<string, MiniTaskTemplate[]>;
  wave?: WaveConfig;
  schedule?: ScheduleConfig;
  seatOptimizer?: SeatOptimizerConfig;
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
  for (const candidate of arr as unknown[]) {
    let name = '';
    let tasksInput: unknown;
    let stayInput: unknown;
    let colorInput: unknown;

    if (typeof candidate === 'string') {
      name = candidate.trim();
    } else if (candidate && typeof candidate === 'object') {
      const courseObj = candidate as UnknownRecord;
      if (typeof courseObj.name === 'string') name = courseObj.name;
      tasksInput = courseObj.tasks;
      stayInput = courseObj.stayMinutes;
      colorInput = courseObj.color;
    }

    if (!name) continue;

    const rawTasks = Array.isArray(tasksInput) ? (tasksInput as unknown[]) : [];
    const tasks: CourseTask[] = rawTasks
      .map((taskCandidate): CourseTask | null => {
        if (!taskCandidate || typeof taskCandidate !== 'object') return null;
        const taskObj = taskCandidate as UnknownRecord;
        const label = typeof taskObj.label === 'string' ? taskObj.label : '';
        if (!label) return null;
        const timeOffsetNum = Number(taskObj.timeOffset);
        const timeOffset = Number.isFinite(timeOffsetNum) ? timeOffsetNum : 0;
        const timeOffsetEndNum = Number(taskObj.timeOffsetEnd);
        const hasEnd = Number.isFinite(timeOffsetEndNum);
        const normalizedEnd = hasEnd ? Math.max(timeOffset, timeOffsetEndNum) : undefined;
        const rawColor = typeof taskObj.bgColor === 'string' ? taskObj.bgColor.trim() : '';
        const bgColor = rawColor && rawColor !== 'default' ? rawColor : 'bg-gray-100/80';
        const task: CourseTask = { timeOffset, label, bgColor };
        if (normalizedEnd !== undefined) task.timeOffsetEnd = normalizedEnd;
        return task;
      })
      .filter((task): task is CourseTask => task !== null)
      .sort((a, b) => a.timeOffset - b.timeOffset);

    const stayRaw = Number(stayInput);
    const stayMinutes = Number.isFinite(stayRaw) && stayRaw > 0 ? stayRaw : undefined;
    const color = normalizeCourseColor(colorInput);
    out.push({ name, stayMinutes, tasks, color });
  }
  return out;
};

/** positions: string[] | {name:string}[] -> string[] (trim + empty除去) */
export const toPositionNames = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [DEFAULT_POSITION_LABEL];
  const collected = (v as unknown[])
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const record = item as UnknownRecord;
        if (typeof record.name === 'string') return record.name.trim();
      }
      return '';
    })
    .filter((s) => !!s);

  const seen = new Set<string>();
  const unique: string[] = [];
  collected.forEach((name) => {
    if (seen.has(name)) return;
    seen.add(name);
    unique.push(name);
  });

  const existingIndex = unique.findIndex((name) => name === DEFAULT_POSITION_LABEL);
  if (existingIndex >= 0) {
    const [existing] = unique.splice(existingIndex, 1);
    unique.unshift(existing);
  } else {
    unique.unshift(DEFAULT_POSITION_LABEL);
  }

  return unique;
};

/** 安全な文字列配列化（trim + 空要素除去） */
const toStringList = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return (v as unknown[])
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((s) => !!s);
};

export const sanitizeStringList = (v: unknown): string[] => toStringList(v);

const firstNonEmptyString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return '';
};

export const sanitizeEatDrinkOptions = (input: unknown): EatDrinkOption[] => {
  if (!Array.isArray(input)) return [];
  const out: EatDrinkOption[] = [];
  for (const raw of input as unknown[]) {
    if (typeof raw === 'string') {
      const label = raw.trim();
      if (!label) continue;
      out.push({ label });
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as UnknownRecord;
    const label = firstNonEmptyString(record.label, record.name, record.abbr, record.value);
    if (!label) continue;
    const color = normalizeCourseColor(record.color);
    out.push(color ? { label, color } : { label });
  }
  const seen = new Set<string>();
  return out.filter(({ label }) => {
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
};

export const serializeEatDrinkOptions = (options: EatDrinkOption[] | undefined): EatDrinkOption[] => {
  if (!Array.isArray(options)) return [];
  return sanitizeEatDrinkOptions(options).map((opt) =>
    opt.color ? { label: opt.label, color: opt.color } : { label: opt.label }
  );
};

const pruneUndefined = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .map((item) => pruneUndefined(item))
      .filter((item) => item !== undefined) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === undefined) continue;
      const cleaned = pruneUndefined(val);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return result as unknown as T;
  }
  return value;
};
/** tables を安全に正規化（unknown -> string[]）
 * - 文字列/数値を toString().trim() で統一
 * - 空要素は除去
 * - 先勝ちで重複除去（順序維持）
 */
export const sanitizeTables = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of v as unknown[]) {
    const s = String(value ?? '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

export const sanitizeTableCapacities = (input: unknown, allowed?: string[]): TableCapacityMap => {
  if (!input || typeof input !== 'object') return {};
  const allow = allowed ? new Set(allowed.map((id) => String(id))) : null;
  const out: TableCapacityMap = {};
  for (const [rawKey, rawVal] of Object.entries(input as UnknownRecord)) {
    const key = String(rawKey ?? '').trim();
    if (!key) continue;
    if (allow && !allow.has(key)) continue;
    const num = Number(rawVal);
    if (!Number.isFinite(num)) continue;
    const normalized = Math.max(1, Math.round(num));
    if (normalized <= 0) continue;
    out[key] = normalized;
  }
  return out;
};

/** tasksByPosition の配列要素を文字列に限定（undefined/null を除去） */
export const sanitizeTasksByPosition = (
  obj: unknown
): Record<string, Record<string, string[]>> | undefined => {
  if (!obj || typeof obj !== 'object') return undefined;
  const out: Record<string, Record<string, string[]>> = {};
  for (const [pos, value] of Object.entries(obj as UnknownRecord)) {
    if (!value || typeof value !== 'object') continue;
    const inner: Record<string, string[]> = {};
    for (const [course, arr] of Object.entries(value as UnknownRecord)) {
      if (Array.isArray(arr)) {
        const list = (arr as unknown[])
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((s) => !!s);
        if (list.length) inner[course] = list;
      }
    }
    if (Object.keys(inner).length > 0) out[pos] = inner;
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
  for (const [pos, arr] of Object.entries(obj as UnknownRecord)) {
    if (!Array.isArray(arr)) continue;
    const list: MiniTaskTemplate[] = [];
    (arr as unknown[]).forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const task = item as UnknownRecord;
      const rawLabel = typeof task.label === 'string' ? task.label : '';
      const label = rawLabel.trim();
      if (!label) return;
      const idRaw = typeof task.id === 'string' ? task.id.trim() : '';
      const id = idRaw || `auto_${slug(label)}_${index}`;
      const active = typeof task.active === 'boolean' ? task.active : true;
      const orderNum = Number(task.order);
      const order = Number.isFinite(orderNum) ? orderNum : index;
      list.push({ id, label, active, order });
    });
    if (list.length) out[pos] = list.sort((a, b) => a.order - b.order);
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const toUniqueStringList = (value: unknown): string[] => {
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    if (typeof raw !== 'string') return;
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
  };

  if (Array.isArray(value)) {
    (value as unknown[]).forEach(push);
  } else if (typeof value === 'string') {
    value
      .split(/[,\s\n]+/)
      .forEach(push);
  }

  return Array.from(seen);
};

export const sanitizeSeatOptimizer = (obj: unknown): SeatOptimizerConfig | undefined => {
  if (!obj || typeof obj !== 'object') return undefined;
  const record = obj as UnknownRecord;
  const basePrompt = typeof record.basePrompt === 'string' ? record.basePrompt : '';
  const tags = toUniqueStringList(record.tags);
  if (!basePrompt && tags.length === 0) return undefined;
  return { basePrompt, tags };
};

/** wave を安全に正規化（unknown -> WaveConfig | undefined） */
const sanitizeWave = (obj: unknown): WaveConfig | undefined => {
  if (!obj || typeof obj !== 'object') return undefined;
  const record = obj as UnknownRecord;
  const n = (value: unknown, def: number) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : def;
  };
  const modeRaw = record.mode;
  const mode: 'fixed' | 'maxRatio' | 'percentile' | 'hybrid' =
    modeRaw === 'fixed' || modeRaw === 'maxRatio' || modeRaw === 'percentile' || modeRaw === 'hybrid' ? modeRaw : 'hybrid';
  const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const pRaw = n(record.percentile, 30);
  const rRaw = Number(record.maxRatio);
  const p = clampNum(pRaw, 10, 50);
  const r = clampNum(Number.isFinite(rRaw) ? rRaw : 0.3, 0.1, 0.5);
  return {
    threshold: n(record.threshold, 50),
    bucketMinutes: n(record.bucketMinutes, 5),
    minCalmMinutes: 15,
    notifyDelayMinutes: 3,
    mode,
    percentile: p,
    maxRatio: r,
    hysteresisPct: 0,
  };
};

/** schedule を安全に正規化（unknown -> ScheduleConfig | undefined） */
const sanitizeSchedule = (obj: unknown): ScheduleConfig | undefined => {
  if (!obj || typeof obj !== 'object') return undefined;
  const record = obj as UnknownRecord;
  const parseHour = (value: unknown) => {
    const num = Number(value);
    return Number.isFinite(num) ? Math.floor(num) : NaN;
  };
  const clamp = (v: number) => Math.min(47, Math.max(0, v)); // 0-47 を許容
  const s = clamp(parseHour(record.dayStartHour));
  const e = clamp(parseHour(record.dayEndHour));
  if (Number.isNaN(s) || Number.isNaN(e)) return undefined;
  return { dayStartHour: s, dayEndHour: e };
};

/** areas を安全に正規化（unknown -> AreaDef[]） */
export const sanitizeAreas = (arr: unknown): AreaDef[] => {
  if (!Array.isArray(arr)) return [];
  const out: AreaDef[] = [];
  for (const value of arr as unknown[]) {
    if (!value || typeof value !== 'object') continue;
    const area = value as UnknownRecord;
    const idRaw = typeof area.id === 'string' ? area.id.trim() : '';
    const nameRaw = typeof area.name === 'string' ? area.name.trim() : '';
    if (!idRaw || !nameRaw) continue;
    const tables = toStringList(area.tables);
    const color = typeof area.color === 'string' ? area.color : undefined;
    const icon = typeof area.icon === 'string' ? area.icon : undefined;
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
  const tables: string[] = sanitizeTables(fs?.tables);
  const tableCapacities = sanitizeTableCapacities(fs?.tableCapacities, tables);
  const floorLayoutBase = (fs && typeof (fs as any).floorLayoutBase === 'object')
    ? ((fs as any).floorLayoutBase as Record<string, unknown>)
    : undefined;
  const floorLayoutDaily = (fs && typeof (fs as any).floorLayoutDaily === 'object')
    ? ((fs as any).floorLayoutDaily as Record<string, Record<string, unknown>>)
    : undefined;
  const plans: string[] = toStringList(fs?.plans);
  const eatOptions: EatDrinkOption[] = sanitizeEatDrinkOptions(fs?.eatOptions);
  const drinkOptions: EatDrinkOption[] = sanitizeEatDrinkOptions(fs?.drinkOptions);

  // tasksByPosition はオブジェクトならそのまま、無ければ {}
  const tasksByPosition: Record<string, Record<string, string[]>> =
    fs && typeof fs.tasksByPosition === 'object' && fs.tasksByPosition !== null
      ? (fs.tasksByPosition as Record<string, Record<string, string[]>>)
      : {};

  const areas: AreaDef[] = sanitizeAreas(fs?.areas);

  // miniTasks & wave
  const miniTasksByPosition: Record<string, MiniTaskTemplate[]> =
    sanitizeMiniTasksByPosition(fs?.miniTasksByPosition) ?? {};
  const waveCfg = sanitizeWave(fs?.wave);
  const schedule = sanitizeSchedule(fs?.schedule);
  const seatOptimizer = sanitizeSeatOptimizer(fs?.seatOptimizer);

  return {
    courses,
    positions,
    tables,
    tableCapacities,
    plans,
    tasksByPosition,
    eatOptions,
    drinkOptions,
    floorLayoutBase,
    floorLayoutDaily,
    areas,
    miniTasksByPosition,
    wave: waveCfg,
    schedule,
    seatOptimizer,
  };
};

/**
 * UI → Firestore
 * - courses は sanitizeCourses で正規化してから保存
 * - “空で上書きしない”原則：空配列なら undefined を入れて送らない
 */
export const toFirestorePayload = (ui: StoreSettingsValue): StoreSettings => {
  const courses = sanitizeCourses(ui.courses);

  const positions = toPositionNames(ui.positions);
  const tables = sanitizeTables(ui.tables);
  const tableCapacities = sanitizeTableCapacities(ui.tableCapacities, tables);
  const floorLayoutBase = ui.floorLayoutBase;
  const floorLayoutDaily = ui.floorLayoutDaily;
  const plans = toStringList(ui.plans);
  const eatOptions = serializeEatDrinkOptions(ui.eatOptions);
  const drinkOptions = serializeEatDrinkOptions(ui.drinkOptions);

  const tasksByPosition = sanitizeTasksByPosition(ui.tasksByPosition);
  const areas = sanitizeAreas(ui.areas);

  const miniTasksByPosition = sanitizeMiniTasksByPosition(ui.miniTasksByPosition);
  const wave = sanitizeWave(ui.wave);
  const schedule = sanitizeSchedule(ui.schedule);
  const seatOptimizer = sanitizeSeatOptimizer(ui.seatOptimizer);

  const payload: StoreSettings = {
    courses,
    positions,
    tables,
    tableCapacities: Object.keys(tableCapacities).length > 0 ? tableCapacities : undefined,
    floorLayoutBase: floorLayoutBase && typeof floorLayoutBase === 'object' ? floorLayoutBase : undefined,
    floorLayoutDaily: floorLayoutDaily && typeof floorLayoutDaily === 'object' ? floorLayoutDaily : undefined,
    plans,
    eatOptions,
    drinkOptions,
    areas,
    updatedAt: Date.now(),
  };

  if (tasksByPosition) payload.tasksByPosition = tasksByPosition;
  if (miniTasksByPosition) payload.miniTasksByPosition = miniTasksByPosition;
  if (wave) payload.wave = wave;
  if (schedule) payload.schedule = schedule;
  if (seatOptimizer) payload.seatOptimizer = seatOptimizer;

  return pruneUndefined(payload);
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
