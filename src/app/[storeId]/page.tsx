'use client';

import { useState, useMemo, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { renameCourseTx } from '@/lib/courses';
import { db } from '@/lib/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { flushQueuedOps } from '@/lib/opsQueue';
// 📌 ChatGPT からのテスト編集: 拡張機能連携確認済み
// 📌 Policy: UI preview must NOT read/write r.pendingTable. Preview state lives only in pendingTables.

import type { StoreSettings, StoreSettingsValue } from '@/types/settings';
import {
  toUISettings,
  toFirestorePayload,
  sanitizeCourses as sanitizeStoreCourses,
  sanitizeStringList,
  sanitizeTables,
  toPositionNames,
  sanitizeTasksByPosition,
  sanitizeAreas,
} from '@/types/settings';
import {
  ensureServiceWorkerRegistered,
  requestPermissionAndGetToken,
  ensureFcmRegistered,
} from "@/lib/firebase-messaging";
import { useReservationsData } from '@/hooks/useReservationsData';
import { useRealtimeStoreSettings } from '@/hooks/useRealtimeStoreSettings';
import { toast } from 'react-hot-toast';

import { addReservationFS, updateReservationFS, deleteReservationFS, deleteAllReservationsFS } from '@/lib/reservations';

import LoadingSpinner from './_components/LoadingSpinner';
import ReservationsSection from './_components/ReservationsSection';
import CourseStartSection from './_components/CourseStartSection';
import type {
  ResOrder,
  Reservation,
  PendingTables,
  NumPadField,
  TaskDef,
  CourseDef,
  ReservationFieldKey,
  ReservationFieldValue,
} from '@/types';

import TasksSection from './_components/TasksSection';
import ScheduleView from './_components/schedule/ScheduleView'; // NOTE: render with storeSettings={settingsDraft}
import { parseTimeToMinutes, formatMinutesToTime, startOfDayMs } from '@/lib/time';
import StoreSettingsContent from "./_components/settings/StoreSettingsContent";
import PreopenSettingsContent from "./_components/preopen/PreopenSettingsContent";

import type { AreaDef } from '@/types';
import { useReservationMutations } from '@/hooks/useReservationMutations';
type BottomTab = 'reservations' | 'schedule' | 'tasks' | 'courseStart';

type NamespaceHelpers = {
  key: (suffix: string) => string;
  getJSON: <T,>(suffix: string, fallback: T) => T;
  setJSON: (suffix: string, val: unknown) => void;
  getStr: (suffix: string, fallback?: string) => string;
  setStr: (suffix: string, val: string) => void;
};

const createNamespaceHelpers = (ns: string): NamespaceHelpers => {
  const nsKey = (suffix: string) => `${ns}-${suffix}`;

  const readJSON = <T,>(key: string, fallback: T): T => {
    if (typeof window === 'undefined') return fallback;
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  };

  const writeJSON = (key: string, val: unknown) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      /* ignore */
    }
  };

  const getJSON = <T,>(suffix: string, fallback: T): T => readJSON(nsKey(suffix), fallback);
  const setJSON = (suffix: string, val: unknown) => writeJSON(nsKey(suffix), val);

  const getStr = (suffix: string, fallback = ''): string => {
    if (typeof window === 'undefined') return fallback;
    try {
      const value = localStorage.getItem(nsKey(suffix));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };

  const setStr = (suffix: string, val: string) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(nsKey(suffix), val);
    } catch {
      /* ignore */
    }
  };

  return { key: nsKey, getJSON, setJSON, getStr, setStr };
};

/** ラベル比較の正規化（前後空白 / 全角半角 / 大文字小文字の揺れを吸収） */
const normalizeLabel = (s: string): string =>
  (s ?? '')
    .replace(/\u3000/g, ' ')   // 全角空白→半角
    .trim()
    .normalize('NFKC')         // 全角英数・記号を半角へ
    .toLowerCase();            // 英字の大小差を無視（日本語への影響は無し）

const normEq = (a: string, b: string) => normalizeLabel(a) === normalizeLabel(b);

/** 配列用の正規化比較ユーティリティ */
const includesNorm = (arr: string[] | undefined, target: string) =>
  Array.isArray(arr) && arr.some((l) => normEq(l, target));

const addIfMissingNorm = (arr: string[], target: string) =>
  includesNorm(arr, target) ? arr : [...arr, target];

const removeIfExistsNorm = (arr: string[], target: string) =>
  arr.filter((l) => !normEq(l, target));

const cloneArray = <T,>(items?: readonly T[]): T[] => (Array.isArray(items) ? [...items] : []);

const sameArrayShallow = <T,>(a?: readonly T[], b?: readonly T[]) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const setArrayIfChanged = <T,>(prevArr: readonly T[] | undefined, nextArr: readonly T[] | undefined): T[] => {
  if (nextArr === undefined) return cloneArray(prevArr);
  return sameArrayShallow(prevArr, nextArr) ? cloneArray(prevArr) : [...nextArr];
};

//
// ───────────────────────────── ① TYPES ────────────────────────────────────────────


