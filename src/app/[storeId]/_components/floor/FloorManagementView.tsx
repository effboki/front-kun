'use client';

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';
import type React from 'react';
import type { ScheduleItem } from '@/types/schedule';
import type { Reservation } from '@/types/reservation';
import type { AreaDef, EatDrinkOption, StoreSettingsValue } from '@/types/settings';
import type { CourseOption, ReservationInput } from '../reservations/ReservationEditorDrawer';
import ReservationEditorDrawer from '../reservations/ReservationEditorDrawer';
import { getCourseColorStyle, normalizeCourseColor, type CourseColorStyle } from '@/lib/courseColors';
import { snapMinutes } from '@/lib/schedule';
import { startOfDayMs } from '@/lib/time';
import { yyyymmdd } from '@/lib/miniTasks';

type Rotation = 1 | 2 | 3;

type Props = {
  storeId: string;
  reservations: Reservation[];
  scheduleItems: ScheduleItem[];
  tables: string[];
  areas?: AreaDef[];
  coursesOptions?: CourseOption[];
  storeSettings?: StoreSettingsValue;
  eatOptions?: EatDrinkOption[];
  drinkOptions?: EatDrinkOption[];
  dayStartMs?: number;
  floorLayoutBase?: LayoutMap | null;
  floorLayoutDaily?: Record<string, LayoutMap> | null;
  onPersistLayout?: (kind: 'base' | 'day', layout: LayoutMap, dayKey: string) => Promise<void> | void;
  onUpdateTables?: (tables: string[], areas: AreaDef[]) => Promise<void> | void;
  onReplaceTableId?: (fromId: string, toId: string) => Promise<void> | void;
  onSave?: (data: ReservationInput, id?: string | null) => Promise<string | void>;
  onDelete?: (id: string) => Promise<void>;
  onUpdateReservationField?: (
    id: string,
    field: 'completed' | 'arrived' | 'paid' | 'departed',
    value: Record<string, boolean> | boolean
  ) => void;
  onAdjustTaskTime?: (id: string, label: string, delta: number) => void;
  onToggleArrival?: (id: string) => void;
  onTogglePayment?: (id: string) => void;
  onToggleDeparture?: (id: string) => void;
};

const DEFAULT_STAY_MIN = 120;
const NEW_RESERVATION_STEP_MIN = 15;

type CardModel = {
  id: string;
  tables: string[];
  primaryTable: string;
  rotation: Rotation;
  startMs: number;
  endMs: number;
  course?: string | null;
  guests?: number;
  name?: string | null;
  drinkLabel?: string;
  eatLabel?: string;
  arrived?: boolean;
  paid?: boolean;
  departed?: boolean;
};

type ConflictPair = { a: CardModel; b: CardModel };

const normalizeTableId = (value?: unknown): string => {
  if (value == null) return '';
  return String(value).trim();
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

const byNumericTable = (a: string, b: string) => {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, 'ja');
};

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
 type LayoutMap = Record<string, LayoutEntry>;
 type ReassignSession = { base: CardModel; selected: string[]; original: string[] };
type DisplayEntry = {
  card: CardModel;
  sessionId?: string;
  source: 'existing' | 'ghost';
  color?: { fill?: string; outline?: string };
};

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
const fixtureStyleMap: Record<string, { label: string; bg: string; border: string; icon: string; shape?: 'rounded' | 'pill' }> = {
  entrance: { label: '入口', bg: 'bg-emerald-50', border: 'border-emerald-300', icon: '入口', shape: 'pill' },
  stairs: { label: '階段', bg: 'bg-amber-50', border: 'border-amber-300', icon: '階段', shape: 'rounded' },
  station: { label: 'ステーション', bg: 'bg-sky-50', border: 'border-sky-300', icon: 'ステーション', shape: 'rounded' },
  drink: { label: 'ドリ場', bg: 'bg-indigo-50', border: 'border-indigo-300', icon: 'ドリ場', shape: 'rounded' },
  kitchen: { label: 'キッチン', bg: 'bg-orange-50', border: 'border-orange-300', icon: 'キッチン', shape: 'rounded' },
  register: { label: 'レジ', bg: 'bg-rose-50', border: 'border-rose-300', icon: 'レジ', shape: 'rounded' },
  other: { label: '設備', bg: 'bg-slate-50', border: 'border-slate-300', icon: '設備', shape: 'rounded' },
};

const computeEndMs = (item: ScheduleItem): number => {
  const baseStart = Math.max(0, Number(item.startMs ?? 0));
  const duration =
    Number.isFinite((item as any)?.effectiveDurationMin)
      ? Math.max(5, Math.trunc(Number((item as any).effectiveDurationMin)))
      : Number.isFinite((item as any)?.durationMin)
        ? Math.max(5, Math.trunc(Number((item as any).durationMin)))
        : DEFAULT_STAY_MIN;
  const endMs = Number((item as any)?.endMs);
  if (Number.isFinite(endMs) && endMs > baseStart) return Math.trunc(endMs);
  return baseStart + duration * 60_000;
};

