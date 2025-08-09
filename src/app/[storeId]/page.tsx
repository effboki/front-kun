'use client';
export type NumPadField = 'table' | 'guests' | 'presetTable' | 'targetTable' | 'pendingTable';

import React from 'react';
import { useParams } from 'next/navigation';
import { toggleTaskComplete } from '@/lib/reservations';
import { renameCourseTx } from '@/lib/courses';
import { loadStoreSettings, saveStoreSettingsTx, db } from '@/lib/firebase';
import { flushQueuedOps } from '@/lib/firebase';
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-expressions */
// 📌 ChatGPT からのテスト編集: 拡張機能連携確認済み

import type { StoreSettings } from '@/types/settings';

import { useState, ChangeEvent, FormEvent, useMemo, useEffect, useRef } from 'react';
import { useRealtimeReservations } from '@/hooks/useRealtimeReservations';
import { useRealtimeStoreSettings } from '@/hooks/useRealtimeStoreSettings';
import { toast } from 'react-hot-toast';
import { dequeueAll} from '@/lib/opsQueue';
import { addReservationFS, updateReservationFS, deleteReservationFS, fetchAllReservationsOnce, deleteAllReservationsFS } from '@/lib/reservations';

/* ───── Loading Skeleton / Spinner ─────────────────────────── */
const LoadingSpinner: React.FC = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-white/60 z-50">
    <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent" />
  </div>
);
//
// ───────────────────────────── ① TYPES ────────────────────────────────────────────
//

// タスク定義
type TaskDef = {
  timeOffset: number; // 分後 (0〜180)
  label: string;      // タスク名
  bgColor: string;    // 背景色 Tailwind クラス（少し透過気味）
};

// コース定義
type CourseDef = {
  name: string;
  tasks: TaskDef[];
};

// 予約(来店)情報
type Reservation = {
  id: string;
  table: string;       // 卓番 (文字列で OK)
  time: string;        // "HH:MM"
  date?: string;       // "YYYY-MM-DD"  ←追加
  course: string;      // コース名
    eat?: string;      // 食べ放題 (2文字)
  drink?: string;    // 飲み放題 (2文字)
  guests: number;      // 人数
  name: string;        // 追加：予約者氏名
  notes: string;       // 追加：備考
    pendingTable?: string;  // 追加: 卓変更プレビュー用
  completed: {         // 完了フラグ (キー: `${timeKey}_${taskLabel}_${course}`)
    [key: string]: boolean;
  };
  arrived?: boolean;   // 来店ボタン
  paid?: boolean;      // 会計ボタン
  departed?: boolean;  // 退店ボタン
  /** 個別タスクの時間シフト (label → ±分) */
  timeShift?: { [label: string]: number };
};

// ===== LocalStorage helpers (namespace per URL storeId) =====
function getStoreId(): string {
  if (typeof window === 'undefined') return 'default';
  const parts = window.location.pathname.split('/');
  return parts[1] || 'default';
}
function getNS(): string {
  return `front-kun-${getStoreId()}`;
}

// Reservation keys (namespace-aware)
const RES_KEY = `${getNS()}-reservations`;
const CACHE_KEY = `${getNS()}-reservations_cache`;

function loadReservations(): Reservation[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(RES_KEY) || '[]');
  } catch {
    return [];
  }
}

function persistReservations(arr: Reservation[]) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(RES_KEY, JSON.stringify(arr));
  }
}
// =================================

//
// ───────────────────────────── ② MAIN コンポーネント ─────────────────────────────────
//

export default function Home() {
  // URL から店舗IDを取得
  const params = useParams();
  const storeId = params?.storeId;
  // 読み込み前はフォールバック
  const id = typeof storeId === 'string' ? storeId : 'default';

  // 名前空間付き localStorage キー定義
  const ns        = `front-kun-${id}`;
  const RES_KEY   = `${ns}-reservations`;
  const CACHE_KEY = `${ns}-reservations_cache`;
  const SETTINGS_CACHE_KEY = `${ns}-settings-cache`; // settings + cachedAt
  // Sidebar open state
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  // 卓番変更モード用のステートを追加
  const [editTableMode, setEditTableMode] = useState<boolean>(false);

  // Hydration guard
  const [hydrated, setHydrated] = useState<boolean>(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  // 店舗設定（eatOptions / drinkOptions / positions …）をリアルタイム購読
  const storeSettings = useRealtimeStoreSettings(id);
  //
  // ───────── 食・飲 オプション ─────────
  //
  // 食べ放題/飲み放題設定セクションの開閉
  const [eatDrinkSettingsOpen, setEatDrinkSettingsOpen] = useState<boolean>(false);
const [eatOptions, setEatOptions] = useState<string[]>(
  () => {
    if (typeof window === 'undefined') return ['⭐︎', '⭐︎⭐︎'];
    try {
      return JSON.parse(localStorage.getItem(`${ns}-eatOptions`) || '["⭐︎","⭐︎⭐︎"]');
    } catch {
      return ['⭐︎', '⭐︎⭐︎'];
    }
  }
);
const [drinkOptions, setDrinkOptions] = useState<string[]>(
  () => {
    if (typeof window === 'undefined') return ['スタ', 'プレ'];
    try {
      return JSON.parse(localStorage.getItem(`${ns}-drinkOptions`) || '["スタ","プレ"]');
    } catch {
      return ['スタ', 'プレ'];
    }
  }
);
const [newEatOption, setNewEatOption]   = useState('');
const [newDrinkOption, setNewDrinkOption] = useState('');
// 保存用のuseEffect
useEffect(() => {
  localStorage.setItem(`${ns}-eatOptions`, JSON.stringify(eatOptions));
}, [eatOptions]);

useEffect(() => {
  localStorage.setItem(`${ns}-drinkOptions`, JSON.stringify(drinkOptions));
}, [drinkOptions]);

  //
  // ─── 2.2 予約(来店) の状態管理 ────────────────────────────────────────────
  //
  const [reservations, setReservations] = useState<Reservation[]>(loadReservations());

  // ── Early loading guard ───────────────────────────────
  const loading = !hydrated || storeSettings === null;
  const [nextResId, setNextResId] = useState<string>("1");
  // --- keep nextResId in sync with current reservation count ---
  useEffect(() => {
    // 予約が 0 件なら必ず 1 から開始する
    if (reservations.length === 0 && nextResId !== '1') {　  setNextResId('1');
    }
  }, [reservations]);
  // 予約ID → { old, next } を保持（卓番変更プレビュー用）
const [pendingTables, setPendingTables] =
  useState<Record<string, { old: string; next: string }>>({});


  // Firestore リアルタイム listener (常時購読)
  const liveReservations = useRealtimeReservations(id);

  // 🔄 スナップショットが来るたびに reservations を上書き
  useEffect(() => {
    setReservations(liveReservations as any);
  }, [liveReservations]);

  // ─── (先読み) localStorage の settings キャッシュをロード ─────────────
  useEffect(() => {
    if (storeSettings) return; // Firestore から来たら不要
    try {
      const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw) as { cachedAt: number; data: any };
      const cached = obj?.data as Partial<StoreSettings>;
      if (!cached) return;

      // 最低限 eat/drinkOptions / positions / tasksByPosition を復元
      setEatOptions(cached.eatOptions ?? []);
      setDrinkOptions(cached.drinkOptions ?? []);
      if (cached.positions) setPositions(cached.positions);
      if (cached.tasksByPosition) setTasksByPosition(cached.tasksByPosition);
    } catch (err) {
      console.warn('SETTINGS_CACHE_KEY parse failed', err);
    }
  }, [storeSettings]);

  // ─── Firestore からの店舗設定を UI State へ反映 ─────────────────
  useEffect(() => {
    if (!storeSettings) return; // まだ取得前

    // ① 既存キャッシュの timestamp を取得（無ければ 0）
    let cachedAt = 0;
    try {
      const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
      if (raw) cachedAt = JSON.parse(raw).cachedAt ?? 0;
    } catch { /* ignore */ }

    // ② Firestore データの更新時刻を取得（無ければ 0）
    //    Firestore 側で `updatedAt` (number: milliseconds) を持っている前提
    const fsUpdated = (storeSettings as any).updatedAt ?? 0;

    // ③ キャッシュが新しい場合は UI を上書きせずスキップ
    if (cachedAt >= fsUpdated && fsUpdated !== 0) {
      console.info('[page] skip firestore -> state (cache newer)');
      return;
    }

    // ④ Firestore を優先して UI & localStorage を更新
    // eatOptions / drinkOptions
    setEatOptions(storeSettings.eatOptions ?? []);
    localStorage.setItem(`${ns}-eatOptions`, JSON.stringify(storeSettings.eatOptions ?? []));

    setDrinkOptions(storeSettings.drinkOptions ?? []);
    localStorage.setItem(`${ns}-drinkOptions`, JSON.stringify(storeSettings.drinkOptions ?? []));

    // courses
    if (storeSettings.courses && storeSettings.courses.length > 0) {
      setCourses(storeSettings.courses as any);
      localStorage.setItem(`${ns}-courses`, JSON.stringify(storeSettings.courses));
    }

    // tables
    if (storeSettings.tables && storeSettings.tables.length > 0) {
      setPresetTables(storeSettings.tables as any);
      localStorage.setItem(`${ns}-presetTables`, JSON.stringify(storeSettings.tables));
    }

    // positions
    setPositions(storeSettings.positions ?? []);
    localStorage.setItem(`${ns}-positions`, JSON.stringify(storeSettings.positions ?? []));

    // tasksByPosition
    setTasksByPosition(storeSettings.tasksByPosition ?? {});
    localStorage.setItem(
      `${ns}-tasksByPosition`,
      JSON.stringify(storeSettings.tasksByPosition ?? {})
    );

    // ⑤ キャッシュ更新
    localStorage.setItem(
      SETTINGS_CACHE_KEY,
      JSON.stringify({ cachedAt: Date.now(), data: storeSettings })
    );
  }, [storeSettings]);


  // ─── Firestore 初回 1 read → localStorage キャッシュ ───
  useEffect(() => {
    if (!navigator.onLine) return;           // オフラインならスキップ
    (async () => {
      try {
        const list = await fetchAllReservationsOnce();
        if (list.length) {
          persistReservations(list as any);
          setReservations(list as any);
          const maxId = list.reduce(
            (m: number, r: any) => (Number(r.id) > m ? Number(r.id) : m),
            0
          );
          setNextResId((maxId + 1).toString());
        }
      } catch (err) {
        console.error('fetchAllReservationsOnce failed', err);
      }
    })();
  }, []);
  const hasLoadedStore = useRef(false); // 店舗設定を 1 回だけ取得
  const [selectedMenu, setSelectedMenu] = useState<string>('予約リスト×タスク表');
/* ─────────────── 卓番変更用 ─────────────── */
const [tablesForMove, setTablesForMove] = useState<string[]>([]); // 変更対象
// 現在入力中の “変更後卓番号”
const [targetTable, setTargetTable] = useState<string>('');
// 変更確定処理
const commitTableMoves = () => {
  const entries = Object.entries(pendingTables);
  if (entries.length === 0) return;

  const moveDocs: { id: string; old: string; new: string }[] = [];   // ←①

  // Firestore & local 更新
  entries.forEach(([idStr, { old, next }]) => {                     // ←②
    moveDocs.push({ id: idStr, old, new: next });           // ←③
    updateReservationField(idStr, 'table', next);
  });

  // 後片付け
  setPendingTables({});
  setTablesForMove([]);
  setEditTableMode(false);

  // 予約オブジェクトから preview 用フィールドを除去
  setReservations(prev => prev.map(r => ({ ...r, pendingTable: undefined })));

  toast.success('卓番号の変更を反映しました');
};
// 選択トグル用ユーティリティ
const toggleTableForMove = (id: string) => {
  setTablesForMove(prev =>
    prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
  );
};
　/* ──────────────────────────────── */
  // 店舗設定タブを初めて開いたときのみ Firestore を 1 read
  useEffect(() => {
    if (selectedMenu === '店舗設定画面' && !hasLoadedStore.current) {
      (async () => {
        try {
          const data = await loadStoreSettings();
          if (data) {
            // only override if saved courses exist
            if (data.courses && data.courses.length > 0) {
              setCourses(data.courses);
            }
            // only override if saved tables exist
            if (data.tables && data.tables.length > 0) {
              setPresetTables(data.tables);
            }
            // positions や tasksByPosition を同期したい場合はここで上書き
          }
        } catch (err) {
          console.warn('loadStoreSettings failed, fallback to local cache', err);
        } finally {
          hasLoadedStore.current = true;
        }
      })();
    }
  }, [selectedMenu]);
  // --- 店舗設定を Firestore に保存して閉じる ----------------------------
  const handleStoreSave = async () => {
    await toast.promise(
      saveStoreSettingsTx({
        eatOptions,
        drinkOptions,
        courses,
        tables: presetTables,
        positions,
        tasksByPosition,
      }),
      {
        loading: '保存中…',
        success: '店舗設定を保存しました',
        error: '保存に失敗しました（オフライン中かもしれません）',
      }
    );
    // Always write current courses array to localStorage
    localStorage.setItem(`${ns}-courses`, JSON.stringify(courses));

    // 最新設定を Firestore から再取得し、eatOptions/drinkOptions/positions/tasksByPosition を再セット
    try {
      // 型定義が追いついていないため any キャストで拡張プロパティを参照
      const latest = (await loadStoreSettings()) as {
        eatOptions: string[];
        drinkOptions: string[];
        courses: any[];
        tables: any[];
        positions?: string[];
        tasksByPosition?: Record<string, Record<string, string[]>>;
      };
      // eatOptions
      if (Array.isArray(latest.eatOptions) && latest.eatOptions.length > 0) {
        setEatOptions(latest.eatOptions);
        localStorage.setItem(`${ns}-eatOptions`, JSON.stringify(latest.eatOptions));
      }
      // drinkOptions
      if (Array.isArray(latest.drinkOptions) && latest.drinkOptions.length > 0) {
        setDrinkOptions(latest.drinkOptions);
        localStorage.setItem(`${ns}-drinkOptions`, JSON.stringify(latest.drinkOptions));
      }
      // positions
      if (Array.isArray(latest.positions) && latest.positions.length > 0) {
        setPositions(latest.positions);
        localStorage.setItem(`${ns}-positions`, JSON.stringify(latest.positions));
      }
      // tasksByPosition
      if (
        latest.tasksByPosition &&
        typeof latest.tasksByPosition === 'object'
      ) {
        setTasksByPosition(latest.tasksByPosition);
        localStorage.setItem(
          `${ns}-tasksByPosition`,
          JSON.stringify(latest.tasksByPosition)
        );
      }
    } catch (err) {
      // 取得失敗時は無視
    }
    // 保存後は設定画面を閉じてメイン画面へ戻る
    setSelectedMenu('営業前設定');
  };
  // ----------------------------------------------------------------------
  // ─────────────── 追加: コントロールバー用 state ───────────────
  const [showCourseAll, setShowCourseAll] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true; // default: 表示ON
    return localStorage.getItem(`${ns}-showCourseAll`) !== '0';
  });
  const [showGuestsAll, setShowGuestsAll] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true; // default: 表示ON
    return localStorage.getItem(`${ns}-showGuestsAll`) !== '0';
  });
  // 「コース開始時間表」でコース名を表示するかどうか
  const [showCourseStart, setShowCourseStart] = useState<boolean>(true);
  // 「コース開始時間表」で卓番を表示するかどうか