// 予約IDの次番号を計算（配列中の最大ID+1）。数値に変換できないIDは無視
const calcNextResIdFrom = (list: Array<{ id: string }>): string => {
  const maxId = list.reduce((max, item) => {
    const n = Number(item.id);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return String(maxId + 1);
};

// ───────── RootNumPad (multi-support for new reservation) ─────────
type RootNumPadSubmit = { value: string; list?: string[] };

type RootNumPadProps = {
  open: boolean;
  value?: string;
  initialList?: string[];
  /** 卓番号入力のとき true */
  multi?: boolean;
  onCancel: () => void;
  onSubmit: (result: RootNumPadSubmit) => void;
};

const RootNumPad = ({
  open,
  value = '',
  initialList = [],
  multi = false,
  onCancel,
  onSubmit,
}: RootNumPadProps) => {
  const [val, setVal] = useState<string>('');
  const [list, setList] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setVal(value || '');
    setList(multi ? (Array.isArray(initialList) ? [...initialList] : []) : []);
  }, [open, value, initialList, multi]);

  const appendDigit = (d: string) => setVal((prev) => (prev + d).replace(/^0+(?=\d)/, ''));
  const backspace = () => setVal((prev) => prev.slice(0, -1));
  const clearAll = () => setVal('');

  // 「＋ 追加」: 現在の val を list に確定（空/重複は無視）
  const pushCurrentToList = () => {
    if (!multi) return;
    const v = val.trim();
    if (!v) return;
    setList((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setVal('');
  };

  const handleSubmit = () => {
    if (!multi) {
      onSubmit({ value: val });
      return;
    }
    let final = list;
    const v = val.trim();
    if (v) final = final.includes(v) ? final : [...final, v];
    onSubmit({ value: v, list: final.filter(Boolean) });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/30">
      <div className="w-full sm:w-[420px] bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-4">
        {/* プレビュー（新規は“後の卓”だけを大きく表示：○.○卓） */}
        <div className="mb-2">
          {multi ? (
            <div className="ml-auto max-w-full tabular-nums text-right bg-gray-100 border border-gray-200 rounded px-3 py-1.5">
              {(() => {
                const after = Array.isArray(list) ? [...list] : [];
                const v = (val || '').trim();
                if (v && !after.includes(v)) after.push(v);
                const joined = after.join('.');
                return joined ? (
                  <span className="font-bold text-lg md:text-xl text-gray-900">
                    {joined}
                    <span className="ml-0.5">卓</span>
                  </span>
                ) : (
                  <span className="text-gray-400 text-lg md:text-xl">—</span>
                );
              })()}
            </div>
          ) : (
            <div className="ml-auto text-right text-3xl font-semibold tabular-nums">{val || '0'}</div>
          )}
        </div>

        {multi && (
          <div className="flex flex-wrap gap-2 mb-2">
            {list.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300"
              >
                <span className="tabular-nums">{t}</span>
                <button
                  type="button"
                  onClick={() => setList((prev) => prev.filter((x) => x !== t))}
                  className="leading-none px-1 hover:text-amber-900"
                  aria-label={`${t} を削除`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* キーパッド（4列：左3列＝数字/記号、右1列＝＋追加・決定） */}
        <div className="grid grid-cols-4 grid-rows-4 gap-2 items-stretch mt-2">
          {/* 1行目（7 8 9） */}
          <button type="button" className="py-3 rounded border bg-gray-50 hover:bg-gray-100 text-xl font-semibold" onClick={() => appendDigit('7')}>7</button>
          <button type="button" className="py-3 rounded border bg-gray-50 hover:bg-gray-100 text-xl font-semibold" onClick={() => appendDigit('8')}>8</button>
          <button type="button" className="py-3 rounded border bg-gray-50 hover:bg-gray-100 text-xl font-semibold" onClick={() => appendDigit('9')}>9</button>

          {/* 右列（卓追加／確定） */}
          {multi ? (
            <div className="col-start-4 row-start-1 row-span-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={pushCurrentToList}
                className="h-1/3 rounded bg-amber-400 hover:bg-amber-500 text-white font-semibold text-sm"
                title="卓追加"
                aria-label="卓追加"
              >
                卓追加
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                className="h-2/3 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold text-xl"
                title="確定"
                aria-label="確定"
              >
                確定
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              className="col-start-4 row-start-1 row-span-4 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold text-xl h-full"
              title="確定"
              aria-label="確定"
            >
              確定
            </button>
          )}

          {/* 2行目（4 5 6） */}
          <button type="button" className="py-3 rounded border bg-gray-50 hover:bg-gray-100 text-xl font-semibold" onClick={() => appendDigit('4')}>4</button>
          <button type="button" className="py-3 rounded border bg-gray-50 hover:bg-gray-100 text-xl font-semibold" onClick={() => appendDigit('5')}>5</button>
          <button type="button" className="py-3 rounded border bg-gray-50 hover:bg-gray-100 text-xl font-semibold" onClick={() => appendDigit('6')}>6</button>

          {/* 3行目（1 2 3） */}
          <button type="button" className="py-3 rounded border bg-gray-50 hover:bg-gray-100 text-xl font-semibold" onClick={() => appendDigit('1')}>1</button>
          <button type="button" className="py-3 rounded border bg-gray-50 hover:bg-gray-100 text-xl font-semibold" onClick={() => appendDigit('2')}>2</button>
          <button type="button" className="py-3 rounded border bg-gray-50 hover:bg-gray-100 text-xl font-semibold" onClick={() => appendDigit('3')}>3</button>

          {/* 4行目（0 ← C） */}
          <button type="button" className="py-3 rounded border bg-gray-50 hover:bg-gray-100 text-xl font-semibold" onClick={() => appendDigit('0')}>0</button>
          <button type="button" className="py-3 rounded border bg-gray-50 hover:bg-gray-100 text-xl font-semibold" onClick={backspace}>←</button>
          <button type="button" className="py-3 rounded border bg-gray-50 hover:bg-gray-100 text-xl font-semibold" onClick={clearAll}>C</button>
        </div>

        {/* キャンセル */}
        <div className="mt-3">
          <button
            type="button"
            onClick={onCancel}
            className="w-full py-2 rounded bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
};
// ─────────────────────────────────────────────────────────────
//
// ───────────────────────────── ② MAIN コンポーネント ─────────────────────────────────
//

// ───────────────────────────── Hydration Gate (wrapper) ─────────────────────────────
export default function Home() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  if (!hydrated) {
    return (
      <main className="p-4" suppressHydrationWarning>
        <LoadingSpinner />
      </main>
    );
  }
  return <HomeBody />;
}
// ────────────────────────────────────────────────────────────────────────────────────

function HomeBody() {
  // ── Bottom tabs: 予約リスト / タスク表 / コース開始時間表 / スケジュール
const [bottomTab, setBottomTab] = useState<BottomTab>('reservations');

  // ---- schedule tab routing helpers (layout.tsx が ?tab=schedule を見て表示を切替) ----
  const router = useRouter();
  const search = useSearchParams();


  const clearScheduleTab = useCallback(() => {
    try {
      const q = new URLSearchParams(search?.toString() ?? undefined);
      q.delete('tab');
      const s = q.toString();
      router.push(s ? `?${s}` : '.', { scroll: false });
    } catch {
      router.push('.', { scroll: false });
    }
  }, [router, search]);

  // URLの `?tab=` と bottomTab を同期（schedule を含む）
  useEffect(() => {
    try {
      const t = search?.get('tab');
      if (t === 'reservations' || t === 'tasks' || t === 'courseStart' || t === 'schedule') {
        setBottomTab(t as BottomTab);
      }
    } catch {
      // noop
    }
  }, [search]);


  // サイドメニューの選択状態（既存の既定値はそのまま）
  const [selectedMenu, setSelectedMenu] = useState<string>('予約リスト×タスク表');
  // 「店舗設定画面 / 営業前設定」時だけ main を隠すためのフラグ
  const isSettings =
    selectedMenu === '店舗設定画面' || selectedMenu === '営業前設定';
  // メイン画面へ戻す
  const goMain = () => setSelectedMenu('予約リスト×タスク表');
  // 下部タブを押したとき：設定画面ならメインに戻してからタブ切替
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (isSettings) return;
    if (bottomTab !== 'schedule') return;

    const scrollEl = () => {
      const target = document.scrollingElement || document.documentElement;
      if (target) {
        target.scrollTop = 0;
      }
      window.scrollTo({ top: 0, behavior: 'auto' });
    };

    const cleanup: Array<() => void> = [];

    scrollEl();

    const rafId = requestAnimationFrame(scrollEl);
    cleanup.push(() => cancelAnimationFrame(rafId));

    [60, 180, 360, 720].forEach((ms) => {
      const id = window.setTimeout(scrollEl, ms);
      cleanup.push(() => clearTimeout(id));
    });

    return () => {
      cleanup.forEach((fn) => fn());
    };
  }, [bottomTab, isSettings]);
  const handleBottomTabClick = (tab: BottomTab) => {
    setBottomTab(tab);
    if (isSettings) {
      goMain(); // 設定画面を閉じてメインへ
    }
    // 他タブに移動したら ?tab=schedule を外す（layout.tsx が表示を切替）
    clearScheduleTab();
  };

  // ── 店舗設定（分割UI）用のドラフト状態（子コンポーネントに丸ごと渡す）
  const [settingsDraft, setSettingsDraft] = useState<StoreSettingsValue>({
    courses: [],
    positions: [],
    tables: [],
    plans: [],
    areas: [],
  });
  // Firestore の “直近保存済み” スナップショット（dirty 判定用）
const [baselineSettings, setBaselineSettings] =
  useState<StoreSettingsValue | null>(null);
  const patchSettings = useCallback(
    (patch: Partial<StoreSettingsValue>) => {
      // 1) Draft は従来通り、参照安定化しつつ更新
      setSettingsDraft((prev) => {
        let next: StoreSettingsValue = { ...prev };
        if ('courses' in patch)   next.courses   = setArrayIfChanged<CourseDef>(prev.courses, patch.courses);
        if ('positions' in patch) next.positions = setArrayIfChanged<string>(prev.positions, patch.positions);
        if ('tables' in patch)    next.tables    = setArrayIfChanged<string>(prev.tables, patch.tables);
        if ('plans' in patch)     next.plans     = setArrayIfChanged<string>(prev.plans, patch.plans);
        // --- sanitize areas: block empty-name areas from being added/updated ---
        if ('areas' in patch) {
          const src = Array.isArray(patch.areas) ? patch.areas : [];
          const filtered: AreaDef[] = src.filter((a: AreaDef) => {
            const nm = typeof a?.name === 'string' ? a.name.trim() : '';
            return nm.length > 0;
          });
          next.areas = setArrayIfChanged<AreaDef>(prev.areas, filtered);
        }
        const {
          courses: _courses,
          positions: _positions,
          tables: _tables,
          plans: _plans,
          areas: _areas,
          ...rest
        } = patch;
        next = { ...next, ...rest };
        return next;
      });

      // 2) 親のライブ state も同時に更新（※差分があるときのみ）
      if ('courses' in patch) {
        const next = Array.isArray(patch.courses) ? (patch.courses as CourseDef[]) : [];
        setCourses((prev) => (sameArrayShallow(prev, next) ? prev : [...next]));
      }
      if ('positions' in patch) {
        const next = Array.isArray(patch.positions) ? (patch.positions as string[]) : [];
        setPositions((prev) => (sameArrayShallow(prev, next) ? prev : [...next]));
      }
      if ('tables' in patch) {
        const next = Array.isArray(patch.tables) ? (patch.tables as string[]) : [];
        setPresetTables((prev) => (sameArrayShallow(prev, next) ? prev : [...next]));
      }
      if ('tasksByPosition' in patch) {
        const next = patch.tasksByPosition ?? {};
        setTasksByPosition((prev) => {
          try {
            return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
          } catch {
            return next;
          }
        });
      }
      if ('eatOptions' in patch) {
        const next = Array.isArray(patch.eatOptions) ? (patch.eatOptions as string[]) : [];
        setEatOptions((prev) => (sameArrayShallow(prev, next) ? prev : [...next]));
      }
      if ('drinkOptions' in patch) {
        const next = Array.isArray(patch.drinkOptions) ? (patch.drinkOptions as string[]) : [];
        setDrinkOptions((prev) => (sameArrayShallow(prev, next) ? prev : [...next]));
      }
    },
    []
  );

  // === Courses state (declared early to avoid TDZ in callbacks/effects) ===
  const [courses, setCourses] = useState<CourseDef[]>([]);

  // NOTE:
  // フックの呼び出し順序を崩さないため、早期 return は行わない。
  // 設定画面は最終の JSX で条件分岐して描画する（例: {isSettings ? renderSettingsContent : mainUI}）。
  // 店舗設定画面のときはメインUIを描かず、設定UIのみを表示
  // URL から店舗IDを取得
  const params = useParams();
  const storeId = params?.storeId;
  // 読み込み前はフォールバック
  const id = typeof storeId === 'string' ? storeId : 'default';
  // Day-start baseline (ms): derived from settingsDraft.schedule.dayStartHour; fallback 15:00
  const dayStartMs = useMemo(() => {
    const startHour =
      typeof settingsDraft?.schedule?.dayStartHour === 'number'
        ? settingsDraft.schedule.dayStartHour
        : 15;
    const now = new Date();
    const d0 = new Date(now);
    d0.setHours(startHour, 0, 0, 0);
    return d0.getTime();
  }, [settingsDraft]);

  // Display window for Schedule (parent decides; child does not hardcode)
  const scheduleStartHour = useMemo(() => {
    const h = Number((settingsDraft as any)?.schedule?.dayStartHour);
    return Number.isFinite(h) ? h : 10; // fallback 10:00
  }, [settingsDraft]);

  const scheduleEndHour = useMemo(() => {
    const h = Number((settingsDraft as any)?.schedule?.dayEndHour);
    return Number.isFinite(h) ? h : 23; // fallback 23:00
  }, [settingsDraft]);

const {
  createReservation: createReservationMut,
  updateReservation: updateReservationMut,
  deleteReservation: deleteReservationMut,
} = useReservationMutations(id as string, { dayStartMs });

  // 名前空間付き localStorage キー定義
  const ns = useMemo(() => `front-kun-${id}`, [id]);
  const { key: nsKey, getJSON: nsGetJSON, setJSON: nsSetJSON, getStr: nsGetStr, setStr: nsSetStr } = useMemo(
    () => createNamespaceHelpers(ns),
    [ns]
  );
  const RES_KEY = `${ns}-reservations`;
  const CACHE_KEY = `${ns}-reservations_cache`;

  // --- (optional) one-time migration from old localStorage keys -------------
  const migrateLegacyKeys = useCallback(() => {
    if (typeof window === 'undefined') return;

    const moves: Array<{ oldKey: string; newKey: string }> = [
      // reservations cache (global → namespaced)
      { oldKey: 'reservations', newKey: nsKey('reservations') },
      { oldKey: 'reservations_cache', newKey: nsKey('reservations_cache') },

      // settings
      { oldKey: 'courses', newKey: nsKey('courses') },
      { oldKey: 'positions', newKey: nsKey('positions') },
      { oldKey: 'tasksByPosition', newKey: nsKey('tasksByPosition') },
      { oldKey: 'courseByPosition', newKey: nsKey('courseByPosition') },
      { oldKey: 'presetTables', newKey: nsKey('presetTables') },
      { oldKey: 'eatOptions', newKey: nsKey('eatOptions') },
      { oldKey: 'drinkOptions', newKey: nsKey('drinkOptions') },
      { oldKey: 'settings-cache', newKey: nsKey('settings-cache') },

      // UI prefs
      { oldKey: 'checkedTables', newKey: nsKey('checkedTables') },
      { oldKey: 'checkedTasks', newKey: nsKey('checkedTasks') },
      { oldKey: 'selectedCourse', newKey: nsKey('selectedCourse') },
      { oldKey: 'selectedDisplayPosition', newKey: nsKey('selectedDisplayPosition') },
      { oldKey: 'resOrder', newKey: nsKey('resOrder') },
      { oldKey: 'showEatCol', newKey: nsKey('showEatCol') },
      { oldKey: 'showDrinkCol', newKey: nsKey('showDrinkCol') },
      { oldKey: 'mergeSameTasks', newKey: nsKey('mergeSameTasks') },
      { oldKey: 'showCourseAll', newKey: nsKey('showCourseAll') },
      { oldKey: 'showGuestsAll', newKey: nsKey('showGuestsAll') },
      { oldKey: 'deviceId', newKey: nsKey('deviceId') },
    ];

    for (const { oldKey, newKey } of moves) {
      try {
        const existingNew = localStorage.getItem(newKey);
        if (existingNew !== null) continue; // already migrated for this namespace
        const val = localStorage.getItem(oldKey);
        if (val === null) continue;
        localStorage.setItem(newKey, val);
        // Optionally remove the legacy key so it won't conflict in the future
        // (Only remove truly global keys to avoid impacting other namespaces/projects)
        localStorage.removeItem(oldKey);
      } catch {/* ignore */}
    }

    // --- Tab-scoped UI prefs migration (namespaced → tasks_/cs_ ) -----------------
    try {
      const pairs: Array<{ from: string; to: string }> = [
        // Tasks tab
        { from: nsKey('showCourseAll'),        to: nsKey('tasks_showCourseAll') },
        { from: nsKey('showGuestsAll'),        to: nsKey('tasks_showGuestsAll') },
        { from: nsKey('mergeSameTasks'),       to: nsKey('tasks_mergeSameTasks') },
        // Course Start tab
        { from: nsKey('showTableStart'),       to: nsKey('cs_showTableStart') },
        { from: nsKey('courseStartFiltered'),  to: nsKey('cs_courseStartFiltered') },
        // Reservations tab (namespaced → res_*)
        { from: nsKey('showEatCol'),       to: nsKey('res_showEatCol') },
        { from: nsKey('showDrinkCol'),     to: nsKey('res_showDrinkCol') },
        { from: nsKey('showNameCol'),      to: nsKey('res_showNameCol') },
        { from: nsKey('showNotesCol'),     to: nsKey('res_showNotesCol') },
        { from: nsKey('showGuestsCol'),    to: nsKey('res_showGuestsCol') },
        { from: nsKey('resOrder'),         to: nsKey('res_resOrder') },
      ];

      for (const { from, to } of pairs) {
        const toVal = localStorage.getItem(to);
        if (toVal !== null) continue; // already migrated
        const fromVal = localStorage.getItem(from);
        if (fromVal === null) continue;
        localStorage.setItem(to, fromVal);
        // keep old key for backward safety or uncomment to remove:
        // localStorage.removeItem(from);
      }
    } catch {/* ignore */}
    // -----------------------------------------------------------------------------
  }, [nsKey]);

  // run once on mount
  useEffect(() => {
    migrateLegacyKeys();
  }, [migrateLegacyKeys]);

  // --- helper: normalize/sanitize courses payload (unknown -> CourseDef[]) ---
  const sanitizeCourses = useCallback((arr: unknown): CourseDef[] => {
    const normalized = sanitizeStoreCourses(arr);
    if (!Array.isArray(normalized)) return [];

    return normalized.map((course) => {
      const tasks: TaskDef[] = Array.isArray(course?.tasks)
        ? (course.tasks as any[])
            .map((t) => ({
              timeOffset: Number.isFinite(Number(t?.timeOffset)) ? Number(t.timeOffset) : 0,
              label: typeof t?.label === 'string' ? t.label : '',
              bgColor: typeof t?.bgColor === 'string' ? t.bgColor : 'bg-gray-100/80',
            }))
            .filter((task: TaskDef) => task.label !== '')
            .sort((a, b) => a.timeOffset - b.timeOffset)
        : [];

      const stayMinutesRaw = Number((course as any)?.stayMinutes);
      const stayMinutes = Number.isFinite(stayMinutesRaw) && stayMinutesRaw > 0 ? Math.trunc(stayMinutesRaw) : undefined;

      return {
        name: course.name,
        stayMinutes,
        tasks,
      } satisfies CourseDef;
    });
  }, []);

// --- defensive accessor: always return an array for c.tasks ---
const getTasks = (c: { tasks?: any }): { timeOffset:number; label:string; bgColor:string }[] =>
  (Array.isArray(c?.tasks) ? (c.tasks as { timeOffset:number; label:string; bgColor:string }[]) : []);
  
  // Reservation storage helpers (namespace-scoped)
  const persistReservations = useCallback((arr: Reservation[]) => {
    nsSetJSON('reservations', arr);
  }, [nsSetJSON]);
  // Keep both RES_KEY and CACHE_KEY synchronized in one place
  const writeReservationsCache = useCallback((arr: Reservation[]) => {
    try {
      const json = JSON.stringify(arr);
      localStorage.setItem(CACHE_KEY, json);
      localStorage.setItem(RES_KEY, json);
    } catch {
      /* ignore */
    }
  }, [CACHE_KEY, RES_KEY]);
  // -------------------------------------------------------------------------
  // Sidebar open state
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  // 卓番変更モード用のステートを追加
  const [editTableMode, setEditTableMode] = useState<boolean>(false);

  // 店舗設定（eatOptions / drinkOptions / positions …）をリアルタイム購読
  const {
    value: serverSettings,
    areas,
    tableToAreas,
    save: saveSettings,
    loading: settingsLoading,
    isSaving: isSavingSettings,
  } = useRealtimeStoreSettings(id as string);
  // Reflect Firestore realtime settings into UI draft (overwrite on arrival/updates)
  useEffect(() => {
    try {
      if (!serverSettings || Object.keys(serverSettings as any).length === 0) return;
      const ui = toUISettings(serverSettings as StoreSettings) as any;
      setSettingsDraft(prev => ({
        ...prev,
        ...ui,
        areas: Array.isArray((serverSettings as any).areas)
          ? (serverSettings as any).areas
          : (prev.areas ?? []),
      }));
      setBaselineSettings(prev => ({
        ...(prev ?? {}),
        ...ui,
        areas: Array.isArray((serverSettings as any).areas)
          ? (serverSettings as any).areas
          : ((prev as any)?.areas ?? []),
      }) as StoreSettingsValue);
    } catch (e) {
      console.warn('[settings] toUISettings failed:', e);
    }
  }, [serverSettings]);
  //
  // ───────── 食・飲 オプション ─────────
  //
const [eatOptions, setEatOptions] = useState<string[]>(
  () => nsGetJSON<string[]>('eatOptions', ['⭐︎', '⭐︎⭐︎'])
);
const [drinkOptions, setDrinkOptions] = useState<string[]>(
  () => nsGetJSON<string[]>('drinkOptions', ['スタ', 'プレ'])
);
// 保存用のuseEffect
useEffect(() => {
  nsSetJSON('eatOptions', eatOptions);
}, [eatOptions, nsSetJSON]);

useEffect(() => {
  nsSetJSON('drinkOptions', drinkOptions);
}, [drinkOptions, nsSetJSON]);


  // ─── 2.2 予約(来店) の状態管理（統合フック） ────────────────────────────
  const {
    reservations,
    initialized: reservationsInitialized,
    setReservations,
    error: reservationsError,
    scheduleItems, // ← 追加：スケジュール用アイテム
  } = useReservationsData(id as string, { dayStartMs }); // pass dayStartMs to ensure absolute-ms mapping

  // ── Early loading guard ───────────────────────────────
  const loading = settingsLoading === true;
  const [nextResId, setNextResId] = useState<string>("1");
  // --- keep nextResId monotonic & unique relative to current reservations ---
  useEffect(() => {
    const maxId = reservations.reduce((m, r) => {
      const n = Number(r.id);
      return Number.isFinite(n) ? (n > m ? n : m) : m;
    }, 0);
    const desired = String(maxId + 1);
    if (!nextResId || !Number.isFinite(Number(nextResId)) || Number(nextResId) <= maxId) {
      setNextResId(desired);
    }
  }, [reservations]);
  // 予約ID → { old, next } を保持（卓番変更プレビュー用）
const [pendingTables, setPendingTables] = useState<PendingTables>({});



  // ─── (先読み) localStorage の settings キャッシュをロード ─────────────
  useEffect(() => {
    if (!settingsLoading) return; // Firestore 読み込み完了後は不要
    try {
      const cache = nsGetJSON<{ cachedAt: number; data: Partial<StoreSettings> }>(
        'settings-cache',
        { cachedAt: 0, data: {} }
      );
      const cached = cache.data;
      if (!cached || Object.keys(cached).length === 0) return;

      // 最低限 eat/drinkOptions / positions / tasksByPosition を復元
      const cachedEat = sanitizeStringList(cached.eatOptions);
      setEatOptions(cachedEat);
      const cachedDrink = sanitizeStringList(cached.drinkOptions);
      setDrinkOptions(cachedDrink);
      const cachedPositions = toPositionNames(cached.positions);
      if (cachedPositions.length > 0) setPositions(cachedPositions);
      const cachedTasks = sanitizeTasksByPosition(cached.tasksByPosition);
      if (cachedTasks) setTasksByPosition(cachedTasks);

      // courses（空配列では上書きしない）
      const cachedCourses = sanitizeCourses(cached.courses);
      if (cachedCourses.length > 0) {
        setCourses(cachedCourses);
        nsSetJSON('courses', cachedCourses);
      } else {
        console.log('[settings-cache] skip empty courses');
      }
    } catch (err) {
      console.warn('SETTINGS_CACHE read failed', err);
    }
  }, [settingsLoading, nsGetJSON, nsSetJSON, sanitizeCourses]);

  // ─── Firestore からの店舗設定を UI State へ反映 ─────────────────
  useEffect(() => {
    if (settingsLoading || !serverSettings) return; // まだ取得前
    // ① 既存キャッシュの timestamp を取得（無ければ 0）
    // ② Firestore データの更新時刻を取得（無ければ 0）
    const rawUpdatedAt: any = (serverSettings as any).updatedAt ?? 0;
    const fsUpdated =
      typeof rawUpdatedAt === 'object' && rawUpdatedAt && typeof rawUpdatedAt.toMillis === 'function'
        ? rawUpdatedAt.toMillis()
        : (typeof rawUpdatedAt === 'number' ? rawUpdatedAt : 0);
    // ③ Firestore を常に真実として反映（キャッシュ新しさによるスキップを撤廃）
    // ④ Firestore を優先して UI & localStorage を更新
    const eatOpts = sanitizeStringList(serverSettings.eatOptions);
    setEatOptions(eatOpts);
    nsSetJSON('eatOptions', eatOpts);

    const drinkOpts = sanitizeStringList(serverSettings.drinkOptions);
    setDrinkOptions(drinkOpts);
    nsSetJSON('drinkOptions', drinkOpts);

    const normalizedCourses = sanitizeCourses(serverSettings.courses);
    setCourses(normalizedCourses);
    nsSetJSON('courses', normalizedCourses);

    const tableList = sanitizeTables(serverSettings.tables);
    setPresetTables(tableList);
    nsSetJSON('presetTables', tableList);

    const posNames = toPositionNames(serverSettings.positions);
    setPositions(posNames);
    nsSetJSON('positions', posNames);

    const tasksByPos = sanitizeTasksByPosition(serverSettings.tasksByPosition) ?? {};
    setTasksByPosition(tasksByPos);
    nsSetJSON('tasksByPosition', tasksByPos);

    const cachePayload: Partial<StoreSettings> = {
      courses: normalizedCourses,
      positions: posNames,
      tables: tableList,
      eatOptions: eatOpts,
      drinkOptions: drinkOpts,
      tasksByPosition: Object.keys(tasksByPos).length > 0 ? tasksByPos : undefined,
      updatedAt: fsUpdated,
    };

    // ⑤ キャッシュ更新
    nsSetJSON('settings-cache', { cachedAt: Date.now(), data: cachePayload });
  }, [serverSettings, settingsLoading, nsSetJSON, sanitizeCourses, sanitizeStringList, sanitizeTables, toPositionNames, sanitizeTasksByPosition]);

// ── Areas: normalize + local table→areas map (derived from settingsDraft.areas) ──
const usableAreas: AreaDef[] = useMemo<AreaDef[]>(() => {
  return sanitizeAreas(settingsDraft?.areas);
}, [settingsDraft?.areas]);

// usableAreas から “卓番号 → 含まれるエリアID[]” を作る
const tableToAreasLocal = useMemo(() => {
  const map: Record<string, string[]> = {};
  for (const a of usableAreas) {
    const aid = a.id;
    const list = Array.isArray(a.tables) ? a.tables : [];
    for (const t of list) {
      const key = String(t);
      if (!map[key]) map[key] = [];
      if (!map[key].includes(aid)) map[key].push(aid);
    }
  }
  return map;
}, [usableAreas]);


  // (Firestore 初回 1 read → localStorage キャッシュ: 統合フックにより削除)
  // ─── オンライン復帰時にキュー flush + 再取得 ───
  useEffect(() => {
    const flush = async () => {
      try {
        await flushQueuedOps();
        // 以降のデータ同期はリアルタイム購読フックに任せる
      } catch {
        /* noop */
      }
    };
    window.addEventListener('online', flush);
    flush(); // マウント時にも一度
    return () => window.removeEventListener('online', flush);
  }, []);
  const hasLoadedStore = useRef(false); // 店舗設定を 1 回だけ取得
  // ---- field updater (hoisted before use) ----
const updateReservationField = useCallback(async (
  id: string,
  field: ReservationFieldKey,
  value: ReservationFieldValue,
) => {
  // ⏱ 時刻変更は startMs と同時更新（当日0:00基準で安全に計算）
  if (field === 'time') {
    const hhmm = String(value).trim();
    const mins = parseTimeToMinutes(hhmm);          // '20:00' -> 1200
    const base0 = startOfDayMs(dayStartMs);         // 当日の 0:00（ローカル）
    const newStartMs = base0 + mins * 60_000;

    // ① ローカル状態を楽観更新（表示を即時反映）
    setReservations((prev) => {
      const next = prev.map((r) =>
        r.id === id ? { ...r, time: hhmm, startMs: newStartMs } : r
      );
      persistReservations(next);
      writeReservationsCache(next);
      return next;
    });

    // ② Firestore へも time と startMs を同時に保存（ミューテーション経由）
    try {
      await updateReservationMut(id, { time: hhmm, startMs: newStartMs });
    } catch {
      /* noop */
    }
    return; // 他の汎用分岐を通さない
  }
  setReservations((prev) => {
    const next = prev.map((r) => {
      if (r.id !== id) return r;

      if (field === 'guests') {
        return { ...r, guests: Number(value) };
      } else if (field === 'course') {
        const oldCourse = r.course;
        const newCourse = value as string;
        const migratedCompleted: Record<string, boolean> = {};
        Object.entries(r.completed || {}).forEach(([key, done]) => {
          if (key.endsWith(`_${oldCourse}`)) {
            const newKey = key.replace(new RegExp(`_${oldCourse}$`), `_${newCourse}`);
            migratedCompleted[newKey] = done;
          } else {
            migratedCompleted[key] = done;
          }
        });
        return { ...r, course: newCourse, completed: migratedCompleted };
      } else if (field === 'completed') {
        return { ...r, completed: value as Record<string, boolean> };
      } else if (field === 'arrived') {
        return { ...r, arrived: Boolean(value) };
      } else if (field === 'paid') {
        return { ...r, paid: Boolean(value) };
      } else if (field === 'departed') {
        return { ...r, departed: Boolean(value) };
      } else if (field === 'table') {
        return { ...r, table: String(value) };
      } else if (field === 'tables') {
        return { ...r, tables: Array.isArray(value) ? value.slice() : [] };
      } else if (field === 'eat' || field === 'drink' || field === 'name' || field === 'notes' || field === 'date' || field === 'eatLabel' || field === 'drinkLabel') {
        return { ...r, [field]: typeof value === 'string' ? value : '' } as Reservation;
      } else if (field === 'foodAllYouCan' || field === 'drinkAllYouCan') {
        return { ...r, [field]: Boolean(value) } as Reservation;
      } else {
        return { ...r, [field]: value } as Reservation;
      }
    });

    persistReservations(next);
    writeReservationsCache(next);
    return next;
  });

  // Firestore 側も更新（オフライン時は SDK がキュー）
  try {
    updateReservationFS(id, { [field]: value });
  } catch {
    /* noop */
  }
}, [dayStartMs, persistReservations, writeReservationsCache, updateReservationMut]);
/* ─────────────── 卓番変更用 ─────────────── */
const [tablesForMove, setTablesForMove] = useState<string[]>([]); // 変更対象
// 現在入力中の “変更後卓番号”
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: Edit Table Mode の OFF は **commitTableMoves** が唯一の責務。
// 子コンポーネントや他の処理からは onToggleEditTableMode() を呼ばないこと。
// （ユーザー手操作の ON/OFF は onToggleEditTableMode でのみ実行）
// ─────────────────────────────────────────────────────────────────────────────
// 変更確定処理 (async, 親がモードOFFを司る) — override を受け取れるように拡張
const commitTableMoves = useCallback(async (override?: PendingTables): Promise<void> => {
  // コミット対象は override があればそれ、なければ state
  const source = override ?? pendingTables;
  const entries = Object.entries(source);
  if (entries.length === 0) return;

  // --- コンフリクト検知：同じ primary(= nextList[0]) が 2 件以上ある場合は中止 ---
  const primaryTargets: string[] = entries.map(([_, pt]) => {
    const list = Array.isArray(pt?.nextList) ? pt.nextList : [];
    const primary = (list[0] ?? pt?.old ?? '');
    return String(primary || '').trim();
  }).filter(Boolean);

  const counts: Record<string, number> = {};
  for (const t of primaryTargets) counts[t] = (counts[t] || 0) + 1;
  const dupTarget = Object.keys(counts).find(k => counts[k] > 1);
  if (dupTarget) {
    toast.error(`同じ卓番号「${dupTarget}」に複数の予約を割り当てようとしています。対象を確認してください。`);
    return;
  }

  // --- 実更新：table と tables を同時に反映（バックエンド & ローカル） ---
  for (const [idStr, pt] of entries) {
    const nextList = Array.isArray(pt?.nextList) ? pt.nextList.map(String) : [];
    const primary = (nextList[0] ?? pt?.old ?? '');
    const primaryStr = String(primary || '');

    if (primaryStr) {
      updateReservationField(idStr, 'table', primaryStr);
    }
    if (nextList.length > 0) {
      updateReservationField(idStr, 'tables', nextList);
    } else if (primaryStr) {
      updateReservationField(idStr, 'tables', [primaryStr]);
    }
  }

  // --- 後片付け（ここだけが唯一のOFF） ---
  setPendingTables({});
  setTablesForMove([]);
  try { setNumPadState(null as any); } catch {/* optional */}
  setEditTableMode(false);

  toast.success('卓番号の変更を反映しました');
}, [pendingTables, updateReservationField]);
// 選択トグル用ユーティリティ
const toggleTableForMove = useCallback((id: string) => {
  setTablesForMove(prev =>
    prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
  );
}, []);

　/* ──────────────────────────────── */
  // 店舗設定タブを初めて開いたときのみ Firestore を 1 read（※統合フックに置換のため停止）
  useEffect(() => {
    if (selectedMenu === '店舗設定画面' && !hasLoadedStore.current) {
      console.info('[page] skip loadStoreSettings() → useRealtimeStoreSettings に統一');
      hasLoadedStore.current = true; // フラグだけ立てる
    }
  }, [selectedMenu]);

  // === Reservations: edited marks (persist across tab switches) ===

  // === Reservations: edited marks (persist across tab switches) ===
const [editedMarks, setEditedMarks] = useState<Record<string, number>>(
  () => nsGetJSON<Record<string, number>>('res_editedMarks', {})
);
useEffect(() => {
  nsSetJSON('res_editedMarks', editedMarks);
}, [editedMarks]);
  // ----------------------------------------------------------------------
  // ─────────────── 追加: コントロールバー用 state ───────────────
  // Tasks tab control center (namespaced)
  const [showCourseAll, setShowCourseAll] = useState<boolean>(() =>
    nsGetStr('tasks_showCourseAll', '1') === '1'
  );
  const [showGuestsAll, setShowGuestsAll] = useState<boolean>(() =>
    nsGetStr('tasks_showGuestsAll', '1') === '1'
  );
  const [mergeSameTasks, setMergeSameTasks] = useState<boolean>(() =>
    nsGetStr('tasks_mergeSameTasks', '0') === '1'
  );

  // Course Start tab settings (namespaced)
  const [showTableStart, setShowTableStart] = useState<boolean>(() => nsGetStr('cs_showTableStart', '1') === '1');
  const [courseStartFiltered, setCourseStartFiltered] = useState<boolean>(() => nsGetStr('cs_courseStartFiltered', '1') === '1');

  // Course Start tab – sort order (persisted)
const [csStartSort, setCsStartSort] = useState<'table' | 'guests'>(() => {
  const v = nsGetStr('cs_startSort', 'table');
  return v === 'guests' ? 'guests' : 'table';
});
useEffect(() => {
  if (typeof window !== 'undefined') nsSetStr('cs_startSort', csStartSort);
}, [csStartSort]);
  useEffect(() => {
    if (typeof window !== 'undefined') nsSetStr('cs_showTableStart', showTableStart ? '1' : '0');
  }, [showTableStart]);

  useEffect(() => {
    if (typeof window !== 'undefined') nsSetStr('cs_courseStartFiltered', courseStartFiltered ? '1' : '0');
  }, [courseStartFiltered]);
  // Tasks tab – sort order (persisted)
  const [taskSort, setTaskSort] = useState<'table' | 'guests'>(() => {
    const v = nsGetStr('tasks_taskSort', 'table');
    return v === 'guests' ? 'guests' : 'table';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') nsSetStr('tasks_taskSort', taskSort);
  }, [taskSort]);

  // Tasks tab – area filter (replaces old "filterCourse")
  const [filterArea, setFilterArea] = useState<string>(() =>
    nsGetStr('tasks_filterArea', '全て')
  );
  useEffect(() => {
    if (typeof window !== 'undefined') nsSetStr('tasks_filterArea', filterArea);
  }, [filterArea]);
  // --- Course Start tab–only: show guests toggle (independent from Tasks tab) ---
const [csShowGuestsAll, setCsShowGuestsAll] = useState<boolean>(() => nsGetStr('cs_showGuestsAll', '1') === '1');

useEffect(() => {
  if (typeof window !== 'undefined') nsSetStr('cs_showGuestsAll', csShowGuestsAll ? '1' : '0');
}, [csShowGuestsAll]);

  // --- タブ別：コース絞り込み（Tasks / CourseStart） ---
  const [tasksFilterCourse, setTasksFilterCourse] = useState<string>(
    () => nsGetStr('tasks_filterCourse', '全体')
  );
  useEffect(() => {
    if (typeof window !== 'undefined') nsSetStr('tasks_filterCourse', tasksFilterCourse);
  }, [tasksFilterCourse]);

  const [csFilterCourse, setCsFilterCourse] = useState<string>(
    () => nsGetStr('cs_filterCourse', '全体')
  );
  useEffect(() => {
    if (typeof window !== 'undefined') nsSetStr('cs_filterCourse', csFilterCourse);
  }, [csFilterCourse]);



  // ▼ Control Center toggles — persist to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      nsSetStr('tasks_showCourseAll', showCourseAll ? '1' : '0');
    }
  }, [showCourseAll]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      nsSetStr('tasks_showGuestsAll', showGuestsAll ? '1' : '0');
    }
  }, [showGuestsAll]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      nsSetStr('tasks_mergeSameTasks', mergeSameTasks ? '1' : '0');
    }
  }, [mergeSameTasks]);

  // タスク選択モード状態
  const [selectionModeTask, setSelectionModeTask] = useState<string | null>(null);
  const [selectedForComplete, setSelectedForComplete] = useState<string[]>([]);
  // --- タスク時間調整モード ------------------------------
  // shiftModeKey: `${timeKey}_${taskLabel}` が入る。null はモードオフ
  const [shiftModeKey, setShiftModeKey] = useState<string | null>(null);
  // shiftTargets: 時間シフトをかける reservation.id 配列
  const [shiftTargets, setShiftTargets] = useState<string[]>([]);
  // 分移動 UI で選択中の分（例：-15, -10, -5, 5, 10, 15）。未選択は null
  const [selectedShiftMinutes, setSelectedShiftMinutes] = useState<number | null>(null);
  // 一括時間調整（将来サーバ側バッチに差し替えやすい薄いラッパー）
