'use client';

import { useMemo, useState, useCallback, useRef, useEffect, memo } from 'react';
import type { ReactNode, FC, MutableRefObject } from 'react';
import type { CourseDef, TaskDef } from '@/types';
import type { AreaDef } from '@/types';
import { sanitizeTableCapacities, sanitizeEatDrinkOptions } from '@/types/settings';
import type { EatDrinkOption, StoreSettingsValue } from '@/types/settings';
import {
  COURSE_COLOR_NONE_OPTION,
  COURSE_COLOR_OPTIONS,
  getCourseColorStyle,
  normalizeCourseColor,
  type CourseColorKey,
  type CourseColorNoneOption,
  type CourseColorOption,
} from '@/lib/courseColors';
import MiniTasksSettings from './MiniTasksSettings';
import WaveSettings from './WaveSettings';
import ScheduleSettings from './ScheduleSettings';
import SeatOptimizerSettings from './SeatOptimizerSettings';
import { DEFAULT_POSITION_LABEL } from '@/constants/positions';
import FloorLayoutSettings, { type FloorLayoutMap } from './FloorLayoutSettings';

// --- UI labels for *Store Settings* only (do NOT change from other screens) ---
const STORE_LABEL_POSITIONS = 'ポジション設定';
const STORE_LABEL_TABLES = '卓設定およびエリア設定';
//
// These labels are intentionally fixed here so that renames for "営業前設定" do not affect this screen.
//

// ============== helpers ==============
const normalizeLabel = (s: string) =>
  String(s ?? '')
    .replace(/\u3000/g, ' ')
    .trim()
    .normalize('NFKC')
    .toLowerCase();
const normEq = (a: string, b: string) => normalizeLabel(a) === normalizeLabel(b);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const TASK_OFFSET_MIN = -180;
const TASK_OFFSET_MAX = 180;
const clampTaskOffset = (offset: number) => clamp(Math.round(offset), TASK_OFFSET_MIN, TASK_OFFSET_MAX);
const formatTaskOffset = (offset: number) => {
  if (offset > 0) return `${offset}分後`;
  if (offset < 0) return `${Math.abs(offset)}分前`;
  return '0分後';
};
const COURSE_COLOR_MENU_OPTIONS: (CourseColorNoneOption | CourseColorOption)[] = [
  COURSE_COLOR_NONE_OPTION,
  ...COURSE_COLOR_OPTIONS,
];
const clampTaskRange = (start: number, end?: number) => {
  const clampedStart = clampTaskOffset(start);
  if (typeof end === 'number' && Number.isFinite(end)) {
    const clampedEnd = clampTaskOffset(end);
    return { start: clampedStart, end: Math.max(clampedStart, clampedEnd) };
  }
  return { start: clampedStart, end: clampedStart };
};
const formatTaskRange = (start: number, end?: number) => {
  const normalizedEnd = typeof end === 'number' ? end : start;
  if (normalizedEnd === start) return formatTaskOffset(start);
  return `${formatTaskOffset(start)} - ${formatTaskOffset(normalizedEnd)}`;
};
const getTasks = (c?: CourseDef) => (Array.isArray(c?.tasks) ? c.tasks : []);
const normalizeTiny = (s: string) =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/[\s\u3000]/g, '');

type TaskColorOption = {
  value: string;
  label: string;
};

const TASK_COLOR_OPTIONS: TaskColorOption[] = [
  { value: 'bg-red-300/80', label: '赤' },
  { value: 'bg-orange-300/80', label: 'オレンジ' },
  { value: 'bg-yellow-200/80', label: '黄色' },
  { value: 'bg-lime-200/80', label: '黄緑' },
  { value: 'bg-green-300/80', label: '緑' },
  { value: 'bg-sky-200/80', label: '水色' },
  { value: 'bg-blue-300/80', label: '青' },
  { value: 'bg-violet-300/80', label: '紫' },
  { value: 'bg-pink-300/80', label: 'ピンク' },
  { value: 'bg-rose-200/80', label: '薄ピンク' },
  { value: 'bg-amber-300/80', label: '黄土色' },
  { value: 'bg-stone-500/80', label: '茶色' },
  { value: 'bg-gray-100/80', label: 'ライトグレー' },
  { value: 'bg-slate-200/80', label: 'ブルーグレー' },
];

type TaskColorValue = (typeof TASK_COLOR_OPTIONS)[number]['value'];

const TASK_COLOR_VALUE_SET = new Set<string>(TASK_COLOR_OPTIONS.map((opt) => opt.value));
const DEFAULT_TASK_COLOR: TaskColorValue = 'bg-gray-100/80';

const normalizeTaskColor = (color: string | null | undefined): TaskColorValue =>
  TASK_COLOR_VALUE_SET.has(color ?? '') ? ((color ?? DEFAULT_TASK_COLOR) as TaskColorValue) : DEFAULT_TASK_COLOR;