const [showTableStart, setShowTableStart] = useState<boolean>(true);  
  const [mergeSameTasks, setMergeSameTasks] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false; // default: OFF
    return localStorage.getItem(`${ns}-mergeSameTasks`) === '1';
  });
  const [taskSort, setTaskSort] = useState<'table' | 'guests'>('table');
  const [filterCourse, setFilterCourse] = useState<string>('全体');

  // ▼ Control Center toggles — persist to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`${ns}-showCourseAll`, showCourseAll ? '1' : '0');
    }
  }, [showCourseAll]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`${ns}-showGuestsAll`, showGuestsAll ? '1' : '0');
    }
  }, [showGuestsAll]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`${ns}-mergeSameTasks`, mergeSameTasks ? '1' : '0');
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
  // ─── 2.4 時刻操作ヘルパー ────────────────────────────────────────────────────
  //

  const parseTimeToMinutes = (time: string): number => {
    const [hh, mm] = time.split(':').map(Number);
    return hh * 60 + mm;
  };
  const formatMinutesToTime = (minutes: number): string => {
    const hh = Math.floor(minutes / 60);
    const mm = minutes % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
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

const togglePaymentChecked = (id: string) => {
  setCheckedPayments(prev => {
    const paidNow = !prev.includes(id);
    updateReservationField(id, 'paid', paidNow);
    return paidNow ? [...prev, id] : prev.filter(x => x !== id);
  });
};

  // 来店チェック切り替え用ヘルパー
  const toggleArrivalChecked = (id: string) => {
    setCheckedArrivals(prev => {
      const arrivedNow = !prev.includes(id);
      updateReservationField(id, 'arrived', arrivedNow);
      return arrivedNow ? [...prev, id] : prev.filter(x => x !== id);
    });
  };
  // 退店チェック切り替え用ヘルパー
  const toggleDepartureChecked = (id: string) => {
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

  // 初期レンダリング時は必ず defaultCourses で一致させる（SSR ↔ CSR）
  const [courses, setCourses] = useState<CourseDef[]>(defaultCourses);

  // CSR でのみ localStorage を参照して上書き（Hydration mismatch 回避）
  useEffect(() => {
  if (typeof window === 'undefined') return;
  const stored = localStorage.getItem(`${ns}-courses`);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as CourseDef[];
      // 「配列かつ１件以上」の場合のみ反映
      if (Array.isArray(parsed) && parsed.length > 0) {
        setCourses(parsed);
      }
    } catch {
      /* ignore */
    }
  }
}, []);

  // ─── コース一覧が変わった時、選択中コース名を自動補正 ───
  useEffect(() => {
    if (courses.length === 0) return;

    // ① タスク編集用 selectedCourse
    if (!courses.some(c => c.name === selectedCourse)) {
      const fallback = courses[0].name;
      setSelectedCourse(fallback);
      localStorage.setItem(`${ns}-selectedCourse`, fallback);
    }

    // ② タスク表示用 displayTaskCourse
    if (!courses.some(c => c.name === displayTaskCourse)) {
      setDisplayTaskCourse(courses[0].name);
    }
  }, [courses]);


  // 選択中のコース名 (タスク設定用)
  const [selectedCourse, setSelectedCourse] = useState<string>(() => {
    if (typeof window === 'undefined') return 'スタンダード';
    return localStorage.getItem(`${ns}-selectedCourse`) || 'スタンダード';
  });
  // タスク設定セクションの開閉
  const [courseTasksOpen, setCourseTasksOpen] = useState<boolean>(false);
  // 編集中の既存タスク (offset と label で一意に判定)
  const [editingTask, setEditingTask] = useState<{ offset: number; label: string } | null>(null);
  // タスク追加用フィールド
  const [newTaskLabel, setNewTaskLabel] = useState<string>('');
  const [newTaskOffset, setNewTaskOffset] = useState<number>(0);

  // “表示タスクフィルター” 用チェック済みタスク配列
  const [checkedTasks, setCheckedTasks] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(`${ns}-checkedTasks`);
    return stored ? JSON.parse(stored) : [];
  });

  // ⬇︎ keep “表示タスクフィルター” の選択状態を永続化
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(`${ns}-checkedTasks`, JSON.stringify(checkedTasks));
  }, [checkedTasks]);


  // 新規予約入力用フィールド（卓番・時刻・コース・人数・氏名・備考）
  const [newResTable, setNewResTable] = useState<string>('');
  const [newResTime, setNewResTime] = useState<string>('18:00');
  const [newResCourse, setNewResCourse] = useState<string>('');   // 未選択で開始
  const [newResGuests, setNewResGuests] = useState<number | ''>('');
  const [newResName, setNewResName] = useState<string>('');   // タブレット用：予約者氏名
  const [newResNotes, setNewResNotes] = useState<string>(''); // タブレット用：備考
  const [newResEat,   setNewResEat]   = useState<string>(''); // 食べ放題
const [newResDrink, setNewResDrink] = useState<string>(''); // 飲み放題

  // 来店入力セクションの開閉
  const [resInputOpen, setResInputOpen] = useState<boolean>(false);
  // 来店入力：氏名表示・備考表示（タブレット専用）
  const [showNameCol, setShowNameCol] = useState<boolean>(true);
  const [showNotesCol, setShowNotesCol] = useState<boolean>(true);
  // 来店入力：食べ放題・飲み放題表示
  // ── 食 / 飲 列の表示フラグ（localStorage ←→ state）────────────────────
const [showEatCol, setShowEatCol] = useState<boolean>(() => {
  if (typeof window === 'undefined') return true;              // SSR 時は true
  return localStorage.getItem(`${ns}-showEatCol`) !== '0'; // 未保存なら true
});
const [showDrinkCol, setShowDrinkCol] = useState<boolean>(() => {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(`${ns}-showDrinkCol`) !== '0';
});

// ON/OFF が変わるたびに localStorage へ保存
useEffect(() => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(`${ns}-showEatCol`, showEatCol ? '1' : '0');
  }
}, [showEatCol]);