const batchAdjustTaskTime = (
  ids: Array<number | string>,
  taskLabel: string,
  delta: number
) => {
  for (const id of ids) {
    // id は number / string 両対応
    // 既存の単体関数に順番に投げる（将来ここをまとめAPIに差し替え）
    // @ts-ignore
    adjustTaskTime(id as any, taskLabel, delta);
  }
};



  // 来店チェック用 state
  //

  /** デバイスID（ローカル一意）を取得・生成 */
  const getDeviceId = (): string => {
    if (typeof window === 'undefined') return 'server';
    let v = nsGetStr('deviceId', '');
    if (!v) {
      v = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
      nsSetStr('deviceId', v);
    }
    return v;
  };

  /** 当日キー（YYYY-MM-DD） */
  const todayKey = (): string => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  /** 送信済み dedupeKey をローカルに蓄積（当日分のみ保持） */
  const markSent = (k: string) => {
    if (typeof window === 'undefined') return;
    const storageKey = `${ns}-sentKeys-${todayKey()}`;
    const raw = localStorage.getItem(storageKey);
    const set = new Set<string>(raw ? JSON.parse(raw) : []);
    set.add(k);
    localStorage.setItem(storageKey, JSON.stringify(Array.from(set)));
  };
  const hasSent = (k: string): boolean => {
    if (typeof window === 'undefined') return false;
    const storageKey = `${ns}-sentKeys-${todayKey()}`;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return false;
    const set = new Set<string>(JSON.parse(raw));
    return set.has(k);
  };

  /** taskEvents へ書き込む（失敗は握りつぶし） */
  const sendTaskEvent = async (payload: {
    storeId: string;
    reservationId: string;
    table: string;
    course: string;
    taskLabel: string;
    timeKey: string; // "HH:MM"
    date: string;    // "YYYY-MM-DD"
    dedupeKey: string;
    deviceId: string;
  }) => {
    try {
      await addDoc(collection(db, 'taskEvents'), {
        ...payload,
        createdAt: serverTimestamp(),
      } as any);
    } catch (e) {
      // オフライン時は SDK の内部キューに乗らないため、失敗しても何もしない
      // Functions 側の onCreate を前提にしているため、ここでは再試行せずログのみ
      console.warn('[taskEvents] addDoc failed (ignored):', e);
    }
  };
  /** コースのオフセット + 個別 timeShift を考慮した絶対分 */
  const calcTaskAbsMin = (
    base: string,
    offset: number,
    label: string,
    shift?: Record<string, number>
  ): number => {
    return parseTimeToMinutes(base) + offset + (shift?.[label] ?? 0);
  };

  const [checkedArrivals, setCheckedArrivals] = useState<string[]>([]);
  const [checkedDepartures, setCheckedDepartures] = useState<string[]>([]);
  // 会計チェック用 state
const [checkedPayments, setCheckedPayments] = useState<string[]>([]);

  // 🔽 reservations が更新されたら arrive / paid / departed のチェック配列を同期
  useEffect(() => {
    const toUniqueSorted = (arr: string[]) =>
      Array.from(new Set(arr)).sort((a, b) => Number(a) - Number(b));

    setCheckedArrivals(
      toUniqueSorted(reservations.filter(r => r.arrived).map(r => r.id))
    );
    setCheckedPayments(
      toUniqueSorted(reservations.filter(r => r.paid).map(r => r.id))
    );
    setCheckedDepartures(
      toUniqueSorted(reservations.filter(r => r.departed).map(r => r.id))
    );
  }, [reservations]);

