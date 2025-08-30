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
      // 追加順：新しい順（降順）。必要なら asc に変更可。
      arr.sort((a, b) => getCreatedAtMs(b) - getCreatedAtMs(a));
    }
    return arr;
  }, [reservations, resOrder]);

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
            <div className="flex items-center space-x-4">
              <button
                onClick={onToggleEditTableMode}
                className={`px-2 py-0.5 rounded text-sm ${
                  editTableMode ? 'bg-green-500 text-white' : 'bg-gray-300'
                }`}
              >
                卓番変更
              </button>

              <button onClick={resetAllReservations} className="px-3 py-1 bg-red-500 text-white rounded text-sm">
                全リセット
              </button>
            </div>
          </div>
          {/* ── 卓番変更モード用の固定ツールバー ───────────────── */}
          {editTableMode && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 border rounded">
              <div className="text-sm">
                <span className="font-medium">卓番変更モード</span>
                <span className="ml-3 text-xs text-gray-600">選択中: {tablesForMove.length}件</span>
                {hasPendingConflict && (
                  <span className="ml-2 text-xs text-red-600">※ 重複する卓番号があります</span>
                )}
              </div>
              <div className="flex items-center gap-2">
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
                  className="px-2 py-1 text-sm rounded border bg-white hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (hasPendingConflict) return;
                    commitTableMoves();
                    // モード終了（必要に応じて継続にしたい場合はこの行を外す）
                    onToggleEditTableMode();
                  }}
                  disabled={hasPendingConflict}
                  className={`px-3 py-1 text-sm rounded text-white ${
                    hasPendingConflict ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  適用
                </button>
              </div>
            </div>
          )}

          {/* 卓番編集の保留キュー */}
          {editTableMode && Object.keys(pendingTables).length > 0 && (
            <div className="mt-2 space-y-1">
              {Object.entries(pendingTables).map(([id, tbl]) => (
                <div key={id} className="px-2 py-1 bg-yellow-50 border rounded text-sm flex justify-between">
                  <span>
                    {tbl.old}卓 → {tbl.next}卓
                  </span>
                  <button
                    onClick={() =>
                      setPendingTables((prev) => {
                        const next = { ...prev };
                        delete (next as any)[id];
                        return next;
                      })
                    }
                    className="text-red-500 text-xs ml-4"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button onClick={commitTableMoves} className="mt-2 px-4 py-1 bg-green-600 text-white rounded text-sm">
                変更を完了する
              </button>
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
                const isNew = Date.now() - createdMsRow <= 15 * 60 * 1000; // 直近15分をNEW判定
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
                    }`}
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
                      <div className="inline-flex items-center justify-center">
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
                                  const next = { ...prev };
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
                          className={`border px-1 py-0.5 rounded text-sm w-full text-center cursor-pointer ${
                            editTableMode && tablesForMove.includes(r.id) ? 'border-4 border-blue-500' : ''
                          }`}
                        />
                        {isNew && (
                          <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                            NEW
                          </span>
                        )}
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
                        className="border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer"
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
                    className="border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer"
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
                      className="border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer"
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