useEffect(() => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(`${ns}-showDrinkCol`, showDrinkCol ? '1' : '0');
  }
}, [showDrinkCol]);
// ─────────────────────────────────────────────────────────────
  // 来店入力: 人数列を表示するかどうか
  const [showGuestsCol, setShowGuestsCol] = useState<boolean>(true);
  // 表示順選択 (table/time)
  const [resOrder, setResOrder] = useState<'table' | 'time'>(() => {
    if (typeof window === 'undefined') return 'table';
    return (localStorage.getItem(`${ns}-resOrder`) as 'table' | 'time') || 'table';
  });

  //
  // ─── 2.3 「店舗設定」関連の state ───────────────────────────────────────────
  //

  // “事前に設定する卓番号リスト” を管理
  const [presetTables, setPresetTables] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(`${ns}-presetTables`);
    return stored ? JSON.parse(stored) : [];
  });
  // 新規テーブル入力用 (numeric pad)
  const [newTableTemp, setNewTableTemp] = useState<string>('');
  // 卓設定セクション開閉
  const [tableSettingsOpen, setTableSettingsOpen] = useState<boolean>(false);
  // フロア図エディット用テーブル設定トグル
  const [tableConfigOpen, setTableConfigOpen] = useState<boolean>(false);
  // “フィルター表示する卓番号” 用チェック済みテーブル配列
  const [checkedTables, setCheckedTables] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(`${ns}-checkedTables`);
    return stored ? JSON.parse(stored) : [];
  });

  // ⬇︎ “表示する卓” フィルターも常に永続化
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(`${ns}-checkedTables`, JSON.stringify(checkedTables));
  }, [checkedTables]);

  // 「コース開始時間表」でポジション／卓フィルターを使うかどうか
  const [courseStartFiltered, setCourseStartFiltered] = useState<boolean>(true);
  // 営業前設定・タスクプレビュー用に表示中のコース
  const [displayTaskCourse, setDisplayTaskCourse] = useState<string>(() => courses[0]?.name || '');
  // ⏱ モード自動解除（ズレ防止）
  // 画面切替・フィルター変更・データ更新が起きたら時間調整モードを終了して選択をクリア
  useEffect(() => {
    if (shiftModeKey !== null || shiftTargets.length > 0) {
      setShiftModeKey(null);
      setShiftTargets([]);
    }
  }, [
    selectedMenu,          // タブ切替
    filterCourse,          // コース絞り込み
    checkedTables,         // 卓フィルタ
    checkedTasks,          // タスク可視フィルタ（その他）
    courseStartFiltered,   // コース開始時間表のフィルタ
    displayTaskCourse,     // プレビュー用の表示コース
    resOrder,              // 予約リストの並び順
    mergeSameTasks,        // タスクまとめ表示
    showCourseAll,
    showGuestsAll,
    showCourseStart,
    showTableStart,
    reservations           // データ更新（他端末/自端末）
  ]);
  // 卓リスト編集モード
  const [tableEditMode, setTableEditMode] = useState<boolean>(false);
  const [posSettingsOpen, setPosSettingsOpen] = useState<boolean>(false);
  // ─── ポジション設定 state ───
  const [positions, setPositions] = useState<string[]>(() => {
    const stored = typeof window !== 'undefined' && localStorage.getItem(`${ns}-positions`);
    return stored ? JSON.parse(stored) : ['フロント', 'ホール', '刺し場', '焼き場', 'オーブン', 'ストーブ', '揚げ場'];
  });
  const [newPositionName, setNewPositionName] = useState<string>('');
  // ポジションごと × コースごと でタスクを保持する  {pos: {course: string[]}}
  const [tasksByPosition, setTasksByPosition] =
    useState<Record<string, Record<string, string[]>>>(() => {
      if (typeof window === 'undefined') return {};
      const stored = localStorage.getItem(`${ns}-tasksByPosition`);
      if (!stored) return {};
      try {
        const parsed = JSON.parse(stored);
        // 旧フォーマット (pos -> string[]) を course:"*" に移行
        const isOldFormat =
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          Object.values(parsed).every((v) => Array.isArray(v));

        if (isOldFormat) {
          const migrated: Record<string, Record<string, string[]>> = {};
          Object.entries(parsed).forEach(([p, arr]) => {
            migrated[p] = { '*': arr as string[] };
          });
          return migrated;
        }
        return parsed;
      } catch {
        return {};
      }
    });
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
  const [courseByPosition, setCourseByPosition] = useState<Record<string, string>>(() => {
    const stored = typeof window !== 'undefined' && localStorage.getItem(`${ns}-courseByPosition`);
    if (stored) return JSON.parse(stored);
    // default to first course for each position
    const map: Record<string, string> = {};
    positions.forEach((pos) => {
      map[pos] = courses[0]?.name || '';
    });
    return map;
  });
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
        localStorage.setItem(
          `${ns}-courseByPosition`,
          JSON.stringify(next)
        );
        return next;
      }
      return prev;
    });
  }, [courses, positions]);
  const setCourseForPosition = (pos: string, courseName: string) => {
    const next = { ...courseByPosition, [pos]: courseName };
    setCourseByPosition(next);
    localStorage.setItem(`${ns}-courseByPosition`, JSON.stringify(next));
  };
  // 全コースからタスクラベル一覧を取得
  const allTasks = useMemo(() => {
    const labels = new Set<string>();
    courses.forEach((c) => c.tasks.forEach((t) => labels.add(t.label)));
    return Array.from(labels);
  }, [courses]);
  // ポジション操作ヘルパー
  const addPosition = () => {
    if (!newPositionName.trim() || positions.includes(newPositionName.trim())) return;
    const next = [...positions, newPositionName.trim()];
    setPositions(next);
    localStorage.setItem(`${ns}-positions`, JSON.stringify(next));
    setNewPositionName('');
    // --- 追加: courseByPosition / openPositions の初期化 -----------------
    // 新しく作ったポジションにはデフォルトで先頭のコースを割り当てる。
    const defaultCourse = courses[0]?.name || '';
    const nextCourseByPosition = {
      ...courseByPosition,
      [newPositionName.trim()]: defaultCourse,
    };
    setCourseByPosition(nextCourseByPosition);
    localStorage.setItem(
      `${ns}-courseByPosition`,
      JSON.stringify(nextCourseByPosition)
    );

    // openPositions にもエントリを追加しておく（初期状態は閉じる）
    setOpenPositions(prev => ({ ...prev, [newPositionName.trim()]: false }));
    // --------------------------------------------------------------------
  };
  const removePosition = (pos: string) => {
    const next = positions.filter((p) => p !== pos);
    setPositions(next);
    localStorage.setItem(`${ns}-positions`, JSON.stringify(next));
    const nextTasks = { ...tasksByPosition };
    delete nextTasks[pos];
    setTasksByPosition(nextTasks);
    localStorage.setItem(`${ns}-tasksByPosition`, JSON.stringify(nextTasks));
    // --- 追加: courseByPosition / openPositions から該当ポジションを削除 ----
    setCourseByPosition(prev => {
      const next = { ...prev };
      delete next[pos];
      localStorage.setItem(`${ns}-courseByPosition`, JSON.stringify(next));
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
      localStorage.setItem(`${ns}-positions`, JSON.stringify(next));
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
      localStorage.setItem(`${ns}-positions`, JSON.stringify(next));
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
      localStorage.setItem(`${ns}-positions`, JSON.stringify(next));
      return next;
    });
    // tasksByPosition のキーを更新
    setTasksByPosition(prev => {
      const next = { ...prev, [newName]: prev[pos] || {} };
      delete next[pos];
      localStorage.setItem(`${ns}-tasksByPosition`, JSON.stringify(next));
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
      localStorage.setItem(`${ns}-courseByPosition`, JSON.stringify(next));
      return next;
    });
  };
  // pos・course 単位でタスク表示をトグル
  const toggleTaskForPosition = (pos: string, courseName: string, label: string) => {
    setTasksByPosition(prev => {
      const courseTasks = prev[pos]?.[courseName] ?? [];
      const nextTasks = courseTasks.includes(label)
        ? courseTasks.filter(l => l !== label)
        : [...courseTasks, label];

      const nextPos = { ...(prev[pos] || {}), [courseName]: nextTasks };
      const next = { ...prev, [pos]: nextPos };
      localStorage.setItem(`${ns}-tasksByPosition`, JSON.stringify(next));
      return next;
    });
  };
  const [courseSettingsTableOpen, setCourseSettingsTableOpen] = useState<boolean>(false);
  // ─── 営業前設定タブのトグル state ───
  const [displayTablesOpen1, setDisplayTablesOpen1] = useState<boolean>(false);
  const [displayTablesOpen2, setDisplayTablesOpen2] = useState<boolean>(false);
  // ─── 営業前設定：表示タスク用選択中ポジション ───
  const [selectedDisplayPosition, setSelectedDisplayPosition] = useState<string>(() => {
    if (typeof window === 'undefined') return positions[0] || '';
    const saved = localStorage.getItem(`${ns}-selectedDisplayPosition`);
    return saved || (positions[0] || '');
  });

  // 永続化: 選択中ポジションが変わったら保存
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(`${ns}-selectedDisplayPosition`, selectedDisplayPosition);
  }, [selectedDisplayPosition]);

  // 位置リストが変わって、保存値が存在しない/不正になったら先頭へフォールバック
  useEffect(() => {
    if (!selectedDisplayPosition || !positions.includes(selectedDisplayPosition)) {
      const fallback = positions[0] || '';
      setSelectedDisplayPosition(fallback);
      if (typeof window !== 'undefined') {
        localStorage.setItem(`${ns}-selectedDisplayPosition`, fallback);
      }
    }
  }, [positions]);
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

  //
  // ─── 2.5 コース/タスク設定用イベントハンドラ ───────────────────────────────
  //

  // コース選択変更
  const handleCourseChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setSelectedCourse(e.target.value);
    localStorage.setItem(`${ns}-selectedCourse`, e.target.value);
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
        return {
          ...c,
          tasks: c.tasks.filter((t) => !(t.timeOffset === offset && t.label === label)),
        };
      });
      localStorage.setItem(`${ns}-courses`, JSON.stringify(next));
      return next;
    });
    setEditingTask(null);
  };

  // 既存タスク時間を ±5 分ずらす
  const shiftTaskOffset = (offset: number, label: string, delta: number) => {
    setCourses((prev) => {
      const next = prev.map((c) => {
        if (c.name !== selectedCourse) return c;
        const newTasks = c.tasks.map((t) => {
          if (t.timeOffset !== offset || t.label !== label) return t;
          const newOffset = Math.max(0, Math.min(180, t.timeOffset + delta));
          return { ...t, timeOffset: newOffset };
        });
        newTasks.sort((a, b) => a.timeOffset - b.timeOffset);
        return { ...c, tasks: newTasks };
      });
      localStorage.setItem(`${ns}-courses`, JSON.stringify(next));
      return next;
    });
    if (editingTask && editingTask.offset === offset && editingTask.label === label) {
      setEditingTask({ offset: Math.max(0, Math.min(180, offset + delta)), label });
    }
  };

  // 編集モード切り替え
  const toggleEditingTask = (offset: number, label: string) => {
    if (editingTask && editingTask.offset === offset && editingTask.label === label) {
      setEditingTask(null);
    } else {
      setEditingTask({ offset, label });
    }
  };

  // 新規タスクをコースに追加
  const addTaskToCourse = (label: string, offset: number) => {
    setCourses((prev) => {
      const next = prev.map((c) => {
        if (c.name !== selectedCourse) return c;
        if (c.tasks.some((t) => t.timeOffset === offset && t.label === label)) {
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
          ...c.tasks,
          { timeOffset: offset, label, bgColor: color },
        ];
        updatedTasks.sort((a, b) => a.timeOffset - b.timeOffset);
        return { ...c, tasks: updatedTasks };
      });
      localStorage.setItem(`${ns}-courses`, JSON.stringify(next));
      return next;
    });
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
    localStorage.setItem(`${ns}-courses`, JSON.stringify(next));
    return next;
  });

  // 選択中コース
  setSelectedCourse(newName);
  localStorage.setItem(`${ns}-selectedCourse`, newName);
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
    localStorage.setItem(`${ns}-courseByPosition`, JSON.stringify(next));
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
    localStorage.setItem(`${ns}-tasksByPosition`, JSON.stringify(next));
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
    localStorage.setItem(`${ns}-courses`, JSON.stringify(next));
    return next;
  });

  /* 2) フォールバック用コース名を取得 */
  const fallback = courses.find(c => c.name !== target)?.name || '';

  /* 3) 各選択中 state をフォールバック */
  setSelectedCourse(prev => (prev === target ? fallback : prev));
  setDisplayTaskCourse(prev => (prev === target ? fallback : prev));
  setNewResCourse(prev => (prev === target ? fallback : prev));

  /* 4) courseByPosition を更新 */
  setCourseByPosition(prev => {
    const next: Record<string, string> = {};
    Object.entries(prev).forEach(([pos, cname]) => {
      next[pos] = cname === target ? fallback : cname;
    });
    localStorage.setItem(`${ns}-courseByPosition`, JSON.stringify(next));
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
    localStorage.setItem(`${ns}-tasksByPosition`, JSON.stringify(next));
    return next;
  });

  toast.success(`「${target}」コースを削除しました`);
};

  // “表示タスクフィルター” のチェック操作
  const handleTaskCheck = (label: string) => {
    setCheckedTasks((prev) => {
      if (prev.includes(label)) {
        const next = prev.filter((l) => l !== label);
        localStorage.setItem(`${ns}-checkedTasks`, JSON.stringify(next));
        return next;
      } else {
        const next = [...prev, label];
        localStorage.setItem(`${ns}-checkedTasks`, JSON.stringify(next));
        return next;
      }
    });
  };

  // ─── 2.6c localStorage から予約バックアップを復元 ──────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached: Reservation[] = JSON.parse(raw);
        if (cached.length > 0) {
          setReservations(cached);
          const maxId = cached.reduce((m, x) => (Number(x.id) > m ? Number(x.id) : m), 0);
          setNextResId((maxId + 1).toString());
        }
      }
    } catch (err) {
      console.error('localStorage read error:', err);
    }
  }, []);

  // ─── 2.6d 予約が変わるたびに localStorage に保存 ──────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(reservations));
    } catch (err) {
      console.error('localStorage write error:', err);
    }
  }, [reservations]);
  //
  // ─── 2.7 “予約リストのソートとフィルター” ─────────────────────────────────────────
  //

  const sortedByTable = useMemo(() => {
    return [...reservations].sort((a, b) => Number(a.table) - Number(b.table));
  }, [reservations]);

  const sortedByTime = useMemo(() => {
    return [...reservations].sort((a, b) => {
      return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
    });
  }, [reservations]);

  // 表示順決定
  const sortedReservations = resOrder === 'time' ? sortedByTime : sortedByTable;

  // “事前設定テーブル” で選ばれたもののみ表示＋コース絞り込み
  const filteredReservations = useMemo(() => {
    return sortedReservations
      .filter((r) => {
        // Table filter
        if (checkedTables.length > 0 && !checkedTables.includes(r.table)) return false;
        // Course filter
        if (filterCourse !== '全体' && r.course !== filterCourse) return false;
        return true;
      });
  }, [sortedReservations, checkedTables, filterCourse, checkedDepartures]);

  /* ─── 2.x リマインド機能 state & ロジック ───────────────────────── */
  // 通知の ON/OFF
  const [remindersEnabled, setRemindersEnabled] = useState<boolean>(false);

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

  /** 「これから来るタスク」を時刻キーごとにまとめた配列
   *  [{ timeKey: "18:15", tasks: ["コース説明", "カレー"] }, ... ]
   */
  const upcomingReminders = useMemo<Array<{ timeKey: string; tasks: string[] }>>(() => {
    if (!filteredReservations.length) return [];
    const nowMin = parseTimeToMinutes(currentTime);

    const map: Record<string, Set<string>> = {};

    filteredReservations.forEach((res) => {
      const courseDef = courses.find((c) => c.name === res.course);
      if (!courseDef) return;
      const baseMin = parseTimeToMinutes(res.time);

      courseDef.tasks.forEach((t) => {
        const absMin = baseMin + t.timeOffset;
        // ---------- 表示タスクフィルター ----------
{
  const set = new Set<string>();
  checkedTasks.forEach((l) => set.add(l));
  if (selectedDisplayPosition !== 'その他') {
    const posObj = tasksByPosition[selectedDisplayPosition] || {};
    (posObj[courseByPosition[selectedDisplayPosition]] || []).forEach((l) => set.add(l));
  }
  if (set.size > 0 && !set.has(t.label)) return; // 非表示タスクはスキップ
}
// ------------------------------------------
        if (absMin < nowMin) return; // 既に過ぎているタスクは対象外
        const timeKey = formatMinutesToTime(absMin);
        if (!map[timeKey]) map[timeKey] = new Set();
        map[timeKey].add(t.label);
      });
    });

    // map → 配列へ変換し時刻順にソート
    return Object.entries(map)
      .sort((a, b) => parseTimeToMinutes(a[0]) - parseTimeToMinutes(b[0]))
      .map(([timeKey, set]) => ({ timeKey, tasks: Array.from(set) }));
  }, [filteredReservations, courses, currentTime]);

  // 回転テーブル判定: 同じ卓番号が複数予約されている場合、その卓は回転中とみなす
  const tableCounts: Record<string, number> = {};
  filteredReservations.forEach((r) => {
    tableCounts[r.table] = (tableCounts[r.table] || 0) + 1;
  });
  const rotatingTables = new Set(Object.keys(tableCounts).filter((t) => tableCounts[t] > 1));
  // 各回転テーブルごとに最初の予約IDを記録
  const firstRotatingId: Record<string, string> = {};
  filteredReservations.forEach((r) => {
    if (rotatingTables.has(r.table) && !(r.table in firstRotatingId)) {
      firstRotatingId[r.table] = r.id;
    }
  });


  //
  // ─── 2.8 “タスク表示用グルーピングロジック” ────────────────────────────────────────
  //

  // ─── コース開始時間表用グルーピング ─────────────────────────────
  const groupedStartTimes = useMemo(() => {
    const map: Record<string, Record<string, Reservation[]>> = {};
    const source = courseStartFiltered ? filteredReservations : sortedReservations;
source.forEach((r) => {
      // コース絞り込み
      if (filterCourse !== '全体' && r.course !== filterCourse) return;
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
  }, [filteredReservations, sortedReservations, filterCourse, courseStartFiltered]);

  type TaskGroup = {
    timeKey: string;
    label: string;
    bgColor: string;
    courseGroups: {
      courseName: string;
      reservations: Reservation[];
    }[];
  };

  const groupedTasks: Record<string, TaskGroup[]> = {};

  filteredReservations.forEach((res) => {
    // Skip tasks for departed reservations
    if (checkedDepartures.includes(res.id)) return;
    if (res.course === '未選択') return;
    const courseDef = courses.find((c) => c.name === res.course);
    if (!courseDef) return;
    courseDef.tasks.forEach((t) => {
      // === 営業前設定の「表示するタスク」フィルター ===========================
      // 「その他」タブ (checkedTasks) ＋ 選択中ポジション × コース(tasksByPosition)
      // の両方を合算し、含まれないタスクは描画しない
      const allowedTaskLabels = (() => {
        const set = new Set<string>();
        // その他タブでチェックされたタスク
        checkedTasks.forEach((l) => set.add(l));
        // 選択中ポジション側
        if (selectedDisplayPosition !== 'その他') {
          const posObj = tasksByPosition[selectedDisplayPosition] || {};
          (posObj[courseByPosition[selectedDisplayPosition]] || []).forEach((l) => set.add(l));
        }
        return set;
      })();
      if (allowedTaskLabels.size > 0 && !allowedTaskLabels.has(t.label)) return;
      const slot = calcTaskAbsMin(res.time, t.timeOffset, t.label, res.timeShift);
      const timeKey = formatMinutesToTime(slot);
      if (!groupedTasks[timeKey]) groupedTasks[timeKey] = [];
      let taskGroup = groupedTasks[timeKey].find((g) => g.label === t.label);
      if (!taskGroup) {
        taskGroup = { timeKey, label: t.label, bgColor: t.bgColor, courseGroups: [] };
        groupedTasks[timeKey].push(taskGroup);
      }
      let courseGroup = taskGroup.courseGroups.find((cg) => cg.courseName === res.course);
      if (!courseGroup) {
        courseGroup = { courseName: res.course, reservations: [] };
        taskGroup.courseGroups.push(courseGroup);
      }
      courseGroup.reservations.push(res);
    });
  });

  const sortedTimeKeys = Object.keys(groupedTasks).sort((a, b) => {
    return parseTimeToMinutes(a) - parseTimeToMinutes(b);
  });
  // ─── “リマインド用” 直近タイムキー（現在含む先頭4つ） ───
  const futureTimeKeys = useMemo(() => {
    const nowMin = parseTimeToMinutes(currentTime);
    return sortedTimeKeys
      .filter((tk) => parseTimeToMinutes(tk) >= nowMin)
      .slice(0, 4);
  }, [sortedTimeKeys, currentTime]);
  sortedTimeKeys.forEach((timeKey) => {
    groupedTasks[timeKey].sort((a, b) => {
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
    groupedTasks[timeKey].forEach((tg) => {
      tg.courseGroups.sort((x, y) => x.courseName.localeCompare(y.courseName));
    });
  });

  //
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
      // Reflect typed digits immediately in the preset-table input
      if (prev.field === 'presetTable') {
        setNewTableTemp(newVal);
      }
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
        localStorage.setItem(`${ns}-presetTables`, JSON.stringify(next));
        return next;
      });
      setNewTableTemp(''); // 表示用テキストリセット
    }
    setNumPadState(null);
    return;
  }

  // ── 卓番号変更モード ──────────────────
  if (numPadState.field === 'targetTable') {
    if (numPadState.value) {
      // NumPad で入力した卓番号を一時保存
      setTargetTable(numPadState.value);
      setPendingTables(prev => {
        const res = reservations.find(r => r.id === numPadState.id);
        if (!res) return prev;
        return {
          ...prev,
          [numPadState.id]: { old: res.table, next: numPadState.value },
        };
      });
    }
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
    if (
      !newResTable ||                      // 卓番号未入力
      !newResTime ||                       // 時刻未入力
      newResGuests === '' ||               // 人数未入力
      isNaN(Number(newResGuests)) ||       // 人数が数値でない
      !newResCourse ||                     // コース未選択
      nextResId === ''                     // ID が空  → 予約追加禁止
    ) {
      alert('卓番号・人数・コース・ID を正しく入力してください');
      return;
    }

    const newEntry: Reservation = {
      id: nextResId,
      table: newResTable,
      time: newResTime,
      date: new Date().toISOString().slice(0, 10), // ← 追加 今日の日付
      course: newResCourse,
        eat:   newResEat,
  　　　drink: newResDrink,
      guests: Number(newResGuests),
      name: newResName.trim(),
      notes: newResNotes.trim(),
      completed: {},
    };

    // 1) 画面 & localStorage を即時更新
    setReservations(prev => {
      const next = [...prev, newEntry];
      persistReservations(next);
      return next;
    });
    setNextResId(prev => {
      const base = prev && prev.trim() !== '' ? Number(prev) : 0;
      return (base + 1).toString();
    });

    // 2) Firestore への書込みはオンライン時のみ実行
    if (navigator.onLine) {
      try {
        await addReservationFS(newEntry as any);
      } catch (err) {
        console.error('addReservationFS failed:', err);
      }
    }

    // 3) 入力フォームリセット
    setNewResTable('');
    setNewResTime('18:00');
    setNewResGuests('');
    setNewResCourse('');
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
      return next;
    });

    // 2) Firestore からも削除
    if (navigator.onLine) {
      try {
        await deleteReservationFS(id);
        toast.success('予約を削除しました');
      } catch (err) {
        console.error('deleteReservationFS failed:', err);
        toast.error('サーバへの削除が失敗しました');
      }
    } else {
      // オフライン時はキュー投入済み
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

  const updateReservationField = (
    id: string,
    field:
      | 'time'
      | 'course'
      | 'eat'
      | 'drink'
      | 'guests'
      | 'name'
      | 'notes'
      | 'date'
      | 'table'
      | 'completed'
      | 'arrived'
      | 'paid'
      | 'departed',
    value: string | number | { [key: string]: boolean } | boolean
  ) => {
    setReservations(prev => {
      const next = prev.map(r => {
        if (r.id !== id) return r;
        if (field === 'guests') return { ...r, guests: Number(value) };
        else if (field === 'course') {
          const oldCourse = r.course;
          const newCourse = value as string;
          const migratedCompleted: { [key: string]: boolean } = {};
          Object.entries(r.completed || {}).forEach(([key, done]) => {
            if (key.endsWith(`_${oldCourse}`)) {
              const newKey = key.replace(new RegExp(`_${oldCourse}$`), `_${newCourse}`);
              migratedCompleted[newKey] = done;
            } else {
              migratedCompleted[key] = done;
            }
          });
          return { ...r, course: newCourse, completed: migratedCompleted };
        } else {
          return { ...r, [field]: value };
        }
      });
      persistReservations(next);

      // ── オンライン時は常に Firestore へ同期 ──
      if (navigator.onLine) {
        // 直前に読み取った version を baseVersion として取得
        const baseVersion = (prev.find(r => r.id === id) as any)?.version ?? 0;
        updateReservationFS(id, { [field]: value } as any, baseVersion).catch(err =>
          console.error('updateReservationFS failed:', err)
        );
      }

      return next;
    });
  };
  // ───────────────────────────────────────────────────────────

  // --- 時間調整ハンドラ ---------------------------------------
  // 引数: 予約ID, タスクラベル, シフト量(±分)
  const adjustTaskTime = (resId: string, label: string, delta: number) => {
    /* ① ローカル state & localStorage を即時更新 */
    setReservations(prev => {
      const next = prev.map(r => {
        if (r.id !== resId) return r;
        const currentShift = r.timeShift?.[label] ?? 0;
        const updatedShift = currentShift + delta;
        return {
          ...r,
          timeShift: { ...(r.timeShift || {}), [label]: updatedShift },
        };
      });
      persistReservations(next);
      return next;
    });

    /* ② Firestore へインクリメンタル更新（オンライン時のみ） */
    if (navigator.onLine) {
      updateReservationFS(resId, {}, { [label]: delta }).catch(err =>
        console.error('updateReservationFS(timeShift) failed:', err)
      );
    }
  };

  // --- 時間調整：一括適用（将来バッチAPIに差し替えやすいように集約） ---
  const adjustTaskTimeBulk = (ids: string[], label: string, delta: number) => {
    if (!ids || ids.length === 0) return;

    // 1) ローカル state を一括更新
    setReservations(prev => {
      const idSet = new Set(ids);
      const next = prev.map(r => {
        if (!idSet.has(r.id)) return r;
        const currentShift = r.timeShift?.[label] ?? 0;
        const updatedShift = currentShift + delta;
        return {
          ...r,
          timeShift: { ...(r.timeShift || {}), [label]: updatedShift },
        };
      });
      persistReservations(next);
      return next;
    });

    // 2) Firestore 同期（当面は1件ずつ。後でまとめAPIに置換）
    if (navigator.onLine) {
      ids.forEach(resId => {
        updateReservationFS(resId, {}, { [label]: delta }).catch(err =>
          console.error('updateReservationFS(timeShift) failed:', err)
        );
      });
    }
  };

  // 対象卓の選択トグル（時間調整モード用）
  const toggleShiftTarget = (id: string) => {
    setShiftTargets(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <>
      {/* Header with hamburger */}
      <header className="fixed top-0 left-0 w-full bg-white z-40 p-2 shadow">
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
          <div className="w-64 bg-gray-800 text-white p-4">
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
              <li className="mt-4">
                <button
                  onClick={() => {
                    setSelectedMenu('リマインド');
                    setSidebarOpen(false);
                  }}
                  className="w-full text-left"
                >
                  リマインド
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    setSelectedMenu('予約リスト×タスク表');
                    setSidebarOpen(false);
                  }}
                  className="w-full text-left"
                >
                  予約リスト×タスク表
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    setSelectedMenu('予約リスト×コース開始時間表');
                    setSidebarOpen(false);
                  }}
                  className="w-full text-left"
                >
                  予約リスト×コース開始時間表
                </button>
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
      <main className="pt-12 p-4 space-y-6">
        
      {/* ─────────────── 店舗設定セクション ─────────────── */}
      {selectedMenu === '店舗設定画面' && (
        <section>
          {/* コース設定表ボタンと内容を上に移動 */}
          <button
            onClick={() => setCourseSettingsTableOpen(prev => !prev)}
            className="w-full text-left p-2 font-semibold bg-gray-100 rounded text-sm"
          >
            {courseSettingsTableOpen ? '▼▼ コース設定表' : '▶▶ コース設定表'}
          </button>
          {courseSettingsTableOpen && (
            <div className="p-4 space-y-3 text-sm border rounded">
              {/* 設定中のコース・新コース作成 */}
              <div className="flex items-center space-x-2 mb-3">
                <label className="whitespace-nowrap">設定中のコース：</label>
                <select
                  value={selectedCourse}
                  onChange={handleCourseChange}
                  className="border px-2 py-1 rounded text-sm"
                >
                  {courses.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={renameCourse}
                  className="ml-2 px-3 py-1 bg-blue-500 text-white rounded text-sm"
                >
                  ✎ コース名変更
                </button>
                <button
                  onClick={deleteCourse}
                  className="ml-2 px-3 py-1 bg-red-600 text-white rounded text-sm"
                >
                  🗑 コース削除
                </button>
                <button
                  onClick={() => {
                    const courseName = prompt('新しいコース名を入力してください：');
                    if (!courseName) return;
                    if (courses.some((c) => c.name === courseName)) {
                      alert('そのコース名は既に存在します。');
                      return;
                    }
                    const next = [...courses, { name: courseName, tasks: [] }];
                    setCourses(next);
                    localStorage.setItem(`${ns}-courses`, JSON.stringify(next));
                    setSelectedCourse(courseName);
                  }}
                  className="ml-2 px-3 py-1 bg-green-500 text-white rounded text-sm"
                >
                  ＋新コース作成
                </button>
              </div>
            {(
              courses.find((c) => c.name === selectedCourse)?.tasks ?? []
            )
              .slice()
              .sort((a, b) => a.timeOffset - b.timeOffset)
              .map((task, idx) => (
                <div
                  key={`${task.timeOffset}_${idx}`}
                  className="flex flex-wrap items-center space-x-2 border-b pb-1"
                >
                  <div className="flex items-center space-x-1">
                    {editingTask &&
                    editingTask.offset === task.timeOffset &&
                    editingTask.label === task.label ? (
                      <>
                        <button
                          onClick={() =>
                            shiftTaskOffset(task.timeOffset, task.label, -5)
                          }
                          className="w-6 h-6 bg-gray-300 rounded text-sm"
                        >
                          -5
                        </button>
                        <span className="w-12 text-center">{task.timeOffset}分後</span>
                        <button
                          onClick={() =>
                            shiftTaskOffset(task.timeOffset, task.label, +5)
                          }
                          className="w-6 h-6 bg-gray-300 rounded text-sm"
                        >
                          +5
                        </button>
                      </>
                    ) : (
                      <span
                        onClick={() =>
                          toggleEditingTask(task.timeOffset, task.label)
                        }
                        className="w-20 cursor-pointer"
                      >
                        {task.timeOffset}分後
                      </span>
                    )}
                  </div>

                  <input
                    type="text"
                    value={task.label}
                    onChange={(e) => {
                      const newLabel = e.target.value;
                      setCourses((prev) => {
                        const next = prev.map((c) => {
                          if (c.name !== selectedCourse) return c;
                          const updatedTasks = c.tasks.map((t) =>
                            t.timeOffset === task.timeOffset && t.label === task.label
                              ? { ...t, label: newLabel }
                              : t
                          );
                          return { ...c, tasks: updatedTasks };
                        });
                        localStorage.setItem(`${ns}-courses`, JSON.stringify(next));
                        return next;
                      });
                      setEditingTask({ offset: task.timeOffset, label: newLabel });
                    }}
                    className="border px-2 py-1 rounded flex-1 text-sm"
                  />

                  <button
                    onClick={() => deleteTaskFromCourse(task.timeOffset, task.label)}
                    className="px-2 py-1 bg-red-500 text-white rounded text-xs order-1 sm:order-2"
                  >
                    削除
                  </button>
                </div>
              ))}

              <div className="pt-2 space-y-2">
                <div className="flex flex-wrap items-center space-x-2">
                  <input
                    type="text"
                    placeholder="タスク名"
                    value={newTaskLabel}
                    onChange={(e) => setNewTaskLabel(e.target.value)}
                    className="border px-2 py-1 flex-1 rounded text-sm"
                  />
                  <button
                    onClick={() => setNewTaskOffset((prev) => Math.max(0, prev - 5))}
                    className="w-8 h-8 bg-gray-300 rounded text-sm"
                  >
                    -5
                  </button>
                  <span className="w-12 text-center">{newTaskOffset}分後</span>
                  <button
                    onClick={() => setNewTaskOffset((prev) => Math.min(180, prev + 5))}
                    className="w-8 h-8 bg-gray-300 rounded text-sm"
                  >
                    +5
                  </button>
                  <button
                    onClick={() => {
                      if (!newTaskLabel.trim()) return;
                      addTaskToCourse(newTaskLabel.trim(), newTaskOffset);
                      setNewTaskLabel('');
                      setNewTaskOffset(0);
                    }}
                    className="px-3 py-1 bg-blue-500 text-white rounded text-sm"
                  >
                    ＋タスク追加
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ポジション設定ボタンと内容 */}
          <button
            onClick={() => setPosSettingsOpen(prev => !prev)}
            className="w-full text-left p-2 font-semibold bg-gray-100 rounded text-sm"
          >
            {posSettingsOpen ? '▼▼ ポジション設定' : '▶▶ ポジション設定'}
          </button>
          {posSettingsOpen && (
            <div className="space-y-4 mt-8">
              {/* 新規ポジション追加 */}
              <div className="flex items-center space-x-2 mb-4">
                <input
                  type="text"
                  placeholder="新しいポジション名"
                  value={newPositionName}
                  onChange={(e) => setNewPositionName(e.target.value)}
                  className="border px-2 py-1 rounded text-sm flex-1"
                />
                <button onClick={addPosition} className="px-3 py-1 bg-green-500 text-white rounded text-sm">
                  ＋追加
                </button>
              </div>
              {/* 各ポジションカード */}
              {positions.map((pos) => (
                <div key={pos} className="border rounded p-3 bg-white shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    {/* Improved up/down/toggle block */}
                    <div className="flex items-center space-x-2">
                      {/* Up/Down move buttons */}
                      <div className="flex items-center space-x-1">
                        {positions.indexOf(pos) > 0 && (
                          <button
                            onClick={() => movePositionUp(pos)}
                            aria-label={`Move ${pos} up`}
                            className="p-1 bg-gray-200 hover:bg-gray-300 rounded focus:outline-none"
                          >
                            ↑
                          </button>
                        )}
                        {positions.indexOf(pos) < positions.length - 1 && (
                          <button
                            onClick={() => movePositionDown(pos)}
                            aria-label={`Move ${pos} down`}
                            className="p-1 bg-gray-200 hover:bg-gray-300 rounded focus:outline-none"
                          >
                            ↓
                          </button>
                        )}
                      </div>
                      {/* Expand/Collapse with position name */}
                      <button
                        onClick={() => togglePositionOpen(pos)}
                        aria-label={`${openPositions[pos] ? 'Collapse' : 'Expand'} ${pos}`}
                        className="flex items-center font-medium text-sm space-x-1 focus:outline-none"
                      >
                        <span>{openPositions[pos] ? '▼' : '▶'}</span>
                        <span>{pos}</span>
                      </button>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => renamePosition(pos)}
                        aria-label={`Rename ${pos}`}
                        className="text-blue-500 text-sm"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => removePosition(pos)}
                        aria-label={`Remove ${pos}`}
                        className="text-red-500 text-sm"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  {openPositions[pos] && (
                    <>
                      {/* コース選択（ポジションごと） */}
                      <div className="flex items-center space-x-2 mb-2">
                        <label className="whitespace-nowrap">コース：</label>
                        <select
                          value={courseByPosition[pos]}
                          onChange={(e) => setCourseForPosition(pos, e.target.value)}
                          className="border px-2 py-1 rounded text-sm"
                        >
                          {courses.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        {(courses.find((c) => c.name === courseByPosition[pos])?.tasks ?? [])
                          .slice()
                          .sort((a, b) => a.timeOffset - b.timeOffset)
                          .map((task) => (
                            <div
                              key={`${task.timeOffset}_${task.label}`}
                              className="flex items-center space-x-2 border-b pb-1 text-sm"
                            >
                              <span className="w-20">{task.timeOffset}分後</span>
                              <span className="flex-1">{task.label}</span>
                              <label className="flex items-center space-x-1">
                                <input
                                  type="checkbox"
                                  checked={tasksByPosition[pos]?.[courseByPosition[pos]]?.includes(task.label) || false}
                                  onChange={() => toggleTaskForPosition(pos, courseByPosition[pos], task.label)}
                                  className="mr-1"
                                />
                                <span>表示</span>
                              </label>
                            </div>
                          ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* 卓設定ボタンと内容（そのまま） */}
          <button
            onClick={() => {
              if (!tableSettingsOpen && !confirm('卓設定を開きますか？')) return;
              setTableSettingsOpen((prev) => !prev);
            }}
            className="w-full text-left p-2 font-semibold bg-gray-100 rounded text-sm"
          >
            {tableSettingsOpen ? '▼▼ 卓設定' : '▶▶ 卓設定'}
          </button>
          {tableSettingsOpen && (
            <div className="p-4 space-y-3 text-sm border rounded">
              <div className="space-y-2">
                <p className="text-gray-500 text-xs">
                  電卓型パッドで卓番号を入力し、Enter で追加します。追加された卓は番号順に並びます。
                </p>
                <div className="flex items-center space-x-2">
                             <input
  type="text"
  value={newTableTemp}                            
  readOnly
  onClick={() =>
    setNumPadState({ id: '-1', field: 'presetTable', value: '' })}  
                    placeholder="卓番号を入力"
                    maxLength={3}
                    className="border px-2 py-1 w-full rounded text-sm text-center cursor-pointer"
                  />
                </div>
                <div className="grid grid-cols-3 gap-0 p-1">
                  {numPadState && (numPadState.field === 'presetTable' || numPadState.field === 'table' || numPadState.field === 'guests')
                    ? ['1','2','3','4','5','6','7','8','9','0','←','C'].map((digit) => (
                        <button
                          key={digit}
                          onClick={() => onNumPadPress(digit)}
                          className="bg-gray-200 rounded text-xl font-mono py-2"
                        >
                          {digit}
                        </button>
                      ))
                    : null}
                  {numPadState && (numPadState.field === 'presetTable' || numPadState.field === 'table' || numPadState.field === 'guests') && (
                    <button
                      onClick={onNumPadConfirm}
                      className="col-span-3 bg-blue-500 rounded text-white text-lg py-2"
                    >
                      追加
                    </button>
                  )}
                  {numPadState && (numPadState.field === 'presetTable' || numPadState.field === 'table' || numPadState.field === 'guests') && (
                    <button
                      onClick={onNumPadCancel}
                      className="col-span-3 text-center text-sm text-gray-500 py-2"
                    >
                      キャンセル
                    </button>
                  )}
                </div>
              </div>

              {presetTables.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium mb-1">設定済み卓リスト：</p>
                    <button
                      onClick={() => setTableEditMode((prev) => !prev)}
                      className="px-2 py-0.5 bg-yellow-500 text-white rounded text-xs"
                    >
                      {tableEditMode ? '完了' : '編集'}
                    </button>
                  </div>
                  <div className="grid gap-1 p-0 grid-cols-[repeat(auto-fit,minmax(3rem,1fr))]">
                    {presetTables.map((tbl) =>
                      tableEditMode ? (
                        <div key={tbl} className="flex items-center space-x-1">
                          <span className="border px-1 py-0.5 rounded text-xs">{tbl}</span>
                          <button
                            onClick={() => {
                              setPresetTables((prev) => {
                                const nextTables = prev.filter((t) => t !== tbl);
                                localStorage.setItem(`${ns}-presetTables`, JSON.stringify(nextTables));
                                return nextTables;
                              });
                              setCheckedTables((prev) => {
                                const nextChecked = prev.filter((t) => t !== tbl);
                                localStorage.setItem(`${ns}-checkedTables`, JSON.stringify(nextChecked));
                                return nextChecked;
                              });
                            }}
                            className="text-red-500 text-sm"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <div key={tbl} className="flex items-center space-x-1">
                          <span className="border px-1 py-0.5 rounded text-xs">{tbl}</span>
                        </div>
                      )
                    )}
                  </div>
                  {/* <p className="text-gray-500 text-xs">
                    チェックした卓のみを予約リスト・タスク表示に反映します。未チェックなら全卓表示。
                  </p> */}
                </div>
              )}

            </div>
          )}

         {/* ─── テーブル設定トグル ─── */}
        
        {/* ─────────────── 食べ放題 / 飲み放題 オプション設定 ─────────────── */}
        <button
          onClick={() => setEatDrinkSettingsOpen(prev => !prev)}
          className="w-full text-left p-2 font-semibold bg-gray-100 rounded text-sm mb-2"
        >
          {eatDrinkSettingsOpen ? '▼ 食べ放題飲み放題設定' : '▶ 食べ放題飲み放題設定'}
        </button>
        {eatDrinkSettingsOpen && (
          <div className="mt-6 space-y-6 text-sm">
            <p className="text-red-600 text-xs leading-relaxed">
              ※予約リストの幅の制限の為、<b>２文字</b>までの入力に制限させていただいております。<br />
              以下のように略称または記号を使って判別にご利用ください。<br />
              スタンダード飲み放題＝<b>スタ</b> ／ プレミアム飲み放題＝<b>プレ</b><br />
              ○○食べ放題＝<b>⭐︎</b> ／ ○○食べ放題＝<b>⭐︎⭐︎</b>
            </p>

            {/* 食べ放題オプション */}
            <div>
              <h3 className="font-semibold mb-1">食べ放題：登録済み</h3>
              <div className="flex flex-wrap gap-2 mb-2">
                {eatOptions.map((opt) => (
                  <span key={opt} className="border px-2 py-0.5 rounded flex items-center">
                    {opt}
                    <button
                      onClick={() =>
                        setEatOptions(eatOptions.filter((o) => o !== opt))
                      }
                      className="ml-1 text-red-600">
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={newEatOption}
                  onChange={(e) => setNewEatOption(e.target.value.slice(0, 2))}
                  maxLength={2}
                  placeholder="例: ⭐︎"
                  className="border px-2 py-0.5 w-16 rounded"
                />
                <button
                  onClick={() => {
                    if (newEatOption && !eatOptions.includes(newEatOption)) {
                      setEatOptions([...eatOptions, newEatOption]);
                      setNewEatOption('');
                    }
                  }}
                  className="px-2 py-0.5 bg-blue-500 text-white rounded">
                  追加
                </button>
              </div>
            </div>

            {/* 飲み放題オプション */}
            <div>
              <h3 className="font-semibold mb-1">飲み放題：登録済み</h3>
              <div className="flex flex-wrap gap-2 mb-2">
                {drinkOptions.map((opt) => (
                  <span key={opt} className="border px-2 py-0.5 rounded flex items-center">
                    {opt}
                    <button
                      onClick={() =>
                        setDrinkOptions(drinkOptions.filter((o) => o !== opt))
                      }
                      className="ml-1 text-red-600">
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={newDrinkOption}
                  onChange={(e) => setNewDrinkOption(e.target.value.slice(0, 2))}
                  maxLength={2}
                  placeholder="例: スタ"
                  className="border px-2 py-0.5 w-16 rounded"
                />
                <button
                  onClick={() => {
                    if (newDrinkOption && !drinkOptions.includes(newDrinkOption)) {
                      setDrinkOptions([...drinkOptions, newDrinkOption]);
                      setNewDrinkOption('');
                    }
                  }}
                  className="px-2 py-0.5 bg-blue-500 text-white rounded">
                  追加
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---- 店舗設定をまとめて保存 ---- */}
        <button
          onClick={handleStoreSave}
          className="mt-6 px-4 py-2 bg-blue-600 text-white rounded"
        >
          保存
        </button>
        </section>
      )}

      {/* ─────────────── 営業前設定セクション ─────────────── */}
      {selectedMenu === '営業前設定' && (
        <section>
          <button
            onClick={() => setDisplayTablesOpen1(prev => !prev)}
            className="w-full text-left p-2 font-semibold bg-gray-100 rounded text-sm"
          >
            {displayTablesOpen1 ? '▼▼ 表示する卓' : '▶▶ 表示する卓'}
          </button>
          {displayTablesOpen1 && (
            <div className="p-4 space-y-3 text-sm border rounded">
              <div className="grid gap-1 p-0 grid-cols-[repeat(auto-fit,minmax(3rem,1fr))]">
                {presetTables.map((tbl) => (
                  <div key={tbl} className="flex flex-col items-center">
                    <span className="border px-1 py-0.5 rounded text-xs">{tbl}</span>
                    <label className="mt-1 flex items-center space-x-1">
                      <input
                        type="checkbox"
                        checked={checkedTables.includes(tbl)}
                        onChange={() => {
                          setCheckedTables((prev) => {
                            const next = prev.includes(tbl)
                              ? prev.filter((t) => t !== tbl)
                              : [...prev, tbl];
                            localStorage.setItem(`${ns}-checkedTables`, JSON.stringify(next));
                            return next;
                          });
                        }}
                        className="mr-1"
                      />
                      <span className="text-xs">表示</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button
            onClick={() => setDisplayTablesOpen2(prev => !prev)}
            className="w-full text-left p-2 font-semibold bg-gray-100 rounded text-sm mt-2"
          >
            {displayTablesOpen2 ? '▼▼ 表示するタスク' : '▶▶ 表示するタスク'}
          </button>
          {displayTablesOpen2 && (
            <div className="p-4 space-y-4 text-sm border rounded">
              {/* ポジション選択 */}
              <div className="flex items-center space-x-2 mb-4">
                <label className="whitespace-nowrap">ポジション選択：</label>
                <select
                  value={selectedDisplayPosition}
                  onChange={(e) => setSelectedDisplayPosition(e.target.value)}
                  className="border px-2 py-1 rounded text-sm"
                >
                  {positions.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                  <option key="その他" value="その他">
                    その他
                  </option>
                </select>
              </div>

              {/* タスク一覧 */}
              {selectedDisplayPosition !== 'その他' ? (
                <div className="space-y-4">
                  {/* コース切り替えボタン行 */}
                  <div className="flex flex-wrap gap-2 mb-2">
                    {courses.map((c) => (
                      <button
                        key={c.name}
                        onClick={() => setDisplayTaskCourse(c.name)}
                        className={`px-3 py-1 rounded text-sm ${
                          displayTaskCourse === c.name ? 'bg-blue-500 text-white' : 'bg-gray-200'
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                  {/* 選択中コースのタスク一覧 */}
                  {(() => {
                    const course = courses.find((c) => c.name === displayTaskCourse) || courses[0];
                    return (
                      <div className="border rounded p-2">
                        <div className="font-semibold mb-1">{course.name}</div>
                        {course.tasks
                          .slice()
                          .sort((a, b) => a.timeOffset - b.timeOffset)
                          .map((task) => (
                            <div
                              key={`${task.timeOffset}_${task.label}_${course.name}`}
                              className="flex items-center space-x-2 border-b pb-1 text-sm"
                            >
                              <span className="w-20">{task.timeOffset}分後</span>
                              <span className="flex-1">{task.label}</span>
                              <label className="flex items-center space-x-1">
                                <input
                                  type="checkbox"
                                  checked={tasksByPosition[selectedDisplayPosition]?.[displayTaskCourse]?.includes(task.label) || false}
                                  onChange={() => toggleTaskForPosition(selectedDisplayPosition, displayTaskCourse, task.label)}
                                  className="mr-1"
                                />
                                <span>表示</span>
                              </label>
                            </div>
                          ))}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="space-y-1">
                  {(courses.find((c) => c.name === selectedCourse)?.tasks ?? [])
                    .slice()
                    .sort((a, b) => a.timeOffset - b.timeOffset)
                    .map((task) => (
                      <div
                        key={`${task.timeOffset}_${task.label}`}
                        className="flex items-center space-x-2 border-b pb-1 text-sm"
                      >
                        <span className="w-20">{task.timeOffset}分後</span>
                        <span className="flex-1">{task.label}</span>
                        <label className="flex items-center space-x-1">
                          <input
                            type="checkbox"
                            checked={checkedTasks.includes(task.label)}
                            onChange={() => handleTaskCheck(task.label)}
                            className="mr-1"
                          />
                          <span>表示</span>
                        </label>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}


      {/* ─────────────── 2. 来店入力セクション ─────────────── */}
      

  

      {/* ─────────────── リマインドセクション ─────────────── */}
      {selectedMenu === 'リマインド' && (
        <>
          {/* 通知有効トグル */}
          <div className="flex items-center space-x-2">
            <label className="flex items-center space-x-1">
              <input
                type="checkbox"
                checked={remindersEnabled}
                onChange={() => setRemindersEnabled((prev) => !prev)}
                className="mr-1"
              />
              <span>リマインド通知を有効にする</span>
            </label>
            <span className="ml-auto text-sm text-gray-600">現在時刻：{currentTime}</span>
          </div>

          <section className="mt-20 flex flex-wrap items-start space-x-4 space-y-2 text-sm">
            {/* コントロールバー (検索・表示切替) */}
            <div className="flex flex-col">
              <label className="mb-1">コース絞り込み：</label>
              <select
                value={filterCourse}
                onChange={(e) => setFilterCourse(e.target.value)}
                className="border px-2 py-1 rounded text-sm"
              >
                <option value="全体">全体</option>
                {courses.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
                <option value="未選択">未選択</option>
              </select>
            </div>

            <div className="flex flex-col md:flex-col md:space-y-2 space-x-4 md:space-x-0">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={showCourseAll}
                  onChange={(e) => setShowCourseAll(e.target.checked)}
                  className="mr-1"
                />
                <span>コース表示</span>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={showGuestsAll}
                  onChange={(e) => setShowGuestsAll(e.target.checked)}
                  className="mr-1"
                />
                <span>人数表示</span>
              </div>

              {showCourseAll && (
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={mergeSameTasks}
                    onChange={(e) => setMergeSameTasks(e.target.checked)}
                    className="mr-1"
                  />
                  <span>タスクまとめ表示</span>
                </div>
              )}
            </div>

            {/* タスク並び替えコントロール */}
            <div className="flex items-center space-x-2">
              <label className="mr-1">タスク並び替え：</label>
              <label>
                <input
                  type="radio"
                  name="taskSort"
                  value="table"
                  checked={taskSort === 'table'}
                  onChange={() => setTaskSort('table')}
                  className="mr-1"
                />
                卓番順
              </label>
              <label className="ml-2">
                <input
                  type="radio"
                  name="taskSort"
                  value="guests"
                  checked={taskSort === 'guests'}
                  onChange={() => setTaskSort('guests')}
                  className="mr-1"
                />
                人数順
              </label>
            </div>
          </section>

          <section className="space-y-4 text-sm">
            {/* タスク表示セクション */}
            {/* ...同じロジックを流用... */}
            {hydrated && futureTimeKeys.map((timeKey, idx) => (
              <div key={timeKey} className={`border-b pb-2 ${idx > 0 ? 'opacity-40' : ''}`}>
                <div className="font-bold text-base mb-1">{timeKey}</div>
                {mergeSameTasks ? (
                  // タスクまとめ表示 ON のとき：同じタスク名をまとめる
                  (() => {
                    type Collected = {
                      label: string;
                      bgColor: string;
                      allReservations: Reservation[];
                    };
                    const collectMap: Record<string, Collected> = {};
                    groupedTasks[timeKey].forEach((tg) => {
                      const allRes = tg.courseGroups.flatMap((cg) => cg.reservations);
                      if (!collectMap[tg.label]) {
                        collectMap[tg.label] = {
                          label: tg.label,
                          bgColor: tg.bgColor,
                          allReservations: allRes,
                        };
                      } else {
                        collectMap[tg.label].allReservations.push(...allRes);
                      }
                    });
                    const collectArr = Object.values(collectMap).sort((a, b) =>
                      a.label.localeCompare(b.label)
                    );
                    return collectArr.map((ct) => {
                      
                      const allRes = ct.allReservations;
                      const selKey = `${timeKey}_${ct.label}`;
                      const sortedArr = taskSort === 'guests'
                        ? allRes.slice().sort((a, b) => a.guests - b.guests)
                        : allRes.slice().sort((a, b) => Number(a.table) - Number(b.table));
                      return (
                        <div key={ct.label} className={`p-2 rounded mb-2 ${ct.bgColor}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold">{ct.label}</span>
                            <div className="flex items-center">
                              <button
                                onClick={async () => {
                                  for (const res of allRes) {
                                    const compKey = `${timeKey}_${ct.label}_${res.course}`;
                                    await toggleTaskComplete(res.id, compKey);
                                    updateReservationField(res.id, 'completed', {
                                      ...res.completed,
                                      [compKey]: !res.completed[compKey],
                                    });
                                  }
                                }}
                                className="px-2 py-0.5 bg-yellow-500 text-white rounded text-xs"
                              >
                                完了
                              </button>
                              <button
                                onClick={() => {
                                  const key = `${timeKey}_${ct.label}`;
                                  if (selectionModeTask === key) {
                                    // exit selection mode
                                    setSelectionModeTask(null);
                                    setSelectedForComplete([]);
                                  } else {
                                    // enter selection mode for this task
                                    setSelectionModeTask(key);
                                    setSelectedForComplete([]);
                                  }
                                }}
                                className="ml-2 px-2 py-0.5 bg-yellow-500 text-white rounded text-sm"
                              >
                                {selectionModeTask === `${timeKey}_${ct.label}` ? 'キャンセル' : '選択完了'}
                              </button>
                            {selectionModeTask === `${timeKey}_${ct.label}` && (
                                <button
                                  onClick={async () => {
                                    for (const resId of selectedForComplete) {
                                      const courseName =
                                        filteredReservations.find((r) => r.id === resId)?.course;
                                      if (!courseName) continue;
                                      const compKey = `${timeKey}_${ct.label}_${courseName}`;
                                      await toggleTaskComplete(resId, compKey);
                                      const prevCompleted =
                                        filteredReservations.find((r) => r.id === resId)?.completed || {};
                                      updateReservationField(resId, 'completed', {
                                        ...prevCompleted,
                                        [compKey]: !prevCompleted[compKey],
                                      });
                                    }
                                    setSelectionModeTask(null);
                                    setSelectedForComplete([]);
                                  }}
                                  className="ml-2 px-2 py-0.5 bg-green-700 text-white rounded text-sm"
                                >
                                  完了登録
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {sortedArr.map((r) => (
                              <span
                                key={r.id}
                                className={`border px-2 py-1 rounded text-xs cursor-pointer ${
                                  selectionModeTask === selKey && selectedForComplete.includes(r.id)
                                    ? 'bg-green-200'
                                    : ''
                                }`}
                                onClick={() => {
                                  if (selectionModeTask === selKey) {
                                    setSelectedForComplete((prev) =>
                                      prev.includes(r.id)
                                        ? prev.filter((x) => x !== r.id)
                                        : [...prev, r.id]
                                    );
                                  }
                                }}
                              >
                                {r.table}
                                {showGuestsAll && <>({r.guests})</>}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    });
                  })()
                ) : (
                  // non-mergeSameTasks branch with selection UI
                  groupedTasks[timeKey].map((tg) => {
                    {/* タスク見出し：ラベル + ⏱トグル */}
<div className="flex items-center gap-2 mb-1">
  <span className="font-semibold">{tg.label}</span>
  <button
    onClick={() => {
      const key = `${timeKey}_${tg.label}`;
      if (shiftModeKey === key) {
        setShiftModeKey(null);
        setShiftTargets([]);
      } else {
        setShiftModeKey(key);
        setShiftTargets([]);
      }
    }}
    className="ml-1 px-1 text-xs bg-gray-300 rounded"
    aria-label="時間変更モード"
  >
    ⏱
  </button>
</div>
                    const selKey = `${timeKey}_${tg.label}`;
                    return (
                      <div key={tg.label} className={`p-2 rounded mb-2 ${tg.bgColor}`}>
                        {/* ── タスク行ヘッダ ──────────────────── */}
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold">{tg.label}</span>
                          <button
                            onClick={() => {
                              const key = `${timeKey}_${tg.label}`;
                              if (shiftModeKey === key) {
                                setShiftModeKey(null);
                                setShiftTargets([]);
                              } else {
                                setShiftModeKey(key);
                                setShiftTargets([]);
                              }
                            }}
                            className="ml-1 px-1 text-xs bg-gray-300 rounded"
                          >
                            ⏱
                          </button>
                          {/* ── 調整ツールバー（調整モード時のみ表示） ── */}
{shiftModeKey === `${timeKey}_${tg.label}` && (
  <div className="flex items-center space-x-1 ml-2">
    <button
      onClick={() =>
        setShiftTargets(
          (tg.courseGroups ?? []).flatMap(g => g.reservations ?? []).map(r => r.id)
        )
      }
      className="px-1 py-0.5 bg-gray-200 rounded text-xs"
    >
      全選択
    </button>
    <button
      onClick={() => setShiftTargets([])}
      className="px-1 py-0.5 bg-gray-200 rounded text-xs"
    >
      解除
    </button>
    <button
      onClick={() => {
        const allIds = (tg.courseGroups ?? []).flatMap(g => g.reservations ?? []).map(r => r.id);
        const ids = shiftTargets.length > 0 ? shiftTargets : allIds;
        batchAdjustTaskTime(ids, tg.label, -5);
      }}
      className="px-1 py-0.5 bg-gray-300 rounded text-xs"
    >
      −5
    </button>
    <button
      onClick={() => {
        const allIds = (tg.courseGroups ?? []).flatMap(g => g.reservations ?? []).map(r => r.id);
        const ids = shiftTargets.length > 0 ? shiftTargets : allIds;
        batchAdjustTaskTime(ids, tg.label, +5);
      }}
      className="px-1 py-0.5 bg-gray-300 rounded text-xs"
    >
      ＋5
    </button>
  </div>
)}

                          {/* 右側の操作ボタン（既存のまま） */}
                          <div className="flex items-center">
                            <button
                              onClick={() => {
                                if (selectionModeTask === selKey) {
                                  setSelectionModeTask(null);
                                  setSelectedForComplete([]);
                                } else {
                                  setSelectionModeTask(selKey);
                                  setSelectedForComplete([]);
                                }
                              }}
                              className="ml-2 px-2 py-0.5 bg-yellow-500 text-white rounded text-sm"
                            >
                              {selectionModeTask === selKey ? 'キャンセル' : '選択完了'}
                            </button>
                            {selectionModeTask === selKey && (
                              <button
                                onClick={async () => {
                                  for (const resId of selectedForComplete) {
                                    const courseName =
                                      filteredReservations.find((r) => r.id === resId)?.course;
                                    if (!courseName) continue;
                                    const compKey = `${timeKey}_${tg.label}_${courseName}`;
                                    await toggleTaskComplete(resId, compKey);
                                    const prevCompleted =
                                      filteredReservations.find((r) => r.id === resId)?.completed || {};
                                    updateReservationField(resId, 'completed', {
                                      ...prevCompleted,
                                      [compKey]: !prevCompleted[compKey],
                                    });
                                  }
                                  setSelectionModeTask(null);
                                  setSelectedForComplete([]);
                                }}
                                className="ml-2 px-2 py-0.5 bg-green-700 text-white rounded text-sm"
                              >
                                完了登録
                              </button>
                            )}
                          </div>
                        </div>

                        {/* ── 予約リスト部分 ─────────────────── */}
                        {/** If コース表示 OFF → 1つにまとめて表示 / ON → コースごとに表示 */}
                        {showCourseAll ? (
                          /* --- Course Display ON : 既存のコースごと表示 --- */
                          <div>
                            {tg.courseGroups.map((cg) => {
                              const sortedRes =
                                taskSort === 'guests'
                                  ? cg.reservations
                                      .slice()
                                      .sort((a, b) => a.guests - b.guests)
                                  : cg.reservations
                                      .slice()
                                      .sort((a, b) => Number(a.table) - Number(b.table));

                              return (
                                <div key={cg.courseName} className="mb-1">
                                  {/* コースラベルは ON のときだけ表示 */}
                                  <div className="text-xs mb-1">({cg.courseName})</div>
                                  <div className="flex flex-wrap gap-2">
                                    {sortedRes.map((r) => {
                                      const previewDone =
                                        selectionModeTask === selKey &&
                                        selectedForComplete.includes(r.id)
                                          ? !Boolean(
                                              r.completed[
                                                `${timeKey}_${tg.label}_${cg.courseName}`
                                              ]
                                            )
                                          : Boolean(
                                              r.completed[
                                                `${timeKey}_${tg.label}_${cg.courseName}`
                                              ]
                                            );

                                      return (
                                        <span
                                          key={r.id}
                                          className={`border px-2 py-1 rounded text-xs cursor-pointer ${
                                            previewDone
                                              ? 'opacity-50 line-through bg-gray-300'
                                              : ''
                                          } ${
                                            selectionModeTask === selKey &&
                                            selectedForComplete.includes(r.id)
                                              ? 'ring-2 ring-yellow-400'
                                              : ''
                                          } ${
                                            firstRotatingId[r.table] === r.id
                                              ? 'text-red-500'
                                              : ''
                                          }`}
                                          onClick={() => {
                                            if (selectionModeTask === selKey) {
                                              setSelectedForComplete((prev) =>
                                                prev.includes(r.id)
                                                  ? prev.filter((x) => x !== r.id)
                                                  : [...prev, r.id]
                                              );
                                            }
                                          }}
                                        >
                                          {showTableStart && r.table}
{showGuestsAll && `(${r.guests})`}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          /* --- Course Display OFF : すべての予約をまとめて表示 --- */
                          (() => {
                            const combined = tg.courseGroups.flatMap(
                              (cg) => cg.reservations
                            );
                            const sortedRes =
                              taskSort === 'guests'
                                ? combined.slice().sort((a, b) => a.guests - b.guests)
                                : combined
                                    .slice()
                                    .sort((a, b) => Number(a.table) - Number(b.table));

                            return (
                              <div className="flex flex-wrap gap-2">
                                {sortedRes.map((r) => {
                                  /* completion keyは courseName を含まない共通キー */
                                  const compKey = `${timeKey}_${tg.label}`;
                                  const previewDone =
                                    selectionModeTask === selKey &&
                                    selectedForComplete.includes(r.id)
                                      ? !Boolean(r.completed[compKey])
                                      : Boolean(r.completed[compKey]);

                                  return (
                                    <span
                                      key={r.id}
                                      className={`border px-2 py-1 rounded text-xs cursor-pointer ${
                                        previewDone
                                          ? 'opacity-50 line-through bg-gray-300'
                                          : ''
                                      } ${
                                        selectionModeTask === selKey &&
                                        selectedForComplete.includes(r.id)
                                          ? 'ring-2 ring-yellow-400'
                                          : ''
                                      } ${
                                        firstRotatingId[r.table] === r.id
                                          ? 'text-red-500'
                                          : ''
                                      }`}
                                      onClick={() => {
                                        if (selectionModeTask === selKey) {
                                          setSelectedForComplete((prev) =>
                                            prev.includes(r.id)
                                              ? prev.filter((x) => x !== r.id)
                                              : [...prev, r.id]
                                          );
                                        }
                                      }}
                                    >
                                      {showTableStart && r.table}
{showGuestsAll && `(${r.guests})`}
                                    </span>
                                  );
                                })}
                              </div>
                            );
                          })()
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ))}
          </section>
        </>
      )}

      {/* ─────────────── 予約リスト×タスク表セクション ─────────────── */}
      {selectedMenu === '予約リスト×タスク表' && (
        <>
          <section>
            {/* 来店入力セクション */}
            <button
              onClick={() => setResInputOpen(prev => !prev)}
              className="w-full text-left p-2 font-semibold bg-gray-100 rounded text-sm"
            >
              {resInputOpen ? '▼▼ 予約リスト' : '▶▶ 予約リスト'}
            </button>
            {resInputOpen && (
              <div className="sm:p-4 p-2 space-y-4 text-sm border rounded overflow-x-auto">
                {/* ...existing 来店入力 JSX unchanged... */}
                {/* ── 予約リスト ヘッダー ───────────────────── */}
                <div className="flex flex-col space-y-2">
                  {/* 上段：表示順ラジオ */}
                  <div className="flex items-center space-x-4">
                    <label className="mr-2">表示順：</label>
                    <label>
                      <input
                        type="radio"
                        name="resOrder"
                        checked={resOrder === 'table'}
                        onChange={() => {
                          setResOrder('table');
                          localStorage.setItem(`${ns}-resOrder`, 'table');
                        }}
                        className="mr-1"
                      />
                      卓番順
                    </label>
                    <label className="ml-2">
                      <input
                        type="radio"
                        name="resOrder"
                        checked={resOrder === 'time'}
                        onChange={() => {
                          setResOrder('time');
                          localStorage.setItem(`${ns}-resOrder`, 'time');
                        }}
                        className="mr-1"
                      />
                      時間順
                    </label>
                  </div>

                  {/* 下段：卓番変更 & 全リセット & 予約確定 */}
                  <div className="flex items-center space-x-4">
                    <button
                      onClick={() => setEditTableMode(prev => !prev)}
                      className={`px-2 py-0.5 rounded text-sm ${
                        editTableMode ? 'bg-green-500 text-white' : 'bg-gray-300'
                      }`}
                    >
                      卓番変更
                    </button>

                    <button
                      onClick={resetAllReservations}
                      className="px-3 py-1 bg-red-500 text-white rounded text-sm"
                    >
                      全リセット
                    </button>
                    
                    <button
  onClick={() => {
    if (!navigator.onLine) {
      alert('オフラインのため送信できません。オンラインで再度お試しください。');
      return;
    }
    flushQueuedOps()
      .then(() => toast.success('予約を一括送信しました！'))
      .catch((err) => {
        console.error('flushQueuedOps failed', err);
        toast.error('送信に失敗しました');
      });
  }}
  className="px-6 py-4 bg-blue-600 text-white rounded text-sm"
>
  予約確定
</button>
                  </div>
                </div>
                <div className="flex items-center space-x-4 ml-4">
                  <label className="flex items-center space-x-1">
                    <input
                      type="checkbox"
                      checked={showEatCol}
                      onChange={(e) => setShowEatCol(e.target.checked)}
                      className="mr-1"
                    />
                    <span>食表示</span>
                  </label>
                  <label className="flex items-center space-x-1">
                    <input
                      type="checkbox"
                      checked={showDrinkCol}
                      onChange={(e) => setShowDrinkCol(e.target.checked)}
                      className="mr-1"
                    />
                    <span>飲表示</span>
                  </label>
                </div>
                <div className="hidden sm:flex items-center space-x-4">
                  <label className="flex items-center space-x-1">
                    <input
                      type="checkbox"
                      checked={showNameCol}
                      onChange={() => setShowNameCol((p) => !p)}
                      className="mr-1"
                    />
                    <span>氏名表示</span>
                  </label>
                  <label className="flex items-center space-x-1">
                    <input
                      type="checkbox"
                      checked={showNotesCol}
                      onChange={() => setShowNotesCol((p) => !p)}
                      className="mr-1"
                    />
                    <span>備考表示</span>
                  </label>
                </div>
                {editTableMode && Object.keys(pendingTables).length > 0 && (
                  <div className="mt-2 space-y-1">
                    {Object.entries(pendingTables).map(([id, tbl]) => (
                      <div
                        key={id}
                        className="px-2 py-1 bg-yellow-50 border rounded text-sm flex justify-between"
                      >
                        <span>{tbl.old}卓 → {tbl.next}卓</span>
                        <button
                          onClick={() =>
                            setPendingTables(prev => {
                              const next = { ...prev };
                              delete next[Number(id)];
                              return next;
                            })
                          }
                          className="text-red-500 text-xs ml-4"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={commitTableMoves}
                      className="mt-2 px-4 py-1 bg-green-600 text-white rounded text-sm"
                    >
                      変更を完了する
                    </button>
                  </div>
                )}
                <table className="min-w-full table-auto border text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="border px-1 py-1 w-24">来店時刻</th>
                      <th className="border px-1 py-1 w-20">卓番</th>
                      {showNameCol && <th className="border px-1 py-1 w-24 hidden sm:table-cell">氏名</th>}
                      <th className="border px-1 py-1 w-24">コース</th>
                      {showEatCol   && <th className="border px-1 py-0.5 w-14 text-center">食</th>}
                      {showDrinkCol && <th className="border px-1 py-0.5 w-14 text-center">飲</th>}
                      <th className="border px-1 py-1 w-20">人数</th>
                      {showNotesCol && <th className="border px-1 py-1 w-24 hidden sm:table-cell">備考</th>}
                      <th className="border px-1 py-1 w-12 hidden sm:table-cell">来店</th>
                      <th className="border px-1 py-1 hidden sm:table-cell">会計</th>
                      <th className="border px-1 py-1 w-12 hidden sm:table-cell">退店</th>
                      <th className="border px-1 py-1 w-12">削除</th>
                    </tr>
                  </thead>
                  <tbody>
                   {filteredReservations.map((r, idx) => {
                    
                     // highlight when a later reservation has the same table (前回転)
                     const hasLaterRotation = filteredReservations
                       .slice(idx + 1)
                       .some(other => other.table === r.table);

                     const prev = filteredReservations[idx - 1];
                     const borderClass = !prev || prev.time !== r.time
                       ? 'border-t-2 border-gray-300' // 時刻が変わる行 → 太線
                       : 'border-b border-gray-300';  // 同時刻の行 → 細線

                     return (
                      <tr
  key={r.id}
  className={`${
    checkedArrivals.includes(r.id) ? 'bg-green-100 ' : ''
  }${
    checkedDepartures.includes(r.id) ? 'bg-gray-300 text-gray-400 ' : ''
  }${borderClass} text-center ${
    firstRotatingId[r.table] === r.id ? 'text-red-500' : ''
  }`}
>
                        {/* 来店時刻セル */}
                        <td className="border px-1 py-1">
                          <select
                            value={r.time}
                            onChange={(e) => updateReservationField(r.id, 'time', e.target.value)}
                            className="border px-1 py-0.5 rounded text-sm"
                          >
                            {timeOptions.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        {/* 卓番セル */}
<td>
  <input
    type="text"
    readOnly
    value={editTableMode && pendingTables[r.id] ? pendingTables[r.id].next : r.table}
    onClick={() => {
      if (editTableMode) {
        if (!tablesForMove.includes(r.id)) {
          // プレビュー用エントリを追加
          setPendingTables(prev => ({
            ...prev,
            [r.id]: { old: r.table, next: r.table },
          }));
        } else {
          // プレビュー用エントリを削除
          setPendingTables(prev => {
            const next = { ...prev };
            delete next[r.id];
            return next;
          });
        }
        toggleTableForMove(r.id);
        // すぐに NumPad を開く
        setNumPadState({
          id: r.id,
          field: 'targetTable',
          value: pendingTables[r.id]?.next ?? r.table,
        });
      } else {
        // 通常モードでの卓番号編集
        setNumPadState({ id: r.id, field: 'table', value: r.table });
      }
    }}
    className={`border px-1 py-0.5 rounded text-sm w-full text-center ${
      editTableMode && tablesForMove.includes(r.id) ? 'border-4 border-blue-500' : ''
    }`}
  />
</td>
                        {/* 氏名セル (タブレット表示) */}
                        {showNameCol && (
                          <td className="border px-1 py-1 hidden sm:table-cell">
                            <input
                              type="text"
                              value={r.name ?? ''}
                              onChange={(e) => {
                                const newValue = e.target.value;
                                setReservations((prev) =>
                                  prev.map((x) => (x.id === r.id ? { ...x, name: newValue } : x))
                                );
                                updateReservationField(r.id, 'name', newValue);
                              }}
                              placeholder="氏名"
                              className="border px-1 py-0.5 w-full rounded text-sm text-center"
                            />
                          </td>
                        )}
                        {/* コースセル */}
                        <td className="border px-1 py-1">
                          <select
                            value={r.course}
                            onChange={(e) => updateReservationField(r.id, 'course', e.target.value)}
                            className="border px-1 py-0.5 rounded text-sm"
                          >
                            {courses.map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        {/* 食・飲 列 */}
{showEatCol && (
  <td className="border px-1 py-0.5 text-center">
    <select
      value={r.eat || ''}
      onChange={(e) => updateReservationField(r.id, 'eat', e.target.value)}
      className="border px-1 py-0.5 w-14 text-xs rounded"
    >
      <option value=""></option>
      {eatOptions.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  </td>
)}
{showDrinkCol && (
  <td className="border px-1 py-0.5 text-center">
    <select
      value={r.drink || ''}
      onChange={(e) => updateReservationField(r.id, 'drink', e.target.value)}
      className="border px-1 py-0.5 w-14 text-xs rounded"
    >
      <option value=""></option>
      {drinkOptions.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  </td>
)}
                        {/* 人数セル */}
                        <td className="border px-1 py-1">
                        <input
                          type="text"
                          value={r.guests}
                          readOnly
                          onClick={() =>
                            setNumPadState({ id: r.id, field: 'guests', value: r.guests.toString() })
                          }
                          className="border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer"
                        />
                        </td>
                        {/* 備考セル (タブレット表示) */}
                        {showNotesCol && (
                          <td className="border px-1 py-1 hidden sm:table-cell">
                            <input
                              type="text"
                              value={r.notes ?? ''}
                              onChange={(e) => {
                                const newValue = e.target.value;
                                setReservations((prev) =>
                                  prev.map((x) => (x.id === r.id ? { ...x, notes: newValue } : x))
                                );
                                updateReservationField(r.id, 'notes', newValue);
                              }}
                              placeholder="備考"
                              className="border px-1 py-0.5 w-full rounded text-sm text-center"
                            />
                          </td>
                        )}
                        {/* 来店チェックセル (タブレット表示) */}
                        <td className="border px-1 py-1 hidden sm:table-cell">
                          <button
                            onClick={() => toggleArrivalChecked(r.id)}
                               className={`px-2 py-0.5 rounded text-sm ${
     // 退店済みなら最優先で濃いグレー＆白文字
     checkedDepartures.includes(r.id)
       ? 'bg-gray-500 text-white'
       // それ以外で来店チェック済みなら緑＆白文字
       : checkedArrivals.includes(r.id)
         ? 'bg-green-500 text-white'
         // 通常は薄いグレー＆黒文字
         : 'bg-gray-200 text-black'
   }`}
                          >
                            来
                          </button>
                        </td>
                        {/* 会計チェックセル (タブレット表示) */}
                        <td className="hidden sm:table-cell px-1">
  <button
    onClick={() => togglePaymentChecked(r.id)}
    className={`px-2 py-0.5 rounded text-sm ${
  checkedDepartures.includes(r.id)          /* 退店済みなら最優先で濃いグレー＆白文字 */
    ? 'bg-gray-500 text-white'
    : checkedPayments.includes(r.id)        /* 会計チェック時だけ青 */
    ? 'bg-blue-500 text-white'
    : 'bg-gray-200 text-black'
}`}
  >
    会
  </button>
</td>
                        {/* 退店チェックセル (タブレット表示) */}
                        <td className="border px-1 py-1 hidden sm:table-cell">
                          <button
                            onClick={() => toggleDepartureChecked(r.id)}
                            className={`px-2 py-0.5 rounded text-sm ${
                              checkedDepartures.includes(r.id) ? 'bg-gray-500 text-white' : 'bg-gray-200 text-black'
                            }`}
                          >
                            退
                          </button>
                        </td>
                        {/* 削除セル */}
                        <td className="border px-1 py-1">
                          <button
                            onClick={() => deleteReservation(r.id)}
                            className="bg-red-500 text-white px-2 py-0.5 rounded text-sm"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                    {/* 追加入力行 */}
                    <tr className="bg-gray-50">
                      {/* 新規来店時刻セル */}
                      <td className="border px-1 py-1">
                        <select
                          value={newResTime}
                          onChange={(e) => setNewResTime(e.target.value)}
                          className="border px-1 py-0.5 rounded text-sm"
                          required
                        >
                          {timeOptions.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </td>
                      {/* 新規卓番セル */}
                      <td className="border px-1 py-1">
                        <input
                          type="text"
                          value={newResTable}
                          readOnly
                          onClick={() => setNumPadState({ id: '-1', field: 'table', value: '' })}
                          placeholder="例:101"
                          maxLength={3}
                          className="border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer"
                          required
                        />
                      </td>
                      {/* 新規氏名セル (タブレット表示) */}
                      {showNameCol && (
                        <td className="border px-1 py-1 hidden sm:table-cell">
                          <input
                            type="text"
                            value={newResName}
                            onChange={(e) => setNewResName(e.target.value)}
                            placeholder="氏名"
                            className="border px-1 py-0.5 w-full rounded text-sm text-center"
                          />
                        </td>
                      )}
                      {/* 新規コースセル */}
                      <td className="border px-1 py-1">
                        <select
                          value={newResCourse}
                          onChange={(e) => setNewResCourse(e.target.value)}
                          className="border px-1 py-0.5 rounded text-sm"
                        >
                        <option value="">未選択</option>
                          {courses.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      {/* 新規食べ放題セル */}
                      {showEatCol && (
  <td className="border px-1 py-0.5">
    <select
      value={newResEat}
      onChange={e => setNewResEat(e.target.value.slice(0, 2))}
      className="border px-1 py-0.5 rounded w-full text-sm"
    >
      <option value="">未選択</option>
      {eatOptions.map((o) => (
  <option key={o} value={o}>{o}</option>
))}
    </select>
  </td>
)}
{/* 新規飲み放題セル */}
{showDrinkCol && (
  <td className="border px-1 py-0.5">
    <select
      value={newResDrink}
      onChange={e => setNewResDrink(e.target.value.slice(0, 2))}
      className="border px-1 py-0.5 rounded w-full text-sm"
    >
      <option value="">未選択</option>
      {drinkOptions.map((o) => (
  <option key={o} value={o}>{o}</option>
))}
    </select>
  </td>
)}
                      {/* 新規人数セル */}
                      {showGuestsCol && (
                        <td className="border px-1 py-1">
                          <input
                            type="text"
                            value={newResGuests}
                            readOnly
                            onClick={() => setNumPadState({ id: '-1', field: 'guests', value: '' })}
                            placeholder="人数"
                            maxLength={3}
                            className="border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer"
                            required
                          />
                        </td>
                      )}
                      {/* 新規備考セル (タブレット表示) */}
                      {showNotesCol && (
                        <td className="border px-1 py-1 hidden sm:table-cell">
                          <input
                            type="text"
                            value={newResNotes}
                            onChange={(e) => setNewResNotes(e.target.value)}
                            placeholder="備考"
                            className="border px-1 py-0.5 w-full rounded text-sm text-center"
                          />
                        </td>
                      )}
                      {/* 追加ボタンセル */}
                      <td className="border px-1 py-1 text-center">
                        <button
                          onClick={addReservation}
                          className="bg-blue-500 text-white px-2 py-0.5 rounded text-sm"
                        >
                          ＋
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-20 flex flex-wrap items-start space-x-4 space-y-2 text-sm">
            {/* コントロールバー (検索・表示切替) */}
            {/* ...existing コントロールバー JSX unchanged... */}
            <div className="flex flex-col">
              <label className="mb-1">コース絞り込み：</label>
              <select
                value={filterCourse}
                onChange={(e) => setFilterCourse(e.target.value)}
                className="border px-2 py-1 rounded text-sm"
              >
                <option value="全体">全体</option>
                {courses.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
                <option value="未選択">未選択</option>
              </select>
            </div>

            <div className="flex flex-col md:flex-col md:space-y-2 space-x-4 md:space-x-0">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={showCourseAll}
                  onChange={(e) => setShowCourseAll(e.target.checked)}
                  className="mr-1"
                />
                <span>コース表示</span>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={showGuestsAll}
                  onChange={(e) => setShowGuestsAll(e.target.checked)}
                  className="mr-1"
                />
                <span>人数表示</span>
              </div>

              {showCourseAll && (
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={mergeSameTasks}
                    onChange={(e) => setMergeSameTasks(e.target.checked)}
                    className="mr-1"
                  />
                  <span>タスクまとめ表示</span>
                </div>
              )}
            </div>

            {/* タスク並び替えコントロール */}
            <div className="flex items-center space-x-2">
              <label className="mr-1">タスク並び替え：</label>
              <label>
                <input
                  type="radio"
                  name="taskSort"
                  value="table"
                  checked={taskSort === 'table'}
                  onChange={() => setTaskSort('table')}
                  className="mr-1"
                />
                卓番順
              </label>
              <label className="ml-2">
                <input
                  type="radio"
                  name="taskSort"
                  value="guests"
                  checked={taskSort === 'guests'}
                  onChange={() => setTaskSort('guests')}
                  className="mr-1"
                />
                人数順
              </label>
            </div>
          </section>

          <section className="space-y-4 text-sm">
            {/* タスク表示セクション */}
            {/* ...existing タスク表示 JSX unchanged... */}
            {hydrated && sortedTimeKeys.map((timeKey) => (
              <div key={timeKey} className="border-b pb-2">
                <div className="font-bold text-base mb-1">{timeKey}</div>
                {mergeSameTasks ? (
                  // タスクまとめ表示 ON のとき：同じタスク名をまとめる
                  (() => {
                    type Collected = {
                      label: string;
                      bgColor: string;
                      allReservations: Reservation[];
                    };
                    const collectMap: Record<string, Collected> = {};
                    groupedTasks[timeKey].forEach((tg) => {
                      const allRes = tg.courseGroups.flatMap((cg) => cg.reservations);
                      if (!collectMap[tg.label]) {
                        collectMap[tg.label] = {
                          label: tg.label,
                          bgColor: tg.bgColor,
                          allReservations: allRes,
                        };
                      } else {
                        collectMap[tg.label].allReservations.push(...allRes);
                      }
                    });
                    const collectArr = Object.values(collectMap).sort((a, b) =>
                      a.label.localeCompare(b.label)
                    );
                    return collectArr.map((ct) => {
                      const allRes = ct.allReservations;
                      const selKey = `${timeKey}_${ct.label}`;
                      const sortedArr = taskSort === 'guests'
                        ? allRes.slice().sort((a, b) => a.guests - b.guests)
                        : allRes.slice().sort((a, b) => Number(a.table) - Number(b.table));
                      return (
                        <div key={ct.label} className={`p-2 rounded mb-2 ${ct.bgColor}`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-bold">{ct.label}</span>
                              {/* 時間変更モードトグル */}
                              <button
                                onClick={() => {
                                  const key = `${timeKey}_${ct.label}`;
                                  if (shiftModeKey === key) {
                                    // 既に時間調整モード中 → OFF
                                    setShiftModeKey(null);
                                    setShiftTargets([]);
                                  } else {
                                    // 時間調整モード開始（対象選択はこれから）
                                    setShiftModeKey(key);
                                    setShiftTargets([]);
                                  }
                                }}
                                className="ml-1 px-1 text-xs bg-gray-300 rounded"
                              >
                                ⏱
                              </button>
                              {/* ── 調整ツールバー（調整モード時のみ表示） ── */}
{shiftModeKey === `${timeKey}_${ct.label}` && (
  <div className="flex items-center space-x-1 ml-2">
    <button
      onClick={() => setShiftTargets((ct.allReservations ?? []).map(r => r.id))}
      className="px-1 py-0.5 bg-gray-200 rounded text-xs"
    >
      全選択
    </button>
    <button
      onClick={() => setShiftTargets([])}
      className="px-1 py-0.5 bg-gray-200 rounded text-xs"
    >
      解除
    </button>
    <button
      onClick={() => {
        const ids = (shiftTargets.length > 0
          ? shiftTargets
          : (ct.allReservations ?? []).map(r => r.id));
        batchAdjustTaskTime(ids, ct.label, -5);
      }}
      className="px-1 py-0.5 bg-gray-300 rounded text-xs"
    >
      −5
    </button>
    <button
      onClick={() => {
        const ids = (shiftTargets.length > 0
          ? shiftTargets
          : (ct.allReservations ?? []).map(r => r.id));
        batchAdjustTaskTime(ids, ct.label, +5);
      }}
      className="px-1 py-0.5 bg-gray-300 rounded text-xs"
    >
      ＋5
    </button>
  </div>
)}
                              <div className="flex items-center">
                                <button
                                  onClick={() => {
                                    const key = `${timeKey}_${ct.label}`;
                                    if (selectionModeTask === key) {
                                      // exit selection mode
                                      setSelectionModeTask(null);
                                      setSelectedForComplete([]);
                                    } else {
                                      // enter selection mode for this task
                                      setSelectionModeTask(key);
                                      setSelectedForComplete([]);
                                    }
                                  }}
                                  className="ml-2 px-2 py-0.5 bg-yellow-500 text-white rounded text-sm"
                                >
                                  {selectionModeTask === `${timeKey}_${ct.label}` ? 'キャンセル' : '選択完了'}
                                </button>
                                {selectionModeTask === `${timeKey}_${ct.label}` && (
                                  <button
                                    onClick={() => {
                                      // mark selected reservations complete for this task (toggle)
                                      selectedForComplete.forEach((resId) => {
                                        const key = `${timeKey}_${ct.label}_${filteredReservations.find(r => r.id === resId)?.course}`;
                                        updateReservationField(
                                          resId,
                                          'completed',
                                          (() => {
                                            const prevCompleted = filteredReservations.find(r => r.id === resId)?.completed || {};
                                            const wasDone = Boolean(prevCompleted[key]);
                                            return {
                                              ...prevCompleted,
                                              [key]: !wasDone
                                            };
                                          })()
                                        );
                                      });
                                      setSelectionModeTask(null);
                                      setSelectedForComplete([]);
                                    }}
                                    className="ml-2 px-2 py-0.5 bg-green-700 text-white rounded text-sm"
                                  >
                                    完了登録
                                  </button>
                                )}
                              </div>
                            </div>
                          <div className="flex flex-wrap gap-2">
                            {sortedArr.map((r) => {
                              const keyForThisTask = `${timeKey}_${ct.label}`;
                              const compKeyDetail = `${timeKey}_${ct.label}_${r.course}`;
                              const currentDone = Boolean(r.completed[compKeyDetail]);
                              const previewDone =
                                selectionModeTask === keyForThisTask && selectedForComplete.includes(r.id)
                                  ? !currentDone
                                  : currentDone;
                              return (
                                <div
                                  key={r.id}
                                  onClick={() => {
                                    const key = keyForThisTask; // `${timeKey}_${ct.label}`
                                    // 1) 時間調整モード中は shiftTargets のトグルを最優先
                                    if (shiftModeKey === key) {
                                      setShiftTargets((prev) =>
                                        prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id]
                                      );
                                      return; // 既存の selectionMode は実行しない
                                    }
                                    // 2) 既存の「完了登録」用の選択モード
                                    if (selectionModeTask === key) {
                                      setSelectedForComplete((prev) =>
                                        prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                                      );
                                    }
                                  }}
                                  className={`border px-2 py-1 rounded text-xs ${
                                    previewDone ? 'opacity-50 line-through bg-gray-300' : ''
                                  } ${
                                    // 時間調整の選択中は青いリング
                                    shiftModeKey === keyForThisTask && shiftTargets.includes(r.id)
                                      ? 'ring-2 ring-blue-400'
                                      : ''
                                  } ${
                                    // 既存の完了選択中は黄色いリング
                                    selectionModeTask === keyForThisTask && selectedForComplete.includes(r.id)
                                      ? 'ring-2 ring-yellow-400'
                                      : ''
                                  } ${firstRotatingId[r.table] === r.id ? 'text-red-500' : ''}`}
                                >
                                  {r.table}
                                  {showTableStart && showGuestsAll && <>({r.guests})</>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    });
                  })()
                ) : (
                  // まとめ表示 OFF のとき：従来のコース単位表示
                  groupedTasks[timeKey].map((tg) => {
                     {/* タスク見出し：ラベル + ⏱トグル */}
<div className="flex items-center gap-2 mb-1">
  <span className="font-semibold">{tg.label}</span>
  <button
    onClick={() => {
      const key = `${timeKey}_${tg.label}`;
      if (shiftModeKey === key) {
        setShiftModeKey(null);
        setShiftTargets([]);
      } else {
        setShiftModeKey(key);
        setShiftTargets([]);
      }
    }}
    className="ml-1 px-1 text-xs bg-gray-300 rounded"
    aria-label="時間変更モード"
  >
    ⏱
  </button>
</div>
                    const selKey = `${timeKey}_${tg.label}`;
                    return (
                      <div key={tg.label} className={`p-2 rounded mb-2 ${tg.bgColor}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold">{tg.label}</span>
                          {/* 時間変更モードトグル */}
                          <button
                            onClick={() => {
                              const key = `${timeKey}_${tg.label}`;
                              if (shiftModeKey === key) {
                                // 既に時間調整モード中 → OFF
                                setShiftModeKey(null);
                                setShiftTargets([]);
                              } else {
                                // 時間調整モード開始（対象選択はこれから）
                                setShiftModeKey(key);
                                setShiftTargets([]);
                              }
                            }}
                            className="ml-1 px-1 text-xs bg-gray-300 rounded"
                          >
                            ⏱
                          </button>
                         {/* ── 調整ツールバー（調整モード時のみ表示） ── */}
{shiftModeKey === `${timeKey}_${tg.label}` && (
  <div className="flex items-center space-x-1 ml-2">
    <button
      onClick={() =>
        setShiftTargets(
          (tg.courseGroups ?? []).flatMap(g => g.reservations ?? []).map(r => r.id)
        )
      }
      className="px-1 py-0.5 bg-gray-200 rounded text-xs"
    >
      全選択
    </button>
    <button
      onClick={() => setShiftTargets([])}
      className="px-1 py-0.5 bg-gray-200 rounded text-xs"
    >
      解除
    </button>
    <button
      onClick={() => {
        const allIds = (tg.courseGroups ?? []).flatMap(g => g.reservations ?? []).map(r => r.id);
        const ids = shiftTargets.length > 0 ? shiftTargets : allIds;
        batchAdjustTaskTime(ids, tg.label, -5);
      }}
      className="px-1 py-0.5 bg-gray-300 rounded text-xs"
    >
      −5
    </button>
    <button
      onClick={() => {
        const allIds = (tg.courseGroups ?? []).flatMap(g => g.reservations ?? []).map(r => r.id);
        const ids = shiftTargets.length > 0 ? shiftTargets : allIds;
        batchAdjustTaskTime(ids, tg.label, +5);
      }}
      className="px-1 py-0.5 bg-gray-300 rounded text-xs"
    >
      ＋5
    </button>
  </div>
)}
                          <div className="flex items-center">
                            <button
                              onClick={() => {
                                const key = `${timeKey}_${tg.label}`;
                                if (selectionModeTask === key) {
                                  setSelectionModeTask(null);
                                  setSelectedForComplete([]);
                                } else {
                                  setSelectionModeTask(key);
                                  setSelectedForComplete([]);
                                }
                              }}
                              className="ml-2 px-2 py-0.5 bg-yellow-500 text-white rounded text-sm"
                            >
                              {selectionModeTask === `${timeKey}_${tg.label}` ? 'キャンセル' : '選択完了'}
                            </button>
                            {selectionModeTask === `${timeKey}_${tg.label}` && (
                              <button
                                onClick={() => {
                                  selectedForComplete.forEach((resId) => {
                                    const key = `${timeKey}_${tg.label}_${filteredReservations.find(r => r.id === resId)?.course}`;
                                    updateReservationField(
                                      resId,
                                      'completed',
                                      (() => {
                                        const prevCompleted = filteredReservations.find(r => r.id === resId)?.completed || {};
                                        const wasDone = Boolean(prevCompleted[key]);
                                        return {
                                          ...prevCompleted,
                                          [key]: !wasDone
                                        };
                                      })()
                                    );
                                  });
                                  setSelectionModeTask(null);
                                  setSelectedForComplete([]);
                                }}
                                className="ml-2 px-2 py-0.5 bg-green-700 text-white rounded text-sm"
                              >
                                完了登録
                              </button>
                            )}
                          </div>
                        </div>
                        {(showCourseAll
                          ? tg.courseGroups.map((cg) => {
                              const allRes = cg.reservations;
                              const sortedArr = taskSort === 'guests'
                                ? allRes.slice().sort((a, b) => a.guests - b.guests)
                                : allRes.slice().sort((a, b) => Number(a.table) - Number(b.table));
                              return (
                                <div key={cg.courseName} className="mb-1">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="italic">（{cg.courseName}）</span>
                                    {/* 削除: per-course 全完了ボタン */}
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {sortedArr.map((r) => {
                                      const keyForThisTask = `${timeKey}_${tg.label}`;
                                      const compKeyDetail = `${timeKey}_${tg.label}_${cg.courseName}`;
                                      const currentDone = Boolean(r.completed[compKeyDetail]);
                                      const previewDone =
                                        selectionModeTask === keyForThisTask && selectedForComplete.includes(r.id)
                                          ? !currentDone
                                          : currentDone;
                                      return (
                                        <div
                                          key={r.id}
                                          onClick={() => {
                                            const key = keyForThisTask; // `${timeKey}_${tg.label}`
                                            // 1) 時間調整モード中は shiftTargets のトグルを最優先
                                            if (shiftModeKey === key) {
                                              setShiftTargets((prev) =>
                                                prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id]
                                              );
                                              return; // 既存の selectionMode は実行しない
                                            }
                                            // 2) 既存の「完了登録」用の選択モード
                                            if (selectionModeTask === key) {
                                              setSelectedForComplete((prev) =>
                                                prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                                              );
                                            }
                                          }}
                                          className={`border px-2 py-1 rounded text-xs ${
                                            previewDone ? 'opacity-50 line-through bg-gray-300' : ''
                                          } ${
                                            // 時間調整の選択中は青いリング
                                            shiftModeKey === keyForThisTask && shiftTargets.includes(r.id)
                                              ? 'ring-2 ring-blue-400'
                                              : ''
                                          } ${
                                            // 既存の完了選択中は黄色いリング
                                            selectionModeTask === keyForThisTask && selectedForComplete.includes(r.id)
                                              ? 'ring-2 ring-yellow-400'
                                              : ''
                                          } ${firstRotatingId[r.table] === r.id ? 'text-red-500' : ''}`}
                                        >
                                          {showTableStart && r.table}
                                          {showGuestsAll && <>({r.guests})</>}  
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })
                          : (() => {
                              const allRes = tg.courseGroups.flatMap((cg) => cg.reservations);
                              const sortedArr = taskSort === 'guests'
                                ? allRes.slice().sort((a, b) => a.guests - b.guests)
                                : allRes.slice().sort((a, b) => Number(a.table) - Number(b.table));
                              return (
                                <div key={`${tg.label}-all`} className="mb-1">
                                  <div className="flex items-center justify-between mb-1">
                                    {/* 削除: 全完了ボタン (一括) */}
                                    <button
                                      onClick={() => {
                                        const key = `${timeKey}_${tg.label}`;
                                        if (selectionModeTask === key) {
                                          setSelectionModeTask(null);
                                          setSelectedForComplete([]);
                                        } else {
                                          setSelectionModeTask(key);
                                          setSelectedForComplete([]);
                                        }
                                      }}
                                      className="ml-2 px-2 py-0.5 bg-yellow-500 text-white rounded text-xs"
                                    >
                                      {selectionModeTask === `${timeKey}_${tg.label}` ? 'キャンセル' : '選択完了'}
                                    </button>
                                    {selectionModeTask === `${timeKey}_${tg.label}` && (
                                      <button
                                        onClick={() => {
                                          selectedForComplete.forEach((resId) => {
                                            const key = `${timeKey}_${tg.label}_${filteredReservations.find(r => r.id === resId)?.course}`;
                                            updateReservationField(
                                              resId,
                                              'completed',
                                              {
                                                ...filteredReservations.find(r => r.id === resId)?.completed,
                                                [key]: true
                                              }
                                            );
                                          });
                                          setSelectionModeTask(null);
                                          setSelectedForComplete([]);
                                        }}
                                        className="ml-2 px-2 py-0.5 bg-green-700 text-white rounded text-xs"
                                      >
                                        完了登録
                                      </button>
                                    )}
                                    {/* ── 調整ツールバー（調整モード時のみ表示：allRes を対象） ── */}
                                    {shiftModeKey === `${timeKey}_${tg.label}` && (
                                      <div className="flex items-center space-x-1 ml-2">
                                        <button
                                          onClick={() => setShiftTargets(allRes.map(r => r.id))}
                                          className="px-1 py-0.5 bg-gray-200 rounded text-xs"
                                        >
                                          全選択
                                        </button>
                                        <button
                                          onClick={() => setShiftTargets([])}
                                          className="px-1 py-0.5 bg-gray-200 rounded text-xs"
                                        >
                                          解除
                                        </button>
                                        <button
                                          onClick={() => {
                                            const ids = (shiftTargets.length > 0 ? shiftTargets : allRes.map(r => r.id));
                                            batchAdjustTaskTime(ids, tg.label, -5);
                                          }}
                                          className="px-1 py-0.5 bg-gray-300 rounded text-xs"
                                        >
                                          −5
                                        </button>
                                        <button
                                          onClick={() => {
                                            const ids = (shiftTargets.length > 0 ? shiftTargets : allRes.map(r => r.id));
                                            batchAdjustTaskTime(ids, tg.label, +5);
                                          }}
                                          className="px-1 py-0.5 bg-gray-300 rounded text-xs"
                                        >
                                          ＋5
                                        </button>
                                      </div>
                                    )}
                                    <div className="italic">(一括)</div>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {sortedArr.map((r) => {
                                      const keyForThisTask = `${timeKey}_${tg.label}`;
                                      const compKeyDetail = `${timeKey}_${tg.label}_${r.course}`;
                                      const currentDone = Boolean(r.completed[compKeyDetail]);
                                      const previewDone =
                                        selectionModeTask === keyForThisTask && selectedForComplete.includes(r.id)
                                          ? !currentDone
                                          : currentDone;
                                      return (
                                        <div
                                          key={r.id}
                                          onClick={() => {
                                            if (selectionModeTask === keyForThisTask) {
                                              setSelectedForComplete((prev) =>
                                                prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                                              );
                                            }
                                          }}
                                          className={`border px-2 py-1 rounded text-xs ${
                                            previewDone ? 'opacity-50 line-through bg-gray-300' : ''
                                          } ${selectionModeTask === keyForThisTask && selectedForComplete.includes(r.id) ? 'ring-2 ring-yellow-400' : ''} ${firstRotatingId[r.table] === r.id ? 'text-red-500' : ''}`}
                                        >
                                          {showTableStart && r.table}
                                          {showGuestsAll && <>({r.guests})</>}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })())}
                      </div>
                    );
                  })
                )}
                {sortedTimeKeys.length === 0 && (
                  <div className="text-center text-gray-500">
                    表示するタスクはありません。
                  </div>
                )}
              </div>
            ))}
          </section>
        </>
      )}

      {/* ─────────────── 5. 数値パッドモーダル ─────────────── */}
      {numPadState && numPadState.field !== 'presetTable' && (
        <div className="fixed inset-0 bg-black/30 flex items-end justify-center z-50">
          <div className="bg-white w-full max-w-md rounded-t-lg pb-4 shadow-lg">
            <div className="p-4 border-b">
              <p className="text-center text-lg font-semibold">
                {numPadState.field === 'table'
                  ? '卓番 を入力'
                  : numPadState.field === 'guests'
                  ? '人数 を入力'
                  : ''}
              </p>
              <p className="mt-2 text-center text-2xl font-mono">
                {numPadState.value || '　'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 p-4">
              {['1','2','3','4','5','6','7','8','9','0'].map((digit) => (
                <button
                  key={digit}
                  onClick={() => onNumPadPress(digit)}
                  className="bg-gray-200 rounded text-xl font-mono py-2"
                >
                  {digit}
                </button>
              ))}
              <button
                onClick={() => onNumPadPress('←')}
                className="bg-gray-200 rounded text-xl font-mono py-2"
              >
                ←
              </button>
              <button
                onClick={() => onNumPadPress('C')}
                className="bg-gray-200 rounded text-xl font-mono py-2"
              >
                C
              </button>
              <button
                onClick={onNumPadConfirm}
                className="col-span-3 bg-blue-500 rounded text-white text-lg py-2"
              >
                確定
              </button>
            </div>
            <button
              onClick={onNumPadCancel}
              className="w-full text-center text-sm text-gray-500 py-2"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

     {/* ─────────────── 予約リスト×コース開始時間表セクション ─────────────── */}
{/* ─────────────── 予約リスト×コース開始時間表セクション ─────────────── */}
{selectedMenu === '予約リスト×コース開始時間表' && (
  <section>
    {/* 来店入力セクション */}
    <button
      onClick={() => setResInputOpen(prev => !prev)}
      className="w-full text-left p-2 font-semibold bg-gray-100 rounded text-sm"
    >
      {resInputOpen ? '▼▼ 予約リスト' : '▶▶ 予約リスト'}
    </button>
    {resInputOpen && (
      <div className="sm:p-4 p-2 space-y-4 text-sm border rounded overflow-x-auto">
        {/* ─────────────── 予約リスト（入力＆テーブル） ─────────────── */}
        {/* ── 予約リスト ヘッダー ───────────────────── */}
        <div className="flex flex-col space-y-2">
          {/* 上段：表示順ラジオ */}
          <div className="flex items-center space-x-4">
            <label className="mr-2">表示順：</label>
            <label>
              <input
                type="radio"
                name="resOrder"
                checked={resOrder === 'table'}
                onChange={() => {
                  setResOrder('table');
                  localStorage.setItem(`${ns}-resOrder`, 'table');
                }}
                className="mr-1"
              />
              卓番順
            </label>
            <label className="ml-2">
              <input
                type="radio"
                name="resOrder"
                checked={resOrder === 'time'}
                onChange={() => {
                  setResOrder('time');
                  localStorage.setItem(`${ns}-resOrder`, 'time');
                }}
                className="mr-1"
              />
              時間順
            </label>
          </div>

          {/* 下段：卓番変更 & 全リセット & 予約確定 */}
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setEditTableMode(prev => !prev)}
              className={`px-2 py-0.5 rounded text-sm ${
                editTableMode ? 'bg-green-500 text-white' : 'bg-gray-300'
              }`}
            >
              卓番変更
            </button>

            <button
              onClick={resetAllReservations}
              className="px-3 py-1 bg-red-500 text-white rounded text-sm"
            >
              全リセット
            </button>

            <button
  onClick={() => {
    if (!navigator.onLine) {
      alert('オフラインのため送信できません。オンラインで再度お試しください。');
      return;
    }
    flushQueuedOps()
      .then(() => toast.success('Firestore へ予約を一括送信しました！'))
      .catch((err) => {
        console.error('flushQueuedOps failed', err);
        toast.error('送信に失敗しました');
      });
  }}
  className="px-6 py-4 bg-blue-600 text-white rounded text-sm"
>
  予約確定
</button>
          </div>
        </div>
                <div className="flex items-center space-x-4 ml-4">
                  <label className="flex items-center space-x-1">
                    <input
                      type="checkbox"
                      checked={showEatCol}
                      onChange={(e) => setShowEatCol(e.target.checked)}
                      className="mr-1"
                    />
                    <span>食表示</span>
                  </label>
                  <label className="flex items-center space-x-1">
                    <input
                      type="checkbox"
                      checked={showDrinkCol}
                      onChange={(e) => setShowDrinkCol(e.target.checked)}
                      className="mr-1"
                    />
                    <span>飲表示</span>
                  </label>
        </div>

        <div className="hidden sm:flex items-center space-x-4">
          <label className="flex items-center space-x-1">
            <input
              type="checkbox"
              checked={showNameCol}
              onChange={() => setShowNameCol((p) => !p)}
              className="mr-1"
            />
            <span>氏名表示</span>
          </label>
          <label className="flex items-center space-x-1">
            <input
              type="checkbox"
              checked={showNotesCol}
              onChange={() => setShowNotesCol((p) => !p)}
              className="mr-1"
            />
            <span>備考表示</span>
          </label>
        </div> 
        {editTableMode && Object.keys(pendingTables).length > 0 && (
          <div className="mt-2 space-y-1">
            {Object.entries(pendingTables).map(([id, tbl]) => (
              <div
                key={id}
                className="px-2 py-1 bg-yellow-50 border rounded text-sm flex justify-between"
              >
                <span>{tbl.old}卓 → {tbl.next}卓</span>
                <button
                  onClick={() =>
                    setPendingTables(prev => {
                      const next = { ...prev };
                      delete next[Number(id)];
                      return next;
                    })
                  }
                  className="text-red-500 text-xs ml-4"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={commitTableMoves}
              className="mt-2 px-4 py-1 bg-green-600 text-white rounded text-sm"
            >
              変更を完了する
            </button>
          </div>
        )}
        <table className="min-w-full table-auto border text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="border px-1 py-1 w-24">来店時刻</th>
              <th className="border px-1 py-1 w-20">卓番</th>
              {showNameCol && <th className="border px-1 py-1 w-24 hidden sm:table-cell">氏名</th>}
              <th className="border px-1 py-1 w-24">コース</th>
              {showEatCol   && <th className="border px-1 py-0.5 w-14 text-center">食</th>}
              {showDrinkCol && <th className="border px-1 py-0.5 w-14 text-center">飲</th>}
              <th className="border px-1 py-1 w-20">人数</th>
              {showNotesCol && <th className="border px-1 py-1 w-24 hidden sm:table-cell">備考</th>}
              <th className="border px-1 py-1 w-12 hidden sm:table-cell">来店</th>
              <th className="border px-1 py-1 hidden sm:table-cell">会計</th>
              <th className="border px-1 py-1 w-12 hidden sm:table-cell">退店</th>
              <th className="border px-1 py-1 w-12">削除</th>
            </tr>
          </thead>
            <tbody>
            {filteredReservations.map((r, idx) => {
              const prev = filteredReservations[idx - 1];
              const borderClass = !prev || prev.time !== r.time
                ? 'border-t-2 border-gray-300'   // 時刻が変わる行 → 太線
                : 'border-b border-gray-300';    // 同時刻の行 → 細線
              return (
              <tr
                key={r.id}
                className={`${borderClass} text-center ${
                  checkedArrivals.includes(r.id) ? 'bg-green-100' : ''
                } ${
                  checkedDepartures.includes(r.id) ? 'bg-gray-300 text-gray-400' : ''
                } ${
                  firstRotatingId[r.table] === r.id ? 'text-red-500' : ''
                }`}
              >
                {/* 来店時刻セル */}
                <td className="border px-1 py-1">
                  <select
                    value={r.time}
                    onChange={(e) => updateReservationField(r.id, 'time', e.target.value)}
                    className="border px-1 py-0.5 rounded text-sm"
                  >
                    {timeOptions.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                {/* 卓番セル */}
<td>
  <input
    type="text"
    readOnly
    value={editTableMode && pendingTables[r.id] ? pendingTables[r.id].next : r.table}
    onClick={() => {
      if (editTableMode) {
        if (!tablesForMove.includes(r.id)) {
          // プレビュー用エントリを追加
          setPendingTables(prev => ({
            ...prev,
            [r.id]: { old: r.table, next: r.table },
          }));
        } else {
          // プレビュー用エントリを削除
          setPendingTables(prev => {
            const next = { ...prev };
            delete next[r.id];
            return next;
          });
        }
        toggleTableForMove(r.id);
        // すぐに NumPad を開く
        setNumPadState({
          id: r.id,
          field: 'targetTable',
          value: pendingTables[r.id]?.next ?? r.table,
        });
      } else {
        // 通常モードでの卓番号編集
        setNumPadState({ id: r.id, field: 'table', value: r.table });
      }
    }}
    className={`border px-1 py-0.5 rounded text-sm w-full text-center ${
      editTableMode && tablesForMove.includes(r.id) ? 'border-4 border-blue-500' : ''
    }`}
  />
</td>
                {/* 氏名セル */}
                {showNameCol && (
                  <td className="border px-1 py-1 hidden sm:table-cell">
                    <input
                      type="text"
                      value={r.name ?? ''}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        setReservations((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, name: newValue } : x))
                        );
                        updateReservationField(r.id, 'name', newValue);
                      }}
                      placeholder="氏名"
                      className="border px-1 py-0.5 w-full rounded text-sm text-center"
                    />
                  </td>
                )}
                {/* コースセル */}
                <td className="border px-1 py-1">
                  <select
                    value={r.course}
                    onChange={(e) => updateReservationField(r.id, 'course', e.target.value)}
                    className="border px-1 py-0.5 rounded text-sm"
                  >
                    {courses.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </td>
               {/* 食・飲 列 */}
{showEatCol && (
  <td className="border px-1 py-0.5 text-center">
    <select
      value={r.eat || ''}
      onChange={(e) => updateReservationField(r.id, 'eat', e.target.value)}
      className="border px-1 py-0.5 w-14 text-xs rounded"
    >
      <option value=""></option>
      {eatOptions.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  </td>
)}
{showDrinkCol && (
  <td className="border px-1 py-0.5 text-center">
    <select
      value={r.drink || ''}
      onChange={(e) => updateReservationField(r.id, 'drink', e.target.value)}
      className="border px-1 py-0.5 w-14 text-xs rounded"
    >
      <option value=""></option>
      {drinkOptions.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  </td>
)}
                {/* 人数セル */}
                <td className="border px-1 py-1">
                  <input
                    type="text"
                    value={r.guests}
                    readOnly
                    onClick={() =>
                      setNumPadState({ id: r.id, field: 'guests', value: r.guests.toString() })
                    }
                    className="border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer"
                  />
                </td>
                {/* 備考セル */}
                {showNotesCol && (
                  <td className="border px-1 py-1 hidden sm:table-cell">
                    <input
                      type="text"
                      value={r.notes ?? ''}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        setReservations((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, notes: newValue } : x))
                        );
                        updateReservationField(r.id, 'notes', newValue);
                      }}
                      placeholder="備考"
                      className="border px-1 py-0.5 w-full rounded text-sm text-center"
                    />
                  </td>
                )}
                {/* 来店チェックセル */}
                <td className="border px-1 py-1 hidden sm:table-cell">
                  <button
                    onClick={() => toggleArrivalChecked(r.id)}
                       className={`px-2 py-0.5 rounded text-sm ${
     // 退店済みなら最優先で濃いグレー＆白文字
     checkedDepartures.includes(r.id)
       ? 'bg-gray-500 text-white'
       // それ以外で来店チェック済みなら緑＆白文字
       : checkedArrivals.includes(r.id)
         ? 'bg-green-500 text-white'
         // 通常は薄いグレー＆黒文字
         : 'bg-gray-200 text-black'
   }`}
                  >
                    来
                  </button>
                </td>
                {/* 会計チェックセル (タブレット表示) */}
                        <td className="hidden sm:table-cell px-1">
  <button
    onClick={() => togglePaymentChecked(r.id)}
    className={`px-2 py-0.5 rounded text-sm ${
  checkedDepartures.includes(r.id)          /* 退店済みなら最優先で濃いグレー＆白文字 */
    ? 'bg-gray-500 text-white'
    : checkedPayments.includes(r.id)        /* 会計チェック時だけ青 */
    ? 'bg-blue-500 text-white'
    : 'bg-gray-200 text-black'
}`}
  >
    会
  </button>
</td>
                {/* 退店チェックセル */}
                <td className="border px-1 py-1 hidden sm:table-cell">
                  <button
                    onClick={() => toggleDepartureChecked(r.id)}
                    className={`
                      px-2 py-0.5 rounded text-sm
                      ${checkedDepartures.includes(r.id) ? 'bg-gray-500 text-white' : 'bg-gray-200 text-black'}
                    `}
                  >
                    退
                  </button>
                </td>
                {/* 削除セル */}
                <td className="border px-1 py-1">
                  <button
                    onClick={() => deleteReservation(r.id)}
                    className="bg-red-500 text-white px-2 py-0.5 rounded text-sm"
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
            })}
            {/* 新規予約行 */}
            <tr className="bg-gray-50">
              <td className="border px-1 py-1">
                <select
                  value={newResTime}
                  onChange={(e) => setNewResTime(e.target.value)}
                  className="border px-1 py-0.5 rounded text-sm"
                  required
                >
                  {timeOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </td>
              <td className="border px-1 py-1">
                           <input
             type="text"
             value={newResTable}
             readOnly
             onClick={() => setNumPadState({ id: '-1', field: 'guests', value: '' })}
             placeholder="例:101"
                  maxLength={3}
                  className="border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer"
                  required
                />
              </td>
              {showNameCol && (
                <td className="border px-1 py-1 hidden sm:table-cell">
                  <input
                    type="text"
                    value={newResName}
                    onChange={(e) => setNewResName(e.target.value)}
                    placeholder="氏名"
                    className="border px-1 py-0.5 w-full rounded text-sm text-center"
                  />
                </td>
              )}
              <td className="border px-1 py-1">
                <select
                  value={newResCourse}
                  onChange={(e) => setNewResCourse(e.target.value)}
                  className="border px-1 py-0.5 rounded text-sm"
                >
                  {courses.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </td>
              {showGuestsCol && (
                <td className="border px-1 py-1">
                             <input
             type="text"
             value={newResTable}
             readOnly
             onClick={() => setNumPadState({ id: '-1', field: 'guests', value: '' })}
             placeholder="例:101"
                    maxLength={3}
                    className="border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer"
                    required
                  />
                </td>
              )}
              {showNotesCol && (
                <td className="border px-1 py-1 hidden sm:table-cell">
                  <input
                    type="text"
                    value={newResNotes}
                    onChange={(e) => setNewResNotes(e.target.value)}
                    placeholder="備考"
                    className="border px-1 py-0.5 w-full rounded text-sm text-center"
                  />
                </td>
              )}
              <td className="border px-1 py-1 text-center">
                <button
                  onClick={addReservation}
                  className="bg-blue-500 text-white px-2 py-0.5 rounded text-sm"
                >
                  ＋
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )}
{selectedMenu === '予約リスト×コース開始時間表' && (
  <section className="mt-6">
    {/* コース開始時間表 */}
    <h2 className="text-xl font-bold mb-4">コース開始時間表</h2>

    {/* 並び替えコントロール */}
    <div className="flex items-center space-x-4 mb-4">
      <span className="font-medium">並び替え：</span>
      <label className="flex items-center space-x-1">
        <input
          type="radio"
          name="courseStartSort"
          value="table"
          checked={taskSort === 'table'}
          onChange={() => setTaskSort('table')}
          className="mr-1"
        />
        卓番順
      </label>
      <label className="flex items-center space-x-1">
        <input
          type="radio"
          name="courseStartSort"
          value="guests"
          checked={taskSort === 'guests'}
          onChange={() => setTaskSort('guests')}
          className="mr-1"
        />
        人数順
      </label>
    </div>
    {/* ── 卓番表示 切り替え ── */}
<div className="flex items-center space-x-2 mb-4">
  <span className="font-semibold text-sm">卓番:</span>
  <button
    onClick={() => setShowTableStart(true)}
    className={`px-2 py-0.5 rounded text-xs ${
      showTableStart ? 'bg-blue-500 text-white' : 'bg-gray-200'
    }`}
  >
    ON
  </button>
  <button
    onClick={() => setShowTableStart(false)}
    className={`px-2 py-0.5 rounded text-xs ${
      !showTableStart ? 'bg-blue-500 text-white' : 'bg-gray-200'
    }`}
  >
    OFF
  </button>
</div>
    {/* ── フィルター切り替え ── */}
<div className="flex items-center space-x-2 mb-4">
  <span className="font-semibold text-sm">フィルター:</span>
  <button
    onClick={() => setCourseStartFiltered(true)}
    className={`px-2 py-0.5 rounded text-xs ${
      courseStartFiltered ? 'bg-blue-500 text-white' : 'bg-gray-200'
    }`}
  >
    ON
  </button>
  <button
    onClick={() => setCourseStartFiltered(false)}
    className={`px-2 py-0.5 rounded text-xs ${
      !courseStartFiltered ? 'bg-blue-500 text-white' : 'bg-gray-200'
    }`}
  >
    OFF
  </button>
</div>

    <div className="space-y-6 text-sm">
      {Object.entries(groupedStartTimes).map(([timeKey, groups], timeIdx) => (
        <div
          key={timeKey}
          className={`
            mb-4 rounded-lg p-3
            ${timeIdx % 2 === 0 ? 'bg-blue-50 border-l-4 border-blue-400' : 'bg-gray-50 border-l-4 border-gray-400'}
          `}
        >
          {/* 時間帯ヘッダー */}
          <div className="font-bold text-lg mb-2">{timeKey}</div>

          {/* 各コースごとの卓バッジ */}
          {groups.map((g) => (
            <div key={g.courseName} className="mb-2">
              <div className="font-medium mb-1">{g.courseName}</div>
              <div className="flex flex-wrap gap-2">
                {g.reservations
                  .slice()
                  .sort((a, b) =>
                    taskSort === 'guests'
                      ? a.guests - b.guests
                      : Number(a.table) - Number(b.table)
                  )
                  .map((r) => (
                    <span
                      key={r.id}
                      className={`
                        border px-2 py-1 rounded text-xs
                        ${rotatingTables.has(r.table) && firstRotatingId[r.table] === r.id ? 'text-red-500' : ''}
                      `}
                    >
                      {showTableStart && r.table}
                      {showGuestsAll && <>({r.guests})</>}
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  </section>
)}
  </section>
)}    
{/* ─────────────── テーブル管理セクション ─────────────── */}

 
 </main>
    </>
  );
}

//
// ─────────────────────────────── EOF ────────────────────────────────────────────
//