const togglePaymentChecked = useCallback((id: string) => {
  setCheckedPayments(prev => {
    const paidNow = !prev.includes(id);
    updateReservationField(id, 'paid', paidNow);
    return paidNow ? [...prev, id] : prev.filter(x => x !== id);
  });
}, [updateReservationField]);

  // 来店チェック切り替え用ヘルパー
  const toggleArrivalChecked = useCallback((id: string) => {
    setCheckedArrivals(prev => {
      const arrivedNow = !prev.includes(id);
      updateReservationField(id, 'arrived', arrivedNow);
      return arrivedNow ? [...prev, id] : prev.filter(x => x !== id);
    });
  }, [updateReservationField]);
  // 退店チェック切り替え用ヘルパー
  const toggleDepartureChecked = useCallback((id: string) => {
    setCheckedDepartures(prev => {
      const departedNow = !prev.includes(id);
      updateReservationField(id, 'departed', departedNow);
      if (departedNow) {
        // arrived を同時に false へ
        updateReservationField(id, 'arrived', false);
        setCheckedArrivals(arr => arr.filter(x => x !== id)); // 到着解除
        return [...prev, id];
      } else {
        return prev.filter(x => x !== id);
      }
    });
  }, [updateReservationField]);

  // ---- 子コンポーネント用の安定ラッパ関数（インライン関数を避ける） ----
  // ★ ラッパーが常に最新の関数を呼ぶように、最新参照を保持
  // addReservation はこの下の方で宣言されるため、初期値は null にしておき、
  // エフェクト内で常に最新の参照を保存する
  const addReservationRef = useRef<((e: FormEvent) => Promise<void>) | null>(null);
  useEffect(() => {
    // 依存配列なし：レンダー後に最新の関数を格納（宣言順の制約を回避）
    addReservationRef.current = addReservationV2;
  });

  // deleteReservation も後方で宣言されるため、初期値は null にしておく
  const deleteReservationRef = useRef<((id: string) => void) | null>(null);
  useEffect(() => {
    deleteReservationRef.current = deleteReservation;
  });

  const updateReservationFieldRef = useRef(updateReservationField);
  useEffect(() => { updateReservationFieldRef.current = updateReservationField; }, [updateReservationField]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
// ※依存配列を空にしているためLint警告を無効化（安全に使える想定）
/**
 * ユーザー手操作専用のトグル。
 * - プログラム側（適用など）からは呼ばないこと。
 * - OFF 遷移時のみ、未適用プレビュー（pendingTables / tablesForMove）を破棄。
 * - reservations は確定処理以外で書き換えないため、pendingTable は互換目的で undefined に揃えるのみ。
 */
const onToggleEditTableMode = useCallback(() => {
  setEditTableMode(prev => {
    const next = !prev;
    // モードOFFに遷移する時は未適用プレビューを破棄（reservations 自体は書き換えない）
    if (!next) {
      setPendingTables({});
      setTablesForMove([]);
      // 互換目的：UIでは使っていないが、残っている可能性のある pendingTable は明示的に消しておく
      try {
        setReservations(prevRes => prevRes.map(r => ({ ...r, pendingTable: undefined })));
      } catch {/* noop */}
      // NumPadのクローズは子で管理しているため、ここでは行わない
    }
    return next;
  });
}, []);

  // 予約追加（子に渡す用）: 必ず Promise を返す
  const addReservationCb = useCallback((e: FormEvent) => {
    return addReservationRef.current ? addReservationRef.current(e) : Promise.resolve();
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  // ※依存配列を空にしているためLint警告を無効化（安全に使える想定）
  const deleteReservationCb = useCallback((id: string) => {
    deleteReservationRef.current?.(id);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  // ※依存配列を空にしているためLint警告を無効化（安全に使える想定）
  // ReservationsSection が使う拡張キーも受け取れるように型を拡張
const updateReservationFieldCb = useCallback((
  id: string,
  field:
    | 'time' | 'course' | 'eat' | 'drink' | 'guests' | 'name' | 'notes' | 'date' | 'table'
    | 'completed' | 'arrived' | 'paid' | 'departed'
    | 'eatLabel' | 'drinkLabel' | 'foodAllYouCan' | 'drinkAllYouCan',
  value: any,
) => {
  updateReservationFieldRef.current(id, field as any, value);
}, []);
  // ─── 予約追加 ──────────────────────────────
  const addReservationV2 = async (e: FormEvent) => {
    e.preventDefault();

    // --- 時刻 → 分 → 絶対ms（当日の 0:00 基準で安全に計算） ---
    const mins = parseTimeToMinutes(newResTime);
    const base0 = startOfDayMs(dayStartMs);
    const startMs = base0 + mins * 60_000;

    // --- コース名の解決（入力→選択中→先頭コース→未選択） ---
    const inputCourse = String(newResCourse ?? '').trim();
    const selectedCourseLabel = String(selectedCourse ?? '').trim();
    const firstCourseLabel =
      Array.isArray(courses) && courses[0]?.name ? String(courses[0].name).trim() : '';
    const courseLabel = inputCourse || selectedCourseLabel || firstCourseLabel || '未選択';

    // --- guests / table / tables を正規化 ---
    const guestsNum = Math.trunc(Number(newResGuests) || 0);
    const tableStr = String(newResTable ?? '');
    const tablesArr = Array.isArray(newResTables) && newResTables.length > 0
      ? newResTables.map(String)
      : (tableStr ? [tableStr] : []);

    // Firestore には必ず number(ms) の startMs を保存
    await createReservationMut({
      startMs,
      time: newResTime,
      table: tableStr,
      tables: tablesArr,
      guests: guestsNum,
      name: newResName,
      course: courseLabel,          // UI と表示用
      courseName: courseLabel,      // 後方互換（集計側が参照する場合あり）
      eat: newResEat,
      drink: newResDrink,
      notes: newResNotes,
    } as any);

    // 入力クリア（任意）
    setNewResTable('');
    setNewResTables([]);
    setNewResName('');
    setNewResCourse('未選択');
    setNewResEat('');
    setNewResDrink('');
    setNewResGuests('' as any);
    setNewResNotes('');
  };
  // ─── 2.1 コース・タスクの定義・状態管理 ─────────────────────────────────────
  //

  const defaultCourses: CourseDef[] = [
    {
      name: 'スタンダード',
      tasks: [
        { timeOffset: 0,   label: 'コース説明',     bgColor: 'bg-gray-100/80' },
        { timeOffset: 45,  label: 'カレー',         bgColor: 'bg-orange-200/80' },
        { timeOffset: 60,  label: 'リクエスト',     bgColor: 'bg-blue-200/80' },
        { timeOffset: 90,  label: 'ラストオーダー', bgColor: 'bg-pink-200/80' },
        { timeOffset: 120, label: '退席',           bgColor: 'bg-gray-200/80' },
      ],
    },
    {
      name: 'ランチ',
      tasks: [
        { timeOffset: 0,   label: 'コース説明',     bgColor: 'bg-gray-100/80' },
        { timeOffset: 30,  label: 'カレー',         bgColor: 'bg-yellow-200/80' },
        { timeOffset: 50,  label: 'リクエスト',     bgColor: 'bg-blue-200/80' },
        { timeOffset: 80,  label: 'ラストオーダー', bgColor: 'bg-pink-200/80' },
        { timeOffset: 110, label: '退席',           bgColor: 'bg-gray-200/80' },
      ],
    },
    {
      name: 'ディナー',
      tasks: [
        { timeOffset: 0,   label: 'コース説明',     bgColor: 'bg-gray-100/80' },
        { timeOffset: 10,  label: '皿ピメ',         bgColor: 'bg-yellow-200/80' },
        { timeOffset: 45,  label: 'カレー',         bgColor: 'bg-orange-200/80' },
        { timeOffset: 70,  label: 'リクエスト',     bgColor: 'bg-blue-200/80' },
        { timeOffset: 95,  label: 'ラストオーダー', bgColor: 'bg-pink-200/80' },
        { timeOffset: 125, label: '退席',           bgColor: 'bg-gray-200/80' },
      ],
    },
  ];


  // 選択中のコース名 (タスク設定用)
  const [selectedCourse, setSelectedCourse] = useState<string>(() => nsGetStr('selectedCourse', 'スタンダード'));

  // 営業前設定・タスクプレビュー用に表示中のコース
  const [displayTaskCourse, setDisplayTaskCourse] = useState<string>(() => courses[0]?.name || '');

  // 安全な表示用タスクリスト（常に配列を返す）
  const displayTasksSafe = useMemo(() => {
    const tasks = courses.find(c => c.name === displayTaskCourse)?.tasks;
    return Array.isArray(tasks) ? tasks : [];
  }, [courses, displayTaskCourse]);

  // --- keep selectedCourse valid whenever courses change ---
  useEffect(() => {
    if (!Array.isArray(courses) || courses.length === 0) return;
    if (!selectedCourse || !courses.some(c => c.name === selectedCourse)) {
      const fallback = courses[0]?.name || '';
      setSelectedCourse(fallback);
      try { nsSetStr('selectedCourse', fallback); } catch {}
    }
  }, [courses, selectedCourse]);

  // --- keep displayTaskCourse valid whenever courses change ---
  useEffect(() => {
    if (!Array.isArray(courses) || courses.length === 0) return;
    if (!displayTaskCourse || !courses.some(c => c.name === displayTaskCourse)) {
      setDisplayTaskCourse(courses[0]?.name || '');
    }
  }, [courses, displayTaskCourse]);

  // --- one-time migration: fix broken courses in localStorage and state ---
  const didMigrateCoursesRef = useRef(false);
  useEffect(() => {
    if (didMigrateCoursesRef.current) return;
    didMigrateCoursesRef.current = true;
    try {
      const raw = nsGetJSON<any>('courses', []);
      const normalized = sanitizeCourses(raw);
      // storage を正規化
      if (Array.isArray(raw)) {
        const needsWrite =
          raw.length !== normalized.length ||
          JSON.stringify(raw) !== JSON.stringify(normalized);
        if (needsWrite) nsSetJSON('courses', normalized);
      } else {
        if (normalized.length > 0) nsSetJSON('courses', normalized);
      }
      // state が空で storage にデータがあるなら adopt
      setCourses(prev => (prev.length === 0 && normalized.length > 0 ? normalized : prev));
    } catch (err) {
      console.warn('[migration] courses normalize failed', err);
    }
  }, []);

  // CSR でのみ localStorage を参照して上書き（Hydration mismatch 回避）
  useEffect(() => {
    // nsGetJSON は SSR 環境では fallback を返すのでガード不要
    const stored = nsGetJSON<CourseDef[]>('courses', []);
    if (Array.isArray(stored) && stored.length > 0) {
      setCourses(stored);
    }
  }, []);



  // タブ別コース絞り込みの自己修復（存在しないコース名→『全体』へ）
  useEffect(() => {
    if (tasksFilterCourse !== '全体' && !courses.some(c => c.name === tasksFilterCourse)) {
      setTasksFilterCourse('全体');
      try { nsSetStr('tasks_filterCourse', '全体'); } catch {}
    }
    if (csFilterCourse !== '全体' && !courses.some(c => c.name === csFilterCourse)) {
      setCsFilterCourse('全体');
      try { nsSetStr('cs_filterCourse', '全体'); } catch {}
    }
  }, [courses, tasksFilterCourse, csFilterCourse]);


  // タスク設定セクションの開閉
  const [courseTasksOpen, setCourseTasksOpen] = useState<boolean>(false);
  // 編集中の既存タスク (offset と label で一意に判定)
  const [editingTask, setEditingTask] = useState<{ offset: number; label: string } | null>(null);

  // 入力中ドラフト（ラベル編集の一時保持）
  const [editingTaskDraft, setEditingTaskDraft] = useState<string>('');

  // ラベル編集の確定（onBlur / Enter）
  const commitTaskLabelEdit = (oldLabel: string, timeOffset: number) => {
    // いま編集中の対象でなければ無視
    if (
      !editingTask ||
      editingTask.offset !== timeOffset ||
      !normEq(editingTask.label, oldLabel)
    ) {
      return;
    }
    const newLabel = editingTaskDraft.trim();
    if (newLabel && !normEq(newLabel, oldLabel)) {
      renameTaskLabel(oldLabel, newLabel, timeOffset);
    }
    setEditingTask(null);
    setEditingTaskDraft('');
  };

  // ラベル編集のキャンセル（Esc）
  const cancelTaskLabelEdit = () => {
    setEditingTask(null);
    setEditingTaskDraft('');
  };
  // タスク追加用フィールド
  const [newTaskLabel, setNewTaskLabel] = useState<string>('');
  const [newTaskOffset, setNewTaskOffset] = useState<number>(0);

  // “表示タスクフィルター” 用チェック済みタスク配列
  const [checkedTasks, setCheckedTasks] = useState<string[]>(() =>
  nsGetJSON<string[]>('checkedTasks', [])
);

  // ⬇︎ keep “表示タスクフィルター” の選択状態を永続化
  useEffect(() => {
    nsSetJSON('checkedTasks', checkedTasks);
  }, [checkedTasks]);



  // 新規予約入力用フィールド（卓番・時刻・コース・人数・氏名・備考）
  const [newResTable, setNewResTable] = useState<string>('');
  const [newResTables, setNewResTables] = useState<string[]>([]);
  const [newResTime, setNewResTime] = useState<string>(() => nsGetStr('lastNewResTime', '18:00'));
  const [newResCourse, setNewResCourse] = useState<string>('未選択');   // 未選択で開始
  const [newResGuests, setNewResGuests] = useState<number | ''>('');
  const [newResName, setNewResName] = useState<string>('');   // タブレット用：予約者氏名
  const [newResNotes, setNewResNotes] = useState<string>(''); // タブレット用：備考
  const [newResEat,   setNewResEat]   = useState<string>(''); // 食べ放題
const [newResDrink, setNewResDrink] = useState<string>(''); // 飲み放題

  // 来店入力：氏名表示・備考表示（タブレット専用）
  const [showNameCol, setShowNameCol] = useState<boolean>(() => nsGetStr('res_showNameCol', '1') === '1');
  const [showNotesCol, setShowNotesCol] = useState<boolean>(() => nsGetStr('res_showNotesCol', '1') === '1');
  // 来店入力：食べ放題・飲み放題表示
  // ── 食 / 飲 列の表示フラグ（localStorage ←→ state）────────────────────
  const [showEatCol, setShowEatCol] = useState<boolean>(() => nsGetStr('res_showEatCol', '1') === '1');
  const [showDrinkCol, setShowDrinkCol] = useState<boolean>(() => nsGetStr('res_showDrinkCol', '1') === '1');

// ON/OFF が変わるたびに localStorage へ保存
useEffect(() => {
  if (typeof window !== 'undefined') {
    nsSetStr('res_showEatCol', showEatCol ? '1' : '0');
  }
}, [showEatCol]);

useEffect(() => {
  if (typeof window !== 'undefined') {
    nsSetStr('res_showDrinkCol', showDrinkCol ? '1' : '0');
  }
}, [showDrinkCol]);

useEffect(() => {
  if (typeof window !== 'undefined') {
    nsSetStr('res_showNameCol', showNameCol ? '1' : '0');
  }
}, [showNameCol]);

useEffect(() => {
  if (typeof window !== 'undefined') {
    nsSetStr('res_showNotesCol', showNotesCol ? '1' : '0');
  }
}, [showNotesCol]);
// ─────────────────────────────────────────────────────────────
  // 来店入力: 人数列を表示するかどうか
  const [showGuestsCol, setShowGuestsCol] = useState<boolean>(() => nsGetStr('res_showGuestsCol', '1') === '1');
  useEffect(() => {
    if (typeof window !== 'undefined') {
      nsSetStr('res_showGuestsCol', showGuestsCol ? '1' : '0');
    }
  }, [showGuestsCol]);
  // 表示順選択 (table/time/created)
  const [resOrder, setResOrder] = useState<ResOrder>(() => {
    const v = nsGetStr('res_resOrder', 'time');
    return (v === 'time' || v === 'table' || v === 'created') ? (v as ResOrder) : 'time';
  });

  // 並び順セレクタの変更をlocalStorageに保存
  useEffect(() => {
    if (typeof window !== 'undefined') {
      nsSetStr('res_resOrder', resOrder);
    }
  }, [resOrder]);

  //
  // ─── 2.3 「店舗設定」関連の state ───────────────────────────────────────────
  //

  // “事前に設定する卓番号リスト” を管理
  const [presetTables, setPresetTables] = useState<string[]>(() =>
  nsGetJSON<string[]>('presetTables', [])
);
  // 表示・子渡し用に、卓番号を string 化 + 数字として昇順ソート
  const presetTablesView: string[] = useMemo(() => {
    const src = Array.isArray(presetTables) ? presetTables : [];
    return src.map(String).sort((a, b) => Number(a) - Number(b));
  }, [presetTables]);
  // 新規テーブル入力用 (numeric pad)
  const [newTableTemp, setNewTableTemp] = useState<string>('');
  // 卓設定セクション開閉
  const [tableSettingsOpen, setTableSettingsOpen] = useState<boolean>(false);
  // フロア図エディット用テーブル設定トグル
  const [tableConfigOpen, setTableConfigOpen] = useState<boolean>(false);
  // “フィルター表示する卓番号” 用チェック済みテーブル配列
  const [checkedTables, setCheckedTables] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`${ns}-checkedTables`) ?? '[]');
    } catch {
      return [];
    }
  });

  // ⬇︎ “表示する卓” フィルターも常に永続化（namespaced）
  useEffect(() => {
    try {
      localStorage.setItem(`${ns}-checkedTables`, JSON.stringify(checkedTables));
    } catch {}
  }, [checkedTables]);

  // ⏱ モード自動解除（ズレ防止）
  // 画面切替・フィルター変更・データ更新が起きたら時間調整モードを終了して選択をクリア
  useEffect(() => {
    if (shiftModeKey !== null || shiftTargets.length > 0) {
      setShiftModeKey(null);
      setShiftTargets([]);
    }
  }, [
    selectedMenu,          // タブ切替
    checkedTables,         // 卓フィルタ
    checkedTasks,          // タスク可視フィルタ（その他）
    courseStartFiltered,   // コース開始時間表のフィルタ
    displayTaskCourse,     // プレビュー用の表示コース
    resOrder,              // 予約リストの並び順
    mergeSameTasks,        // タスクまとめ表示
    showCourseAll,
    showGuestsAll,
    showTableStart,
    reservations           // データ更新（他端末/自端末）
  ]);
  // 卓リスト編集モード
  const [tableEditMode, setTableEditMode] = useState<boolean>(false);
  const [posSettingsOpen, setPosSettingsOpen] = useState<boolean>(false);
  // ─── ポジション設定 state ───
  const [positions, setPositions] = useState<string[]>(() =>
  nsGetJSON<string[]>('positions', ['フロント', 'ホール', '刺し場', '焼き場', 'オーブン', 'ストーブ', '揚げ場'])
);
  const [newPositionName, setNewPositionName] = useState<string>('');
  // ポジションごと × コースごと でタスクを保持する  {pos: {course: string[]}}
  const [tasksByPosition, setTasksByPosition] =
  useState<Record<string, Record<string, string[]>>>(() => {
    const parsed = nsGetJSON<Record<string, any>>('tasksByPosition', {});

    // 旧フォーマット (pos -> string[]) を course:"*" に移行
    const isOldFormat =
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every((v) => Array.isArray(v));

    if (isOldFormat) {
      const migrated: Record<string, Record<string, string[]>> = {};
      Object.entries(parsed).forEach(([p, arr]) => {
        migrated[p] = { '*': arr as string[] };
      });
      return migrated;
    }
    return (parsed as Record<string, Record<string, string[]>>) || {};
  });


  // ── Settings: save handler (placed AFTER all live states it depends on) ─────────
