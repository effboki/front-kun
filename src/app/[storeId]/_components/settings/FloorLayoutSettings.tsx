'use client';

import { useCallback, useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react';
import type { AreaDef } from '@/types';

type SeatOrientation = 'horizontal' | 'vertical';
type SeatMode = 'both' | 'single';
type SeatSide = 'top' | 'bottom' | 'left' | 'right';
type SeatConfig = { orientation: SeatOrientation; mode: SeatMode; side?: SeatSide };
type LayoutEntry = {
  x: number;
  y: number;
  w: number;
  h: number;
  areaId?: string;
  kind?: 'table' | 'fixture';
  label?: string;
  fixtureType?: string;
  seat?: SeatConfig;
};
export type FloorLayoutMap = Record<string, LayoutEntry>;

type Props = {
  tables: string[];
  areas: AreaDef[];
  layout?: FloorLayoutMap | null;
  tableCapacities?: Record<string, number | string>;
  onChangeLayout: (layout: FloorLayoutMap) => void;
  onChangeTablesAreas: (tables: string[], areas: AreaDef[]) => void;
  storeId?: string;
};

const normalizeTableId = (v?: unknown) => String(v ?? '').trim();
const serializeLayout = (map?: FloorLayoutMap | null) => {
  const obj = map ?? {};
  const sortedKeys = Object.keys(obj).sort();
  const sorted: Record<string, unknown> = {};
  sortedKeys.forEach((k) => { sorted[k] = obj[k]; });
  return JSON.stringify(sorted);
};
const layoutsEqual = (a?: FloorLayoutMap | null, b?: FloorLayoutMap | null) => serializeLayout(a) === serializeLayout(b);
const TABLE_W = 105;
const TABLE_H = 90;
const LEGACY_TABLE_SIZES = [
  { w: 90, h: 90 },
  { w: 100, h: 90 },
  { w: 100, h: 100 },
  { w: 110, h: 110 },
];

const normalizeTableSize = (w?: number, h?: number): { w: number; h: number } => {
  const nw = Number(w);
  const nh = Number(h);
  const hasValid = Number.isFinite(nw) && nw > 0 && Number.isFinite(nh) && nh > 0;
  if (hasValid && !LEGACY_TABLE_SIZES.some((s) => s.w === nw && s.h === nh)) {
    return { w: nw, h: nh };
  }
  return { w: TABLE_W, h: TABLE_H };
};

const normalizeSeatConfig = (seat?: Partial<SeatConfig>): SeatConfig => {
  const orientation: SeatOrientation = seat?.orientation === 'vertical' ? 'vertical' : 'horizontal';
  const mode: SeatMode = seat?.mode === 'single' ? 'single' : 'both';
  let side: SeatSide | undefined = seat?.side;
  if (mode === 'single') {
    if (orientation === 'horizontal') {
      side = side === 'bottom' ? 'bottom' : 'top';
    } else {
      side = side === 'right' ? 'right' : 'left';
    }
  } else {
    side = undefined;
  }
  return { orientation, mode, ...(side ? { side } : {}) };
};

const buildAutoLayout = (areas: AreaDef[]): FloorLayoutMap => {
  const layout: FloorLayoutMap = {};
  const CELL_W = TABLE_W;
  const CELL_H = TABLE_H;
  const GAP = 16;
  areas.forEach((area) => {
    (area.tables ?? []).forEach((t, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const x = GAP + col * (CELL_W + GAP);
      const y = GAP + row * (CELL_H + GAP);
      layout[normalizeTableId(t)] = { x, y, w: CELL_W, h: CELL_H, areaId: area.id, kind: 'table' };
    });
  });
  return layout;
};

export default function FloorLayoutSettings({ tables, areas, layout, tableCapacities, onChangeLayout, onChangeTablesAreas, storeId }: Props) {
  const cleanTables = useMemo(() => Array.from(new Set((tables ?? []).map(normalizeTableId).filter(Boolean))), [tables]);
  const tableCapMap = useMemo<Record<string, number>>(() => {
    const source = tableCapacities || {};
    const map: Record<string, number> = {};
    Object.entries(source || {}).forEach(([k, v]) => {
      const num = Number(v);
      if (Number.isFinite(num) && num > 0) map[normalizeTableId(k)] = Math.round(num);
    });
    return map;
  }, [tableCapacities]);
  const areaSections = useMemo<AreaDef[]>(() => {
    const list = Array.isArray(areas) && areas.length > 0
      ? areas.map((a) => ({
          ...a,
          tables: (a.tables ?? [])
            .map(normalizeTableId)
            .filter((t) => t && cleanTables.includes(t)),
        }))
      : [{ id: '__default', name: 'フロア', tables: cleanTables }];
    const assigned = new Set<string>();
    list.forEach((a) => a.tables.forEach((t) => assigned.add(t)));
    const leftover = cleanTables.filter((t) => !assigned.has(t));
    if (leftover.length > 0) list.push({ id: '__unassigned', name: '未割当', tables: leftover });
    return list;
  }, [areas, cleanTables]);

  const [removedFixtures, setRemovedFixtures] = useState<string[]>([]);

  const normalizeLayout = useCallback((input?: FloorLayoutMap | null): FloorLayoutMap => {
    const tablesSet = new Set(cleanTables);
    const areaMap = new Map<string, string>();
    areaSections.forEach((a) => a.tables.forEach((t) => areaMap.set(t, a.id)));
    const normalized: FloorLayoutMap = {};
    if (input && Object.keys(input).length > 0) {
      Object.entries(input).forEach(([k, rect]) => {
        if (removedFixtures.includes(k)) return;
        const isFixture = rect.kind === 'fixture';
        if (!isFixture && !tablesSet.has(k)) return;
        const areaId = areaMap.get(k) ?? rect.areaId ?? '__unassigned';
        const kind: LayoutEntry['kind'] = isFixture ? 'fixture' : 'table';
        const label = rect.label && rect.label !== rect.fixtureType ? rect.label : undefined;
        const size = kind === 'table' ? normalizeTableSize(rect.w as number, rect.h as number) : {};
        normalized[k] = { ...rect, areaId, kind, ...(label ? { label } : {}), ...size };
      });
    }
    // ensure every table exists
    cleanTables.forEach((t) => {
      if (!normalized[t]) {
        const auto = buildAutoLayout(areaSections);
        normalized[t] = auto[t] ?? { x: 20, y: 20, w: TABLE_W, h: TABLE_H, areaId: areaMap.get(t) ?? '__unassigned', kind: 'table' };
      }
    });
    return Object.keys(normalized).length > 0 ? normalized : buildAutoLayout(areaSections);
  }, [cleanTables, areaSections, buildAutoLayout, removedFixtures]);

  const initialLayout = useMemo<FloorLayoutMap>(() => normalizeLayout(layout), [layout, normalizeLayout]);

  const [localLayout, setLocalLayout] = useState<FloorLayoutMap>(initialLayout);
  const keySuffix = storeId ? `-${storeId}` : '';
  const editModeKey = useMemo(() => `fk-floorlayout-edit${keySuffix}`, [keySuffix]);
  const previewModeKey = useMemo(() => `fk-floorlayout-preview${keySuffix}`, [keySuffix]);
  const zoomKey = useMemo(() => `fk-floorlayout-zoom${keySuffix}`, [keySuffix]);
  const [editMode, setEditMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (localStorage.getItem(editModeKey) ?? '0') === '1';
  });
  const [zoom, setZoom] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    const raw = localStorage.getItem(zoomKey);
    const num = raw ? Number(raw) : NaN;
    if (Number.isFinite(num) && num > 0.1 && num <= 3) return num;
    return 1;
  });
  const zoomIn = useCallback(() => setZoom((v) => Math.min(1.5, Math.round((v + 0.1) * 10) / 10)), []);
  const zoomOut = useCallback(() => setZoom((v) => Math.max(0.2, Math.round((v - 0.1) * 10) / 10)), []);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const layoutRef = useRef<FloorLayoutMap>(initialLayout);
  const [tableEditor, setTableEditor] = useState<{ mode: 'add' | 'rename'; target?: string; value: string; areaId?: string } | null>(null);
  const longPressRef = useRef<{ tid: number | null; x: number; y: number; target?: string }>({ tid: null, x: 0, y: 0, target: undefined });
  const editModeRef = useRef(false);
  const [previewMode, setPreviewMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (localStorage.getItem(previewModeKey) ?? '0') === '1';
  });
  const scrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollPosRef = useRef<Record<string, number>>({});
  const rememberScrollPositions = useCallback(() => {
    Object.entries(scrollRefs.current).forEach(([areaId, el]) => {
      if (!el) return;
      scrollPosRef.current[areaId] = el.scrollLeft;
    });
  }, []);
  const restoreScrollPositions = useCallback(() => {
    Object.entries(scrollRefs.current).forEach(([areaId, el]) => {
      if (!el) return;
      const pos = scrollPosRef.current[areaId];
      if (pos != null) el.scrollLeft = pos;
    });
  }, []);
  const [fixtureType, setFixtureType] = useState<string>('entrance');
  const [selectedFixture, setSelectedFixture] = useState<string | null>(null);
  const [fixtureAreaId, setFixtureAreaId] = useState<string>(() => areaSections[0]?.id || '__default');
  const [openSeatMenu, setOpenSeatMenu] = useState<string | null>(null);
  const getSeat = useCallback((entry?: LayoutEntry | null) => normalizeSeatConfig(entry?.seat), []);
  const emitLayoutChange = useCallback(
    (next: FloorLayoutMap) => {
      Promise.resolve().then(() => onChangeLayout(next));
    },
    [onChangeLayout]
  );
  const enqueueLayoutChange = useCallback(
    (next: FloorLayoutMap) => {
      queueMicrotask(() => emitLayoutChange(next));
    },
    [emitLayoutChange]
  );

  const updateSeatConfig = useCallback(
    (tableId: string, mutator: (seat: SeatConfig) => SeatConfig) => {
      setLocalLayout((prev) => {
        const current = prev[tableId] ?? { x: 16, y: 16, w: TABLE_W, h: TABLE_H, areaId: areaSections[0]?.id, kind: 'table' };
        const nextSeat = mutator(getSeat(current));
        const next: FloorLayoutMap = { ...prev, [tableId]: { ...current, seat: nextSeat } };
        layoutRef.current = next;
        enqueueLayoutChange(next);
        return next;
      });
    },
    [areaSections, getSeat, enqueueLayoutChange]
  );

  const resetAllTableSizes = useCallback(() => {
    setLocalLayout((prev) => {
      const next: FloorLayoutMap = {};
      Object.entries(prev).forEach(([id, rect]) => {
        if (rect.kind === 'fixture') {
          next[id] = rect;
        } else {
          next[id] = { ...rect, w: TABLE_W, h: TABLE_H };
        }
      });
      layoutRef.current = next;
      enqueueLayoutChange(next);
      return next;
    });
  }, [enqueueLayoutChange]);

  // keep selected area valid when areas change
  useEffect(() => {
    const exists = areaSections.some((a) => a.id === fixtureAreaId);
    if (!exists) {
      setFixtureAreaId(areaSections[0]?.id || '__default');
    }
  }, [areaSections, fixtureAreaId]);
  useEffect(() => {
    if (!editMode) setOpenSeatMenu(null);
  }, [editMode]);

  const fixtureStyleMap: Record<string, { label: string; bg: string; border: string; icon: string; shape?: 'rounded' | 'pill' }> = {
    entrance: { label: '入口', bg: 'bg-emerald-50', border: 'border-emerald-300', icon: '入口', shape: 'pill' },
    stairs: { label: '階段', bg: 'bg-amber-50', border: 'border-amber-300', icon: '階段', shape: 'rounded' },
    station: { label: 'ステーション', bg: 'bg-sky-50', border: 'border-sky-300', icon: 'ステーション', shape: 'rounded' },
    drink: { label: 'ドリ場', bg: 'bg-indigo-50', border: 'border-indigo-300', icon: 'ドリ場', shape: 'rounded' },
    kitchen: { label: 'キッチン', bg: 'bg-orange-50', border: 'border-orange-300', icon: 'キッチン', shape: 'rounded' },
    register: { label: 'レジ', bg: 'bg-rose-50', border: 'border-rose-300', icon: 'レジ', shape: 'rounded' },
    other: { label: '設備', bg: 'bg-slate-50', border: 'border-slate-300', icon: '設備', shape: 'rounded' },
  };

  useEffect(() => {
    editModeRef.current = editMode;
    if (typeof window !== 'undefined') {
      localStorage.setItem(editModeKey, editMode ? '1' : '0');
    }
  }, [editMode, editModeKey]);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(previewModeKey, previewMode ? '1' : '0');
    }
  }, [previewMode, previewModeKey]);
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(zoomKey, String(zoom));
    } catch {
      /* ignore */
    }
  }, [zoom, zoomKey]);

  const saveLayout = useCallback((next: FloorLayoutMap) => {
    rememberScrollPositions();
    setLocalLayout(next);
    layoutRef.current = next;
    enqueueLayoutChange(next);
  }, [enqueueLayoutChange, rememberScrollPositions]);

  useEffect(() => {
    rememberScrollPositions();
    const normalized = normalizeLayout(layout);
    setLocalLayout(normalized);
    layoutRef.current = normalized;
    setSelectedFixture(null);
    if (!layoutsEqual(normalized, layout)) {
      emitLayoutChange(normalized);
    }
    restoreScrollPositions();
  }, [layout, normalizeLayout, emitLayoutChange, restoreScrollPositions, rememberScrollPositions]);
  useLayoutEffect(() => {
    restoreScrollPositions();
  }, [localLayout, zoom, restoreScrollPositions]);

  const handleAddOrRename = useCallback((closeAfter = true) => {
    if (!tableEditor) return;
    const mode = tableEditor.mode;
    const target = normalizeTableId(tableEditor.target);
    const nextId = normalizeTableId(tableEditor.value);
    const areaId = tableEditor.areaId || areaSections[0]?.id || '__default';
    if (!nextId) return;
    let nextTables = [...cleanTables];
    let nextAreas = areaSections.map((a) => ({ ...a, tables: [...a.tables] }));
    if (mode === 'add') {
      if (nextTables.includes(nextId)) {
        if (closeAfter) setTableEditor(null);
        return;
      }
      nextTables.push(nextId);
      nextAreas = nextAreas.map((a) => a.id === areaId ? { ...a, tables: Array.from(new Set([...a.tables, nextId])) } : a);
      setLocalLayout((prev) => {
        const auto = buildAutoLayout(nextAreas);
        const rect = auto[nextId] ?? { x: 20, y: 20, w: TABLE_W, h: TABLE_H, areaId, kind: 'table' };
        const merged = { ...prev, [nextId]: rect };
        layoutRef.current = merged;
        return merged;
      });
    } else {
      if (!target || nextTables.includes(nextId)) {
        if (closeAfter) setTableEditor(null);
        return;
      }
      nextTables = nextTables.map((t) => (t === target ? nextId : t));
      nextAreas = nextAreas.map((a) => {
        let tlist = a.tables.map((t) => (t === target ? nextId : t));
        if (a.id === areaId && !tlist.includes(nextId)) tlist = [...tlist, nextId];
        if (a.id !== areaId) tlist = tlist.filter((t) => t !== nextId && t !== target);
        return { ...a, tables: tlist };
      });
      setLocalLayout((prev) => {
        const current = prev[target];
        const rect: LayoutEntry = current
          ? { ...current, areaId, kind: 'table' }
          : { x: 20, y: 20, w: TABLE_W, h: TABLE_H, areaId, kind: 'table' };
        const next: FloorLayoutMap = { ...prev };
        delete next[target];
        next[nextId] = rect;
        layoutRef.current = next;
        return next;
      });
    }
    onChangeTablesAreas(nextTables, nextAreas);
    if (closeAfter) {
      setTableEditor(null);
    } else {
      setTableEditor((prev) => prev ? { ...prev, target: mode === 'add' ? undefined : nextId, value: mode === 'add' ? '' : nextId, areaId } : prev);
    }
  }, [tableEditor, cleanTables, areaSections, onChangeTablesAreas, buildAutoLayout]);

  // keep edit mode alive across layout updates caused by saves
  useEffect(() => {
    if (editModeRef.current) setEditMode(true);
  }, [localLayout]);

  const areaByTable = useMemo(() => {
    const map: Record<string, string> = {};
    areaSections.forEach((a) => a.tables.forEach((t) => { if (!map[t]) map[t] = a.id; }));
    return map;
  }, [areaSections]);

  const CHAIR_LONG = 26;
  const CHAIR_SHORT = 12;
  const CHAIR_OUTSET = 1; // small overlap to visually attach to table
  const LABEL_PAD_Y = 10;
  const computeChairs = useCallback(
    (capacity: number, rect: LayoutEntry): { cx: number; cy: number; side: SeatSide }[] => {
      const seat = getSeat(rect);
      const chairs: { cx: number; cy: number; side: SeatSide }[] = [];
      if (!Number.isFinite(capacity) || capacity <= 0) return chairs;
      const topY = -(CHAIR_SHORT / 2) + CHAIR_OUTSET;
      const bottomY = rect.h + (CHAIR_SHORT / 2) - CHAIR_OUTSET;
      const leftX = -(CHAIR_SHORT / 2) + CHAIR_OUTSET;
      const rightX = rect.w + (CHAIR_SHORT / 2) - CHAIR_OUTSET;
      if (seat.mode === 'both') {
        if (seat.orientation === 'horizontal') {
          const topCount = Math.ceil(capacity / 2);
          const bottomCount = capacity - topCount;
          for (let i = 0; i < topCount; i++) {
            chairs.push({ cx: ((i + 1) / (topCount + 1)) * rect.w, cy: topY, side: 'top' });
          }
          for (let i = 0; i < bottomCount; i++) {
            chairs.push({ cx: ((i + 1) / (bottomCount + 1)) * rect.w, cy: bottomY, side: 'bottom' });
          }
        } else {
          const leftCount = Math.ceil(capacity / 2);
          const rightCount = capacity - leftCount;
          for (let i = 0; i < leftCount; i++) {
            chairs.push({ cx: leftX, cy: ((i + 1) / (leftCount + 1)) * rect.h, side: 'left' });
          }
          for (let i = 0; i < rightCount; i++) {
            chairs.push({ cx: rightX, cy: ((i + 1) / (rightCount + 1)) * rect.h, side: 'right' });
          }
        }
      } else {
        const side = seat.side ?? (seat.orientation === 'horizontal' ? 'top' : 'left');
        if (side === 'top' || side === 'bottom') {
          const y = side === 'top' ? topY : bottomY;
          for (let i = 0; i < capacity; i++) {
            chairs.push({ cx: ((i + 1) / (capacity + 1)) * rect.w, cy: y, side });
          }
        } else {
          const x = side === 'left' ? leftX : rightX;
          for (let i = 0; i < capacity; i++) {
            chairs.push({ cx: x, cy: ((i + 1) / (capacity + 1)) * rect.h, side });
          }
        }
      }
      return chairs;
    },
    [getSeat]
  );

  const getAreaBounds = useCallback((tableIds: string[], fallbackAreaId?: string) => {
    const PADDING = 60;
    let maxX = 0;
    let maxY = 0;
    tableIds.forEach((tid) => {
      const rect = localLayout[tid] ?? { x: 16, y: 16, w: TABLE_W, h: TABLE_H, areaId: fallbackAreaId };
      if (!rect) return;
      maxX = Math.max(maxX, rect.x + rect.w);
      maxY = Math.max(maxY, rect.y + rect.h);
    });
    const width = Math.max(maxX + PADDING, 360);
    const height = Math.max(maxY + PADDING, 320);
    return { width, height, areaId: fallbackAreaId };
  }, [localLayout]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={`px-3 py-2 rounded border text-sm font-semibold ${editMode ? 'bg-amber-100 border-amber-400 text-amber-800' : 'bg-white border-slate-300 text-slate-700'}`}
          onClick={() => setEditMode((v) => !v)}
        >
          {editMode ? 'レイアウト編集中' : 'レイアウト編集'}
        </button>
        <button
          type="button"
          className={`px-3 py-2 rounded border text-sm font-semibold ${previewMode ? 'bg-sky-100 border-sky-400 text-sky-800' : 'bg-white border-slate-300 text-slate-700'}`}
          onClick={() => setPreviewMode((v) => !v)}
        >
          {previewMode ? 'プレビュー中' : 'プレビュー'}
        </button>
        <div className="flex items-center gap-1 text-sm text-slate-600">
          <button
            type="button"
            className="rounded border px-2 py-[6px] hover:bg-slate-50"
            onClick={zoomOut}
            aria-label="ズームアウト"
          >
            −
          </button>
          <span className="min-w-[48px] text-center font-semibold">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="rounded border px-2 py-[6px] hover:bg-slate-50"
            onClick={zoomIn}
            aria-label="ズームイン"
          >
            ＋
          </button>
        </div>
        {editMode && (
          <button
            type="button"
            className="px-3 py-2 rounded border text-sm text-slate-700 bg-white hover:bg-slate-50"
            onClick={resetAllTableSizes}
            title="全テーブルのサイズを105x90に戻す"
          >
            すべての卓サイズを初期化
          </button>
        )}
        <div className="flex items-center gap-2 text-sm">
          <label className="text-slate-600">設備を追加:</label>
          <select
            className="rounded border px-2 py-1 text-sm"
            value={fixtureType}
            onChange={(e) => setFixtureType(e.target.value)}
          >
            <option value="entrance">入口</option>
            <option value="stairs">階段</option>
            <option value="station">ステーション</option>
            <option value="drink">ドリ場</option>
            <option value="kitchen">キッチン</option>
            <option value="register">レジ</option>
            <option value="other">その他</option>
          </select>
          <select
            className="rounded border px-2 py-1 text-sm"
            value={fixtureAreaId}
            onChange={(e) => setFixtureAreaId(e.target.value)}
            title="設置するフロア/エリア"
          >
            {areaSections.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="px-3 py-2 rounded border text-sm text-slate-700 bg-white hover:bg-slate-50"
            onClick={() => {
              const id = `fixture-${fixtureType}-${Date.now()}`;
              const areaId = fixtureAreaId || areaSections[0]?.id || '__default';
              const style = fixtureStyleMap[fixtureType] ?? fixtureStyleMap.other;
              const rect: LayoutEntry = { x: 24, y: 24, w: 120, h: 90, areaId, kind: 'fixture', label: style.label, fixtureType };
              const next = { ...layoutRef.current, [id]: rect };
              layoutRef.current = next;
              setLocalLayout(next);
              enqueueLayoutChange(next);
            }}
          >
            追加
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {areaSections.map((area) => {
          const tablesInArea = area.tables.filter((t) => cleanTables.includes(t));
          const fixturesInArea = Object.entries(localLayout).filter(([id, rect]) => rect.kind === 'fixture' && (rect.areaId ?? area.id) === area.id);
          const areaLayout = tablesInArea.reduce<Record<string, LayoutEntry>>((acc, t) => {
            const rect = localLayout[t] ?? { x: 16, y: 16, w: TABLE_W, h: TABLE_H, areaId: area.id };
            acc[t] = rect;
            return acc;
          }, {});

          const areaHandleDrag = (tableId: string, mode: 'move' | 'resize') => (e: React.PointerEvent<HTMLDivElement>) => {
            if (!editMode) return;
            rememberScrollPositions();
            const startX = e.clientX;
            const startY = e.clientY;
            const startRect = areaLayout[tableId] ?? localLayout[tableId];
            if (!startRect) return;
            (e.currentTarget as any).setPointerCapture?.(e.pointerId);
            const SNAP = 8;
            const others = Object.entries(areaLayout)
              .filter(([k]) => k !== tableId)
              .map(([, rect]) => rect);

            const snapVal = (val: number, arr: number[]) => {
              let best: number | undefined;
              let delta = SNAP + 1;
              arr.forEach((t) => {
                const d = Math.abs(val - t);
                if (d <= SNAP && d < delta) { delta = d; best = t; }
              });
              return best;
            };

            const computeSnap = (candidate: LayoutEntry) => {
              let { x, y, w, h } = candidate;
              let gx: number | undefined;
              let gy: number | undefined;
              const edgesX = others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w]);
              const edgesY = others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h]);
              const sl = snapVal(x, edgesX); if (sl != null) { gx = sl; x = sl; }
              const st = snapVal(y, edgesY); if (st != null) { gy = st; y = st; }
              const sr = snapVal(x + w, edgesX); if (sr != null) { const nw = Math.max(80, sr - x); w = nw; gx = sr; }
              const sb = snapVal(y + h, edgesY); if (sb != null) { const nh = Math.max(80, sb - y); h = nh; gy = sb; }
              return { rect: { ...candidate, x, y, w, h, areaId: area.id }, guideX: gx, guideY: gy };
            };

            const onMove = (ev: PointerEvent) => {
              const dx = (ev.clientX - startX) / zoom;
              const dy = (ev.clientY - startY) / zoom;
              let next: LayoutEntry = { ...startRect };
              if (mode === 'move') {
                next.x = Math.max(0, startRect.x + dx);
                next.y = Math.max(0, startRect.y + dy);
              } else {
                next.w = Math.max(80, startRect.w + dx);
                next.h = Math.max(80, startRect.h + dy);
              }
              const snapped = computeSnap(next);
              setGuides({ x: snapped.guideX, y: snapped.guideY });
              setLocalLayout((prev) => {
                const merged = { ...prev, [tableId]: snapped.rect };
                layoutRef.current = merged;
                return merged;
              });
              restoreScrollPositions();
            };

            const onUp = () => {
              setGuides({});
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
              saveLayout(layoutRef.current);
            };

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp, { once: true });
          };

          const bounds = getAreaBounds([...tablesInArea, ...fixturesInArea.map(([id]) => id)], area.id);
          return (
            <div key={area.id} className="rounded-lg border bg-white shadow-sm select-none">
              <header className="flex items-center justify-between px-3 py-2 border-b bg-slate-50">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{area.name}</span>
                  <span className="text-xs text-slate-500">{tablesInArea.length}卓</span>
                </div>
              </header>
              <div
                className="relative bg-slate-50 overflow-x-auto overflow-y-hidden"
                ref={(el) => {
                  scrollRefs.current[area.id] = el;
                  if (el && scrollPosRef.current[area.id] != null) {
                    el.scrollLeft = scrollPosRef.current[area.id];
                  }
                }}
                onScroll={(e) => {
                  scrollPosRef.current[area.id] = (e.currentTarget as HTMLDivElement).scrollLeft;
                }}
              >
                <div
                  className="relative"
                  style={{
                    minHeight: bounds.height * zoom,
                    width: bounds.width * zoom,
                  }}
                >
                  <div
                    className="absolute top-0 left-0"
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: 'top left',
                      width: bounds.width,
                      height: bounds.height,
                    }}
                  >
                    {guides.x != null && (
                      <div className="absolute inset-y-0 w-px bg-sky-400/60 pointer-events-none" style={{ left: guides.x }} />
                    )}
                    {guides.y != null && (
                      <div className="absolute inset-x-0 h-px bg-sky-400/60 pointer-events-none" style={{ top: guides.y }} />
                    )}
                    {tablesInArea.map((tableId) => {
                      const rect = localLayout[tableId] ?? { x: 16, y: 16, w: TABLE_W, h: TABLE_H, areaId: area.id };
                      const seatCfg = getSeat(rect);
                      const capacity = tableCapMap[tableId] ?? 0;
                      const chairs = computeChairs(capacity, rect);
                      const sideOptions = seatCfg.orientation === 'horizontal' ? ([
                        { value: 'top', label: '上' },
                        { value: 'bottom', label: '下' },
                      ] as const) : ([
                        { value: 'left', label: '左' },
                        { value: 'right', label: '右' },
                      ] as const);
                      return (
                        <div
                          key={tableId}
                          className={`absolute ${editMode ? 'cursor-move' : ''}`}
                          style={{ left: rect.x, top: rect.y + LABEL_PAD_Y, width: rect.w, height: rect.h }}
                          onPointerDown={(e) => {
                            if (editMode) areaHandleDrag(tableId, 'move')(e);
                          }}
                          onPointerUp={() => {
                            const st = longPressRef.current;
                            if (st.tid != null) {
                              clearTimeout(st.tid);
                              longPressRef.current.tid = null;
                            }
                          }}
                          onPointerMove={(e) => {
                            const st = longPressRef.current;
                            if (st.tid == null) return;
                            const dx = Math.abs(e.clientX - st.x);
                            const dy = Math.abs(e.clientY - st.y);
                            if (dx > 8 || dy > 8) {
                              clearTimeout(st.tid!);
                              longPressRef.current.tid = null;
                            }
                          }}
                        >
                          <div
                            className={`${previewMode ? 'h-full w-full rounded-md p-0 relative' : 'h-full w-full rounded-md border bg-white shadow-sm p-2 flex flex-col justify-between relative'}`}
                          >
                          <div className="pointer-events-none absolute -top-7 left-0 text-xs font-semibold text-slate-700">
                            卓 {tableId}
                          </div>
                          {!previewMode && editMode && (
                            <div className="absolute right-1 top-1">
                              <button
                                type="button"
                                className="inline-flex items-center rounded px-2 py-[2px] text-[11px] font-semibold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenSeatMenu((prev) => (prev === tableId ? null : tableId));
                                }}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                }}
                              >
                                座席設定
                              </button>
                            </div>
                          )}
                          {previewMode ? (
                            <div className="relative h-full w-full rounded-md border shadow-sm px-2 py-2 text-[12px] leading-tight" style={{ backgroundColor: '#ffffff', borderColor: '#cbd5e1' }}>
                              <div className="flex flex-col gap-[2px]">
                                <div className="flex items-center justify-end gap-[2px] text-[8px] leading-tight -mt-[3px] -mr-[2px] pr-0">
                                  <span className="inline-flex items-center justify-center gap-[2px] rounded border px-[3px] py-[1px] text-[8px] font-semibold whitespace-nowrap bg-slate-50 border-red-600 text-red-600">
                                    P
                                  </span>
                                  <span className="inline-flex items-center justify-center gap-[2px] rounded border px-[3px] py-[1px] text-[8px] font-semibold whitespace-nowrap bg-slate-50 border-slate-500 text-slate-700">
                                    スタ
                                  </span>
                                </div>
                                <div className="flex items-start justify-center gap-2 text-[13px] font-bold text-slate-800">
                                  <span className="font-mono leading-tight text-[17px]">19:30</span>
                                </div>
                              </div>
                              <div className="flex-1 flex items-center justify-center">
                                <div className="text-center text-[12px] text-slate-600 truncate leading-tight mt-[4px] mb-0">清水 けんいち</div>
                              </div>
                              <div className="pt-2 flex items-center justify-between gap-2 text-[13px] leading-tight">
                                <span className="font-semibold text-slate-800 text-[14px]">2名</span>
                                <span className="text-[11px] font-semibold truncate text-right flex-1" style={{ color: '#1f2937' }}>
                                  2時間メセ
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-500">ドラッグで移動 / 右下でリサイズ</div>
                          )}
                          {chairs.length > 0 && (
                            <div className="pointer-events-none absolute inset-0">
                              {chairs.map((c, idx) => {
                                const isHorizontal = c.side === 'top' || c.side === 'bottom';
                                const w = isHorizontal ? CHAIR_LONG : CHAIR_SHORT;
                                const h = isHorizontal ? CHAIR_SHORT : CHAIR_LONG;
                                return (
                                  <div
                                    key={`${tableId}-c-${idx}`}
                                    className="absolute rounded-full bg-slate-500 shadow-sm"
                                    style={{
                                      width: w,
                                      height: h,
                                      left: c.cx - w / 2,
                                      top: c.cy - h / 2,
                                      border: '1px solid rgba(51,65,85,0.55)',
                                    }}
                                  />
                                );
                              })}
                            </div>
                          )}
                          {editMode && openSeatMenu === tableId && (
                            <div
                              className="absolute left-2 bottom-2 z-20 w-[160px] rounded-lg border bg-white p-2 text-[11px] shadow-lg"
                              onClick={(e) => e.stopPropagation()}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                              }}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] text-slate-500">座席配置</span>
                                <button
                                  type="button"
                                  className="text-[11px] text-slate-500 hover:text-slate-700"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenSeatMenu(null);
                                  }}
                                  onPointerDown={(e) => e.stopPropagation()}
                                >
                                  ×
                                </button>
                              </div>
                              <div className="space-y-2">
                                <label className="flex items-center gap-1">
                                  <span className="text-[10px] text-slate-500">向き</span>
                                  <select
                                    className="w-full rounded border px-1 py-[2px] text-[11px]"
                                    value={seatCfg.orientation}
                                    onChange={(e) => updateSeatConfig(tableId, (seat) => normalizeSeatConfig({ ...seat, orientation: e.target.value as SeatOrientation }))}
                                    onPointerDown={(e) => e.stopPropagation()}
                                  >
                                    <option value="horizontal">横並び</option>
                                    <option value="vertical">縦並び</option>
                                  </select>
                                </label>
                                <label className="flex items-center gap-1">
                                  <span className="text-[10px] text-slate-500">配置</span>
                                  <select
                                    className="w-full rounded border px-1 py-[2px] text-[11px]"
                                    value={seatCfg.mode === 'single' ? 'counter' : 'both'}
                                    onChange={(e) =>
                                      updateSeatConfig(tableId, (seat) =>
                                        normalizeSeatConfig({ ...seat, mode: e.target.value === 'counter' ? 'single' : 'both' })
                                      )
                                    }
                                    onPointerDown={(e) => e.stopPropagation()}
                                  >
                                    <option value="both">対面</option>
                                    <option value="counter">カウンター</option>
                                  </select>
                                </label>
                                {seatCfg.mode === 'single' && (
                                  <label className="flex items-center gap-1">
                                    <span className="text-[10px] text-slate-500">面</span>
                                    <select
                                      className="w-full rounded border px-1 py-[2px] text-[11px]"
                                      value={seatCfg.side ?? sideOptions[0].value}
                                      onChange={(e) => updateSeatConfig(tableId, (seat) => normalizeSeatConfig({ ...seat, side: e.target.value as SeatSide }))}
                                      onPointerDown={(e) => e.stopPropagation()}
                                    >
                                      {sideOptions.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                  </label>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        {editMode && (
                          <div
                            className="absolute right-0 bottom-0 w-3 h-3 bg-slate-400 rounded-sm cursor-se-resize touch-none"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              areaHandleDrag(tableId, 'resize')(e as any);
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                  {fixturesInArea.map(([fid, rect]) => {
                      const style = fixtureStyleMap[rect.fixtureType ?? 'other'] ?? fixtureStyleMap.other;
                      const label = rect.label && rect.label !== rect.fixtureType ? rect.label : style.label;
                      const isSelected = selectedFixture === fid;
                      const shape = style.shape === 'pill' ? 'rounded-full' : 'rounded-md';
                      return (
                        <div
                          key={fid}
                          className={`absolute ${editMode ? 'cursor-move' : ''}`}
                          style={{ left: rect.x, top: rect.y + LABEL_PAD_Y, width: rect.w, height: rect.h }}
                          onPointerDown={(e) => {
                            if (!editMode) return;
                            setSelectedFixture(fid);
                            areaHandleDrag(fid, 'move')(e);
                          }}
                        >
                          <div
                            className={`h-full w-full ${shape} border ${style.border} ${style.bg} shadow-sm p-2 flex flex-col justify-center items-center gap-1 ${
                              isSelected ? 'ring-2 ring-sky-400' : ''
                            }`}
                          >
                            <div className="text-[11px] font-semibold text-slate-700">{style.icon}</div>
                            <div className="text-sm font-semibold text-slate-800">{label}</div>
                            <div className="text-[11px] text-slate-600">ドラッグで移動 / 右下でリサイズ</div>
                          </div>
                          {editMode && (
                            <button
                              type="button"
                              className="absolute right-1 top-1 rounded bg-rose-600 px-2 py-[2px] text-[11px] font-semibold text-white shadow"
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setRemovedFixtures((prev) => (prev.includes(fid) ? prev : [...prev, fid]));
                                const next = { ...layoutRef.current };
                                delete next[fid];
                                layoutRef.current = next;
                                setLocalLayout(next);
                                enqueueLayoutChange(next);
                                setSelectedFixture(null);
                              }}
                            >
                              削除
                            </button>
                          )}
                          {editMode && (
                            <div
                              className="absolute right-0 bottom-0 w-3 h-3 bg-slate-400 rounded-sm cursor-se-resize touch-none"
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                areaHandleDrag(fid, 'resize')(e as any);
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {tableEditor && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 px-4" onClick={() => setTableEditor(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">
                {tableEditor.mode === 'add' ? '卓を追加' : `卓番号を変更 (${tableEditor.target})`}
              </h3>
              <button type="button" className="text-sm text-slate-500 hover:text-slate-700" onClick={() => setTableEditor(null)}>閉じる</button>
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-xs font-semibold text-slate-700">
                卓番号
                <input
                  className="mt-1 w-full rounded border px-2 py-2 text-sm"
                  value={tableEditor.value}
                  onChange={(e) => setTableEditor((prev) => prev ? { ...prev, value: e.target.value } : prev)}
                  placeholder="例: 101"
                />
              </label>
              <label className="text-xs font-semibold text-slate-700">
                フロア/エリア
                <select
                  className="mt-1 w-full rounded border px-2 py-2 text-sm"
                  value={tableEditor.areaId ?? ''}
                  onChange={(e) => setTableEditor((prev) => prev ? { ...prev, areaId: e.target.value } : prev)}
                >
                  {areaSections.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded border text-sm text-slate-700 bg-white hover:bg-slate-50"
                  onClick={() => setTableEditor(null)}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded text-sm text-white bg-sky-600 shadow-sm"
                  onClick={() => handleAddOrRename()}
                >
                  {tableEditor.mode === 'add' ? '追加' : '変更'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