export default function FloorManagementView({
  reservations,
  scheduleItems,
  tables,
  areas,
  coursesOptions,
  storeSettings,
  eatOptions,
  drinkOptions,
  dayStartMs,
  floorLayoutBase,
  floorLayoutDaily,
  onPersistLayout,
  onUpdateTables,
  onReplaceTableId,
  storeId,
  onSave,
  onDelete,
  onUpdateReservationField,
  onAdjustTaskTime,
  onToggleArrival,
  onTogglePayment,
  onToggleDeparture,
}: Props) {
  const dayKey = useMemo(() => {
    const baseMs = startOfDayMs(dayStartMs ?? Date.now());
    return yyyymmdd(new Date(baseMs));
  }, [dayStartMs]);
  const baseLayoutKey = useMemo(() => `fk-floor-base-${storeId}`, [storeId]);
  const dayLayoutKey = useMemo(() => `fk-floor-${storeId}-${dayKey}`, [storeId, dayKey]);
  const zoomKey = useMemo(() => `fk-floor-zoom-${storeId}`, [storeId]);

  const usableTables = useMemo(
    () => Array.from(new Set((tables ?? []).map(normalizeTableId).filter(Boolean))),
    [tables],
  );

  const areaSections = useMemo(() => {
    const list = Array.isArray(areas) && areas.length > 0
      ? areas.map((a) => ({
          ...a,
          tables: (a.tables ?? [])
            .map(normalizeTableId)
            .filter((t) => t && usableTables.includes(t)),
        }))
      : [{ id: '__default', name: 'フロア', tables: usableTables }];

    const assigned = new Set<string>();
    list.forEach((section) => section.tables.forEach((t) => assigned.add(t)));
    const leftovers = usableTables.filter((t) => !assigned.has(t));
    if (leftovers.length > 0) {
      list.push({ id: '__unassigned', name: '未割当', tables: leftovers });
    }
    return list;
  }, [areas, usableTables]);

  const buildAutoLayout = useCallback((sections: typeof areaSections): LayoutMap => {
    const layout: LayoutMap = {};
    const GAP = 16;
    sections.forEach((area) => {
      area.tables.forEach((t, idx) => {
        const col = idx % 3;
        const row = Math.floor(idx / 3);
        const x = GAP + col * (TABLE_W + GAP);
        const y = GAP + row * (TABLE_H + GAP);
        layout[t] = { x, y, w: TABLE_W, h: TABLE_H, areaId: area.id };
      });
    });
    return layout;
  }, [TABLE_W, TABLE_H]);

  const normalizeLayoutForAreas = useCallback((raw: LayoutMap): LayoutMap => {
    const next: LayoutMap = {};
    const areaMap = new Map<string, string>();
    areaSections.forEach((a) => a.tables.forEach((t) => areaMap.set(t, a.id)));
    const tablesSet = new Set(usableTables);
    Object.entries(raw || {}).forEach(([key, rect]) => {
      const entry = rect as LayoutEntry;
      const isFixture = entry.kind === 'fixture';
      if (isFixture) {
        const areaId = entry.areaId ?? areaMap.get(key) ?? areaSections[0]?.id ?? '__default';
        next[key] = { ...entry, areaId, kind: 'fixture' };
        return;
      }
      if (!tablesSet.has(key)) return;
      const areaId = areaMap.get(key) ?? entry.areaId ?? '__unassigned';
      const size = normalizeTableSize(entry.w as number, entry.h as number);
      next[key] = { ...entry, ...size, areaId, kind: 'table' };
    });
    // ensure every table has an entry
    usableTables.forEach((t) => {
      if (!next[t]) {
        const auto = buildAutoLayout(areaSections);
        next[t] = auto[t] ?? { x: 20, y: 20, w: TABLE_W, h: TABLE_H, areaId: areaMap.get(t) ?? '__unassigned', kind: 'table' };
      }
    });
    return next;
  }, [areaSections, usableTables, buildAutoLayout]);

  const initialLayout = useMemo<LayoutMap>(() => {
    // 1) remote day layout > remote base layout
    if (floorLayoutDaily && floorLayoutDaily[dayKey]) return normalizeLayoutForAreas(floorLayoutDaily[dayKey] as LayoutMap);
    if (floorLayoutBase && Object.keys(floorLayoutBase).length > 0) return normalizeLayoutForAreas(floorLayoutBase as LayoutMap);

    // 2) localStorage fallback
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(dayLayoutKey) ?? localStorage.getItem(baseLayoutKey);
        if (raw) return normalizeLayoutForAreas(JSON.parse(raw) as LayoutMap);
      } catch {/* ignore */}
    }

    // 3) auto layout + persist to base (local only)
    const layout = buildAutoLayout(areaSections);
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(baseLayoutKey, JSON.stringify(layout)); } catch {/* ignore */}
    }
    return normalizeLayoutForAreas(layout);
  }, [areaSections, baseLayoutKey, dayLayoutKey, buildAutoLayout, floorLayoutBase, floorLayoutDaily, dayKey, normalizeLayoutForAreas]);

  const [layout, setLayout] = useState<LayoutMap>(initialLayout);
  const layoutRef = useRef<LayoutMap>(initialLayout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  const skipAutoSaveRef = useRef(false);
  const lastSavedLayoutRef = useRef<string>(JSON.stringify(initialLayout));
  const [tableEditor, setTableEditor] = useState<{ mode: 'add' | 'rename'; target?: string; value: string; areaId?: string } | null>(null);
  const cardPressRef = useRef<Record<string, { tid: number | null; x: number; y: number; fired: boolean }>>({});
  const [editMode, setEditMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem('fk-floor-edit') === '1';
  });
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [dirty, setDirty] = useState(false);
  const editModeRef = useRef(false);
  const [selectedFixture, setSelectedFixture] = useState<string | null>(null);

  useEffect(() => { editModeRef.current = editMode; }, [editMode]);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('fk-floor-edit', editMode ? '1' : '0');
    }
  }, [editMode]);
  const [zoom, setZoom] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    const raw = localStorage.getItem(zoomKey);
    const num = raw ? Number(raw) : NaN;
    if (Number.isFinite(num) && num > 0.1 && num <= 3) return num;
    return 1;
  });
  const zoomIn = useCallback(() => setZoom((v) => Math.min(1.5, Math.round((v + 0.1) * 10) / 10)), []);
  const zoomOut = useCallback(() => setZoom((v) => Math.max(0.2, Math.round((v - 0.1) * 10) / 10)), []);
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(zoomKey, String(zoom)); } catch {/* ignore */}
  }, [zoom, zoomKey]);

  const saveDayLayout = useCallback((next: LayoutMap) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(dayLayoutKey, JSON.stringify(next));
      setDirty(false);
    } catch {
      /* ignore */
    }
    if (onPersistLayout) {
      Promise.resolve().then(() => onPersistLayout('day', next, dayKey));
    }
  }, [dayLayoutKey, dayKey, onPersistLayout]);

  const clearDayLayout = useCallback(() => {
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem(dayLayoutKey); } catch {/* ignore */}
    }
    setDirty(false);
    if (floorLayoutBase && typeof floorLayoutBase === 'object') {
      const normalized = normalizeLayoutForAreas(floorLayoutBase as LayoutMap);
      setLayout(normalized);
      layoutRef.current = normalized;
    }
  }, [dayLayoutKey, floorLayoutBase, normalizeLayoutForAreas]);

  const saveAsBase = useCallback((next: LayoutMap) => {
    /* base layout is managed in Store Settings; floor view does not save base */
  }, []);

  const tableToArea = useMemo(() => {
    const map: Record<string, string> = {};
    areaSections.forEach((area) => {
      area.tables.forEach((t) => {
        const key = normalizeTableId(t);
        if (key && !map[key]) map[key] = area.id;
      });
    });
    return map;
  }, [areaSections]);

  const tableCapacitiesMap = useMemo<Record<string, number>>(() => {
    const src = (storeSettings as any)?.tableCapacities ?? {};
    const map: Record<string, number> = {};
    if (src && typeof src === 'object') {
      Object.entries(src as Record<string, unknown>).forEach(([k, v]) => {
        const num = Number(v);
        if (Number.isFinite(num) && num > 0) map[normalizeTableId(k)] = Math.round(num);
      });
    }
    return map;
  }, [storeSettings]);

  const CHAIR_LONG = 26;
  const CHAIR_SHORT = 12;
  const CHAIR_OUTSET = 1;
  const LABEL_PAD_Y = 10;
  const TOP_PAD = 6;
  const computeChairs = useCallback(
    (capacity: number, rect: LayoutEntry): { cx: number; cy: number; side: SeatSide }[] => {
      const seat = normalizeSeatConfig(rect?.seat);
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
        const seatSide: SeatSide = seat.side ?? (seat.orientation === 'horizontal' ? 'top' : 'left');
        if (seatSide === 'top' || seatSide === 'bottom') {
          const y = seatSide === 'top' ? topY : bottomY;
          for (let i = 0; i < capacity; i++) {
            chairs.push({ cx: ((i + 1) / (capacity + 1)) * rect.w, cy: y, side: seatSide });
          }
        } else {
          const x = seatSide === 'left' ? leftX : rightX;
          for (let i = 0; i < capacity; i++) {
            chairs.push({ cx: x, cy: ((i + 1) / (capacity + 1)) * rect.h, side: seatSide });
          }
        }
      }
      return chairs;
    },
    []
  );

  const [rotation, setRotation] = useState<Rotation>(1);

  const courseColorMap = useMemo(() => {
    const map = new Map<string, CourseColorStyle>();
    const defs: any[] = [];
    if (Array.isArray(coursesOptions)) defs.push(...(coursesOptions as any[]));
    const ss: any = storeSettings as any;
    const fromSettings =
      ss?.courses ??
      ss?.courseOptions ??
      ss?.coursesOptions ??
      ss?.plans ??
      ss?.courseDefs ??
      ss?.course_list ??
      ss?.courseSettings;
    if (Array.isArray(fromSettings)) defs.push(...fromSettings);
    defs.forEach((def: any) => {
      const rawName = String((def?.value ?? def?.name ?? def?.label ?? def?.title ?? '') || '').trim();
      if (!rawName) return;
      const colorKey = normalizeCourseColor(def?.color ?? def?.courseColor);
      map.set(rawName, getCourseColorStyle(colorKey));
    });
    map.set('未選択', getCourseColorStyle(null));
    return map;
  }, [coursesOptions, storeSettings]);
  const extraColorMap = useMemo(() => {
    const map = new Map<string, CourseColorStyle>();
    const defs: any[] = [];
    if (Array.isArray(eatOptions)) defs.push(...(eatOptions as any[]));
    if (Array.isArray(drinkOptions)) defs.push(...(drinkOptions as any[]));
    defs.forEach((def: any) => {
      const raw = String((def?.label ?? def?.name ?? '') || '').trim();
      if (!raw) return;
      const colorKey = normalizeCourseColor(def?.color);
      map.set(raw, getCourseColorStyle(colorKey));
    });
    return map;
  }, [eatOptions, drinkOptions]);

  const activeItems = useMemo(() => {
    return (scheduleItems ?? []).filter((it) => !it.departed);
  }, [scheduleItems]);

  const tableQueues = useMemo<Record<string, ScheduleItem[]>>(() => {
    const queues: Record<string, ScheduleItem[]> = {};
    activeItems.forEach((it) => {
      (it.tables ?? []).forEach((t) => {
        const key = normalizeTableId(t);
        if (!key) return;
        (queues[key] ??= []).push(it);
      });
    });
    Object.values(queues).forEach((list) => {
      list.sort((a, b) => (a.startMs - b.startMs) || (computeEndMs(a) - computeEndMs(b)));
    });
    return queues;
  }, [activeItems]);

  const rotationIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    Object.values(tableQueues).forEach((list) => {
      if (!Array.isArray(list) || list.length === 0) return;
      let currentRotation = 1;
      let currentEnd = -Infinity;
      list.forEach((it, idx) => {
        const start = Number((it as any)?.startMs ?? 0);
        const end = computeEndMs(it);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        if (idx === 0) {
          currentRotation = 1;
          currentEnd = end;
        } else {
          // 回転は「前の回が終わった後に始まるか」でのみ進める。重なっている間は同じ回転に留める。
          if (start >= currentEnd) {
            currentRotation += 1;
            currentEnd = end;
          } else {
            currentEnd = Math.max(currentEnd, end);
          }
        }
        const rid = String((it as any).id ?? (it as any)._key ?? '');
        if (!rid) return;
        const prev = map.get(rid);
        map.set(rid, prev ? Math.max(prev, currentRotation) : currentRotation);
      });
    });
    return map;
  }, [tableQueues, computeEndMs]);

  const maxRotation = useMemo<Rotation>(() => {
    const max = Array.from(rotationIndexMap.values()).reduce((m, v) => Math.max(m, v), 1);
    if (max >= 3) return 3;
    if (max >= 2) return 2;
    return 1;
  }, [rotationIndexMap]);

  useEffect(() => {
    if (rotation > maxRotation) {
      setRotation(maxRotation);
    }
  }, [rotation, maxRotation]);

  const cards = useMemo<CardModel[]>(() => {
    return activeItems.map((it) => {
      const tablesList = (it.tables ?? []).map(normalizeTableId).filter(Boolean);
      const sortedTables = [...tablesList].sort(byNumericTable);
      const primaryTable = sortedTables[0] ?? tablesList[0] ?? '';
      const rid = String((it as any).id ?? (it as any)._key ?? '');
      const rotationIdx = rotationIndexMap.get(rid) ?? 1;
      return {
        id: rid,
        tables: tablesList,
        primaryTable,
        rotation: rotationIdx >= 3 ? 3 : (rotationIdx === 2 ? 2 : 1),
        startMs: it.startMs,
        endMs: computeEndMs(it),
        course: (it as any).course ?? (it as any).courseName,
        guests: (it as any).people ?? (it as any).guests,
        name: (it as any).name,
        drinkLabel: (it as any).drinkLabel,
        eatLabel: (it as any).eatLabel,
        arrived: (it as any).arrived,
        paid: (it as any).paid,
        departed: (it as any).departed,
      };
    });
  }, [activeItems, rotationIndexMap]);

  const cardsCurrent = useMemo(() => cards.filter((c) => c.rotation === rotation), [cards, rotation]);

  const tableCardsCurrent = useMemo<Record<string, CardModel[]>>(() => {
    const map: Record<string, CardModel[]> = {};
    cardsCurrent.forEach((card) => {
      card.tables.forEach((t) => {
        const key = normalizeTableId(t);
        if (!key) return;
        (map[key] ??= []).push(card);
      });
    });
    Object.values(map).forEach((list) => {
      list.sort((a, b) => (a.startMs - b.startMs) || (a.endMs - b.endMs));
    });
    return map;
  }, [cardsCurrent]);

  const conflictsByTableCurrent = useMemo<Record<string, ConflictPair[]>>(() => {
    const out: Record<string, ConflictPair[]> = {};
    Object.entries(tableCardsCurrent).forEach(([tableId, list]) => {
      const conflicts: ConflictPair[] = [];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const start = Math.max(a.startMs, b.startMs);
          const end = Math.min(a.endMs, b.endMs);
          if (start < end) {
            conflicts.push({ a, b });
          }
        }
      }
      if (conflicts.length > 0) out[tableId] = conflicts;
    });
    return out;
  }, [tableCardsCurrent]);
  const conflictsByTableAll = useMemo<Record<string, ConflictPair[]>>(() => {
    const map: Record<string, ConflictPair[]> = {};
    const allMap: Record<string, CardModel[]> = {};
    cards.forEach((card) => {
      card.tables.forEach((t) => {
        const key = normalizeTableId(t);
        if (!key) return;
        (allMap[key] ??= []).push(card);
      });
    });
    Object.entries(allMap).forEach(([tableId, list]) => {
      const conflicts: ConflictPair[] = [];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const start = Math.max(a.startMs, b.startMs);
          const end = Math.min(a.endMs, b.endMs);
          if (start < end) {
            conflicts.push({ a, b });
          }
        }
      }
      if (conflicts.length > 0) map[tableId] = conflicts;
    });
    return map;
  }, [cards]);
  const conflictReservationIds = useMemo(() => {
    const ids = new Set<string>();
    const collect = (pairs: Record<string, ConflictPair[]>) => {
      Object.values(pairs).forEach((list) => {
        list.forEach((pair) => {
          if (pair?.a?.id) ids.add(pair.a.id);
          if (pair?.b?.id) ids.add(pair.b.id);
        });
      });
    };
    collect(conflictsByTableCurrent);
    collect(conflictsByTableAll);
    return ids;
  }, [conflictsByTableCurrent, conflictsByTableAll]);
  const conflictReservationTableSet = useMemo(() => {
    const set = new Set<string>();
    cards.forEach((card) => {
      if (!card?.id || !conflictReservationIds.has(card.id)) return;
      card.tables.forEach((t) => {
        const key = normalizeTableId(t);
        if (key) set.add(key);
      });
    });
    return set;
  }, [cards, conflictReservationIds]);
  const conflictTableSet = useMemo(() => {
    const set = new Set<string>();
    Object.entries(conflictsByTableCurrent).forEach(([key, list]) => {
      if (!Array.isArray(list) || list.length === 0) return;
      const t = normalizeTableId(key);
      if (t) set.add(t);
    });
    Object.entries(conflictsByTableAll).forEach(([key, list]) => {
      if (!Array.isArray(list) || list.length === 0) return;
      const t = normalizeTableId(key);
      if (t) set.add(t);
    });
    return set;
  }, [conflictsByTableCurrent, conflictsByTableAll]);

  const [reassignSessions, setReassignSessions] = useState<Record<string, ReassignSession>>({});
  const [activeReassignId, setActiveReassignId] = useState<string | null>(null);
  const activeReassign = activeReassignId ? reassignSessions[activeReassignId] ?? null : null;
  useEffect(() => {
    if (activeReassignId) return;
    const first = Object.keys(reassignSessions)[0];
    if (first) setActiveReassignId(first);
  }, [activeReassignId, reassignSessions]);
  const sessionPalette = useMemo(
    () => [
      { fill: 'rgba(37,99,235,0.08)', outline: 'rgba(37,99,235,0.45)' }, // blue
      { fill: 'rgba(239,68,68,0.08)', outline: 'rgba(239,68,68,0.45)' }, // red
      { fill: 'rgba(139,92,246,0.08)', outline: 'rgba(139,92,246,0.45)' }, // purple
      { fill: 'rgba(249,115,22,0.10)', outline: 'rgba(249,115,22,0.5)' }, // orange
      { fill: 'rgba(6,182,212,0.10)', outline: 'rgba(6,182,212,0.45)' }, // cyan
      { fill: 'rgba(234,179,8,0.12)', outline: 'rgba(234,179,8,0.55)' }, // yellow
    ],
    []
  );
  const sessionOrder = useMemo(() => Object.keys(reassignSessions), [reassignSessions]);
  const pickSessionColor = useCallback(
    (sid?: string | null) => {
      const target = sid ? String(sid) : '';
      const idx = target ? sessionOrder.indexOf(target) : -1;
      return sessionPalette[idx >= 0 ? (idx % sessionPalette.length) : 0];
    },
    [sessionOrder, sessionPalette]
  );
  const sessionByReservationId = useMemo(() => {
    const map = new Map<string, string>();
    Object.entries(reassignSessions).forEach(([sid, session]) => {
      if (session.base?.id) map.set(session.base.id, sid);
    });
    return map;
  }, [reassignSessions]);
  const selectedTablesBySession = useMemo(() => {
    const map: Record<string, Array<{ sessionId: string; card: CardModel }>> = {};
    Object.entries(reassignSessions).forEach(([sid, session]) => {
      const list = Array.from(new Set((session.selected ?? []).map(normalizeTableId).filter(Boolean)));
      list.forEach((t) => {
        (map[t] ??= []).push({ sessionId: sid, card: session.base });
      });
    });
    return map;
  }, [reassignSessions]);
  const reassignMode = sessionOrder.length > 0;
  const CARD_LONG_MS = 650;
  const CARD_MOVE_TOL = 10;
  const beginCardLongPress = useCallback((key: string, e: React.PointerEvent | PointerEvent, onLong: () => void) => {
    const x = Number((e as any)?.clientX ?? 0);
    const y = Number((e as any)?.clientY ?? 0);
    const state = cardPressRef.current[key] ?? { tid: null, x, y, fired: false };
    if (state.tid != null) window.clearTimeout(state.tid);
    state.x = x;
    state.y = y;
    state.fired = false;
    state.tid = window.setTimeout(() => {
      state.tid = null;
      state.fired = true;
      onLong();
    }, CARD_LONG_MS) as unknown as number;
    cardPressRef.current[key] = state;
  }, []);
  const cancelCardLongPress = useCallback((key: string) => {
    const state = cardPressRef.current[key];
    if (!state) return;
    if (state.tid != null) {
      window.clearTimeout(state.tid);
      state.tid = null;
    }
    if (state.fired) {
      window.setTimeout(() => {
        delete cardPressRef.current[key];
      }, 400);
    } else {
      delete cardPressRef.current[key];
    }
  }, []);
  const abortLongPressOnMove = useCallback((key: string, e: React.PointerEvent | PointerEvent) => {
    const state = cardPressRef.current[key];
    if (!state || state.tid == null) return;
    const dx = Math.abs(Number((e as any)?.clientX ?? 0) - state.x);
    const dy = Math.abs(Number((e as any)?.clientY ?? 0) - state.y);
    if (dx > CARD_MOVE_TOL || dy > CARD_MOVE_TOL) {
      window.clearTimeout(state.tid);
      state.tid = null;
    }
  }, []);
  const wasLongPressFired = useCallback((key: string) => Boolean(cardPressRef.current[key]?.fired), []);

  const cardsByArea = useMemo(() => {
    const map = new Map<string, CardModel[]>();
    cards.forEach((card) => {
      const areasForCard = new Set<string>();
      card.tables.forEach((t) => {
        const aid = tableToArea[t];
        if (aid) areasForCard.add(aid);
      });
      if (areasForCard.size === 0) areasForCard.add(areaSections[0]?.id ?? '__default');
      areasForCard.forEach((aid) => {
        const list = map.get(aid) ?? [];
        if (!list.includes(card)) list.push(card);
        map.set(aid, list);
      });
    });
    return map;
  }, [cards, tableToArea, areaSections]);

  // keep layout in sync with table list (add missing, drop removed)
  useEffect(() => {
    setLayout((prev) => {
      const next: LayoutMap = { ...prev };
      const missing: string[] = [];
      areaSections.forEach((area) => {
        area.tables.forEach((t) => {
          if (!next[t]) missing.push(t);
          next[t] = { ...(next[t] ?? {}), areaId: area.id };
        });
      });
      Object.entries(next).forEach(([key, value]) => {
        const entry = value as LayoutEntry;
        if (entry.kind === 'fixture') return;
        if (!usableTables.includes(key)) delete next[key];
      });
      if (missing.length > 0) {
        const auto = buildAutoLayout(areaSections);
        missing.forEach((t) => {
          next[t] = auto[t] ?? { x: 20, y: 20, w: TABLE_W, h: TABLE_H, areaId: areaSections[0]?.id };
        });
      }
      layoutRef.current = next;
      return next;
    });
  }, [areaSections, usableTables, buildAutoLayout]);

  // remote layout updates
  useEffect(() => {
    const remote = (floorLayoutDaily && floorLayoutDaily[dayKey]) || floorLayoutBase;
    if (remote && typeof remote === 'object') {
      const normalized = normalizeLayoutForAreas(remote as LayoutMap);
      skipAutoSaveRef.current = true;
      lastSavedLayoutRef.current = JSON.stringify(normalized);
      setLayout(normalized);
      layoutRef.current = normalized;
      setDirty(false);
    }
  }, [floorLayoutBase, floorLayoutDaily, dayKey, normalizeLayoutForAreas]);

  useEffect(() => {
    if (editModeRef.current) setEditMode(true);
  }, [layout]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; initial: Partial<ReservationInput> & { table?: string } } | null>(null);
  const [conflictModal, setConflictModal] = useState<{ tableId: string; rows: CardModel[] } | null>(null);

  const editingReservation = useMemo(() => {
    if (!editing?.id) return null;
    return reservations.find((r) => r.id === editing.id) ?? null;
  }, [editing?.id, reservations]);

  const statusControls = useMemo(() => {
    if (!editing?.id || !editingReservation) return undefined;
    return {
      flags: {
        arrived: Boolean(editingReservation.arrived),
        paid: Boolean(editingReservation.paid),
        departed: Boolean(editingReservation.departed),
      },
      onToggle: (kind: 'arrived' | 'paid' | 'departed') => {
        const id = editingReservation.id;
        if (!id) return null;
        if (kind === 'arrived') {
          if (onToggleArrival) onToggleArrival(id);
          else onUpdateReservationField?.(id, 'arrived', !editingReservation.arrived);
        } else if (kind === 'paid') {
          if (onTogglePayment) onTogglePayment(id);
          else onUpdateReservationField?.(id, 'paid', !editingReservation.paid);
        } else {
          if (onToggleDeparture) onToggleDeparture(id);
          else onUpdateReservationField?.(id, 'departed', !editingReservation.departed);
        }
        return null;
      },
    };
  }, [editing?.id, editingReservation, onToggleArrival, onToggleDeparture, onTogglePayment, onUpdateReservationField]);

  const openEditorForReservation = useCallback((card: CardModel, table?: string) => {
    setEditing({
      id: card.id,
      initial: {
        startMs: card.startMs,
        tables: card.tables,
        table: table ?? card.primaryTable,
        guests: card.guests ?? 0,
        name: card.name ?? '',
        courseName: card.course ?? undefined,
        drinkLabel: card.drinkLabel,
        eatLabel: card.eatLabel,
      },
    });
    setDrawerOpen(true);
  }, []);

  const openEditorForNew = useCallback((tableId: string) => {
    const now = Date.now();
    const base = startOfDayMs(dayStartMs ?? now);
    const snapped = snapMinutes(now, NEW_RESERVATION_STEP_MIN);
    const startMs = Math.max(base, snapped);
    setEditing({
      id: null,
      initial: { startMs, tables: [tableId], table: tableId, guests: 0, name: '' },
    });
    setDrawerOpen(true);
  }, [dayStartMs]);

  const startReassignForCard = useCallback((card: CardModel, focusTable?: string) => {
    if (!card) return;
    const baseId = String(card.id ?? '');
    if (!baseId) return;
    const focus = normalizeTableId(focusTable);
    const initialSelectedSet = new Set(card.tables.map(normalizeTableId).filter(Boolean));
    if (focus) initialSelectedSet.add(focus);
    const initialSelected = Array.from(initialSelectedSet);
    const originalTables = card.tables.length > 0 ? [...initialSelectedSet] : (focus ? [focus] : []);
    setReassignSessions((prev) => {
      const existing = prev[baseId];
      if (existing) {
        const merged = new Set(existing.selected.map(normalizeTableId).filter(Boolean));
        initialSelected.forEach((t) => merged.add(t));
        return { ...prev, [baseId]: { ...existing, selected: Array.from(merged) } };
      }
      const seed = initialSelected.length > 0 ? initialSelected : originalTables;
      return {
        ...prev,
        [baseId]: {
          base: card,
          selected: seed.length > 0 ? seed : [normalizeTableId(card.primaryTable)].filter(Boolean),
          original: originalTables.length > 0 ? originalTables : [normalizeTableId(card.primaryTable)].filter(Boolean),
        },
      };
    });
    setActiveReassignId(baseId);
  }, []);

  const toggleTableSelection = useCallback((tableId: string) => {
    const key = normalizeTableId(tableId);
    if (!key || !activeReassignId) return;
    setReassignSessions((prev) => {
      const session = prev[activeReassignId];
      if (!session) return prev;
      const next = new Set(session.selected.map(normalizeTableId).filter(Boolean));
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...prev, [activeReassignId]: { ...session, selected: Array.from(next) } };
    });
  }, [activeReassignId]);

  const clearReassignSession = useCallback((sid: string) => {
    setReassignSessions((prev) => {
      if (!prev[sid]) return prev;
      const next = { ...prev };
      delete next[sid];
      const remaining = Object.keys(next);
      setActiveReassignId((current) => {
        if (current && current !== sid) return current;
        return remaining[0] ?? null;
      });
      return next;
    });
  }, []);

  const clearAllReassign = useCallback(() => {
    setReassignSessions({});
    setActiveReassignId(null);
  }, []);

  const applyReassign = useCallback(async () => {
    const entries = Object.entries(reassignSessions);
    if (entries.length === 0) return;
    const normalized = entries.map(([id, session]) => {
      const list = Array.from(new Set((session.selected ?? []).map(normalizeTableId).filter(Boolean)));
      return { id, list, primary: list[0] ?? '' };
    });
    const counts: Record<string, number> = {};
    normalized.forEach((item) => {
      if (!item.primary) return;
      counts[item.primary] = (counts[item.primary] || 0) + 1;
    });
    const dup = Object.keys(counts).find((k) => counts[k] > 1);
    if (dup) {
      toast.error(`同じ卓番号「${dup}」に複数の予約を割り当てようとしています。調整してください。`);
      return;
    }
    try {
      for (const item of normalized) {
        if (!item.id || item.list.length === 0) continue;
        const patch: any = { tables: item.list, table: item.primary };
        if (onSave) await onSave(patch, item.id);
      }
      toast.success('卓番変更を適用しました');
      clearAllReassign();
    } catch (err) {
      console.error('[floor] apply reassign failed', err);
      toast.error('卓番変更の適用に失敗しました');
    }
  }, [reassignSessions, onSave, clearAllReassign]);

  const renderReservationCard = useCallback((card: CardModel, opts?: { conflict?: boolean; highlightFuture?: boolean; ghostColor?: { fill?: string; outline?: string }; hideFrame?: boolean }) => {
    const course = (card.course ?? '').toString().trim();
    const courseColor = course ? (courseColorMap.get(course) ?? courseColorMap.get('未選択')) : courseColorMap.get('未選択');
    const showArrived = card.arrived && !card.departed;
    const showPaid = card.paid && !card.departed;
    const baseBg = opts?.hideFrame ? 'transparent' : (showArrived ? '#e8f7ec' : '#ffffff');
    const baseBorder = opts?.hideFrame ? undefined : (showPaid ? '#1d4ed8' : '#cbd5e1');
    const bg = opts?.ghostColor?.fill ?? baseBg;
    const borderColor = opts?.hideFrame ? undefined : (opts?.ghostColor?.outline ?? baseBorder);
    const accent = opts?.highlightFuture ? '#dc2626' : '#0f172a';
    const guestsLabel = Number.isFinite(card.guests) && (card.guests ?? 0) > 0 ? `${card.guests}名` : '―';
    const timeLabel = fmtTime(card.startMs);
    const name = (card.name ?? '').toString().trim();
    const eatLabel = (card.eatLabel ?? '').toString().trim();
    const drinkLabel = (card.drinkLabel ?? '').toString().trim();
    const extras = [
      eatLabel ? { label: eatLabel, color: (extraColorMap.get(eatLabel)?.text ?? '#0f172a') } : null,
      drinkLabel ? { label: drinkLabel, color: (extraColorMap.get(drinkLabel)?.text ?? '#0f172a') } : null,
    ].filter(Boolean) as { label: string; color: string }[];
    const bodyOpacity = card.departed ? 0.5 : 1;
    const baseClass = opts?.conflict ? 'bg-[repeating-linear-gradient(45deg,#fff7ed,#fff7ed_8px,#fde68a_8px,#fde68a_16px)]' : '';
    const frameClass = opts?.hideFrame
      ? 'flex h-full flex-col px-2 py-2 text-[12px] leading-tight'
      : 'flex h-full flex-col rounded-md border shadow-sm px-2 py-2 text-[12px] leading-tight';
    const style: React.CSSProperties = {
      backgroundColor: bg,
      opacity: bodyOpacity,
    };
    if (!opts?.hideFrame) {
      if (borderColor) style.borderColor = borderColor;
      const outline = opts?.ghostColor?.outline;
      if (outline) style.boxShadow = `0 0 0 2px ${outline}`;
      else if (showPaid) style.boxShadow = '0 0 0 2px rgba(59,130,246,0.25)';
    }
    return (
      <div
        className={`${frameClass} ${baseClass}`}
        style={style}
      >
        <div className="flex flex-col gap-[2px]">
          {extras.length > 0 && (
            <div className="flex items-center justify-end gap-[2px] text-[8px] leading-tight -mt-[4px] -mr-[2px] pr-0">
              {extras.map((chip) => (
                <span
                  key={chip.label}
                  className="inline-flex items-center justify-center gap-[2px] rounded border px-[3px] py-[1px] font-semibold whitespace-nowrap bg-slate-50"
                  style={{ borderColor: chip.color, color: chip.color }}
                >
                  {chip.label}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-start justify-center gap-2 text-[13px] font-bold text-center" style={{ color: accent }}>
            <span className="font-mono leading-tight text-[17px]">{timeLabel}</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-[12px] text-slate-600 truncate leading-tight mt-[4px] mb-0">{name || '—'}</div>
        </div>
        <div className="pt-2 flex items-center justify-between gap-2 text-[13px] leading-tight">
          <span className="font-semibold text-slate-800 text-[14px]">{guestsLabel}</span>
          <span
            className="text-[11px] font-semibold truncate text-right flex-1"
            style={{ color: courseColor?.text ?? '#0f172a' }}
          >
            {course || '未選択'}
          </span>
        </div>
      </div>
    );
  }, [courseColorMap, extraColorMap]);

  const getCardVisual = useCallback((card: CardModel) => {
    const showArrived = card.arrived && !card.departed;
    const showPaid = card.paid && !card.departed;
    const bg = showArrived ? '#e8f7ec' : '#ffffff';
    const border = showPaid ? '#1d4ed8' : '#cbd5e1';
    const shadow = showPaid ? '0 0 0 2px rgba(59,130,246,0.25)' : undefined;
    return { bg, border, shadow };
  }, []);

  const renderCompactBooking = useCallback((entry: DisplayEntry, opts?: { dense?: boolean }) => {
    const card = entry.card;
    const guestsLabel = Number.isFinite(card.guests) && (card.guests ?? 0) > 0 ? `${card.guests}名` : '―';
    const timeLabel = fmtTime(card.startMs);
    const name = (card.name ?? '').toString().trim() || '—';
    const fill = entry.color?.fill ?? '#fff7ed';
    const outline = entry.color?.outline ?? '#f59e0b';
    const dense = !!opts?.dense;
    const timeSize = dense ? 'text-[11px]' : 'text-[13px]';
    const nameSize = dense ? 'text-[10px]' : 'text-[12px]';
    const guestsSize = dense ? 'text-[10px]' : 'text-[12px]';
    const gapClass = dense ? 'gap-[1px]' : 'gap-[2px]';
    const lineClamp = dense ? 'line-clamp-3' : 'line-clamp-2';
    const monoSize = dense ? 'text-[13px]' : 'text-[15px]';
    return (
      <div
        className="relative h-full w-full rounded-md border overflow-hidden"
        style={{ backgroundColor: fill, borderColor: outline }}
      >
        <div className={`px-2 ${dense ? 'pt-[2px] pb-1' : 'pt-1 pb-2'} flex flex-col ${gapClass} h-full`}>
          <div className={`flex items-center justify-between font-bold text-slate-900 leading-tight ${timeSize}`}>
            <span className={`font-mono ${monoSize}`}>{timeLabel}</span>
            <span className={`${guestsSize} font-semibold text-slate-800`}>{guestsLabel}</span>
          </div>
          <div className="flex-1 flex items-start">
            <div className={`${nameSize} font-semibold text-slate-800 leading-snug break-words ${lineClamp} text-left ${dense ? 'pt-[1px]' : 'pt-[2px]'}`}>
              {name}
            </div>
          </div>
        </div>
      </div>
    );
  }, []);

  const sortEntriesForDisplay = useCallback((entries: DisplayEntry[]) => {
    return entries.slice().sort((a, b) => (a.card.startMs - b.card.startMs) || (a.card.endMs - b.card.endMs));
  }, []);

  const findOverlapPair = useCallback((entries: DisplayEntry[]): { a: DisplayEntry; b: DisplayEntry } | null => {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i].card;
        const b = entries[j].card;
        const start = Math.max(a.startMs, b.startMs);
        const end = Math.min(a.endMs, b.endMs);
        if (start < end) return { a: entries[i], b: entries[j] };
      }
    }
    return null;
  }, []);

  const submitTableEdit = useCallback(async () => {
    if (!tableEditor) return;
    const mode = tableEditor.mode;
    const target = normalizeTableId(tableEditor.target);
    const nextId = normalizeTableId(tableEditor.value);
    const areaId = tableEditor.areaId || areaSections[0]?.id || '__default';
    if (!nextId) return;
    if (mode === 'rename' && !target) return;
    if (mode === 'rename' && target === nextId) { setTableEditor(null); return; }

    let nextTables = [...usableTables];
    let nextAreas: AreaDef[] = areaSections.map((a) => ({ ...a, tables: [...a.tables] }));

    if (mode === 'add') {
      if (nextTables.includes(nextId)) {
        setTableEditor(null);
        return;
      }
      nextTables.push(nextId);
      nextAreas = nextAreas.map((a) =>
        a.id === areaId ? { ...a, tables: Array.from(new Set([...a.tables, nextId])) } : a
      );
      setLayout((prev) => {
        const auto = buildAutoLayout(nextAreas as any);
        const rect = auto[nextId] ?? { x: 20, y: 20, w: TABLE_W, h: TABLE_H, areaId };
        const next = { ...prev, [nextId]: rect };
        layoutRef.current = next;
        return next;
      });
    } else {
      // rename
      if (nextTables.includes(nextId)) {
        setTableEditor(null);
        return;
      }
      nextTables = nextTables.map((t) => (t === target ? nextId : t));
      nextAreas = nextAreas.map((a) => {
        let tables = a.tables.map((t) => (t === target ? nextId : t));
        if (a.id === areaId && !tables.includes(nextId)) tables = [...tables, nextId];
        if (a.id !== areaId) tables = tables.filter((t) => t !== nextId && t !== target);
        return { ...a, tables };
      });
      setLayout((prev) => {
        const current = prev[target];
        const nextRect = current ? { ...current, areaId } : { x: 20, y: 20, w: TABLE_W, h: TABLE_H, areaId };
        const next = { ...prev };
        delete next[target];
        next[nextId] = nextRect;
        layoutRef.current = next;
        return next;
      });
      await onReplaceTableId?.(target, nextId);
    }

    await onUpdateTables?.(nextTables, nextAreas);
    setTableEditor(null);
  }, [tableEditor, usableTables, areaSections, buildAutoLayout, onUpdateTables, onReplaceTableId]);

  const openAddTable = useCallback(() => {
    setTableEditor({ mode: 'add', value: '', areaId: areaSections[0]?.id });
  }, [areaSections]);

  const deleteFixture = useCallback((fixtureId: string) => {
    setLayout((prev) => {
      const next: LayoutMap = { ...prev };
      delete next[fixtureId];
      layoutRef.current = next;
      saveDayLayout(next);
      return next;
    });
    setSelectedFixture(null);
  }, [saveDayLayout]);

  useEffect(() => {
    if (!editMode) return;
    if (skipAutoSaveRef.current) {
      skipAutoSaveRef.current = false;
      return;
    }
    const sig = JSON.stringify(layout);
    if (sig === lastSavedLayoutRef.current) return;
    lastSavedLayoutRef.current = sig;
    saveDayLayout(layout);
  }, [layout, editMode, saveDayLayout]);

  return (
    <div className="relative w-full overflow-hidden select-none">
      <div className="flex items-center gap-2 px-4 py-3 bg-white shadow-sm sticky top-0 z-20 flex-wrap">
        {[1, 2, 3].filter((n) => n <= maxRotation).map((idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setRotation(idx as Rotation)}
            className={`rounded-full px-4 py-2 text-sm font-semibold border ${
              rotation === idx ? 'bg-sky-600 text-white border-sky-600 shadow-sm' : 'bg-white text-slate-700 border-slate-300'
            }`}
          >
            {idx}回転目{idx === 1 ? '（現在）' : ''}
          </button>
        ))}
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-sm text-slate-600">
            <button
              type="button"
              className="rounded border px-2 py-[6px] hover:bg-slate-50"
              onClick={zoomOut}
            >
              −
            </button>
            <span className="min-w-[48px] text-center font-semibold">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="rounded border px-2 py-[6px] hover:bg-slate-50"
              onClick={zoomIn}
            >
              ＋
            </button>
          </div>
          <button
            type="button"
            className={`px-3 py-2 rounded border text-sm font-semibold ${editMode ? 'bg-amber-100 border-amber-400 text-amber-800' : 'bg-white border-slate-300 text-slate-700'}`}
            onClick={() => setEditMode((v) => !v)}
          >
            {editMode ? '日次レイアウト編集中' : '日次レイアウト編集'}
          </button>
          {editMode && (
            <button
              type="button"
              className="px-3 py-2 rounded border text-sm text-slate-700 bg-white hover:bg-slate-50"
              onClick={openAddTable}
            >
              卓を追加
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6 px-4 py-4">
        {areaSections.map((area) => {
          const areaCards = cardsByArea.get(area.id) ?? [];
          const selectedCards = areaCards.filter((c) => c.rotation === rotation);
          const primaryMap = new Map<string, CardModel>();
          const linkMap = new Map<string, string>();
          selectedCards.forEach((c) => {
            if (c.tables.length > 1) {
              c.tables.forEach((t) => {
                const key = normalizeTableId(t);
                if (!key) return;
                linkMap.set(key, c.primaryTable);
              });
            }
            primaryMap.set(c.primaryTable, c);
          });

          const fixturesInArea = Object.entries(layout).filter(
            ([, rect]) => (rect as any).kind === 'fixture' && ((rect as any).areaId ?? area.id) === area.id
          );

          const itemsInArea = [
            ...area.tables.map((t, idx) => {
              const normalized = normalizeTableId(t);
              const rect = layout[normalized] ?? { x: 20 + idx * 24, y: 20 + idx * 24, w: TABLE_W, h: TABLE_H, areaId: area.id, kind: 'table' };
              return { id: normalized, rect: rect as LayoutEntry, type: 'table' as const };
            }),
            ...fixturesInArea.map(([fid, rect]) => ({
              id: fid,
              rect: { ...(rect as any), kind: 'fixture' } as LayoutEntry,
              type: 'fixture' as const,
            })),
          ];

          const bounds = (() => {
            const PADDING = 60;
            let maxX = 0;
            let maxY = 0;
            itemsInArea.forEach(({ rect }) => {
              const r = rect as any;
              maxX = Math.max(maxX, r.x + r.w);
              maxY = Math.max(maxY, r.y + r.h + LABEL_PAD_Y + TOP_PAD);
            });
            return {
              width: Math.max(maxX + PADDING, 360),
              height: Math.max(maxY + PADDING, 320),
            };
          })();

          const linkedTableSet = useMemo(() => {
            const set = new Set<string>();
            selectedCards.forEach((card) => {
              if (card.tables.length <= 1) return;
              card.tables.forEach((t) => set.add(normalizeTableId(t)));
            });
            return set;
          }, [selectedCards]);

          // group linked tables into a single composite card（衝突卓は除外して個別表示を優先）
          const linkedGroups = useMemo(
            () => {
              const groups: { card: CardModel; bounds: { x: number; y: number; w: number; h: number }; rects: Array<{ tableId: string; rect: LayoutEntry }> }[] = [];
              selectedCards.forEach((card) => {
                if (card.tables.length <= 1) return;
                const rects = card.tables
                  .map((t) => {
                    const key = normalizeTableId(t);
                    if (!key) return null;
                    const r = layout[key];
                    const inArea = r && (r as any).areaId === area.id;
                    const shouldHideLinked = !reassignMode && !conflictTableSet.has(key) && !conflictReservationTableSet.has(key);
                    return inArea && shouldHideLinked ? { tableId: key, rect: r as LayoutEntry } : null;
                  })
                  .filter((r): r is { tableId: string; rect: LayoutEntry } => Boolean(r));
                if (rects.length === 0) return;
                const minX = Math.min(...rects.map((r) => r.rect.x));
                const minY = Math.min(...rects.map((r) => r.rect.y));
                const maxX = Math.max(...rects.map((r) => r.rect.x + r.rect.w));
                const maxY = Math.max(...rects.map((r) => r.rect.y + r.rect.h));
                groups.push({ card, rects, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } });
              });
              return groups;
            },
            [selectedCards, layout, area.id, reassignMode, conflictTableSet, conflictReservationTableSet]
          );

          const makeHandleDrag = (itemId: string, baseRect: LayoutEntry) => (e: React.PointerEvent<HTMLDivElement>, mode: 'move' | 'resize') => {
            if (!editMode) return;
            const startX = e.clientX;
            const startY = e.clientY;
            const startRect = { ...baseRect };
            (e.currentTarget as any).setPointerCapture?.(e.pointerId);
            const SNAP = 8;
            const others = itemsInArea
              .filter((it) => it.id !== itemId)
              .map((it) => it.rect);

            const computeSnap = (candidate: LayoutEntry): { rect: LayoutEntry; guideX?: number; guideY?: number } => {
              let { x, y, w, h } = candidate;
              let gx: number | undefined;
              let gy: number | undefined;
              const edgesX = others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w]);
              const edgesY = others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h]);
              const check = (val: number, arr: number[]) => {
                let best: number | undefined;
                let delta = SNAP + 1;
                arr.forEach((target) => {
                  const d = Math.abs(val - target);
                  if (d <= SNAP && d < delta) {
                    delta = d;
                    best = target;
                  }
                });
                return best;
              };
              const snapLeft = check(x, edgesX);
              if (snapLeft != null) { gx = snapLeft; x = snapLeft; }
              const snapTop = check(y, edgesY);
              if (snapTop != null) { gy = snapTop; y = snapTop; }
              const snapRight = check(x + w, edgesX);
              if (snapRight != null) {
                const nw = Math.max(80, snapRight - x);
                w = nw;
                gx = snapRight;
              }
              const snapBottom = check(y + h, edgesY);
              if (snapBottom != null) {
                const nh = Math.max(80, snapBottom - y);
                h = nh;
                gy = snapBottom;
              }
              return { rect: { ...candidate, x, y, w, h }, guideX: gx, guideY: gy };
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
              setLayout((prev) => {
                const merged = { ...prev, [itemId]: snapped.rect };
                layoutRef.current = merged;
                return merged;
              });
              setDirty(true);
            };

            const onUp = () => {
              setGuides({});
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
              setLayout((prev) => {
                saveDayLayout(prev);
                return prev;
              });
            };

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp, { once: true });
          };

          return (
            <section key={area.id} className="rounded-xl border bg-slate-50 shadow-sm overflow-visible">
              <header className="flex items-center justify-between bg-white px-4 py-2 border-b">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{area.name}</span>
                  <span className="text-xs text-slate-500">{area.tables.length}卓</span>
                </div>
                <div className="text-xs text-slate-500">回転 {rotation}/{maxRotation}</div>
              </header>
              <div className="relative overflow-x-auto overflow-y-visible bg-slate-50">
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
                    {/* guideline overlay */}
                    {guides.x != null && (
                      <div className="absolute inset-y-0 w-px bg-sky-400/60 pointer-events-none" style={{ left: guides.x }} />
                    )}
                    {guides.y != null && (
                      <div className="absolute inset-x-0 h-px bg-sky-400/60 pointer-events-none" style={{ top: guides.y }} />
                    )}
                    {itemsInArea.map(({ id: itemId, rect }) => {
                      const isTable = rect.kind !== 'fixture';
                      const normalized = itemId;
                      const conflicts = isTable ? (conflictsByTableCurrent[normalized] ?? conflictsByTableAll[normalized] ?? []) : [];
                      const conflict = conflicts[0];
                      const primaryCard = isTable ? primaryMap.get(normalized) ?? null : null;
                      const linkedPrimary = isTable ? linkMap.get(normalized) : undefined;
                      const queue = isTable ? (tableQueues[normalized] ?? []) : [];
                      const hasFuture = isTable ? queue.length > rotation : false;
                      const capacity = isTable ? (tableCapacitiesMap[normalized] ?? 0) : 0;
                      const chairs = isTable ? computeChairs(capacity, rect) : [];
                      const hideLinkedTable = isTable
                        && linkedTableSet.has(normalized)
                        && !reassignMode
                        && !conflictTableSet.has(normalized)
                        && !conflictReservationTableSet.has(normalized);
                      if (hideLinkedTable) return null;
                      const handleDrag = makeHandleDrag(itemId, rect);
                      const sessionSelections = isTable ? (selectedTablesBySession[normalized] ?? []) : [];
                      const existingCards = isTable ? (tableCardsCurrent[normalized] ?? []) : [];
                      const existingEntries: DisplayEntry[] = isTable
                        ? existingCards.map((card) => {
                            const sid = sessionByReservationId.get(card.id);
                            const color = sid ? pickSessionColor(sid) : undefined;
                            return { card, sessionId: sid, source: 'existing', color };
                          })
                        : [];
                      const ghostEntries: DisplayEntry[] = isTable
                        ? sessionSelections
                            .filter(({ card }) => !existingCards.some((c) => c.id === card.id))
                            .map(({ sessionId, card }) => ({ card, sessionId, source: 'ghost', color: pickSessionColor(sessionId) }))
                        : [];
                      const displayEntries = isTable ? sortEntriesForDisplay([...existingEntries, ...ghostEntries]) : [];
                      const overlapPair = isTable ? findOverlapPair(displayEntries) : null;
                      const moreCount = isTable ? Math.max(0, displayEntries.length - 2) : 0;
                      const activeSelected = isTable && !!activeReassign?.selected?.map(normalizeTableId).find((t) => t === normalized);
                      const selectedByAny = isTable && sessionSelections.length > 0;
                      const frameTone = reassignMode && isTable
                        ? activeSelected
                          ? 'bg-emerald-50'
                          : selectedByAny
                            ? 'bg-emerald-50/50'
                            : ''
                        : '';
                      const tableFrameClass = isTable && reassignMode ? 'rounded-lg border-2 border-emerald-500 border-dashed p-1' : '';
                      const openConflictList = () => {
                        const rows = (tableCardsCurrent[normalized] ?? []).slice().sort((a, b) => (a.startMs - b.startMs) || (a.endMs - b.endMs));
                        setConflictModal({ tableId: normalized, rows });
                      };
                      const onTableToggle = () => {
                        if (reassignMode && activeReassignId) {
                          toggleTableSelection(normalized);
                        }
                      };
                      return (
                        <div
                          key={itemId}
                          className={`absolute ${editMode ? 'cursor-move' : ''}`}
                          style={{
                            left: rect.x,
                            top: rect.y + LABEL_PAD_Y + TOP_PAD,
                            width: rect.w,
                            height: rect.h,
                          }}
                          onPointerDown={(e) => {
                            if (!isTable && editMode) {
                              setSelectedFixture(itemId);
                            }
                            if (editMode) handleDrag(e, 'move');
                          }}
                          onClick={() => {
                            if (!editMode || isTable) return;
                            setSelectedFixture((prev) => (prev === itemId ? null : itemId));
                          }}
                        >
                        {isTable && (
                          <div className="pointer-events-none absolute -top-7 left-0 flex items-center gap-2 text-sm font-semibold">
                            <span className="text-slate-800">卓 {normalized}</span>
                            {reassignMode && activeSelected && (
                              <span className="text-[11px] font-semibold text-emerald-700">選択中</span>
                            )}
                          </div>
                        )}

                          <div className={`relative h-full w-full ${tableFrameClass} ${frameTone}`}>
                            <div className="relative h-full w-full">
                              {isTable ? (
                                (() => {
                                  const renderSplitView = (pair: { a: DisplayEntry; b: DisplayEntry }) => {
                                    const badgeNeeded = conflicts.length > 0 || moreCount > 0 || selectedByAny;
                                    const renderHalf = (entry: DisplayEntry, pos: 'a' | 'b') => {
                                      const pressKey = `${normalized}_${entry.card.id}_${pos}`;
                                      return (
                                        <button
                                          key={pressKey}
                                          type="button"
                                          className="w-full h-full text-left"
                                          onPointerDown={(e) => beginCardLongPress(pressKey, e, () => startReassignForCard(entry.card, normalized))}
                                          onPointerUp={() => cancelCardLongPress(pressKey)}
                                          onPointerLeave={() => cancelCardLongPress(pressKey)}
                                          onPointerCancel={() => cancelCardLongPress(pressKey)}
                                          onPointerMove={(e) => abortLongPressOnMove(pressKey, e)}
                                          onClick={() => {
                                            if (wasLongPressFired(pressKey)) return;
                                            if (reassignMode && activeReassignId) {
                                              onTableToggle();
                                              return;
                                            }
                                            openEditorForReservation(entry.card, normalized);
                                          }}
                                        >
                                          {renderCompactBooking(entry, { dense: reassignMode })}
                                        </button>
                                      );
                                    };
                                    return (
                                      <div className="relative h-full w-full grid grid-rows-2 gap-[6px]">
                                        {renderHalf(pair.a, 'a')}
                                        {renderHalf(pair.b, 'b')}
                                      </div>
                                    );
                                  };

                                  const renderSingleEntry = (entry: DisplayEntry) => {
                                    const pressKey = `${normalized}_${entry.card.id}_single`;
                                    return (
                                      <button
                                        type="button"
                                        className="relative w-full h-full text-left"
                                        onPointerDown={(e) => beginCardLongPress(pressKey, e, () => startReassignForCard(entry.card, normalized))}
                                        onPointerUp={() => cancelCardLongPress(pressKey)}
                                        onPointerLeave={() => cancelCardLongPress(pressKey)}
                                        onPointerCancel={() => cancelCardLongPress(pressKey)}
                                        onPointerMove={(e) => abortLongPressOnMove(pressKey, e)}
                                        onClick={() => {
                                          if (wasLongPressFired(pressKey)) return;
                                          if (reassignMode && activeReassignId) {
                                            onTableToggle();
                                            return;
                                          }
                                          openEditorForReservation(entry.card, normalized);
                                        }}
                                      >
                                        {renderReservationCard(entry.card, {
                                          highlightFuture: hasFuture,
                                          ghostColor: entry.color,
                                        })}
                                      </button>
                                    );
                                  };

                                  const renderEmpty = () => (
                                    <button
                                      type="button"
                                      className="w-full h-full rounded-md border border-slate-300 py-6 text-center text-sm text-slate-500 hover:border-slate-400"
                                      onClick={() => {
                                        if (reassignMode && activeReassignId) {
                                          onTableToggle();
                                          return;
                                        }
                                        openEditorForNew(normalized);
                                      }}
                                    >
                                      {reassignMode ? 'この卓に移動' : '空席（タップで予約）'}
                                    </button>
                                  );

                                  if (reassignMode) {
                                    // Merge conflict cards so double-booked tables still render both entries in reassign mode.
                                    const entriesForUse = (() => {
                                      if (!conflicts.length) return displayEntries;
                                      const merged = [...displayEntries];
                                      const seen = new Set(merged.map((e) => e.card.id));
                                      conflicts.forEach((pair) => {
                                        [pair.a, pair.b].forEach((card) => {
                                          if (!card?.id || seen.has(card.id)) return;
                                          merged.push({ card, source: 'existing' as const });
                                          seen.add(card.id);
                                        });
                                      });
                                      return sortEntriesForDisplay(merged);
                                    })();
                                    if (entriesForUse.length === 0) return renderEmpty();
                                    const overlap = findOverlapPair(entriesForUse);
                                    if (overlap) return renderSplitView(overlap);
                                    const preferred =
                                      entriesForUse.find((e) => e.sessionId === activeReassignId) ?? entriesForUse[0];
                                    return renderSingleEntry(preferred);
                                  }

                                  if (displayEntries.length >= 2) {
                                    return renderSplitView({ a: displayEntries[0], b: displayEntries[1] });
                                  }
                                  if (overlapPair || conflict) {
                                    const pair = overlapPair ?? (conflict
                                      ? { a: { card: conflict.a, source: 'existing' as const, color: undefined }, b: { card: conflict.b, source: 'existing' as const, color: undefined } }
                                      : null);
                                    if (pair) {
                                      return renderSplitView(pair);
                                    }
                                  }
                                  const isConflictRelated = conflictTableSet.has(normalized) || conflictReservationTableSet.has(normalized);
                                  if (isConflictRelated && displayEntries.length > 0) {
                                    return renderSingleEntry(displayEntries[0]);
                                  }
                                  if (primaryCard) {
                                    return renderSingleEntry({ card: primaryCard, source: 'existing', color: undefined });
                                  }
                                  if (linkedPrimary) {
                                    return (
                                      <div className="h-full rounded-md border border-sky-400 bg-sky-50 px-2 py-3 text-[12px] text-sky-700 flex items-center justify-center text-center">
                                        連結中 → 卓{linkedPrimary}
                                      </div>
                                    );
                                  }
                                  return renderEmpty();
                                })()
                              ) : (
                                (() => {
                                  const style = fixtureStyleMap[rect.fixtureType ?? 'other'] ?? fixtureStyleMap.other;
                                  const label = rect.label && rect.label !== rect.fixtureType ? rect.label : style.label;
                                  const shape = style.shape === 'pill' ? 'rounded-full' : 'rounded-md';
                                  const selected = selectedFixture === itemId;
                                  return (
                                    <div
                                      className={`h-full w-full ${shape} border ${style.border} ${style.bg} shadow-sm p-2 flex flex-col justify-center items-center gap-1 ${
                                        selected ? 'ring-2 ring-sky-400' : ''
                                      }`}
                                    >
                                      <div className="text-[11px] font-semibold text-slate-700">{style.label}</div>
                                      <div className="text-sm font-semibold text-slate-800">{label}</div>
                                      <div className="text-[11px] text-slate-600">ドラッグで移動 / 右下でリサイズ</div>
                                    </div>
                                  );
                                })()
                              )}
                              {chairs.length > 0 && (
                                <div className="pointer-events-none absolute inset-0">
                                  {chairs.map((pos, idx) => {
                                    const isHorizontal = pos.side === 'top' || pos.side === 'bottom';
                                    const w = isHorizontal ? CHAIR_LONG : CHAIR_SHORT;
                                    const h = isHorizontal ? CHAIR_SHORT : CHAIR_LONG;
                                    return (
                                      <div
                                        key={`${itemId}-chair-${idx}`}
                                        className="absolute rounded-full bg-slate-500 shadow-sm"
                                        style={{
                                          width: w,
                                          height: h,
                                          left: pos.cx - w / 2,
                                          top: pos.cy - h / 2,
                                          border: '1px solid rgba(51,65,85,0.55)',
                                        }}
                                      />
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>

                          {editMode && !isTable && selectedFixture === itemId && (
                            <button
                              type="button"
                              className="absolute right-1 top-1 rounded bg-rose-600 px-2 py-[2px] text-[11px] font-semibold text-white shadow"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteFixture(itemId);
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
                                handleDrag(e as any, 'resize');
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                    {!reassignMode && linkedGroups.map((group) => {
                      const { card, bounds: b } = group;
                      const totalCapacity = group.rects.reduce((sum, item) => sum + (tableCapacitiesMap[item.tableId] ?? 0), 0);
                      const labelTables = [...card.tables].map(normalizeTableId).sort(byNumericTable).filter(Boolean);
                      const baseRect = group.rects[0]?.rect;
                      const seatRect: LayoutEntry = baseRect
                        ? { ...baseRect, x: 0, y: 0, w: b.w, h: b.h }
                        : { x: 0, y: 0, w: b.w, h: b.h };
                      const compositeChairs = computeChairs(totalCapacity, seatRect);
                      const pressKey = `linked-${card.id}`;
                      const resolveTableAtPoint = (el: HTMLButtonElement, clientX: number, clientY: number) => {
                        const box = el.getBoundingClientRect();
                        const px = (clientX - box.left) / zoom;
                        const py = (clientY - box.top) / zoom;
                        const hit = group.rects.find(({ rect, tableId }) => {
                          const rx = rect.x - b.x;
                          const ry = rect.y - b.y;
                          return px >= rx && px <= rx + rect.w && py >= ry && py <= ry + rect.h ? tableId : null;
                        });
                        return hit?.tableId ?? card.primaryTable ?? labelTables[0];
                      };
                      const visual = getCardVisual(card);
                      return (
                        <div
                          key={`linked-${card.id}`}
                          className="absolute"
                          style={{ left: b.x, top: b.y + LABEL_PAD_Y + TOP_PAD, width: b.w, height: b.h }}
                        >
                          <button
                            type="button"
                            className="relative w-full h-full text-left"
                            onPointerDown={(e) => {
                              const targetTable = resolveTableAtPoint(e.currentTarget, e.clientX, e.clientY);
                              beginCardLongPress(pressKey, e, () => startReassignForCard(card, targetTable));
                            }}
                            onPointerUp={() => cancelCardLongPress(pressKey)}
                            onPointerLeave={() => cancelCardLongPress(pressKey)}
                            onPointerCancel={() => cancelCardLongPress(pressKey)}
                            onPointerMove={(e) => abortLongPressOnMove(pressKey, e)}
                            onClick={() => {
                              if (wasLongPressFired(pressKey)) return;
                              openEditorForReservation(card, card.primaryTable);
                            }}
                          >
                            <div
                              className="pointer-events-none absolute inset-0 rounded-md"
                              style={{
                                backgroundColor: visual.bg,
                                border: `1px solid ${visual.border}`,
                                boxShadow: visual.shadow,
                              }}
                            />
                            <div className="pointer-events-none absolute -top-7 left-0 text-sm font-semibold text-slate-800">
                              連結: {labelTables.join(', ')}
                            </div>
                              <div className="relative h-full w-full mt-1">
                                <div className="pointer-events-none absolute inset-0">
                                  {compositeChairs.map((pos, idx) => {
                                    const isHorizontal = pos.side === 'top' || pos.side === 'bottom';
                                    const w = isHorizontal ? CHAIR_LONG : CHAIR_SHORT;
                                  const h = isHorizontal ? CHAIR_SHORT : CHAIR_LONG;
                                  return (
                                    <div
                                      key={`linked-chair-${card.id}-${idx}`}
                                      className="absolute rounded-full bg-slate-500 shadow-sm"
                                      style={{
                                        width: w,
                                        height: h,
                                        left: pos.cx - w / 2,
                                        top: pos.cy - h / 2,
                                        border: '1px solid rgba(51,65,85,0.55)',
                                      }}
                                    />
                                  );
                                })}
                              </div>

                              {/* center the default-size table card inside the merged bounding box */}
                              <div className="absolute inset-0 grid place-items-center">
                                {(() => {
                                  const innerW = Math.min(TABLE_W, b.w);
                                  const innerH = Math.min(TABLE_H, b.h);
                                  return (
                                    <div style={{ width: innerW, height: innerH }}>
                                      {renderReservationCard(card, { hideFrame: true })}
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {reassignMode && (
        <div
          className="fixed left-0 right-0 z-[35] px-4 pointer-events-none"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 48px)' }}
        >
          <div className="pointer-events-auto mx-auto max-w-4xl rounded-2xl border bg-white shadow-xl p-3 flex flex-col gap-2">
            <div className="flex flex-wrap gap-2 items-center">
              {sessionOrder.map((sid) => {
                const session = reassignSessions[sid];
                if (!session) return null;
                const isActive = sid === activeReassignId;
                const palette = pickSessionColor(sid);
                const labelTime = fmtTime(session.base.startMs);
                const guestsLabel = Number.isFinite(session.base.guests) && (session.base.guests ?? 0) > 0 ? `${session.base.guests}名` : '';
                const baseTables = session.original.join(', ');
                return (
                  <button
                    key={sid}
                    type="button"
                    onClick={() => setActiveReassignId(sid)}
                    className={`px-3 py-1 rounded-full border text-sm transition-colors ${isActive ? 'shadow-sm' : ''}`}
                    style={{
                      backgroundColor: isActive ? (palette.fill ?? 'rgba(16,185,129,0.18)') : '#f8fafc',
                      borderColor: palette.outline ?? '#10b981',
                      color: isActive ? '#0f172a' : '#475569',
                    }}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                      style={{ backgroundColor: palette.outline ?? '#0f172a' }}
                    />
                    卓{baseTables || session.base.primaryTable} / {labelTime}{guestsLabel ? ` / ${guestsLabel}` : ''}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded border text-sm bg-white text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  if (activeReassignId) clearReassignSession(activeReassignId);
                  else clearAllReassign();
                }}
              >
                キャンセル
              </button>
              <div className="flex-1" />
              <button
                type="button"
                className="px-3 py-2 rounded border text-sm bg-white text-slate-700 hover:bg-slate-50"
                onClick={clearAllReassign}
              >
                全てクリア
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded text-sm font-semibold text-white bg-emerald-600 shadow"
                onClick={applyReassign}
              >
                適用
              </button>
            </div>
          </div>
        </div>
      )}

      <ReservationEditorDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        reservationId={editing?.id ?? undefined}
        initial={editing?.initial}
        tablesOptions={usableTables}
        coursesOptions={coursesOptions}
        eatOptions={eatOptions}
        drinkOptions={drinkOptions}
        dayStartMs={dayStartMs}
        onSave={onSave}
        onDelete={onDelete}
        onUpdateReservationField={onUpdateReservationField}
        onAdjustTaskTime={onAdjustTaskTime}
        reservationDetail={editingReservation}
        statusControls={statusControls}
      />

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
                  onClick={submitTableEdit}
                >
                  {tableEditor.mode === 'add' ? '追加' : '変更'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {conflictModal && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/40 px-4 py-6" onClick={() => setConflictModal(null)}>
          <div
            className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="text-sm font-semibold text-slate-800">卓 {conflictModal.tableId}</div>
              <button type="button" className="text-sm text-slate-500 hover:text-slate-700" onClick={() => setConflictModal(null)}>
                閉じる
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto divide-y">
              {conflictModal.rows.map((row) => (
                <button
                  key={`${row.id}_${row.startMs}`}
                  type="button"
                  className="w-full text-left px-4 py-3 hover:bg-slate-50"
                  onClick={() => {
                    openEditorForReservation(row, conflictModal.tableId);
                    setConflictModal(null);
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-800">
                        <span className="font-mono">{fmtTime(row.startMs)}</span>
                        <span className="text-xs text-slate-500">〜 {fmtTime(row.endMs)}</span>
                        <span className="text-xs text-amber-600">回転 {row.rotation}</span>
                      </div>
                      <div className="text-[12px] text-slate-700">
                        {Number.isFinite(row.guests) ? `${row.guests}名` : '人数未設定'} / {row.name || '氏名未設定'}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{row.tables.join(', ')}</div>
                    </div>
                    <div className="text-[11px] font-semibold text-slate-700 text-right max-w-[40%] truncate">
                      {row.course || '未選択'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtTime(ms: number) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