const sortKeysDeep = (input: unknown): unknown => {
  if (Array.isArray(input)) return input.map(sortKeysDeep);
  if (input && typeof input === 'object') {
    return Object.keys(input as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((input as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return input;
};

const stableStringify = (value: unknown) => JSON.stringify(sortKeysDeep(value));

const useOutsideClick = (
  targetRef: MutableRefObject<HTMLElement | null>,
  active: boolean,
  handleOutside: () => void,
) => {
  useEffect(() => {
    if (!active) return;
    const onDocClick = (event: MouseEvent) => {
      if (!targetRef.current || targetRef.current.contains(event.target as Node)) return;
      handleOutside();
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [active, handleOutside, targetRef]);
};

// Grapheme-aware slicer: correctly counts emoji + variation selectors as 1 char
const takeGraphemes = (input: string, n: number): string => {
  const s = String(input ?? '');
  // Prefer Intl.Segmenter when available (modern browsers)
  const Seg: any = (Intl as any)?.Segmenter;
  if (Seg) {
    const seg = new Seg('ja', { granularity: 'grapheme' });
    const out: string[] = [];
    for (const { segment } of seg.segment(s)) {
      out.push(segment);
      if (out.length >= n) break;
    }
    return out.join('');
  }
  // Fallback: split by code points, then glue variation selectors/ZWJ to previous
  const cps = Array.from(s);
  const clusters: string[] = [];
  for (const cp of cps) {
    if (/[\uFE0E\uFE0F\u200D]/.test(cp) && clusters.length) {
      clusters[clusters.length - 1] += cp;
    } else {
      clusters.push(cp);
    }
  }
  return clusters.slice(0, n).join('');
};

// ============== props ==============
export type StoreSettingsContentProps = {
  value: StoreSettingsValue; // 親のドラフト
  onChange: (patch: Partial<StoreSettingsValue>) => void; // 親ドラフトにパッチ
  onSave: () => void | Promise<void>; // 保存（同期/非同期どちらでもOK）
  isSaving?: boolean; // 親が渡す保存中フラグ（任意）
  baseline?: StoreSettingsValue | null; // 直近保存済みスナップショット（dirty 判定用）
};

// ============== component ==============
export default function StoreSettingsContent({ value, onChange, onSave, isSaving, baseline }: StoreSettingsContentProps) {
  // navigation (drill-in style)
  type View =
    | 'root'
    | 'courses'
    | 'positions'
    | 'tables'
    | 'tablesTables'
    | 'tablesAreas'
    | 'floorLayout'
    | 'eatdrink'
    | 'minitasks'
    | 'wavesettings'
    | 'seatOptimizer'
    | 'schedule';
  const [view, setView] = useState<View>('root');

  // derived arrays
  const courses = useMemo(() => (Array.isArray(value.courses) ? value.courses : []), [value.courses]);
  const positions = useMemo(() => (Array.isArray(value.positions) ? value.positions : []), [value.positions]);
  const presetTables = useMemo(() => (Array.isArray(value.tables) ? value.tables : []), [value.tables]);
  const tableCapacities = useMemo(
    () => sanitizeTableCapacities(value.tableCapacities, presetTables),
    [value.tableCapacities, presetTables]
  );
  const eatOptions = useMemo<EatDrinkOption[]>(() => sanitizeEatDrinkOptions(value.eatOptions), [value.eatOptions]);

  const drinkOptions = useMemo<EatDrinkOption[]>(() => sanitizeEatDrinkOptions(value.drinkOptions), [value.drinkOptions]);
  const tasksByPosition = useMemo(
    () =>
      value.tasksByPosition && typeof value.tasksByPosition === 'object'
        ? value.tasksByPosition
        : ({} as Record<string, Record<string, string[]>>),
    [value.tasksByPosition]
  );
  const areas = useMemo<AreaDef[]>(() => (Array.isArray(value.areas) ? value.areas : []), [value.areas]);

  // local UI state only
  const [selectedCourse, setSelectedCourse] = useState<string>(courses[0]?.name ?? '');
  // courses: settings popover (per course) + accordion open state
  const [courseMenuFor, setCourseMenuFor] = useState<string | null>(null);
  const courseMenuRef = useRef<HTMLDivElement | null>(null);
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  // positions: settings popover (only one open at a time)
  const [posMenuFor, setPosMenuFor] = useState<string | null>(null);
  const posMenuRef = useRef<HTMLDivElement | null>(null);
  const closePosMenu = useCallback(() => setPosMenuFor(null), []);
  useOutsideClick(posMenuRef, Boolean(posMenuFor), closePosMenu);
  // areas: settings popover (only one open at a time)
  const [areaMenuFor, setAreaMenuFor] = useState<string | null>(null);
  const areaMenuRef = useRef<HTMLDivElement | null>(null);
  const closeAreaMenu = useCallback(() => setAreaMenuFor(null), []);
  useOutsideClick(areaMenuRef, Boolean(areaMenuFor), closeAreaMenu);
  const closeCourseMenu = useCallback(() => setCourseMenuFor(null), []);
  useOutsideClick(courseMenuRef, Boolean(courseMenuFor), closeCourseMenu);
  // Helper to toggle course accordion (open/close) and sync selectedCourse
  const toggleCourseOpen = useCallback((name: string) => {
    setOpenCourse((prev) => {
      const next = prev === name ? null : name;
      if (next) setSelectedCourse(name);
      return next;
    });
  }, []);
  const [editingLabelTask, setEditingLabelTask] = useState<{ offset: number; label: string } | null>(null);
  const [editingTimeTask, setEditingTimeTask] = useState<{ offset: number; end: number; label: string } | null>(null);
  const [editingTaskDraft, setEditingTaskDraft] = useState('');
  const editingInputRef = useRef<HTMLInputElement | null>(null);
  const editingLabelComposingRef = useRef(false);
  const [isTablet, setIsTablet] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 768 : false));
  const [positionReminderTs, setPositionReminderTs] = useState<number | null>(null);
  const remindPositionSettings = useCallback(() => setPositionReminderTs(Date.now()), []);
  useEffect(() => {
    if (!positionReminderTs) return;
    const timer = window.setTimeout(() => setPositionReminderTs(null), 2000);
    return () => window.clearTimeout(timer);
  }, [positionReminderTs]);

  // track unsaved changes (for Save button "活きてる感")
  const [localDirty, setLocalDirty] = useState(false);
  const prevSavingRef = useRef<boolean>(false);
  useEffect(() => {
    // when saving completed, consider it saved -> clear dirty
    if (prevSavingRef.current && !isSaving) {
      setLocalDirty(false);
    }
    prevSavingRef.current = !!isSaving;
  }, [isSaving]);

  // ---- dirty 判定（baseline 優先、無い場合はローカル追跡）----
  const baselineDirty = useMemo(() => {
    if (!baseline) return null;
    try {
      return stableStringify(value) !== stableStringify(baseline);
    } catch {
      return true;
    }
  }, [value, baseline]);
  const isDirty = baselineDirty ?? localDirty;
  const attemptSave = useCallback(() => {
    if (!isDirty || isSaving) return;
    remindPositionSettings();
    return onSave?.();
  }, [isDirty, isSaving, onSave, remindPositionSettings]);
  const positionReminderToast = positionReminderTs ? (
    <div
      key={positionReminderTs}
      className="pointer-events-none fixed bottom-24 left-1/2 z-[70] w-[min(320px,90vw)] -translate-x-1/2 rounded-lg bg-amber-500/95 px-4 py-3 text-sm text-white shadow-xl transition-opacity duration-300"
      role="status"
      aria-live="polite"
    >
      <p className="text-center leading-relaxed">
        保存しました。必要に応じて<strong className="mx-1">ポジション設定</strong>で表示タスクもご確認ください。
      </p>
    </div>
  ) : null;
  
  // Cmd/Ctrl+S で保存（未保存かつ保存中でない場合）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        const result = attemptSave();
        if (result && typeof (result as Promise<any>).then === 'function') {
          Promise.resolve(result).catch(() => {});
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [attemptSave]);
  
  // 未保存の変更がある場合は離脱ガード
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    const handleResize = () => setIsTablet(window.innerWidth >= 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ===== patch helpers =====
  const setCourses = useCallback((next: CourseDef[]) => {
    setLocalDirty(true);
    onChange({ courses: next });
  }, [onChange]);
  const setPositions = useCallback((next: string[]) => {
    setLocalDirty(true);
    onChange({ positions: next });
  }, [onChange]);
  const applyTableCapacities = useCallback((next: Record<string, number>) => {
    const cleaned = sanitizeTableCapacities(next, presetTables);
    const sameSize = Object.keys(cleaned).length === Object.keys(tableCapacities).length;
    const sameEntries = sameSize && Object.entries(cleaned).every(([key, val]) => tableCapacities[key] === val);
    if (sameEntries) return;
    setLocalDirty(true);
    onChange({
      tableCapacities: Object.keys(cleaned).length > 0 ? cleaned : undefined,
    } as Partial<StoreSettingsValue>);
  }, [onChange, presetTables, tableCapacities]);

  const setTables = useCallback((next: string[]) => {
    // 数字キー前提のため、常に数値昇順に並び替え & 重複除去
    const sorted = Array.from(new Set(next.map((n) => String(Number(n)))))
      .sort((a, b) => Number(a) - Number(b));

    const sameLength = sorted.length === presetTables.length;
    const sameOrder = sameLength && sorted.every((tbl, idx) => tbl === presetTables[idx]);

    const filteredCaps: Record<string, number> = {};
    for (const tbl of sorted) {
      const cap = tableCapacities[tbl];
      if (typeof cap === 'number' && Number.isFinite(cap) && cap > 0) {
        filteredCaps[tbl] = Math.round(cap);
      }
    }

    const existingCapsKeys = Object.keys(tableCapacities);
    const sameCaps =
      existingCapsKeys.length === Object.keys(filteredCaps).length &&
      existingCapsKeys.every((key) => tableCapacities[key] === filteredCaps[key]);

    if (sameOrder && sameCaps) return;

    setLocalDirty(true);
    const patch: Partial<StoreSettingsValue> = {
      tables: sorted,
      tableCapacities: Object.keys(filteredCaps).length > 0 ? filteredCaps : undefined,
    };
    onChange(patch);
  }, [onChange, presetTables, tableCapacities]);
  const setTasksByPosition = useCallback(
    (next: Record<string, Record<string, string[]>>) => {
      setLocalDirty(true);
      onChange({ tasksByPosition: next });
    },
    [onChange]
  );

  const handleTableCapacityChange = useCallback(
    (tableId: string, rawValue: string) => {
      const digits = rawValue.replace(/[^0-9]/g, '');
      const current = tableCapacities[tableId];

      if (!digits) {
        if (current != null) {
          const next = { ...tableCapacities };
          delete next[tableId];
          applyTableCapacities(next);
        }
        return;
      }

      const numeric = Number(digits);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        if (current != null) {
          const next = { ...tableCapacities };
          delete next[tableId];
          applyTableCapacities(next);
        }
        return;
      }

      const normalized = Math.max(1, Math.round(numeric));
      if (current === normalized) return;

      const next = { ...tableCapacities, [tableId]: normalized };
      applyTableCapacities(next);
    },
    [tableCapacities, applyTableCapacities]
  );
  const setEatOptions = useCallback((next: EatDrinkOption[]) => {
    setLocalDirty(true);
    onChange({ eatOptions: next });
  }, [onChange]);
  const setDrinkOptions = useCallback((next: EatDrinkOption[]) => {
    setLocalDirty(true);
    onChange({ drinkOptions: next });
  }, [onChange]);
  const setAreas = useCallback((next: AreaDef[]) => {
    setLocalDirty(true);
    onChange({ areas: next });
  }, [onChange]);

  // 子ページ（ミニタスク設定／波設定）からの変更も dirty を立てて親にパッチ
  const patchRoot = useCallback((p: Partial<StoreSettingsValue>) => {
    setLocalDirty(true);
    onChange(p);
  }, [onChange]);

  // 「食べ放題 / 飲み放題」使い方ヒントの開閉
  const [showEatDrinkHelp, setShowEatDrinkHelp] = useState(false);
  // コース設定表の説明パネルの開閉
  const [showCoursesInfo, setShowCoursesInfo] = useState(false);
  // ルートの各項目にある情報パネル（iボタン）
  const [showPositionsInfo, setShowPositionsInfo] = useState(false);
  const [showTablesInfo, setShowTablesInfo] = useState(false);
  const [showEatDrinkInfo, setShowEatDrinkInfo] = useState(false);
  const [showMiniTasksInfo, setShowMiniTasksInfo] = useState(false);
  const [showWaveInfo, setShowWaveInfo] = useState(false);
  const [showScheduleInfo, setShowScheduleInfo] = useState(false);

  // 入力値の追加（ボタン／Enter 共通）
  const addEatOption = useCallback((raw: string, color: CourseColorKey | null): boolean => {
    const v = takeGraphemes(normalizeTiny(raw), 2);
    if (!v) return false;
    if (eatOptions.some((opt) => normEq(opt.label, v))) return false;
    const normalizedColor = color ? normalizeCourseColor(color) : undefined;
    const nextOpt: EatDrinkOption = normalizedColor ? { label: v, color: normalizedColor } : { label: v };
    setEatOptions([...eatOptions, nextOpt]);
    return true;
  }, [eatOptions, setEatOptions]);

  const addDrinkOption = useCallback((raw: string, color: CourseColorKey | null): boolean => {
    const v = takeGraphemes(normalizeTiny(raw), 2);
    if (!v) return false;
    if (drinkOptions.some((opt) => normEq(opt.label, v))) return false;
    const normalizedColor = color ? normalizeCourseColor(color) : undefined;
    const nextOpt: EatDrinkOption = normalizedColor ? { label: v, color: normalizedColor } : { label: v };
    setDrinkOptions([...drinkOptions, nextOpt]);
    return true;
  }, [drinkOptions, setDrinkOptions]);

  const updateEatOptionColor = useCallback((label: string, colorKey: CourseColorKey | null) => {
    const idx = eatOptions.findIndex((opt) => normEq(opt.label, label));
    if (idx < 0) return;
    const normalized = colorKey ? normalizeCourseColor(colorKey) : undefined;
    const current = eatOptions[idx];
    if ((current.color ?? undefined) === (normalized ?? undefined)) return;
    const next = [...eatOptions];
    next[idx] = normalized ? { label: current.label, color: normalized } : { label: current.label };
    setEatOptions(next);
  }, [eatOptions, setEatOptions]);

  const updateDrinkOptionColor = useCallback((label: string, colorKey: CourseColorKey | null) => {
    const idx = drinkOptions.findIndex((opt) => normEq(opt.label, label));
    if (idx < 0) return;
    const normalized = colorKey ? normalizeCourseColor(colorKey) : undefined;
    const current = drinkOptions[idx];
    if ((current.color ?? undefined) === (normalized ?? undefined)) return;
    const next = [...drinkOptions];
    next[idx] = normalized ? { label: current.label, color: normalized } : { label: current.label };
    setDrinkOptions(next);
  }, [drinkOptions, setDrinkOptions]);

  // ===== courses & tasks =====

  const [openPositions, setOpenPositions] = useState<Record<string, boolean>>({});
  const [openAreas, setOpenAreas] = useState<Record<string, boolean>>({});
  const [courseByPosition, setCourseByPosition] = useState<Record<string, string>>(() => {
    const first = courses[0]?.name ?? '';
    const init: Record<string, string> = {};
    for (const p of positions) init[p] = first;
    return init;
  });

  const [numPadState, setNumPadState] = useState<{ id: string; field: 'presetTable' | 'table' | 'guests'; value: string } | null>(null);
  const [newTableTemp, setNewTableTemp] = useState('');
  const [tableEditMode, setTableEditMode] = useState(false);

  // keep selectedCourse valid
  useEffect(() => {
    if (!courses.some((c) => c.name === selectedCourse)) setSelectedCourse(courses[0]?.name ?? '');
  }, [courses, selectedCourse]);

  // memo: currently selected course & its sorted tasks for rendering
  const selectedCourseDef = useMemo(() => {
    return courses.find((c) => c.name === selectedCourse) ?? null;
  }, [courses, selectedCourse]);

  // 親反映の遅れで「消えた」ように見えないための一時表示
  const [optimisticTasks, setOptimisticTasks] = useState<Record<string, TaskDef[]>>({});

  const courseTasksForList = useMemo(() => {
    const base = getTasks(selectedCourseDef || undefined);
    const pending = optimisticTasks[selectedCourse] ?? [];
    const merged = [...base, ...pending];
    // timeOffset + 正規化ラベルで重複排除
    const seen = new Set<string>();
    const deduped = merged.filter((t) => {
      const endKey = typeof t.timeOffsetEnd === 'number' ? t.timeOffsetEnd : t.timeOffset;
      const k = `${t.timeOffset}_${endKey}__${normalizeLabel(t.label)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return deduped
      .slice()
      .sort((a, b) => a.timeOffset - b.timeOffset)
      .map((task) => {
        const { start, end } = clampTaskRange(task.timeOffset, task.timeOffsetEnd);
        return {
          ...task,
          timeOffset: start,
          timeOffsetEnd: end,
          bgColor: normalizeTaskColor(task.bgColor),
        };
      });
  }, [selectedCourseDef, optimisticTasks, selectedCourse]);
  // 親から courses が更新されたら、pending をクリア（実データに置き換わったため）
  useEffect(() => {
    if (Object.keys(optimisticTasks).length) {
      setOptimisticTasks({});
    }
  }, [courses]);

  // ===== courses & tasks =====
  const addTaskToCourse = useCallback(
    (label: string, offsetStart: number, offsetEnd: number, color: string): boolean => {
      const normalizedColor = normalizeTaskColor(color);
      const base = courses.map((c) => ({ ...c, tasks: getTasks(c).map((t) => ({ ...t })) }));
      const idx = base.findIndex((c) => c.name === selectedCourse);
      if (idx < 0) {
        console.warn('[addTaskToCourse] selectedCourse not found:', selectedCourse);
        return false;
      }
      const { start, end } = clampTaskRange(offsetStart, offsetEnd);
      const newTask: TaskDef = { label, timeOffset: start, timeOffsetEnd: end, bgColor: normalizedColor };
      base[idx].tasks.push(newTask);
      base[idx].tasks.sort((a, b) => a.timeOffset - b.timeOffset);
      setCourses(base);
      return true;
    },
    [courses, selectedCourse, setCourses]
  );

  const handleAddNewTask = useCallback(
    (rawLabel: string, offsetStart: number, offsetEnd: number, color: string): boolean => {
      const label = rawLabel.trim();
      if (!label) return false;
      const normalizedColor = normalizeTaskColor(color);
      const ok = addTaskToCourse(label, offsetStart, offsetEnd, normalizedColor);
      if (!ok) {
        // 追加できなかった場合は何も消さず残す
        return false;
      }
      // 楽観的に画面へ即時反映（親の onChange 反映前に“消えた”ように見えないように）
      setOptimisticTasks((prev) => {
        const arr = prev[selectedCourse] ?? [];
        const { start, end } = clampTaskRange(offsetStart, offsetEnd);
        const nextTask: TaskDef = { label, timeOffset: start, timeOffsetEnd: end, bgColor: normalizedColor };
        return { ...prev, [selectedCourse]: [...arr, nextTask] };
      });
      return true;
    },
    [addTaskToCourse, selectedCourse]
  );

  const shiftTaskOffset = useCallback(
    (offset: number, label: string, delta: number, target: 'start' | 'end' = 'start') => {
      const base = courses.map((c) => ({ ...c, tasks: getTasks(c).slice() }));
      const idx = base.findIndex((c) => c.name === selectedCourse);
      if (idx < 0) return;
      let found = false;
      let nextStart = offset;
      let nextEnd = offset;
      base[idx].tasks = base[idx].tasks
        .map((t) => {
          if (t.timeOffset !== offset || !normEq(t.label, label)) return t;
          found = true;
          const currentEnd = typeof t.timeOffsetEnd === 'number' ? t.timeOffsetEnd : t.timeOffset;
          if (target === 'start') {
            const newStart = clampTaskOffset(t.timeOffset + delta);
            const newEnd = Math.max(currentEnd, newStart);
            nextStart = newStart;
            nextEnd = newEnd;
            return { ...t, timeOffset: newStart, timeOffsetEnd: newEnd };
          }
          const newEnd = Math.max(clampTaskOffset(currentEnd + delta), t.timeOffset);
          nextStart = t.timeOffset;
          nextEnd = newEnd;
          return { ...t, timeOffsetEnd: newEnd };
        })
        .sort((a, b) => a.timeOffset - b.timeOffset);
      if (!found) return;
      setCourses(base);
      // keep editing state pinned to the same task while its offset changes
      setEditingTimeTask((curr) => {
        if (!curr || !normEq(curr.label, label) || curr.offset !== offset) return curr;
        return {
          offset: target === 'start' ? nextStart : curr.offset,
          end: nextEnd,
          label: curr.label,
        };
      });
      if (target === 'start') {
        setEditingLabelTask((curr) =>
          curr && curr.offset === offset && normEq(curr.label, label) ? { offset: nextStart, label: curr.label } : curr
        );
      }
    },
    [courses, selectedCourse, setCourses]
  );

  const updateTaskColor = useCallback(
    (offset: number, label: string, color: string) => {
      const normalized = normalizeTaskColor(color);
      const base = courses.map((c) => ({ ...c, tasks: getTasks(c).map((t) => ({ ...t })) }));
      const idx = base.findIndex((c) => c.name === selectedCourse);
      if (idx < 0) return;
      let changed = false;
      base[idx].tasks = base[idx].tasks.map((t) => {
        if (t.timeOffset === offset && normEq(t.label, label)) {
          const current = normalizeTaskColor(t.bgColor);
          if (current === normalized) return t;
          changed = true;
          return { ...t, bgColor: normalized };
        }
        return t;
      });
      if (!changed) return;
      setCourses(base);
    },
    [courses, selectedCourse, setCourses]
  );

  const updateCourseColor = useCallback(
    (courseName: string, colorKey: CourseColorKey | null) => {
      const normalized = colorKey ? normalizeCourseColor(colorKey) : undefined;
      const base = courses.map((c) => ({ ...c, tasks: getTasks(c).map((t) => ({ ...t })) }));
      const idx = base.findIndex((c) => c.name === courseName);
      if (idx < 0) return;
      const current = normalizeCourseColor(base[idx].color);
      if (current === normalized) return;
      base[idx].color = normalized;
      setCourses(base);
    },
    [courses, setCourses]
  );

  // ===== time step helpers for editing UI =====
  const stepHoldRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopHold = () => {
    if (stepHoldRef.current) {
      clearInterval(stepHoldRef.current);
      stepHoldRef.current = null;
    }
  };
  const startHold = (delta: number, offset: number, label: string, target: 'start' | 'end') => {
    shiftTaskOffset(offset, label, delta, target);
    stopHold();
    stepHoldRef.current = setInterval(() => shiftTaskOffset(offset, label, delta, target), 180);
  };
  useEffect(() => () => stopHold(), []);

  const deleteTaskFromCourse = useCallback(
    (offset: number, label: string) => {
      // 事故防止のため、削除前に確認
      if (!confirm('削除しますか？')) return;
      const base = courses.map((c) => ({ ...c, tasks: getTasks(c).slice() }));
      const idx = base.findIndex((c) => c.name === selectedCourse);
      if (idx < 0) return;
      base[idx].tasks = base[idx].tasks.filter((t) => !(t.timeOffset === offset && normEq(t.label, label)));
      setCourses(base);
    },
    [courses, selectedCourse, setCourses]
  );

  const startLabelEdit = useCallback((offset: number, label: string) => {
    setEditingTimeTask(null); // ラベル編集時は時間編集を必ずオフ
    setEditingLabelTask({ offset, label });
    setEditingTaskDraft(label);
  }, []);

  const startTimeEdit = useCallback((offset: number, end: number, label: string) => {
    setEditingLabelTask(null); // 時間編集時はラベル編集を必ずオフ
    setEditingTimeTask({ offset, end, label });
  }, []);

  const cancelTaskLabelEdit = useCallback(() => {
    setEditingLabelTask(null);
    setEditingTaskDraft('');
  }, []);
  const commitTaskLabelEdit = useCallback(
    (oldLabel: string, timeOffset: number) => {
      const nextLabel = (editingInputRef.current?.value ?? '').trim();
      if (!nextLabel) return cancelTaskLabelEdit();
      const base = courses.map((c) => ({ ...c, tasks: getTasks(c).slice() }));
      const idx = base.findIndex((c) => c.name === selectedCourse);
      if (idx < 0) return;
      base[idx].tasks = base[idx].tasks.map((t) =>
        t.timeOffset === timeOffset && normEq(t.label, oldLabel) ? { ...t, label: nextLabel } : t
      );
      setCourses(base);
      setEditingLabelTask(null);
      setEditingTaskDraft('');
    },
    [cancelTaskLabelEdit, courses, selectedCourse, setCourses]
  );

  const renameCourse = useCallback(
    (courseName: string) => {
      setSelectedCourse(courseName);
      const input = prompt('新しいコース名を入力してください：', courseName);
      if (input === null) return;
      const name = input.trim();
      if (!name || name === courseName) return;
      if (courses.some((c) => c.name !== courseName && normEq(c.name, name))) {
        alert('そのコース名は既に存在します。');
        return;
      }
      const base = courses.map((c) => ({ ...c }));
      const idx = base.findIndex((c) => c.name === courseName);
      if (idx < 0) return;
      base[idx].name = name;
      setCourses(base);
      setSelectedCourse(name);
    },
    [courses, setCourses, setSelectedCourse]
  );

  const deleteCourse = useCallback(
    (courseName: string) => {
      const target = courseName;
      if (!confirm(`コース『${target}』を削除しますか？`)) return;
      const base = courses.filter((c) => c.name !== target);
      setCourses(base);
      setSelectedCourse((prev) => {
        if (prev && prev !== target) return prev;
        return base[0]?.name ?? '';
      });
    },
    [courses, setCourses, setSelectedCourse]
  );

  const addCourse = useCallback(
    (rawName: string): boolean => {
      const name = rawName.trim();
      if (!name) return false;
    // 同名コースは追加不可（表記ゆれを吸収）
      if (courses.some((c) => normEq(c.name, name))) return false;
    const next = [...courses, { name, tasks: [] } as CourseDef];
    setCourses(next);
    // 追加したコースを選択状態にする
    setSelectedCourse(name);
      return true;
    },
    [courses, setCourses]
  );

  // ===== positions =====
  const addPosition = useCallback(
    (rawName: string): boolean => {
      const name = rawName.trim();
      if (!name) return false;
      if (positions.some((p) => normEq(p, name))) return false;
    const next = [...positions, name];
    setPositions(next);
      return true;
    },
    [positions, setPositions]
  );

  const removePosition = useCallback(
    (pos: string) => {
      if (normEq(pos, DEFAULT_POSITION_LABEL)) {
        alert('「全て」は削除できません。');
        return;
      }
      if (!confirm(`${pos} を削除しますか？`)) return;
      const next = positions.filter((p) => !normEq(p, pos));
      setPositions(next);
      const tbp = { ...tasksByPosition } as Record<string, Record<string, string[]>>;
      delete tbp[pos];
      setTasksByPosition(tbp);
    },
    [positions, tasksByPosition, setPositions, setTasksByPosition]
  );

  const renamePosition = useCallback(
    (pos: string) => {
      if (normEq(pos, DEFAULT_POSITION_LABEL)) {
        alert('「全て」は変更できません。');
        return;
      }
      const name = (prompt('新しいポジション名: ', pos) ?? '').trim();
      if (!name || normEq(name, pos)) return;
      if (normEq(name, DEFAULT_POSITION_LABEL)) {
        alert('「全て」という名前は使用できません。');
        return;
      }
      const next = positions.map((p) => (normEq(p, pos) ? name : p));
      setPositions(next);
      const tbp = { ...tasksByPosition } as Record<string, Record<string, string[]>>;
      if (tbp[pos]) {
        tbp[name] = tbp[pos];
        delete tbp[pos];
      }
      setTasksByPosition(tbp);
      setCourseByPosition((prev) => ({ ...prev, [name]: prev[pos] ?? courses[0]?.name ?? '' }));
    },
    [positions, tasksByPosition, courses, setPositions, setTasksByPosition]
  );

  const togglePositionOpen = useCallback(
    (pos: string) => setOpenPositions((prev) => ({ ...prev, [pos]: !prev[pos] })),
    []
  );
  const setCourseForPosition = useCallback(
    (pos: string, courseName: string) => setCourseByPosition((prev) => ({ ...prev, [pos]: courseName })),
    []
  );
  // --- Areas helpers ---
  const toggleAreaOpen = useCallback(
    (areaId: string) => setOpenAreas((prev) => ({ ...prev, [areaId]: !prev[areaId] })),
    []
  );

  const renameArea = useCallback(
    (target: AreaDef) => {
      const name = (prompt('新しいエリア名: ', target.name ?? '') ?? '').trim();
      if (!name || name === target.name) return;
      const next = areas.map((a) => (a.id === target.id ? { ...a, name } : a));
      setAreas(next);
    },
    [areas, setAreas]
  );

  const removeArea = useCallback(
    (target: AreaDef) => {
      if (!confirm('このエリアを削除しますか？')) return;
      setAreas(areas.filter((a) => a.id !== target.id));
    },
    [areas, setAreas]
  );


  // 指定ポジション×コースの「表示中タスク数」を返す
  const getEnabledCount = (pos: string, courseName: string) => {
    const arr = tasksByPosition[pos]?.[courseName] ?? [];
    return Array.isArray(arr) ? arr.length : 0;
  };

  // 指定ポジション×コースでタスクを一括ON/OFF
  const toggleAllForPositionCourse = useCallback(
    (pos: string, courseName: string, enable: boolean) => {
      if (normEq(pos, DEFAULT_POSITION_LABEL)) return;
      const tbp = { ...(tasksByPosition || {}) } as Record<string, Record<string, string[]>>;
      const courseTasks = (courses.find((c) => c.name === courseName)?.tasks ?? []).map((t) => t.label);
      const posMap = { ...(tbp[pos] || {}) } as Record<string, string[]>;
      posMap[courseName] = enable ? courseTasks : [];
      tbp[pos] = posMap;
      setTasksByPosition(tbp);
    },
    [tasksByPosition, setTasksByPosition, courses]
  );

  const toggleTaskForPosition = useCallback(
    (pos: string, courseName: string, label: string) => {
      if (normEq(pos, DEFAULT_POSITION_LABEL)) return;
      const tbp = { ...(tasksByPosition || {}) } as Record<string, Record<string, string[]>>;
      const posMap = { ...(tbp[pos] || {}) } as Record<string, string[]>;
      const arr = Array.isArray(posMap[courseName]) ? [...posMap[courseName]] : [];
      const i = arr.findIndex((l) => normEq(l, label));
      if (i >= 0) arr.splice(i, 1);
      else arr.push(label);
      posMap[courseName] = arr;
      tbp[pos] = posMap;
      setTasksByPosition(tbp);
    },
    [tasksByPosition, setTasksByPosition]
  );

  const addArea = useCallback(
    (rawName: string): boolean => {
      const name = rawName.trim();
      if (!name) return false;
      // 同名チェック（ひらがな/カタカナ/全半角の差を吸収）
      if (areas.some((a) => normalizeLabel(a.name) === normalizeLabel(name))) return false;
      const id = `area_${Date.now()}`;
      const next: AreaDef[] = [...areas, { id, name, tables: [] }];
      setAreas(next);
      return true;
    },
    [areas, setAreas]
  );
  // ===== tables (num pad) =====
  const onNumPadPress = (digit: string) => {
    if (!numPadState) return;
    if (digit === 'C') setNewTableTemp('');
    else if (digit === '←') setNewTableTemp((prev) => prev.slice(0, -1));
    else setNewTableTemp((prev) => (prev + digit).slice(0, 3));
  };
  const onNumPadConfirm = () => {
    const v = newTableTemp.trim();
    if (!v) return;
    // 追加後の整列・重複排除は setTables 側で行う
    setTables([...presetTables, v]);
    // 連続入力のため、パッドは開いたままにし、入力だけリセット
    setNewTableTemp('');
  };
  const onNumPadCancel = () => {
    setNumPadState(null);
    setNewTableTemp('');
  };

  // ===== UI shells =====
  const ListItem: FC<{ label: ReactNode; onClick: () => void }> = ({ label, onClick }) => (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="w-full flex items-center justify-between px-4 py-4 bg-white text-base border-b active:bg-gray-50 cursor-pointer"
    >
      <span className="flex items-center gap-2 min-w-0">{label}</span>
      <span className="text-gray-400">›</span>
    </div>
  );

  const SubPageShell: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
    <>
      <section>
        <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b">
          <div className="h-12 grid grid-cols-[auto,1fr,auto] items-center">
            <button
              onClick={() => setView('root')}
              className="px-3 pl-0 text-blue-600 justify-self-start"
            >
              {'\u2039'} 戻る
            </button>
            <div className="justify-self-center font-semibold pointer-events-none">{title}</div>
            <div />
          </div>
        </div>
        <div className="p-4 space-y-4">{children}</div>
        <div className={`sticky bottom-0 z-10 border-t bg-white/90 backdrop-blur p-4 ${isDirty ? 'shadow-[0_-6px_12px_rgba(0,0,0,0.06)]' : ''}`}>
          <button
            type="button"
            onClick={() => {
              const result = attemptSave();
              if (result && typeof (result as Promise<any>).then === 'function') {
                Promise.resolve(result).catch(() => {});
              }
            }}
            disabled={!isDirty || !!isSaving}
            className={`w-full px-4 py-3 rounded-md transition active:scale-[.99] ${isDirty && !isSaving ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-500'} ${isSaving ? 'opacity-60' : ''}`}
            aria-live="polite"
          >
            {isSaving ? '保存中…' : isDirty ? '保存' : '保存済み'}
          </button>
        </div>
      </section>
      {positionReminderToast}
    </>
  );

  // ============== render ==============
  // Root list (like iOS Settings top level)
  if (view === 'root') {
    return (
      <>
      <div className="min-h-0 flex flex-col gap-4">
        <section className="rounded-md border border-gray-200 bg-white">
        <ListItem
          label={
            <>
              <span>コース設定表</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowCoursesInfo((v) => !v); }}
                aria-expanded={showCoursesInfo}
                aria-controls="courses-info"
                className="inline-grid place-items-center h-6 w-6 rounded-full border border-blue-300 text-blue-600 bg-white hover:bg-blue-50 active:scale-[.98]"
                title="コース設定表の説明"
              >
                i
              </button>
            </>
          }
          onClick={() => setView('courses')}
        />
        {showCoursesInfo && (
          <div id="courses-info" className="px-4 py-3 text-[13px] text-blue-900 border-b bg-blue-50/60">
            <p className="mb-1 font-medium">コース設定表とは？</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                この画面では、<strong className="mx-1">コース</strong>と、そのコースに紐づく
                <strong className="mx-1">タスク（開始から何分後に行うか）</strong>を作成・編集します。
              </li>
              <li>
                ヒント：タスクの時間は「0分後」「15分後」「-15分（開始15分前）」のように、
                <strong className="mx-1">開始時刻からの相対時間</strong>で設定します。必要に応じて「5分後-20分後」のように
                <strong className="mx-1">開始と終了の幅</strong>も指定できます。
              </li>
            </ul>
            <div className="mt-2">
              <p className="font-medium">運用の流れ</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>
                  この画面で<strong className="mx-1">コース</strong>を作成し、各コースに
                  <strong className="mx-1">タスク</strong>を登録します。
                </li>
                <li>
                  <strong className="mx-1">予約リスト</strong>や<strong className="mx-1">スケジュール表</strong>で、該当する予約にコースを選択します。
                </li>
                <li>
                  <strong className="mx-1">タスク表</strong>に、選んだコースのタスクが時系列で自動計算されて表示されます。
                </li>
              </ol>
            </div>
          </div>
        )}
        <ListItem
          label={
            <>
              <span>{STORE_LABEL_POSITIONS}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowPositionsInfo((v) => !v); }}
                aria-expanded={showPositionsInfo}
                aria-controls="positions-info"
                className="inline-grid place-items-center h-6 w-6 rounded-full border border-blue-300 text-blue-600 bg-white hover:bg-blue-50 active:scale-[.98]"
                title="ポジション設定の説明"
              >
                i
              </button>
            </>
          }
          onClick={() => setView('positions')}
        />
        {showPositionsInfo && (
          <div id="positions-info" className="px-4 py-3 text-[13px] text-blue-900 border-b bg-blue-50/60">
            <p className="mb-1 font-medium">ポジション設定とは？</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                フロント／ホール／キッチンなどの<strong className="mx-1">ポジション</strong>ごとに、各コースで表示する
                <strong className="mx-1">タスク</strong>を切り替えます。
              </li>
              <li>
                例：ホールでは「ドリンク説明」を表示、キッチンでは非表示 といった運用が可能です。
              </li>
              <li>ポジションの追加・名前変更・削除ができます。</li>
            </ul>
            <div className="mt-2">
              <p className="font-medium">運用の流れ</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>
                  この画面で<strong className="mx-1">ポジション</strong>を作成し、各ポジションで
                  <strong className="mx-1">表示するタスク</strong>を設定します。
                </li>
                <li>
                  「<strong className="mx-1">営業前設定</strong>」の「<strong className="mx-1">本日のポジションを設定しよう</strong>」で、
                  当日の自分のポジションを選びます。
                </li>
                <li>
                  タスク表には、<strong className="mx-1">選択したポジションのタスクだけ</strong>が表示されます。
                </li>
              </ol>
            </div>
          </div>
        )}
        <ListItem
          label={
            <>
              <span>{STORE_LABEL_TABLES}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowTablesInfo((v) => !v); }}
                aria-expanded={showTablesInfo}
                aria-controls="tables-info"
                className="inline-grid place-items-center h-6 w-6 rounded-full border border-blue-300 text-blue-600 bg-white hover:bg-blue-50 active:scale-[.98]"
                title="卓設定の説明"
              >
                i
              </button>
            </>
          }
          onClick={() => setView('tables')}
        />
        <ListItem
          label={<span>フロアレイアウト設定</span>}
          onClick={() => setView('floorLayout')}
        />
        {showTablesInfo && (
          <div id="tables-info" className="px-4 py-3 text-[13px] text-blue-900 border-b bg-blue-50/60">
            <p className="mb-1 font-medium">卓設定 / エリア設定とは？</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>お店で使用する<strong className="mx-1">卓番号（テーブル番号）</strong>を登録・編集します。</li>
              <li><strong className="mx-1">エリア設定</strong>では、卓をエリア（区画）ごとにまとめて管理できます。担当をエリア単位で割り当てたい場合に便利です。</li>
              <li>ここで登録した卓番号は、<strong className="mx-1">スケジュール表</strong>に表示されるようになります。</li>
              <li>各卓ごとに<strong className="mx-1">定員</strong>（例：4名）を入力できます。定員を登録すると、<strong className="mx-1">スケジュール表</strong>に定員が表示されます。</li>
              <li>編集モードで個別削除・全削除が可能です。</li>
              <li>卓番号は最大<strong className="mx-1">3桁</strong>まで登録できます。</li>
              <li>ここで登録していない番号でも、<strong className="mx-1">予約作成時に直接入力</strong>して利用できます。</li>
            </ul>
            <div className="mt-2">
              <p className="font-medium">運用の流れ（卓番制の例）</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>この画面で、よく使う卓番号を登録しておきます。</li>
                <li>「<strong className="mx-1">営業前設定</strong>」の「<strong className="mx-1">本日の担当する卓番号（エリア）を設定しよう</strong>」で、当日の自分の担当卓（担当するエリア）を選びます。</li>
                <li>選んだ卓（またはエリア）の予約だけが<strong className="mx-1">予約リスト</strong>・<strong className="mx-1">スケジュール表</strong>・<strong className="mx-1">タスク表</strong>に表示されます（担当外は非表示）。</li>
              </ol>
            </div>
          </div>
        )}
        <ListItem
          label={
            <>
              <span>食べ放題 / 飲み放題</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowEatDrinkInfo((v) => !v); }}
                aria-expanded={showEatDrinkInfo}
                aria-controls="eatdrink-info"
                className="inline-grid place-items-center h-6 w-6 rounded-full border border-blue-300 text-blue-600 bg-white hover:bg-blue-50 active:scale-[.98]"
                title="食べ放題 / 飲み放題の説明"
              >
                i
              </button>
            </>
          }
          onClick={() => setView('eatdrink')}
        />
        {showEatDrinkInfo && (
          <div id="eatdrink-info" className="px-4 py-3 text-[13px] text-blue-900 border-b bg-blue-50/60">
            <p className="mb-1 font-medium">食べ放題 / 飲み放題とは？</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>予約リストに表示する<strong className="mx-1">2文字までの略称</strong>を登録します。記号や絵文字（例：⭐︎, ⭐︎⭐︎）も利用できます。</li>
              <li>同じ表記は重複登録できません。ポイント利用など他の識別用途にも自由に使えます。</li>
              <li>登録した略称は、<strong className="mx-1">予約リスト</strong>や<strong className="mx-1">スケジュール表</strong>から各予約に設定できます。</li>
              <li>設定した略称は、<strong className="mx-1">予約リスト</strong>と<strong className="mx-1">スケジュール表</strong>の両方に表示されます。</li>
            </ul>
            <div className="mt-2">
              <p className="font-medium">運用の流れ</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>
                  この画面で<strong className="mx-1">食べ放題／飲み放題</strong>の<strong className="mx-1">略称（2文字まで）</strong>を登録します。
                </li>
                <li>
                  <strong className="mx-1">予約リスト</strong>や<strong className="mx-1">スケジュール表</strong>で、該当する予約に登録した略称を選択します（※表示設定により、この欄を非表示にすることもできます）。
                </li>
                <li>
                  選択した略称が<strong className="mx-1">予約リスト</strong>と<strong className="mx-1">スケジュール表</strong>に表示され、現場での識別に役立ちます（※ポイント利用など任意の識別にも流用可）。
                </li>
              </ol>
            </div>
          </div>
        )}
        <ListItem
          label={
            <>
              <span>ミニタスク</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowMiniTasksInfo((v) => !v); }}
                aria-expanded={showMiniTasksInfo}
                aria-controls="minitasks-info"
                className="inline-grid place-items-center h-6 w-6 rounded-full border border-blue-300 text-blue-600 bg-white hover:bg-blue-50 active:scale-[.98]"
                title="ミニタスクの説明"
              >
                i
              </button>
            </>
          }
          onClick={() => setView('minitasks')}
        />
        {showMiniTasksInfo && (
          <div id="minitasks-info" className="px-4 py-3 text-[13px] text-blue-900 border-b bg-blue-50/60">
            <p className="mb-1 font-medium">ミニタスクとは？</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>営業中の隙間時間（ピーク帯以外の落ち着く時間帯）に行う小さな作業（例：回転準備、カトラリー補充 など）をあらかじめ登録しておく機能です。</li>
              <li>ポジションごとにリストを作成できます。項目は自由に追加・削除できます。</li>
              <li>通知は「余裕のある時間」（波設定で決める基準）にだけ出ます。忙しい時間帯には出ません。</li>
            </ul>
            <div className="mt-2">
              <p className="font-medium">運用の流れ</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>この画面で各ポジションのミニタスクを登録します。</li>
                <li>以下の「波設定」で「余裕のある時間の判断基準」を調整します。</li>
                <li>営業中、余裕のある時間帯になるとミニタスクが通知されます。完了したらチェックボタンに☑️することで進捗状況が共有されます。</li>
              </ol>
            </div>
          </div>
        )}
        <ListItem
          label={
            <>
              <span>波設定</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowWaveInfo((v) => !v); }}
                aria-expanded={showWaveInfo}
                aria-controls="wave-info"
                className="inline-grid place-items-center h-6 w-6 rounded-full border border-blue-300 text-blue-600 bg-white hover:bg-blue-50 active:scale-[.98]"
                title="波設定の説明"
              >
                i
              </button>
            </>
          }
          onClick={() => setView('wavesettings')}
        />
        {showWaveInfo && (
          <div id="wave-info" className="px-4 py-3 text-[13px] text-blue-900 border-b bg-blue-50/60">
            <p className="mb-1 font-medium">波設定とは？</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                お店の<strong className="mx-1">「余裕のある時間」</strong>を判定する<strong className="mx-1">基準</strong>を決めます。
                数値が<strong className="mx-1">大きいほど</strong>余裕と判定される時間帯は<strong className="mx-1">増え</strong>、<strong className="mx-1">小さいほど</strong>時間帯は<strong className="mx-1">減ります</strong>。
              </li>
              <li>
                ミニタスクの通知は、ここで決めた基準により<strong className="mx-1">「余裕のある時間」だけ</strong>に出ます（混雑時は通知されません）。
              </li>
              <li>
                「詳細設定」にある<strong className="mx-1">下限の基準（数値）</strong>では、これより低い時間帯を<strong className="mx-1">余裕がない時間</strong>として扱います。
                目安は<strong className="mx-1">その時間のタスク数 × 関わるお客様の人数</strong>などを加味して自動的に評価します。
              </li>
            </ul>
            <div className="mt-2">
              <p className="font-medium">運用の流れ</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>スライダーで<strong className="mx-1">「余裕のある時間」の判断基準</strong>を 0〜100 の範囲で調整します（入力は即時反映）。</li>
                <li>営業中、基準を満たした時間帯になると<strong className="mx-1">ミニタスク</strong>が通知されます。</li>
                <li>混み具合に合わせて随時調整してください。必要に応じて<strong className="mx-1">詳細設定</strong>の下限も見直します。</li>
              </ol>
            </div>
          </div>
        )}
        <ListItem
          label={<span>席効率化プロンプト</span>}
          onClick={() => setView('seatOptimizer')}
        />
        <ListItem
          label={
            <>
              <span>スケジュール設定</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowScheduleInfo((v) => !v); }}
                aria-expanded={showScheduleInfo}
                aria-controls="schedule-info"
                className="inline-grid place-items-center h-6 w-6 rounded-full border border-blue-300 text-blue-600 bg-white hover:bg-blue-50 active:scale-[.98]"
                title="スケジュール設定の説明"
              >
                i
              </button>
            </>
          }
          onClick={() => setView('schedule')}
        />
        {showScheduleInfo && (
          <div id="schedule-info" className="px-4 py-3 text-[13px] text-blue-900 border-b bg-blue-50/60">
            <p className="mb-1 font-medium">スケジュール設定とは？</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong className="mx-1">スケジュール表示時間</strong>では、スケジュール表に表示する<strong className="mx-1">開始時刻〜終了時刻</strong>の範囲を決めます。
              </li>
              <li>
                <strong className="mx-1">コース滞在時間（分）</strong>は各コースの標準的な滞在時間です。予約にコースを入力すると、<strong className="mx-1">設定した滞在時間の長さ</strong>がスケジュール表に描画されます。
              </li>
            </ul>
            <div className="mt-2">
              <p className="font-medium">運用の流れ</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>まずお店の営業時間に合わせて<strong className="mx-1">表示時間</strong>を設定します。</li>
                <li>各コースの<strong className="mx-1">滞在時間</strong>を設定（またはクリア）します。</li>
                <li>予約を作成すると、<strong className="mx-1">スケジュール表</strong>に設定値に基づいた長さで表示され、全体の流れを把握しやすくなります。</li>
              </ol>
            </div>
          </div>
        )}
        <div className={`sticky bottom-0 z-10 border-t bg-white/90 backdrop-blur p-4 ${isDirty ? 'shadow-[0_-6px_12px_rgba(0,0,0,0.06)]' : ''}`}>
          <button
            type="button"
            onClick={() => {
              const result = attemptSave();
              if (result && typeof (result as Promise<any>).then === 'function') {
                Promise.resolve(result).catch(() => {});
              }
            }}
            disabled={!isDirty || !!isSaving}
            className={`w-full px-4 py-3 rounded-md transition active:scale-[.99] ${isDirty && !isSaving ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-500'} ${isSaving ? 'opacity-60' : ''}`}
            aria-live="polite"
          >
            {isSaving ? '保存中…' : isDirty ? '保存' : '保存済み'}
          </button>
        </div>
        </section>
      </div>
      {positionReminderToast}
      </>
    );
  }
  // --- MiniTasks settings page (stub) ---
  if (view === 'minitasks') {
    return (
      <SubPageShell title="ミニタスク">
        <div className="text-sm text-gray-600">
          <MiniTasksSettings value={value} onChange={patchRoot} />
        </div>
      </SubPageShell>
    );
  }

  // --- Wave settings page (stub) ---
  if (view === 'wavesettings') {
    return (
      <SubPageShell title="波設定">
        <div className="text-sm text-gray-600">
          <WaveSettings value={value} onChange={patchRoot} />
        </div>
      </SubPageShell>
    );
  }

  if (view === 'seatOptimizer') {
    const seatValue = value.seatOptimizer ?? { basePrompt: '', tags: [] };
    return (
      <SubPageShell title="席効率化プロンプト">
        <div className="text-sm text-gray-600">
          <SeatOptimizerSettings
            value={seatValue}
            onUpdate={(next) => {
              const basePrompt = (next.basePrompt ?? '').replace(/\r/g, '');
              const rawTags = Array.isArray(next.tags)
                ? next.tags
                : Array.isArray(value.seatOptimizer?.tags)
                  ? value.seatOptimizer!.tags!
                  : [];
              const tags = rawTags.map((tag) => tag.trim()).filter((tag, idx, arr) => tag.length > 0 && arr.indexOf(tag) === idx);
              if (basePrompt.trim().length === 0 && tags.length === 0) {
                patchRoot({ seatOptimizer: undefined });
              } else {
                patchRoot({ seatOptimizer: { basePrompt, tags } });
              }
            }}
          />
        </div>
      </SubPageShell>
    );
  }

  // --- Schedule settings page ---
  if (view === 'schedule') {
    return (
      <SubPageShell title="スケジュール設定">
        <div className="text-sm text-gray-600">
          <ScheduleSettings value={value} onChange={patchRoot} />
        </div>
      </SubPageShell>
    );
  }

  // --- Floor layout settings page ---
  if (view === 'floorLayout') {
    return (
      <SubPageShell title="フロアレイアウト設定">
        <div className="text-sm text-gray-700 space-y-4">
          <p className="text-xs text-gray-600">
            ベースレイアウトを設定します。フロア画面ではここで保存したレイアウトを基に、当日だけの微調整（日次レイアウト編集）を行えます。
            卓の追加・番号変更もここから設定できます。
          </p>
          <FloorLayoutSettings
            tables={presetTables}
            areas={areas}
            layout={value.floorLayoutBase as FloorLayoutMap | undefined}
            tableCapacities={tableCapacities}
            onChangeLayout={(next) => {
              setLocalDirty(true);
              onChange({ floorLayoutBase: next });
            }}
            onChangeTablesAreas={(nextTables, nextAreas) => {
              setLocalDirty(true);
              onChange({ tables: nextTables, areas: nextAreas });
            }}
          />
        </div>
      </SubPageShell>
    );
  }

  // --- Courses page ---
  if (view === 'courses') {
    return (
      <SubPageShell title="コース設定表">
        <div className="space-y-4 text-sm">
          {/* 新しいコースの追加 */}
          <div className="mb-3 rounded-lg border border-blue-200 bg-gradient-to-b from-white to-blue-50/50 p-3 shadow-sm">
            <header className="mb-2 flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-grid place-items-center h-5 w-5 rounded-full bg-blue-600 text-white text-[12px] leading-none"
                title="新規追加"
              >
                ＋
              </span>
              <span className="text-sm font-semibold text-blue-700">新しいコースを追加</span>
            </header>
            <p className="text-gray-500 text-xs">
              名前を入力し<strong className="mx-1">「＋追加」</strong>を押してください（同名は追加できません）。
            </p>
            <NewCourseForm onAdd={addCourse} />
          </div>
          {/* 登録済みコース（アコーディオン） */}
          {courses.length > 0 ? (
            <>
              <div className="flex items-center gap-2 mt-4 mb-1">
                <div className="h-px bg-gray-200 flex-1" />
                <span className="text-xs text-gray-500">登録済みコース</span>
                <div className="h-px bg-gray-200 flex-1" />
              </div>
              <div className="space-y-3">
              {courses.map((c) => {
                const name = c.name;
                const isOpen = openCourse === name;
                const courseColor = normalizeCourseColor(c.color);
                const colorStyle = getCourseColorStyle(courseColor);

                return (
                  <div key={name} className="rounded-lg border bg-white shadow-sm overflow-visible">
                    {/* ヘッダー行（行全体クリックで開閉） */}
                    <div
                      className="flex items-center justify-between px-3 py-2 bg-gray-50/80 border-b cursor-pointer select-none hover:bg-gray-50"
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleCourseOpen(name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleCourseOpen(name);
                        }
                      }}
                      aria-expanded={isOpen}
                      aria-controls={`course-panel-${name}`}
                    >
                      {/* 左：コース名 */}
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900 min-w-0">
                        <span
                          aria-hidden="true"
                          className="inline-flex h-3 w-3 rounded-full border border-white/80 shadow-sm"
                          style={{
                            backgroundColor: colorStyle.background,
                            boxShadow: `inset 0 0 0 1px ${colorStyle.border}`,
                          }}
                        />
                        <span className="truncate">{name}</span>
                      </div>

                      {/* 右：開閉インジケータ + 設定メニュー（三点） */}
                      <div className="flex items-center gap-2">
                        {/* 開閉インジケータ */}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`h-4 w-4 text-gray-600 transition-transform ${isOpen ? 'rotate-180' : 'rotate-0'}`}
                          aria-hidden="true"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>

                        {/* 設定メニュー（三点） */}
                        <div
                          className="relative"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          ref={courseMenuFor === name ? (el) => { courseMenuRef.current = el; } : undefined}
                        >
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => setCourseMenuFor((prev) => (prev === name ? null : name))}
                            className="h-8 w-8 grid place-items-center rounded-md border border-gray-300 bg-white hover:bg-gray-100 active:scale-[.98] shadow-sm text-gray-700"
                            aria-haspopup="menu"
                            aria-expanded={courseMenuFor === name}
                            aria-label={`${name} の設定`}
                            title="その他の操作"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                              <circle cx="5" cy="12" r="1.5" />
                              <circle cx="12" cy="12" r="1.5" />
                              <circle cx="19" cy="12" r="1.5" />
                            </svg>
                          </button>
                          {courseMenuFor === name && (
                            <div role="menu" className="absolute right-0 mt-2 w-48 rounded-md border bg-white shadow-lg pb-1 text-sm z-20">
                              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                                コースの色
                              </div>
                              <div className="px-3 pb-2 grid grid-cols-2 gap-2">
                                {COURSE_COLOR_MENU_OPTIONS.map((opt) => {
                                  const optionKey = opt.key;
                                  const isActive = optionKey === null ? !courseColor : courseColor === optionKey;
                                  return (
                                    <button
                                      key={`course-color-${name}-${optionKey ?? 'none'}`}
                                      type="button"
                                      data-keepedit="1"
                                      onClick={() => updateCourseColor(name, optionKey)}
                                      className={`flex items-center gap-2 rounded-md border px-2 py-1 text-xs transition ${
                                        isActive ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                      }`}
                                    >
                                      <span
                                        aria-hidden="true"
                                        className="inline-flex h-4 w-4 rounded-full border border-white/70 shadow-sm"
                                        style={{
                                          backgroundColor: opt.hex,
                                          boxShadow: `inset 0 0 0 1px ${opt.textHex}`,
                                        }}
                                      />
                                      <span className="truncate">{opt.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                              <div className="border-t border-gray-100 pt-1">
                                <button
                                  type="button"
                                  onClick={() => { setCourseMenuFor(null); renameCourse(name); }}
                                  className="w-full text-left px-3 py-2 hover:bg-gray-50"
                                >
                                  ✎ コース名変更
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setCourseMenuFor(null); deleteCourse(name); }}
                                  className="w-full text-left px-3 py-2 text-red-600 hover:bg-red-50"
                                >
                                  🗑 コース削除
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 展開エリア：タスク編集（既存UIを流用） */}
                    {isOpen && selectedCourse === name && (
                      <div id={`course-panel-${name}`} className="p-3 space-y-3">
                        {!isTablet && (
                          <p className="text-xs text-gray-600 px-2">
                            色の変更はタブレット端末からのみ操作できます。
                          </p>
                        )}
                        {/* 既存タスクリスト */}
                        <div className="space-y-1">
                          {courseTasksForList.length === 0 ? (
                            <div className="py-6 px-3 rounded-md border border-dashed bg-gray-50/60 text-sm text-gray-600 text-center">
                              まだタスクがありません。下の<strong className="mx-1">「追加」</strong>ボタンから新規タスクを追加してください。
                            </div>
                          ) : (
                            courseTasksForList.map((task, idx) => {
                              const startOffset = task.timeOffset;
                              const endOffset = task.timeOffsetEnd ?? task.timeOffset;
                              const hasRange = endOffset !== startOffset;
                              const timeButtonBaseClass =
                                'inline-flex justify-center px-3 rounded-full border font-medium tabular-nums active:scale-[.99] focus:outline-none focus:ring-2 shrink-0';
                              const timeButtonLayoutClass = hasRange
                                ? 'flex-col items-center gap-0.5 py-1 text-[10px] md:text-[11px]'
                                : 'items-center h-8 text-xs md:h-9 md:text-sm';
                              const timeButtonColorClass =
                                startOffset < 0
                                  ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus:ring-red-400'
                                  : 'border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 focus:ring-sky-400';
                              const startOffsetLabel = formatTaskOffset(startOffset);
                              const endOffsetLabel = formatTaskOffset(endOffset);
                              const activeEditingTask =
                                editingTimeTask &&
                                editingTimeTask.offset === task.timeOffset &&
                                normEq(editingTimeTask.label, task.label)
                                  ? editingTimeTask
                                  : null;

                              const renderLabelField = () => {
                                if (
                                  editingLabelTask &&
                                  editingLabelTask.offset === task.timeOffset &&
                                  normEq(editingLabelTask.label, task.label)
                                ) {
                                  return (
                                    <input
                                      ref={editingInputRef}
                                      type="text"
                                      defaultValue={editingTaskDraft}
                                      inputMode="text"
                                      autoCapitalize="none"
                                      autoCorrect="off"
                                      spellCheck={false}
                                      lang="ja"
                                      onCompositionStart={() => {
                                        editingLabelComposingRef.current = true;
                                      }}
                                      onCompositionEnd={() => {
                                        editingLabelComposingRef.current = false;
                                      }}
                                      onBlur={() => {
                                        /* no-op */
                                      }}
                                      onKeyDown={(e) => {
                                        const isComp = (e as any).nativeEvent?.isComposing;
                                        if (e.key === 'Enter' && !isComp && !editingLabelComposingRef.current) {
                                          e.preventDefault();
                                          commitTaskLabelEdit(task.label, task.timeOffset);
                                        } else if (e.key === 'Escape') {
                                          e.preventDefault();
                                          cancelTaskLabelEdit();
                                        }
                                      }}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onClick={(e) => e.stopPropagation()}
                                      data-keepedit="1"
                                      autoFocus
                                    className="min-w-0 h-9 w-full px-3 rounded-md border border-gray-300 bg-white text-[13px] shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 md:text-sm"
                                      key={`edit-${task.timeOffset}-${task.timeOffsetEnd ?? task.timeOffset}-${task.label}`}
                                    />
                                  );
                                }
                                return (
                                  <span
                                    className="min-w-0 h-9 w-full inline-flex items-center px-3 rounded-md border border-gray-200 bg-white text-gray-900 text-[13px] md:text-sm cursor-text overflow-hidden text-ellipsis whitespace-nowrap transition group-hover:bg-gray-50"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                    }}
                                    onClick={() => startLabelEdit(task.timeOffset, task.label)}
                                    data-keepedit="1"
                                    title="クリックして名前を編集"
                                  >
                                    {!isTablet && (
                                      <span
                                        aria-hidden="true"
                                        className={`mr-2 inline-flex h-3 w-3 flex-none rounded-full border border-gray-300 ${task.bgColor}`}
                                      />
                                    )}
                                    {task.label}
                                  </span>
                                );
                              };

                              const renderColorSelector = () => {
                                if (!isTablet) return null;
                                return (
                                  <TaskColorSelector
                                    value={task.bgColor}
                                    onChange={(nextColor) => updateTaskColor(task.timeOffset, task.label, nextColor)}
                                    ariaLabel={`${task.label} の色`}
                                    compact
                                  />
                                );
                              };

                              const renderDeleteButton = () => (
                                <button
                                  onClick={() => deleteTaskFromCourse(task.timeOffset, task.label)}
                                  className="w-[48px] h-8 rounded-md border border-red-200 text-red-600/90 hover:bg-red-50 active:scale-[.99] justify-self-end text-xs font-medium shrink-0"
                                  data-keepedit="1"
                                >
                                  削除
                                </button>
                              );

                              if (activeEditingTask) {
                                const stepperButtonClass =
                                  'px-1.5 w-7 h-7 text-[10px] font-medium text-sky-700 bg-white hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-400 md:w-10 md:h-10 md:text-sm md:px-2';
                                const stepperValueClass =
                                  'min-w-[52px] h-7 px-1.5 grid place-items-center text-[10px] font-semibold text-sky-900 tabular-nums bg-sky-50 shrink-0 md:min-w-[80px] md:h-10 md:text-sm md:px-2';
                                const stepperLabelClass =
                                  'text-[9px] font-medium text-sky-700 md:text-[11px]';
                                const stepperRowClass =
                                  'flex flex-nowrap items-center justify-center gap-1.5 md:flex-wrap md:gap-3';
                                return (
                                  <div
                                    key={`${task.timeOffset}_${task.timeOffsetEnd ?? task.timeOffset}_${normalizeLabel(task.label)}_${idx}`}
                                    className="py-2 px-2 bg-white rounded-md border border-gray-200 shadow-sm hover:shadow-md transition group"
                                  >
                                    <div className="flex flex-col gap-3" data-keepedit="1">
                                      <div
                                        className="rounded-lg border border-sky-200 bg-sky-50/80 p-2.5 shadow-sm md:p-3"
                                        data-keepedit="1"
                                      >
                                        <div
                                          className={`${stepperRowClass} flex-wrap justify-center md:flex-nowrap md:justify-between`}
                                          data-keepedit="1"
                                        >
                                          <div className="flex flex-col items-center gap-1" data-keepedit="1">
                                            <span className={stepperLabelClass}>開始</span>
                                            <div
                                              className="inline-flex items-stretch rounded-md border border-sky-300 bg-white shadow-sm overflow-hidden"
                                              role="group"
                                              aria-label="開始時間調整"
                                            >
                                              <button
                                                type="button"
                                                data-keepedit="1"
                                                onPointerDown={(e) => {
                                                  e.preventDefault();
                                                  startHold(-5, activeEditingTask.offset, task.label, 'start');
                                                }}
                                                onPointerUp={stopHold}
                                                onPointerCancel={stopHold}
                                                onPointerLeave={stopHold}
                                                className={stepperButtonClass}
                                                aria-label="開始を5分早く"
                                              >
                                                -5
                                              </button>
                                              <div className={stepperValueClass}>
                                                {formatTaskOffset(activeEditingTask.offset)}
                                              </div>
                                              <button
                                                type="button"
                                                data-keepedit="1"
                                                onPointerDown={(e) => {
                                                  e.preventDefault();
                                                  startHold(+5, activeEditingTask.offset, task.label, 'start');
                                                }}
                                                onPointerUp={stopHold}
                                                onPointerCancel={stopHold}
                                                onPointerLeave={stopHold}
                                                className={stepperButtonClass}
                                                aria-label="開始を5分遅く"
                                              >
                                                +5
                                              </button>
                                            </div>
                                          </div>
                                          <span
                                            className="text-[9px] font-semibold text-sky-700 md:text-xs"
                                            aria-hidden="true"
                                            data-keepedit="1"
                                          >
                                            〜
                                          </span>
                                          <div className="flex flex-col items-center gap-1" data-keepedit="1">
                                            <span className={stepperLabelClass}>終了</span>
                                            <div
                                              className="inline-flex items-stretch rounded-md border border-sky-300 bg-white shadow-sm overflow-hidden"
                                              role="group"
                                              aria-label="終了時間調整"
                                            >
                                              <button
                                                type="button"
                                                data-keepedit="1"
                                                onPointerDown={(e) => {
                                                  e.preventDefault();
                                                  startHold(-5, activeEditingTask.offset, task.label, 'end');
                                                }}
                                                onPointerUp={stopHold}
                                                onPointerCancel={stopHold}
                                                onPointerLeave={stopHold}
                                                className={stepperButtonClass}
                                                aria-label="終了を5分早く"
                                              >
                                                -5
                                              </button>
                                              <div className={stepperValueClass}>
                                                {formatTaskOffset(activeEditingTask.end)}
                                              </div>
                                              <button
                                                type="button"
                                                data-keepedit="1"
                                                onPointerDown={(e) => {
                                                  e.preventDefault();
                                                  startHold(+5, activeEditingTask.offset, task.label, 'end');
                                                }}
                                                onPointerUp={stopHold}
                                                onPointerCancel={stopHold}
                                                onPointerLeave={stopHold}
                                                className={stepperButtonClass}
                                                aria-label="終了を5分遅く"
                                              >
                                                +5
                                              </button>
                                            </div>
                                          </div>
                                          <button
                                            type="button"
                                            data-keepedit="1"
                                            onClick={() => {
                                              stopHold();
                                              setEditingTimeTask(null);
                                            }}
                                            className="self-center px-3 h-8 rounded-md border border-sky-200 bg-white text-xs font-medium text-sky-700 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-400 md:h-9"
                                            aria-label="時間編集を閉じる"
                                          >
                                            編集を閉じる
                                          </button>
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2 sm:gap-3" data-keepedit="1">
                                        <div className="flex-1 min-w-[9.5rem] sm:min-w-[12rem]" data-keepedit="1">
                                          {renderLabelField()}
                                        </div>
                                        {isTablet && (
                                          <div className="shrink-0" data-keepedit="1">
                                            {renderColorSelector()}
                                          </div>
                                        )}
                                        <div className="shrink-0" data-keepedit="1">
                                          {renderDeleteButton()}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              }

                              return (
                                <div
                                  key={`${task.timeOffset}_${task.timeOffsetEnd ?? task.timeOffset}_${normalizeLabel(task.label)}_${idx}`}
                                  className="py-2 px-2 bg-white rounded-md border border-gray-200 shadow-sm hover:shadow-md transition group"
                                >
                                  <div
                                    className={`grid items-center gap-2 md:gap-3 ${
                                      isTablet ? 'grid-cols-[auto,1fr,auto,52px]' : 'grid-cols-[auto,1fr,52px]'
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() =>
                                        startTimeEdit(task.timeOffset, task.timeOffsetEnd ?? task.timeOffset, task.label)
                                      }
                                      className={`${timeButtonBaseClass} ${timeButtonLayoutClass} ${timeButtonColorClass}`}
                                      title="タップで時間編集"
                                    >
                                      {hasRange ? (
                                        <span className="flex flex-col items-center leading-tight">
                                          <span className="whitespace-nowrap">{startOffsetLabel}</span>
                                          <span className="whitespace-nowrap">〜 {endOffsetLabel}</span>
                                        </span>
                                      ) : (
                                        <span className="whitespace-nowrap">{startOffsetLabel}</span>
                                      )}
                                    </button>
                                    <div className="min-w-0">{renderLabelField()}</div>
                                    {isTablet && renderColorSelector()}
                                    {renderDeleteButton()}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>

                        {/* 新規タスクを追加 */}
                        <div className="mt-4">
                          <div className="rounded-lg border border-emerald-200 bg-gradient-to-b from-white to-emerald-50/50 p-3 shadow-sm">
                            <header className="mb-2 flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="inline-grid place-items-center h-5 w-5 rounded-full bg-emerald-600 text-white text-[12px] leading-none"
                                title="新規追加"
                              >
                                ＋
                              </span>
                              <span className="text-sm font-semibold text-emerald-700">このコースに新しいタスクを追加</span>
                            </header>
                            <p className="text-gray-500 text-xs">
                              タスク名を入力し<strong className="mx-1">開始・終了（-180〜180分）</strong>を調整して「追加」を押してください。
                            </p>
                            <NewTaskForm onAdd={handleAddNewTask} allowColorSelection={isTablet} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed bg-gray-50/60 p-4 text-sm text-gray-600">
              まだコースはありません。上の「新しいコースを追加」から作成してください。
            </div>
          )}
        </div>
      </SubPageShell>
    );
  }

  // --- Positions page ---
  if (view === 'positions') {
    return (
      <SubPageShell title={STORE_LABEL_POSITIONS}>
        <div className="space-y-4">
          {/* 新規ポジションの追加 */}
          <div className="mb-3 rounded-lg border border-blue-200 bg-gradient-to-b from-white to-blue-50/50 p-3 shadow-sm">
            <header className="mb-2 flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-grid place-items-center h-5 w-5 rounded-full bg-blue-600 text-white text-[12px] leading-none"
                title="新規追加"
              >
                ＋
              </span>
              <span className="text-sm font-semibold text-blue-700">新しいポジションを追加</span>
            </header>
            <p className="text-gray-500 text-xs">
              名前を入力し<strong className="mx-1">「＋追加」</strong>を押してください（同名は追加できません）。
            </p>
            <NewPositionForm onAdd={addPosition} />
          </div>

          {/* 登録済みポジション 見出し/リスト or 空状態 */}
          {positions.length > 0 ? (
            <>
              <div className="flex items-center gap-2 mt-4 mb-1">
                <div className="h-px bg-gray-200 flex-1" />
                <span className="text-xs text-gray-500">登録済みポジション</span>
                <div className="h-px bg-gray-200 flex-1" />
              </div>

              {/* ポジションごとのカード */}
              {positions.map((pos) => {
                const currentCourse = courseByPosition[pos] ?? courses[0]?.name ?? '';
                const tasksForCourse = (courses.find((c) => c.name === currentCourse)?.tasks ?? [])
                  .slice()
                  .sort((a, b) => a.timeOffset - b.timeOffset);
                const isDefaultPosition = normEq(pos, DEFAULT_POSITION_LABEL);

                return (
                  <div key={pos} className="rounded-lg border bg-white shadow-sm overflow-visible">
                    {/* ヘッダー行（行全体クリックで開閉） */}
                    <div
                      className="flex items-center justify-between px-3 py-2 bg-gray-50/80 border-b cursor-pointer select-none hover:bg-gray-50"
                      role="button"
                      tabIndex={0}
                      onClick={() => togglePositionOpen(pos)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          togglePositionOpen(pos);
                        }
                      }}
                      aria-expanded={openPositions[pos] ? true : false}
                      aria-controls={`pos-panel-${pos}`}
                    >
                      {/* 左：ポジション名 */}
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        <span>{pos}</span>
                      </div>

                      {/* 右：開閉インジケータ + 設定メニュー（三点）*/}
                      <div className="flex items-center gap-2">
                        {/* 開閉インジケータ（矢印） */}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`h-4 w-4 text-gray-600 transition-transform ${openPositions[pos] ? 'rotate-180' : 'rotate-0'}`}
                          aria-hidden="true"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>

                        {/* 設定メニュー（三点） */}
                        <div
                          className="relative"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          ref={posMenuFor === pos ? (el) => { posMenuRef.current = el; } : undefined}
                        >
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); setPosMenuFor((prev) => (prev === pos ? null : pos)); }}
                            className="h-8 w-8 grid place-items-center rounded-md border border-gray-300 bg-white hover:bg-gray-100 active:scale-[.98] shadow-sm text-gray-700"
                            aria-haspopup="menu"
                            aria-expanded={posMenuFor === pos}
                            aria-label={`${pos} の設定`}
                            title="その他の操作"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                              <circle cx="5" cy="12" r="1.5" />
                              <circle cx="12" cy="12" r="1.5" />
                              <circle cx="19" cy="12" r="1.5" />
                            </svg>
                          </button>
                          {posMenuFor === pos && (
                            <div role="menu" className="absolute right-0 mt-2 w-40 rounded-md border bg-white shadow-lg py-1 text-sm z-20">
                              <button
                                type="button"
                                onClick={() => { setPosMenuFor(null); renamePosition(pos); }}
                                disabled={isDefaultPosition}
                                className={`w-full text-left px-3 py-2 ${isDefaultPosition ? 'cursor-not-allowed text-gray-400' : 'hover:bg-gray-50'}`}
                                title={isDefaultPosition ? 'このポジションは変更できません' : undefined}
                              >
                                ✎ 名前変更
                              </button>
                              <button
                                type="button"
                                onClick={() => { setPosMenuFor(null); removePosition(pos); }}
                                disabled={isDefaultPosition}
                                className={`w-full text-left px-3 py-2 ${isDefaultPosition ? 'cursor-not-allowed text-gray-400' : 'text-red-600 hover:bg-red-50'}`}
                                title={isDefaultPosition ? 'このポジションは削除できません' : undefined}
                              >
                                🗑 削除
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 展開エリア */}
                    {openPositions[pos] && (
                      <div id={`pos-panel-${pos}`} className="p-3 space-y-3">
                        {/* ツールバー：コース選択のみ */}
                        <div className="flex items-center gap-2">
                          <label className="text-sm text-gray-600">コース：</label>
                          <select
                            value={currentCourse}
                            onChange={(e) => setCourseForPosition(pos, e.target.value)}
                            className="px-3 py-2 rounded-md border border-gray-300 text-sm shadow-sm bg-white"
                          >
                            {courses.map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* タスクリスト（テーブル風） */}
                        <div className="rounded-md border overflow-hidden">
                          <div className="flex flex-wrap items-center px-3 py-2 bg-gray-50 text-sm text-gray-500 gap-4 md:gap-6">
                            <div className="min-w-[5.5rem]">時間</div>
                            <div className="flex-1 min-w-0">タスク名</div>
                            <div className="ml-4 md:ml-6 text-right">表示</div>
                          </div>
                          <div>
                            {tasksForCourse.map((task) => (
                              <div
                                key={`${task.timeOffset}_${task.timeOffsetEnd ?? task.timeOffset}_${task.label}`}
                                className="flex flex-wrap items-center px-3 py-2 border-t odd:bg-white even:bg-gray-50/40 hover:bg-gray-50 text-sm gap-4 md:gap-6"
                              >
                                <div className="min-w-[5.5rem] tabular-nums text-gray-700">{formatTaskRange(task.timeOffset, task.timeOffsetEnd)}</div>
                                <div className="flex-1 min-w-0 truncate" title={task.label}>{task.label}</div>
                                <div className="ml-4 md:ml-6 text-right">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(
                                      tasksByPosition[pos]?.[currentCourse]?.some((l) => normEq(l, task.label))
                                    )}
                                    onChange={() => toggleTaskForPosition(pos, currentCourse, task.label)}
                                    disabled={isDefaultPosition}
                                    aria-disabled={isDefaultPosition}
                                    className={`h-5 w-5 align-middle ${isDefaultPosition ? 'cursor-not-allowed opacity-70' : ''}`}
                                  />
                                </div>
                              </div>
                            ))}
                            {tasksForCourse.length === 0 && (
                              <div className="px-3 py-6 text-sm text-gray-500">該当するタスクがありません。</div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed bg-gray-50/60 p-4 text-sm text-gray-600">
              まだ登録済みのポジションはありません。上の「新しいポジション名」に入力して「＋追加」を押してください。
            </div>
          )}
        </div>
      </SubPageShell>
    );
  }

  // --- Tables index (drill-in) ---
  if (view === 'tables') {
    return (
      <SubPageShell title={STORE_LABEL_TABLES}>
        <div className="rounded-md border overflow-hidden bg-white">
          <ListItem label={<span>卓設定</span>} onClick={() => setView('tablesTables')} />
          <ListItem label={<span>エリア設定</span>} onClick={() => setView('tablesAreas')} />
        </div>
      </SubPageShell>
    );
  }

  // --- Tables > 卓設定 ---
  if (view === 'tablesTables') {
    return (
      <>
        <SubPageShell title="卓設定">
          <div className="space-y-3 text-sm">
            <div className="mb-2">
              <div className="rounded-lg border border-blue-200 bg-gradient-to-b from-white to-blue-50/50 p-3 shadow-sm">
                <header className="mb-2 flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-grid place-items-center h-5 w-5 rounded-full bg-blue-600 text-white text-[12px] leading-none"
                    title="新規追加"
                  >
                    ＋
                  </span>
                  <span className="text-sm font-semibold text-blue-700">新しい卓を追加</span>
                </header>
                <p className="text-gray-500 text-xs">
                  数字パッドで卓番号を入力し<strong className="mx-1">「追加」</strong>を押してください（重複は自動で除外／番号順に整列）。
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={newTableTemp}
                    readOnly
                    onClick={() => setNumPadState({ id: '-1', field: 'presetTable', value: '' })}
                    placeholder="卓番号を入力"
                    maxLength={3}
                    className="border px-2 py-1 w-full rounded text-sm text-center cursor-pointer shadow-sm"
                  />
                </div>
              </div>

              {/* 視覚的な区切り（新規追加 と 設定済みリスト） */}
              <div className="flex items-center gap-2 mt-4 mb-1">
                <div className="h-px bg-gray-200 flex-1" />
                <span className="text-xs text-gray-500">設定済み卓</span>
                <div className="h-px bg-gray-200 flex-1" />
              </div>
            </div>

            {presetTables.length > 0 ? (
              <div className="mt-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium mb-1">設定済み卓（{presetTables.length}）</p>
                  <div className="flex items-center gap-2">
                    {tableEditMode && (
                      <button
                        onClick={() => setTables([])}
                        className="px-2 py-0.5 text-xs text-red-600 border border-red-200 rounded bg-white hover:bg-red-50 active:scale-[.99]"
                      >
                        全削除
                      </button>
                    )}
                    <button onClick={() => setTableEditMode((p) => !p)} className="px-2 py-0.5 bg-yellow-500 text-white rounded text-xs active:scale-[.99]">
                      {tableEditMode ? '完了' : '編集'}
                    </button>
                  </div>
                </div>
                <div className="mt-2 space-y-2">
                  {presetTables.map((tbl) => {
                    const cap = tableCapacities[tbl];
                    return (
                      <div
                        key={tbl}
                        className="flex flex-wrap items-center gap-3 rounded-lg border bg-white px-3 py-2 shadow-sm"
                      >
                        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-sky-700 font-semibold tabular-nums">
                            {tbl}
                          </span>
                          <span>卓</span>
                        </div>
                        <div className="ml-auto flex items-center gap-2 text-sm text-gray-600">
                          <label className="text-xs uppercase tracking-wide text-gray-400" htmlFor={`table-cap-${tbl}`}>
                            定員
                          </label>
                          <input
                            id={`table-cap-${tbl}`}
                            type="number"
                            min={1}
                            step={1}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            placeholder="例: 4"
                            value={cap != null ? String(cap) : ''}
                            onChange={(e) => handleTableCapacityChange(tbl, e.currentTarget.value)}
                            className="w-20 rounded border border-gray-300 px-2 py-1 text-right text-sm shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                            aria-label={`${tbl}卓の定員`}
                          />
                          <span className="text-xs text-gray-500">名</span>
                        </div>
                        {tableEditMode && (
                          <button
                            onClick={() => setTables(presetTables.filter((t) => t !== tbl))}
                            className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600 text-[14px] leading-none hover:bg-red-100 hover:text-red-700 active:scale-[.98]"
                            aria-label={`${tbl} を削除`}
                            title="削除"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-dashed bg-gray-50/60 p-4 text-sm text-gray-600">
                まだ卓は登録されていません。上の「卓番号を入力」から追加してください。
              </div>
            )}
          </div>
        </SubPageShell>

        {/* ===== 数値パッド（画面下部のボトムシート）===== */}
        {numPadState && (
          <div className="fixed inset-0 z-[120]">
            {/* backdrop */}
            <button
              type="button"
              onClick={onNumPadCancel}
              aria-label="数字パッドを閉じる"
              className="absolute inset-0 bg-black/30"
            />
            {/* sheet */}
            <div className="absolute left-0 right-0 bottom-0 bg-white border-t rounded-t-2xl shadow-2xl">
              <div className="mx-auto w-full max-w-md p-3 pb-5">
                {/* 現在の入力表示 */}
                <div className="w-full text-center mb-2">
                  <div className="inline-block min-w-[6rem] px-3 py-2 rounded-md border bg-gray-50 text-2xl font-mono tracking-widest tabular-nums">
                    {newTableTemp || '‒‒‒'}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {['1','2','3','4','5','6','7','8','9','0','←','C'].map((d) => (
                    <button
                      key={d}
                      onClick={() => onNumPadPress(d)}
                      className="bg-white border rounded-lg text-xl font-mono py-3 shadow-sm hover:bg-gray-50 active:scale-[.99]"
                      aria-label={`キー ${d}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={onNumPadCancel}
                    className="px-4 py-3 rounded-md border bg-white text-gray-700 hover:bg-gray-50 active:scale-[.99]"
                  >
                    閉じる
                  </button>
                  <button
                    onClick={onNumPadConfirm}
                    className="px-4 py-3 rounded-md bg-blue-600 text-white shadow-sm active:scale-[.99]"
                  >
                    追加
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // --- Tables > エリア設定 ---
  if (view === 'tablesAreas') {
    return (
      <SubPageShell title="エリア設定">
        <div className="space-y-3 text-sm">
          <div className="mb-3 rounded-lg border border-blue-200 bg-gradient-to-b from-white to-blue-50/50 p-3 shadow-sm">
            <header className="mb-2 flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-grid place-items-center h-5 w-5 rounded-full bg-blue-600 text-white text-[12px] leading-none"
                title="新規追加"
              >
                ＋
              </span>
              <span className="text-sm font-semibold text-blue-700">新しいエリアを追加</span>
            </header>
            <p className="text-gray-500 text-xs">
              名前を入力し<strong className="mx-1">「＋追加」</strong>を押してください（同名は追加できません）。
            </p>
            <NewAreaForm onAdd={addArea} />
          </div>

          {areas.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-gray-50/60 p-4 text-sm text-gray-600">
              まだエリアはありません。「＋ エリア追加」から作成し、所属する卓を選択してください。
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mt-4 mb-1">
                <div className="h-px bg-gray-200 flex-1" />
                <span className="text-xs text-gray-500">登録済みエリア</span>
                <div className="h-px bg-gray-200 flex-1" />
              </div>
              {areas.map((area, idx) => {
                const aid = String(area.id ?? idx);
                const isOpen = !!openAreas[aid];

                return (
                  <div key={aid} className="rounded-lg border bg-white shadow-sm">
                    {/* ヘッダー行（行全体クリックで開閉） */}
                    <div
                      className="flex items-center justify-between px-3 py-2 bg-gray-50/80 border-b cursor-pointer select-none hover:bg-gray-50"
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleAreaOpen(aid)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleAreaOpen(aid);
                        }
                      }}
                      aria-expanded={isOpen}
                      aria-controls={`area-panel-${aid}`}
                    >
                      {/* 左：エリア名 */}
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900 min-w-0">
                        <span className="truncate">{area.name || '(名称未設定)'}</span>
                      </div>

                      {/* 右：開閉インジケータ + 設定メニュー（三点） */}
                      <div className="flex items-center gap-2">
                        {/* 開閉インジケータ（矢印） */}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`h-4 w-4 text-gray-600 transition-transform ${isOpen ? 'rotate-180' : 'rotate-0'}`}
                          aria-hidden="true"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>

                        {/* 設定メニュー（三点） */}
                        <div
                          className="relative"
                          ref={areaMenuFor === aid ? (el) => { areaMenuRef.current = el; } : undefined}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setAreaMenuFor((prev) => (prev === aid ? null : aid)); }}
                            className="h-8 w-8 grid place-items-center rounded-md border border-gray-300 bg-white hover:bg-gray-100 active:scale-[.98] shadow-sm text-gray-700"
                            aria-haspopup="menu"
                            aria-expanded={areaMenuFor === aid}
                            aria-label={`${area.name || 'このエリア'} の設定`}
                            title="その他の操作"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                              <circle cx="5" cy="12" r="1.5" />
                              <circle cx="12" cy="12" r="1.5" />
                              <circle cx="19" cy="12" r="1.5" />
                            </svg>
                          </button>
                          {areaMenuFor === aid && (
                            <div role="menu" className="absolute right-0 mt-2 w-40 rounded-md border bg-white shadow-lg py-1 text-sm z-20">
                              <button
                                type="button"
                                onClick={() => { setAreaMenuFor(null); renameArea(area); }}
                                className="w-full text-left px-3 py-2 hover:bg-gray-50"
                              >
                                ✎ 名前変更
                              </button>
                              <button
                                type="button"
                                onClick={() => { setAreaMenuFor(null); removeArea(area); }}
                                className="w-full text-left px-3 py-2 text-red-600 hover:bg-red-50"
                              >
                                🗑 削除
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 展開エリア：卓の割当（既存のタイルUIを流用） */}
                    {isOpen && (
                      <div id={`area-panel-${aid}`} className="p-3">
                        {presetTables.length === 0 ? (
                          <p className="text-sm text-gray-500">先に「卓設定」で卓番号を登録してください。</p>
                        ) : (
                          <div className="grid gap-1.5 grid-cols-[repeat(auto-fit,minmax(3.5rem,1fr))]">
                            {presetTables.map((tbl) => {
                              const key = String(tbl);
                              const selected = Array.isArray(area.tables) && area.tables.includes(key);
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => {
                                    const next = areas.map((a) => {
                                      if (a.id !== area.id) return a;
                                      const set = new Set<string>(Array.isArray(a.tables) ? a.tables.map(String) : []);
                                      if (set.has(key)) set.delete(key); else set.add(key);
                                      return { ...a, tables: Array.from(set).sort((x, y) => Number(x) - Number(y)) } as AreaDef;
                                    });
                                    setAreas(next);
                                  }}
                                  className={`inline-flex items-center justify-center gap-1 rounded-full border px-2.5 py-1 shadow-sm whitespace-nowrap tabular-nums ${selected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white'} active:scale-[.99]`}
                                  title={`${key} を${selected ? '除外' : '追加'}`}
                                >
                                  <span className="text-sm font-medium">{key}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SubPageShell>
    );
  }

  // --- Eat/Drink page ---
  if (view === 'eatdrink') {
    return (
      <SubPageShell title="食べ放題 / 飲み放題">
        <div className="space-y-6 text-sm">
          {/* 使い方のヒントトグル */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowEatDrinkHelp((v) => !v)}
              aria-expanded={showEatDrinkHelp}
              aria-controls="eatdrink-help"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-white text-gray-700 hover:bg-gray-50 active:scale-[.99] shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8.5v.01M11 11h2v5h-2z" />
              </svg>
              <span>使い方のヒント</span>
            </button>
          </div>

          {showEatDrinkHelp && (
            <div id="eatdrink-help" className="rounded-md border border-blue-200 bg-blue-50/70 p-3 text-[13px] text-blue-900">
              <p className="mb-1">この略称は次の用途に使えます：</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>予約リストで、どの<strong className="mx-1">食べ放題／飲み放題</strong>かをひと目で判別するための表示。</li>
                <li>運用に応じて、<strong className="mx-1">ポイント利用卓・記念日席</strong>など、他の識別目的に使ってもOK。</li>
                <li>表示幅の都合で<strong className="mx-1">2文字まで</strong>。記号や絵文字（例：⭐︎, ⭐︎⭐︎）も利用できます。</li>
                <li>同じ表記は重複として追加できません。</li>
              </ul>
            </div>
          )}

          {/* 食べ放題 */}
          <section className="rounded-lg border bg-white shadow-sm overflow-hidden">
            <header className="px-3 py-2 bg-gray-50/80 border-b font-semibold">食べ放題</header>
            <div className="p-3 space-y-3">
              {/* 登録済みのプラン */}
              <div className="space-y-2">
                {eatOptions.length > 0 ? eatOptions.map((opt) => (
                  <EatDrinkOptionRow
                    key={opt.label}
                    option={opt}
                    onRemove={(label) => {
                      const next = eatOptions.filter((o) => !normEq(o.label, label));
                      setEatOptions(next);
                    }}
                    onColorChange={updateEatOptionColor}
                  />
                )) : (
                  <span className="text-gray-500 text-xs">まだ登録がありません。下の入力欄から追加してください。</span>
                )}
              </div>

              {/* 追加フォーム */}
              <EatDrinkOptionForm
                existing={eatOptions}
                onAdd={addEatOption}
                placeholder="例: ⭐︎ / ⭐︎⭐︎"
                describedById="eat-help"
              />
            </div>
          </section>

          {/* 飲み放題 */}
          <section className="rounded-lg border bg-white shadow-sm overflow-hidden">
            <header className="px-3 py-2 bg-gray-50/80 border-b font-semibold">飲み放題</header>
            <div className="p-3 space-y-3">
              {/* 登録済みのプラン */}
              <div className="space-y-2">
                {drinkOptions.length > 0 ? drinkOptions.map((opt) => (
                  <EatDrinkOptionRow
                    key={opt.label}
                    option={opt}
                    onRemove={(label) => {
                      const next = drinkOptions.filter((o) => !normEq(o.label, label));
                      setDrinkOptions(next);
                    }}
                    onColorChange={updateDrinkOptionColor}
                  />
                )) : (
                  <span className="text-gray-500 text-xs">まだ登録がありません。下の入力欄から追加してください。</span>
                )}
              </div>

              {/* 追加フォーム */}
              <EatDrinkOptionForm
                existing={drinkOptions}
                onAdd={addDrinkOption}
                placeholder="例: スタ / プレ"
                describedById="drink-help"
              />
            </div>
          </section>
        </div>
      </SubPageShell>
    );
  }

  return null;
}

type NewCourseFormProps = {
  onAdd: (name: string) => boolean;
};

const NewCourseForm = memo(function NewCourseForm({ onAdd }: NewCourseFormProps) {
  const [draft, setDraft] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const canSubmit = !!draft.trim() && !isComposing;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    const ok = onAdd(draft);
    if (!ok) return;
    setDraft('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [canSubmit, draft, onAdd]);

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        placeholder="例: 2時間デモ"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={(e) => {
          setIsComposing(false);
          setDraft(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isComposing) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        className="border px-3 py-2 rounded-md text-sm flex-1 shadow-sm"
        aria-label="新しいコース名"
        autoComplete="off"
        autoCapitalize="none"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={`px-3 py-2 rounded-md text-sm shadow-sm active:scale-[.99] ${canSubmit ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
      >
        ＋追加
      </button>
    </div>
  );
});

type TaskColorSelectorProps = {
  value: string;
  onChange: (next: TaskColorValue) => void;
  ariaLabel?: string;
  compact?: boolean;
  id?: string;
};

const TaskColorSelector: FC<TaskColorSelectorProps> = ({ value, onChange, ariaLabel, compact = false, id }) => {
  const normalized = normalizeTaskColor(value);
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`h-6 w-6 rounded-full border border-gray-300 shadow-inner ${normalized}`}
        title="選択中の色"
      />
      <select
        id={id}
        value={normalized}
        onChange={(e) => onChange(normalizeTaskColor(e.currentTarget.value))}
        aria-label={ariaLabel ?? 'タスクの色'}
        className={`h-9 px-2 rounded-md border border-gray-300 bg-white text-sm shadow-sm ${compact ? 'min-w-[7.5rem]' : 'min-w-[9.5rem]'}`}
      >
        {TASK_COLOR_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};

type NewTaskFormProps = {
  onAdd: (label: string, offsetStart: number, offsetEnd: number, color: string) => boolean;
  allowColorSelection: boolean;
};

const NewTaskForm = memo(function NewTaskForm({ onAdd, allowColorSelection }: NewTaskFormProps) {
  const [draft, setDraft] = useState('');
  const [offset, setOffset] = useState(0);
  const [offsetEnd, setOffsetEnd] = useState(0);
  const [color, setColor] = useState<TaskColorValue>(DEFAULT_TASK_COLOR);
  const [isComposing, setIsComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const canSubmit = !!draft.trim() && !isComposing;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    const nextColor = allowColorSelection ? color : DEFAULT_TASK_COLOR;
    const ok = onAdd(draft, offset, offsetEnd, nextColor);
    if (!ok) return;
    setDraft('');
    setOffset(0);
    setOffsetEnd(0);
    setColor(DEFAULT_TASK_COLOR);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [allowColorSelection, canSubmit, draft, offset, offsetEnd, color, onAdd]);

  useEffect(() => {
    setOffsetEnd((prev) => Math.max(prev, offset));
  }, [offset]);

  const currentRangeLabel = formatTaskRange(offset, offsetEnd);

  const nameInput = (
    <input
      ref={inputRef}
      type="text"
      placeholder="例: ドリンク説明"
      value={draft}
      inputMode="text"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      autoComplete="off"
      lang="ja"
      onChange={(e) => setDraft(e.currentTarget.value)}
      onCompositionStart={() => setIsComposing(true)}
      onCompositionEnd={(e) => {
        setIsComposing(false);
        setDraft(e.currentTarget.value);
      }}
      className="w-full border px-3 py-2 rounded-md text-sm shadow-sm"
      aria-label="新規タスク名"
      enterKeyHint="done"
      onKeyDown={(e) => {
        const isComp = (e as any).nativeEvent?.isComposing;
        if (e.key === 'Enter' && !isComp && !isComposing) {
          e.preventDefault();
          submit();
        }
      }}
    />
  );

  const addButton = (
    <button
      type="button"
      onClick={submit}
      disabled={!canSubmit}
      className={`${allowColorSelection ? 'h-10' : 'h-9'} px-4 rounded-md text-sm transition active:scale-[.99] ${canSubmit ? 'bg-emerald-600 text-white shadow-sm' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
      title="タスクを追加"
    >
      追加
    </button>
  );

  if (allowColorSelection) {
    const startControl = (
      <div className="flex flex-col items-center gap-1">
        <span className="text-[11px] font-medium text-emerald-700">開始</span>
        <div className="inline-flex items-stretch rounded-md border border-emerald-300 bg-emerald-50/70 overflow-hidden" role="group" aria-label="開始時間">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              setOffset((prev) => {
                const next = clampTaskOffset(prev - 5);
                setOffsetEnd((endPrev) => Math.max(endPrev, next));
                return next;
              })
            }
            className="px-3 h-10 text-sm bg-white hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            aria-label="開始を5分早く"
          >
            -5
          </button>
          <div className="min-w-[80px] h-10 grid place-items-center px-2 text-sm font-semibold tabular-nums text-emerald-900">
            {formatTaskOffset(offset)}
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              setOffset((prev) => {
                const next = clampTaskOffset(prev + 5);
                setOffsetEnd((endPrev) => Math.max(endPrev, next));
                return next;
              })
            }
            className="px-3 h-10 text-sm bg-white hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            aria-label="開始を5分遅く"
          >
            +5
          </button>
        </div>
      </div>
    );

    const endControl = (
      <div className="flex flex-col items-center gap-1">
        <span className="text-[11px] font-medium text-emerald-700">終了</span>
        <div className="inline-flex items-stretch rounded-md border border-emerald-300 bg-emerald-50/70 overflow-hidden" role="group" aria-label="終了時間">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              setOffsetEnd((prev) => {
                const next = clampTaskOffset(prev - 5);
                return Math.max(next, offset);
              })
            }
            className="px-3 h-10 text-sm bg-white hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            aria-label="終了を5分早く"
          >
            -5
          </button>
          <div className="min-w-[80px] h-10 grid place-items-center px-2 text-sm font-semibold tabular-nums text-emerald-900">
            {formatTaskOffset(offsetEnd)}
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              setOffsetEnd((prev) => {
                const next = clampTaskOffset(prev + 5);
                return Math.max(next, offset);
              })
            }
            className="px-3 h-10 text-sm bg-white hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            aria-label="終了を5分遅く"
          >
            +5
          </button>
        </div>
      </div>
    );

    return (
      <div className="mt-3 flex flex-col gap-3">
        <div>{nameInput}</div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[18rem]">
            <div className="flex items-center gap-3">
              {startControl}
              {endControl}
            </div>
            <span className="text-xs text-gray-500 whitespace-nowrap">現在の範囲: {currentRangeLabel}</span>
          </div>
          <TaskColorSelector
            value={color}
            onChange={setColor}
            ariaLabel="新規タスクの色"
          />
          {addButton}
        </div>
      </div>
    );
  }

  const mobileStartControl = (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-emerald-700 text-center">開始</span>
      <div className="inline-flex w-full items-stretch rounded-md border border-emerald-300 bg-emerald-50/70 overflow-hidden" role="group" aria-label="開始時間（モバイル）">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            setOffset((prev) => {
              const next = clampTaskOffset(prev - 5);
              setOffsetEnd((endPrev) => Math.max(endPrev, next));
              return next;
            })
          }
          className="h-9 px-2 text-xs font-medium bg-white hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          aria-label="開始を5分早く"
        >
          -5
        </button>
        <div className="flex-1 min-w-[68px] h-9 grid place-items-center px-2 text-sm font-semibold tabular-nums text-emerald-900">
          {formatTaskOffset(offset)}
        </div>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            setOffset((prev) => {
              const next = clampTaskOffset(prev + 5);
              setOffsetEnd((endPrev) => Math.max(endPrev, next));
              return next;
            })
          }
          className="h-9 px-2 text-xs font-medium bg-white hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          aria-label="開始を5分遅く"
        >
          +5
        </button>
      </div>
    </div>
  );

  const mobileEndControl = (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-emerald-700 text-center">終了</span>
      <div className="inline-flex w-full items-stretch rounded-md border border-emerald-300 bg-emerald-50/70 overflow-hidden" role="group" aria-label="終了時間（モバイル）">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            setOffsetEnd((prev) => {
              const next = clampTaskOffset(prev - 5);
              return Math.max(next, offset);
            })
          }
          className="h-9 px-2 text-xs font-medium bg-white hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          aria-label="終了を5分早く"
        >
          -5
        </button>
        <div className="flex-1 min-w-[68px] h-9 grid place-items-center px-2 text-sm font-semibold tabular-nums text-emerald-900">
          {formatTaskOffset(offsetEnd)}
        </div>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            setOffsetEnd((prev) => {
              const next = clampTaskOffset(prev + 5);
              return Math.max(next, offset);
            })
          }
          className="h-9 px-2 text-xs font-medium bg-white hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          aria-label="終了を5分遅く"
        >
          +5
        </button>
      </div>
    </div>
  );

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div>{nameInput}</div>
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          {mobileStartControl}
          {mobileEndControl}
        </div>
        <span className="text-[11px] text-gray-500 text-center">現在の範囲: {currentRangeLabel}</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="flex-1 text-[11px] text-gray-500 leading-snug whitespace-nowrap">
          色の変更はタブレットからのみ行えます
        </span>
        {addButton}
      </div>
    </div>
  );
});

type NewPositionFormProps = {
  onAdd: (name: string) => boolean;
};

const NewPositionForm = memo(function NewPositionForm({ onAdd }: NewPositionFormProps) {
  const [draft, setDraft] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const canSubmit = !!draft.trim() && !isComposing;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    const ok = onAdd(draft);
    if (!ok) return;
    setDraft('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [canSubmit, draft, onAdd]);

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        placeholder="例: フロント"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={(e) => {
          setIsComposing(false);
          setDraft(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className="border px-3 py-2 rounded-md text-sm flex-1 shadow-sm"
        aria-label="新しいポジション名"
        autoComplete="off"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className={`px-3 py-2 rounded-md text-sm shadow-sm active:scale-[.99] ${canSubmit ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
      >
        ＋追加
      </button>
    </div>
  );
});

type NewAreaFormProps = {
  onAdd: (name: string) => boolean;
};

const NewAreaForm = memo(function NewAreaForm({ onAdd }: NewAreaFormProps) {
  const [draft, setDraft] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const canSubmit = !!draft.trim() && !isComposing;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    const ok = onAdd(draft);
    if (!ok) return;
    setDraft('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [canSubmit, draft, onAdd]);

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        placeholder="例: 1F / 2F / 個室"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={(e) => {
          setIsComposing(false);
          setDraft(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className="border px-3 py-2 rounded-md text-sm flex-1 shadow-sm"
        aria-label="新しいエリア名"
        autoComplete="off"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className={`px-3 py-2 rounded-md text-sm shadow-sm active:scale-[.99] ${canSubmit ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
      >
        ＋追加
      </button>
    </div>
  );
});

type EatDrinkOptionFormProps = {
  existing: EatDrinkOption[];
  onAdd: (raw: string, color: CourseColorKey | null) => boolean;
  placeholder: string;
  describedById: string;
};

type EatDrinkOptionRowProps = {
  option: EatDrinkOption;
  onRemove: (label: string) => void;
  onColorChange: (label: string, color: CourseColorKey | null) => void;
};

const EatDrinkOptionRow = memo(function EatDrinkOptionRow({
  option,
  onRemove,
  onColorChange,
}: EatDrinkOptionRowProps) {
  const colorKey = normalizeCourseColor(option.color);
  const hasCustomColor = Boolean(colorKey);
  const colorStyle = getCourseColorStyle(colorKey ?? null);
  const selectValue = colorKey ?? '';

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 shadow-sm">
      <span
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold shadow-sm"
        style={{
          backgroundColor: hasCustomColor ? colorStyle.background : '#ffffff',
          color: hasCustomColor ? colorStyle.text : '#1f2937',
          borderColor: hasCustomColor ? colorStyle.border : '#d1d5db',
        }}
      >
        <span
          aria-hidden="true"
          className="inline-block h-3 w-3 rounded-full border border-white/80 shadow-sm"
          style={{
            backgroundColor: hasCustomColor ? colorStyle.text : '#cbd5f5',
          }}
        />
        <span className="tabular-nums">{option.label}</span>
      </span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500">色</span>
        <select
          value={selectValue}
          onChange={(e) => onColorChange(option.label, e.currentTarget.value ? (e.currentTarget.value as CourseColorKey) : null)}
          aria-label={`${option.label} の色`}
          className="h-9 min-w-[7.5rem] rounded-md border border-gray-300 bg-white px-2 text-sm shadow-sm"
        >
          <option value="">標準</option>
          {COURSE_COLOR_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={() => onRemove(option.label)}
        className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600 text-sm font-semibold hover:bg-red-100 hover:text-red-700 active:scale-[.98]"
        aria-label={`${option.label} を削除`}
        title="削除"
      >
        ×
      </button>
    </div>
  );
});

const EatDrinkOptionForm = memo(function EatDrinkOptionForm({ existing, onAdd, placeholder, describedById }: EatDrinkOptionFormProps) {
  const [draft, setDraft] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [color, setColor] = useState<string>('');

  const candidate = takeGraphemes(normalizeTiny(draft), 2);
  const isDup = !!candidate && existing.some((opt) => normEq(opt.label, candidate));
  const canSubmit = !!candidate && !isDup && !isComposing;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    const normalizedColor = color ? (normalizeCourseColor(color) ?? null) : null;
    const ok = onAdd(draft, normalizedColor);
    if (!ok) return;
    setDraft('');
    setColor('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [canSubmit, draft, onAdd, color]);

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={(e) => {
            setIsComposing(false);
            setDraft(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className={`border px-3 py-2 w-24 rounded text-center shadow-sm text-sm ${isDup ? 'border-red-300 bg-red-50' : ''}`}
          aria-invalid={isDup}
          aria-describedby={describedById}
          autoComplete="off"
        />
        <select
          value={color}
          onChange={(e) => setColor(e.currentTarget.value)}
          className="h-9 min-w-[7rem] rounded-md border border-gray-300 bg-white px-2 text-sm shadow-sm"
          aria-label="追加するプランの色"
        >
          <option value="">標準</option>
          {COURSE_COLOR_OPTIONS.map((opt) => (
            <option key={`form-color-${opt.key}`} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className={`px-3 py-2 rounded-md text-sm active:scale-[.99] ${canSubmit ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
        >
          追加
        </button>
      </div>
      <p id={describedById} className={`mt-1 text-xs ${isDup ? 'text-red-600' : 'text-gray-500'}`}>
        {isDup ? 'この略称はすでに登録されています。' : 'Enter でも追加できます（2文字まで）。'}
      </p>
    </div>
  );
});
