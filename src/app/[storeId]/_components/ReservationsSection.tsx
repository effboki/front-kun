// src/app/[storeId]/_components/ReservationsSection.tsx
import React, { memo } from 'react';
import type { ResOrder, Reservation, PendingTables } from '@/types';
import type { FormEvent, Dispatch, SetStateAction } from 'react';


type Props = {
  /** 画面に表示する予約（すでに親でフィルタ＆ソート済み） */
  reservations: Reservation[];

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
  commitTableMoves: () => void;

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

  /** セル更新や行操作用ハンドラ（親の関数をそのまま渡す） */
  updateReservationField: (
    id: string,
    field: 'time' | 'table' | 'name' | 'course' | 'eat' | 'drink' | 'guests' | 'notes',
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
  // NEW判定（直後ドット用のローカル検知）
  const NEW_THRESHOLD = 15 * 60 * 1000; // 15分
  const initialRenderRef = React.useRef(true);
  const seenRef = React.useRef<Set<string>>(new Set());
  const localNewRef = React.useRef<Map<string, number>>(new Map());

  React.useEffect(() => {
    if (initialRenderRef.current) {
      // 初回レンダでは既存分を「既知」として登録（ドットは付けない）
      reservations.forEach((r) => seenRef.current.add(r.id));
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
  const parseTimeToMinutes = (t: string) => {
    const [hh, mm] = (t || '').split(':').map((n) => parseInt(n, 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) return Number.MAX_SAFE_INTEGER;
    return hh * 60 + mm;
  };
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
  // 予約リストの最終並び（セクション内で最終決定）
  const finalReservations = React.useMemo(() => {
    const arr = [...reservations];
    if (resOrder === 'time') {
      arr.sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time));
    } else if (resOrder === 'table') {
      const ta = (r: any) => Number((r.pendingTable ?? r.table) || 0);
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
  }, [reservations, resOrder]);

  // 卓番変更モード：初回だけ小さなガイドを出す（2.5秒）
  const [tableChangeHint, setTableChangeHint] = React.useState(false);
  const tableChangeHintShownRef = React.useRef(false);
  React.useEffect(() => {
    if (editTableMode && !tableChangeHintShownRef.current) {
      setTableChangeHint(true);
      tableChangeHintShownRef.current = true;
      const t = setTimeout(() => setTableChangeHint(false), 2500);
      return () => clearTimeout(t);
    }
    if (!editTableMode) setTableChangeHint(false);
  }, [editTableMode]);
  // ペンディングの重複（同じ next に複数割当）を検知
  const hasPendingConflict = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of Object.values(pendingTables || {})) {
      const key = String(v?.next ?? '');
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const n of counts.values()) if (n > 1) return true;
    return false;
  }, [pendingTables]);
  return (
    <section className="space-y-4 text-sm">
      {/* ─────────────── 予約リストセクション ─────────────── */}
      <section>
        {/* ── 枠外ツールバー（表示順・表示項目） ───────────────── */}
        <div className="sm:p-4 p-2 border-b border-gray-200 bg-white">
          <div className="flex flex-wrap items-center gap-3">
            {/* 並び替え：セグメント（時間順／卓番順／追加順） */}
            <div className="flex items-center gap-2">
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
  
            {/* 区切り（薄） */}
            <div className="h-4 w-px bg-gray-200 hidden xs:block" />
  
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
              >
                食
              </button>
              <button
                type="button"
                onClick={() => setShowDrinkCol(!showDrinkCol)}
                aria-pressed={showDrinkCol}
                className={`px-2 py-0.5 text-xs rounded-full border ${
                  showDrinkCol ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                飲
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
                onClick={() => setShowNotesCol((p) => !p)}
                aria-pressed={showNotesCol}
                className={`hidden sm:inline-flex px-2 py-0.5 text-xs rounded-full border ${
                  showNotesCol ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                備考
              </button>
            </div>
          </div>
        </div>
        <div className="sm:p-4 p-2 space-y-4 text-sm border rounded overflow-x-auto">
          {/* ── 予約リスト ヘッダー ───────────────────── */}
          <div className="flex flex-col space-y-2">
            {/* 下段：卓番変更 & 全リセット & 予約確定 */}
            <div className="flex items-center gap-2">
              <button
                onClick={onToggleEditTableMode}
                className={`px-3 py-1 rounded text-sm font-semibold ${
                  editTableMode
                    ? 'bg-green-600 text-white'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
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
          </div>
          {/* ── 卓番変更モード用の固定ツールバー ───────────────── */}
          {editTableMode && (
            <>
              {(() => {
                const pendingCount = Object.keys(pendingTables || {}).length;
                return (
                  <div className="sticky top-[48px] z-40 bg-blue-600 text-white px-3 py-2 flex items-center gap-1 sm:gap-2 shadow flex-nowrap">
                    <span className="font-semibold">卓番変更モード</span>
                    <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded">変更予定 {pendingCount} 件</span>
                    {hasPendingConflict && (
                      <span className="text-xs bg-red-500/30 px-1.5 py-0.5 rounded">重複あり</span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (hasPendingConflict || pendingCount === 0) return;
                        commitTableMoves();
                        onToggleEditTableMode();
                      }}
                      disabled={hasPendingConflict || pendingCount === 0}
                      title={hasPendingConflict ? '重複があります' : (pendingCount === 0 ? '変更がありません' : '変更を適用')}
                      className={`ml-auto px-3 py-1 text-sm rounded font-semibold shrink-0 ${
                        hasPendingConflict || pendingCount === 0
                          ? 'bg-white/30 text-white/70 cursor-not-allowed'
                          : 'bg-white text-blue-700 hover:bg-blue-50'
                      }`}
                    >
                      適用
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
                      className="px-2 py-1 text-sm rounded bg-white/15 hover:bg-white/25"
                      aria-label="キャンセル"
                      title="キャンセル"
                    >
                      ×
                    </button>
                  </div>
                );
              })()}
              {tableChangeHint && (
                <div className="mx-3 mt-2 text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                  ① 変更したい卓をタップで選択／② 数字を入力／③「適用」
                </div>
              )}
            </>
          )}

          {/* 卓番編集の保留キュー */}
          {editTableMode && Object.keys(pendingTables).length > 0 && (
            <div className="mt-2 space-y-1">
              {Object.entries(pendingTables).map(([id, tbl]) => (
                <div
                  key={id}
                  className="px-2 py-1 bg-blue-50 border border-blue-200 rounded-md text-xs sm:text-sm text-blue-800 flex items-center justify-between"
                >
                  <span className="tabular-nums">
                    <span className="text-gray-500">{tbl.old}</span>卓
                    <span className="mx-1 font-semibold">→</span>
                    <span className="font-semibold">{tbl.next}</span>卓
                  </span>
                  <button
                    onClick={() => {
                      setPendingTables((prev) => {
                        const next = { ...prev } as any;
                        delete next[id];
                        return next;
                      });
                      if (tablesForMove.includes(id)) {
                        toggleTableForMove(id);
                      }
                    }}
                    className="ml-3 inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-blue-300 bg-white text-blue-700 hover:bg-red-50 hover:border-red-300 hover:text-red-600"
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
                const isBlockStart = !prev || prev.time !== r.time;
                const padY = isBlockStart ? 'py-1.5' : 'py-1';
                const createdMsRow = getCreatedAtMs(r);
                const localNewMs = localNewRef.current.get(r.id) ?? 0;
                const isNew = (Date.now() - createdMsRow <= NEW_THRESHOLD) || (Date.now() - localNewMs <= NEW_THRESHOLD);
                const borderClass =
                  !prev || prev.time !== r.time ? 'border-t-4 border-gray-300' : 'border-b border-gray-300';

                return (
                  <tr
                    key={r.id}
                    className={`${
                      checkedArrivals.includes(r.id) ? 'bg-green-100 ' : ''
                    }${
                      checkedDepartures.includes(r.id) ? 'bg-gray-300 text-gray-400 ' : ''
                    }${borderClass} text-center ${
                      firstRotatingId[(r.pendingTable ?? r.table)] === r.id ? 'text-red-500' : ''
                    }${editTableMode && tablesForMove.includes(r.id) ? 'bg-blue-50 ' : ''}`}
                  >
                    {/* 来店時刻セル */}
                    <td className={`border px-1 ${padY}`}>
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
                        {isNew && (
                          <span
                            className="pointer-events-none absolute left-0.5 top-0.5 z-10 block w-1.5 h-1.5 rounded-full bg-amber-500 border border-white shadow-sm"
                            aria-label="新規"
                            title="新規"
                          />
                        )}
                        <input
                          type="text"
                          readOnly
                          value={pendingTables[r.id]?.next ?? (r.pendingTable ?? r.table)}
                          onClick={() => {
                            if (editTableMode) {
                              if (!tablesForMove.includes(r.id)) {
                                setPendingTables((prev) => ({
                                  ...prev,
                                  [r.id]: { old: r.table, next: r.table },
                                }));
                              } else {
                                setPendingTables((prev) => {
                                  const next = { ...prev } as any;
                                  delete next[r.id];
                                  return next;
                                });
                              }
                              toggleTableForMove(r.id);
                              setNumPadState({
                                id: r.id,
                                field: 'targetTable',
                                value: pendingTables[r.id]?.next ?? (r.pendingTable ?? r.table),
                              });
                            } else {
                              setNumPadState({ id: r.id, field: 'table', value: r.table });
                            }
                          }}
                          className={`border px-1 py-0.5 rounded text-sm w-full !text-center tabular-nums cursor-pointer ${
                            editTableMode && tablesForMove.includes(r.id) ? 'border-4 border-blue-500' : ''
                          }`}
                        />
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
                    <td className={`border px-1 ${padY}`}>
                      <input
                        type="text"
                        value={r.guests}
                        readOnly
                        onClick={() => setNumPadState({ id: r.id, field: 'guests', value: r.guests.toString() })}
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
                      <button onClick={() => deleteReservation(r.id)} className="bg-red-500 text-white px-2 py-0.5 rounded text-sm">
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
                      onChange={(e) => setNewResEat(e.target.value.slice(0, 2))}
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
                      onChange={(e) => setNewResDrink(e.target.value.slice(0, 2))}
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
        </div>
      </section>
    </section>
  );
};

export default memo(ReservationsSection);