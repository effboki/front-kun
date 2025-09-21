'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

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
};

export type CourseOption = { name: string; stayMinutes?: number };

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
  /** スケジュール対象日の 00:00:00.000 (ローカル) 。未指定なら今日の 0:00 */
  dayStartMs?: number;
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

const rangesOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  Math.max(aStart, bStart) < Math.min(aEnd, bEnd);

const computeEndMsFromInputs = (
  startMs: number,
  courseName: string | undefined,
  coursesOptions?: CourseOption[],
  fallbackMin?: number,
) => {
  const stay = coursesOptions?.find((c) => c.name === courseName)?.stayMinutes;
  const minutes = (Number.isFinite(stay) ? (stay as number) : (fallbackMin ?? 60));
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
    onSave,
    onDelete,
    reservationsSnapshot,
    defaultStayMinutes,
  } = props;

  const day0 = React.useMemo(() => dayStartMs ?? toStartOfDayLocal(), [dayStartMs]);

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
  const [drinkLabel, setDrinkLabel] = React.useState<string>(toText(initial?.drinkLabel));
  const [eatLabel,  setEatLabel]    = React.useState<string>(toText(initial?.eatLabel));
  const [memo, setMemo] = React.useState<string>(initial?.memo ?? '');
  const [tables, setTables] = React.useState<string[]>(() => {
    if (initial?.tables && initial.tables.length > 0) return initial.tables;
    if (initial?.table) return [initial.table];
    return [];
  });

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

  const timeOptions = React.useMemo(() => buildTimeOptions(), []);
  const availableDrinkOptions = React.useMemo(() => (Array.isArray(drinkOptionsProp) ? drinkOptionsProp.map(String) : []), [drinkOptionsProp]);
  const availableEatOptions = React.useMemo(() => (Array.isArray(eatOptionsProp) ? eatOptionsProp.map(String) : []), [eatOptionsProp]);
  const normalizedTimeOptions = React.useMemo(() => {
    if (!time) return timeOptions;
    if (timeOptions.includes(time)) return timeOptions;
    const merged = [...timeOptions, time];
    merged.sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    return merged;
  }, [time, timeOptions]);

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
    const end = computeEndMsFromInputs(start, courseName || initial?.courseName, coursesOptions, defaultStayMinutes);
    const selected = new Set(tables.map(String));

    const list = reservationsSnapshot.filter((r) => {
      if (reservationId && r.id === reservationId) return false; // 自分は除外
      const rEnd = computeEndMsForSnapshot(r, coursesOptions, defaultStayMinutes);
      const shared = (r.tables || []).some((t) => selected.has(String(t)));
      return shared && rangesOverlap(start, end, r.startMs, rEnd);
    });
    setConflicts(list);
  }, [open, reservationsSnapshot, tables, time, day0, courseName, initial?.courseName, reservationId, coursesOptions, defaultStayMinutes]);

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
  }, [open, reservationId, initial?.startMs, initial?.tables, initial?.table, initial?.guests, initial?.name, initial?.courseName, initial?.drinkAllYouCan, initial?.foodAllYouCan, initial?.drinkLabel, initial?.eatLabel, initial?.memo, day0, orderByOptions, availableDrinkOptions, availableEatOptions]);

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
          'absolute right-0 top-0 h-full w-[min(90vw,420px)] bg-white shadow-xl',
          'transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
          'flex flex-col',
        ].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawerTitle"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b flex items-center justify-between">
          <h2 id="drawerTitle" className="text-base font-semibold">
            {reservationId ? '予約を編集' : '予約を追加'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-gray-500 hover:text-gray-700"
            aria-label="閉じる"
          >
            ×
          </button>
        </header>

        {conflicts && conflicts.length > 0 && (
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

        <form onSubmit={handleSubmit} className="flex-1 overflow-auto px-4 py-4 space-y-4">
          {/* 来店時間 */}
          <div className="flex items-center gap-2">
            <label className="w-[7em] shrink-0 text-sm font-medium">来店時間</label>
            <select
              value={time}
              onChange={(e) => setTime(e.currentTarget.value)}
              className="flex-1 rounded border px-3 py-2"
              required
            >
              {normalizedTimeOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          {/* 人数 */}
          <div className="flex items-center gap-2">
            <label className="w-[7em] shrink-0 text-sm font-medium">人数</label>
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
              className="flex-1 rounded border px-3 py-2 text-[16px]"
              required
              aria-label="人数"
              placeholder="例: 4"
            />
          </div>

          {/* 氏名 */}
          <div className="flex items-center gap-2">
            <label className="w-[7em] shrink-0 text-sm font-medium">氏名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              className="flex-1 rounded border px-3 py-2"
              placeholder="山田 太郎"
            />
          </div>

          {/* コース */}
          <div className="flex items-center gap-2">
            <label className="w-[7em] shrink-0 text-sm font-medium">コース</label>
            {coursesOptions && coursesOptions.length > 0 ? (
              <select
                className="flex-1 rounded border px-3 py-2"
                value={courseName}
                onChange={(e) => setCourseName(e.currentTarget.value)}
              >
                <option value="">未選択</option>
                {coursesOptions.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
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

          {/* 飲み放題 / 食べ放題（同一行） */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              <label className="w-[5.5em] shrink-0 text-sm font-medium">飲み放題</label>
              {availableDrinkOptions.length > 0 ? (
                <select
                  className="flex-1 rounded border px-3 py-2"
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
                  className="flex-1 rounded border px-3 py-2"
                  placeholder="プラン名（空で未選択）"
                  value={drinkLabel}
                  onChange={(e) => setDrinkLabel(e.currentTarget.value)}
                />
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="w-[5.5em] shrink-0 text-sm font-medium">食べ放題</label>
              {availableEatOptions.length > 0 ? (
                <select
                  className="flex-1 rounded border px-3 py-2"
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
                  className="flex-1 rounded border px-3 py-2"
                  placeholder="プラン名（空で未選択）"
                  value={eatLabel}
                  onChange={(e) => setEatLabel(e.currentTarget.value)}
                />
              )}
            </div>
          </div>

          {/* 卓（複数選択） */}
          <div>
            <div className="mb-1">
              <label className="block text-sm font-medium">卓（複数選択可）</label>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <button type="button" onClick={selectAllTables} className="text-xs px-2 py-1 border rounded">全選択</button>
              <button type="button" onClick={clearAllTables} className="text-xs px-2 py-1 border rounded">全解除</button>
            </div>
            {tablesOptions && tablesOptions.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
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

          {/* メモ */}
          <div className="flex items-center gap-2">
            <label className="w-[7em] shrink-0 text-sm font-medium">メモ</label>
            <textarea
              className="flex-1 rounded border px-3 py-2 min-h-[80px]"
              value={memo}
              onChange={(e) => setMemo(e.currentTarget.value)}
              placeholder="アレルギー、席希望など"
            />
          </div>
        </form>

        <div className="px-4 py-3 border-t flex items-center justify-between gap-3">
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
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800">
              キャンセル
            </button>
            <button
              type="submit"
              onClick={(e) => {
                // form の submit をトリガ
                const form = (e.currentTarget.closest('aside') as HTMLElement)?.querySelector('form') as HTMLFormElement | null;
                form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
              }}
              className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
            >
              保存
            </button>
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
