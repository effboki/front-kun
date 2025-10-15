'use client';

import { useMemo, useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import type { UIEvent, MouseEvent, PointerEvent, WheelEvent, KeyboardEvent, CSSProperties } from 'react';
import type { ScheduleItem } from '@/types/schedule';
import type { StoreSettingsValue } from '@/types/settings';
import type { Reservation } from '@/types/reservation';
import { SLOT_MS, snap5m } from '@/lib/schedule';
import { startOfDayMs } from '@/lib/time';
import { getCourseColorStyle, normalizeCourseColor, type CourseColorStyle } from '@/lib/courseColors';
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

type UnknownRecord = Record<string, unknown>;

function patchSatisfiedByItem(item: UnknownRecord | undefined | null, patch: OptimisticPatch): boolean {
  if (!item) return false;
  for (const [key, value] of Object.entries(patch)) {
    const current = item[key];
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

// アプリ上部バー（安全領域含む）のフォールバック高さ(px)。実端末では後で実測する。
const DEFAULT_TOP_BAR_PX = 48;
// 画面下部のタブバー（フッター）高さ(px)。実端末では後で実測する。
const DEFAULT_BOTTOM_BAR_PX = 70;

type Props = {
  /** 表示開始/終了の“時”（0-24想定）。親から渡される（この子では既定値を持たない） */
  scheduleStartHour?: number;
  scheduleEndHour?: number;
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
  reservations?: Reservation[];
  onUpdateReservationField?: (
    id: string,
    field: 'completed' | 'arrived' | 'paid' | 'departed',
    value: Record<string, boolean> | boolean
  ) => void;
  onAdjustTaskTime?: (id: string, label: string, delta: number) => void;
  onToggleArrival?: (id: string) => void;
  onTogglePayment?: (id: string) => void;
  onToggleDeparture?: (id: string) => void;
  sidebarOpen?: boolean;
};

/**
 * v1 は“表示のみ”。ドラッグや新規作成は後続フェーズで追加。
 * 将来分割しやすいように、内部小コンポーネントを同ファイル内に定義。
 */
export default function ScheduleView({
  scheduleStartHour,
  scheduleEndHour,
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
  reservations,
  onUpdateReservationField,
  onAdjustTaskTime,
  onToggleArrival,
  onTogglePayment,
  onToggleDeparture,
  sidebarOpen = false,
}: Props) {
  // --- 列幅・端末判定 ---
  const headerH = 40; // 時刻ヘッダーの高さ(px)
  const CONTENT_TOP_GAP = 1; // ヘッダーと内容の安全な隙間(px)。1pxだけ下げて潜り込みを防止

  // 端末幅で判定（スマホ/タブレット）
  const [isTablet, setIsTablet] = useState(() =>
    (typeof window !== 'undefined' ? window.innerWidth >= 768 : false),
  );

  // 左の卓番号列の幅（px）: スマホ 56 / タブレット 64
  const leftColW = isTablet ? 64 : 56;
  const [topInsetPx, setTopInsetPx] = useState<number>(DEFAULT_TOP_BAR_PX);
  const [bottomInsetPx, setBottomInsetPx] = useState<number>(DEFAULT_BOTTOM_BAR_PX);
  // Display-pixel snapping to avoid subpixel drift between CSS Grid and gradients
  const snapPx = useCallback((n: number) => {
    const dpr =
      typeof window !== 'undefined' && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1;
    return Math.round(n * dpr) / Math.max(1, dpr);
  }, []);
  const contentTopPx = useMemo(() => snapPx(headerH + CONTENT_TOP_GAP), [snapPx]);
  const bottomOffsetPx = useMemo(() => snapPx(bottomInsetPx), [bottomInsetPx, snapPx]);
  const headerOffsetPx = Math.max(0, topInsetPx - DEFAULT_TOP_BAR_PX);
  // 5分スロット幅(px)。タブレットは少し広め
  const [colW, setColW] = useState(() => (typeof window !== 'undefined' && window.innerWidth >= 768 ? 12 : 6));
  const colWpx = useMemo(() => snapPx(colW), [colW, snapPx]);
  useEffect(() => {
    setColW(isTablet ? 12 : 6);
  }, [isTablet]);
  useEffect(() => {
    const onResize = () => setIsTablet(window.innerWidth >= 768); // 768px以上をタブレット相当とみなす
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;

    const measureSafeAreaBottom = () => {
      const el = document.createElement('div');
      el.style.position = 'fixed';
      el.style.bottom = '0';
      el.style.width = '0';
      el.style.height = 'env(safe-area-inset-bottom)';
      el.style.visibility = 'hidden';
      el.style.pointerEvents = 'none';
      document.body.appendChild(el);
      const val = Math.round(el.getBoundingClientRect().height || 0);
      document.body.removeChild(el);
      return val;
    };

    const updateInset = () => {
      const safe = document.querySelector('[data-app-top-safe]') as HTMLElement | null;
      const bar = document.querySelector('[data-app-top-bar]') as HTMLElement | null;
      const bottomBar = document.querySelector('[data-app-bottom-bar]') as HTMLElement | null;
      const safeHeight = safe?.getBoundingClientRect().height ?? 0;
      const barHeight = bar?.getBoundingClientRect().height ?? 0;
      const total = Math.round(safeHeight + barHeight);
      const next = total > 0 ? total : DEFAULT_TOP_BAR_PX;
      setTopInsetPx((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));

      const bottomHeightRaw = bottomBar?.getBoundingClientRect().height ?? 0;
      const safeBottom = measureSafeAreaBottom();
      const hasBottomBar = Boolean(bottomBar);
      const measuredBottom = hasBottomBar
        ? (bottomHeightRaw > 0 ? Math.round(bottomHeightRaw) : DEFAULT_BOTTOM_BAR_PX)
        : 0;
      const nextBottom = Math.max(0, Math.round(measuredBottom + safeBottom));
      setBottomInsetPx((prev) => (Math.abs(prev - nextBottom) > 0.5 ? nextBottom : prev));
    };

    updateInset();

    const handleResize = () => updateInset();

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    const viewport = typeof window.visualViewport !== 'undefined' ? window.visualViewport : undefined;
    viewport?.addEventListener('resize', handleResize);
    viewport?.addEventListener('scroll', handleResize);

    const bottomBarEl = document.querySelector('[data-app-bottom-bar]') as HTMLElement | null;
    let bottomObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && bottomBarEl) {
      bottomObserver = new ResizeObserver(() => updateInset());
      bottomObserver.observe(bottomBarEl);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      viewport?.removeEventListener('resize', handleResize);
      viewport?.removeEventListener('scroll', handleResize);
      bottomObserver?.disconnect();
    };
  }, []);

  // スクロール方向の影用（ヘッダー/左列にシャドウを付ける）
  const [scrolled, setScrolled] = useState({ x: false, y: false });
  const headerLeftOverlayRef = useRef<HTMLDivElement | null>(null);
  // ===== Floating timeline header (smartphone): fixed overlay that tracks horizontal scroll (DOM refs to minimize lag) =====
  const floatHeaderRef = useRef<HTMLDivElement | null>(null);
  const floatRailRef = useRef<HTMLDivElement | null>(null);
  const floatContentRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFloatRef = useRef<{ left: number; width: number; rail: number; contentShift: number }>({
    left: -1,
    width: -1,
    rail: -1,
    contentShift: -1,
  });

  // Apply current geometry to the floating header (called via rAF)
  const applyFloatingHeaderLayout = useCallback(() => {
    const el = scrollParentRef.current;
    const hdr = floatHeaderRef.current;
    const rail = floatRailRef.current;
    const content = floatContentRef.current;
    if (!el || !hdr || !rail || !content) return;

    const rect = el.getBoundingClientRect();
    const left = snapPx(rect.left);
    const width = snapPx(rect.width);
    const scrollLeft = snapPx(el.scrollLeft);

    const railW = snapPx(leftColW);
    const contentShift = snapPx(-scrollLeft);

    if (lastFloatRef.current.left !== left) {
      hdr.style.left = `${left}px`;
      lastFloatRef.current.left = left;
    }
    if (lastFloatRef.current.width !== width) {
      hdr.style.width = `${width}px`;
      lastFloatRef.current.width = width;
    }
    if (lastFloatRef.current.rail !== railW) {
      rail.style.width = `${railW}px`;
      lastFloatRef.current.rail = railW;
    }
    rail.style.borderRight = '1px solid #e5e7eb';
    if (lastFloatRef.current.contentShift !== contentShift) {
      content.style.transform = `translate3d(${contentShift}px,0,0)`;
      lastFloatRef.current.contentShift = contentShift;
    }
  }, [leftColW, snapPx]);

  // rAF-scheduled updater to coalesce scroll events
  const scheduleFloatingUpdate = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      applyFloatingHeaderLayout();
    });
  }, [applyFloatingHeaderLayout]);
  // ===== Scroll container axis-lock (screen-level) =====
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const scrollAxisRef = useRef<'x' | 'y' | null>(null);
  const scrollAxisSourceRef = useRef<'pointer' | 'wheel' | 'scroll' | null>(null);
  const pointerStateRef = useRef<{ x: number; y: number; active: boolean; pointerId: number | null }>({
    x: 0,
    y: 0,
    active: false,
    pointerId: null,
  });
  const lockOriginRef = useRef<{ left: number; top: number }>({ left: 0, top: 0 });
  const AXIS_LOCK_THRESHOLD_PX = 12;
  const LOCK_SLACK_PX = 18;
  const scrollIdleTimerRef = useRef<number | null>(null);
  const scrollPosRef = useRef<{ left: number; top: number }>({ left: 0, top: 0 });

  // No auto page scroll: header visibility is ensured by layering (z-index).
  const ensureHeaderNotUnderAppBar = useCallback(() => { /* intentionally empty */ }, []);
  const didAutoCenterRef = useRef(false);
  // Backup of planned duration (minutes) before marking as departed
  const departDurationBackupRef = useRef<Record<string, number>>({});

  const clearScrollIdleTimer = useCallback(() => {
    if (scrollIdleTimerRef.current) {
      window.clearTimeout(scrollIdleTimerRef.current);
      scrollIdleTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (headerLeftOverlayRef.current) {
      const raw = scrollParentRef.current?.scrollLeft ?? 0;
      const x = snapPx(raw);
      headerLeftOverlayRef.current.style.transform = `translate3d(${x}px,0,0)`;
    }
  }, [snapPx]);

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
      const usableH = Math.max(160, viewportH - (topInsetPx + bottomInsetPx));
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
  }, [topInsetPx, bottomInsetPx, rowHeightPx]);

  // 実際に使う行高：ビュー由来の自動計算と指定値のうち大きい方
  const effectiveRowH = Math.max(rowHeightPx, autoRowH);

  const [pendingMutations, setPendingMutations] = useState<Record<string, OptimisticPatch>>({});
  // Long-press arming: only an "armed" card can be dragged/resized
  const [armedId, setArmedId] = useState<string | null>(null);
  // ---- Card-tap action & table reassign mode ----
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<(ScheduleItem & { _startCol?: number; _spanCols?: number; _row?: number; _table?: string; _key?: string }) | null>(null);
  const [reassign, setReassign] = useState<{ base: ScheduleItem & { _startCol: number; _spanCols: number; _row?: number; _table?: string; _key?: string }; selected: string[]; original: string[] } | null>(null);
  // --- ポップオーバー座標 ---
  const [actionBubble, setActionBubble] = useState<{ left: number; top: number } | null>(null);
  // Axis-lock for DnD (x or y). Decided per drag and reset on end.
  const axisLockRef = useRef<'x' | 'y' | null>(null);

  const applyScrollLock = useCallback((axis: 'x' | 'y' | null) => {
    const el = scrollParentRef.current;
    if (!el) return;
    el.style.overflowX = 'auto';
    el.style.overflowY = 'auto';
    if (axis === 'x') {
      (el.style as any).touchAction = 'pan-x';
    } else if (axis === 'y') {
      (el.style as any).touchAction = 'pan-y';
    } else {
      (el.style as any).touchAction = 'pan-x pan-y';
    }
  }, []);

  const releaseScrollAxisLock = useCallback((source?: 'pointer' | 'wheel' | 'scroll') => {
    if (source && scrollAxisSourceRef.current && scrollAxisSourceRef.current !== source) return;
    scrollAxisRef.current = null;
    scrollAxisSourceRef.current = null;
    applyScrollLock(null);
    clearScrollIdleTimer();
  }, [applyScrollLock, clearScrollIdleTimer]);

  const scheduleScrollIdleReset = useCallback((source: 'wheel' | 'scroll', delay = 160) => {
    clearScrollIdleTimer();
    scrollIdleTimerRef.current = window.setTimeout(() => {
      releaseScrollAxisLock(source);
    }, delay) as unknown as number;
  }, [clearScrollIdleTimer, releaseScrollAxisLock]);

  const lockScrollAxis = useCallback((axis: 'x' | 'y', source: 'pointer' | 'wheel' | 'scroll', el: HTMLDivElement, origin?: { left: number; top: number }) => {
    scrollAxisRef.current = axis;
    scrollAxisSourceRef.current = source;

    const base = origin ?? { left: el.scrollLeft, top: el.scrollTop };

    if (axis === 'x') {
      lockOriginRef.current = { left: el.scrollLeft, top: base.top };
      scrollPosRef.current = { left: el.scrollLeft, top: lockOriginRef.current.top };
    } else {
      lockOriginRef.current = { left: base.left, top: el.scrollTop };
      scrollPosRef.current = { left: lockOriginRef.current.left, top: el.scrollTop };
    }

    applyScrollLock(axis);
  }, [applyScrollLock]);

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const axis = scrollAxisRef.current;
    const prev = scrollPosRef.current;
    const currentLeft = el.scrollLeft;
    const currentTop = el.scrollTop;

    if (!axis) {
      const dx = Math.abs(currentLeft - prev.left);
      const dy = Math.abs(currentTop - prev.top);

      if (pointerStateRef.current.active && (dx >= AXIS_LOCK_THRESHOLD_PX || dy >= AXIS_LOCK_THRESHOLD_PX)) {
        const origin = lockOriginRef.current;
        const nextAxis: 'x' | 'y' = dx > dy + 4 ? 'x' : 'y';
        lockScrollAxis(nextAxis, 'pointer', el, origin);
      } else {
        scrollPosRef.current = { left: currentLeft, top: currentTop };
      }
    }

    if (scrollAxisRef.current === 'x') {
      const lockedTop = lockOriginRef.current.top;
      if (pointerStateRef.current.active && Math.abs(currentTop - lockedTop) > LOCK_SLACK_PX) {
        el.scrollTop = lockedTop;
        scrollPosRef.current.top = lockedTop;
      } else {
        scrollPosRef.current.top = currentTop;
        lockOriginRef.current.top = currentTop;
      }
      scrollPosRef.current.left = el.scrollLeft;
      const source = scrollAxisSourceRef.current;
      if (source === 'wheel' || source === 'scroll') {
        scheduleScrollIdleReset(source);
      }
    } else if (scrollAxisRef.current === 'y') {
      const lockedLeft = lockOriginRef.current.left;
      if (pointerStateRef.current.active && Math.abs(currentLeft - lockedLeft) > LOCK_SLACK_PX) {
        el.scrollLeft = lockedLeft;
        scrollPosRef.current.left = lockedLeft;
      } else {
        scrollPosRef.current.left = currentLeft;
        lockOriginRef.current.left = currentLeft;
      }
      scrollPosRef.current.top = el.scrollTop;
      const source = scrollAxisSourceRef.current;
      if (source === 'wheel' || source === 'scroll') {
        scheduleScrollIdleReset(source);
      }
    } else {
      scrollPosRef.current = { left: currentLeft, top: currentTop };
    }

    const nx = el.scrollLeft > 1;
    const ny = el.scrollTop > 1;
    setScrolled(prev => (prev.x === nx && prev.y === ny ? prev : { x: nx, y: ny }));
    if (headerLeftOverlayRef.current) {
      const x = snapPx(el.scrollLeft);
      headerLeftOverlayRef.current.style.transform = `translate3d(${x}px,0,0)`;
    }
    // keep floating header aligned with horizontal scroll (smartphone) via rAF
    if (!isTablet) {
      applyFloatingHeaderLayout();
    }
    scheduleFloatingUpdate();
  }, [lockScrollAxis, scheduleScrollIdleReset, scheduleFloatingUpdate, applyFloatingHeaderLayout, snapPx, isTablet]);
  useLayoutEffect(() => {
    applyFloatingHeaderLayout();
    const onWin = () => applyFloatingHeaderLayout();
    window.addEventListener('resize', onWin);
    window.addEventListener('orientationchange', onWin);
    document.addEventListener('visibilitychange', onWin);
    return () => {
      window.removeEventListener('resize', onWin);
      window.removeEventListener('orientationchange', onWin);
      document.removeEventListener('visibilitychange', onWin);
    };
  }, [applyFloatingHeaderLayout]);

  useLayoutEffect(() => {
    const hdr = floatHeaderRef.current;
    if (hdr) hdr.style.top = `${topInsetPx}px`;
    applyFloatingHeaderLayout();
  }, [applyFloatingHeaderLayout, leftColW, topInsetPx]);

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

  // 設定画面のコース定義も取り込み（props + storeSettings を統合）
  const courseDefs = useMemo<any[]>(() => {
    const out: any[] = [];
    if (Array.isArray(coursesOptions)) out.push(...(coursesOptions as any[]));
    const ss: any = storeSettings as any;
    const fromSettings =
      ss?.courses ??
      ss?.courseOptions ??
      ss?.coursesOptions ??
      ss?.plans ??
      ss?.courseDefs ??
      ss?.course_list ??
      ss?.courseSettings;
    if (Array.isArray(fromSettings)) {
      out.push(...fromSettings);
    } else if (fromSettings && typeof fromSettings === 'object') {
      // name -> minutes の連想配列にも対応
      for (const [k, v] of Object.entries(fromSettings)) {
        if (v && typeof v === 'object') out.push({ name: k, ...(v as any) });
        else if (typeof v === 'number') out.push({ name: k, minutes: v });
      }
    }
    return out;
  }, [coursesOptions, storeSettings]);

  const courseColorMap = useMemo(() => {
    const map = new Map<string, CourseColorStyle>();
    (courseDefs ?? []).forEach((def: any) => {
      const rawName = String((def?.value ?? def?.name ?? def?.label ?? def?.title ?? '') || '').trim();
      if (!rawName) return;
      const colorKey = normalizeCourseColor(def?.color ?? def?.courseColor);
      map.set(rawName, getCourseColorStyle(colorKey));
    });
    map.set('未選択', getCourseColorStyle(null));
    return map;
  }, [courseDefs]);
  // === コース規定の滞在時間 → 分（fallback 120） ===
  const getCourseStayMin = useCallback((course?: string | null) => {
    if (!course) return 120;
    const name = String(course).trim();

    const pickMinutes = (o: any) => (
      o?.stayMinutes ?? o?.stayMin ?? o?.durationMin ?? o?.durationMinutes ?? o?.minutes ?? o?.lengthMin ?? o?.lengthMinutes ?? o?.duration ?? o?.stay
    );

    // 1) 厳密一致（value/name/label/title）
    const found = (courseDefs ?? []).find((o: any) => {
      const v = String((o?.value ?? o?.name ?? o?.label ?? o?.title ?? '') || '').trim();
      return v === name;
    });
    let raw = pickMinutes(found);

    // 2) 空白無視・小文字化でのルーズ一致
    if (raw == null) {
      const key = name.replace(/\s+/g, '').toLowerCase();
      const f2 = (courseDefs ?? []).find((o: any) => {
        const v = String((o?.value ?? o?.name ?? o?.label ?? o?.title ?? '') || '')
          .replace(/\s+/g, '')
          .toLowerCase();
        return v === key;
      });
      raw = pickMinutes(f2);
    }

    const n = Math.trunc(Number(raw));
    return Number.isFinite(n) && n > 0 ? n : 120;
  }, [courseDefs]);

  // === 予約の終了 ms を計算（durationMin を優先。無ければコース規定）===
  const computeEndMsFor = useCallback((it: any) => {
    const start = Math.max(0, Number(it?.startMs ?? 0));
    const over = it?.durationMin;
    const minutes =
      over != null && Number.isFinite(Number(over))
        ? Math.trunc(Number(over))
        : getCourseStayMin(it?.course ?? it?.courseName);
    const mins = Math.max(5, minutes); // 最低 5 分
    return start + mins * 60_000;
  }, [getCourseStayMin]);

  // === Edited-dot control (only for: startMs, tables, course, guests) ===
  const buildEditSignature = useCallback((it: any) => {
    const start = Math.max(0, Number(it?.startMs ?? 0));
    const course = String((it?.course ?? it?.courseName ?? '') || '').trim();
    const guestsRaw = (it?.people ?? it?.guests);
    const guests = Number.isFinite(Number(guestsRaw)) ? Math.max(0, Math.trunc(Number(guestsRaw))) : 0;
    const arr = Array.isArray(it?.tables)
      ? (it.tables as any[]).map((t) => String(t)).filter(Boolean).sort()
      : [];
    const tablesKey = arr.join(',');
    return `${start}|${tablesKey}|${course}|${guests}`;
  }, []);

  // Keep previous signature per reservation id (across renders)
  const prevEditSigRef = useRef<Record<string, string>>({});
  // Allowed yellow-dot display window per reservation id
  const editedAllowedUntilRef = useRef<Record<string, number>>({});
  const editedExpiryTimerRef = useRef<number | null>(null);
  const [editedPulse, setEditedPulse] = useState(0);

  // Update allowed window when an edited item has signature changed
  useEffect(() => {
    const nextSigMap: Record<string, string> = {};
    const now = Date.now();
    for (const it of data) {
      const id = String((it as any).id ?? (it as any)._key ?? '');
      if (!id) continue;
      const sig = buildEditSignature(it);
      nextSigMap[id] = sig;
      const prevSig = prevEditSigRef.current[id];
      const editedUntil = Number((it as any).editedUntilMs ?? 0);
      const editedActive = Number.isFinite(editedUntil) && now <= editedUntil && editedUntil > 0;
      if (editedActive && prevSig != null && prevSig !== sig) {
        const prevUntil = editedAllowedUntilRef.current[id] ?? 0;
        editedAllowedUntilRef.current[id] = Math.max(prevUntil, editedUntil);
      }
    }
    prevEditSigRef.current = nextSigMap;

    if (editedExpiryTimerRef.current != null) {
      window.clearTimeout(editedExpiryTimerRef.current);
      editedExpiryTimerRef.current = null;
    }
    let nextExpiry = Number.POSITIVE_INFINITY;
    for (const until of Object.values(editedAllowedUntilRef.current)) {
      const u = Number(until);
      if (Number.isFinite(u) && u > now) {
        nextExpiry = Math.min(nextExpiry, u);
      }
    }
    if (Number.isFinite(nextExpiry) && nextExpiry !== Number.POSITIVE_INFINITY) {
      const delay = Math.max(16, Math.min(120_000, nextExpiry - now + 20));
      editedExpiryTimerRef.current = window.setTimeout(() => {
        editedExpiryTimerRef.current = null;
        setEditedPulse((v) => v + 1);
      }, delay) as unknown as number;
    } else {
      editedExpiryTimerRef.current = null;
    }
    // ensure highlight updates promptly when data changes
    setEditedPulse((v) => v + 1);
    return () => {
      if (editedExpiryTimerRef.current != null) {
        window.clearTimeout(editedExpiryTimerRef.current);
        editedExpiryTimerRef.current = null;
      }
    };
  }, [data, buildEditSignature]);

  // Snapshot of ids that should show the yellow edited dot at this moment
  const editedAllowedIds = useMemo(() => {
    const out = new Set<string>();
    const now = Date.now();
    const m = editedAllowedUntilRef.current;
    for (const [id, until] of Object.entries(m)) {
      if (now <= Number(until)) out.add(id);
    }
    return out;
  }, [data, editedPulse]);

  // 4.5) 同卓 & 時間重複の衝突インデックス（⚠️表示用）
  const conflictSet = useMemo(() => {
    // tableId -> intervals [{ key, startMs, endMs }]
    const perTable: Record<string, { key: string; startMs: number; endMs: number }[]> = {};
    for (const it of data) {
      const start = it.startMs;
      const end = computeEndMsFor(it);
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
  }, [data, computeEndMsFor]);

  // === 基準日 0:00ms（親から渡される dayStartMs があればそれを使用） ===
  const day0 = useMemo(() => startOfDayMs(dayStartMs ?? Date.now()), [dayStartMs]);

  // 親から渡された表示時間（子では既定値を持たない）
  const { anchorStartMs, rangeEndMs, windowHours } = useMemo(() => {
    const rawStart = Number(scheduleStartHour);
    const startHour = Number.isFinite(rawStart) ? Math.trunc(rawStart) : 0;
    const rawEnd = Number(scheduleEndHour);
    const diff = Number.isFinite(rawEnd) ? rawEnd - startHour : 0;
    // If parent doesn't specify end hour, default visible window:
    // - smartphone: 4h
    // - tablet: 7h
    const fallbackHours = isTablet ? 7 : 4;
    const windowH = diff > 0 ? Math.max(4, diff) : fallbackHours;
    const startMs = day0 + startHour * 60 * 60 * 1000;
    const endMs = startMs + windowH * 60 * 60 * 1000;
    return { anchorStartMs: startMs, rangeEndMs: endMs, windowHours: windowH };
  }, [day0, scheduleStartHour, scheduleEndHour, isTablet]);

  // 3) 列数（5分 = 1 列）: (時間差 * 60分) / SLOT_MIN = (時間差 * 3600000) / SLOT_MS
  const nCols = useMemo(() => {
    const diffMs = windowHours * 60 * 60 * 1000;
    return Math.max(1, Math.round(diffMs / SLOT_MS));
  }, [windowHours, SLOT_MS]);

  const resetScrollOffsets = useCallback(() => {
    const container = scrollParentRef.current;
    if (!container) return;

    const forceReset = () => {
      if (!container) return;
      if (container.scrollTop !== 0) {
        container.scrollTop = 0;
      }
      if (container.scrollLeft !== 0) {
        container.scrollLeft = 0;
      }
    };

    forceReset();
    requestAnimationFrame(forceReset);
    setTimeout(forceReset, 120);

    scrollPosRef.current = { left: container.scrollLeft, top: container.scrollTop };
    lockOriginRef.current = { left: container.scrollLeft, top: container.scrollTop };
  }, []);

  const restoreViewportScroll = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const scrollingElement = document.scrollingElement;
      const docEl = document.documentElement;
      const body = document.body;

      if (scrollingElement && scrollingElement.scrollTop !== 0) {
        scrollingElement.scrollTop = 0;
      }
      if (docEl && docEl.scrollTop !== 0) {
        docEl.scrollTop = 0;
      }
      if (body && body.scrollTop !== 0) {
        body.scrollTop = 0;
      }
      if (typeof window.scrollTo === 'function') {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    } catch {
      // ignore scroll restoration failures (iOS quirks etc.)
    }
  }, []);

  const recomputeColWidth = useCallback(() => {
    const el = scrollParentRef.current;
    const viewport = el?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 0);
    if (!viewport) return;
    const slotMs = SLOT_MS;
    const hoursToFit = isTablet ? 7 : 4; // tablet ~7h / phone ~4h
    const visibleCols = Math.max(1, Math.round((hoursToFit * 60 * 60 * 1000) / slotMs));
    const desired = (viewport - leftColW) / visibleCols;
    if (!Number.isFinite(desired) || desired <= 0) return;
    const min = isTablet ? 9 : 4.5;
    const max = isTablet ? 18 : 9;
    // ★ 小数pxをデバイスピクセルに丸める
    const snapped = snapPx(Math.max(min, Math.min(max, desired)));
    setColW((prev) => (Math.abs(prev - snapped) > 0.25 ? snapped : prev));
  }, [isTablet, leftColW, SLOT_MS, snapPx]);

  useLayoutEffect(() => {
    recomputeColWidth();

    const handleResize = () => recomputeColWidth();
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        requestAnimationFrame(() => {
          recomputeColWidth();
          resetScrollOffsets();
        });
      }
    };

    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibility);

    let observer: ResizeObserver | undefined;
    const el = scrollParentRef.current;
    if (typeof ResizeObserver !== 'undefined' && el) {
      observer = new ResizeObserver(() => recomputeColWidth());
      observer.observe(el);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibility);
      observer?.disconnect();
    };
  }, [recomputeColWidth, resetScrollOffsets]);

  // Ensure the schedule container is not hidden under the top app bar
  useLayoutEffect(() => {
    // Run immediately and again after layout settles
    const run = () => ensureHeaderNotUnderAppBar();
    run();
    // a couple of delayed runs to cover async layout/route transitions
    const t1 = window.setTimeout(run, 0);
    const t2 = window.setTimeout(run, 150);

    const handle = () => ensureHeaderNotUnderAppBar();
    window.addEventListener('resize', handle);
    window.addEventListener('orientationchange', handle);
    document.addEventListener('visibilitychange', handle);
    window.addEventListener('focus', handle);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('resize', handle);
      window.removeEventListener('orientationchange', handle);
      document.removeEventListener('visibilitychange', handle);
      window.removeEventListener('focus', handle);
    };
  }, [ensureHeaderNotUnderAppBar]);

  useEffect(() => {
    const container = scrollParentRef.current;
    if (!container || typeof IntersectionObserver === 'undefined') return;

    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          requestAnimationFrame(() => {
            resetScrollOffsets();
            ensureHeaderNotUnderAppBar();
          });
        }
      });
    }, { threshold: 0.2 });

    obs.observe(container);
    return () => obs.disconnect();
  }, [resetScrollOffsets, ensureHeaderNotUnderAppBar]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;

    const run = () => {
      restoreViewportScroll();
      resetScrollOffsets();
    };

    run();

    const rafId = window.requestAnimationFrame(run);
    const timers: number[] = [];
    [120, 320, 640].forEach((ms) => {
      timers.push(window.setTimeout(run, ms));
    });

    return () => {
      window.cancelAnimationFrame(rafId);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [resetScrollOffsets, restoreViewportScroll]);

  useEffect(() => {
    didAutoCenterRef.current = false;
  }, [anchorStartMs, rangeEndMs, nCols, colWpx, leftColW]);

  useEffect(() => {
    if (didAutoCenterRef.current) return;
    const el = scrollParentRef.current;
    if (!el) return;

    const now = Date.now();
    if (!(now >= anchorStartMs && now <= rangeEndMs)) {
      didAutoCenterRef.current = true;
      return;
    }

    const viewport = el.clientWidth;
    const contentWidth = leftColW + nCols * colWpx;
    if (!viewport || contentWidth <= viewport) {
      didAutoCenterRef.current = true;
      return;
    }

    const offsetInTimeline = ((now - anchorStartMs) / SLOT_MS) * colWpx;
    const desired = leftColW + offsetInTimeline - viewport / 2;
    const maxScroll = Math.max(0, contentWidth - viewport);
    const nextLeft = Math.max(0, Math.min(desired, maxScroll));

    if (!Number.isFinite(nextLeft)) {
      didAutoCenterRef.current = true;
      return;
    }

    requestAnimationFrame(() => {
      const target = scrollParentRef.current;
      if (!target) return;
      target.scrollLeft = nextLeft;
      scrollPosRef.current.left = nextLeft;
      scrollPosRef.current.top = target.scrollTop;
      lockOriginRef.current.left = nextLeft;
      lockOriginRef.current.top = target.scrollTop;
      didAutoCenterRef.current = true;
    });
  }, [anchorStartMs, rangeEndMs, nCols, colWpx, leftColW]);

  // 1時間あたりのカラム数（SLOT_MS=5分なら 12）と、1時間のピクセル幅（ピクセルスナップ済みを使用）
  const colsPerHour = Math.round((60 * 60 * 1000) / SLOT_MS);
  const hourPx = useMemo(() => snapPx(colWpx * colsPerHour), [snapPx, colWpx, colsPerHour]);
  const minorSolidStepPx = useMemo(() => snapPx(6 * colWpx), [snapPx, colWpx]); // 30分

  // 当日0:00基準（保存・変換は必ず「その日の0:00」基準）
  // （上で day0 を定義済み）
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

  const tableCapacitiesMap = useMemo<Record<string, number>>(() => {
    const raw = storeSettings?.tableCapacities;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      const id = String(key ?? '').trim();
      if (!id) continue;
      const num = Number(val);
      if (!Number.isFinite(num) || num <= 0) continue;
      out[id] = Math.max(1, Math.round(num));
    }
    return out;
  }, [storeSettings?.tableCapacities]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; initial: Partial<ReservationInput> & { table?: string } } | null>(null);

  const editingReservation = useMemo(() => {
    if (!editing?.id || !Array.isArray(reservations)) return null;
    return reservations.find((r) => r.id === editing.id) ?? null;
  }, [editing?.id, reservations]);

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
        durationMin: (it as any).durationMin ?? null,
        drinkAllYouCan: Boolean((it as any).drink || (it as any).drinkLabel),
        foodAllYouCan: Boolean((it as any).eat || (it as any).eatLabel),
        drinkLabel: (it as any).drinkLabel ?? (it as any).drink ?? '',
        eatLabel: (it as any).eatLabel ?? (it as any).eat ?? '',
        memo: (it as any).notes ?? (it as any).memo ?? '',
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
    runSave(baseId, patch, { tables: picked, table: picked[0], editedUntilMs: Date.now() + 15000 });
    setReassign(null);
  }, [reassign, runSave]);

  // 5) レンジ内にかかる予約のみ描画（範囲外はスキップ）
  const clipped = useMemo(() => {
    const out: (ScheduleItem & { _startCol: number; _spanCols: number; _row: number; _table?: string; status?: 'warn'; _key?: string; _editedAllowed?: boolean })[] = [];
    for (const it of data) {
      // 予約が一切レンジにかからない場合はスキップ
      const endEff = computeEndMsFor(it);
      const visStart = Math.max(it.startMs, anchorStartMs);
      const visEnd = Math.min(endEff, rangeEndMs);
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
        out.push({
          ...it,
          status: warn ? 'warn' : undefined,
          _startCol: startCol,
          _spanCols: spanCols,
          _row: row,
          _table: tStr,
          _editedAllowed: editedAllowedIds.has(String(it.id ?? it._key ?? '')),
        });
      }
    }
    return out;
  }, [data, anchorStartMs, rangeEndMs, tableIndex, conflictSet, computeEndMsFor, editedAllowedIds]);

  const stacked = useMemo(() => {
    // 同一卓内で時間が重なる予約を縦にずらすためのスタックインデックスを付与
    const byRow: Record<string, any[]> = {};
    for (const it of clipped) {
      const key = String((it as any)._table ?? (it as any)._row);
      (byRow[key] ??= []).push(it);
    }

    const out: any[] = [];
    for (const [_, arr] of Object.entries(byRow)) {
      // 開始時刻→終了時刻（計算済みend）で安定ソート
      arr.sort((a, b) => (a.startMs - b.startMs) || (computeEndMsFor(a) - computeEndMsFor(b)));
      // アクティブ区間（終了時刻と割当て済みスタック番号）
      const active: { end: number; idx: number }[] = [];
      for (const it of arr) {
        const end = computeEndMsFor(it);
        // 終了したものを除去
        for (let i = active.length - 1; i >= 0; i--) {
          if (active[i].end <= it.startMs) active.splice(i, 1);
        }
        // 使われていない最小のスタック番号を割当て
        const used = new Set(active.map(a => a.idx));
        let idx = 0;
        while (used.has(idx)) idx++;
        (it as any)._stackIndex = idx;
        active.push({ end, idx });
      }
      out.push(...arr);
    }
    return out;
  }, [clipped, computeEndMsFor]);

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
    const cardLeft = (startCol - 1) * colWpx;
    const cardWidth = spanCols * colWpx;
    const cardRight = cardLeft + cardWidth;

    // 水平位置はカード中央に。はみ出す場合はクランプ。
    let left = cardLeft + (cardWidth - bubbleW) / 2;
    const maxLeft = nCols * colWpx - bubbleW;
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
  }, [rowHeightsPx, rowStackCount, effectiveRowH, colWpx, nCols]);

  // 同じカードが最新データで更新されたら、メニュー表示中でも状態を同期する
  useEffect(() => {
    if (!actionTarget) return;
    const targetId = String(actionTarget.id ?? '');
    const targetTable = String((actionTarget as any)._table ?? '');
    const next = (stacked as any[]).find((it) => {
      if (!it) return false;
      const sameId = String(it.id ?? '') === targetId;
      const sameTable = String((it as any)._table ?? '') === targetTable;
      return sameId && sameTable;
    });

    if (!next) {
      setActionTarget(null);
      setActionMenuOpen(false);
      return;
    }

    const keysToSync = [
      'arrived',
      'paid',
      'departed',
      'freshUntilMs',
      'editedUntilMs',
      '_startCol',
      '_spanCols',
      '_row',
      '_table',
      '_stackIndex',
      'startMs',
      'endMs',
    ];

    const changed = keysToSync.some((key) => (next as any)[key] !== (actionTarget as any)[key]);
    if (changed) {
      setActionTarget({ ...(next as any) });
    }
  }, [stacked, actionTarget]);

  const handleStatusToggle = useCallback(
    (kind: 'arrived' | 'paid' | 'departed') => {
      if (!actionTarget) return;
      const raw: any = actionTarget as any;
      const id = String(raw.id ?? ''); // real DB id (may be empty in demo)
      const key = String(raw.id ?? raw._key ?? ''); // fallback to _key for optimistic UI
      const current = Boolean(raw[kind]);
      const next = !current;

      // --- Special handling for "departed" ---
      if (kind === 'departed') {
        const startMs = Math.max(0, Number(raw.startMs ?? 0));
        if (next) {
          // going to departed=true → shorten to now (5m snap) and backup the planned duration
          const planned: number = Number.isFinite(Number(raw.durationMin)) && Number(raw.durationMin) > 0
            ? Math.trunc(Number(raw.durationMin))
            : getCourseStayMin(raw.course ?? raw.courseName);
          if (key) departDurationBackupRef.current[key] = planned;

          const nowSnap = snap5m(Date.now());
          const rawMin = Math.round((nowSnap - startMs) / 60000);
          const durationMin = Math.max(5, rawMin);

          if (key) applyOptimistic(key, { durationMin });
          if (id && onSave) runSave(id, { durationMin });
        } else {
          // turning departed=false → restore backed-up planned duration
          const planned = (key && departDurationBackupRef.current[key] != null)
            ? departDurationBackupRef.current[key]
            : (Number.isFinite(Number(raw.durationMin)) && Number(raw.durationMin) > 0
                ? Math.trunc(Number(raw.durationMin))
                : getCourseStayMin(raw.course ?? raw.courseName));

          if (key) applyOptimistic(key, { durationMin: planned });
          if (id && onSave) runSave(id, { durationMin: planned });
          if (key) delete departDurationBackupRef.current[key];
        }
      }

      // Keep existing flag toggle behavior (call site-provided handlers if any)
      if (kind === 'arrived') {
        if (id && typeof onToggleArrival === 'function') onToggleArrival(id);
        else if (id && typeof onUpdateReservationField === 'function') onUpdateReservationField(id, 'arrived', next);
      } else if (kind === 'paid') {
        if (id && typeof onTogglePayment === 'function') onTogglePayment(id);
        else if (id && typeof onUpdateReservationField === 'function') onUpdateReservationField(id, 'paid', next);
      } else {
        if (id && typeof onToggleDeparture === 'function') onToggleDeparture(id);
        else if (id && typeof onUpdateReservationField === 'function') onUpdateReservationField(id, 'departed', next);
      }

      // Reflect UI state of the action popover immediately
      setActionTarget((prev) => {
        if (!prev) return prev;
        const prevId = String((prev as any).id ?? '');
        if (prevId && id && prevId !== id) return prev;
        const updated: any = { ...prev, [kind]: next };
        if (kind === 'departed' && next) {
          updated.arrived = false; // departed implies no longer "arrived"
        }
        return updated;
      });
    },
    [actionTarget, onToggleArrival, onTogglePayment, onToggleDeparture, onUpdateReservationField, onSave, runSave, applyOptimistic, getCourseStayMin]
  );

  const actionStatus = {
    arrived: Boolean((actionTarget as any)?.arrived),
    paid: Boolean((actionTarget as any)?.paid),
    departed: Boolean((actionTarget as any)?.departed),
  } as const;

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
      const deltaCols = Math.round(deltaX / colWpx);
      if (!deltaCols) return;
      const newStartCol = Math.max(1, startCol + deltaCols);
      const newStartMs = startMsFromCol(newStartCol);
      const newEndMs = endMsFromColSpan(newStartCol, spanCols);
      const patch: any = {
        startMs: newStartMs,
        endMs: newEndMs,
        durationMin: durationMinFromSpan(spanCols),
      };
      runSave(baseId, patch, { startMs: newStartMs, endMs: newEndMs, editedUntilMs: Date.now() + 15000 });
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

      runSave(baseId, patch, { tables: deduped, table: patch.table, editedUntilMs: Date.now() + 15000 });
      setArmedId(null);
    }
  }, [onSave, runSave, clipped, colWpx, startMsFromCol, endMsFromColSpan, durationMinFromSpan, effectiveRowH, tables, setArmedId, rowHeightsPx]);