const handleStoreSave = useCallback(async () => {
  try {
    console.log('[handleStoreSave] start');
    // ✅ Save from current live state (親の state を唯一の真実とする)

    const draftForSave: StoreSettingsValue = {
      ...settingsDraft,
      courses,
      positions,
      tables: presetTables,
      tasksByPosition,
      eatOptions,
      drinkOptions,
      plans: settingsDraft.plans ?? [],
      areas: Array.isArray(settingsDraft.areas) ? settingsDraft.areas : [],
    };

    console.info('[handleStoreSave] saving to', `stores/${id}/settings/config`, 'keys:', Object.keys(draftForSave || {}));

    // フック経由の保存（唯一の経路）
    const payload = toFirestorePayload(draftForSave);
    await saveSettings(payload);

    // baseline & ローカルキャッシュ更新
    setBaselineSettings(draftForSave);
    try {
      nsSetJSON('courses',         draftForSave.courses || []);
      nsSetJSON('positions',       draftForSave.positions || []);
      nsSetJSON('presetTables',    draftForSave.tables || []);
      nsSetJSON('tasksByPosition', draftForSave.tasksByPosition || {});
      nsSetJSON('eatOptions',      draftForSave.eatOptions || []);
      nsSetJSON('drinkOptions',    draftForSave.drinkOptions || []);
      nsSetJSON('settings-cache',  { cachedAt: Date.now(), data: draftForSave });
    } catch {}

    toast.success('店舗設定を保存しました');
  } catch (e) {
    console.error('[store settings] save failed:', e);
    toast.error('保存に失敗しました。ネットワークをご確認ください。');
  }
}, [id, settingsDraft, courses, positions, presetTables, tasksByPosition, eatOptions, drinkOptions, saveSettings]);

  // ── Settings: JSX block（新しい handleStoreSave を使用） ─────────
  const renderSettingsContent = (
    <main
      className="p-4 h-[100dvh] overflow-y-auto overscroll-contain"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      <StoreSettingsContent
        value={settingsDraft}
        onChange={patchSettings}
        onSave={handleStoreSave}
        isSaving={isSavingSettings}
        baseline={baselineSettings}
      />
    </main>
  );


  // --- 一度きり: localStorage 正規化（checkedTasks / tasksByPosition） ---
  const didNormalizeLSRef = useRef(false);
  useEffect(() => {
    if (didNormalizeLSRef.current) return;
    didNormalizeLSRef.current = true;
    try {
      // checkedTasks の正規化（前後空白/全角半角/大小を統一し、重複除去）
      const ct = nsGetJSON<string[]>('checkedTasks', []);
      const normedCt = Array.from(new Set((ct || []).map(normalizeLabel).filter(Boolean)));
      if (
        normedCt.length !== (ct || []).length ||
        normedCt.some((v, i) => v !== (ct || [])[i])
      ) {
        nsSetJSON('checkedTasks', normedCt);
        setCheckedTasks(normedCt);
      }

      // tasksByPosition の正規化（各配列を正規化＋重複除去）
      const tbp = nsGetJSON<Record<string, Record<string, string[]>>>('tasksByPosition', {});
      let changed = false;
      const next: Record<string, Record<string, string[]>> = {};
      Object.entries(tbp || {}).forEach(([pos, cmap]) => {
        const newMap: Record<string, string[]> = {};
        Object.entries(cmap || {}).forEach(([course, labels]) => {
          const normed = Array.from(
            new Set((labels || []).map(normalizeLabel).filter(Boolean))
          );
          if (
            normed.length !== (labels || []).length ||
            normed.some((v, i) => v !== (labels || [])[i])
          ) {
            changed = true;
          }
          newMap[course] = normed;
        });
        next[pos] = newMap;
      });
      if (changed) {
        nsSetJSON('tasksByPosition', next);
        setTasksByPosition(next);
      }
    } catch (err) {
      console.warn('[migration] localStorage normalization failed', err);
    }
  }, []);
  // ポジションごとの開閉 state
  const [openPositions, setOpenPositions] = useState<Record<string, boolean>>(() => {
    const obj: Record<string, boolean> = {};
    positions.forEach((p) => { obj[p] = false; });
    return obj;
  });
  const togglePositionOpen = (pos: string) => {
    setOpenPositions((prev) => ({ ...prev, [pos]: !prev[pos] }));
  };
  // ─── ポジションごとの選択中コース ───
  const [courseByPosition, setCourseByPosition] = useState<Record<string, string>>(
    () => nsGetJSON<Record<string, string>>('courseByPosition', {})
  );
  // ─── courses / positions が変わった時、courseByPosition を自動補正 ───
  useEffect(() => {
    setCourseByPosition(prev => {
      let changed = false;
      const next: Record<string, string> = { ...prev };

      // (1) 既存ポジションのコース名が現存しなければ先頭コースへフォールバック
      positions.forEach(pos => {
        if (!courses.some(c => c.name === next[pos])) {
          next[pos] = courses[0]?.name || '';
          changed = true;
        }
      });

      // (2) 新しく追加されたポジションが prev に無ければ初期化
      positions.forEach(pos => {
        if (!(pos in next)) {
          next[pos] = courses[0]?.name || '';
          changed = true;
        }
      });

      // (3) 削除されたポジションの残骸を削除
      Object.keys(next).forEach(pos => {
        if (!positions.includes(pos)) {
          delete next[pos];
          changed = true;
        }
      });

      if (changed) {
        nsSetJSON('courseByPosition', next);
        return next;
      }
      return prev;
    });
  }, [courses, positions]);
  const setCourseForPosition = (pos: string, courseName: string) => {
    const next = { ...courseByPosition, [pos]: courseName };
    setCourseByPosition(next);
    nsSetJSON('courseByPosition', next);
  };
  // 全コースからタスクラベル一覧を取得（防御的: coursesやtasksがundefinedでもOK）
  const allTasks = useMemo(() => {
    const labels = new Set<string>();
    const list = Array.isArray(courses) ? courses : [];
    for (const c of list) {
      const tasks = Array.isArray(c?.tasks) ? c.tasks : [];
      for (const t of tasks) {
        if (t && typeof t.label === 'string' && t.label.length > 0) {
          labels.add(t.label);
        }
      }
    }
    return Array.from(labels);
  }, [courses]);
  // ポジション操作ヘルパー
  const addPosition = () => {
    if (!newPositionName.trim() || positions.includes(newPositionName.trim())) return;
    const next = [...positions, newPositionName.trim()];
    setPositions(next);
    nsSetJSON('positions', next);
    setNewPositionName('');
    // --- 追加: courseByPosition / openPositions の初期化 -----------------
    // 新しく作ったポジションにはデフォルトで先頭のコースを割り当てる。
    const defaultCourse = courses[0]?.name || '';
    const nextCourseByPosition = {
      ...courseByPosition,
      [newPositionName.trim()]: defaultCourse,
    };
    setCourseByPosition(nextCourseByPosition);
    nsSetJSON('courseByPosition', nextCourseByPosition);

    // openPositions にもエントリを追加しておく（初期状態は閉じる）
    setOpenPositions(prev => ({ ...prev, [newPositionName.trim()]: false }));
    // --------------------------------------------------------------------
  };
  const removePosition = (pos: string) => {
    const next = positions.filter((p) => p !== pos);
    setPositions(next);
    nsSetJSON('positions', next);
    const nextTasks = { ...tasksByPosition };
    delete nextTasks[pos];
    setTasksByPosition(nextTasks);
    nsSetJSON('tasksByPosition', nextTasks);
    // --- 追加: courseByPosition / openPositions から該当ポジションを削除 ----
    setCourseByPosition(prev => {
      const next = { ...prev };
      delete next[pos];
      nsSetJSON('courseByPosition', next);
      return next;
    });
    setOpenPositions(prev => {
      const next = { ...prev };
      delete next[pos];
      return next;
    });
    // --------------------------------------------------------------------
  };

  // ポジションの並び替え: 上へ移動
  const movePositionUp = (pos: string) => {
    setPositions(prev => {
      const idx = prev.indexOf(pos);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      nsSetJSON('positions', next);
      return next;
    });
  };

  // ポジションの並び替え: 下へ移動
  const movePositionDown = (pos: string) => {
    setPositions(prev => {
      const idx = prev.indexOf(pos);
      if (idx < 0 || idx === prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      nsSetJSON('positions', next);
      return next;
    });
  };
  // ポジション名を変更
  const renamePosition = (pos: string) => {
    const newName = prompt(`「${pos}」の新しいポジション名を入力してください`, pos);
    if (!newName || newName.trim() === "" || newName === pos) return;
    if (positions.includes(newName)) {
      alert("同名のポジションが既に存在します。");
      return;
    }
    // positions 配列の更新
    setPositions(prev => {
      const next = prev.map(p => (p === pos ? newName : p));
      nsSetJSON('positions', next);
      return next;
    });
    // tasksByPosition のキーを更新
    setTasksByPosition(prev => {
      const next = { ...prev, [newName]: prev[pos] || {} };
      delete next[pos];
      nsSetJSON('tasksByPosition', next);
      return next;
    });
    // openPositions のキーを更新
    setOpenPositions(prev => {
      const next = { ...prev, [newName]: prev[pos] };
      delete next[pos];
      return next;
    });
    // courseByPosition のキーを更新
    setCourseByPosition(prev => {
      const next = { ...prev, [newName]: prev[pos] };
      delete next[pos];
      nsSetJSON('courseByPosition', next);
      return next;
    });
  };
  // pos・course 単位でタスク表示をトグル
  const toggleTaskForPosition = (pos: string, courseName: string, label: string) => {
    setTasksByPosition(prev => {
      const courseTasks = prev[pos]?.[courseName] ?? [];
      const nextTasks = includesNorm(courseTasks, label)
        ? removeIfExistsNorm(courseTasks, label)
        : addIfMissingNorm(courseTasks, label);

      const nextPos = { ...(prev[pos] || {}), [courseName]: nextTasks };
      const next = { ...prev, [pos]: nextPos };
      nsSetJSON('tasksByPosition', next);
      return next;
    });
  };
  const [courseSettingsTableOpen, setCourseSettingsTableOpen] = useState<boolean>(false);
  // ─── 営業前設定タブのトグル state ───
  const [displayTablesOpen1, setDisplayTablesOpen1] = useState<boolean>(false);
  const [displayTablesOpen2, setDisplayTablesOpen2] = useState<boolean>(false);
  // ─── 営業前設定：表示タスク用選択中ポジション ───
  const [selectedDisplayPosition, setSelectedDisplayPosition] = useState<string>(() =>
  nsGetStr('selectedDisplayPosition', positions[0] || '')
);

  // 永続化: 選択中ポジションが変わったら保存
  useEffect(() => {
    if (typeof window === 'undefined') return;
    nsSetStr('selectedDisplayPosition', selectedDisplayPosition);
  }, [selectedDisplayPosition]);

  // 位置リストが変わって、保存値が存在しない/不正になったら先頭へフォールバック
  useEffect(() => {
    if (!selectedDisplayPosition || !positions.includes(selectedDisplayPosition)) {
      const fallback = positions[0] || '';
      setSelectedDisplayPosition(fallback);
      if (typeof window !== 'undefined') {
        nsSetStr('selectedDisplayPosition', fallback);
      }
    }
  }, [positions]);

  // --- メモ化: コース別の許可ラベル集合（正規化済み） ---
  const allowedLabelSetByCourse = useMemo<Record<string, Set<string>>>(() => {
    // “その他”タブの選択（正規化）
    const base = new Set((checkedTasks || []).map(normalizeLabel));
    const result: Record<string, Set<string>> = {};

    const listCourses = Array.isArray(courses) ? courses : [];
    listCourses.forEach((c) => {
      const s = new Set<string>(base);
      if (selectedDisplayPosition !== 'その他') {
        const posObj = tasksByPosition[selectedDisplayPosition] || {};
        const labels = Array.isArray((posObj as any)[c.name]) ? (posObj as any)[c.name] : [];
        labels.forEach((l: string) => s.add(normalizeLabel(l)));
      }
      result[c.name] = s; // 空集合は「制約なし」を表す
    });
    return result;
  }, [checkedTasks, selectedDisplayPosition, tasksByPosition, courses]);

  const isTaskAllowed = (courseName: string, label: string) => {
    const set = allowedLabelSetByCourse[courseName];
    // 集合が無い／空なら制約なし、正規化一致なら可
    return !set || set.size === 0 || set.has(normalizeLabel(label));
  };
  // 営業前設定・タスクプレビュー用に表示中のコース
  // const [displayTaskCourse, setDisplayTaskCourse] = useState<string>(() => courses[0]?.name || '');

  const timeOptions = useMemo(() => {
    const arr: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 5) {
        arr.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return arr;
  }, []);

  // === 前回選んだ時刻をデフォルトに（timeOptions 確定後に再適用） ===
  useEffect(() => {
    try {
      const saved = nsGetStr('lastNewResTime', '');
      if (saved && Array.isArray(timeOptions) && timeOptions.includes(saved) && newResTime !== saved) {
        setNewResTime(saved);
      }
    } catch {}
  }, [timeOptions]);

  // === 選択が変わるたび保存（店舗IDで名前空間済み） ===
  useEffect(() => {
    try {
      if (newResTime) nsSetStr('lastNewResTime', newResTime);
    } catch {}
  }, [newResTime]);

  //
  // ─── 2.5 コース/タスク設定用イベントハンドラ ───────────────────────────────
  //

  // コース選択変更
  const handleCourseChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setSelectedCourse(e.target.value);
    nsSetStr('selectedCourse', e.target.value);
  };

  // タスク設定セクションの開閉
  const toggleCourseTasks = () => {
    if (!courseTasksOpen) {
      if (!confirm('タスク設定を開きますか？')) return;
    }
    setCourseTasksOpen((prev) => !prev);
  };

  // 既存タスクを削除
  const deleteTaskFromCourse = (offset: number, label: string) => {
    if (!confirm(`「${label}」を削除しますか？`)) return;
    setCourses((prev) => {
      const next = prev.map((c) => {
        if (c.name !== selectedCourse) return c;
        const tasks = [...getTasks(c)];
        const nextTasks = tasks.filter(
          (t) => !(t.timeOffset === offset && normEq(t.label, label))
        );
        return { ...c, tasks: nextTasks };
      });
      nsSetJSON('courses', next);
      return next;
    });
    // ② tasksByPosition から “孤児ラベル” を掃除（選択中コースに限定）
    setTasksByPosition(prev => {
      if (!prev || typeof prev !== 'object') return prev;
      const next: Record<string, Record<string, string[]>> = {};
      let changed = false;

      Object.entries(prev).forEach(([pos, cmap]) => {
        const cur = cmap || {};
        const list = Array.isArray(cur[selectedCourse]) ? cur[selectedCourse] : [];
        const cleaned = removeIfExistsNorm(list, label);
        if (cleaned !== list) changed = true;
        next[pos] = { ...cur, [selectedCourse]: cleaned };
      });

      if (changed) {
        try { nsSetJSON('tasksByPosition', next); } catch {}
        return next;
      }
      return prev;
    });
    setEditingTask(null);
  };

  // 既存タスク時間を ±5 分ずらす（防御的に配列化）
  const shiftTaskOffset = (offset: number, label: string, delta: number) => {
    setCourses((prev) => {
      const next = prev.map((c) => {
        if (c.name !== selectedCourse) return c;
        const base = [...getTasks(c)];
        const tasks = base
          .map((t) => {
            if (t.timeOffset !== offset || !normEq(t.label, label)) return t;
            const newOffset = Math.max(0, Math.min(180, t.timeOffset + delta));
            return { ...t, timeOffset: newOffset };
          })
          .sort((a, b) => a.timeOffset - b.timeOffset);
        return { ...c, tasks };
      });
      nsSetJSON('courses', next);
      return next;
    });
    if (editingTask && editingTask.offset === offset && normEq(editingTask.label, label)) {
      setEditingTask({ offset: Math.max(0, Math.min(180, offset + delta)), label });
    }
  };

  // 編集モード切り替え（ドラフト統合・ラベル正規化比較）
  const toggleEditingTask = (offset: number, label: string) => {
    setEditingTask(prev => {
      const isSame =
        !!prev &&
        prev.offset === offset &&
        normEq(prev.label, label);

      if (isSame) {
        // 編集終了（ドラフトを破棄）
        setEditingTaskDraft('');
        return null;
      } else {
        // 編集開始（ドラフトへ現在値をセット）
        setEditingTaskDraft(label);
        return { offset, label };
      }
    });
  };
  // タスク名の一括リネーム（コース・フィルター・予約まで反映）
  const renameTaskLabel = (oldLabel: string, newLabelInput: string, timeOffset?: number) => {
    const newLabel = newLabelInput.trim();
    // 重複名ガード: 同一 offset に正規化一致のタスクが既にある場合は中止
    const course = courses.find(c => c.name === selectedCourse);
    if (course) {
      // timeOffset が未指定の場合は oldLabel から offset を推測（複数あればすべて対象）
      const targetOffsets = typeof timeOffset === 'number'
        ? [timeOffset]
        : course.tasks.filter(t => normEq(t.label, oldLabel)).map(t => t.timeOffset);

      // 既に同 offset に新ラベル(正規化一致)が存在するか
      const conflict = course.tasks.some(t =>
        targetOffsets.includes(t.timeOffset) &&
        normEq(t.label, newLabel) &&
        // もともとの自分自身 1 件だけは除外（同名・同 offset で実質変更なしのケース）
        !(normEq(t.label, oldLabel) && (typeof timeOffset === 'number' ? t.timeOffset === timeOffset : true))
      );

      if (conflict) {
        alert('同じ時刻に同名のタスクが既にあります。別の名前にしてください。');
        return;
      }
    }
    if (!newLabel || newLabel === oldLabel) return;

    // 1) courses（選択中コースの該当タスクのみ）
    setCourses(prev => {
      const next = prev.map(c => {
        if (c.name !== selectedCourse) return c;
        const base = [...getTasks(c)];
        const updatedTasks = base.map(t =>
          normEq(t.label, oldLabel) &&
          (typeof timeOffset === 'undefined' || t.timeOffset === timeOffset)
            ? { ...t, label: newLabel }
            : t
        );
        return { ...c, tasks: updatedTasks };
      });
      try { nsSetJSON('courses', next); } catch {}
      return next;
    });

    // 2) 表示タスクフィルター（その他タブ）の同期（追加しない／置換のみ）
    setCheckedTasks((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      // 旧ラベルがチェックされていない場合は何もしない（追加しない）
      if (!includesNorm(base, oldLabel)) return prev;

      // 旧→新へ置換（順序維持・重複は除去）
      const replaced = base.map(l => (normEq(l, oldLabel) ? newLabel : l));
      const dedup: string[] = [];
      for (const l of replaced) {
        if (!dedup.some(x => normEq(x, l))) dedup.push(l);
      }

      // 変更がなければそのまま
      if (dedup.length === base.length && dedup.every((v, i) => v === base[i])) return prev;

      try { nsSetJSON('checkedTasks', dedup); } catch {}
      return dedup;
    });

    // 3) ポジション × コースのタスク表示設定は「選択中コースに限定して」ラベルを置換。
    //    他コースの選択は触らない（外れてしまう不具合の原因だったため）。
    setTasksByPosition(prev => {
      const next: Record<string, Record<string, string[]>> = { ...prev };
      Object.entries(prev || {}).forEach(([pos, cmap]) => {
        const current = cmap?.[selectedCourse];
        if (Array.isArray(current) && current.some(l => normEq(l, oldLabel))) {
          const replaced = current.map(l => (normEq(l, oldLabel) ? newLabel : l));
          next[pos] = { ...(cmap || {}), [selectedCourse]: replaced };
        }
      });
      try { nsSetJSON('tasksByPosition', next); } catch {}
      return next;
    });

    // 4) 予約データの timeShift / completed キーも「選択中コースの予約のみ」置換。
    setReservations(prev => {
      const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^${escape(oldLabel)}_`);
      const next = prev.map(r => {
        if (r.course !== selectedCourse) return r; // ← 他コースは触らない

        let newTimeShift = r.timeShift;
        if (newTimeShift && Object.prototype.hasOwnProperty.call(newTimeShift, oldLabel)) {
          const { [oldLabel]: oldVal, ...rest } = newTimeShift;
          newTimeShift = { ...rest, [newLabel]: oldVal };
        }

        const newCompleted: Record<string, boolean> = {};
        Object.entries(r.completed || {}).forEach(([key, done]) => {
          if (re.test(key)) {
            newCompleted[key.replace(re, `${newLabel}_`)] = done;
          } else {
            newCompleted[key] = done;
          }
        });

        return { ...r, timeShift: newTimeShift, completed: newCompleted };
      });
      persistReservations(next);
      return next;
    });
  };
  /** ラベル一覧に存在しないフィルタ値を自動クリーンアップ（courses 変化時 / 正規化対応） */
  useEffect(() => {
    // いま存在している全ラベル（正規化済み）をセット化
    const allNorm = new Set<string>();
    const cList = Array.isArray(courses) ? courses : [];
    for (const c of cList) {
      const tList = Array.isArray(c?.tasks) ? c.tasks : [];
      for (const t of tList) {
        if (t && typeof t.label === 'string') allNorm.add(normalizeLabel(t.label));
      }
    }

    // ① “その他”タブのチェックリストを掃除（正規化比較）
    setCheckedTasks(prev => {
  const base = Array.isArray(prev) ? prev : [];
  const next = base.filter(l => allNorm.has(normalizeLabel(l)));
  if (next.length !== base.length) {
    try { nsSetJSON('checkedTasks', next); } catch {}
    return next;
  }
  return prev;
});

    // ② ポジション×コースの表示リストを掃除（正規化比較）
    setTasksByPosition(prev => {
      let changed = false;
      const next: Record<string, Record<string, string[]>> = {};
      Object.entries(prev || {}).forEach(([pos, cmap]) => {
        const newMap: Record<string, string[]> = {};
        Object.entries(cmap || {}).forEach(([courseName, labels]) => {
          const filtered = (labels || []).filter(l => allNorm.has(normalizeLabel(l)));
          if (filtered.length !== (labels || []).length) changed = true;
          newMap[courseName] = filtered;
        });
        next[pos] = newMap;
      });
      if (changed) {
        try { nsSetJSON('tasksByPosition', next); } catch {}
        return next;
      }
      return prev;
    });
  }, [courses]);

  /** 可視フィルター自己修復（何も表示されない状態の自動リセット） */
  useEffect(() => {
    try {
      // いま存在している全ラベル（正規化）
      const allNorm = new Set<string>();
      const cList2 = Array.isArray(courses) ? courses : [];
      for (const c of cList2) {
        const tList = Array.isArray(c?.tasks) ? c.tasks : [];
        for (const t of tList) {
          if (t && typeof t.label === 'string') allNorm.add(normalizeLabel(t.label));
        }
      }

      // 現在の結合フィルター（正規化）
      const combinedNorm = new Set<string>();
      (checkedTasks || []).forEach(l => combinedNorm.add(normalizeLabel(l)));
      if (selectedDisplayPosition !== 'その他') {
        const posObj = tasksByPosition[selectedDisplayPosition] || {};
        Object.values(posObj || {}).forEach((labels) => {
          (labels || []).forEach((l) => combinedNorm.add(normalizeLabel(l)));
        });
      }

      // 制約なしなら何もしない
      if (combinedNorm.size === 0) return;

      // フィルターで選ばれているものの中に、現存ラベルが1つも無ければリセット
      const anyExists = Array.from(combinedNorm).some(l => allNorm.has(l));
      if (!anyExists) {
  setCheckedTasks([]);
  try { nsSetJSON('checkedTasks', []); } catch {}

  if (selectedDisplayPosition !== 'その他') {
    setTasksByPosition(prev => {
      const next = { ...prev, [selectedDisplayPosition]: {} };
      try { nsSetJSON('tasksByPosition', next); } catch {}
      return next;
    });
  }
}
    } catch {
      /* noop */
    }
  }, [courses, selectedDisplayPosition, tasksByPosition, checkedTasks]);
  // 新規タスクをコースに追加
  const addTaskToCourse = (label: string, offset: number) => {
    setCourses((prev) => {
      const next = prev.map((c) => {
        if (c.name !== selectedCourse) return c;
        const tasks = [...getTasks(c)];
        // 重複ガード（同offset・同ラベル）
        if (tasks.some((t) => t.timeOffset === offset && t.label === label)) {
          return c;
        }
        const bgColorMap: Record<string, string> = {
          'コース説明': 'bg-gray-100/80',
          '皿ピメ': 'bg-yellow-200/80',
          'カレー': 'bg-orange-200/80',
          'リクエスト': 'bg-blue-200/80',
          'ラストオーダー': 'bg-pink-200/80',
          '退席': 'bg-gray-200/80',
        };
        const color = bgColorMap[label] || 'bg-gray-100/80';
        const updatedTasks = [
          ...tasks,
          { timeOffset: offset, label, bgColor: color },
        ].sort((a, b) => a.timeOffset - b.timeOffset);
        return { ...c, tasks: updatedTasks };
      });
      nsSetJSON('courses', next);
      return next;
    });

    // ② 新規タスクをフィルターに自動追加（撤廃：ユーザー操作のみでチェック）
setCheckedTasks((prev) => prev);
setTasksByPosition((prev) => prev);
  };

// コース名を変更
const renameCourse = async () => {
  const oldName = selectedCourse;
  const newName = prompt(`「${oldName}」の新しいコース名を入力してください`, oldName);
  if (!newName || newName.trim() === '' || newName === oldName) return;
  if (courses.some(c => c.name === newName)) {
    alert('同名のコースが既に存在します。');
    return;
  }

  /* ── 1) ローカル state を即時更新 ───────────────────── */
  // courses 配列
  setCourses(prev => {
    const next = prev.map(c => (c.name === oldName ? { ...c, name: newName } : c));
    nsSetJSON('courses', next);
    return next;
  });

  // 選択中コース
  setSelectedCourse(newName);
  nsSetStr('selectedCourse', newName);
  // タスク表で旧名が選ばれていた場合も更新
  setDisplayTaskCourse((prev) => (prev === oldName ? newName : prev));
  // 新規予約フォームで選択中のコースも置き換える
  setNewResCourse(prev => (prev === oldName ? newName : prev));

  // ポジションごとのデフォルトコース
  setCourseByPosition(prev => {
    // すべてのポジション値を走査し、旧コース名を新コース名へ置換
    const next: Record<string, string> = {};
    Object.entries(prev).forEach(([pos, cname]) => {
      next[pos] = cname === oldName ? newName : cname;
    });
    nsSetJSON('courseByPosition', next);
    return next;
  });

  // tasksByPosition のキーも旧コース名 → 新コース名 へリネーム
  setTasksByPosition(prev => {
    const next: Record<string, Record<string, string[]>> = {};
    Object.entries(prev).forEach(([pos, courseMap]) => {
      const newCourseMap: Record<string, string[]> = { ...courseMap };
      if (newCourseMap[oldName]) {
        newCourseMap[newName] = newCourseMap[oldName];
        delete newCourseMap[oldName];
      }
      next[pos] = newCourseMap;
    });
    nsSetJSON('tasksByPosition', next);
    return next;
  });

  // reservations の course と completed キーを置換
  setReservations(prev => {
    const next = prev.map(r => {
      if (r.course !== oldName) return r;

      const migratedCompleted: Record<string, boolean> = {};
      Object.entries(r.completed ?? {}).forEach(([key, done]) => {
        const newKey = key.endsWith(`_${oldName}`)
          ? key.replace(new RegExp(`_${oldName}$`), `_${newName}`)
          : key;
        migratedCompleted[newKey] = done;
      });

      return { ...r, course: newName, completed: migratedCompleted };
    });
    persistReservations(next);
    return next;
  });

  // 成功通知
  toast.success(`「${oldName}」を「${newName}」に変更しました`);

  /* ── 2) Firestore トランザクションで一括リネーム ─── */
  if (navigator.onLine) {
    try {
      await renameCourseTx(oldName, newName);
    } catch (err) {
      console.error('renameCourseTx failed:', err);
      toast.error('サーバ側の更新に失敗しました。ページを再読込してもう一度お試しください。');
    }
  } else {
    toast('ローカルのみ変更しました（サーバ共有していません）', { icon: '💾' });
  }
};

// コース削除 --------------------------------------------------------------
const deleteCourse = async () => {
  const target = selectedCourse;
  if (courses.length <= 1) {
    alert('最後の 1 コースは削除できません。');
    return;
  }
  if (!confirm(`「${target}」コースを削除しますか？`)) return;

  /* 1) courses 配列から除外 */
  setCourses(prev => {
    const next = prev.filter(c => c.name !== target);
    nsSetJSON('courses', next);
    return next;
  });

  /* 2) フォールバック用コース名を取得 */
  const fallback = courses.find(c => c.name !== target)?.name || '未選択';

  /* 3) 各選択中 state をフォールバック */
  setSelectedCourse(prev => (prev === target ? fallback : prev));
  setDisplayTaskCourse(prev => (prev === target ? fallback : prev));
  setNewResCourse(prev => (prev === target ? fallback : prev));
  // No localStorage write for selectedCourse here by default

  /* 4) courseByPosition を更新 */
  setCourseByPosition(prev => {
    const next: Record<string, string> = {};
    Object.entries(prev).forEach(([pos, cname]) => {
      next[pos] = cname === target ? fallback : cname;
    });
    nsSetJSON('courseByPosition', next);
    return next;
  });

  /* 5) tasksByPosition のキーを削除 */
  setTasksByPosition(prev => {
    const next: Record<string, Record<string, string[]>> = {};
    Object.entries(prev).forEach(([pos, cmap]) => {
      const newMap = { ...cmap };
      delete newMap[target];
      next[pos] = newMap;
    });
    nsSetJSON('tasksByPosition', next);
    return next;
  });

  toast.success(`「${target}」コースを削除しました`);
};

  // “表示タスクフィルター” のチェック操作
  const handleTaskCheck = (label: string) => {
    setCheckedTasks((prev) => {
  const isOn = includesNorm(prev, label);
  const next = isOn ? removeIfExistsNorm(prev, label) : addIfMissingNorm(prev, label);
  try { nsSetJSON('checkedTasks', next); } catch {}
  return next;
});
  };

  // ─── 2.6c/2.6d localStorage 予約バックアップは統合フックにより削除
  //
  // ─── helper: キーが変わったときだけ再計算する安定ソート ───
  const arraysEqualShallow = (a: readonly string[], b: readonly string[]) => {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  function useStableSorted<T>(
    list: readonly T[],
    cmp: (a: T, b: T) => number,
    sig: (item: T) => string
  ): T[] {
    const prevSigRef = useRef<string[] | null>(null);
    const prevSortedRef = useRef<T[] | null>(null);
    const prevOrderIdsRef = useRef<string[] | null>(null);

    // 現在のシグネチャ（並び順に影響するキーのみ）
    const sigArr = useMemo(() => list.map(sig), [list, sig]);

    const extractId = (s: string) => {
      const i = s.indexOf('|');
      return i === -1 ? s : s.slice(0, i);
    };

    const sorted = useMemo(() => {
      const prevSig = prevSigRef.current;
      const prevSorted = prevSortedRef.current;
      const prevOrderIds = prevOrderIdsRef.current;

      // 1) 並び順キーに変化がない → 以前の順序を保ったまま、**最新の要素参照**に差し替える
      if (prevSig && prevSorted && prevOrderIds && arraysEqualShallow(prevSig, sigArr)) {
        // 現在リストの id → item のマップを作成
        const curMap = new Map<string, T>();
        for (let i = 0; i < list.length; i++) {
          curMap.set(extractId(sigArr[i]), list[i]);
        }
        // 以前の順序（prevOrderIds）に従って現在要素を並べ直す
        const refreshed = prevOrderIds
          .map((id) => curMap.get(id))
          .filter((v): v is T => v !== undefined);

        // もし要素欠落があれば、最後に現在の残りを順不同で追加
        if (refreshed.length !== list.length) {
          const used = new Set(refreshed);
          for (const item of list) if (!used.has(item)) refreshed.push(item);
        }

        // 参照も順序も最新化できたのでそのまま返す
        prevSortedRef.current = refreshed;
        return refreshed;
      }

      // 2) キーが変わった → 新規にソート
      const next = [...list].sort(cmp);
      const orderIds = next.map((item) => extractId(sig(item)));

      prevSigRef.current = sigArr;
      prevSortedRef.current = next;
      prevOrderIdsRef.current = orderIds;
      return next;
    }, [list, sigArr, cmp]);

    return sorted;
  }
  //
  // ─── 2.7 “予約リストのソートとフィルター” ─────────────────────────────────────────
  //

  const sortedByTable = useStableSorted(
    reservations,
    (a, b) => Number(a.table) - Number(b.table),
    // 並び順に影響するのは id の集合と各 id の table 値
    (r) => `${r.id}|${r.table}`
  );

  const sortedByTime = useStableSorted(
    reservations,
    (a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time),
    // 並び順に影響するのは id と time
    (r) => `${r.id}|${r.time}`
  );

  const sortedByCreated = useStableSorted(
    reservations,
    (a, b) => Number(a.id) - Number(b.id),
    // “作成順”の代替として id 昇順を採用 → 影響キーは id のみ
    (r) => `${r.id}`
  );

  // 表示順決定
  const sortedReservations =
    resOrder === 'time' ? sortedByTime : resOrder === 'created' ? sortedByCreated : sortedByTable;

  // ▼ 共通 → タブ別フィルタへ分割
  // 1) 営業前設定の「表示する卓」だけを適用した共通フィルタ（コース絞り込みは含めない）
  const filteredByTables = useMemo(() => {
    return sortedReservations.filter((r) => {
      if (checkedTables.length > 0) {
        const list = (Array.isArray(r.tables) && r.tables.length > 0) ? r.tables : [r.table];
        if (!list.some(t => checkedTables.includes(t))) return false;
      }
      return true;
    });
  }, [sortedReservations, checkedTables]);

  // 2) Tasks タブ専用：コース絞り込みを tasks_filterCourse で適用
  const filteredReservationsTasks = useMemo(() => {
    const map = tableToAreasLocal || {};
    return filteredByTables.filter((r) => {
      if (filterArea !== '全て') {
        const tables = Array.isArray(r.tables) && r.tables.length > 0 ? r.tables : [r.table];

        if (filterArea === '未割当') {
          const hasAssignedArea = tables.some((t) => {
            const areasForTable = map[String(t)] || [];
            return Array.isArray(areasForTable) && areasForTable.length > 0;
          });
          if (hasAssignedArea) return false;
        } else {
          const matchesArea = tables.some((t) => {
            const areasForTable = map[String(t)] || [];
            return Array.isArray(areasForTable) && areasForTable.includes(filterArea);
          });
          if (!matchesArea) return false;
        }
      }

      if (tasksFilterCourse !== '全体' && r.course !== tasksFilterCourse) return false;
      return true;
    });
  }, [filteredByTables, filterArea, tableToAreasLocal, tasksFilterCourse]);

  // 3) コース開始時間表専用：営業前設定フィルタの反映有無 + cs_filterCourse を適用
  const filteredReservationsCourseStart = useMemo(() => {
    const source = courseStartFiltered ? filteredByTables : sortedReservations;
    return source.filter((r) => {
      if (csFilterCourse !== '全体' && r.course !== csFilterCourse) return false;
      return true;
    });
  }, [filteredByTables, sortedReservations, courseStartFiltered, csFilterCourse]);

  /* ─── 2.x リマインド機能 state & ロジック ───────────────────────── */
  // 通知の ON/OFF（永続化：localStorage に保存 / 復元）
  const [remindersEnabled, setRemindersEnabled] = useState<boolean>(() => nsGetStr('remindersEnabled', '0') === '1');
  // 値が変わるたびに永続化
  useEffect(() => {
    try { nsSetStr('remindersEnabled', remindersEnabled ? '1' : '0'); } catch {}
  }, [remindersEnabled]);

  // 通知有効化の進行状態 & トグル処理
  const [notiBusy, setNotiBusy] = useState(false);
  const handleRemindersToggle = async (e: ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setRemindersEnabled(checked);

    if (!checked) {
      // OFF 時の追加処理があればここに（現状は何もしない）
      return;
    }

    setNotiBusy(true);
    try {
      // ① SW 登録（未登録なら登録）
      await ensureServiceWorkerRegistered();

      // ② 許可 → FCM トークン取得
      const token = await requestPermissionAndGetToken();
      if (!token) {
        // 許可拒否 or 失敗のときは UI を元に戻す
        setRemindersEnabled(false);
        return;
      }

      // ③ 任意：Firestore に保存（既存の ensureFcmRegistered を活用）
      // deviceId は内部生成でも OK。ここでは簡易な固定名/自動生成のどちらでも可。
      const deviceId = getDeviceId();
      await ensureFcmRegistered(deviceId, id as string, token);
      console.log("[FCM] 通知の有効化が完了しました。");
    } catch (err) {
      console.error("[FCM] 通知の有効化に失敗:", err);
      setRemindersEnabled(false);
    } finally {
      setNotiBusy(false);
    }
  };

  // 現在時刻 "HH:MM"
  const [currentTime, setCurrentTime] = useState<string>(() => {
    const now = new Date();
    return formatMinutesToTime(now.getHours() * 60 + now.getMinutes());
  });

  // 1 分ごとに currentTime を更新
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCurrentTime(formatMinutesToTime(now.getHours() * 60 + now.getMinutes()));
    };
    const id = setInterval(tick, 60_000);
    tick(); // 初回即実行
    return () => clearInterval(id);
  }, []);

  // A) 毎分のローカルタスク判定 → taskEvents へ addDoc（重複防止つき）
  useEffect(() => {
    if (!remindersEnabled) return; // トグルOFFなら送信しない
    if (!reservations || reservations.length === 0) return;

    const nowKey = currentTime; // "HH:MM"
    const nowMin = parseTimeToMinutes(nowKey);
    const deviceId = getDeviceId();

    // 対象となる予約を走査
    reservations.forEach((res) => {
      // 退店済みは対象外
      if (checkedDepartures.includes(res.id)) return;
      // コース未設定は対象外
      if (!res.course || res.course === '未選択') return;

      const cdef = courses.find((c) => c.name === res.course);
      if (!cdef) return;

      const baseMin = parseTimeToMinutes(res.time);

      const _tasks = Array.isArray(cdef?.tasks) ? cdef.tasks : [];
      for (const t of _tasks) {
        // 営業前設定の表示タスクフィルターを尊重（非表示タスクは通知しない）
        if (!isTaskAllowed(res.course, t.label)) continue;

        const absMin = baseMin + t.timeOffset + (res.timeShift?.[t.label] ?? 0);
        if (absMin !== nowMin) continue; // ちょうど今の分だけ通知

        const dateStr = res.date || todayKey();
        const dedupeKey = `${dateStr}_${res.id}_${t.label}_${res.course}_${res.time}`;
        if (hasSent(dedupeKey)) continue;

        markSent(dedupeKey);
        sendTaskEvent({
          storeId: id,
          reservationId: res.id,
          table: res.table,
          course: res.course,
          taskLabel: t.label,
          timeKey: nowKey,
          date: dateStr,
          dedupeKey,
          deviceId,
        });
      }
    });
    // 依存には、時刻の他、予約・設定類を含める（重い場合は最小化してOK）
  }, [currentTime, remindersEnabled, reservations, courses, checkedTasks, selectedDisplayPosition, tasksByPosition, courseByPosition, checkedDepartures]);

  /** 「これから来るタスク」を時刻キーごとにまとめた配列
   *  [{ timeKey: "18:15", tasks: ["コース説明", "カレー"] }, ... ]
   */
  const upcomingReminders = useMemo<Array<{ timeKey: string; tasks: string[] }>>(() => {
    if (!filteredReservationsTasks.length) return [];
    const nowMin = parseTimeToMinutes(currentTime);

    const map: Record<string, Set<string>> = {};

    filteredReservationsTasks.forEach((res) => {
      // 除外: 既に退店済みの予約
      if (checkedDepartures.includes(res.id)) return;
      const courseDef = courses.find((c) => c.name === res.course);
      if (!courseDef) return;
      const baseMin = parseTimeToMinutes(res.time);

      const _tasks = Array.isArray(courseDef?.tasks) ? courseDef.tasks : [];
      for (const t of _tasks) {
        const absMin = calcTaskAbsMin(res.time, t.timeOffset, t.label, res.timeShift);
        // ---------- 表示タスクフィルター ----------
        if (!isTaskAllowed(res.course, t.label)) continue; // 表示フィルター非対象はスキップ
        // ------------------------------------------
        if (absMin < nowMin) continue; // 既に過ぎているタスクは対象外
        const timeKey = formatMinutesToTime(absMin);
        if (!map[timeKey]) map[timeKey] = new Set();
        map[timeKey].add(t.label);
      }
    });

    // map → 配列へ変換し時刻順にソート
    return Object.entries(map)
      .sort((a, b) => parseTimeToMinutes(a[0]) - parseTimeToMinutes(b[0]))
      .map(([timeKey, set]) => ({ timeKey, tasks: Array.from(set) }));
  }, [filteredReservationsTasks, courses, currentTime, checkedDepartures]);

  // 回転テーブル判定: 同じ卓番号が複数予約されている場合、その卓は回転中とみなす（参照安定化）
  const { rotatingTables, firstRotatingId } = useMemo(() => {
    const tableCounts: Record<string, number> = {};
    filteredReservationsTasks.forEach((r) => {
      const list = (Array.isArray(r.tables) && r.tables.length > 0) ? r.tables : [r.table];
      list.forEach(t => { tableCounts[t] = (tableCounts[t] || 0) + 1; });
    });
    const rotating = new Set(Object.keys(tableCounts).filter((t) => tableCounts[t] > 1));

    // 各回転テーブルごとに最初の予約IDを記録
    const first: Record<string, string> = {};
    filteredReservationsTasks.forEach((r) => {
      const list = (Array.isArray(r.tables) && r.tables.length > 0) ? r.tables : [r.table];
      list.forEach(t => { if (rotating.has(t) && !(t in first)) first[t] = r.id; });
    });

    return { rotatingTables: rotating, firstRotatingId: first };
  }, [filteredReservationsTasks]);


  //
  // ─── 2.8 “タスク表示用グルーピングロジック” ────────────────────────────────────────
  //

  // ─── コース開始時間表用グルーピング ─────────────────────────────
  const groupedStartTimes = useMemo(() => {
    const map: Record<string, Record<string, Reservation[]>> = {};
    // ここでは CourseStart 専用の配列を利用（営業前設定フィルタの反映有無＋コース絞り込み込み）
    const source = filteredReservationsCourseStart;
    source.forEach((r) => {
      if (!map[r.time]) map[r.time] = {};
      if (!map[r.time][r.course]) map[r.time][r.course] = [];
      map[r.time][r.course].push(r);
    });
    // timeKey → [{ courseName, reservations }]
    return Object.fromEntries(
      Object.entries(map).map(([timeKey, coursesMap]) => [
        timeKey,
        Object.entries(coursesMap).map(([courseName, reservations]) => ({ courseName, reservations })),
      ])
    );
  }, [filteredReservationsCourseStart]);

  type TaskGroup = {
    timeKey: string;
    label: string;
    bgColor: string;
    courseGroups: {
      courseName: string;
      reservations: Reservation[];
    }[];
  };

  // ─── groupedTasks 構築を useMemo 化（予約・コース・フィルタが変わった時だけ再計算） ───
  const { groupedTasks, sortedTimeKeys } = useMemo((): {
    groupedTasks: Record<string, TaskGroup[]>;
    sortedTimeKeys: string[];
  } => {
    const grouped: Record<string, TaskGroup[]> = {};

    filteredReservationsTasks.forEach((res) => {
      // Skip tasks for departed reservations
      if (checkedDepartures.includes(res.id)) return;
      if (res.course === '未選択') return;
      const courseDef = courses.find((c) => c.name === res.course);
      if (!courseDef) return;

      const _tasks2 = Array.isArray(courseDef?.tasks) ? courseDef.tasks : [];
      for (const t of _tasks2) {
        // === 営業前設定の「表示するタスク」フィルター（正規化済み集合を利用） ===
        const set = allowedLabelSetByCourse[res.course];
        const allowed = !set || set.size === 0 || set.has(normalizeLabel(t.label));
        if (!allowed) continue;

        const slot = calcTaskAbsMin(res.time, t.timeOffset, t.label, res.timeShift);
        const timeKey = formatMinutesToTime(slot);
        if (!grouped[timeKey]) grouped[timeKey] = [];

        let taskGroup = grouped[timeKey].find((g) => g.label === t.label);
        if (!taskGroup) {
          taskGroup = { timeKey, label: t.label, bgColor: t.bgColor, courseGroups: [] };
          grouped[timeKey].push(taskGroup);
        }
        let courseGroup = taskGroup.courseGroups.find((cg) => cg.courseName === res.course);
        if (!courseGroup) {
          courseGroup = { courseName: res.course, reservations: [] };
          taskGroup.courseGroups.push(courseGroup);
        }
        courseGroup.reservations.push(res);
      }
    });

    // 時刻キーを昇順に
    const keys = Object.keys(grouped).sort(
      (a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b)
    );

    // 各タイムキー内で、タスクを timeOffset 順・コース名順に整列
    keys.forEach((tk) => {
      grouped[tk].sort((a, b) => {
        const aOffset = (() => {
          const cg = a.courseGroups[0];
          const cdef = courses.find((c) => c.name === cg.courseName);
          return cdef?.tasks.find((t) => t.label === a.label)?.timeOffset ?? 0;
        })();
        const bOffset = (() => {
          const cg = b.courseGroups[0];
          const cdef = courses.find((c) => c.name === cg.courseName);
          return cdef?.tasks.find((t) => t.label === b.label)?.timeOffset ?? 0;
        })();
        return aOffset - bOffset;
      });
      grouped[tk].forEach((tg) => {
        tg.courseGroups.sort((x, y) => x.courseName.localeCompare(y.courseName));
      });
    });

    return { groupedTasks: grouped, sortedTimeKeys: keys };
  }, [filteredReservationsTasks, courses, checkedDepartures, allowedLabelSetByCourse]);

  // ─── “リマインド用” 直近タイムキー（現在含む先頭4つ） ───
  const futureTimeKeys = useMemo(() => {
    const nowMin = parseTimeToMinutes(currentTime);
    return sortedTimeKeys
      .filter((tk) => parseTimeToMinutes(tk) >= nowMin)
      .slice(0, 4);
  }, [sortedTimeKeys, currentTime]);

  // ---- unify scroll: kill inner scroll containers in Tasks tab (force single scrollbar) ----
  useEffect(() => {
    if (bottomTab !== 'tasks') return;
    const root = document.getElementById('tasks-root') as HTMLElement | null;
    if (!root) return;

    // Ensure the page (html/body) is the only scroller
    const prevHtmlOv = document.documentElement.style.overflowY;
    const prevBodyOv = document.body.style.overflowY;
    document.documentElement.style.overflowY = 'auto';
    document.body.style.overflowY = 'auto';

    // Collect inner nodes that create their own scrollbars and neutralize them
    const modified: Array<{ el: HTMLElement; ov: string; mh: string; h: string }> = [];
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('*'));
    nodes.forEach((el) => {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll')) {
        modified.push({ el, ov: el.style.overflowY, mh: el.style.maxHeight, h: el.style.height });
        el.style.overflowY = 'visible';
        el.style.maxHeight = 'none';
        if (cs.height !== 'auto') el.style.height = 'auto';
      }
    });

    return () => {
      // restore inline styles
      modified.forEach(({ el, ov, mh, h }) => {
        el.style.overflowY = ov;
        el.style.maxHeight = mh;
        el.style.height = h;
      });
      document.documentElement.style.overflowY = prevHtmlOv;
      document.body.style.overflowY = prevBodyOv;
    };
  }, [bottomTab]);

  
  // ─── 2.9 “数値パッド” 用の状態とハンドラ ─────────────────────────────────────────
  //
  // 現在入力中の “変更後卓番号” を保持
  const [numPadState, setNumPadState] = useState<{
    id: string;
    field: NumPadField;
    value: string;
  } | null>(null);

  const onNumPadPress = (char: string) => {
    if (!numPadState) return;
    setNumPadState((prev) => {
      if (!prev) return null;
      let newVal = prev.value;
      if (char === '←') {
        newVal = newVal.slice(0, -1);
      } else if (char === 'C') {
        newVal = '';
      } else {
        if (newVal.length < 3) {
          newVal = newVal + char;
        }
      }
      // Reflect typed digits immediately in the preset-table input
      if (prev.field === 'presetTable') {
        setNewTableTemp(newVal);
      }
      return { ...prev, value: newVal };
    });
  };

const onNumPadConfirm = () => {
  if (!numPadState) return;

  // ── プリセット卓番号を確定 ──────────────────
  if (numPadState.field === 'presetTable') {
    if (numPadState.value) {
      setPresetTables(prev => {
        const next = Array.from(
          new Set([...prev, numPadState.value])
        ).sort((a, b) => Number(a) - Number(b));
        nsSetJSON('presetTables', next);
        return next;
      });
      setNewTableTemp(''); // 表示用テキストリセット
    }
    setNumPadState(null);
    return;
  }

  // ── 卓番号変更モード（適用ボタンで送信） ──────────────────
  if (numPadState.field === 'targetTable') {
    if (numPadState.value) {
      const id = numPadState.id;
      const nextVal = numPadState.value;

      // pending に積む：old は現在の table、next は入力値
      setPendingTables(prev => {
        const oldTable = reservations.find(r => r.id === id)?.table ?? '';
        return { ...prev, [id]: { old: oldTable, next: nextVal } } as any;
      });

      // プレビュー用：行オブジェクトに pendingTable を入れて UI で視覚化
      setReservations(prev => prev.map(r => (
        r.id === id ? { ...r, pendingTable: nextVal } : r
      )));

      // 未選択なら選択状態にする（ハイライト表示のため）
      setTablesForMove(prev => (prev.includes(id) ? prev : [...prev, id]));
    }
    // Firestore 反映はしない。トーストも出さない。適用ボタンで commit する。
    setNumPadState(null);
    return;
  }

  // 新規予約入力用: テーブルと人数入力を反映
  if (numPadState.id === '-1' && numPadState.field === 'table') {
    setNewResTable(numPadState.value);
    setNumPadState(null);
    return;
  }
  if (numPadState.id === '-1' && numPadState.field === 'guests') {
    setNewResGuests(numPadState.value === '' ? '' : Number(numPadState.value));
    setNumPadState(null);
    return;
  }

  // ── 既存の通常確定処理 ─────────────────
  if (numPadState.field === 'table' || numPadState.field === 'guests') {
    updateReservationField(
      numPadState.id,
      numPadState.field,
      numPadState.value
    );
  }
  setNumPadState(null);
};

  const onNumPadCancel = () => {
    setNumPadState(null);
    setNewTableTemp('');
  };

  //
  // ─── 2.10 LocalStorage 操作 ────────────────────────────────
  //

  const addReservation = async (e: FormEvent) => {
    e.preventDefault();
    // --- Guard: make sure nextResId is non‑empty ---------------------------
    if (!nextResId || nextResId.trim() === '') {
      alert('内部エラー：予約IDが採番できませんでした。ページを再読み込みして下さい');
      return;
    }
    // --- Guard: allow either single table or multi-tables --------------------
    const hasAnyTable = (Array.isArray(newResTables) && newResTables.length > 0) || !!newResTable;
    if (
      !hasAnyTable ||                    // 卓番号（単一 or 複数）未入力
      !newResTime ||                     // 時刻未入力
      newResGuests === '' ||             // 人数未入力
      isNaN(Number(newResGuests)) ||     // 人数が数値でない
      nextResId === ''                   // ID が空  → 予約追加禁止
    ) {
      alert('卓番号・人数・ID を正しく入力してください');
      return;
    }

    // --- Robust ID assignment: ensure uniqueness vs current reservations ---
    const usedIds = new Set(reservations.map((r) => r.id));
    let idToUse = nextResId && nextResId.trim() !== '' ? nextResId : calcNextResIdFrom(reservations);
    // もし重複していたら次の空き番号までインクリメント
    while (usedIds.has(idToUse)) {
      idToUse = String(Number(idToUse || '0') + 1);
    }

    // primary table & tables payload for multi-table support
    const primaryTable = (Array.isArray(newResTables) && newResTables.length > 0) ? newResTables[0] : newResTable;
    const tablesPayload = (Array.isArray(newResTables) && newResTables.length > 0) ? newResTables : (newResTable ? [newResTable] : []);

    const inputCourse = String(newResCourse ?? '').trim();
    const selectedCourseLabel = String(selectedCourse ?? '').trim();
    const firstCourseLabel =
      Array.isArray(courses) && courses[0]?.name ? String(courses[0].name).trim() : '';
    const courseLabel = inputCourse || selectedCourseLabel || firstCourseLabel || '未選択';

    const newEntry: Reservation = {
      id: idToUse,
      table: String(primaryTable || ''),
      tables: tablesPayload.map(String),
      time: newResTime,
      date: new Date().toISOString().slice(0, 10),
      course: courseLabel,
      eat: newResEat,
      drink: newResDrink,
      guests: Number(newResGuests),
      name: newResName.trim(),
      memo: newResNotes.trim(),
      notes: newResNotes.trim(),
      completed: {},
    };

    // 1) 画面 & localStorage を即時更新
    setReservations(prev => {
      const next = [...prev, newEntry];
      persistReservations(next);
      writeReservationsCache(next);
      return next;
    });
    setNextResId(String(Number(idToUse) + 1));

    // 2) Firestore へは常に投げる（オフライン時は SDK が自動キュー）
    try {
      await addReservationFS(newEntry as any);
    } catch (err) {
      // オフラインや一時的なネットワークエラー時でも SDK がキューイングする
      console.error('addReservationFS failed (queued if offline):', err);
    }

    // 3) 入力フォームリセット
    setNewResTables([]);
    setNewResTable('');
    setNewResGuests('');
    setNewResCourse('未選択');
    setNewResName('');
    setNewResNotes('');
    setNewResEat('');
    setNewResDrink('');
  };

  // 1件だけ予約を削除（ローカル & Firestore）
  const deleteReservation = async (id: string) => {
    if (!confirm('この来店情報を削除しますか？')) return;

    // 1) UI & localStorage から即時削除
    setReservations(prev => {
      const next = prev.filter(r => r.id !== id);
      persistReservations(next);
      writeReservationsCache(next);
      return next;
    });

    // 2) Firestore からも削除（オフライン時は SDK 側で自動キュー）
    try {
      await deleteReservationFS(id);
      toast.success('予約を削除しました');
    } catch (err) {
      console.error('deleteReservationFS failed (queued if offline):', err);
      toast('オフラインのため後でサーバへ送信します', { icon: '📶' });
    }
  };

  // 全予約をリセットして初期化 (localStorage & Firestore) ---------------------------
  const resetAllReservations = async () => {
    // --- ① confirm -----------------------------------------------------------------
    if (!confirm('すべての予約を削除して初期化しますか？')) return;

    // ② 現在の予約をコピー（Firestore batch 用）
    const current = [...reservations];

    /* ── ③ Firestore 側も一括削除 (オンライン時のみ) ----------------------------- */
    if (navigator.onLine) {
      try {
        await deleteAllReservationsFS();
      } catch (err) {
        console.warn('resetAllReservations: Firestore cleanup failed', err);
      }
    }

    // --- ④ ローカル状態 & キャッシュのクリア ----------------------------------------
    setReservations([]);
    writeReservationsCache([]);
    setNextResId('1');
    setCheckedArrivals([]);
    setCheckedDepartures([]);

    // localStorage 全消去
    localStorage.removeItem(RES_KEY);        // main 永続キー
    localStorage.removeItem(CACHE_KEY);      // バックアップ
    // 念のため既読用 join フラグは維持

    // --- ⑤ 完了通知 ------------------------------------------------------------------
    toast.success('予約をすべてリセットしました');
  };

  // --- 時間調整ハンドラ ---------------------------------------
  // 引数: 予約ID, タスクラベル, シフト量(±分)
  const adjustTaskTime = (resId: string, label: string, delta: number) => {
    // 無効な入力は無視（0やNaN等）
    if (!Number.isFinite(delta) || delta === 0) return;

    // ① ローカル state を即時更新（楽観的UI）
    setReservations(prev => {
      const next = prev.map(r => {
        if (r.id !== resId) return r;

        const current = r.timeShift?.[label] ?? 0;
        const updated = current + delta;

        return {
          ...r,
          timeShift: { ...(r.timeShift || {}), [label]: updated },
        };
      });

      // 永続化（localStorage / キャッシュ）
      persistReservations(next);
      writeReservationsCache(next);
      return next;
    });

    // ② Firestore へインクリメンタル同期（オフライン時はSDKが自動キュー）
    try {
      // 第3引数に差分を渡す形で timeShift を加算
      void (updateReservationFS as any)(resId, {}, { [label]: delta });
    } catch (err) {
      console.error('updateReservationFS(timeShift) failed (queued if offline):', err);
    }
  };

  // --- 時間調整：一括適用（将来バッチAPIに差し替えやすいように集約） ---
  const adjustTaskTimeBulk = (ids: string[], label: string, delta: number) => {
  if (!ids || ids.length === 0) return;
  if (!Number.isFinite(delta) || delta === 0) return;

  // ① ローカル state を一括更新（楽観的UI）
  setReservations(prev => {
    const idSet = new Set(ids);
    const next = prev.map(r => {
      if (!idSet.has(r.id)) return r;

      const current = r.timeShift?.[label] ?? 0;
      const updated = current + delta;

      return {
        ...r,
        timeShift: { ...(r.timeShift || {}), [label]: updated },
      };
    });

    persistReservations(next);
    writeReservationsCache(next);
    return next;
  });

  // ② Firestore 同期（各IDごとにインクリメント送信／オフライン時はSDKが自動キュー）
  ids.forEach(resId => {
    try {
      void (updateReservationFS as any)(resId, {}, { [label]: delta });
    } catch (err) {
      console.error('updateReservationFS(timeShift) failed (queued if offline):', err);
    }
  });
};

  // 対象卓の選択トグル（時間調整モード用）
  const toggleShiftTarget = (id: string) => {
    setShiftTargets(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // ==== memoized props for TasksSection to keep referential stability ====
  const tasksData = useMemo(() => ({
  groupedTasks,
  sortedTimeKeys,
  courses,
  // Tasksタブ専用の配列を渡す（エリア絞り込み後 & コース絞り込み後）
  filteredReservations: filteredReservationsTasks,
  firstRotatingId,
}), [groupedTasks, sortedTimeKeys, courses, filteredReservationsTasks, firstRotatingId]);

  // --- migrate legacy shared key → split keys (one-time) ---
  useEffect(() => {
    try {
      const legacy = nsGetStr('showTableStart', '');
      if (legacy) {
        // if new keys are not set, copy legacy value
        if (localStorage.getItem(`${ns}-cs_showTableStart`) === null) nsSetStr('cs_showTableStart', legacy);
        if (localStorage.getItem(`${ns}-tasks_showTable`) === null) nsSetStr('tasks_showTable', legacy);
      }
    } catch {}
  }, []);

  // --- ensure CourseStart flag persists to cs_showTableStart ---
  useEffect(() => {
    try { nsSetStr('cs_showTableStart', showTableStart ? '1' : '0'); } catch {}
  }, [showTableStart]);

  // --- Tasks tab: independent table-number visibility flag ---
  const [tasksShowTable, setTasksShowTable] = useState<boolean>(() => nsGetStr('tasks_showTable', '1') === '1');
  useEffect(() => {
    try { nsSetStr('tasks_showTable', tasksShowTable ? '1' : '0'); } catch {}
  }, [tasksShowTable]);

  const tasksUI = useMemo(() => ({
    showCourseAll,
    showGuestsAll,
    mergeSameTasks,
    taskSort,
    // タスク表は専用フラグを使う（CourseStart とは独立）
    showTableStart: tasksShowTable,
    selectionModeTask,
    shiftModeKey,
    selectedForComplete,
    shiftTargets,
  }), [
    showCourseAll,
    showGuestsAll,
    mergeSameTasks,
    taskSort,
    tasksShowTable,
    selectionModeTask,
    shiftModeKey,
    selectedForComplete,
    shiftTargets,
  ]);

  const tasksActions = useMemo(() => ({
    setShowCourseAll,
    setShowGuestsAll,
    setMergeSameTasks,
    setTaskSort,
    setSelectionModeTask,
    setSelectedForComplete,
    setShiftModeKey,
    setShiftTargets,
    batchAdjustTaskTime,
    updateReservationField,
  }), [
    setShowCourseAll,
    setShowGuestsAll,
    setMergeSameTasks,
    setTaskSort,
    setSelectionModeTask,
    setSelectedForComplete,
    setShiftModeKey,
    setShiftTargets,
    batchAdjustTaskTime,
    updateReservationField,
  ]);

  return (
    <>
      {/* iOS Safe Area (Status Bar) cover: paint top inset with the same color */}
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 z-50 bg-slate-600"
        style={{ height: 'env(safe-area-inset-top)' }}
      />
      {/* Header with hamburger */}
      <header className="fixed top-0 left-0 w-full bg-slate-600 text-white z-50 p-2 shadow">
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
          className="text-2xl"
        >
          ☰
        </button>
      </header>
      {loading && <LoadingSpinner />}
      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Sidebar panel */}
          <div className="w-64 bg-gray-600 text-white p-4">
            <button
              onClick={() => setSidebarOpen(false)}
              aria-label="Close menu"
              className="text-xl mb-4"
            >
              ×
            </button>
            <ul className="space-y-2">
              <li>
                <button
                  onClick={() => {
                    setSelectedMenu('店舗設定画面');
                    setSidebarOpen(false);
                  }}
                  className="w-full text-left"
                >
                  店舗設定画面
                </button>
              </li>
              <li aria-hidden="true">
                <hr className="my-4 border-gray-600 opacity-50" />
              </li>
              <li className="mt-4">
                <button
                  onClick={() => {
                    setSelectedMenu('営業前設定');
                    setSidebarOpen(false);
                  }}
                  className="w-full text-left"
                >
                  営業前設定
                </button>
              </li>
              <li aria-hidden="true">
                <hr className="my-4 border-gray-600 opacity-50" />
              </li>
              <li className="mt-6 border-t border-gray-600 pt-4">
                <label className="flex items-center space-x-2 text-sm">
                  <input
                    type="checkbox"
                    checked={remindersEnabled}
                    onChange={handleRemindersToggle}
                    disabled={notiBusy}
                  />
                  <span>通知（taskEvents 送信）を有効化</span>
                  {notiBusy && <span className="ml-2 opacity-70">設定中...</span>}
                </label>
              </li>
            </ul>
          </div>
          {/* Backdrop */}
          <div
            className="flex-1 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
        </div>
      )}
      <main className="pt-12 p-4 space-y-6 pb-24">
        
      
      {/* ─────────────── 店舗設定セクション ─────────────── */}
      {selectedMenu === '店舗設定画面' && (
        <StoreSettingsContent
  value={settingsDraft}
  onChange={patchSettings}
  onSave={handleStoreSave}
  isSaving={isSavingSettings}
  baseline={baselineSettings}
/>
      )}

      {/* ─────────────── 営業前設定セクション ─────────────── */}
      {(selectedMenu === '営業前設定') && (
        <PreopenSettingsContent
          // --- コース/ポジション ---
          courses={courses}
          positions={positions}
          selectedCourse={selectedCourse}

          // --- タスク可視フィルター＆ポジション別の表示タスク設定 ---
          checkedTasks={checkedTasks}
          setCheckedTasks={setCheckedTasks}
          tasksByPosition={tasksByPosition}
          toggleTaskForPosition={toggleTaskForPosition}
          selectedDisplayPosition={selectedDisplayPosition}
          setSelectedDisplayPosition={setSelectedDisplayPosition}
          displayTaskCourse={displayTaskCourse}
          setDisplayTaskCourse={setDisplayTaskCourse}

          // --- 卓番号プリセット＆フィルタ（「表示する卓」） ---
          presetTables={presetTablesView}
          checkedTables={checkedTables}
          setCheckedTables={setCheckedTables}

          // --- エリア（和集合一括選択用） ---
          areas={usableAreas}
          ns={ns}
        />
      )}
      
      {/* ─────────────── 予約リストセクション ─────────────── */}
{!isSettings && bottomTab === 'reservations' && (
  <ReservationsSection
    storeId={id}
    dayStartMs={startOfDayMs(dayStartMs)}
    /* 並び順 */
    resOrder={resOrder}
    setResOrder={setResOrder}
    /* アクション */
    resetAllReservations={resetAllReservations}
    /* 卓番編集 */
    editTableMode={editTableMode}
    onToggleEditTableMode={onToggleEditTableMode}
    tablesForMove={tablesForMove}
    pendingTables={pendingTables}
    toggleTableForMove={toggleTableForMove}
    setPendingTables={setPendingTables}
    commitTableMoves={commitTableMoves}
    /* Numpad */
    setNumPadState={setNumPadState}
    /* 列表示 */
    showEatCol={showEatCol}
    setShowEatCol={setShowEatCol}
    showDrinkCol={showDrinkCol}
    setShowDrinkCol={setShowDrinkCol}
    showNameCol={showNameCol}
    setShowNameCol={setShowNameCol}
    showNotesCol={showNotesCol}
    setShowNotesCol={setShowNotesCol}
    showGuestsCol={showGuestsCol}
    /* 行更新/削除 */
    updateReservationField={updateReservationFieldCb}
    deleteReservation={deleteReservationCb}
    /* チェック */
    toggleArrivalChecked={toggleArrivalChecked}
    togglePaymentChecked={togglePaymentChecked}
    toggleDepartureChecked={toggleDepartureChecked}
    checkedArrivals={checkedArrivals}
    checkedPayments={checkedPayments}
    checkedDepartures={checkedDepartures}
    firstRotatingId={firstRotatingId}
    /* 選択肢 */
    timeOptions={timeOptions}
    courses={courses}
    eatOptions={eatOptions}
    drinkOptions={drinkOptions}
    /* 新規行 */
    newResTime={newResTime}
    setNewResTime={setNewResTime}
    newResTable={newResTable}
    newResName={newResName}
    setNewResName={setNewResName}
    newResCourse={newResCourse}
    setNewResCourse={setNewResCourse}
    newResEat={newResEat}
    setNewResEat={setNewResEat}
    newResDrink={newResDrink}
    setNewResDrink={setNewResDrink}
    newResGuests={newResGuests}
    setNewResGuests={setNewResGuests}
    newResNotes={newResNotes}
    setNewResNotes={setNewResNotes}
    addReservation={addReservationCb}
    /* データ */
    reservations={filteredByTables}

    editedMarks={editedMarks}
    setEditedMarks={setEditedMarks}
  />
)}
{/* ───────────── スケジュール（外部コンポーネント） start ─────────────  */}
{!isSettings && bottomTab === 'schedule' && (
  <div className="-mx-4">
      <ScheduleView
    scheduleStartHour={scheduleStartHour}
scheduleEndHour={scheduleEndHour}
      storeSettings={settingsDraft}
      dayStartMs={startOfDayMs(dayStartMs)}
      items={scheduleItems}
      coursesOptions={courses}
      tablesOptions={presetTablesView}
      eatOptions={eatOptions}
      drinkOptions={drinkOptions}
      reservations={reservations}
      onSave={async (data, id) => {
        if (id) {
          await updateReservationMut(id, data);
        } else {
          await createReservationMut(data);
        }
      }}
      onDelete={async (id) => {
        await deleteReservationMut(id);
      }}
      onUpdateReservationField={updateReservationFieldCb}
      onAdjustTaskTime={adjustTaskTime}
      onToggleArrival={toggleArrivalChecked}
      onTogglePayment={togglePaymentChecked}
      onToggleDeparture={toggleDepartureChecked}
    />
  </div>
)}
{/* ───────────── タスク表セクション（外部コンポーネント） start ───────────── */}
{!isSettings && bottomTab === 'tasks' && (
  <div className="">
    <TasksSection
  data={tasksData}
  ui={tasksUI}
  actions={tasksActions}
  filterArea={filterArea}
  setFilterArea={setFilterArea}
  areas={areas ?? []}
  // 既存の並び替え等はそのまま
  taskSort={taskSort}
  setTaskSort={setTaskSort}
/>
  </div>
)}
      {/* ─────────────── 5. 数値パッドモーダル ─────────────── */}
      {numPadState && (
      <RootNumPad
        open={!!numPadState}
          multi={numPadState.id === '-1' && numPadState.field === 'table'}
          initialList={numPadState.id === '-1' && numPadState.field === 'table' ? newResTables : []}
          value={numPadState.value || ''}
          onCancel={() => setNumPadState(null)}
          onSubmit={({ value, list }) => {
            const st = numPadState!;
            // 1) 新規予約の卓番号（複数卓対応）
            if (st.id === '-1' && st.field === 'table') {
              const final = (Array.isArray(list) && list.length > 0) ? list : (value ? [value] : []);
              setNewResTables(final);
              setNewResTable(final[0] ?? '');
              setNumPadState(null);
              return;
            }
            // 2) 新規予約の人数（単一値）
            if (st.id === '-1' && st.field === 'guests') {
              const n = Number(value || '0');
              setNewResGuests(Number.isFinite(n) ? n : 0);
              setNumPadState(null);
              return;
            }
            // 3) 既存レコード: 直接反映（通常の単発変更）
            if (st.field === 'table' || st.field === 'targetTable') {
              const v = (Array.isArray(list) && list.length > 0) ? String(list[0]) : String(value || '');
              if (v) updateReservationField(st.id, 'table', v);
              setNumPadState(null);
              return;
            }
            if (st.field === 'guests') {
              const n = Number(value || '0');
              updateReservationField(st.id, 'guests', Number.isFinite(n) ? n : 0);
              setNumPadState(null);
              return;
            }
            setNumPadState(null);
          }}
        />
      )}

     
{/* ─────────────── コース開始時間表セクション ─────────────── */}

{!isSettings && bottomTab === 'courseStart' && (
  <CourseStartSection
  groupedStartTimes={groupedStartTimes}
  showTableStart={showTableStart}
  setShowTableStart={setShowTableStart}
  courseStartFiltered={courseStartFiltered}
  setCourseStartFiltered={setCourseStartFiltered}
  filterCourse={csFilterCourse}
  setFilterCourse={setCsFilterCourse}
  courses={courses}
  showGuestsAll={csShowGuestsAll}          // ← CS 専用を渡す
  rotatingTables={rotatingTables as any}
  firstRotatingId={firstRotatingId as any}
  startSort={csStartSort}
  setStartSort={setCsStartSort}
/>
)}
   
{/* ─────────────── テーブル管理セクション ─────────────── */}

 {/* ─ BottomTab: 予約リスト / タスク表 / コース開始時間表 ─ */}
<footer className="fixed bottom-0 inset-x-0 z-50 bg-white border-t">
  <div className="max-w-6xl mx-auto grid grid-cols-4">
    <button
      type="button"
      onClick={() => handleBottomTabClick('reservations')}
      className={[
        'py-3 text-sm font-medium',
        bottomTab === 'reservations'
          ? 'text-blue-600'
          : 'text-gray-600 hover:bg-gray-50'
      ].join(' ')}
      aria-pressed={bottomTab === 'reservations'}
    >
      予約リスト
    </button>
    {/* ▼ スケジュールタブ */}
<button
  type="button"
  onClick={() => handleBottomTabClick('schedule')}
  className={[
    'py-3 text-sm font-medium border-l border-r',
    bottomTab === 'schedule' ? 'text-blue-600' : 'text-gray-600 hover:bg-gray-50',
  ].join(' ')}
  aria-pressed={bottomTab === 'schedule'}
>
  スケジュール
</button>
    <button
      type="button"
      onClick={() => handleBottomTabClick('tasks')}
      className={[
        'py-3 text-sm font-medium border-l border-r',
        bottomTab === 'tasks'
          ? 'text-blue-600'
          : 'text-gray-600 hover:bg-gray-50'
      ].join(' ')}
      aria-pressed={bottomTab === 'tasks'}
    >
      タスク表
    </button>
    <button
      type="button"
      onClick={() => handleBottomTabClick('courseStart')}
      className={[
        'py-3 text-sm font-medium',
        bottomTab === 'courseStart'
          ? 'text-blue-600'
          : 'text-gray-600 hover:bg-gray-50'
      ].join(' ')}
      aria-pressed={bottomTab === 'courseStart'}
    >
      コース開始時間表
    </button>
  </div>
</footer>
 </main>
    </>
  );
}

//
// ─────────────────────────────── EOF ────────────────────────────────────────────
//  
