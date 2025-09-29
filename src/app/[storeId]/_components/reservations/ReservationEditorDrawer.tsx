'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import type { CourseDef, StoreSettingsValue } from '@/types/settings';
import type { Reservation } from '@/types/reservation';
import { parseTimeToMinutes, formatMinutesToTime } from '@/lib/time';

/**
 * ReservationEditorDrawer
 * 右側ドロワーで予約の新規作成・編集を行う汎用コンポーネント。
 *
 * 使い方（例）:
 * <ReservationEditorDrawer
 *   open={drawerOpen}
 *   onClose={() => setDrawerOpen(false)}
 *   reservationId={editingId}
 *   initial={{ startMs, tables: [tableId], guests: 4 }}
 *   tablesOptions={allTableIds}
 *   coursesOptions={courses}
 *   dayStartMs={scheduleDayStartMs}
 *   onSave={async (input, id) => { await upsertReservation(input, id); }}
 *   onDelete={async (id) => { await deleteReservation(id); }}
 * />
 */

export type ReservationInput = {
  startMs: number;
  tables: string[];
  guests: number;
  name?: string;
  courseName?: string;
  drinkAllYouCan?: boolean;
  foodAllYouCan?: boolean;
  drinkLabel?: string;
  eatLabel?: string;
  memo?: string;
  durationMin?: number;
};

export type CourseOption = CourseDef;

type Props = {
  open: boolean;
  onClose: () => void;
  reservationId?: string | null;
  /** 新規作成 or 事前に埋めたいフィールド */
  initial?: Partial<ReservationInput> & { table?: string };
  /** 選択可能な卓一覧（未指定ならテキスト入力にフォールバック） */
  tablesOptions?: string[];
  /** 選択可能なコース一覧（未指定ならテキスト入力にフォールバック） */
  coursesOptions?: CourseOption[];
  /** 食べ放題プラン候補 */
  eatOptions?: string[];
  /** 飲み放題プラン候補 */
  drinkOptions?: string[];
  /** 店舗設定（コース統合用） */
  storeSettings?: StoreSettingsValue;
  /** スケジュール対象日の 00:00:00.000 (ローカル) 。未指定なら今日の 0:00 */
  dayStartMs?: number;
  /** 予約の最新スナップショット（タスク編集用に利用） */
  reservationDetail?: Reservation | null;
  /** タスク完了フラグの更新 */
  onUpdateReservationField?: (
    id: string,
    field: 'completed' | 'arrived' | 'paid' | 'departed',
    value: Record<string, boolean> | boolean
  ) => void;
  /** タスク単位の時間調整 */
  onAdjustTaskTime?: (id: string, label: string, delta: number) => void;
  /** 保存ハンドラ（親で Firestore I/O を実装）。返り値は新規作成時のID（任意） */
  onSave?: (data: ReservationInput, id?: string | null) => Promise<string | void>;
  /** 削除ハンドラ（編集時のみ表示） */
  onDelete?: (id: string) => Promise<void>;
  /** 現在の予約スナップショット（被り判定用） */
  reservationsSnapshot?: Array<{
    id?: string | null;
    startMs: number;
    endMs?: number;
    durationMin?: number;
    tables: string[];
    courseName?: string;
    name?: string;
  }>;
  /** デフォルト滞在分（コース未選択時のフォールバック）。未指定は60分 */
  defaultStayMinutes?: number;
};