// DnD センサー: 長押ししてからドラッグ開始（スクロールを妨げない）
const sensors = useSensors(
  useSensor(PointerSensor),
  // 長押ししてからドラッグ開始（スクロールを妨げない）
  useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
);

// --- Axis lock: decide axis on first movement, keep until drag ends ---
const handleDragStart = useCallback(() => {
  axisLockRef.current = null; // ドラッグ開始ごとにリセット
}, []);

const handleDragMove = useCallback((e: any) => {
  // まだ軸が決まっていない最初の有意な移動で軸を確定
  if (axisLockRef.current) return;
  const dx = Math.abs(e?.delta?.x ?? 0);
  const dy = Math.abs(e?.delta?.y ?? 0);
  if (dx >= 1 || dy >= 1) {
    axisLockRef.current = dx >= dy ? 'x' : 'y';
  }
}, []);

  // Modifier that forces movement to a single axis (locks the weaker axis to 0)
  const axisLockModifier: any = useCallback((args: any) => {
    const t = args?.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1 };
    const lock = axisLockRef.current;
    if (lock === 'x') return { ...t, y: 0 };
    if (lock === 'y') return { ...t, x: 0 };
    const ax = Math.abs(t.x ?? 0);
    const ay = Math.abs(t.y ?? 0);
    if (ax >= ay) return { ...t, y: 0 };
    return { ...t, x: 0 };
  }, []);

  // 空きマスクリックで新規予約を作成
  const handleGridClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
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
    let col = Math.floor(x / colWpx) + 1;
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
  }, [nCols, anchorStartMs, tables, colWpx, rowHeightsPx, actionMenuOpen]);

  // Pointer-based axis decision (touch/pen/mouse drag on the scroll area)
  const handleScrollPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse') return;

    const el = e.currentTarget;
    releaseScrollAxisLock();
    clearScrollIdleTimer();
    pointerStateRef.current = { x: e.clientX, y: e.clientY, active: true, pointerId: e.pointerId };
    lockOriginRef.current = { left: el.scrollLeft, top: el.scrollTop };
    scrollPosRef.current = { left: el.scrollLeft, top: el.scrollTop };
  }, [releaseScrollAxisLock, clearScrollIdleTimer]);

  const handleScrollPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!pointerStateRef.current.active || scrollAxisRef.current) return;
    const dx = Math.abs(e.clientX - pointerStateRef.current.x);
    const dy = Math.abs(e.clientY - pointerStateRef.current.y);
    if (dx >= AXIS_LOCK_THRESHOLD_PX || dy >= AXIS_LOCK_THRESHOLD_PX) {
      const axis: 'x' | 'y' = dx > dy ? 'x' : 'y';
      lockScrollAxis(axis, 'pointer', e.currentTarget, lockOriginRef.current);
    }
  }, [lockScrollAxis]);

  const handleScrollPointerUp = useCallback((e?: PointerEvent<HTMLDivElement>) => {
    const el = e?.currentTarget ?? scrollParentRef.current;
    const pointerId = e?.pointerId ?? pointerStateRef.current.pointerId;
    if (el && typeof el.releasePointerCapture === 'function' && pointerId != null) {
      try {
        if (el.hasPointerCapture?.(pointerId)) {
          el.releasePointerCapture(pointerId);
        }
      } catch (_) {
        // ignore (unsupported environment)
      }
    }
    pointerStateRef.current = { x: 0, y: 0, active: false, pointerId: null };
    if (el) {
      scrollPosRef.current = { left: el.scrollLeft, top: el.scrollTop };
      lockOriginRef.current = { left: el.scrollLeft, top: el.scrollTop };
    }
    clearScrollIdleTimer();
    if (scrollAxisRef.current) {
      scheduleScrollIdleReset('scroll', 240);
    } else {
      applyScrollLock(null);
    }
  }, [applyScrollLock, clearScrollIdleTimer, scheduleScrollIdleReset]);

  // Wheel axis lock (desktop trackpad/mouse)
  const handleWheelLock = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const target = scrollParentRef.current;
    if (!target) return;
    if (!scrollAxisRef.current) {
      const ax = Math.abs(e.deltaX);
      const ay = Math.abs(e.deltaY);
      if (ax === 0 && ay === 0) return;
      const axis: 'x' | 'y' = ax > ay * 1.1 ? 'x' : 'y';
      lockScrollAxis(axis, 'wheel', target, scrollPosRef.current);
    }
    scheduleScrollIdleReset('wheel', 220);
  }, [lockScrollAxis, scheduleScrollIdleReset]);

  useEffect(() => {
    return () => {
      clearScrollIdleTimer();
    };
  }, [clearScrollIdleTimer]);
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const rootStyle = useMemo<CSSProperties | undefined>(() => {
    if (isTablet) {
      return headerOffsetPx ? { marginTop: headerOffsetPx } : undefined;
    }
    return {
      position: 'fixed',
      top: topInsetPx,
      left: 0,
      right: 0,
      bottom: bottomOffsetPx,
      zIndex: 40,
      backgroundColor: '#ffffff',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
    } satisfies CSSProperties;
  }, [isTablet, headerOffsetPx, topInsetPx, bottomOffsetPx]);

  const scrollParentStyle = useMemo<CSSProperties>(() => {
    if (isTablet) {
      return {
        height: `calc(100vh - ${topInsetPx + bottomOffsetPx}px)`,
        overscrollBehavior: 'none',
        overscrollBehaviorX: 'none',
        overscrollBehaviorY: 'none',
        touchAction: 'pan-x pan-y',
        WebkitOverflowScrolling: 'touch',
      } satisfies CSSProperties;
    }
    return {
      height: '100%',
      maxHeight: '100%',
      overscrollBehavior: 'contain',
      overscrollBehaviorX: 'contain',
      overscrollBehaviorY: 'contain',
      touchAction: 'pan-x pan-y',
      WebkitOverflowScrolling: 'touch',
      paddingBottom: Math.max(12, Math.round(bottomOffsetPx * 0.2)),
    } satisfies CSSProperties;
  }, [isTablet, topInsetPx, bottomOffsetPx]);

  const gridHeightPx = rowHeightsPx.reduce((a, b) => a + b, 0);
  return (
    <div
      className="relative w-full bg-transparent"
      style={rootStyle}
    >
      {/* Floating time header (smartphone only): fixed, above everything, tracks horizontal scroll */}
      {!isTablet && (
        <div
          ref={floatHeaderRef}
          className="fixed z-[1400] pointer-events-none"
          style={{
            top: topInsetPx,
            left: 0,
            width: '100vw',
            maxWidth: '100%',
            height: headerH,
            backgroundColor: '#ffffff',
            boxShadow: '0 1px 0 0 #e5e7eb',
            visibility: drawerOpen || sidebarOpen ? 'hidden' : 'visible',
          }}
          aria-hidden
        >
          <div className="relative h-full w-full">
            {/* Left white cap equals visible part of left rail */}
            <div
              ref={floatRailRef}
              className="absolute inset-y-0 left-0 bg-white"
              style={{ width: leftColW, zIndex: 5, pointerEvents: 'none', boxShadow: '2px 0 4px -2px rgba(15,23,42,0.2)' }}
            />
            {/* Masked viewport */}
            <div className="absolute inset-0 overflow-hidden">
              {/* Content positioned in content coordinates; shifted by transform */}
              <div
                ref={floatContentRef}
                className="absolute inset-y-0 will-change-transform"
                style={{ transform: 'translate3d(0,0,0)', width: leftColW + nCols * colWpx, height: headerH }}
              >
                <div
                  className="absolute inset-y-0"
                  style={{
                    left: leftColW,
                    width: nCols * colWpx,
                    height: headerH,
                    backgroundImage: `repeating-linear-gradient(to right, rgba(17,24,39,0.035) 0, rgba(17,24,39,0.035) ${hourPx}px, transparent ${hourPx}px, transparent ${hourPx * 2}px)`,
                  }}
                >
                  <NowMarker
                    anchorStartMs={anchorStartMs}
                    rangeEndMs={rangeEndMs}
                    colW={colWpx}
                    className="absolute top-0 bottom-0"
                  />
                  <TimelineHeader
                    nCols={nCols}
                    rangeStartMs={anchorStartMs}
                    colW={colWpx}
                    compact
                    scheduleStartHour={Number(scheduleStartHour ?? 0)}
                    scheduleEndHour={Number(scheduleEndHour ?? 0)}
                    colsPerHour={colsPerHour}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* 共通スクロール領域（縦・横ともにこの要素がスクロール親） */}
      <div
        ref={scrollParentRef}
        className="relative overflow-auto"
        onScroll={handleScroll}
        onPointerDown={handleScrollPointerDown}
        onPointerMove={handleScrollPointerMove}
        onPointerUp={handleScrollPointerUp}
        onPointerCancel={handleScrollPointerUp}
        onLostPointerCapture={handleScrollPointerUp}
        onWheel={handleWheelLock}
        style={scrollParentStyle}
      >
        {/* スクロール可能領域（縦・横） */}
        <div
          className="relative"
          style={{
            // スクロール幅 = 左列 + タイムライン幅
            width: leftColW + nCols * colWpx,
            height: contentTopPx + gridHeightPx,
          }}
        >
          {/* === 上部ヘッダー（左上は常に白／時刻は左余白分だけオフセット）=== */}
          <div
            className={`sticky bg-white border-b overflow-hidden ${scrolled.y ? 'shadow-sm' : ''}`}
            style={{
              top: 0,
              height: headerH,
              boxShadow: '0 1px 0 0 #e5e7eb',
              overflow: 'clip',
              pointerEvents: 'none',
              // smartphone: keep height but hide visual (floating header will render)
              visibility: isTablet && !sidebarOpen ? 'visible' : 'hidden',
              zIndex: sidebarOpen ? 40 : 1200,
            }}
          >
            <div
              className="relative h-full"
              style={{ width: leftColW + nCols * colWpx }}
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
                  width: nCols * colWpx,
                  height: headerH,
                  overflow: 'hidden',
                  backgroundImage: `repeating-linear-gradient(to right, rgba(17,24,39,0.035) 0, rgba(17,24,39,0.035) ${hourPx}px, transparent ${hourPx}px, transparent ${hourPx * 2}px)`,
                  zIndex: 2,
                }}
              >
                <NowMarker
                  anchorStartMs={anchorStartMs}
                  rangeEndMs={rangeEndMs}
                  colW={colWpx}
                  className="absolute top-0 bottom-0 pointer-events-none z-10"
                  style={{ zIndex: 5 }}
                />
                <TimelineHeader
                  nCols={nCols}
                  rangeStartMs={anchorStartMs}
                  colW={colWpx}
                  compact
                  scheduleStartHour={Number(scheduleStartHour ?? 0)}
                  scheduleEndHour={Number(scheduleEndHour ?? 0)}
                  colsPerHour={colsPerHour}
                />
              </div>
            </div>
          </div>

          {/* 左レールの下地（空白対策 & 横線を左端まで） */}
          <div
            className="absolute z-[1] pointer-events-none select-none"
            style={{
              left: 0,
              top: contentTopPx,
              width: leftColW,
              height: gridHeightPx,
              backgroundColor: '#eff6ff',
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
            className="sticky left-0 bg-sky-50 z-30 select-none"
            style={{
              top: contentTopPx,
              width: leftColW,
              height: gridHeightPx,
              borderRight: '1px solid #cbd5e1',
              // backgroundColor removed to use class bg-sky-50 (very light blue)
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
              <TableRows tables={tables} rowHeightsPx={rowHeightsPx} capacities={tableCapacitiesMap} />
            </div>
          </div>

          {/* 左上角のホワイト・マスク（横/縦スクロール時も常に空白を維持） */}
          <div
            className="sticky left-0 z-[1200] bg-white border-b border-r pointer-events-none"
            style={{ top: 0, width: leftColW, height: headerH }}
            aria-hidden
          />

          {/* タイムライン本体（予約・グリッド線） */}
          <DndContext
            sensors={sensors}
            modifiers={[restrictToParentElement, axisLockModifier]}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={(e) => { axisLockRef.current = null; handleDragEnd(e); }}
          >
            <div
              className="absolute z-0"
              style={{
                left: leftColW,
                top: contentTopPx,
                width: nCols * colWpx,
                height: gridHeightPx,
                touchAction: 'pan-x pan-y',
              }}
              onPointerDownCapture={() => setArmedId(null)}
              onClick={handleGridClick}
              aria-label="空きセルクリックレイヤー（本体）"
            >
              <div
                className="relative grid h-full w-full"
                style={{
                  gridTemplateColumns: `repeat(${nCols}, ${colWpx}px)`,
                  gridTemplateRows: rowHeightsPx.map(h => `${h}px`).join(' '),
                  backgroundImage: `
                    repeating-linear-gradient(to right, #d1d5db 0, #d1d5db 1px, transparent 1px, transparent ${hourPx}px),
                    repeating-linear-gradient(to right, #e5e7eb 0, #e5e7eb 1px, transparent 1px, transparent ${minorSolidStepPx}px),
                    repeating-linear-gradient(to right, rgba(17,24,39,0.035) 0, rgba(17,24,39,0.035) ${hourPx}px, transparent ${hourPx}px, transparent ${hourPx * 2}px)
                  `,
                }}
              >
                <ScheduleGrid nCols={nCols} colW={colWpx} rowHeights={rowHeightsPx} />

                {/* 15/45 分の破線（タブレットのみ） */}
                {isTablet && (
                  <DashedQuarterLines nCols={nCols} colW={colWpx} colsPerHour={colsPerHour} />
                )}

                <NowMarker
                  anchorStartMs={anchorStartMs}
                  rangeEndMs={rangeEndMs}
                  colW={colWpx}
                  className="absolute top-0 bottom-0 pointer-events-none z-[20]"
                />

                {/* 予約ブロック */}
                {stacked.map((it) => (
                  <ReservationBlock
                    key={`${it.id}_${it._row}`}
                    item={it}
                    row={it._row}
                    startCol={it._startCol}
                    spanCols={it._spanCols}
                    onClick={() => onCardTap(it)}
                    armedId={armedId}
                    setArmedId={setArmedId}
                    stackCount={rowStackCount[String((it as any)._table ?? (it as any)._row)] ?? 1}
                    rowHeightPx={rowHeightsPx[(it as any)._row - 1] ?? effectiveRowH}
                    courseColorMap={courseColorMap}
                  />
                ))}
                {/* --- ポップオーバーアクションメニュー --- */}
                {actionMenuOpen && actionTarget && actionBubble && (
                  <div
                    className="absolute z-[95]"
                    data-scroll-lock-ignore
                    style={{
                      left: Math.max(4, Math.min(actionBubble.left, nCols * colWpx - 220)),
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
                      <div className="flex flex-col p-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">状態</span>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              aria-pressed={actionStatus.arrived}
                              aria-label="来店ステータスを切り替え"
                              className={`flex-1 rounded-md border px-2 py-1 text-[12px] font-semibold transition-colors ${
                                actionStatus.arrived
                                  ? 'border-emerald-600 bg-emerald-600 text-white'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              }`}
                              onClick={() => handleStatusToggle('arrived')}
                            >
                              来
                            </button>
                            <button
                              type="button"
                              aria-pressed={actionStatus.paid}
                              aria-label="会計ステータスを切り替え"
                              className={`flex-1 rounded-md border px-2 py-1 text-[12px] font-semibold transition-colors ${
                                actionStatus.paid
                                  ? 'border-sky-600 bg-white text-sky-700 ring-2 ring-sky-500'
                                  : 'border-sky-300 bg-white text-sky-700 hover:bg-gray-50'
                              }`}
                              onClick={() => handleStatusToggle('paid')}
                            >
                              会
                            </button>
                            <button
                              type="button"
                              aria-pressed={actionStatus.departed}
                              aria-label="退店ステータスを切り替え"
                              className={`flex-1 rounded-md border px-2 py-1 text-[12px] font-semibold transition-colors ${
                                actionStatus.departed
                                  ? 'border-slate-600 bg-slate-600 text-white'
                                  : 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
                              }`}
                              onClick={() => handleStatusToggle('departed')}
                            >
                              退
                            </button>
                          </div>
                        </div>
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
            <div className="absolute inset-0 z-[80] bg-black/10" data-scroll-lock-ignore>
              <div
                className="absolute"
                style={{
                  left: leftColW,
                  top: contentTopPx,
                  width: nCols * colWpx,
                  height: gridHeightPx,
                }}
              >
                <div
                  className="relative grid h-full w-full"
                  style={{
                    gridTemplateColumns: `repeat(${nCols}, ${colWpx}px)`,
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

                {/* フッターボタン（画面下に固定）: 下部タブに隠れないように底上げ */}
                <div
                  className="fixed left-0 right-0 z-[120] px-2 pt-2 pointer-events-none"
                  style={{
                    bottom: bottomOffsetPx,
                  }}
                >
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
        reservationDetail={editingReservation}
        onUpdateReservationField={onUpdateReservationField}
        onAdjustTaskTime={onAdjustTaskTime}
        storeSettings={storeSettings}
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

type NowMarkerProps = {
  anchorStartMs: number;
  rangeEndMs: number;
  colW: number;
  className?: string;
  style?: CSSProperties;
  intervalMs?: number;
};

function NowMarker({
  anchorStartMs,
  rangeEndMs,
  colW,
  className,
  style,
  intervalMs = 30_000,
}: NowMarkerProps) {
  const now = useNowTicker(intervalMs);
  if (!(now >= anchorStartMs && now <= rangeEndMs)) return null;
  const offsetPx = ((now - anchorStartMs) / SLOT_MS) * colW;
  return (
    <div
      className={className}
      style={{ ...(style ?? {}), left: `${offsetPx}px` }}
      aria-hidden
    >
      <div className="h-full border-l-2 border-red-500 opacity-70" />
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

function useNowTicker(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, Math.max(200, intervalMs));
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function useUntilFlag(untilMs?: number): boolean {
  const [active, setActive] = useState(() => {
    if (!Number.isFinite(untilMs)) return false;
    return Date.now() <= Number(untilMs);
  });

  useEffect(() => {
    if (!Number.isFinite(untilMs)) {
      setActive((prev) => (prev ? false : prev));
      return;
    }
    const target = Number(untilMs);
    const now = Date.now();
    if (now >= target) {
      setActive((prev) => (prev ? false : prev));
      return;
    }
    setActive((prev) => (prev ? prev : true));
    const timeout = window.setTimeout(() => {
      setActive((prev) => (prev ? false : prev));
    }, Math.max(16, target - now)) as unknown as number;
    return () => window.clearTimeout(timeout);
  }, [untilMs]);

  return Boolean(active);
}


function TimelineHeader({
  nCols,
  rangeStartMs,
  colW,
  compact = false,
  scheduleStartHour,
  scheduleEndHour,
  colsPerHour,
}: {
  nCols: number;
  rangeStartMs: number;
  colW: number;
  compact?: boolean;
  scheduleStartHour: number;
  scheduleEndHour: number;
  colsPerHour: number;
}) {
  const hours = useMemo(() => {
    const out: { label: string; colStart: number }[] = [];
    // Prefer explicit props; fallback to rangeStartMs-derived hour if missing
    const startHourProp = Number.isFinite(scheduleStartHour) ? Math.trunc(scheduleStartHour) : new Date(rangeStartMs).getHours();
    const endHourProp = Number.isFinite(scheduleEndHour)
      ? Math.trunc(scheduleEndHour)
      : startHourProp + Math.ceil(nCols / colsPerHour);

    const hoursToRender = Math.max(0, endHourProp - startHourProp);
    for (let i = 0; i <= hoursToRender; i++) {
      const h = (startHourProp + i) % 24;
      out.push({ label: `${h}:00`, colStart: 1 + i * colsPerHour });
    }

    // If rounding left a remainder of columns, continue labels to cover the grid width (safety)
    while ((out.length === 0 ? 0 : out[out.length - 1].colStart) + colsPerHour <= nCols) {
      const last = out[out.length - 1];
      if (!last) break;
      const nextHour = (parseInt(last.label, 10) + 1) % 24;
      out.push({ label: `${nextHour}:00`, colStart: last.colStart + colsPerHour });
      if (out.length > 100) break; // safety guard
    }

    return out;
  }, [nCols, rangeStartMs, scheduleStartHour, scheduleEndHour, colsPerHour]);

  return (
    <div className="relative h-full select-none" style={{ width: nCols * colW }}>
      {hours.map((h) => (
        <div
          key={h.colStart}
          className={`absolute inset-y-0 flex items-center ${compact ? 'text-sm' : 'text-base'} font-semibold text-gray-800 px-1`}
          style={{
            left: (h.colStart - 1) * colW,
            width: colsPerHour * colW,
          }}
        >
          {h.label}
        </div>
      ))}
    </div>
  );
}

function TableRows({ tables, rowHeightsPx, capacities }: { tables: string[]; rowHeightsPx: number[]; capacities?: Record<string, number> }) {
  return (
    <div className="flex flex-col">
      {tables.map((t, i) => {
        const cap = capacities?.[t];
        const height = rowHeightsPx[i] ?? rowHeightsPx[0] ?? 44;
        return (
          <div
            key={t}
            className="relative flex h-full w-full flex-col items-center justify-center whitespace-nowrap overflow-hidden text-ellipsis text-gray-700 font-medium leading-tight"
            style={{ height, boxSizing: 'border-box', padding: '4px 6px' }}
          >
            <span className="text-sm leading-tight">{t}</span>
            {typeof cap === 'number' && cap > 0 && (
              <span
                className="pointer-events-none absolute text-[10px] font-normal text-gray-500"
                style={{ bottom: 2, right: 0 }}
              >
                （{cap}名）
              </span>
            )}
          </div>
        );
      })}
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
  item,
  row,
  startCol,
  spanCols,
  onClick,
  armedId,
  setArmedId,
  stackCount,
  rowHeightPx,
  courseColorMap,
}: {
  item: ScheduleItem & { status?: 'normal' | 'warn'; _table?: string; _key?: string; _editedAllowed?: boolean };
  row: number;
  startCol: number;
  spanCols: number;
  onClick?: () => void;
  armedId: string | null;
  setArmedId: (id: string | null) => void;
  stackCount: number;
  rowHeightPx: number;
  courseColorMap: Map<string, CourseColorStyle>;
}) {
  const warn = item.status === 'warn';
  const baseId = String(item.id ?? item._key ?? `tmp_${row}_${startCol}`);
  const tableToken = String(item._table ?? row);
  const blockKey = `${baseId}::${tableToken}`;
  const raw = item as any;
  const arrived = Boolean(raw?.arrived);
  const paid = Boolean(raw?.paid);
  const departed = Boolean(raw?.departed);

  type VisualState = 'normal' | 'arrived' | 'paid' | 'departed';
  // 会計: 内部色は変えず、リングのみ青にする → ベース状態は arrived/normal/dep のみで決定
  const paidActive = paid && !departed;
  const state: VisualState = departed ? 'departed' : (arrived ? 'arrived' : 'normal');

  const palette: Record<VisualState, { border: string; accent: string; body: string; left: string; right: string }> = {
    normal: {
      border: '#1f6b8d',
      accent: '#134e6b',
      body: '#475569',
      left: '#ffffff',
      right: '#fffdf0',
    },
    arrived: {
      border: '#2f855a',
      accent: '#276749',
      body: '#2f4f3b',
      left: '#e5f6ed',
      right: '#f3fbf6',
    },
    paid: {
      border: '#3b82f6', // brighter blue (Tailwind blue-500)
      accent: '#1e40af',
      body: '#213a71',
      left: '#e6effd',
      right: '#f1f6fe',
    },
    departed: {
      border: '#94a3b8',
      accent: '#475569',
      body: '#526070',
      left: '#f1f5f9',
      right: '#f8fafc',
    },
  };

  const colors = palette[state];
  const borderColor = warn ? '#a13e18' : (paidActive ? palette.paid.border : colors.border);
  const textAccent = warn ? '#7b3416' : colors.accent;
  const bodyTextClass = state === 'departed' ? 'text-slate-600' : 'text-slate-700';
  const secondaryTextClass = state === 'departed' ? 'text-slate-500' : 'text-slate-600';

  // 長押し判定
  const LONG_PRESS_MS = 900;
  const MOVE_TOLERANCE_PX = 8;
  const pressRef = useRef<{ x: number; y: number; tid: number | null }>({ x: 0, y: 0, tid: null });
  const isArmed = armedId === baseId;

  const guestsRaw = (item as any).people ?? (item as any).guests;
  const guests = typeof guestsRaw === 'number' ? guestsRaw : Number(guestsRaw);
  const guestsLabel = Number.isFinite(guests) && guests > 0 ? `${guests}名` : '';
  const nameRaw = ((item as any).name ?? '').toString().trim();
  const name = nameRaw.length > 0 ? `${nameRaw}様` : '';
  const course = ((item as any).course ?? '').toString().trim();
  const defaultCourseColorStyle = courseColorMap.get('未選択') ?? getCourseColorStyle(null);
  const courseColorStyle = course ? courseColorMap.get(course) ?? defaultCourseColorStyle : defaultCourseColorStyle;
  const courseTextStyle: CSSProperties = {
    color: courseColorStyle.text,
    opacity: state === 'departed' ? 0.7 : 1,
  };
  const startLabel = fmtTime(item.startMs);

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
  const notes = ((item as any).notes ?? (item as any).memo ?? '').toString().trim();
  const baseTitleParts = [guestsLabel, name, course, extrasLabel].filter(Boolean);
  const baseTitle = baseTitleParts.join(' / ');
  const titleText = baseTitle || undefined;

  // ★ 武装中のみドラッグ有効化（リサイズは廃止）
  const dragDisabled = !isArmed;
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: `move:${blockKey}`, disabled: dragDisabled });

  const stackIndex = Number((item as any)._stackIndex ?? 0);
  const layers = Math.max(1, Number(stackCount || 1));
  const rowH = Math.max(1, Number(rowHeightPx || 1));
  const perLayerH = Math.max(1, Math.floor(rowH / layers));

  const tx = Math.round(transform?.x ?? 0);
  const ty = Math.round(transform?.y ?? 0) + stackIndex * perLayerH;
  const translate = (tx || ty) ? `translate3d(${tx}px, ${ty}px, 0)` : undefined;

  const handleClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    // 武装中はエディタを開かない
    if (isArmed) return;
    onClick?.();
  }, [onClick, isArmed]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (isArmed) return;
      onClick();
    }
  }, [onClick, isArmed]);

  const freshUntilRaw = (item as any).freshUntilMs;
  const freshUntil = Number.isFinite(Number(freshUntilRaw)) ? Number(freshUntilRaw) : undefined;
  const isFresh = useUntilFlag(freshUntil);
  const showEdited = Boolean((item as any)._editedAllowed);

  return (
    <div
      ref={setNodeRef}
      className="relative z-10 h-full w-full select-none pointer-events-auto"
      data-scroll-lock-ignore
      style={{
        gridColumn: `${startCol} / span ${spanCols}`,
        gridRow: `${row} / span 1`,
        transform: translate,
        paddingTop: 3,
        paddingBottom: 3,
        height: perLayerH,
        touchAction: 'pan-x pan-y',
      }}
      title={titleText || undefined}
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
      {/* Status dot moved outside the card container */}
      {(showEdited || isFresh) && (
        <span
          className={`absolute top-[9px] left-0 -translate-x-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full ring-2 ring-white ${showEdited ? 'bg-amber-500' : 'bg-green-500'} z-20 pointer-events-none`}
        />
      )}
      <div
        className={`relative flex h-full w-full flex-col justify-between rounded-[6px] shadow-[0_1px_2px_rgba(15,23,42,0.1)] ${bodyTextClass} ${isArmed ? 'ring-2 ring-sky-400' : ''} ${state === 'departed' ? 'opacity-80' : ''} overflow-hidden`}
        style={{
          margin: '0px',
          // バッジ分の余白を右側に確保（被り回避）
          padding: warn ? '6px 44px 6px 10px' : '6px 10px 6px',
          border: `3px solid ${borderColor}`,
          backgroundColor: colors.left,
          backgroundImage: `linear-gradient(to right, ${colors.left} 0%, ${colors.left} 50%, ${colors.right} 50%, ${colors.right} 100%)`,
        }}
        {...attributes}
        {...listeners}
      >
        {/* Status dot removed from inside the card container */}
        <div className={`grid h-full grid-rows-[auto_1fr_auto] text-[12px] ${bodyTextClass} min-w-0`}>
          <div className="flex items-center justify-between text-[12px] font-semibold min-w-0 pb-0.5" style={{ color: textAccent }}>
            <div className="flex items-center gap-2 min-w-0 whitespace-nowrap">
              <span className="font-mono text-[13px] tracking-tight leading-none shrink-0">{startLabel}</span>
              <span className="font-mono text-[13px] tracking-tight leading-none shrink-0" aria-label="人数">
                {guestsLabel || '―'}
              </span>
            </div>
            <div className="flex gap-1 text-[11px] text-slate-500 shrink-0 overflow-hidden">
              {showEat && <span className="rounded-sm border border-slate-400 px-1 leading-tight whitespace-nowrap">{eatLabel || '食放'}</span>}
              {showDrink && <span className="rounded-sm border border-slate-400 px-1 leading-tight whitespace-nowrap">{drinkLabel || '飲放'}</span>}
            </div>
          </div>
          <div className={`flex items-center overflow-hidden text-[11px] ${secondaryTextClass} min-w-0`} />
          <div className={`flex items-end justify-between text-[11px] ${secondaryTextClass} min-w-0 pt-0.5`}>
            <span className="font-medium truncate max-w-[60%]" aria-label="氏名">{name}</span>
            <span
              className={`truncate text-right text-[11px] ${secondaryTextClass}`}
              style={courseTextStyle}
            >
              {course}
            </span>
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
