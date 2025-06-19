'use client';
import React, { useState } from 'react';
import { Reservation, CourseDef } from '../app/types'; // パスはご自身の構成に合わせて調整
import 'react-resizable/css/styles.css';

type Props = {
  reservations: Reservation[];
  courses: CourseDef[];
  rotatingTables: Set<string>;
  firstRotatingId: Record<string, number>;
  onDeparture: (id: number) => void;
  presetTables?: string[];
  // 必要に応じて他の props を追加
};

export default function TableManagement({
  reservations,
  courses,
  rotatingTables,
  firstRotatingId,
  onDeparture,
  presetTables = [],
}: Props) {
  // フロア選択 (1階 / 2階)
  const [floor, setFloor] = useState<number>(1);

  // ブロックモードの切り替え
  const [blockMode, setBlockMode] = useState<boolean>(false);
  // ブロックされたテーブルのIDセット
  const [blockedTables, setBlockedTables] = useState<Set<string>>(new Set());
  // 連結モード切替
  const [mergeMode, setMergeMode] = useState<boolean>(false);
  // 連結選択中テーブル (最大2つ)
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);
  // 連結されたグループ一覧
  const [mergedGroups, setMergedGroups] = useState<string[][]>([]);
  // 食／飲メニュー選択状態
  const [tableMenus, setTableMenus] = useState<Record<string, { eat?: string; drink?: string }>>({});
  // 備考モーダル制御
  const [remarkModal, setRemarkModal] = useState<{ open: boolean; notes?: string }>({ open: false });

  return (
    <>
    <div className="space-y-4">
      {/* フロア切替ボタン */}
      <div className="flex space-x-2">
        <button
          onClick={() => setFloor(1)}
          className={`px-2 py-1 rounded ${floor === 1 ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
        >
          1階
        </button>
        <button
          onClick={() => setFloor(2)}
          className={`px-2 py-1 rounded ${floor === 2 ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
        >
          2階
        </button>
      </div>

      {/* ブロックモード切替 */}
      <button
        onClick={() => setBlockMode((prev) => !prev)}
        className="px-2 py-1 rounded border mt-2 text-sm"
      >
        {blockMode ? 'ブロックモード: ON' : 'ブロックモード: OFF'}
      </button>
      {/* 連結モード切替 */}
      <button
        onClick={() => {
          setMergeMode(prev => !prev);
          setMergeSelection([]);
        }}
        className="px-2 py-1 rounded border mt-2 text-sm"
      >
        {mergeMode ? '連結モード: ON' : '連結モード: OFF'}
      </button>

      {/* テーブル配置エリア */}
      <div className="w-full h-64 bg-gray-100 border rounded overflow-auto p-2">
        <div className="grid grid-cols-4 gap-2">
          {presetTables.map((tbl) => {
            // Skip tables that are merged into a group but not the group's first
            const group = mergedGroups.find(g => g.includes(tbl));
            if (group && group[0] !== tbl) return null;
            // Determine span for merged group
            const span = group ? group.length : 1;
            const isRotating = rotatingTables.has(tbl);
            // Gather all reservations for this table
            const tableReservations = reservations.filter(r => r.table === tbl);
            let res;
            if (tableReservations.length > 0) {
              if (isRotating) {
                const firstId = firstRotatingId[tbl];
                res = tableReservations.find(r => r.id === firstId);
              } else {
                // non-rotating: pick the earliest reservation by time
                res = tableReservations.sort((a, b) => a.time.localeCompare(b.time))[0];
              }
            }
            return (
              <div
                key={tbl}
                onClick={() => {
                  if (blockMode) {
                    setBlockedTables((prev) => {
                      const next = new Set(prev);
                      if (next.has(tbl)) next.delete(tbl);
                      else next.add(tbl);
                      return next;
                    });
                  }
                  else if (mergeMode) {
                    // If in merge mode, toggle selection or break group
                    if (mergeSelection.length === 0) {
                      // unmerge if table already in a group
                      const existing = mergedGroups.find(g => g.includes(tbl));
                      if (existing) {
                        setMergedGroups(prev => prev.filter(g => g !== existing));
                        return;
                      }
                    }
                    // toggle selection
                    setMergeSelection(prev => {
                      if (prev.includes(tbl)) return prev.filter(t => t !== tbl);
                      const next = [...prev, tbl];
                      if (prev.length === 1) {
                        // form group when selecting second table
                        setMergedGroups(pg => [...pg, next]);
                        return [];
                      }
                      return next;
                    });
                    return;
                  }
                }}
                className={`border rounded p-2 cursor-pointer ${
                  blockedTables.has(tbl)
                    ? 'bg-gray-300'
                    : isRotating
                    ? 'bg-red-200'
                    : 'bg-white'
                }`}
                style={group ? { gridColumnEnd: `span ${span}` } : undefined}
              >
                {/* 食／飲ボタン */}
                <div className="flex space-x-1 mb-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const alias = prompt('食べ放題の略称を入力してください', tableMenus[tbl]?.eat || '');
                      if (alias !== null) setTableMenus(prev => ({ ...prev, [tbl]: { ...prev[tbl], eat: alias }}));
                    }}
                    className="text-xs border px-1 rounded"
                  >
                    {tableMenus[tbl]?.eat || '食'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const alias = prompt('飲み放題の略称を入力してください', tableMenus[tbl]?.drink || '');
                      if (alias !== null) setTableMenus(prev => ({ ...prev, [tbl]: { ...prev[tbl], drink: alias }}));
                    }}
                    className="text-xs border px-1 rounded"
                  >
                    {tableMenus[tbl]?.drink || '飲'}
                  </button>
                </div>
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="font-bold">{tbl}番</span>
                  {res && <span>{res.time}</span>}
                </div>
                {res && (
                  <>
                    {res.notes && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRemarkModal({ open: true, notes: res.notes });
                        }}
                        className="text-xs underline mb-1"
                      >
                        備考
                      </button>
                    )}
                    <div className="text-sm mb-1">{res.course}</div>
                    <div className="text-sm mb-1">{res.guests}人</div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeparture(res.id);
                      }}
                      className="mt-1 text-xs bg-gray-300 rounded w-full"
                    >
                      退店
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
    {/* 備考モーダル */}
    {remarkModal.open && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white p-4 rounded shadow-lg max-w-sm w-full">
          <div className="mb-4 text-sm">{remarkModal.notes}</div>
          <button
            onClick={() => setRemarkModal({ open: false })}
            className="px-3 py-1 bg-blue-500 text-white rounded"
          >
            閉じる
          </button>
        </div>
      </div>
    )}
    </>
  );
}

