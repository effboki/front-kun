'use client';

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { ScheduleItem, ScheduleRange } from '@/types/schedule';
import type { StoreSettingsValue } from '@/types/settings';
import { SLOT_MS, snap5m } from '@/lib/schedule';
import { startOfDayMs } from '@/lib/time';
import ReservationEditorDrawer, { type ReservationInput, type CourseOption } from '../reservations/ReservationEditorDrawer';
import { DndContext, useDraggable, type DragEndEvent, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';

type OptimisticPatch = Partial<ScheduleItem> & { [key: string]: unknown };

function shallowEqualOptimistic(a?: OptimisticPatch, b?: OptimisticPatch): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const vA = a[key];
    const vB = b[key];
    if (Array.isArray(vA) && Array.isArray(vB)) {
      if (vA.length !== vB.length) return false;
      for (let i = 0; i < vA.length; i++) {
        if (String(vA[i]) !== String(vB[i])) return false;
      }
      continue;
    }
    if (vA !== vB) return false;
  }
  return true;
}

function patchSatisfiedByItem(item: any, patch: OptimisticPatch): boolean {
  if (!item) return false;
  for (const [key, value] of Object.entries(patch)) {
    const current = (item as any)[key];
    if (Array.isArray(value)) {
      if (!Array.isArray(current)) return false;
      if (value.length !== current.length) return false;
      for (let i = 0; i < value.length; i++) {
        if (String(value[i]) !== String(current[i])) return false;
      }
      continue;
    }
    if (current !== value) return false;
  }
  return true;
}

// アプリ上部バーの高さ(px)。時間ヘッダーをこの位置に固定
const STICKY_TOP_PX = 48; // 必要なら 70 等に調整
// 画面下部のタブバー（フッター）高さ(px)。端末により前後する場合は調整
const BOTTOM_TAB_PX = 70;

type Props = {
  /** 表示開始/終了の“時”（0-24想定）。未指定は 10-23 */
  dayStartHour?: number;
  dayEndHour?: number;
  /** 可視卓（営業前設定と合わせる） */
  tables?: string[];
  /** 直接 items を渡したい場合に使用（なければ空配列） */
  items?: ScheduleItem[];
  /** 1行の高さ(px)。未指定は 44 */
  rowHeightPx?: number;
  /** 予約編集の保存/削除（未指定ならダイアログのみ表示） */
  onSave?: (data: ReservationInput, id?: string | null) => Promise<string | void>;
  onDelete?: (id: string) => Promise<void>;
  /** UI 選択肢（無ければテキスト入力にフォールバック） */
  tablesOptions?: string[];
  coursesOptions?: CourseOption[];
  eatOptions?: string[];
  drinkOptions?: string[];
  storeSettings?: StoreSettingsValue;
  dayStartMs?: number; // 基準日の開始ms（外から渡す）
};

/**
 * v1 は“表示のみ”。ドラッグや新規作成は後続フェーズで追加。
 * 将来分割しやすいように、内部小コンポーネントを同ファイル内に定義。
 */