const toStartOfDayLocal = (ms?: number) => {
  const d = ms ? new Date(ms) : new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

const msToTimeHHmm = (ms: number) => {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

function buildTimeOptions(): string[] {
  const out: string[] = [];
  for (let hour = 0; hour < 48; hour++) {
    for (let minute = 0; minute < 60; minute += 5) {
      out.push(`${String(hour).padStart(2, '0')}:${pad2(minute)}`);
    }
  }
  return out;
}

function timeToMinutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(':');
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

const hhmmToMsFromDay = (hhmm: string, dayStartMs: number) => {
  const [h, m] = hhmm.split(':').map((v) => parseInt(v, 10));
  return dayStartMs + (h * 60 + m) * 60 * 1000;
};


// ms → 'HH:mm'（ローカル）を day 基準で表示用に整形
const msToHHmmFromDay = (ms: number, _dayStartMs: number) => {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// --- text utils (runtime-safe) ---
const toText = (v: unknown): string => (typeof v === 'string' ? v : '');
const hasText = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;
const safeTrim = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const MINUTE_MS = 60 * 1000;

// 滞在分の候補（5分刻み）。既定は 30〜240分
const buildStayMinOptions = (min = 30, max = 240, step = 5) => {
  const out: number[] = [];
  for (let m = min; m <= max; m += step) out.push(m);
  return out;
};
const getCourseStayMin = (courseName?: string, courses?: CourseOption[], fallback?: number) => {
  const name = (courseName ?? '').trim();
  const list = Array.isArray(courses) ? (courses as any[]) : [];
  const fb = Number.isFinite(fallback) ? (fallback as number) : 60;
  if (!name) return fb;

  const pick = (c: any) => (
    c?.stayMinutes ?? c?.durationMin ?? c?.stayMin ?? c?.durationMinutes ?? c?.minutes ?? c?.lengthMin ?? c?.lengthMinutes ?? c?.duration ?? c?.stay
  );

  const strict = list.find((c: any) => {
    const v = String((c?.value ?? c?.name ?? c?.label ?? c?.title ?? '') || '').trim();
    return v === name;
  });
  let raw = pick(strict);
  if (raw == null) {
    const key = name.replace(/\s+/g, '').toLowerCase();
    const loose = list.find((c: any) => {
      const v = String((c?.value ?? c?.name ?? c?.label ?? c?.title ?? '') || '')
        .replace(/\s+/g, '')
        .toLowerCase();
      return v === key;
    });
    raw = pick(loose);
  }
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : fb;
};

const rangesOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  Math.max(aStart, bStart) < Math.min(aEnd, bEnd);

const computeEndMsFromInputs = (
  startMs: number,
  courseName: string | undefined,
  coursesOptions?: CourseOption[],
  fallbackMin?: number,
) => {
  const minutes = getCourseStayMin(courseName, coursesOptions, fallbackMin);
  return startMs + minutes * MINUTE_MS;
};

const computeEndMsForSnapshot = (
  snap: { startMs: number; endMs?: number; durationMin?: number; courseName?: string },
  coursesOptions?: CourseOption[],
  fallbackMin?: number,
) => {
  if (snap.endMs && Number.isFinite(snap.endMs)) return snap.endMs as number;
  if (snap.durationMin && Number.isFinite(snap.durationMin)) return snap.startMs + (snap.durationMin as number) * MINUTE_MS;
  return computeEndMsFromInputs(snap.startMs, snap.courseName, coursesOptions, fallbackMin);
};

export default function ReservationEditorDrawer(props: Props) {
  const {
    open,
    onClose,
    reservationId,
    initial,
    tablesOptions,
    coursesOptions,
    eatOptions: eatOptionsProp,
    drinkOptions: drinkOptionsProp,
    dayStartMs,
    reservationDetail,
    onUpdateReservationField,
    onAdjustTaskTime,
    onSave,
    onDelete,
    reservationsSnapshot,
    defaultStayMinutes,
    storeSettings,
  } = props;

  const day0 = React.useMemo(() => dayStartMs ?? toStartOfDayLocal(), [dayStartMs]);

  const [activeTab, setActiveTab] = React.useState<'reservation' | 'tasks'>('reservation');

  React.useEffect(() => {
    if (!open) return;
    setActiveTab('reservation');
  }, [open, reservationId]);

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);

  // Escape キーで閉じる
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // フォーカス制御 & スクロールロック
  const asideRef = React.useRef<HTMLElement | null>(null);
  const prevActiveRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!mounted) return;
    if (!open) return;

    // 直前のフォーカスを記録
    prevActiveRef.current = (document.activeElement as HTMLElement) ?? null;

    // body スクロールロック
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // 初期フォーカス（最初のフォーカス可能要素）
    setTimeout(() => {
      const root = asideRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(
        'input, select, textarea, button, [tabindex]:not([tabindex="-1"])'
      );
      first?.focus();
    }, 0);

    return () => {
      document.body.style.overflow = prevOverflow;
      // 元のフォーカスへ戻す
      prevActiveRef.current?.focus?.();
    };
  }, [mounted, open]);

  // --- Local form state ---
  const [time, setTime] = React.useState<string>(() =>
    initial?.startMs != null ? msToHHmmFromDay(initial.startMs, day0) : msToTimeHHmm(Date.now())
  );
  const [guests, setGuests] = React.useState<number>(initial?.guests ?? 2);
  const [name, setName] = React.useState<string>(initial?.name ?? '');
  const [courseName, setCourseName] = React.useState<string>(initial?.courseName ?? '');
  const [stayMinutes, setStayMinutes] = React.useState<number | null>(initial?.durationMin ?? null);
  const [drinkLabel, setDrinkLabel] = React.useState<string>(toText(initial?.drinkLabel));
  const [eatLabel,  setEatLabel]    = React.useState<string>(toText(initial?.eatLabel));
  const [memo, setMemo] = React.useState<string>(initial?.memo ?? '');
  const [tables, setTables] = React.useState<string[]>(() => {
    if (initial?.tables && initial.tables.length > 0) return initial.tables;
    if (initial?.table) return [initial.table];
    return [];
  });

  // --- mergedCourses: コース一覧（props, 店舗設定 統合、重複排除） ---
  const mergedCourses = React.useMemo<CourseOption[]>(() => {
    const out: CourseOption[] = [];
    const pushAll = (arr?: any[]) => {
      if (!Array.isArray(arr)) return;
      for (const c of arr) out.push(c as CourseOption);
    };
    // 1) props 2) 店舗設定 の順に結合
    pushAll(coursesOptions as any[]);
    pushAll((storeSettings as any)?.courses as any[]);

    // 重複排除（value/name/label/title を空白除去・小文字化）
    const seen = new Set<string>();
    const uniq: CourseOption[] = [];
    for (const c of out) {
      const key = String(((c as any).value ?? (c as any).name ?? (c as any).label ?? (c as any).title) ?? '')
        .replace(/\s+/g, '')
        .toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      uniq.push(c);
    }
    return uniq;
  }, [coursesOptions, storeSettings]);

  // --- mergedCoursesKey: 安定したキー生成（deps用） ---
  const mergedCoursesKey = React.useMemo(() => {
    if (!Array.isArray(mergedCourses) || mergedCourses.length === 0) return '';
    try {
      return mergedCourses
        .map((c: any) => {
          const name = String((c?.value ?? c?.name ?? c?.label ?? c?.title ?? '') || '').replace(/\s+/g, '').toLowerCase();
          const min = (c?.stayMinutes ?? c?.durationMin ?? c?.minutes ?? c?.lengthMin ?? '') as any;
          return `${name}:${Number.isFinite(Number(min)) ? Number(min) : ''}`;
        })
        .join('|');
    } catch {
      return String(mergedCourses.length);
    }
  }, [mergedCourses]);

  // コース変更時：前のコースで "自動" と同値だった場合は再び自動に戻して新コース規定を採用
  const prevCourseRef = React.useRef<string>(initial?.courseName ?? '');
  React.useEffect(() => {
    const prevCourse = prevCourseRef.current;
    // 前コース既定 or コース未選択時のフォールバック（defaultStayMinutes→未指定なら60）
    const fallback = Number.isFinite(defaultStayMinutes as number) ? (defaultStayMinutes as number) : 60;
    const prevAuto = hasText(prevCourse)
      ? getCourseStayMin(prevCourse, mergedCourses, fallback)
      : fallback;

    // 直前の値が「自動と同値」なら、コース変更時に自動へ戻す（＝新コース規定を採用）
    if (stayMinutes != null && stayMinutes === prevAuto) {
      setStayMinutes(null);
    }

    prevCourseRef.current = courseName || '';
  }, [courseName, mergedCoursesKey, defaultStayMinutes, stayMinutes, mergedCourses]);

  // --- Numeric pad (tables / guests 兼用) ---
  type PadTarget = 'tables' | 'guests';
  const [padTarget, setPadTarget] = React.useState<PadTarget | null>(null);
  const [padValue, setPadValue] = React.useState<string>('');
  const openPad = (target: PadTarget, initial?: string) => { setPadTarget(target); setPadValue(initial ?? ''); };
  const closePad = () => setPadTarget(null);
  const appendDigit = (d: string) => setPadValue((prev) => (prev + d).replace(/^0+(?=\d)/, ''));
  const clearPad = () => setPadValue('');
  const confirmPad = () => {
    const v = padValue.trim();
    if (!v) { closePad(); return; }
    if (padTarget === 'tables') {
      // 既知の卓のみ許可（tablesOptionsがある場合）
      if (tablesOptions && tablesOptions.length > 0) {
        if (!tablesOptions.includes(v)) {
          alert(`卓「${v}」は存在しません`);
          return;
        }
      }
      setTables((prev) => {
        const next = prev.includes(v) ? prev : [...prev, v];
        // options順で正規化
        return (tablesOptions && tablesOptions.length > 0)
          ? tablesOptions.filter((t) => next.includes(t))
          : next;
      });
    } else if (padTarget === 'guests') {
      const n = Math.max(1, parseInt(v, 10) || 0);
      setGuests(n);
    }
    closePad();
  };

  React.useEffect(() => {
    if (activeTab === 'reservation') return;
    if (padTarget) setPadTarget(null);
  }, [activeTab, padTarget]);

  const timeOptions = React.useMemo(() => buildTimeOptions(), []);
  const stayMinOptions = React.useMemo(() => buildStayMinOptions(30, 240, 5), []);
  const availableDrinkOptions = React.useMemo(() => (Array.isArray(drinkOptionsProp) ? drinkOptionsProp.map(String) : []), [drinkOptionsProp]);
  const availableEatOptions = React.useMemo(() => (Array.isArray(eatOptionsProp) ? eatOptionsProp.map(String) : []), [eatOptionsProp]);
  const normalizedTimeOptions = React.useMemo(() => {
    if (!time) return timeOptions;
    if (timeOptions.includes(time)) return timeOptions;
    const merged = [...timeOptions, time];
    merged.sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    return merged;
  }, [time, timeOptions]);

  const autoStayMinutes = React.useMemo(() => {
    const fallback = Number.isFinite(defaultStayMinutes as number) ? (defaultStayMinutes as number) : 60;
    const minutes = getCourseStayMin(courseName || initial?.courseName, mergedCourses, fallback);
    const numeric = Number.isFinite(minutes) ? Number(minutes) : fallback;
    return Math.max(5, numeric);
  }, [courseName, initial?.courseName, mergedCourses, defaultStayMinutes]);

  const selectedStayMinutes = stayMinutes != null && Number.isFinite(stayMinutes) && stayMinutes > 0
    ? Math.max(5, stayMinutes)
    : autoStayMinutes;

  const staySelectOptions = React.useMemo(() => {
    const set = new Set<number>(stayMinOptions);
    if (Number.isFinite(autoStayMinutes)) set.add(autoStayMinutes);
    return Array.from(set).sort((a, b) => a - b);
  }, [stayMinOptions, autoStayMinutes]);

  // reservationId が変わったら初期値を再読み込み（必要に応じて拡張）
  React.useEffect(() => {
    if (!open) return;
    // 既存の reservationId からのロードは、親側で initial を更新して渡す運用にします。
    // （ここでの fetch は行わない）
  }, [open, reservationId]);

  // --- Conflicts (同卓&時間重複) ---
  const [conflicts, setConflicts] = React.useState<typeof props.reservationsSnapshot>([]);

  React.useEffect(() => {
    if (!open) { setConflicts([]); return; }
    if (!reservationsSnapshot || reservationsSnapshot.length === 0) { setConflicts([]); return; }
    if (!tables || tables.length === 0) { setConflicts([]); return; }

    const start = hhmmToMsFromDay(time, day0);
    const stayMin = Math.max(5, selectedStayMinutes);
    const end = start + stayMin * MINUTE_MS;

    const selected = new Set(tables.map(String));

    const list = reservationsSnapshot.filter((r) => {
      if (reservationId && r.id === reservationId) return false; // 自分は除外
      const rEnd = computeEndMsForSnapshot(r, mergedCourses, defaultStayMinutes);
      const shared = (r.tables || []).some((t) => selected.has(String(t)));
      return shared && rangesOverlap(start, end, r.startMs, rEnd);
    });
    setConflicts(list);
  }, [open, reservationsSnapshot, tables, time, day0, reservationId, defaultStayMinutes, mergedCoursesKey, selectedStayMinutes, mergedCourses]);

  // --- Handlers ---
  const orderByOptions = React.useCallback((arr: string[]) => {
    if (!tablesOptions || tablesOptions.length === 0) return Array.from(new Set(arr));
    const set = new Set(arr);
    return tablesOptions.filter((t) => set.has(t));
  }, [tablesOptions]);

  const toggleTable = (t: string) => {
    setTables((prev) => {
      const next = prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t];
      return orderByOptions(next);
    });
  };

  const selectAllTables = () => {
    if (!tablesOptions) return;
    setTables(tablesOptions.slice());
  };

  const clearAllTables = () => setTables([]);

  // Drawerを開いたタイミングで initial からフォーム値をリセット（既存予約にも対応）
  React.useEffect(() => {
    if (!open) return;
    // time
    setTime(initial?.startMs != null ? msToHHmmFromDay(initial.startMs, day0) : msToTimeHHmm(Date.now()));
    // tables（optionsの順に正規化）
    const nextTables = (initial?.tables && initial.tables.length > 0)
      ? orderByOptions(initial.tables)
      : (initial?.table ? orderByOptions([initial.table]) : []);
    setTables(nextTables);
    // other fields
    setGuests(initial?.guests ?? 2);
    setName(initial?.name ?? '');
    setCourseName(initial?.courseName ?? '');
    setStayMinutes(initial?.durationMin ?? null);
    setDrinkLabel(
      hasText(initial?.drinkLabel)
        ? toText(initial?.drinkLabel)
        : (initial?.drinkAllYouCan ? (availableDrinkOptions[0] ?? '飲み放題') : '')
    );
    setEatLabel(
      hasText(initial?.eatLabel)
        ? toText(initial?.eatLabel)
        : (initial?.foodAllYouCan ? (availableEatOptions[0] ?? '食べ放題') : '')
    );
    setMemo(initial?.memo ?? '');
  }, [open, reservationId, initial?.startMs, initial?.tables, initial?.table, initial?.guests, initial?.name, initial?.courseName, initial?.durationMin, initial?.drinkAllYouCan, initial?.foodAllYouCan, initial?.drinkLabel, initial?.eatLabel, initial?.memo, day0, orderByOptions, availableDrinkOptions, availableEatOptions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedTables = (tables.length > 0 ? tables : (initial?.table ? [initial.table] : []));
    if (!selectedTables || selectedTables.length === 0) {
      alert('少なくとも1つの卓を選択してください');
      return;
    }
    if (!Number.isFinite(guests) || guests <= 0) {
      alert('人数を入力してください');
      return;
    }
    const defaultDrinkLabel = availableDrinkOptions[0] ?? '飲み放題';
    const defaultEatLabel = availableEatOptions[0] ?? '食べ放題';
    const drinkAllFinal = hasText(drinkLabel);
    const eatAllFinal   = hasText(eatLabel);
    const drinkLabelFinal = drinkAllFinal ? (safeTrim(drinkLabel) || defaultDrinkLabel) : '';
    const eatLabelFinal   = eatAllFinal   ? (safeTrim(eatLabel)   || defaultEatLabel)   : '';

    const durationForSave = stayMinutes != null ? Math.max(5, stayMinutes) : undefined;

    const input: ReservationInput = {
      startMs: hhmmToMsFromDay(time, day0),
      tables: selectedTables,
      guests: Number.isFinite(guests) ? guests : 0,
      name: name.trim() || undefined,
      courseName: courseName || undefined,
      drinkAllYouCan: drinkAllFinal,
      foodAllYouCan: eatAllFinal,
      drinkLabel: drinkLabelFinal,
      eatLabel: eatLabelFinal,
      memo: memo.trim() || undefined,
      durationMin: durationForSave,
    };

    try {
      if (onSave) {
        await onSave(input, reservationId ?? undefined);
      } else {
        console.warn('[ReservationEditorDrawer] onSave が未指定です');
      }
      onClose();
    } catch (err) {
      console.error(err);
      alert('保存に失敗しました');
    }
  };

  const handleDelete = async () => {
    if (!reservationId) return;
    if (!onDelete) return;
    if (!confirm('この予約を削除しますか？')) return;
    try {
      await onDelete(reservationId);
      onClose();
    } catch (err) {
      console.error(err);
      alert('削除に失敗しました');
    }
  };

  const canEditTasks = Boolean(
    reservationId &&
      reservationDetail &&
      typeof onUpdateReservationField === 'function' &&
      typeof onAdjustTaskTime === 'function'
  );

  const labelledById = activeTab === 'reservation' ? 'drawer-tab-reservation' : 'drawer-tab-tasks';
  const isReservationTab = activeTab === 'reservation';

  const triggerFormSubmit = React.useCallback(() => {
    const form = asideRef.current?.querySelector('form');
    if (!form) return;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, []);

  // --- UI ---
  const drawer = (
    <div
      aria-hidden={!open}
      className={[
        'fixed inset-0 z-[2000]',
        open ? 'pointer-events-auto' : 'pointer-events-none',
      ].join(' ')}
    >
      {/* 背景オーバーレイ */}
      <div
        className={[
          'absolute inset-0 bg-black/30 transition-opacity',
          open ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        onClick={onClose}
      />

      {/* 右側ドロワー */}
      <aside
        ref={asideRef}
        className={[
          'absolute right-0 top-0 h-full w-[min(90vw,420px)] bg-slate-50 shadow-xl',
          'transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
          'flex flex-col',
        ].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <button
              type="button"
              id="drawer-tab-reservation"
              onClick={() => setActiveTab('reservation')}
              aria-pressed={activeTab === 'reservation'}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold transition ${
                activeTab === 'reservation'
                  ? 'bg-white text-slate-900 shadow'
                  : 'bg-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {reservationId ? '予約を編集' : '予約を追加'}
            </button>
            <button
              type="button"
              id="drawer-tab-tasks"
              onClick={() => canEditTasks && setActiveTab('tasks')}
              aria-pressed={activeTab === 'tasks'}
              disabled={!canEditTasks}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold transition ${
                activeTab === 'tasks'
                  ? 'bg-white text-slate-900 shadow'
                  : 'bg-transparent text-slate-500 hover:text-slate-700'
              } ${!canEditTasks ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              タスク編集
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-gray-500 hover:text-gray-700"
            aria-label="閉じる"
          >
            ×
          </button>
        </header>

        {isReservationTab && conflicts && conflicts.length > 0 && (
          <div className="px-4 pt-3">
            <div className="rounded border border-amber-400 bg-amber-50 text-amber-900 px-3 py-2">
              <div className="font-medium">⚠️ 同じ卓で時間が重なっています（保存は可能）</div>
              <div className="text-xs mt-1">
                該当卓: {
                  Array.from(new Set(
                    conflicts.flatMap((c) => (c.tables || []).filter((t) => tables.includes(String(t))))
                  )).join(', ')
                } ／ 件数: {conflicts.length}
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {isReservationTab ? (
            <form onSubmit={handleSubmit} className="px-4 py-4 space-y-4">
              {/* 来店時間・人数・氏名（グループ） */}
          <div className="rounded-md border border-sky-200 bg-sky-50/70 p-3 space-y-3">
            <div className="mb-1 text-xs font-semibold text-sky-700">来店・人数・氏名</div>
            {/* 来店時間 + 人数（同一行） */}
            <div className="grid grid-cols-[auto_1fr_auto_5.75rem] items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap">来店時間</label>
              <select
                value={time}
                onChange={(e) => setTime(e.currentTarget.value)}
                className="min-w-0 w-full rounded border px-2 py-2"
                required
              >
                {normalizedTimeOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <label className="text-sm font-medium whitespace-nowrap text-right">人数</label>
              <input
                id="reservation-guests"
                name="guests"
                type="text"
                inputMode="numeric"
                pattern="\\d*"
                enterKeyHint="done"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                min={1}
                readOnly
                value={guests > 0 ? String(guests) : ''}
                onClick={() => openPad('guests', guests > 0 ? String(guests) : '')}
                onFocus={() => openPad('guests', guests > 0 ? String(guests) : '')}
                className="w-full rounded border px-2 py-2 text-[16px] text-right"
                required
                aria-label="人数"
                placeholder="例: 4"
              />
            </div>
            {/* 氏名 */}
            <div className="flex items-center gap-2 min-w-0">
              <label className="w-[7em] shrink-0 text-sm font-medium">氏名</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
                className="flex-1 min-w-0 rounded border px-3 py-2"
                placeholder="山田 太郎"
              />
            </div>
          </div>

          {/* コース・飲み/食べ放題（グループ） */}
          <div className="rounded-md border border-emerald-200 bg-emerald-50/70 p-3 space-y-3">
            <div className="mb-1 text-xs font-semibold text-emerald-700">コース・飲み放題・食べ放題</div>
            {/* コース */}
            <div className="flex items-center gap-2">
              <label className="w-[7em] shrink-0 text-sm font-medium">コース</label>
              {mergedCourses && mergedCourses.length > 0 ? (
                <select
                  className="flex-1 rounded border px-3 py-2"
                  value={courseName}
                  onChange={(e) => setCourseName(e.currentTarget.value)}
                >
                  <option value="">未選択</option>
                  {mergedCourses.map((c, idx) => {
                    const label = String((c as any).name ?? (c as any).label ?? (c as any).value ?? (c as any).title ?? '');
                    const val = label;
                    return <option key={`${idx}_${val}`} value={val}>{label}</option>;
                  })}
                </select>
              ) : (
                <input
                  type="text"
                  className="flex-1 rounded border px-3 py-2"
                  placeholder="コース名"
                  value={courseName}
                  onChange={(e) => setCourseName(e.currentTarget.value)}
                />
              )}
            </div>
            {/* 滞在時間（予約ごとに上書き可能） */}
            <div className="flex items-center gap-2">
              <label className="w-[7em] shrink-0 text-sm font-medium">滞在時間</label>
              <select
                className="w-[12rem] max-w-full rounded border px-3 py-2"
                value={String(selectedStayMinutes)}
                onChange={(e) => {
                  const n = parseInt(e.currentTarget.value, 10);
                  if (!Number.isFinite(n)) {
                    setStayMinutes(null);
                    return;
                  }
                  if (n === autoStayMinutes) {
                    setStayMinutes(null);
                  } else {
                    setStayMinutes(Math.max(5, n));
                  }
                }}
              >
                {staySelectOptions.map((m) => (
                  <option key={m} value={String(m)}>
                    {m}分{m === autoStayMinutes ? '（コース設定）' : ''}
                  </option>
                ))}
              </select>
            </div>
            {/* 飲み放題 / 食べ放題（同一行・コンパクト） */}
            <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-1.5">
              <label className="whitespace-nowrap w-[4.2em] text-sm font-medium">飲み放題</label>
              {availableDrinkOptions.length > 0 ? (
                <select
                  className="min-w-0 w-full rounded border px-2 py-1.5 text-[14px]"
                  value={drinkLabel}
                  onChange={(e) => setDrinkLabel(e.currentTarget.value)}
                >
                  <option value="">未選択</option>
                  {availableDrinkOptions.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  className="min-w-0 w-full rounded border px-2 py-1.5 text-[14px]"
                  placeholder="プラン名（空で未選択）"
                  value={drinkLabel}
                  onChange={(e) => setDrinkLabel(e.currentTarget.value)}
                />
              )}
              <label className="whitespace-nowrap w-[4.2em] text-sm font-medium text-right pr-1">食べ放題</label>
              {availableEatOptions.length > 0 ? (
                <select
                  className="min-w-0 w-full rounded border px-2 py-1.5 text-[14px]"
                  value={eatLabel}
                  onChange={(e) => setEatLabel(e.currentTarget.value)}
                >
                  <option value="">未選択</option>
                  {availableEatOptions.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  className="min-w-0 w-full rounded border px-2 py-1.5 text-[14px]"
                  placeholder="プラン名（空で未選択）"
                  value={eatLabel}
                  onChange={(e) => setEatLabel(e.currentTarget.value)}
                />
              )}
            </div>
          </div>

          {/* 卓（複数選択） */}
          <div className="rounded-md border border-violet-200 bg-violet-50/70 p-3">
            <div className="mb-2 text-xs font-semibold text-violet-700">卓（複数選択可）</div>
            <div className="flex items-center gap-2 mb-2">
              <button type="button" onClick={selectAllTables} className="text-xs px-2 py-1 border rounded">全選択</button>
              <button type="button" onClick={clearAllTables} className="text-xs px-2 py-1 border rounded">全解除</button>
            </div>
            {tablesOptions && tablesOptions.length > 0 ? (
              <div className="grid grid-cols-5 gap-2">
                {tablesOptions.map((t) => (
                  <label key={t} className="inline-flex items-center gap-2 border rounded px-2 py-1">
                    <input
                      type="checkbox"
                      checked={tables.includes(t)}
                      onChange={() => toggleTable(t)}
                    />
                    <span className="text-sm">{t}</span>
                  </label>
                ))}
              </div>
            ) : (
              <input
                type="text"
                className="w-full rounded border px-3 py-2"
                placeholder="カンマ区切りで入力（例: 1,2,3）"
                value={tables.join(',')}
                inputMode="numeric"
                pattern="[0-9,]*"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                onChange={(e) =>
                  setTables(
                    orderByOptions(
                      e.currentTarget.value
                        .split(',')
                        .map((v) => v.trim())
                        .filter(Boolean)
                    )
                  )
                }
              />
            )}
          </div>

          {/* 備考（グループ） */}
          <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3">
            <div className="mb-2 text-xs font-semibold text-amber-700">備考</div>
            <div className="flex items-center gap-2">
              <label className="w-[7em] shrink-0 text-sm font-medium">メモ</label>
              <textarea
                className="flex-1 rounded border px-3 py-2 min-h-[80px]"
                value={memo}
                onChange={(e) => setMemo(e.currentTarget.value)}
                placeholder="アレルギー、席希望など"
              />
            </div>
          </div>
            </form>
          ) : (
            <div className="px-4 py-4">
              {canEditTasks && reservationDetail ? (
                <ReservationTaskEditor
                  reservation={reservationDetail}
                  courses={coursesOptions}
                  onUpdateCompleted={onUpdateReservationField}
                  onAdjustTaskTime={onAdjustTaskTime}
                />
              ) : (
                <div className="rounded-md border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">
                  タスク編集は既存の予約で利用できます。保存済みの予約を開いてください。
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t flex items-center justify-between gap-3 bg-slate-50">
          {reservationId ? (
            <button
              type="button"
              onClick={handleDelete}
              className="text-red-600 hover:text-red-700 text-sm"
            >
              削除
            </button>
          ) : <span />}

          <div className="flex items-center gap-2">
            {isReservationTab ? (
              <>
                <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800">
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={triggerFormSubmit}
                  className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
                >
                  保存
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                閉じる
              </button>
            )}
          </div>
        </div>
      {/* Numeric Pad Overlay for Tables / Guests */}
      {padTarget && (
        <div
          className="absolute inset-0 z-[2100]"
          onClick={closePad}
          aria-modal="true"
          role="dialog"
          aria-label={padTarget === 'guests' ? '人数入力' : '卓番号入力'}
        >
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute left-0 right-0 bottom-0 bg-white shadow-2xl rounded-t-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-right text-2xl font-semibold mb-3">{padValue || ' '}</div>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => appendDigit('7')} className="py-3 border rounded">7</button>
              <button type="button" onClick={() => appendDigit('8')} className="py-3 border rounded">8</button>
              <button type="button" onClick={() => appendDigit('9')} className="py-3 border rounded">9</button>
              <button type="button" onClick={() => appendDigit('4')} className="py-3 border rounded">4</button>
              <button type="button" onClick={() => appendDigit('5')} className="py-3 border rounded">5</button>
              <button type="button" onClick={() => appendDigit('6')} className="py-3 border rounded">6</button>
              <button type="button" onClick={() => appendDigit('1')} className="py-3 border rounded">1</button>
              <button type="button" onClick={() => appendDigit('2')} className="py-3 border rounded">2</button>
              <button type="button" onClick={() => appendDigit('3')} className="py-3 border rounded">3</button>
              <button type="button" onClick={() => appendDigit('0')} className="py-3 border rounded col-span-2">0</button>
              <button type="button" onClick={clearPad} className="py-3 border rounded">C</button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={closePad} className="py-3 border rounded">キャンセル</button>
              <button type="button" onClick={confirmPad} className="py-3 rounded bg-blue-600 text-white">確定</button>
            </div>
          </div>
        </div>
      )}
      </aside>
    </div>
  );

  return mounted ? createPortal(drawer, document.body) : drawer;
}

type ReservationTaskEditorProps = {
  reservation: Reservation;
  courses?: CourseOption[];
  onUpdateCompleted?: (id: string, field: 'completed', value: Record<string, boolean>) => void;
  onAdjustTaskTime?: (id: string, label: string, delta: number) => void;
};

const SHIFT_OPTIONS = [-15, -10, -5, 5, 10, 15];

const shallowEqualRecord = (a: Record<string, any>, b: Record<string, any>) => {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
};

function ReservationTaskEditor({
  reservation,
  courses,
  onUpdateCompleted,
  onAdjustTaskTime,
}: ReservationTaskEditorProps) {
  const rawCourse = (reservation.course ?? (reservation as any).courseName ?? '').trim();
  const courseDef = rawCourse && Array.isArray(courses)
    ? courses.find((c) => c.name === rawCourse)
    : undefined;
  const tasks = Array.isArray(courseDef?.tasks) ? courseDef!.tasks : [];
  const baseMinutes = React.useMemo(() => {
    const baseStr = (reservation as any).timeHHmm ?? reservation.time ?? '';
    let mins = parseTimeToMinutes(baseStr);
    if ((!baseStr || mins === 0) && typeof (reservation as any).startMs === 'number') {
      const startMs = Number((reservation as any).startMs);
      const day0 = toStartOfDayLocal(startMs);
      mins = Math.round((startMs - day0) / 60000);
    }
    return mins;
  }, [reservation]);

  const [optimisticCompleted, setOptimisticCompleted] = React.useState<Record<string, boolean>>({});
  const [optimisticShift, setOptimisticShift] = React.useState<Record<string, number>>({});
  const [shiftMenuFor, setShiftMenuFor] = React.useState<string | null>(null);

  const completedMetaRef = React.useRef<{ id: string; version?: number } | null>(null);
  const shiftMetaRef = React.useRef<{ id: string; version?: number } | null>(null);

  React.useEffect(() => {
    const fromProps = reservation.completed ? { ...reservation.completed } : {};
    const version = reservation.version;
    const meta = completedMetaRef.current;
    const isNewReservation = !meta || meta.id !== reservation.id;
    const versionChanged = !isNewReservation && version !== undefined && version !== meta.version;
    if (isNewReservation || versionChanged) {
      completedMetaRef.current = { id: reservation.id, version };
      setOptimisticCompleted(fromProps);
    }
  }, [reservation.id, reservation.completed, reservation.version]);

  React.useEffect(() => {
    const fromProps = reservation.timeShift ? { ...reservation.timeShift } : {};
    const version = reservation.version;
    const meta = shiftMetaRef.current;
    const isNewReservation = !meta || meta.id !== reservation.id;
    const versionChanged = !isNewReservation && version !== undefined && version !== meta.version;
    if (isNewReservation || versionChanged) {
      shiftMetaRef.current = { id: reservation.id, version };
      setOptimisticShift(fromProps);
    }
  }, [reservation.id, reservation.timeShift, reservation.version]);

  const completedMap = optimisticCompleted;
  const shiftMap = optimisticShift;

  if (!rawCourse) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
        コースが未選択のため、編集できるタスクがありません。
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
        コース「{rawCourse}」にはタスクが設定されていません。
      </div>
    );
  }

  const handleToggle = (key: string, next: boolean) => {
    const updated = { ...optimisticCompleted, [key]: next };
    setOptimisticCompleted(updated);
    onUpdateCompleted?.(reservation.id, 'completed', updated);
  };

  const handleShift = (label: string, delta: number) => {
    const current = optimisticShift[label] ?? reservation.timeShift?.[label] ?? 0;
    const updated = { ...optimisticShift, [label]: current + delta };
    setOptimisticShift(updated);
    onAdjustTaskTime?.(reservation.id, label, delta);
  };

  type TaskEntry = {
    label: string;
    offset: number;
    bgColor?: string;
    shift: number;
    timeKey: string;
    compKey: string;
    done: boolean;
  };

  const entries: TaskEntry[] = tasks
    .map((task) => {
      const shift = Number(shiftMap?.[task.label] ?? 0);
      const absMin = baseMinutes + task.timeOffset + shift;
      const timeKey = formatMinutesToTime(absMin);
      const compKey = `${timeKey}_${task.label}_${rawCourse}`;
      const done = Boolean(completedMap?.[compKey]);
      return {
        label: task.label,
        offset: task.timeOffset,
        bgColor: task.bgColor,
        shift,
        timeKey,
        compKey,
        done,
      };
    })
    .sort((a, b) => a.offset - b.offset);

  const grouped = entries.reduce<Record<string, TaskEntry[]>>((acc, entry) => {
    if (!acc[entry.timeKey]) acc[entry.timeKey] = [];
    acc[entry.timeKey].push(entry);
    return acc;
  }, {});

  const sortedKeys = Object.keys(grouped).sort(
    (a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b)
  );

  const guestTotal = reservation.guests ?? 0;

  const tables = (() => {
    const arr = Array.isArray((reservation as any)?.tables)
      ? ((reservation as any).tables as string[])
      : undefined;
    if (arr && arr.length > 0) return arr.map(String);
    const single = (reservation as any)?.table;
    return single ? [String(single)] : [];
  })();

  return (
    <section className="space-y-4 text-sm">
      {sortedKeys.map((timeKey, idx) => {
        const list = grouped[timeKey] ?? [];
        const accent = list[0]?.bgColor ?? 'bg-gray-100/80';
        return (
          <div
            key={timeKey}
            className={`border-b pb-2 ${idx === sortedKeys.length - 1 ? 'border-b-0 pb-0' : ''}`}
          >
            <div className="text-gray-900 font-semibold text-lg mb-2">{timeKey}</div>
            <div className="space-y-2">
              {list.map((task) => {
                const shiftLabel = task.shift === 0 ? '調整なし' : `${task.shift > 0 ? '+' : ''}${task.shift}分`;
                const plannedTime = formatMinutesToTime(baseMinutes + task.offset);
                return (
                  <div key={task.compKey} className={`p-2 rounded mb-2 ${accent}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{task.label}</span>
                      <span className="text-xs text-gray-600">（計{guestTotal}人）</span>
                      <div className="ml-auto relative inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setShiftMenuFor(shiftMenuFor === task.compKey ? null : task.compKey)}
                          className="px-2 py-0.5 bg-gray-300 rounded text-xs"
                        >
                          時間変更
                        </button>
                        {shiftMenuFor === task.compKey && (
                          <div className="absolute right-0 top-full mt-1 z-20 bg-white border rounded shadow grid grid-cols-3 gap-1 p-1">
                            {SHIFT_OPTIONS.map((delta) => (
                              <button
                                key={delta}
                                type="button"
                                onClick={() => {
                                  handleShift(task.label, delta);
                                  setShiftMenuFor(null);
                                }}
                                className={`inline-flex items-center justify-center px-2 py-1 rounded text-xs border text-center whitespace-nowrap min-w-[3rem] leading-tight ${
                                  delta > 0
                                    ? 'bg-green-50 hover:bg-green-100 border-green-300 text-green-700'
                                    : 'bg-red-50 hover:bg-red-100 border-red-300 text-red-700'
                                }`}
                              >
                                {delta > 0 ? `＋${delta}` : `${delta}`}分
                              </button>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggle(task.compKey, !task.done)}
                          aria-pressed={task.done}
                          className={`px-2 py-0.5 rounded text-sm text-white ${
                            task.done ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-yellow-500 hover:bg-yellow-600'
                          }`}
                        >
                          完了
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <div
                        className={`border px-2 py-1 rounded text-sm ${task.done ? 'opacity-70 text-gray-600 line-through' : ''}`}
                        title={`予定 ${plannedTime} → 現在 ${task.timeKey}（${shiftLabel}）`}
                      >
                        {tables[0] ?? '-'}
                        <span className="ml-1 text-xs text-gray-600">({reservation.guests ?? 0})</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
