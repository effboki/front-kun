// src/app/[storeId]/_components/ReservationsSection.tsx
import React, { memo } from 'react';
import type { ResOrder, Reservation, PendingTables } from '@/types';
import type { FormEvent, Dispatch, SetStateAction } from 'react';
import { parseTimeToMinutes } from '@/lib/time';

// 共通ヘルプ文言（食/飲 iボタン）
const EAT_DRINK_INFO_MESSAGE =
  '予約リストで「食べ放題／飲み放題」の列を表示・非表示できます。\n店舗設定でプラン名（例：食べ放題90分、飲み放題L）を登録しておくと、各予約の「食」「飲」欄で選択できます。\n表示をONにすると、どの予約が対象かがひと目で分かります。';

// ───────── Local NumPad (multi-support) ─────────
type NumPadSubmit = { value: string; list?: string[] };

type NumPadProps = {
  open: boolean;
  title?: string;
  value?: string;
  initialList?: string[];
  /** 卓番号入力のとき true */
  multi?: boolean;
  onCancel: () => void;
  onSubmit: (result: NumPadSubmit) => void;
  beforeList?: string[]; // ← 追加
};

const NumPad: React.FC<NumPadProps> = ({
  open,
  title,
  value = '',
  initialList = [],
  multi = false,
  onCancel,
  onSubmit,
  beforeList = [],
}) => {
  const [val, setVal] = React.useState<string>('');
  const [list, setList] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!open) return;
    // 単一値は従来どおり。卓番号は空から打ち始めたい運用なので initialList は [] 想定
    setVal(value || '');
    setList(multi ? (Array.isArray(initialList) ? [...initialList] : []) : []);
  }, [open, value, initialList, multi]);

  const appendDigit = (d: string) =>
    setVal(prev => (prev + d).replace(/^0+(?=\d)/, ''));
  const backspace = () => setVal(prev => prev.slice(0, -1));
  const clearAll = () => setVal('');

  // 「＋ 追加」: 現在の val を list へ確定（空/重複は無視）
  const pushCurrentToList = () => {
    if (!multi) return;
    const v = val.trim();
    if (!v) return;
    setList(prev => (prev.includes(v) ? prev : [...prev, v]));
    setVal('');
  };
  const removeFromList = (t: string) => {
    if (!multi) return;
    setList(prev => prev.filter(x => x !== t));
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
        {/* プレビュー表示（大きめ＆淡背景） */}
        <div className="mb-2">
          {multi ? (
            <div className="ml-auto max-w-full tabular-nums text-right bg-gray-100 border border-gray-200 rounded px-3 py-1.5">
              <span className="text-gray-500 text-base md:text-lg">
                {(Array.isArray(beforeList) && beforeList.length > 0 ? beforeList : []).join('.')}
                {Array.isArray(beforeList) && beforeList.length > 0 ? <span className="ml-0.5">卓</span> : null}
              </span>
              <span className="mx-2 text-gray-400">→</span>
              {(() => {
                let after = Array.isArray(list) ? [...list] : [];
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

        {/* 複数卓: チップ */}
        {multi && (
          <div className="mb-3">
            <div className="flex flex-wrap gap-2 mb-2">
              {list.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300"
                >
                  <span className="tabular-nums">{t}</span>
                  <button
                    type="button"
                    onClick={() => removeFromList(t)}
                    className="leading-none px-1 hover:text-amber-900"
                    aria-label={`${t} を削除`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* キーパッド（4列：左3列＝数字/記号、右1列＝卓追加・確定） */}
        <div className="grid grid-cols-4 grid-rows-4 gap-2 items-stretch mt-2">
          {/* 1行目（7 8 9） */}
          <button type="button" className="py-3 rounded border bg-gray-50 hover:bg-gray-100 text-xl font-semibold" onClick={() => appendDigit('7')}>7</button>
          <button type="button" className="py-3 rounded border bg-gray-50 hover:bg-gray-100 text-xl font-semibold" onClick={() => appendDigit('8')}>8</button>
          <button type="button" className="py-3 rounded border bg-gray-50 hover:bg-gray-100 text-xl font-semibold" onClick={() => appendDigit('9')}>9</button>

          {/* 右列（卓追加／確定）を全行にわたって縦配置 */}
          <div className="col-start-4 row-start-1 row-span-4 flex flex-col gap-2">
            {multi && (
              <button
                type="button"
                onClick={pushCurrentToList}
                className="h-1/3 rounded bg-amber-400 hover:bg-amber-500 text-white font-semibold text-sm"
                title="卓追加"
                aria-label="卓追加"
              >
                卓追加
              </button>
            )}
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

        {/* キャンセル（下段に単独で配置） */}
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
// ────────────────────────────────────────────────


// Reservation objects enriched by useReservationsData: adds timeHHmm for display compatibility
type ReservationCompat = Reservation & { timeHHmm?: string };

type Props = {
  /** 画面に表示する予約（すでに親でフィルタ＆ソート済み） */
  reservations: ReservationCompat[];

  /** 並び順コントロール */
  resOrder: ResOrder;
  setResOrder: (v: ResOrder) => void;

  /** 上部アクションボタン */
  resetAllReservations: () => void;

  /** 卓番号編集モード関連（親 state をそのまま使う） */
  editTableMode: boolean;
  onToggleEditTableMode: () => void;
  tablesForMove: string[];
  pendingTables: PendingTables;
  toggleTableForMove: (id: string) => void;
  setPendingTables: React.Dispatch<React.SetStateAction<PendingTables>>;
  commitTableMoves: (override?: PendingTables) => Promise<void>;

  /** 数字入力パッドの制御（親で保持） */
  setNumPadState: (s: {
    id: string;
    field: 'table' | 'guests' | 'targetTable';
    value: string;
  }) => void;

  /** 表示オプション（列の表示切替） */
  showEatCol: boolean;
  setShowEatCol: React.Dispatch<React.SetStateAction<boolean>>;
  showDrinkCol: boolean;
  setShowDrinkCol: React.Dispatch<React.SetStateAction<boolean>>;
  showNameCol: boolean;
  setShowNameCol: React.Dispatch<React.SetStateAction<boolean>>;
  showNotesCol: boolean;
  setShowNotesCol: React.Dispatch<React.SetStateAction<boolean>>;
  showGuestsCol: boolean;

  /** 変更ドット（編集打刻）の共有状態 */
  editedMarks: Record<string, number>;
  setEditedMarks: React.Dispatch<React.SetStateAction<Record<string, number>>>;

  /** セル更新や行操作用ハンドラ（親の関数をそのまま渡す） */
  updateReservationField: (
    id: string,
    field:
      | 'time'
      | 'table'
      | 'name'
      | 'course'
      | 'eat'
      | 'drink'
      | 'guests'
      | 'notes'
      | 'eatLabel'
      | 'drinkLabel'
      | 'foodAllYouCan'
      | 'drinkAllYouCan',
    value: any,
  ) => void;
  deleteReservation: (id: string) => void;

  toggleArrivalChecked: (id: string) => void;
  togglePaymentChecked: (id: string) => void;
  toggleDepartureChecked: (id: string) => void;

  /** 行の状態（色付けなどに使用） */
  firstRotatingId: Record<string, string>;
  checkedArrivals: string[];
  checkedPayments: string[];
  checkedDepartures: string[];

  /** セレクトの選択肢 */
  timeOptions: string[];
  courses: { name: string }[];
  eatOptions: string[];
  drinkOptions: string[];

  /** 追加入力用 state */
  newResTime: string;
  setNewResTime: (v: string) => void;
  newResTable: string;
  newResName: string;
  setNewResName: (v: string) => void;
  newResCourse: string;
  setNewResCourse: (v: string) => void;
  newResEat: string;
  setNewResEat: (v: string) => void;
  newResDrink: string;
  setNewResDrink: (v: string) => void;
  newResGuests: number | '';
  setNewResGuests: Dispatch<SetStateAction<number | ''>>;
  newResNotes: string;
  setNewResNotes: (v: string) => void;
  addReservation: (e: FormEvent) => Promise<void>;
};

// ---- Eat/Drink normalization (align with ScheduleView fallback) ----
const extractLabel = (v: any): string => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(extractLabel).filter(Boolean).join(',');
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return String(v ?? '').trim();
};

const getEatValue = (r: any): string =>
  extractLabel(
    (typeof r?.eat === 'string' ? r.eat : undefined) ??
      r?.eatLabel ??
      r?.eatOption ??
      r?.reservation?.eatLabel ??
      (typeof r?.meta?.eat === 'string' ? r.meta.eat : undefined) ??
      (typeof r?.reservation?.eat === 'string' ? r.reservation.eat : undefined)
  );

const getDrinkValue = (r: any): string =>
  extractLabel(
    (typeof r?.drink === 'string' ? r.drink : undefined) ??
      r?.drinkLabel ??
      r?.drinkOption ??
      r?.reservation?.drinkLabel ??
      (typeof r?.meta?.drink === 'string' ? r.meta.drink : undefined) ??
      (typeof r?.reservation?.drink === 'string' ? r.reservation.drink : undefined)
  );

// ==== Component =============================================================

const ReservationsSection: React.FC<Props> = ({
  reservations,
  resOrder,
  setResOrder,
  resetAllReservations,
  editTableMode,
  onToggleEditTableMode,
  tablesForMove,
  pendingTables,
  toggleTableForMove,
  setPendingTables,
  commitTableMoves,
  setNumPadState,
  showEatCol,
  setShowEatCol,
  showDrinkCol,
  setShowDrinkCol,
  showNameCol,
  setShowNameCol,
  showNotesCol,
  setShowNotesCol,
  showGuestsCol,
  editedMarks,
  setEditedMarks,
  updateReservationField,
  deleteReservation,
  toggleArrivalChecked,
  togglePaymentChecked,
  toggleDepartureChecked,
  firstRotatingId,
  checkedArrivals,
  checkedPayments,
  checkedDepartures,
  timeOptions,
  courses,
  eatOptions,
  drinkOptions,
  newResTime,
  setNewResTime,
  newResTable,
  newResName,
  setNewResName,
  newResCourse,
  setNewResCourse,
  newResEat,
  setNewResEat,
  newResDrink,
  setNewResDrink,
  newResGuests,
  setNewResGuests,
  newResNotes,
  setNewResNotes,
  addReservation,
}) => {
  // --- Local NumPad control (open/close & current target) ---
  const [localNumPadState, setLocalNumPadState] = React.useState<{
    id: string;
    field: 'table' | 'guests' | 'targetTable';
    value: string;
  } | null>(null);
  const openNumPad = (s: { id: string; field: 'table' | 'guests' | 'targetTable'; value: string }) => {
    setLocalNumPadState(s);
  };
  const closeNumPad = () => setLocalNumPadState(null);
  // Optimistic inline edits for select boxes (eat/drink) to avoid flicker before server echo
  const [inlineEdits, setInlineEdits] = React.useState<Record<string, { eat?: string; drink?: string }>>({});
  // NEW判定（直後ドット用のローカル検知）
  const NEW_THRESHOLD = 15 * 60 * 1000; // 15分
  const initialRenderRef = React.useRef(true);
  const seenRef = React.useRef<Set<string>>(new Set());
  const localNewRef = React.useRef<Map<string, number>>(new Map());
  const prevSnapshotRef = React.useRef<Map<string, string>>(new Map());

  // ドット表示のための時間進行（30秒ごと再評価）
  const [nowTick, setNowTick] = React.useState<number>(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Reconcile optimistic edits when parent "reservations" updates with the same value
  React.useEffect(() => {
    setInlineEdits((prev) => {
      if (!prev || Object.keys(prev).length === 0) return prev;
      const next = { ...prev };
      for (const r of reservations) {
        const entry = next[r.id];
        if (!entry) continue;
        const eatMatch = entry.eat !== undefined && entry.eat === getEatValue(r);
        const drinkMatch = entry.drink !== undefined && entry.drink === getDrinkValue(r);
        if (eatMatch) delete entry.eat;
        if (drinkMatch) delete entry.drink;
        if (!entry.eat && !entry.drink) delete next[r.id];
        else next[r.id] = entry;
      }
      return next;
    });
  }, [reservations]);

    React.useEffect(() => {
      if (initialRenderRef.current) {
        // 初回レンダでは既存分を「既知」として登録（ドットは付けない）
        reservations.forEach((r) => {
          seenRef.current.add(r.id);
          const snap = JSON.stringify({
            time: r.time,
            table: (r.table ?? r.tables?.[0] ?? ''),
            name: r.name ?? '',
            course: r.course ?? '',
            eat: r.eat ?? '',
            drink: r.drink ?? '',
            guests: Number(r.guests) || 0,
            notes: r.notes ?? '',
          });
          prevSnapshotRef.current.set(r.id, snap);
        });
        initialRenderRef.current = false;
        return;
      }
      // 新しく現れたIDのみローカルで「NEW打刻」
      reservations.forEach((r) => {
        if (!seenRef.current.has(r.id)) {
          seenRef.current.add(r.id);
          localNewRef.current.set(r.id, Date.now());
        }
      });
      // 既存IDの変化を検知して「編集打刻」
      reservations.forEach((r) => {
        const curr = JSON.stringify({
          time: r.time,
          table: (r.table ?? r.tables?.[0] ?? ''),
          name: r.name ?? '',
          course: r.course ?? '',
          eat: r.eat ?? '',
          drink: r.drink ?? '',
          guests: Number(r.guests) || 0,
          notes: r.notes ?? '',
        });
        const prev = prevSnapshotRef.current.get(r.id);
        if (prev && prev !== curr) {
          setEditedMarks((m) => ({ ...m, [r.id]: Date.now() }));
        }
        prevSnapshotRef.current.set(r.id, curr);
      });
    }, [reservations]);

  // === 新規追加のデフォ時刻を「前回選んだ時刻」にする ===
  const LAST_TIME_KEY = 'frontkun:lastNewResTime';
  const appliedSavedTimeRef = React.useRef(false);
  const prevCountRef = React.useRef(reservations.length);

  // 1) 初回だけ、保存されている最終選択時刻があれば適用
  React.useEffect(() => {
    if (appliedSavedTimeRef.current) return;
    appliedSavedTimeRef.current = true;
    try {
      const saved = localStorage.getItem(LAST_TIME_KEY);
      if (saved && timeOptions.includes(saved) && newResTime !== saved) {
        setNewResTime(saved);
      }
    } catch {}
  }, []);

  // 2) ユーザーが新規行の来店時刻を変更したら保存
  React.useEffect(() => {
    try {
      if (newResTime && timeOptions.includes(newResTime)) {
        localStorage.setItem(LAST_TIME_KEY, newResTime);
      }
    } catch {}
  }, [newResTime, timeOptions]);

  // 3) 予約が増減したら（＝追加・削除後）、保存してある時刻を再適用
  //    → 親で newResTime が初期値に戻っても、直後に前回時刻へ戻す
  React.useEffect(() => {
    const prev = prevCountRef.current;
    if (reservations.length !== prev) {
      prevCountRef.current = reservations.length;
      try {
        const saved = localStorage.getItem(LAST_TIME_KEY);
        if (saved && timeOptions.includes(saved) && newResTime !== saved) {
          setNewResTime(saved);
        }
      } catch {}
    }
  }, [reservations.length, timeOptions, newResTime, setNewResTime]);
  // 並び替えヘルパー
  const getCreatedAtMs = (r: any): number => {
    // Firestore Timestamp
    if (r?.createdAt?.toMillis) return r.createdAt.toMillis();
    // seconds / nanoseconds 形式
    if (typeof r?.createdAt?.seconds === 'number') return r.createdAt.seconds * 1000 + (r.createdAt.nanoseconds ? Math.floor(r.createdAt.nanoseconds / 1e6) : 0);
    // number / string 日付
    if (typeof r?.createdAt === 'number') return r.createdAt;
    if (typeof r?.createdAt === 'string') {
      const ms = Date.parse(r.createdAt);
      if (!Number.isNaN(ms)) return ms;
    }
    // id がタイムスタンプ風なら利用（降順安定用の弱いフォールバック）
    if (typeof r?.id === 'string' && /^\d{10,}$/.test(r.id)) {
      const n = Number(r.id);
      if (!Number.isNaN(n)) return n;
    }
    return 0;
  };
  // A案: 予約リストの時刻は live 値基準。ソートは startMs(絶対ms) を最優先し、旧 time 文字列はあくまでフォールバック。
  // 時刻ソート用の安全キー（ms）
  const getStartKeyMs = (r: any): number => {
    const ms = Number((r as any)?.startMs);
    if (Number.isFinite(ms) && ms > 0) return ms;
    // フォールバック：HH:mm（分）→ ms に換算
    const mins = parseTimeToMinutes((r as any)?.time);
    return (Number.isFinite(mins) ? mins : 0) * 60_000;
  };
  // 予約リストの最終並び（セクション内で最終決定）
  const finalReservations = React.useMemo(() => {
    const arr = [...reservations];
    if (resOrder === 'time') {
      // startMs（絶対ms）を優先し、なければ HH:mm を ms に換算して比較
      arr.sort((a, b) => getStartKeyMs(a) - getStartKeyMs(b));
    } else if (resOrder === 'table') {
      const ta = (x: any) => {
        const base = editTableMode
          ? (pendingTables?.[x.id]?.nextList?.[0] ?? x.table ?? x.tables?.[0])
          : (x.pendingTable ?? x.table ?? x.tables?.[0]);
        const n = Number(base ?? '');
        return Number.isFinite(n) ? n : 0;
      };
      arr.sort((a, b) => ta(a) - ta(b));
    } else if (resOrder === 'created') {
      // 追加順：古い順（昇順）→ 新しい予約が下に来る
      // createdAt が未反映の直後は localNewRef の打刻をフォールバックに使う
      const key = (x: any) => {
        const s = getCreatedAtMs(x);
        const l = localNewRef.current.get(x.id) ?? 0;
        return s || l || 0;
      };
      arr.sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        if (ka !== kb) return ka - kb;
        // タイブレーク（安定ソート用）
        return String(a.id).localeCompare(String(b.id));
      });
    }
    return arr;
  }, [reservations, resOrder, editTableMode, pendingTables]);

  // 卓番変更モード・食飲説明パネル開閉
  const [openInfo, setOpenInfo] = React.useState<
    null | 'tableChange' | 'eatInfo' | 'drinkInfo' | 'nameInfo' | 'notesInfo' | 'listInfo' | 'tipsInfo' | 'tips2'
  >(null);
  const toggleInfo = (
    k: 'tableChange' | 'eatInfo' | 'drinkInfo' | 'nameInfo' | 'notesInfo' | 'listInfo' | 'tipsInfo' | 'tips2'
  ) => setOpenInfo((p) => (p === k ? null : k));

  // 予約リストガイド（①〜⑤を3秒ごとにハイライト）
  const [guideStep, setGuideStep] = React.useState<number>(1);
  React.useEffect(() => {
    if (openInfo === 'listInfo') {
      setGuideStep(1);
      const id = setInterval(() => {
        setGuideStep((s) => (s % 6) + 1);
      }, 3000);
      return () => clearInterval(id);
    }
  }, [openInfo]);
  // ペンディングの重複（同じ next に複数割当）を検知
  const hasPendingConflict = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of Object.values(pendingTables || {})) {
      const key = String(v?.nextList?.[0] ?? '');
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const n of counts.values()) if (n > 1) return true;
    return false;
  }, [pendingTables]);
  // ── Hint2: 卓番追加デモ（小さめのダミーNumPad。自動進行 & ピル操作を再現）
  const Hint2Demo: React.FC = () => {
    const [step, setStep] = React.useState<number>(1);
    const [val, setVal] = React.useState<string>('');
    const [list, setList] = React.useState<string[]>([]);
    // 数字タップで初めてトップの「後」側に仮表示を出すためのフラグ
    const [showTemp, setShowTemp] = React.useState<boolean>(false);

    // —— finger animation refs/state ——
    const wrapRef = React.useRef<HTMLDivElement>(null);
    const d1Ref = React.useRef<HTMLButtonElement>(null);
    const d2Ref = React.useRef<HTMLButtonElement>(null);
    const d3Ref = React.useRef<HTMLButtonElement>(null);
    const plusRef = React.useRef<HTMLButtonElement>(null);
    const pill2Ref = React.useRef<HTMLSpanElement>(null);

    const [fingerPos, setFingerPos] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [isTap, setIsTap] = React.useState<boolean>(false);
    const [flash, setFlash] = React.useState<boolean>(false);

    const moveFingerTo = (el: HTMLElement | null) => {
      if (!wrapRef.current || !el) return;
      const host = wrapRef.current.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const x = rect.left - host.left + rect.width / 2;
      const y = rect.top - host.top + rect.height / 2;
      setFingerPos({ x, y });
    };

    // 自動デモ進行（約2.8秒ごと：少しゆっくり）
    React.useEffect(() => {
      const id = setInterval(() => setStep((s) => (s % 8) + 1), 2800);
      return () => clearInterval(id);
    }, []);

    // 各ステップの状態遷移（1→8）: 入力段取りのみ。確定はタップ時に行う
    React.useEffect(() => {
      switch (step) {
        case 1:
          setList([]);     // リセット
          setVal('1');     // 「1」を入力した状態に
          setShowTemp(false);
          break;
        case 3:
          setVal('2');     // 「2」を入力した状態に
          setShowTemp(false);
          break;
        case 5:
          setVal('3');     // 「3」を入力した状態に
          setShowTemp(false);
          break;
        default:
          // 2/4/6/7 ではここでは何もしない（確定はタップ時）
          break;
      }
    }, [step]);

    // 指をターゲットへ移動 + 到着後にタップ演出（全ターゲットで実施）
    React.useLayoutEffect(() => {
      let target: HTMLElement | null = null;
      if (step === 1) target = d1Ref.current;           // 「1」
      else if (step === 2 || step === 4 || step === 6)  // 「＋追加」
        target = plusRef.current;
      else if (step === 3) target = d2Ref.current;      // 「2」
      else if (step === 5) target = d3Ref.current;      // 「3」
      else if (step === 7) target = pill2Ref.current;   // 2のピル（×）
      moveFingerTo(target);

      // タップ到着時にだけ確定処理を行う
      let tReset: number | undefined;
      const doCommitForStep = () => {
        let didCommit = false;
        // 1/3/5: 数字タップ → 「後」側に仮表示を出す（pillは増やさない）
        if (step === 1 || step === 3 || step === 5) {
          setShowTemp(true);
          didCommit = true; // 軽いフラッシュ演出
        }
        // 2/4/6: 「＋追加」タップ → 現在の val を list に確定してクリア（仮表示は解除）
        if (step === 2 || step === 4 || step === 6) {
          const v = (val || '').trim();
          if (v) {
            setList(prev => (prev.includes(v) ? prev : [...prev, v]));
            setVal('');
            setShowTemp(false);
            didCommit = true;
          }
        }
        // 7: ピル「2」の × タップ → 2 を除去し、1.5秒待ってからスタートへ戻す
        if (step === 7) {
          setList(prev => prev.filter(x => x !== '2'));
          // 1.5秒待ってからスタートへ戻す
          tReset = window.setTimeout(() => setStep(1), 1500);
          didCommit = true;
        }
        if (didCommit) {
          setFlash(true);
          t3 = window.setTimeout(() => setFlash(false), 380);
        }
      };

      let t1: number | undefined;
      let t2: number | undefined;
      let t3: number | undefined;
      const shouldTap = step >= 1 && step <= 7;
      if (shouldTap) {
        t1 = window.setTimeout(() => {
          setIsTap(true);
          // 確定処理はタップの瞬間に実行
          doCommitForStep();
          t2 = window.setTimeout(() => setIsTap(false), 300);
        }, 1080); // ~1.0s移動 + 余韻
      }
      return () => {
        if (t1) clearTimeout(t1);
        if (t2) clearTimeout(t2);
        if (t3) clearTimeout(t3);
        if (tReset) clearTimeout(tReset);
      };
    }, [step, val]);

    const beforeList: string[] = [];
    // トップ表示（右側 after）は「数字タップ時＝list + val（仮表示）」「＋追加で pill 確定」
    const showAfter = () => {
      const arr = Array.isArray(list) ? [...list] : [];
      const v = (val || '').trim();
      if (showTemp && v && !arr.includes(v)) arr.push(v);
      return arr;
    };

    const pillCls =
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300';

    const isHi = {
      d1: step === 1,
      d2: step === 3,
      d3: step === 5,
      plus: step === 2 || step === 4 || step === 6,
      pill2: step === 7,
    } as const;

    return (
      <div ref={wrapRef} className="relative">
        {/* プレビュー（○.○卓 → ○.○卓） */}
        <div className="mb-2">
          <div className="ml-auto max-w-full tabular-nums text-right bg-gray-100 border border-gray-200 rounded px-3 py-1.5">
            <span className="text-gray-500 text-base md:text-lg">
              {beforeList.join('.')}
              {beforeList.length > 0 ? <span className="ml-0.5">卓</span> : null}
            </span>
            <span className="mx-2 text-gray-400">→</span>
            {(() => {
              const after = showAfter();
              const joined = after.join('.');
              return joined ? (
                <span className={`font-bold text-lg md:text-xl text-gray-900 transition-all ${flash ? 'bg-amber-100 ring-2 ring-amber-400 rounded px-1' : ''}`}>
                  {joined}
                  <span className="ml-0.5">卓</span>
                </span>
              ) : (
                <span className="text-gray-400 text-base">—</span>
              );
            })()}
          </div>
        </div>

        {/* ピル（×で削除可能） */}
        <div className="mb-2">
          <div className="flex flex-wrap gap-2">
            {list.map((t) => (
              <span
                key={t}
                ref={t === '2' ? pill2Ref : undefined}
                className={`${pillCls} ${isHi.pill2 && t === '2' ? 'ring-2 ring-red-400' : ''}`}
              >
                <span className="tabular-nums">{t}</span>
                <button type="button" disabled className="leading-none px-1 text-amber-800/70">
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* 小さめNumPad（4列）。デモなので入力は無効、ハイライトのみ */}
        <div className="grid grid-cols-4 grid-rows-4 gap-2 items-stretch text-sm select-none">
          {/* 1行目（7 8 9） */}
          <button type="button" disabled className="py-2 rounded border bg-gray-50 text-base">
            7
          </button>
          <button type="button" disabled className="py-2 rounded border bg-gray-50 text-base">
            8
          </button>
          <button type="button" disabled className="py-2 rounded border bg-gray-50 text-base">
            9
          </button>

          {/* 右列（＋追加／決定） */}
          <div className="col-start-4 row-start-1 row-span-4 flex flex-col gap-2">
            <button
              ref={plusRef}
              type="button"
              disabled
              className={`flex-1 rounded text-white font-semibold text-sm ${isHi.plus ? 'bg-amber-500' : 'bg-amber-400/70'}`}
            >
              卓追加
            </button>
            <button type="button" disabled className="flex-1 rounded bg-blue-600/70 text-white font-semibold text-sm">
              確定
            </button>
          </div>

          {/* 2行目（4 5 6） */}
          <button type="button" disabled className="py-2 rounded border bg-gray-50 text-base">
            4
          </button>
          <button type="button" disabled className="py-2 rounded border bg-gray-50 text-base">
            5
          </button>
          <button type="button" disabled className="py-2 rounded border bg-gray-50 text-base">
            6
          </button>

          {/* 3行目（1 2 3） */}
          <button
            ref={d1Ref}
            type="button"
            disabled
            className={`py-2 rounded border bg-gray-50 text-base ${isHi.d1 ? 'ring-2 ring-amber-500' : ''}`}
          >
            1
          </button>
          <button
            ref={d2Ref}
            type="button"
            disabled
            className={`py-2 rounded border bg-gray-50 text-base ${isHi.d2 ? 'ring-2 ring-amber-500' : ''}`}
          >
            2
          </button>
          <button
            ref={d3Ref}
            type="button"
            disabled
            className={`py-2 rounded border bg-gray-50 text-base ${isHi.d3 ? 'ring-2 ring-amber-500' : ''}`}
          >
            3
          </button>

          {/* 4行目（0 ← C） */}
          <button type="button" disabled className="py-2 rounded border bg-gray-50 text-base">
            0
          </button>
          <button type="button" disabled className="py-2 rounded border bg-gray-50 text-base">
            ←
          </button>
          <button type="button" disabled className="py-2 rounded border bg-gray-50 text-base">
            C
          </button>
        </div>

        {/* 指カーソル（移動＋タップ演出） */}
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-1000 ease-out"
          style={{ left: `${fingerPos.x}px`, top: `${fingerPos.y}px` }}
        >
          <div
            className={`relative h-8 w-8 rounded-full bg-white/80 shadow ring-1 ring-gray-300/70 flex items-center justify-center transition-transform duration-200 backdrop-blur-[1px] ${
              isTap ? 'scale-90' : ''
            }`}
          >
            <span className="text-xl">👉</span>
            {isTap && <span className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping" />}
          </div>
        </div>

        {/* 説明（ステップに連動して赤く・中央寄せ） */}
        <div className="mt-3 flex justify-center">
          <ol className="list-decimal list-inside text-[12px] space-y-1 text-center">
            <li className={`${step <= 6 ? 'text-red-600 font-semibold' : ''}`}>
              卓番号に関して、<span className="inline-block px-1 rounded bg-amber-500 text-white text-[11px] align-baseline">卓追加</span> を押すと、卓番号が複数選択できます。
            </li>
            <li className={`${step === 7 ? 'text-red-600 font-semibold' : ''}`}>
              卓番ピルの「×」を押すと、その卓をキャンセルできます。
            </li>
          </ol>
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-4 text-sm">
      {/* ─────────────── 予約リストセクション ─────────────── */}
      <section>
        {/* ── 枠外ツールバー（表示順・表示項目） ───────────────── */}
        <div className="sm:p-4 p-2 border-b border-gray-200 bg-white">
          <div className="flex flex-wrap items-center gap-3">
            {/* 表示：チップ（食・飲・氏名・備考） */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-gray-500 text-xs">表示：</span>

              <button
                type="button"
                onClick={() => setShowEatCol(!showEatCol)}
                aria-pressed={showEatCol}
                className={`px-2 py-0.5 text-xs rounded-full border ${
                  showEatCol ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
                title="食べ放題列の表示切替"
              >
                食
              </button>
              <button
                type="button"
                onClick={() => toggleInfo('eatInfo')}
                className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-gray-300 text-[10px] leading-4 text-gray-600 hover:bg-gray-50"
                aria-label="『食』の説明"
                title="食べ放題の表示について"
                aria-expanded={openInfo === 'eatInfo'}
                aria-controls="help-eat"
              >
                i
              </button>
              <button
                type="button"
                onClick={() => setShowDrinkCol(!showDrinkCol)}
                aria-pressed={showDrinkCol}
                className={`px-2 py-0.5 text-xs rounded-full border ${
                  showDrinkCol ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
                title="飲み放題列の表示切替"
              >
                飲
              </button>
              <button
                type="button"
                onClick={() => toggleInfo('drinkInfo')}
                className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-gray-300 text-[10px] leading-4 text-gray-600 hover:bg-gray-50"
                aria-label="『飲』の説明"
                title="飲み放題の表示について"
                aria-expanded={openInfo === 'drinkInfo'}
                aria-controls="help-drink"
              >
                i
              </button>
              <button
                type="button"
                onClick={() => setShowNameCol((p) => !p)}
                aria-pressed={showNameCol}
                className={`hidden sm:inline-flex px-2 py-0.5 text-xs rounded-full border ${
                  showNameCol ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                氏名
              </button>
              <button
                type="button"
                onClick={() => toggleInfo('nameInfo')}
                className="hidden sm:inline-flex items-center justify-center h-4 w-4 rounded-full border border-gray-300 text-[10px] leading-4 text-gray-600 hover:bg-gray-50"
                aria-label="『氏名』の説明"
                title="氏名列の表示について"
                aria-expanded={openInfo === 'nameInfo'}
                aria-controls="help-name"
              >
                i
              </button>
              <button
                type="button"
                onClick={() => setShowNotesCol((p) => !p)}
                aria-pressed={showNotesCol}
                className={`hidden sm:inline-flex px-2 py-0.5 text-xs rounded-full border ${
                  showNotesCol ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                備考
              </button>
              <button
                type="button"
                onClick={() => toggleInfo('notesInfo')}
                className="hidden sm:inline-flex items-center justify-center h-4 w-4 rounded-full border border-gray-300 text-[10px] leading-4 text-gray-600 hover:bg-gray-50"
                aria-label="『備考』の説明"
                title="備考列の表示について"
                aria-expanded={openInfo === 'notesInfo'}
                aria-controls="help-notes"
              >
                i
              </button>
            </div>
            {openInfo === 'eatInfo' && (
              <div id="help-eat" className="w-full mt-2 text-[11px] leading-5 text-gray-800 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                <p className="mb-1 flex items-center gap-2">
                  <button
                    type="button"
                    disabled
                    aria-hidden="true"
                    className="px-1.5 py-[1px] text-[11px] leading-none rounded border bg-white text-gray-700 border-gray-300"
                  >
                    食
                  </button>
                  の使い方
                </p>
                <ul className="list-disc ml-5 space-y-0.5">
                  <li>店舗設定で <strong>食べ放題プラン名</strong> を登録しておくと、予約欄で選択できます。</li>
                  <li>
                    <span className="inline-flex items-center gap-1">
                      <button type="button" disabled aria-hidden="true" className="px-1.5 py-[1px] text-[11px] leading-none rounded border bg-white text-gray-700 border-gray-300">食</button>
                      をONにすると、どの予約が食べ放題かが一目でわかります。
                    </span>
                  </li>
                </ul>
              </div>
            )}
            {openInfo === 'drinkInfo' && (
              <div id="help-drink" className="w-full mt-2 text-[11px] leading-5 text-gray-800 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                <p className="mb-1 flex items-center gap-2">
                  <button
                    type="button"
                    disabled
                    aria-hidden="true"
                    className="px-1.5 py-[1px] text-[11px] leading-none rounded border bg-white text-gray-700 border-gray-300"
                  >
                    飲
                  </button>
                  の使い方
                </p>
                <ul className="list-disc ml-5 space-y-0.5">
                  <li>店舗設定で <strong>飲み放題プラン名</strong> （例；プレ、スタ）を登録しておくと、予約欄で選択できます。</li>
                  <li>
                    <span className="inline-flex items-center gap-1">
                      <button type="button" disabled aria-hidden="true" className="px-1.5 py-[1px] text-[11px] leading-none rounded border bg-white text-gray-700 border-gray-300">飲</button>
                      をONにすると、どの予約が飲み放題かが一目でわかります。
                    </span>
                  </li>
                </ul>
              </div>
            )}
            {openInfo === 'nameInfo' && (
              <div id="help-name" className="w-full mt-2 text-[11px] leading-5 text-gray-800 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                <p className="mb-1 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1">
                    <button type="button" disabled aria-hidden="true" className="px-1.5 py-[1px] text-[11px] leading-none rounded border bg-white text-gray-700 border-gray-300">氏名</button>
                  </span>
                  列の使い方
                </p>
                <ul className="list-disc ml-5 space-y-0.5">
                  <li>来店者の氏名を表示・編集できます（タブレット以上で表示）。</li>
                  <li><span className="inline-flex items-center gap-1"><button type="button" disabled aria-hidden="true" className="px-1.5 py-[1px] text-[11px] leading-none rounded border bg-white text-gray-700 border-gray-300">氏名</button> をONにすると、氏名列が表に追加されます。</span></li>
                </ul>
              </div>
            )}
            {openInfo === 'notesInfo' && (
              <div id="help-notes" className="w-full mt-2 text-[11px] leading-5 text-gray-800 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                <p className="mb-1 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1">
                    <button type="button" disabled aria-hidden="true" className="px-1.5 py-[1px] text-[11px] leading-none rounded border bg-white text-gray-700 border-gray-300">備考</button>
                  </span>
                  列の使い方
                </p>
                <ul className="list-disc ml-5 space-y-0.5">
                  <li>注意事項・席の希望など、共有したいメモを表示・編集できます（タブレット以上で表示）。</li>
                  <li><span className="inline-flex items-center gap-1"><button type="button" disabled aria-hidden="true" className="px-1.5 py-[1px] text-[11px] leading-none rounded border bg-white text-gray-700 border-gray-300">備考</button> をONにすると、備考列が表に追加されます。</span></li>
                </ul>
              </div>
            )}

            {/* 区切り（薄） */}
            <div className="h-4 w-px bg-gray-200 hidden xs:block sm:hidden" />

            {/* 並び替え：セグメント（時間順／卓番順／追加順） */}
            <div className="flex items-center gap-2 sm:ml-auto">
              <span className="text-gray-500 text-xs">並び替え：</span>
              <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
                {[
                  { key: 'time', label: '時間順' },
                  { key: 'table', label: '卓番順' },
                  { key: 'created', label: '追加順' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setResOrder(opt.key as any)}
                    aria-pressed={resOrder === (opt.key as any)}
                    className={`px-2 py-1 text-xs sm:text-[13px] ${
                      resOrder === (opt.key as any)
                        ? 'bg-blue-600 text-white'
                        : 'bg-white hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="sm:p-4 p-2 space-y-4 text-sm border rounded overflow-x-auto relative">
          {/* ── 予約リスト ヘッダー ───────────────────── */}
          <div className="flex flex-col space-y-2">
            {/* 下段：卓番変更 & 全リセット & 予約確定 */}
            <div className="flex items-center gap-2">
              <button
                onClick={onToggleEditTableMode}
                className={`px-3 py-1 rounded text-sm font-semibold ${
                  editTableMode
                    ? 'bg-amber-600 text-white'
                    : 'bg-amber-500 text-white hover:bg-amber-600'
                }`}
                aria-pressed={editTableMode}
                title={editTableMode ? '卓番変更モード：ON' : '卓番変更モードを開始'}
              >
                {editTableMode ? (
                  <>
                    卓番変更中
                    <span className="ml-2 text-[10px] px-1 py-0.5 rounded bg-white/20">ON</span>
                  </>
                ) : (
                  '卓番変更'
                )}
              </button>
              {/* i ボタン追加 */}
              <button
                type="button"
                onClick={() => toggleInfo('tableChange')}
                className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-gray-300 text-[10px] leading-4 text-gray-600 hover:bg-gray-50"
                aria-label="『卓番変更』の説明"
                aria-expanded={openInfo === 'tableChange'}
                aria-controls="help-table-change"
              >
                i
              </button>
              <div className="ml-auto">
                <button
                  onClick={resetAllReservations}
                  className="px-3 py-1 rounded text-sm bg-red-600 text-white hover:bg-red-700"
                  title="すべての変更をリセット"
                >
                  全リセット
                </button>
              </div>
            </div>
            {/* 説明パネル */}
            {openInfo === 'tableChange' && (
              <div id="help-table-change" className="mt-2 text-[11px] text-gray-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 space-y-1">
                <p>
                  予約リストの卓番号を直接タップして入力し直す方法でも変更できますが、
                  <strong>プレビューを見ながら</strong>一括で卓番変更できるこのモードが、大幅な変更に便利です。
                </p>
                <ol className="list-decimal ml-5 space-y-0.5">
                  <li>
                    <button className="px-2 py-0.5 rounded text-[10px] bg-amber-500 text-white" disabled>卓番変更</button>
                    を押します。
                  </li>
                  <li>変更したい予約の<strong>卓番号</strong>をタップし、変更後の卓番号を入力します。</li>
                  <li>他に変更したい卓も、同じ手順で追加していきます。</li>
                  <li>上部のプレビュー（黄色の帯）で内容を確認し、
                    <button
                      type="button"
                      disabled={hasPendingConflict || Object.keys(pendingTables).length === 0}
                      onClick={async () => {
                        if (hasPendingConflict || Object.keys(pendingTables).length === 0) return;
                        await commitTableMoves();
                      }}
                      title={hasPendingConflict ? '重複があります' : (Object.keys(pendingTables).length === 0 ? '変更がありません' : '変更を適用')}
                      className={`ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold
                        ${hasPendingConflict || Object.keys(pendingTables).length === 0
                          ? 'bg-white/30 text-gray-400 cursor-not-allowed border border-gray-300'
                          : 'bg-amber-500 text-gray-900 hover:bg-amber-600 active:bg-amber-700 shadow-sm border border-amber-600'
                        }`}
                    >
                      ✓ 適用
                    </button>
                    を押して確定します。
                  </li>
                </ol>
              </div>
            )}
          </div>
          {/* ── 卓番変更モード用の固定ツールバー ───────────────── */}
          {editTableMode && (
            <>
              {(() => {
                const pendingCount = Object.keys(pendingTables || {}).length;
                return (
                  <div className="sticky top-[48px] z-40 bg-amber-500 text-white px-3 py-2 flex items-center gap-1 sm:gap-2 shadow ring-1 ring-amber-600/50 flex-nowrap">
                    <span className="font-semibold">卓番変更モード</span>
                    <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded">変更予定 {pendingCount} 件</span>
                    {hasPendingConflict && (
                      <span className="text-xs bg-red-500/30 px-1.5 py-0.5 rounded">重複あり</span>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        if (hasPendingConflict || pendingCount === 0) return;
                        await commitTableMoves();
                      }}
                      disabled={hasPendingConflict || pendingCount === 0}
                      title={hasPendingConflict ? '重複があります' : (pendingCount === 0 ? '変更がありません' : '変更を適用')}
                      className={`ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-semibold shrink-0
               ${hasPendingConflict || pendingCount === 0
                 ? 'bg-white/30 text-white/70 cursor-not-allowed ring-2 ring-white/50'
                 : 'bg-amber-500 text-gray-900 hover:bg-amber-600 active:bg-amber-700 shadow-sm ring-2 ring-white/80'}`}
                    >
                      ✓ 適用
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // 選択解除
                        if (Array.isArray(tablesForMove) && tablesForMove.length) {
                          tablesForMove.forEach((id) => toggleTableForMove(id));
                        }
                        // ペンディングをクリア
                        setPendingTables({});
                        // モード終了
                        onToggleEditTableMode();
                      }}
                      className="px-2.5 py-1 rounded-md text-sm bg-white text-amber-700 ring-1 ring-white/70 hover:bg-amber-50 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      aria-label="キャンセル"
                      title="キャンセル"
                    >
                      ×
                    </button>
                  </div>
                );
              })()}
            </>
          )}

          {/* 卓番編集の保留キュー */}
          {editTableMode && Object.keys(pendingTables).length > 0 && (
            <div className="mt-2 space-y-1">
              {Object.entries(pendingTables).map(([id, tbl]) => (
                <div
                  key={id}
                  className="px-2 py-1 bg-amber-50 border border-amber-200 rounded-md text-xs sm:text-sm text-amber-800 flex items-center justify-between"
                >
                  {/* 旧卓(複数可) → 新卓(複数) を「a.b.c卓 → x.y卓」で表示 */}
                  {(() => {
                    const res = reservations.find((x) => String(x.id) === String(id));
                    const beforeList = (Array.isArray(res?.tables) && res!.tables.length > 0)
                      ? res!.tables
                      : [tbl.old];
                    const afterList = (Array.isArray(tbl.nextList) && tbl.nextList.length > 0)
                      ? tbl.nextList
                      : beforeList;
                    return (
                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                        <span className="tabular-nums font-semibold">
                          {beforeList.join('.')}<span className="ml-0.5">卓</span>
                        </span>
                        <span className="mx-1 font-semibold">→</span>
                        <span className="tabular-nums font-semibold">
                          {afterList.join('.')}<span className="ml-0.5">卓</span>
                        </span>
                      </div>
                    );
                  })()}
                  <button
                    onClick={() => {
                      setPendingTables((prev) => {
                        const next = { ...prev } as any;
                        // もともとの卓番号は参照だけ（数パッドは開かないため、状態更新はしない）
                        // const oldVal = next[id]?.old;
                        delete next[id];
                        return next;
                      });

                      if (tablesForMove.includes(id)) {
                        toggleTableForMove(id);
                      }
                    }}
                    className="ml-3 inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-white text-amber-700
             ring-1 ring-amber-300 hover:bg-red-50 hover:ring-red-300 hover:text-red-600 shadow-sm"
                    aria-label="この変更を取り消す"
                    title="この変更を取り消す"
                  >
                    <span className="text-[10px] leading-none">↺</span>
                    <span>取消</span>
                  </button>
                </div>
              ))}
              {/* Apply button removed here; use the top sticky bar's 「適用」 instead */}
            </div>
          )}

          {/* 予約テーブル */}
          <form id="new-res-form" onSubmit={addReservation} className="hidden" />
          <table className="min-w-full table-auto border text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="border px-1 py-1 w-24">来店時刻</th>
                <th className="border px-1 py-1 w-20">卓番</th>
                {showNameCol && <th className="border px-1 py-1 w-24 hidden sm:table-cell">氏名</th>}
                <th className="border px-1 py-1 w-24">コース</th>
                {showEatCol && <th className="border px-1 py-0.5 w-14 text-center">食</th>}
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
              {finalReservations.map((r, idx) => {
                const prev = finalReservations[idx - 1];
                const prevTimeStr = prev ? prev.time : undefined;
                const currTimeStr = r.time;
                const isBlockStart = !prev || prevTimeStr !== currTimeStr;
                const padY = isBlockStart ? 'py-1.5' : 'py-1';
                // NEW/FRESH: 15分以内は freshUntilMs（createdAtMs + 15分）基準で判定
                const freshUntil = Number((r as any).freshUntilMs)
                  || (getCreatedAtMs(r) ? getCreatedAtMs(r) + NEW_THRESHOLD : 0)
                  || (((localNewRef.current.get(r.id) ?? 0)) + NEW_THRESHOLD);
                const isFresh = Number.isFinite(freshUntil) && freshUntil > 0 && nowTick <= freshUntil;

                // Edited: 直近15分以内の更新をオレンジドットで表示
                const editedMs = editedMarks[r.id] ?? 0;
                const isEdited = nowTick - editedMs <= NEW_THRESHOLD;
                const borderClass =
                  !prev || prevTimeStr !== currTimeStr ? 'border-t-4 border-gray-300' : 'border-b border-gray-300';
                // Normalized string for table
                const tableStr = String(r.table ?? r.tables?.[0] ?? '');
                const displayTable =
                  editTableMode
                    ? (pendingTables[r.id]?.nextList?.[0] ?? tableStr)
                    : (r.pendingTable ?? tableStr);
                const displayTableStr = String(displayTable);
                // Normalized current values for eat/drink (inline edit takes precedence)
                const eatCurrent = inlineEdits[r.id]?.eat ?? getEatValue(r);
                const drinkCurrent = inlineEdits[r.id]?.drink ?? getDrinkValue(r);

                return (
                  <tr
                    key={r.id}
                    className={`${
                      checkedArrivals.includes(r.id) ? 'bg-green-100 ' : ''
                    }${
                      checkedDepartures.includes(r.id) ? 'bg-gray-300 text-gray-400 ' : ''
                    }${borderClass} text-center ${
                      firstRotatingId[displayTableStr] === r.id ? 'text-red-500' : ''
                    }${editTableMode && tablesForMove.includes(r.id) ? 'bg-amber-50 ' : ''}`}
                  >
                    {/* 来店時刻セル */}
                    <td className={`border px-1 ${padY}`}>
                    {/* NOTE: A案 - 入力値は常に live 値（r.time）を使う。スナップショット値には依存しない。 */}
                      <select
                        value={r.time}
                        onChange={(e) => updateReservationField(r.id, 'time', e.target.value)}
                        className="border px-1 py-0.5 rounded text-sm font-semibold tabular-nums"
                      >
                        {timeOptions.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* 卓番セル */}
                    <td className={`border px-1 ${padY} text-center`}>
                      <div className="relative inline-flex items-center justify-center w-full">
                        {(isFresh || isEdited) && (
                          <span
                            className={
                              `pointer-events-none absolute left-0.5 top-0.5 z-10 block w-1.5 h-1.5 rounded-full border border-white shadow-sm ` +
                              (isFresh ? 'bg-green-500' : 'bg-amber-500')
                            }
                            aria-label={isFresh ? '新規' : '変更'}
                            title={isFresh ? '新規' : '変更'}
                          />
                        )}
                        {(() => {
                          // Normalized table string already computed above
                          return (
                            <input
                              type="text"
                              readOnly
                              value={displayTableStr}
                              onClick={() => {
                                if (editTableMode) {
                                  if (!tablesForMove.includes(r.id)) {
                                    setPendingTables((prev) => ({
                                      ...prev,
                                      [r.id]: { old: tableStr, nextList: [tableStr] },
                                    }));
                                  } else {
                                    setPendingTables((prev) => {
                                      const next = { ...prev } as any;
                                      delete next[r.id];
                                      return next;
                                    });
                                  }
                                  toggleTableForMove(r.id);
                                  openNumPad({ id: r.id, field: 'targetTable', value: '' });
                                } else {
                                  openNumPad({ id: r.id, field: 'table', value: '' });
                                }
                              }}
                              className={`border px-1 py-0.5 rounded text-sm w-full !text-center tabular-nums cursor-pointer ${
                                editTableMode && tablesForMove.includes(r.id) ? 'border-4 border-amber-500' : ''
                              }`}
                            />
                          );
                        })()}
                      </div>
                    </td>

                    {/* 氏名セル (タブレット表示) */}
                    {showNameCol && (
                      <td className={`border px-1 ${padY} hidden sm:table-cell`}>
                        <input
                          type="text"
                          value={r.name ?? ''}
                          onChange={(e) => updateReservationField(r.id, 'name', e.target.value)}
                          placeholder="氏名"
                          className="border px-1 py-0.5 w-full rounded text-sm text-center"
                        />
                      </td>
                    )}

                    {/* コースセル */}
                    <td className={`border px-1 ${padY}`}>
                      <select
                        value={r.course ?? ''}
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
                          value={eatCurrent}
                          onChange={(e) => {
                            const v = e.target.value;
                            setInlineEdits((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] || {}), eat: v } }));
                            updateReservationField(r.id, 'eat', v);
                            updateReservationField(r.id, 'eatLabel', v as any);
                            updateReservationField(r.id, 'foodAllYouCan', Boolean(v) as any);
                          }}
                          className="border px-1 py-0.5 w-14 text-xs rounded"
                        >
                          {/* 現在値が選択肢に無い場合でも表示できるよう補完 */}
                          {!eatOptions.includes(eatCurrent) && eatCurrent && (
                            <option value={eatCurrent}>{eatCurrent}</option>
                          )}
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
                          value={drinkCurrent}
                          onChange={(e) => {
                            const v = e.target.value;
                            setInlineEdits((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] || {}), drink: v } }));
                            updateReservationField(r.id, 'drink', v);
                            updateReservationField(r.id, 'drinkLabel', v as any);
                            updateReservationField(r.id, 'drinkAllYouCan', Boolean(v) as any);
                          }}
                          className="border px-1 py-0.5 w-14 text-xs rounded"
                        >
                          {/* 現在値が選択肢に無い場合でも表示できるよう補完 */}
                          {!drinkOptions.includes(drinkCurrent) && drinkCurrent && (
                            <option value={drinkCurrent}>{drinkCurrent}</option>
                          )}
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
                    <td className={`border px-1 ${padY}`}>
                      <input
                        type="text"
                        value={String(r.guests ?? '')}
                        readOnly
                        onClick={() => openNumPad({ id: r.id, field: 'guests', value: '' })}
                        className="border px-1 py-0.5 w-8 rounded text-sm !text-center cursor-pointer"
                      />
                    </td>

                    {/* 備考セル (タブレット表示) */}
                    {showNotesCol && (
                      <td className={`border px-1 ${padY} hidden sm:table-cell`}>
                        <input
                          type="text"
                          value={r.notes ?? ''}
                          onChange={(e) => updateReservationField(r.id, 'notes', e.target.value)}
                          placeholder="備考"
                          className="border px-1 py-0.5 w-full rounded text-sm text-center"
                        />
                      </td>
                    )}

                    {/* 来店チェックセル (タブレット表示) */}
                    <td className={`border px-1 ${padY} hidden sm:table-cell`}>
                      <button
                        onClick={() => toggleArrivalChecked(r.id)}
                        className={`px-2 py-0.5 rounded text-sm ${
                          checkedDepartures.includes(r.id)
                            ? 'bg-gray-500 text-white'
                            : checkedArrivals.includes(r.id)
                            ? 'bg-green-500 text-white'
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
                          checkedDepartures.includes(r.id)
                            ? 'bg-gray-500 text-white'
                            : checkedPayments.includes(r.id)
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-200 text-black'
                        }`}
                      >
                        会
                      </button>
                    </td>

                    {/* 退店チェックセル (タブレット表示) */}
                    <td className={`border px-1 ${padY} hidden sm:table-cell`}>
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
                    <td className={`border px-1 ${padY}`}>
                      <button
                        onClick={() => deleteReservation(r.id)}
                        className="w-7 h-7 inline-flex items-center justify-center rounded-md bg-red-500 text-white font-bold
               shadow-sm ring-1 ring-red-300 hover:bg-red-600 active:bg-red-700
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                        aria-label="この行を削除"
                        title="この行を削除"
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
                    form="new-res-form"
                    value={newResTime}
                    onChange={(e) => setNewResTime(e.target.value)}
                    className="border px-1 py-0.5 rounded text-sm font-semibold tabular-nums"
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
                    form="new-res-form"
                    type="text"
                    value={newResTable}
                    readOnly
                    onClick={() => setNumPadState({ id: '-1', field: 'table', value: '' })}
                    placeholder="例:101"
                    maxLength={3}
                    className="border px-1 py-0.5 w-8 rounded text-sm !text-center cursor-pointer"
                    required
                  />
                </td>

                {/* 新規氏名セル (タブレット表示) */}
                {showNameCol && (
                  <td className="border px-1 py-1 hidden sm:table-cell">
                    <input
                      form="new-res-form"
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
                    form="new-res-form"
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
                      form="new-res-form"
                      value={newResEat}
                      onChange={(e) => setNewResEat(e.target.value)}
                      className="border px-1 py-0.5 rounded w-full text-sm"
                    >
                      <option value="">未選択</option>
                      {eatOptions.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </td>
                )}

                {/* 新規飲み放題セル */}
                {showDrinkCol && (
                  <td className="border px-1 py-0.5">
                    <select
                      form="new-res-form"
                      value={newResDrink}
                      onChange={(e) => setNewResDrink(e.target.value)}
                      className="border px-1 py-0.5 rounded w-full text-sm"
                    >
                      <option value="">未選択</option>
                      {drinkOptions.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </td>
                )}

                {/* 新規人数セル */}
                {showGuestsCol && (
                  <td className="border px-1 py-1">
                    <input
                      form="new-res-form"
                      type="text"
                      value={String(newResGuests ?? '')}
                      readOnly
                      onClick={() => setNumPadState({ id: '-1', field: 'guests', value: '' })}
                      placeholder="人数"
                      maxLength={3}
                      className="border px-1 py-0.5 w-8 rounded text-sm !text-center cursor-pointer"
                      required
                    />
                  </td>
                )}

                {/* 新規備考セル (タブレット表示) */}
                {showNotesCol && (
                  <td className="border px-1 py-1 hidden sm:table-cell">
                    <input
                      form="new-res-form"
                      type="text"
                      value={newResNotes}
                      onChange={(e) => setNewResNotes(e.target.value)}
                      placeholder="備考"
                      className="border px-1 py-0.5 w-full rounded text-sm text-center"
                    />
                  </td>
                )}

                {/* 追加ボタンセル */}
                <td className="border px-1 py-1 text-center" colSpan={showNameCol ? 2 : 1}>
                  <button type="submit" form="new-res-form" className="bg-blue-500 text-white px-2 py-0.5 rounded text-sm">
                    ＋
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          {/* 左下：予約リストの使い方 i ボタン */}
        </div>
        {/* i ボタンをテーブル直下・右下に配置 */}
        <div className="mt-2 flex items-center justify-end relative">
          <button
            type="button"
            onClick={() => toggleInfo('listInfo')}
            className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-gray-300 text-[11px] leading-none text-gray-600 hover:bg-gray-50 shadow-sm bg-white z-10"
            aria-label="予約リストの使い方"
            aria-expanded={openInfo === 'listInfo'}
            aria-controls="help-reslist"
            title="予約リストの使い方"
          >
            i
          </button>
          <button
            type="button"
            onClick={() => toggleInfo('listInfo')}
            className="ml-2 text-[12px] text-gray-700 hover:underline"
            aria-label="予約リストの使い方（テキスト）"
          >
            予約リストの使い方
          </button>
          {openInfo === 'listInfo' && (
            <div
              id="help-reslist"
              className="absolute z-50 right-0 top-full mt-2 w-[min(420px,90vw)] text-[12px] sm:text-[13px] leading-5 bg-white border border-gray-200 rounded shadow-lg px-3 py-2"
              role="dialog"
              aria-label="予約リストの使い方"
            >
              <div className="flex items-center justify-between mb-1">
                <p className="font-semibold">予約リストの使い方</p>
                <button
                  type="button"
                  onClick={() => toggleInfo('listInfo')}
                  className="inline-flex items-center justify-center h-5 w-5 rounded border border-gray-300 text-[10px] text-gray-600 hover:bg-gray-50"
                  aria-label="閉じる"
                  title="閉じる"
                >
                  ×
                </button>
              </div>

              {/* 1) 表示の切替（食・飲・氏名・備考） */}
              <div className="mb-6 sm:mb-8 rounded-md border-l-4 border-blue-300 bg-blue-50/60 px-3 py-2">
                <p className="mb-1">必要な項目だけ <strong>表示切替</strong> できます。</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" disabled aria-hidden="true" className="px-1.5 py-[1px] text-[11px] leading-none rounded border bg-white text-gray-700 border-gray-300">食</button>
                  <button type="button" disabled aria-hidden="true" className="px-1.5 py-[1px] text-[11px] leading-none rounded border bg-white text-gray-700 border-gray-300">飲</button>
                  <button type="button" disabled aria-hidden="true" className="px-1.5 py-[1px] text-[11px] leading-none rounded border bg-white text-gray-700 border-gray-300">氏名</button>
                  <button type="button" disabled aria-hidden="true" className="px-1.5 py-[1px] text-[11px] leading-none rounded border bg-white text-gray-700 border-gray-300">備考</button>
                  <span className="text-gray-600">…をON/OFF</span>
                </div>
              </div>

              {/* 2) ダミー表＋操作手順：Amberコールアウト */}
              <div className="mb-2 rounded-md border-l-4 border-amber-300 bg-amber-50/70 px-3 py-2">
                <div className="mt-1 border rounded overflow-hidden mb-2">
                  <table className="w-full table-fixed text-[11px]">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className={`border px-1 py-1 w-16 ${guideStep === 1 ? 'text-red-600' : ''}`}>来店</th>
                        <th className={`border px-1 py-1 w-12 ${guideStep === 2 ? 'text-red-600' : ''}`}>卓</th>
                        <th className={`border px-1 py-1 w-16 hidden sm:table-cell ${guideStep === 4 ? 'text-red-600' : ''}`}>氏名</th>
                        <th className={`border px-1 py-1 w-20 ${guideStep === 3 ? 'text-red-600' : ''}`}>コース</th>
                        <th className={`border px-1 py-1 w-10 ${guideStep === 4 ? 'text-red-600' : ''}`}>食</th>
                        <th className={`border px-1 py-1 w-10 ${guideStep === 4 ? 'text-red-600' : ''}`}>飲</th>
                        <th className={`border px-1 py-1 w-12 ${guideStep === 5 ? 'text-red-600' : ''}`}>人数</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border px-1 py-0.5">
                          <span className={`inline-block px-1 bg-white border rounded tabular-nums ${guideStep === 1 ? 'ring-2 ring-red-500' : ''}`}>18:15</span>
                        </td>
                        <td className="border px-1 py-0.5">
                          <span className={`inline-block px-1 bg-white border rounded tabular-nums ${guideStep === 2 ? 'ring-2 ring-red-500' : ''}`}>12</span>
                        </td>
                        <td className="border px-1 py-0.5 hidden sm:table-cell">
                          <span className={`inline-block px-1 bg-white border rounded ${guideStep === 4 ? 'ring-2 ring-red-500' : ''}`}>山田</span>
                        </td>
                        <td className="border px-1 py-0.5">
                          <span className={`inline-block px-1 bg-white border rounded ${guideStep === 3 ? 'ring-2 ring-red-500' : ''}`}>スタンダード</span>
                        </td>
                        <td className="border px-1 py-0.5 text-center">
                          <span className={`${guideStep === 4 ? 'inline-block ring-2 ring-red-500 rounded px-1' : ''}`}>—</span>
                        </td>
                        <td className="border px-1 py-0.5 text-center">
                          <span className={`${guideStep === 4 ? 'inline-block ring-2 ring-red-500 rounded px-1' : ''}`}>—</span>
                        </td>
                        <td className="border px-1 py-0.5 text-center"><span className={`inline-block px-1 bg-white border rounded ${guideStep === 5 ? 'ring-2 ring-red-500' : ''}`}>2</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <ol className="list-decimal ml-5 space-y-0.5">
                  <li className={`${guideStep === 1 ? 'text-red-600 font-semibold' : ''}`}> 来店時刻を入力する</li>
                  <li className={`${guideStep === 2 ? 'text-red-600 font-semibold' : ''}`}> 卓番号を入力する</li>
                  <li className={`${guideStep === 3 ? 'text-red-600 font-semibold' : ''}`}> コースを選ぶ（コースは店舗設定画面で設定可能）</li>
                  <li className={`${guideStep === 4 ? 'text-red-600 font-semibold' : ''}`}> 食べ放題・飲み放題のプランを選択（タブレット端末では『氏名』『備考』も入力可能）</li>
                  <li className={`${guideStep === 5 ? 'text-red-600 font-semibold' : ''}`}> 人数を入力する</li>
                  <li className={`${guideStep === 6 ? 'text-red-600 font-semibold' : ''}`}>
                    <button type="button" disabled aria-hidden="true" className={`mx-1 px-2 py-0.5 rounded text-[11px] bg-blue-500 text-white`}>＋</button>
                    をタップして予約確定！
                  </li>
                </ol>
              </div>
            </div>
          )}
        </div>
        {/* i ボタン：予約リストのヒント */}
        <div className="mt-2 flex items-center justify-end relative">
          <button
            type="button"
            onClick={() => toggleInfo('tipsInfo')}
            className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-gray-300 text-[11px] leading-none text-gray-600 hover:bg-gray-50 shadow-sm bg-white z-10"
            aria-label="予約リストのヒント①"
            aria-expanded={openInfo === 'tipsInfo'}
            aria-controls="help-reslist-tips"
            title="予約リストのヒント①"
          >
            i
          </button>
          <button
            type="button"
            onClick={() => toggleInfo('tipsInfo')}
            className="ml-2 text-[12px] text-gray-700 hover:underline"
            aria-label="予約リストのヒント①（テキスト）"
          >
            予約リストのヒント①
          </button>

          {openInfo === 'tipsInfo' && (
            <div
              id="help-reslist-tips"
              className="absolute z-50 right-0 top-full mt-2 w-[min(480px,90vw)] text-[12px] sm:text-[13px] leading-5 bg-white border border-gray-200 rounded shadow-lg px-3 py-2"
              role="dialog"
              aria-label="予約リストのヒント①"
            >
              <div className="flex items-center justify-between mb-1">
                <p className="font-semibold">予約リストのヒント①</p>
                <button
                  type="button"
                  onClick={() => toggleInfo('tipsInfo')}
                  className="inline-flex items-center justify-center h-5 w-5 rounded border border-gray-300 text-[10px] text-gray-600 hover:bg-gray-50"
                  aria-label="閉じる"
                  title="閉じる"
                >
                  ×
                </button>
              </div>

              {/* 1) 来店/会計/退店ボタン */}
              <div className="mb-2">
                <div className="mb-1 bg-gray-100 px-2 py-1 rounded">
                  <p className="font-semibold">1. 来店 / 会計 / 退店 ボタン（タブレット端末 または スマホ横画面で利用可）</p>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <button type="button" disabled className="px-2 py-0.5 rounded text-[11px] bg-green-500 text-white">来</button>
                  <span className="text-gray-600 text-[11px]">…来店時に押します</span>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <button type="button" disabled className="px-2 py-0.5 rounded text-[11px] bg-blue-500 text-white">会</button>
                  <span className="text-gray-600 text-[11px]">…会計が済んだら押します</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" disabled className="px-2 py-0.5 rounded text-[11px] bg-gray-500 text-white">退</button>
                  <span className="text-gray-600 text-[11px]">…退店時に押します（タスク表では、退店した卓のタスクは非表示になります）</span>
                </div>
              </div>

              {/* 2) NEW / 編集 ドット */}
              <div className="mb-2">
                <div className="mb-1 bg-gray-100 px-2 py-1 rounded">
                  <p className="font-semibold">2. 新規追加の卓、予約変更した卓について</p>
                </div>
                <div className="space-y-1 text-gray-700 text-[12px] leading-5">
                  <p>
                    <strong>新規追加の卓：</strong> 緑色のドットが予約追加から15分付きます。
                  </p>
                  <div className="mt-1 inline-flex items-center gap-4">
                    <div className="relative inline-flex items-center">
                      <span className="absolute -left-1 -top-1 inline-block w-2 h-2 rounded-full bg-green-500 border border-white shadow-sm" aria-hidden="true"></span>
                      <span className="inline-block px-1 bg-white border rounded tabular-nums">12</span>
                    </div>
                  </div>
                  <p className="mt-2">
                    <strong>予約変更の卓：</strong> オレンジ色のドットが予約変更から15分付きます。
                  </p>
                  <div className="mt-1 inline-flex items-center gap-4">
                    <div className="relative inline-flex items-center">
                      <span className="absolute -left-1 -top-1 inline-block w-2 h-2 rounded-full bg-amber-500 border border-white shadow-sm" aria-hidden="true"></span>
                      <span className="inline-block px-1 bg-white border rounded tabular-nums">18</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3) 回転のある卓 */}
              <div>
                <div className="mb-1 bg-gray-100 px-2 py-1 rounded">
                  <p className="font-semibold">3. 回転のある卓について</p>
                </div>
                <p className="mb-1 text-gray-700">後回転のある卓は赤文字で強調して表示されます。（タスク表についても同様）</p>
                {/* 例：赤い表示 */}
                <div className="inline-flex items-center gap-2">
                  <span className="text-red-600 font-semibold">12卓（後回転あり）</span>
                </div>
              </div>
            </div>
          )}
        </div>
        {/* i ボタン：予約リストのヒント②（卓番追加の操作デモ） */}
        <div className="mt-2 flex items-center justify-end relative">
          <button
            type="button"
            onClick={() => toggleInfo('tips2')}
            className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-gray-300 text-[11px] leading-none text-gray-600 hover:bg-gray-50 shadow-sm bg-white z-10"
            aria-label="予約リストのヒント②"
            aria-expanded={openInfo === 'tips2'}
            aria-controls="help-reslist-tips2"
            title="予約リストのヒント②"
          >
            i
          </button>
          <button
            type="button"
            onClick={() => toggleInfo('tips2')}
            className="ml-2 text-[12px] text-gray-700 hover:underline"
            aria-label="予約リストのヒント②（テキスト）"
          >
            予約リストのヒント②
          </button>

          {openInfo === 'tips2' && (
            <div
              id="help-reslist-tips2"
              className="absolute z-50 right-0 top-full mt-2 w-[min(480px,90vw)] text-[12px] sm:text-[13px] leading-5 bg-white border border-gray-200 rounded shadow-lg px-3 py-2"
              role="dialog"
              aria-label="予約リストのヒント②"
            >
              <div className="flex items-center justify-between mb-1">
                <p className="font-semibold">予約リストのヒント②（卓番号の複数選択）</p>
                <button
                  type="button"
                  onClick={() => toggleInfo('tips2')}
                  className="inline-flex items-center justify-center h-5 w-5 rounded border border-gray-300 text-[10px] text-gray-600 hover:bg-gray-50"
                  aria-label="閉じる"
                  title="閉じる"
                >
                  ×
                </button>
              </div>

              {/* 卓番追加のデモ（ダミーの数値パッド。自動進行＆ピルの×操作も再現） */}
              <Hint2Demo />
              <p className="mt-2 text-xs text-gray-600">
                複数卓を選択すると、回転の対象として<strong>すべての該当卓</strong>が正しく認識され、赤字で強調表示されます。
                もちろん、単一卓のままでも通常どおり動作しますのでご安心ください。
              </p>
            </div>
          )}
        </div>
      </section>
        {localNumPadState && (
          <NumPad
            open={!!localNumPadState}
            title={localNumPadState.field === 'guests' ? '人数を入力' : '卓番号を入力'}
            multi={localNumPadState.field === 'table' || localNumPadState.field === 'targetTable'}
            initialList={[]}
            value=""
            beforeList={(() => {
              const st = localNumPadState;
              if (!st) return [] as string[];
              const res = reservations.find((x) => String(x.id) === String(st.id));
              if (!res) return [] as string[];
              const list = (Array.isArray(res.tables) && res.tables.length > 0) ? res.tables : [res.table];
              return list.map(String);
            })()}
            onCancel={closeNumPad}
            onSubmit={async ({ value, list }) => {
              const st = localNumPadState!;

              // 卓番号: 編集モードのとき → 保留に積む（複数卓プレビュー）
              if ((st.field === 'table' || st.field === 'targetTable') && editTableMode) {
                const final = (Array.isArray(list) && list.length > 0) ? list : (value ? [value] : []);
                const old = reservations.find(r => r.id === st.id)?.table ?? '';
                setPendingTables(prev => ({
                  ...prev,
                  [st.id]: { old, nextList: final.length ? final : (old ? [old] : []) }
                }));
                closeNumPad();
                return;
              }

              // 卓番号: 通常モード → 単数/複数とも override を渡して即 commit（適用ボタン不要）
              if (st.field === 'table' && !editTableMode) {
                const final = (Array.isArray(list) && list.length > 0) ? list : (value ? [value] : []);
                // 何も入力されていない場合は閉じるだけ
                if (!final.length) {
                  closeNumPad();
                  return;
                }
                const old = reservations.find(r => r.id === st.id)?.table ?? '';
                const override: PendingTables = { [st.id]: { old, nextList: final } };
                await commitTableMoves(override);
                closeNumPad();
                return;
              }

              // 人数は従来どおり即反映
              if (st.field === 'guests') {
                const n = Number(value || '0');
                updateReservationField(st.id, 'guests', Number.isFinite(n) ? n : 0);
                closeNumPad();
              }
            }}
          />
        )}
    </section>
  );
};

export default memo(ReservationsSection);