export default function ScheduleView({
  dayStartHour = 10,
  dayEndHour = 23,
  tables: tablesProp,
  items,
  rowHeightPx = 44,
  onSave,
  onDelete,
  tablesOptions,
  coursesOptions,
  eatOptions,
  drinkOptions,
  storeSettings,
  dayStartMs,
}: Props) {
  // --- 列幅・端末判定 ---
const headerH = 40; // 時刻ヘッダーの高さ(px)

// 端末幅で判定（スマホ/タブレット）
const [isTablet, setIsTablet] = useState(() =>
  (typeof window !== 'undefined' ? window.innerWidth >= 768 : false),
);

// 左の卓番号列の幅（px）: スマホ 56 / タブレット 64
const leftColW = isTablet ? 64 : 56;
  // 5分スロット幅(px)。タブレットは少し広め
  const baseColW = 8;
  const colW = isTablet ? 10 : baseColW;
  useEffect(() => {
    const onResize = () => setIsTablet(window.innerWidth >= 768); // 768px以上をタブレット相当とみなす
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // スクロール方向の影用（ヘッダー/左列にシャドウを付ける）
  const [scrolled, setScrolled] = useState({ x: false, y: false });
  const headerLeftOverlayRef = useRef<HTMLDivElement | null>(null);
  const scrollRaf = useRef<number | null>(null);
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const nx = el.scrollLeft > 1;
    const ny = el.scrollTop > 1;
    setScrolled(prev => (prev.x === nx && prev.y === ny ? prev : { x: nx, y: ny }));
    if (headerLeftOverlayRef.current) {
      const x = el.scrollLeft;
      if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
      scrollRaf.current = requestAnimationFrame(() => {
        if (headerLeftOverlayRef.current) {
          headerLeftOverlayRef.current.style.transform = `translateX(${x}px)`;
        }
      });
    }
  }, []);

  useEffect(() => {
    if (headerLeftOverlayRef.current) {
      headerLeftOverlayRef.current.style.transform = 'translateX(0px)';
    }
  }, []);

  useEffect(() => () => {
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
  }, []);

  // ===== 行高の自動計算（スマホ：画面に約12行が収まるように） =====
  // タブレットは従来どおり `rowHeightPx` をそのまま使用し、
  // スマホ幅（<768px）のときは可視領域から計算した高さを使う。
  const MIN_CARD_HEIGHT_PX = 54;
  const MAX_VISIBLE_ROWS = 12;
  const [autoRowH, setAutoRowH] = useState<number>(() => Math.max(rowHeightPx, MIN_CARD_HEIGHT_PX));
  useEffect(() => {
    const compute = () => {
      const viewportH = window.innerHeight;
      // スクロール親の高さ計算と合わせる（上部バー + 下部タブを控除）
      const usableH = Math.max(160, viewportH - (STICKY_TOP_PX + BOTTOM_TAB_PX));
      const scrollableHeight = Math.max(MIN_CARD_HEIGHT_PX, usableH - headerH);
      const rowsFitMin = Math.max(1, Math.floor(scrollableHeight / MIN_CARD_HEIGHT_PX));
      const targetRows = Math.max(1, Math.min(MAX_VISIBLE_ROWS, rowsFitMin));
      const h = Math.max(
        MIN_CARD_HEIGHT_PX,
        Math.floor(scrollableHeight / targetRows)
      );
      setAutoRowH(h);
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  // 実際に使う行高：ビュー由来の自動計算と指定値のうち大きい方
  const effectiveRowH = Math.max(rowHeightPx, autoRowH);

  // --- Now indicator (updates every 30s) ---
  const [nowMs, setNowMs] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [pendingMutations, setPendingMutations] = useState<Record<string, OptimisticPatch>>({});
  // Long-press arming: only an "armed" card can be dragged/resized
  const [armedId, setArmedId] = useState<string | null>(null);
  // ---- Card-tap action & table reassign mode ----
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<(ScheduleItem & { _startCol?: number; _spanCols?: number; _row?: number; _table?: string; _key?: string }) | null>(null);
  const [reassign, setReassign] = useState<{ base: ScheduleItem & { _startCol: number; _spanCols: number; _row?: number; _table?: string; _key?: string }; selected: string[]; original: string[] } | null>(null);
  // --- ポップオーバー座標 ---
  const [actionBubble, setActionBubble] = useState<{ left: number; top: number } | null>(null);

  const applyOptimistic = useCallback((id: string, patch: OptimisticPatch) => {
    if (!id || !patch) return;
    setPendingMutations(prev => {
      const prevPatch = prev[id];
      const merged = prevPatch ? { ...prevPatch, ...patch } : { ...patch };
      if (shallowEqualOptimistic(prevPatch, merged)) return prev;
      return { ...prev, [id]: merged };
    });
  }, []);

  const revertOptimistic = useCallback((id: string) => {
    if (!id) return;
    setPendingMutations(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const runSave = useCallback((id: string, patch: Record<string, unknown>, optimistic?: OptimisticPatch) => {
    if (!onSave || !id) return;
    const hasOptimistic = optimistic && Object.keys(optimistic).length > 0;
    if (hasOptimistic) {
      applyOptimistic(id, optimistic!);
    }
    let result: unknown;
    try {
      result = onSave(patch as any, id);
    } catch (err) {
      if (hasOptimistic) revertOptimistic(id);
      console.error('ScheduleView onSave failed', err);
      return;
    }
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch((err) => {
        if (hasOptimistic) revertOptimistic(id);
        console.error('ScheduleView onSave rejected', err);
      });
    }
  }, [onSave, applyOptimistic, revertOptimistic]);

  // 1) データ取得：V1は表示専用。items が渡されなければ空配列。
  const data = useMemo<(ScheduleItem & { _key: string })[]>(() => {
    const base = (items ?? []).map((it, idx) => ({ ...it, _key: String((it as any).id ?? `tmp_${idx}`) }));
    if (!pendingMutations || Object.keys(pendingMutations).length === 0) {
      return base;
    }
    return base.map((item) => {
      const key = String(item.id ?? item._key);
      const patch = pendingMutations[key];
      if (!patch) return item;
      return { ...item, ...patch } as typeof item;
    });
  }, [items, pendingMutations]);

  useEffect(() => {
    setPendingMutations(prev => {
      if (!prev || Object.keys(prev).length === 0) return prev;
      const map = new Map<string, any>();
      (items ?? []).forEach((it, idx) => {
        const key = String((it as any).id ?? `tmp_${idx}`);
        map.set(key, it);
      });
      let changed = false;
      const next = { ...prev };
      for (const [id, patch] of Object.entries(prev)) {
        const current = map.get(id);
        if (current && patchSatisfiedByItem(current, patch)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [items]);

  // 4.5) 同卓 & 時間重複の衝突インデックス（⚠️表示用）
  const conflictSet = useMemo(() => {
    // tableId -> intervals [{ key, startMs, endMs }]
    const perTable: Record<string, { key: string; startMs: number; endMs: number }[]> = {};
    for (const it of data) {
      const start = it.startMs;
      const end = it.endMs;
      if (!(end > start)) continue;
      for (const t of it.tables) {
        const tt = String(t);
        (perTable[tt] ??= []).push({ key: it._key, startMs: start, endMs: end });
      }
    }
    const out = new Set<string>();
    for (const [t, arr] of Object.entries(perTable)) {
      arr.sort((a, b) => a.startMs - b.startMs);
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        for (let j = i + 1; j < arr.length; j++) {
          const b = arr[j];
          if (b.startMs >= a.endMs) break; // 以降は重ならない
          // overlap
          if (Math.max(a.startMs, b.startMs) < Math.min(a.endMs, b.endMs)) {
            out.add(`${t}::${a.key}`);
            out.add(`${t}::${b.key}`);
          }
        }
      }
    }
    return out;
  }, [data]);

  // Props優先（未指定なら店舗設定 → それも無ければ 10–23）
  const effectiveStartHour = (dayStartHour ?? storeSettings?.schedule?.dayStartHour ?? 10);
  const effectiveEndHour   = (dayEndHour   ?? storeSettings?.schedule?.dayEndHour   ?? 23);
  const range = useMemo<ScheduleRange>(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(effectiveStartHour, 0, 0, 0);
    const end = new Date(start);
    // 例: 15 -> 24（同日内）/ 22 -> 6（翌日またぎ）/ 17 -> 26（数値で翌日表現）対応
    const rawEndHour = effectiveEndHour <= effectiveStartHour ? effectiveEndHour + 24 : effectiveEndHour;
    end.setHours(rawEndHour, 0, 0, 0);
    return { startMs: start.getTime(), endMs: end.getTime() };
  }, [effectiveStartHour, effectiveEndHour]);

  // 3) 列数（5分 = 1 列）
  const nCols = Math.max(1, Math.round((range.endMs - range.startMs) / SLOT_MS));
  // 1時間あたりのカラム数（SLOT_MS=5分なら 12）と、1時間のピクセル幅
  const colsPerHour = Math.round((60 * 60 * 1000) / SLOT_MS);
  const hourPx = colW * colsPerHour;
  // 補助縦線（実線）は 30 分固定。タブレットでは 15/45 は別レイヤーで破線オーバーレイ
  const minorSolidStepPx = 6 * colW; // 30分 = 6スロット

  // 描画は常に設定/デフォルトの開始時刻から（10:00–23:00 など）
  const anchorStartMs = range.startMs; // 描画は常に設定/デフォルトの開始時刻から（10:00–23:00 など）

  // === 当日0:00基準のスロット計算（保存・変換は必ず「その日の0:00」基準） ===
  const day0 = useMemo(() => startOfDayMs(dayStartMs ?? range.startMs), [dayStartMs, range.startMs]); // 保存・変換は必ず「その日の0:00」基準
  // anchorStartMs が当日0:00から何スロット目か（5分=1スロット）
  const anchorStartSlotIndex = useMemo(() => Math.round((anchorStartMs - day0) / SLOT_MS), [anchorStartMs, day0]);

  // === カラム⇄時間 変換の共通関数（保存は ms の加減算のみで処理） ===
  const startMsFromCol = useCallback((col: number) => {
    // グリッドの列は anchorStartMs が 1 列目。保存は当日0:00起点で一貫化。
    // day0 + (anchorStartSlotIndex + (col-1)) * SLOT_MS
    return day0 + (anchorStartSlotIndex + (col - 1)) * SLOT_MS;
  }, [day0, anchorStartSlotIndex]);

  const endMsFromColSpan = useCallback((startCol: number, spanCols: number) => {
    return startMsFromCol(startCol) + spanCols * SLOT_MS;
  }, [startMsFromCol]);

  const durationMinFromSpan = useCallback((spanCols: number) => {
    return Math.round((spanCols * SLOT_MS) / 60000);
  }, []);

  // 4) 行（卓）の決定：tablesProp > tablesOptions > data から抽出。
  const tables = useMemo<string[]>(() => {
    // 優先順位: 1) 明示テーブル 2) 店舗設定の卓順 3) 予約から抽出
    // すべて string 化してキーの不一致を防ぐ
    if (tablesProp && tablesProp.length > 0) return tablesProp.map(String);
    if (tablesOptions && tablesOptions.length > 0) return tablesOptions.map(String);
    const set = new Set<string>();
    for (const it of data) for (const t of it.tables) set.add(String(t));
    return Array.from(set);
  }, [tablesProp, tablesOptions, data]);

  const tableIndex = useMemo<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    // CSS Grid は 1-based。ここで i+1 にしておかないと row=1 が欠落する
    tables.forEach((id, i) => (m[id] = i + 1));
    return m;
  }, [tables]);

  const eatOptionsList = useMemo<string[]>(() => {
    if (eatOptions && eatOptions.length > 0) return eatOptions.map(String);
    const fromSettings = storeSettings?.eatOptions;
    return Array.isArray(fromSettings) ? fromSettings.map(String) : [];
  }, [eatOptions, storeSettings?.eatOptions]);

  const drinkOptionsList = useMemo<string[]>(() => {
    if (drinkOptions && drinkOptions.length > 0) return drinkOptions.map(String);
    const fromSettings = storeSettings?.drinkOptions;
    return Array.isArray(fromSettings) ? fromSettings.map(String) : [];
  }, [drinkOptions, storeSettings?.drinkOptions]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; initial: Partial<ReservationInput> & { table?: string } } | null>(null);

  const openEditorFor = useCallback((it: (ScheduleItem & { _table?: string })) => {
    setEditing({
      id: it.id ?? null,
      initial: {
        startMs: it.startMs,
        tables: it.tables,
        table: it._table,
        guests: (it as any).people ?? (it as any).guests ?? 0,
        name: (it as any).name ?? '',
        courseName: (it as any).course,
        drinkAllYouCan: Boolean((it as any).drink || (it as any).drinkLabel),
        foodAllYouCan: Boolean((it as any).eat || (it as any).eatLabel),
        drinkLabel: (it as any).drinkLabel ?? (it as any).drink ?? '',
        eatLabel: (it as any).eatLabel ?? (it as any).eat ?? '',
      },
    });
    setDrawerOpen(true);
  }, []);


  // 卓番再割り当ての保存
  const confirmReassign = useCallback(() => {
    if (!reassign) return;
    const base = reassign.base as any;
    const baseId = String(base.id ?? base._key ?? '');
    if (!baseId) { setReassign(null); return; }
    const picked = Array.from(new Set((reassign.selected ?? []).map(String))).filter(Boolean);
    if (picked.length === 0) { setReassign(null); return; }
    const patch: any = { tables: picked, table: picked[0] };
    runSave(baseId, patch, { tables: picked, table: picked[0] });
    setReassign(null);
  }, [reassign, runSave]);

  // 5) レンジ内にかかる予約のみ描画（範囲外はスキップ）
  const clipped = useMemo(() => {
    const out: (ScheduleItem & { _startCol: number; _spanCols: number; _row: number; _table?: string; status?: 'warn'; _key?: string })[] = [];
    for (const it of data) {
      // 予約が一切レンジにかからない場合はスキップ
      const visStart = Math.max(it.startMs, range.startMs);
      const visEnd = Math.min(it.endMs, range.endMs);
      if (visEnd <= visStart) continue;
      // 5分スナップ（念のため）
      const s = snap5m(visStart);
      const e = snap5m(visEnd);
      const startCol = Math.max(1, Math.floor((s - anchorStartMs) / SLOT_MS) + 1); // 1-based
      const spanCols = Math.max(1, Math.ceil((e - s) / SLOT_MS));
      // 複数卓 → 各卓に同じブロックを描画（行スパン風）
      for (const t of it.tables) {
        const tStr = String(t);
        const row = tableIndex[tStr];
        if (row == null) continue; // row=1 を falsy 判定で落とさない
        const warn = conflictSet.has(`${tStr}::${it._key}`);
        out.push({ ...it, status: warn ? 'warn' : undefined, _startCol: startCol, _spanCols: spanCols, _row: row, _table: tStr });
      }
    }
    return out;
  }, [data, range.startMs, range.endMs, tableIndex, conflictSet, anchorStartMs]);

  const stacked = useMemo(() => {
    // 同一卓内で時間が重なる予約を縦にずらすためのスタックインデックスを付与
    const byRow: Record<string, any[]> = {};
    for (const it of clipped) {
      const key = String((it as any)._table ?? (it as any)._row);
      (byRow[key] ??= []).push(it);
    }

    const out: any[] = [];
    for (const [_, arr] of Object.entries(byRow)) {
      // 開始時刻→終了時刻で安定ソート
      arr.sort((a, b) => (a.startMs - b.startMs) || (a.endMs - b.endMs));
      // アクティブ区間（終了時刻と割当て済みスタック番号）
      const active: { end: number; idx: number }[] = [];
      for (const it of arr) {
        // 終了したものを除去
        for (let i = active.length - 1; i >= 0; i--) {
          if (active[i].end <= it.startMs) active.splice(i, 1);
        }
        // 使われていない最小のスタック番号を割当て
        const used = new Set(active.map(a => a.idx));
        let idx = 0;
        while (used.has(idx)) idx++;
        (it as any)._stackIndex = idx;
        active.push({ end: it.endMs, idx });
      }
      out.push(...arr);
    }
    return out;
  }, [clipped]);

  const rowStackCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of stacked as any[]) {
      const key = String((it as any)._table ?? (it as any)._row);
      const idx = Number((it as any)._stackIndex ?? 0);
      const next = Math.max(1, idx + 1);
      m[key] = Math.max(m[key] ?? 1, next);
    }
    return m;
  }, [stacked]);

  // 各卓の行高：重なり数に応じて高さを増やす
  const rowHeightsPx = useMemo(() => {
    return tables.map((t) => (rowStackCount[String(t)] ?? 1) * effectiveRowH);
  }, [tables, rowStackCount, effectiveRowH]);

  // タップ時のアクションメニュー（卓番変更 / 予約詳細）
  const onCardTap = useCallback((it: ScheduleItem & { _startCol?: number; _spanCols?: number; _row?: number; _table?: string; _key?: string }) => {
    setArmedId(null);
    setActionTarget(it);

    // === ポップオーバー座標を、グリッド内の予約カード位置から算出（近めに表示） ===
    const rowIdx = Math.max(0, Number((it as any)._row ?? 1) - 1);
    // 行の先頭位置（可変行高対応）
    let top = 0;
    for (let i = 0; i < rowIdx; i++) top += (rowHeightsPx[i] ?? 0);
    // 被りスタックの層オフセット（重なり段を考慮したカードの実表示位置と高さ）
    const key = String((it as any)._table ?? (it as any)._row ?? '');
    const layers = Math.max(1, Number(rowStackCount[key] ?? 1));
    const rowH = Math.max(1, Number(rowHeightsPx[rowIdx] ?? effectiveRowH));
    const perLayerH = Math.max(1, Math.floor(rowH / layers));
    const stackIndex = Math.max(0, Number((it as any)._stackIndex ?? 0));
    const cardTop = top + stackIndex * perLayerH + 4; // カードの上端
    const cardBottom = cardTop + perLayerH;            // カードの下端

    const startCol = Math.max(1, Number((it as any)._startCol ?? 1));
    const spanCols = Math.max(1, Number((it as any)._spanCols ?? 1));

    // ポップオーバーのサイズと最小余白（近めに表示）
    const bubbleW = 200; // 旧: 220
    const bubbleH = 110; // 旧: 132
    const GAP = 4;       // 旧: 8

    // カードの左右端・幅（px）
    const cardLeft = (startCol - 1) * colW;
    const cardWidth = spanCols * colW;
    const cardRight = cardLeft + cardWidth;

    // 水平位置はカード中央に。はみ出す場合はクランプ。
    let left = cardLeft + (cardWidth - bubbleW) / 2;
    const maxLeft = nCols * colW - bubbleW;
    left = Math.max(4, Math.min(left, maxLeft));

    // 垂直位置は「真下（優先）→上」の順。どちらも 4px だけ離す。
    const gridH = rowHeightsPx.reduce((a, b) => a + b, 0);
    let topPos = cardBottom + GAP; // まずは下側
    if (topPos + bubbleH > gridH) {
      // 下に入らなければ上側に切り替え
      topPos = Math.max(0, cardTop - bubbleH - GAP);
      // さらにクランプ
      if (topPos + bubbleH > gridH) topPos = Math.max(0, gridH - bubbleH);
    }

    setActionBubble({ left, top: topPos });
    setActionMenuOpen(true);
  }, [rowHeightsPx, rowStackCount, effectiveRowH, colW, nCols]);

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    if (!onSave) return;
    const rawId = String(e.active.id || '');
    const sepIndex = rawId.indexOf(':');
    if (sepIndex <= 0) return;

    const kind = rawId.slice(0, sepIndex);
    if (kind !== 'move') return; // リサイズ系は無効化

    const payload = rawId.slice(sepIndex + 1);
    if (!payload) return;

    const payloadParts = payload.split('::');
    const baseId = payloadParts[0] ?? '';
    const tableToken = payloadParts[1];

    if (!baseId) return;

    const base = clipped.find(x => {
      const candidateId = String((x.id ?? x._key) ?? '');
      if (candidateId !== baseId) return false;
      if (!tableToken) return true;
      const candidateTable = String((x._table ?? x._row) ?? '');
      return candidateTable === tableToken;
    });

    if (!base) return;

    const deltaX = e.delta?.x ?? 0;
    const deltaY = e.delta?.y ?? 0;

    const startCol = base._startCol;
    const spanCols = base._spanCols;

    // 移動方向判定（横優先）
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absX < 1 && absY < 1) return; // 微小移動は無視

    if (absX >= absY) {
      // 横移動：開始列→startMs 再計算
      const deltaCols = Math.round(deltaX / colW);
      if (!deltaCols) return;
      const newStartCol = Math.max(1, startCol + deltaCols);
      const newStartMs = startMsFromCol(newStartCol);
      const newEndMs = endMsFromColSpan(newStartCol, spanCols);
      const patch: any = {
        startMs: newStartMs,
        endMs: newEndMs,
        durationMin: durationMinFromSpan(spanCols),
      };
      runSave(baseId, patch, { startMs: newStartMs, endMs: newEndMs });
      setArmedId(null);
    } else {
      // 縦移動：行（卓）変更
      const baseRowH = rowHeightsPx[base._row - 1] ?? effectiveRowH;
      const deltaRows = Math.round(deltaY / baseRowH);
      if (!deltaRows) return;

      const currentRowIdx = base._row - 1;
      let targetRowIdx = currentRowIdx + deltaRows;
      targetRowIdx = Math.max(0, Math.min(tables.length - 1, targetRowIdx));
      if (targetRowIdx === currentRowIdx) return;

      const newTable = tables[targetRowIdx];
      if (!newTable) return;

      const currentTable = String(base._table ?? '');
      if (currentTable === newTable) return;

      const originalTables = Array.isArray(base.tables) ? base.tables.map(String) : (currentTable ? [currentTable] : []);
      let nextTables = originalTables.length > 0 ? [...originalTables] : (currentTable ? [currentTable] : []);
      if (nextTables.length === 0) {
        nextTables = [newTable];
      } else {
        const idx = nextTables.findIndex(t => t === currentTable);
        if (idx >= 0) {
          nextTables[idx] = newTable;
        } else {
          nextTables[0] = newTable;
        }
      }

      const deduped: string[] = [];
      for (const t of nextTables) {
        if (!deduped.includes(t)) deduped.push(t);
      }
      if (deduped.length === 0) deduped.push(newTable);

      const patch: any = {
        tables: deduped,
        table: deduped[0] ?? newTable,
      };

      runSave(baseId, patch, { tables: deduped, table: patch.table });
      setArmedId(null);
    }
  }, [onSave, runSave, clipped, colW, startMsFromCol, endMsFromColSpan, durationMinFromSpan, effectiveRowH, tables, setArmedId, rowHeightsPx]);

  // DnD センサー: ドラッグ自体に遅延はかけない（長押しで武装→即ドラッグ）
const sensors = useSensors(
  useSensor(PointerSensor),
  useSensor(TouchSensor),
);

  // 空きマスクリックで新規予約を作成
  const handleGridClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // どこか空きマスをタップしたらドラッグ武装を解除
    setArmedId(null);

    // アクションメニュー表示中は閉じるだけ（新規作成しない）
    if (actionMenuOpen) {
      setActionMenuOpen(false);
      setActionTarget(null);
      setActionBubble(null);
      return;
    }

    // クリック座標 → 列・行
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 列（1-based）
    let col = Math.floor(x / colW) + 1;
    col = Math.max(1, Math.min(nCols, col));

    // 行（1-based）：可変行高に対応
    let acc = 0;
    let row = 1;
    for (let i = 0; i < rowHeightsPx.length; i++) {
      acc += rowHeightsPx[i];
      if (y < acc) { row = i + 1; break; }
      if (i === rowHeightsPx.length - 1) row = rowHeightsPx.length;
    }

    // 開始時刻（5分スナップ）
    const startMsRaw = anchorStartMs + (col - 1) * SLOT_MS;
    const startMs = snap5m(startMsRaw);

    // 卓（Shiftキー押下で隣卓も連結）
    const mainTable = tables[row - 1];
    const joined: string[] = [mainTable];
    if (e.shiftKey) {
      const neighbor = tables[row] ?? tables[row - 2];
      if (neighbor && neighbor !== mainTable) joined.push(neighbor);
    }

    setEditing({
      id: null,
      initial: { startMs, tables: joined, table: mainTable, guests: 0, name: '' },
    });
    setDrawerOpen(true);
  }, [nCols, anchorStartMs, tables, colW, rowHeightsPx, actionMenuOpen]);

  const gridHeightPx = rowHeightsPx.reduce((a, b) => a + b, 0);
  return (
    <div className="relative w-full bg-transparent">
      {/* 共通スクロール領域（縦・横ともにこの要素がスクロール親） */}
      <div
        className="relative overflow-auto"
        onScroll={handleScroll}
        style={{
          // 画面上部のアプリバー分だけ余白を見込んで高さを固定（必要なら調整）
          height: `calc(100vh - ${STICKY_TOP_PX + BOTTOM_TAB_PX}px - env(safe-area-inset-bottom))`,
          overscrollBehavior: 'contain',
        }}
      >
        {/* スクロール可能領域（縦・横） */}
        <div
          className="relative"
          style={{
            // スクロール幅 = 左列 + タイムライン幅
            width: leftColW + nCols * colW,
            height: headerH + gridHeightPx,
          }}
        >
          {/* === 上部ヘッダー（左上は常に白／時刻は左余白分だけオフセット）=== */}
          <div
            className={`sticky top-0 z-30 bg-white border-b overflow-hidden ${scrolled.y ? 'shadow-sm' : ''}`}
            style={{ height: headerH, boxShadow: '0 1px 0 0 #e5e7eb', overflow: 'clip' }}
          >
            <div
              className="relative h-full"
              style={{ width: leftColW + nCols * colW }}
            >
              {/* 左上の常時白い帯（横スクロール時も画面端に固定） */}
              <div
                ref={headerLeftOverlayRef}
                className="absolute inset-y-0 left-0 bg-white z-50 pointer-events-none"
                style={{
                  width: leftColW,
                  borderRight: '1px solid #e5e7eb',
                  boxShadow: scrolled.x ? '2px 0 6px -2px rgba(15,23,42,0.25)' : 'none',
                  willChange: 'transform',
                }}
                aria-hidden
              />

              {/* 時刻ラベル本体：左余白ぶんだけ右にずらして配置 */}
              <div
                className="absolute inset-y-0"
                style={{
                  left: leftColW,
                  width: nCols * colW,
                  height: headerH,
                  overflow: 'hidden',
                  backgroundImage: `repeating-linear-gradient(to right, rgba(17,24,39,0.035) 0, rgba(17,24,39,0.035) ${hourPx}px, transparent ${hourPx}px, transparent ${hourPx * 2}px)`,
                  zIndex: 2,
                }}
              >
                {/* Now indicator in header */}
                {nowMs >= range.startMs && nowMs <= range.endMs && (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none z-10"
                    style={{ left: `${((nowMs - anchorStartMs) / SLOT_MS) * colW}px`, zIndex: 5 }}
                  >
                    <div className="h-full border-l-2 border-red-500 opacity-70" />
                  </div>
                )}
                <TimelineHeader nCols={nCols} rangeStartMs={anchorStartMs} colW={colW} compact />
              </div>
            </div>
          </div>

          {/* 左レールの下地（空白対策 & 横線を左端まで） */}
          <div
            className="absolute z-[1] pointer-events-none select-none"
            style={{
              left: 0,
              top: headerH,
              width: leftColW,
              height: gridHeightPx,
              backgroundColor: '#f7f9fc',
            }}
            aria-hidden
          >
            <div className="absolute inset-0">
              {rowHeightsPx.map((h, i) => (
                <div key={i} style={{ height: h, borderBottom: '1px solid #e5e7eb' }} />
              ))}
            </div>
          </div>
          {/* 左の卓番号列（横スクロールしても左に固定。縦は内容と一緒にスクロール） */}
          <div
            className="sticky left-0 z-20 select-none"
            style={{
              top: headerH,
              width: leftColW,
              height: gridHeightPx,
              borderRight: '1px solid #cbd5e1',
              backgroundColor: '#f7f9fc',
            }}
          >
            <div className="absolute inset-0 pointer-events-none" aria-hidden>
              {rowHeightsPx.map((h, i) => (
                <div key={i} style={{ height: h, borderBottom: '1px solid #e5e7eb' }} />
              ))}
            </div>
            <div
              className="absolute top-0 bottom-0"
              style={{ left: -1, width: 2, backgroundColor: '#f7f9fc' }}
              aria-hidden
            />
            <div className="relative z-10">
              <TableRows tables={tables} rowHeightsPx={rowHeightsPx} />
            </div>
          </div>

          {/* 左上角のホワイト・マスク（横/縦スクロール時も常に空白を維持） */}
          <div
            className="sticky top-0 left-0 z-[110] bg-white border-b border-r pointer-events-none"
            style={{ width: leftColW, height: headerH }}
            aria-hidden
          />

          {/* タイムライン本体（予約・グリッド線） */}
          <DndContext sensors={sensors} modifiers={[restrictToParentElement]} onDragEnd={handleDragEnd}>
            <div
              className="absolute z-0"
              style={{
                left: leftColW,
                top: headerH,
                width: nCols * colW,
                height: gridHeightPx,
              }}
              onPointerDownCapture={() => setArmedId(null)}
              onClick={handleGridClick}
              aria-label="空きセルクリックレイヤー（本体）"
            >
              <div
                className="relative grid h-full w-full"
              style={{
                gridTemplateColumns: `repeat(${nCols}, ${colW}px)`,
                gridTemplateRows: rowHeightsPx.map(h => `${h}px`).join(' '),
                backgroundImage: `
                  repeating-linear-gradient(to right, #d1d5db 0, #d1d5db 1px, transparent 1px, transparent ${hourPx}px),
                  repeating-linear-gradient(to right, #e5e7eb 0, #e5e7eb 1px, transparent 1px, transparent ${minorSolidStepPx}px),
                  repeating-linear-gradient(to right, rgba(17,24,39,0.035) 0, rgba(17,24,39,0.035) ${hourPx}px, transparent ${hourPx}px, transparent ${hourPx * 2}px)
                `,
              }}
              >
                <ScheduleGrid nCols={nCols} colW={colW} rowHeights={rowHeightsPx} />

                {/* 15/45 分の破線（タブレットのみ） */}
                {isTablet && (
                  <DashedQuarterLines nCols={nCols} colW={colW} colsPerHour={colsPerHour} />
                )}

                {/* Now indicator */}
                {nowMs >= range.startMs && nowMs <= range.endMs && (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none z-[20]"
                    style={{ left: `${((nowMs - anchorStartMs) / SLOT_MS) * colW}px` }}
                  >
                    <div className="h-full border-l-2 border-red-500 opacity-70" />
                  </div>
                )}

                {/* 予約ブロック */}
                {stacked.map((it) => (
                  <ReservationBlock
                    key={`${it.id}_${it._row}`}
                    item={it}
                    row={it._row}
                    startCol={it._startCol}
                    spanCols={it._spanCols}
                    onClick={() => onCardTap(it)}
                    nowMs={nowMs}
                    armedId={armedId}
                    setArmedId={setArmedId}
                    stackCount={rowStackCount[String((it as any)._table ?? (it as any)._row)] ?? 1}
                    rowHeightPx={rowHeightsPx[(it as any)._row - 1] ?? effectiveRowH}
                  />
                ))}
                {/* --- ポップオーバーアクションメニュー --- */}
                {actionMenuOpen && actionTarget && actionBubble && (
                  <div
                    className="absolute z-[95]"
                    style={{
                      left: Math.max(4, Math.min(actionBubble.left, nCols * colW - 220)),
                      top: actionBubble.top,
                    }}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="card-action-popover"
                  >
                    <div className="relative rounded-lg border bg-white shadow-xl">
                      <div
                        className="absolute -top-2 right-6 w-0 h-0"
                        style={{ borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderBottom: '8px solid white' }}
                        aria-hidden
                      />
                      <div className="flex flex-col p-2 gap-1">
                        <button
                          type="button"
                          className="w-full rounded-md border px-3 py-2 text-left hover:bg-gray-50"
                          onClick={() => {
                            const sel = Array.isArray((actionTarget as any).tables) ? (actionTarget as any).tables.map(String) : [];
                            setReassign({
                              base: {
                                ...(actionTarget as any),
                                _startCol: Number((actionTarget as any)._startCol ?? 1),
                                _spanCols: Number((actionTarget as any)._spanCols ?? 1),
                              } as any,
                              selected: sel,
                              original: sel,
                            });
                            setActionMenuOpen(false);
                            setActionTarget(null);
                            setActionBubble(null);
                          }}
                        >
                          卓番変更
                        </button>
                        <button
                          type="button"
                          className="w-full rounded-md border px-3 py-2 text-left hover:bg-gray-50"
                          onClick={() => {
                            const target = actionTarget as any;
                            setActionMenuOpen(false);
                            setActionTarget(null);
                            setActionBubble(null);
                            openEditorFor(target);
                          }}
                        >
                          予約詳細変更
                        </button>
                        <button
                          type="button"
                          className="w-full rounded-md px-3 py-1 text-center text-gray-500 hover:bg-gray-50"
                          onClick={() => { setActionMenuOpen(false); setActionTarget(null); setActionBubble(null); }}
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </DndContext>
          {/* 卓番再割り当てオーバーレイ */}
          {reassign && (
            <div className="absolute inset-0 z-[80] bg-black/10">
              <div
                className="absolute"
                style={{
                  left: leftColW,
                  top: headerH,
                  width: nCols * colW,
                  height: gridHeightPx,
                }}
              >
                <div
                  className="relative grid h-full w-full"
                  style={{
                    gridTemplateColumns: `repeat(${nCols}, ${colW}px)`,
                    gridTemplateRows: rowHeightsPx.map(h => `${h}px`).join(' '),
                  }}
                >
                  {/* 対象予約の時間幅を全卓に灰色で敷き、選択した卓は青で強調 */}
                  {tables.map((t, idx) => {
                    const row = idx + 1;
                    const selected = reassign.selected.includes(String(t));
                    return (
                      <div
                        key={t}
                        onClick={() => {
                          setReassign(prev => {
                            if (!prev) return prev;
                            const s = new Set(prev.selected.map(String));
                            const key = String(t);
                            if (s.has(key)) s.delete(key); else s.add(key);
                            return { ...prev, selected: Array.from(s) };
                          });
                        }}
                        className="cursor-pointer"
                        style={{
                          gridColumn: `${reassign.base._startCol} / span ${reassign.base._spanCols}`,
                          gridRow: `${row} / span 1`,
                          // 色調整: 未選択は薄いエメラルド、選択は従来どおり薄いブルー
                          backgroundColor: selected ? 'rgba(59,130,246,0.18)' : 'rgba(110,231,183,0.18)',
                          outline: selected ? '2px dashed #2563eb' : '1px solid rgba(5,150,105,0.45)',
                          outlineOffset: '-1px',
                        }}
                        aria-label={`row-${t}`}
                      />
                    );
                  })}
                </div>

                {/* フッターボタン（画面下に固定） */}
                <div className="fixed left-0 right-0 bottom-0 z-[120] px-2 pb-[max(env(safe-area-inset-bottom),0px)] pt-2 pointer-events-none">
                  <div className="mx-auto max-w-screen-sm flex items-center justify-between gap-2 p-2 rounded-lg bg-white border shadow-lg pointer-events-auto">
                    <button
                      type="button"
                      onClick={() => setReassign(prev => prev ? { ...prev, selected: [...prev.original] } : prev)}
                      className="px-3 py-2 rounded bg-white border shadow-sm text-gray-700"
                    >
                      元に戻す
                    </button>

                    <div className="flex-1" />

                    <button
                      type="button"
                      onClick={() => setReassign(null)}
                      className="px-3 py-2 rounded bg-white border shadow-sm text-gray-700"
                    >
                      キャンセル
                    </button>

                    <button
                      type="button"
                      onClick={confirmReassign}
                      className="px-4 py-2 rounded bg-sky-600 text-white shadow"
                    >
                      決定
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ReservationEditorDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        reservationId={editing?.id ?? undefined}
        initial={editing?.initial}
        tablesOptions={tablesOptions ?? tables}
        coursesOptions={coursesOptions}
        eatOptions={eatOptionsList}
        drinkOptions={drinkOptionsList}
        dayStartMs={day0} // ドロワーには当日0:00を渡す（表示範囲の開始時刻ではなく）
        onSave={onSave}
        onDelete={onDelete}
      />
      <style jsx global>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

// ===== 内部ミニコンポーネント（将来分割しやすいように同ファイル内に定義） =====
// 15/45分の破線オーバーレイ（タブレットのみ使用）
function DashedQuarterLines({
  nCols,
  colW,
  colsPerHour,
}: {
  nCols: number;
  colW: number;
  colsPerHour: number;
}) {
  // 15分（1/4）と45分（3/4）の位置に破線を引く
  const quarter = Math.round(colsPerHour / 4);           // 15分 = 3スロット（5分スロット基準）
  const threeQuarter = Math.round((3 * colsPerHour) / 4); // 45分 = 9スロット
  const hours = Math.ceil(nCols / colsPerHour);

  const positions: number[] = [];
  for (let h = 0; h < hours; h++) {
    positions.push((h * colsPerHour + quarter) * colW);
    positions.push((h * colsPerHour + threeQuarter) * colW);
  }

  return (
    <div className="absolute inset-0 pointer-events-none">
      {positions.map((x, i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0 border-l border-gray-300"
          style={{ left: x, borderLeftStyle: 'dashed', opacity: 0.9 }}
        />
      ))}
    </div>
  );
}


function TimelineHeader({ nCols, rangeStartMs, colW, compact = false }: { nCols: number; rangeStartMs: number; colW: number; compact?: boolean; }) {
  const hours = useMemo(() => {
    const out: { label: string; colStart: number }[] = [];
    const colsPerHour = Math.round((60 * 60 * 1000) / SLOT_MS); // 12
    const startHour = new Date(rangeStartMs).getHours();
    for (let i = 0; i <= Math.floor(nCols / colsPerHour); i++) {
      const h = (startHour + i) % 24;
      out.push({ label: `${h}:00`, colStart: 1 + i * colsPerHour });
    }
    return out;
  }, [nCols, rangeStartMs]);

  return (
    <div
      className="relative grid select-none"
      style={{
        gridTemplateColumns: `repeat(${nCols}, ${colW}px)`,
        backgroundColor: 'transparent',
      }}
    >
      {/* 時刻ラベル（毎時） */}
      {hours.map(h => (
        <div
          key={h.colStart}
          className="flex items-center text-base font-semibold text-gray-800 px-1"
          style={{ gridColumn: `${h.colStart} / span ${Math.round(60 * 60 * 1000 / SLOT_MS)}` }}
        >
          {h.label}
        </div>
      ))}
    </div>
  );
}

function TableRows({ tables, rowHeightsPx }: { tables: string[]; rowHeightsPx: number[] }) {
  return (
    <div className="flex flex-col">
      {tables.map((t, i) => (
        <div
          key={t}
          className="whitespace-nowrap overflow-hidden text-ellipsis px-2 flex items-center justify-center text-gray-700 font-medium"
          style={{ height: rowHeightsPx[i] ?? rowHeightsPx[0] ?? 44, boxSizing: 'border-box' }}
        >
          <span className="text-sm">{t}</span>
        </div>
      ))}
    </div>
  );
}

function ScheduleGrid({ nCols, colW, rowHeights }: { nCols: number; colW: number; rowHeights: number[] }) {
  // 縦線は親の background で描画。ここでは横線のみ（可変行高対応）。
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div className="absolute top-0 left-0 right-0 border-t border-gray-200" />
      <div className="absolute inset-0">
        {rowHeights.map((h, i) => (
          <div key={i} style={{ height: h, borderBottom: '1px solid #e5e7eb' }} />
        ))}
      </div>
    </div>
  );
}

function ReservationBlock({
  item, row, startCol, spanCols, onClick, nowMs, armedId, setArmedId, stackCount, rowHeightPx,
}: {
  item: ScheduleItem & { status?: 'normal' | 'warn'; _table?: string; _key?: string };
  row: number;
  startCol: number;
  spanCols: number;
  onClick?: () => void;
  nowMs?: number;
  armedId: string | null;
  setArmedId: (id: string | null) => void;
  stackCount: number;
  rowHeightPx: number;
}) {
  const warn = item.status === 'warn';
  const baseId = String(item.id ?? item._key ?? `tmp_${row}_${startCol}`);
  const tableToken = String(item._table ?? row);
  const blockKey = `${baseId}::${tableToken}`;
  const borderColor = warn ? '#a13e18' : '#1f6b8d';
  const textAccent = warn ? '#7b3416' : '#134e6b';

  // 長押し判定
  const LONG_PRESS_MS = 900;
  const MOVE_TOLERANCE_PX = 8;
  const pressRef = React.useRef<{ x: number; y: number; tid: number | null }>({ x: 0, y: 0, tid: null });
  const isArmed = armedId === baseId;

  const guestsRaw = (item as any).people ?? (item as any).guests;
  const guests = typeof guestsRaw === 'number' ? guestsRaw : Number(guestsRaw);
  const guestsLabel = Number.isFinite(guests) && guests > 0 ? `${guests}名` : '';
  const nameRaw = ((item as any).name ?? '').toString().trim();
  const name = nameRaw.length > 0 ? nameRaw : '';
  const course = ((item as any).course ?? '').toString().trim();
  const startLabel = fmtTime(item.startMs);

  const raw = item as any;
  const extractLabel = (value: any): string => {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(extractLabel).filter(Boolean).join(',');
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    return String(value ?? '').trim();
  };

  const drinkLabel = extractLabel(
    raw?.drinkLabel
      ?? raw?.drinkOption
      ?? (typeof raw?.drink === 'string' ? raw.drink : undefined)
      ?? raw?.meta?.drinkLabel
      ?? raw?.reservation?.drinkLabel
      ?? (typeof raw?.meta?.drink === 'string' ? raw.meta.drink : undefined)
      ?? (typeof raw?.reservation?.drink === 'string' ? raw.reservation.drink : undefined)
  );
  const eatLabel = extractLabel(
    raw?.eatLabel
      ?? raw?.eatOption
      ?? (typeof raw?.eat === 'string' ? raw.eat : undefined)
      ?? raw?.meta?.eatLabel
      ?? raw?.reservation?.eatLabel
      ?? (typeof raw?.meta?.eat === 'string' ? raw.meta.eat : undefined)
      ?? (typeof raw?.reservation?.eat === 'string' ? raw.reservation.eat : undefined)
  );

  const showDrink = Boolean(drinkLabel || raw?.drink || raw?.meta?.drink || raw?.reservation?.drink);
  const showEat = Boolean(eatLabel || raw?.eat || raw?.meta?.eat || raw?.reservation?.eat);
  const extrasLabel = [drinkLabel, eatLabel, course].filter(Boolean).join(' / ');

  // ★ 武装中のみドラッグ有効化（リサイズは廃止）
  const dragDisabled = !isArmed;
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: `move:${blockKey}`, disabled: dragDisabled });

  const stackIndex = Number((item as any)._stackIndex ?? 0);
  const layers = Math.max(1, Number(stackCount || 1));
  const rowH = Math.max(1, Number(rowHeightPx || 1));
  const perLayerH = Math.max(1, Math.floor(rowH / layers));

  const tx = Math.round((transform?.x ?? 0));
  const ty = Math.round((transform?.y ?? 0) + stackIndex * perLayerH);
  const translate = (tx || ty) ? `translate3d(${tx}px, ${ty}px, 0)` : undefined;

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    // 武装中はエディタを開かない
    if (isArmed) return;
    onClick?.();
  }, [onClick, isArmed]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (isArmed) return;
      onClick();
    }
  }, [onClick, isArmed]);

  const freshUntil = (item as any).freshUntilMs;
  const isFresh = Number.isFinite(Number(freshUntil)) && (nowMs ?? 0) <= Number(freshUntil);
  const editedUntil = (item as any).editedUntilMs;
  const isEdited = Number.isFinite(Number(editedUntil)) && (nowMs ?? 0) <= Number(editedUntil);

  return (
    <div
      ref={setNodeRef}
      className="relative z-10 h-full w-full select-none pointer-events-auto"
      style={{
        gridColumn: `${startCol} / span ${spanCols}`,
        gridRow: `${row} / span 1`,
        transform: translate,
        paddingTop: 3,
        paddingBottom: 3,
        height: perLayerH,
      }}
      title={`${guestsLabel} ${name}${course ? ` / ${course}` : ''}${extrasLabel ? ` / ${extrasLabel}` : ''}`}
      onClick={handleClick}
      // 長押しで「武装」→ドラッグ可能にする
      onPointerDown={(e) => {
        e.stopPropagation();
        try { if (pressRef.current.tid) window.clearTimeout(pressRef.current.tid as number); } catch {}
        pressRef.current.x = (e as any).clientX ?? 0;
        pressRef.current.y = (e as any).clientY ?? 0;
        pressRef.current.tid = window.setTimeout(() => {
          setArmedId(baseId);
          pressRef.current.tid = null;
          try { (navigator as any).vibrate?.(10); } catch {}
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e) => {
        const dx = Math.abs(((e as any).clientX ?? 0) - pressRef.current.x);
        const dy = Math.abs(((e as any).clientY ?? 0) - pressRef.current.y);
        if (pressRef.current.tid != null && (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX)) {
          try { window.clearTimeout(pressRef.current.tid as number); } catch {}
          pressRef.current.tid = null;
        }
      }}
      onPointerUp={() => {
        if (pressRef.current.tid != null) {
          try { window.clearTimeout(pressRef.current.tid as number); } catch {}
          pressRef.current.tid = null;
        }
      }}
      onPointerCancel={() => {
        if (pressRef.current.tid != null) {
          try { window.clearTimeout(pressRef.current.tid as number); } catch {}
          pressRef.current.tid = null;
        }
      }}
      role="button"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div
        className={`relative flex h-full w-full flex-col justify-between rounded-[6px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.1)] ${isArmed ? 'ring-2 ring-sky-400' : ''}`}
        style={{
          margin: '0px',
          // バッジ分の余白を右側に確保（被り回避）
          padding: warn ? '6px 44px 6px 10px' : '6px 10px 6px',
          border: `3px solid ${borderColor}`,
        }}
        {...attributes}
        {...listeners}
      >
        {(isEdited || isFresh) && (
          <span className={`absolute -top-1 -left-1 h-2.5 w-2.5 rounded-full ring-2 ring-white ${isEdited ? 'bg-amber-500' : 'bg-green-500'}`} />
        )}
        <div className="grid h-full grid-rows-[auto_1fr_auto] text-[12px] text-slate-700">
          <div className="flex items-center justify-between text-[12px] font-semibold" style={{ color: textAccent }}>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] tracking-tight">{startLabel}</span>
              <span className="font-mono text-[12px] tracking-tight" aria-label="人数">
                {guestsLabel || '―'}
              </span>
            </div>
            <div className="flex gap-1 text-[11px] text-slate-500">
              {showEat && <span className="rounded-sm border border-slate-400 px-1 leading-tight whitespace-nowrap">{eatLabel || '食放'}</span>}
              {showDrink && <span className="rounded-sm border border-slate-400 px-1 leading-tight whitespace-nowrap">{drinkLabel || '飲放'}</span>}
            </div>
          </div>
          <div className="flex items-center justify-center overflow-hidden" aria-hidden />
          <div className="flex items-end justify-between text-[11px] text-slate-600">
            <span className="font-medium truncate max-w-[60%]" aria-label="氏名">{name}</span>
            <span className="truncate text-right text-[11px] text-slate-600">{course}</span>
          </div>
        </div>

        {warn && (
          <div className="absolute right-2 top-2 inline-flex items-center rounded-full bg-amber-400 px-2 py-px text-[10px] font-semibold text-white">
            注意
          </div>
        )}
      </div>
    </div>
  );
}

function fmtTime(ms: number) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export { ScheduleView };
