'use client';
export type NumPadField = 'table' | 'guests' | 'presetTable' | 'targetTable' | 'pendingTable';

import React from 'react';
import { useParams } from 'next/navigation';
import { toggleTaskComplete } from '@/lib/reservations';
import { renameCourseTx } from '@/lib/courses';
import { loadStoreSettings, saveStoreSettingsTx, db } from '@/lib/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { flushQueuedOps } from '@/lib/opsQueue';
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-expressions */
// 📌 ChatGPT からのテスト編集: 拡張機能連携確認済み

import type { StoreSettings } from '@/types/settings';

import { useState, ChangeEvent, FormEvent, useMemo, useEffect, useRef } from 'react';
import {
  ensureServiceWorkerRegistered,
  requestPermissionAndGetToken,
  ensureFcmRegistered,
} from "@/lib/firebase-messaging";
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
  // ─── オンライン復帰時にキュー flush + 再取得 ───
  useEffect(() => {
    const flush = async () => {
      try {
        await flushQueuedOps();
        // 念のため最新を 1 回だけ取得して UI を同期
        const list = await fetchAllReservationsOnce();
        if (list && Array.isArray(list)) {
          setReservations(list as any);
        }
      } catch {
        /* noop */
      }
    };
    window.addEventListener('online', flush);
    flush(); // マウント時にも一度
    return () => window.removeEventListener('online', flush);
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

  /** デバイスID（ローカル一意）を取得・生成 */
  const getDeviceId = (): string => {
    if (typeof window === 'undefined') return 'server';
    const key = `${ns}-deviceId`;
    let v = localStorage.getItem(key);
    if (!v) {
      v = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
      localStorage.setItem(key, v);
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
  // 表示順選択 (table/time/created)
  const [resOrder, setResOrder] = useState<'table' | 'time' | 'created'>(() => {
    if (typeof window === 'undefined') return 'table';
    const saved = localStorage.getItem(`${ns}-resOrder`);
    if (saved === 'table' || saved === 'time' || saved === 'created') return saved;
    return 'table';
  });
  // 並び順セレクタの変更をlocalStorageに保存
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`${ns}-resOrder`, resOrder);
    }
  }, [resOrder]);

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

  /** タスクラベルを安全にリネーム（UI/ローカル/Firestore整合） */
  const renameTaskLabel = (oldLabel: string, newLabel: string, offset: number) => {
    if (!newLabel || newLabel.trim() === '' || newLabel === oldLabel) return;

    /* 1) courses の該当タスクを置換（選択中コース内） */
    setCourses(prev => {
      const next = prev.map(c => {
        if (c.name !== selectedCourse) return c;
        const updatedTasks = c.tasks.map(t =>
          t.timeOffset === offset && t.label === oldLabel ? { ...t, label: newLabel } : t
        );
        return { ...c, tasks: updatedTasks };
      });
      try { localStorage.setItem(`${ns}-courses`, JSON.stringify(next)); } catch {}
      return next;
    });

    /* 2) “その他タブ” の表示タスクフィルター（checkedTasks）を置換 */
    setCheckedTasks(prev => {
      const next = prev.map(l => (l === oldLabel ? newLabel : l));
      try { localStorage.setItem(`${ns}-checkedTasks`, JSON.stringify(next)); } catch {}
      return next;
    });

    /* 3) tasksByPosition（ポジション×コースの表示タスク）内の該当ラベルを置換 */
    setTasksByPosition(prev => {
      const next: Record<string, Record<string, string[]>> = {};
      Object.entries(prev).forEach(([pos, courseMap]) => {
        const newCourseMap: Record<string, string[]> = {};
        Object.entries(courseMap || {}).forEach(([courseName, labels]) => {
          newCourseMap[courseName] = (labels || []).map(l => (l === oldLabel ? newLabel : l));
        });
        next[pos] = newCourseMap;
      });
      try { localStorage.setItem(`${ns}-tasksByPosition`, JSON.stringify(next)); } catch {}
      return next;
    });

    /* 4) reservations の timeShift キー & completed キーも置換 */
    setReservations(prev => {
      const next = prev.map(r => {
        // timeShift: { [label]: offset }
        let newTimeShift = r.timeShift;
        if (newTimeShift && Object.prototype.hasOwnProperty.call(newTimeShift, oldLabel)) {
          const { [oldLabel]: oldVal, ...rest } = newTimeShift;
          newTimeShift = { ...rest, [newLabel]: oldVal };
        }

        // completed: { `${label}_${course}`: boolean }
        const newCompleted: Record<string, boolean> = {};
        Object.entries(r.completed || {}).forEach(([key, done]) => {
          if (key.startsWith(`${oldLabel}_`)) {
            const replaced = key.replace(new RegExp(`^${oldLabel}_`), `${newLabel}_`);
            newCompleted[replaced] = done;
          } else {
            newCompleted[key] = done;
          }
        });

        return { ...r, timeShift: newTimeShift, completed: newCompleted };
      });
      persistReservations(next);
      return next;
    });

    /* 5) 編集行のハイライトを最新ラベルに合わせて継続 */
    setEditingTask(cur => (cur && cur.offset === offset && cur.label === oldLabel ? { offset, label: newLabel } : cur));
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

  const sortedByCreated = useMemo(() => {
    return [...reservations].sort((a, b) => Number(a.id) - Number(b.id));
  }, [reservations]);

  // 表示順決定
  const sortedReservations =
    resOrder === 'time' ? sortedByTime : resOrder === 'created' ? sortedByCreated : sortedByTable;

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

  // 通知有効化の進行状態 & トグル処理
  const [notiBusy, setNotiBusy] = useState(false);
  const handleRemindersToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
 await ensureFcmRegistered(deviceId, id as string);
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

      cdef.tasks.forEach((t) => {
        // 営業前設定の表示タスクフィルターを尊重（非表示タスクは通知しない）
        const allowed = (() => {
          const set = new Set<string>();
          checkedTasks.forEach((l) => set.add(l));
          if (selectedDisplayPosition !== 'その他') {
            const posObj = tasksByPosition[selectedDisplayPosition] || {};
            (posObj[courseByPosition[selectedDisplayPosition]] || []).forEach((l) => set.add(l));
          }
          // set が空なら制約なし
          return set.size === 0 || set.has(t.label);
        })();
        if (!allowed) return;

        const absMin = baseMin + t.timeOffset + (res.timeShift?.[t.label] ?? 0);
        if (absMin !== nowMin) return; // ちょうど今の分だけ通知

        const dateStr = res.date || todayKey();
        const dedupeKey = `${dateStr}_${res.id}_${t.label}_${res.course}_${res.time}`;
        if (hasSent(dedupeKey)) return;

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
      });
    });
  // 依存には、時刻の他、予約・設定類を含める（重い場合は最小化してOK）
  }, [currentTime, remindersEnabled, reservations, courses, checkedTasks, selectedDisplayPosition, tasksByPosition, courseByPosition, checkedDepartures]);

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
      eat: newResEat,
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

    // 2) Firestore へは常に投げる（オフライン時は SDK が自動キュー）
    try {
      await addReservationFS(newEntry as any);
    } catch (err) {
      // オフラインや一時的なネットワークエラー時でも SDK がキューイングする
      console.error('addReservationFS failed (queued if offline):', err);
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

      // ── Firestore へは常に投げる（オフライン時は SDK が自動キュー） ──
      try {
        const baseVersion = (prev.find(r => r.id === id) as any)?.version ?? 0;
        updateReservationFS(id, { [field]: value } as any, baseVersion).catch(err =>
          console.error('updateReservationFS failed (queued if offline):', err)
        );
      } catch { /* noop */ }

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

    /* ② Firestore へインクリメンタル更新（オフライン時は自動キュー） */
    updateReservationFS(resId, {}, { [label]: delta }).catch(err =>
      console.error('updateReservationFS(timeShift) failed (queued if offline):', err)
    );
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

    // 2) Firestore 同期（当面は1件ずつ。オフライン時は SDK が自動キュー）
    ids.forEach(resId => {
      updateReservationFS(resId, {}, { [label]: delta }).catch(err =>
        console.error('updateReservationFS(timeShift) failed (queued if offline):', err)
      );
    });
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
      <main className="pt-12 p-4 space-y-6">
        
      {/* 並び順セレクター */}
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="resOrder">予約の並び順:</label>
        <select
          id="resOrder"
          className="border px-2 py-1 rounded"
          value={resOrder}
          onChange={(e) => setResOrder(e.target.value as 'table' | 'time' | 'created')}
        >
          <option value="table">卓番号順</option>
          <option value="time">時間順</option>
          <option value="created">追加順</option>
        </select>
      </div>
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
                      const oldLabel = task.label;
                      const newLabel = e.target.value;
                      renameTaskLabel(oldLabel, newLabel, task.timeOffset);
                    }}
                    className="border px-2 py-1 rounded text-sm"
                  />
                                  </div>
              ))}
            </div>
          )}
        </section>
      )}
            </main>
    </>
  );
}