'use client';

// src/hooks/useReservationsData.ts
// 役割：live > onceFetch > cache を一元管理するフック
// 返り値：{ reservations, initialized, setReservations, error }

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { Reservation } from '@/types';
import { listenReservationsByDay } from '@/lib/firestoreReservations';
import type { WaveSourceReservation } from '@/lib/waveSelectors';
import { selectScheduleItems } from '@/lib/scheduleSelectors';
import type { CourseDef } from '@/types/settings';
import { startOfDayMs, msToHHmmFromDay } from '@/lib/time';

function getCourseStayMin(courseName: string, courses?: CourseDef[]): number | undefined {
  const name = (courseName ?? '').trim();
  if (!name) return undefined;
  const cs = (courses ?? []).find((c) => (c as any)?.name && String((c as any).name).trim() === name);
  if (!cs) return undefined;
  const candidates = [
    (cs as any).durationMin,
    (cs as any).stayMin,
    (cs as any).stayMinutes,
    (cs as any).durationMinutes,
    (cs as any).minutes,
    (cs as any).lengthMin,
    (cs as any).lengthMinutes,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return undefined;
}


// --- キャッシュの schema version ---
const RES_CACHE_VERSION = 1;

type CachedShape = { v: number; data: Reservation[] };

const ss = () => (typeof window !== 'undefined' ? window.sessionStorage : undefined);
const ls = () => (typeof window !== 'undefined' ? window.localStorage : undefined);

function cacheKey(storeId: string) {
  return `fk:${storeId}:reservations`;
}

function readCache(storeId: string): Reservation[] | null {
  try {
    const k = cacheKey(storeId);
    const s = ss();
    const l = ls();
    const pick = (raw: string | null) => {
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedShape | Reservation[];
      // 新旧両対応（旧形式は配列そのもの）
      if (Array.isArray(parsed)) return parsed as Reservation[];
      if (parsed && typeof parsed === 'object' && (parsed as CachedShape).v === RES_CACHE_VERSION) {
        return (parsed as CachedShape).data;
      }
      return null;
    };
    const rawS: string | null = s ? s.getItem(k) : null;
    const rawL: string | null = l ? l.getItem(k) : null;
    return pick(rawS) ?? pick(rawL);
  } catch {
    return null;
  }
}

function writeCache(storeId: string, data: Reservation[]) {
  try {
    const payload: CachedShape = { v: RES_CACHE_VERSION, data };
    const raw = JSON.stringify(payload);
    const k = cacheKey(storeId);
    ss()?.setItem(k, raw);
    ls()?.setItem(k, raw);
  } catch {
    // noop
  }
}

/** 300ms デバウンス + idle でキャッシュ書き込み */
function useDebouncedCacheWriter(storeId: string) {
  const tRef = useRef<number | null>(null);
  const write = useCallback((data: Reservation[]) => {
    if (tRef.current) {
      window.clearTimeout(tRef.current);
      tRef.current = null;
    }
    const task = () => writeCache(storeId, data);
    // @ts-ignore
    const ric: typeof window.requestIdleCallback | undefined = (window as any).requestIdleCallback;
    const runner = () => (ric ? ric(() => task()) : task());
    tRef.current = window.setTimeout(runner, 300);
  }, [storeId]);

  // unmount cleanup
  useEffect(() => () => {
    if (tRef.current) {
      window.clearTimeout(tRef.current);
      tRef.current = null;
    }
  }, []);

  return write;
}

export function useReservationsData(storeId: string, opts?: { courses?: CourseDef[]; visibleTables?: string[]; dayStartMs?: number; schedule?: { dayStartHour?: number; dayEndHour?: number } }) {
  // 1) 初期値：キャッシュから復元（あれば）
  const [reservations, setReservations] = useState<Reservation[]>(() => readCache(storeId) ?? []);
  const [initialized, setInitialized] = useState<boolean>(() => (readCache(storeId) ? true : false));
  const [error, setError] = useState<Error | null>(null);

  const writeCacheDebounced = useDebouncedCacheWriter(storeId);

  // 2) Firestore live 購読：dayStartMs が必須（Date.now フォールバックはしない）
  useEffect(() => {
    const d0 = opts?.dayStartMs;
    if (!Number.isFinite(d0 as number)) {
      // dayStartMs が無い場合は購読しない（呼び出し側でセット必須）
      return;
    }
    // schedule に基づく表示幅（時間）を計算。なければ 24h。
    const s = opts?.schedule;
    const hasScheduleHours = Number.isFinite(s?.dayStartHour as number) && Number.isFinite(s?.dayEndHour as number) && (Number(s?.dayEndHour) > Number(s?.dayStartHour));
    const hours = hasScheduleHours ? (Number(s?.dayEndHour) - Number(s?.dayStartHour)) : 24;
    const rangeEndMs = (d0 as number) + hours * 60 * 60 * 1000;
    const base0 = startOfDayMs(d0 as number);

    let off: void | (() => void);
    try {
      off = listenReservationsByDay(storeId, d0 as number, rangeEndMs, (rows) => {
        // UI 互換フィールドを付与してから state へ
        const uiRows = (Array.isArray(rows) ? rows : []).map((r: any) => {
          const startMs = Number(r?.startMs ?? 0);
          const timeHHmm = msToHHmmFromDay(startMs, base0); // ← 常に startMs から再計算
          const time = timeHHmm; // 旧 r.time は信用しない

          const tables = Array.isArray(r?.tables)
            ? r.tables.map((t: any) => String(t)).filter((t: string) => t.trim() !== '')
            : [];
          const table = (typeof r?.table === 'string' && r.table.trim() !== '') ? r.table : (tables[0] ?? '');

          const g = Number(r?.guests);
          const guests = Number.isFinite(g) ? Math.trunc(g) : 0;

          const courseRaw = (r?.course ?? r?.courseName ?? '') as any;
          const course = typeof courseRaw === 'string' ? courseRaw : String(courseRaw ?? '');
          const courseName = (typeof r?.courseName === 'string' && r.courseName.trim() !== '') ? r.courseName : course;

          // 滞在時間：手動 > コース規定 の優先で算出
          const durRaw = Number((r as any)?.durationMin);
          const durationMin = Number.isFinite(durRaw) && durRaw > 0 ? Math.trunc(durRaw) : undefined;
          const courseStay = getCourseStayMin(course, opts?.courses);
          const effectiveDurationMin = durationMin ?? courseStay; // ← 優先度を固定

          // endMs も用意（scheduleItems 側が使えるように）
          const endMs = (Number.isFinite(startMs) && Number.isFinite(effectiveDurationMin as any))
            ? (startMs + (effectiveDurationMin as number) * 60_000)
            : (Number((r as any)?.endMs) || undefined);

          const drinkLabel = typeof r?.drinkLabel === 'string' ? r.drinkLabel : '';
          const eatLabel   = typeof r?.eatLabel   === 'string' ? r.eatLabel   : '';
          const memo       = typeof r?.memo       === 'string' ? r.memo       : '';
          const name       = typeof r?.name       === 'string' ? r.name       : '';

          const createdAtMsRaw = Number(r?.createdAtMs);
          const createdAtMs = Number.isFinite(createdAtMsRaw) ? Math.trunc(createdAtMsRaw) : 0;
          const freshUntilMs = createdAtMs + 15 * 60 * 1000;

          const updatedAtMsRaw = Number(r?.updatedAtMs);
          const updatedAtMs = Number.isFinite(updatedAtMsRaw) ? Math.trunc(updatedAtMsRaw) : 0;
          const editedUntilMs = updatedAtMs + 15 * 60 * 1000;

          return {
            ...r,
            startMs,
            endMs,
            durationMin,           // 手動指定（あれば数値）
            effectiveDurationMin,  // 描画/計算に使う実効値
            timeHHmm,
            time,
            tables,
            table,
            guests,
            course,
            courseName,
            drinkLabel,
            eatLabel,
            memo,
            freshUntilMs,
            editedUntilMs,
          } as Reservation;
        }) as Reservation[];

        setReservations(uiRows);
        setInitialized(true);
        writeCacheDebounced(uiRows);
      });
    } catch (e: any) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
    return () => { if (off) off(); };
  }, [storeId, opts?.dayStartMs, opts?.schedule?.dayStartHour, opts?.schedule?.dayEndHour, writeCacheDebounced]);

  // 4) 画面からの直接更新時もキャッシュへ（setReservations をラップして使う想定なら不要）
  useEffect(() => {
    // 初期 mount 時に二重で書かないための軽ガード
    if (!initialized) return;
    writeCacheDebounced(reservations);
  }, [reservations, initialized, writeCacheDebounced]);

  // 外部からも state を更新できるように安定化コールバックを返す
  const setReservationsStable = useCallback((updater: Reservation[] | ((prev: Reservation[]) => Reservation[])) => {
    setReservations((prev) => (typeof updater === 'function' ? (updater as any)(prev) : updater));
  }, []);

  // 5) スケジュール表示用に正規化（コース滞在時間・可視卓フィルタ・競合マーキング）
  // NOTE:
  // - dayStartMs を必ず貫通させる（予約の 'HH:mm' → 基準日の絶対msへ変換）
  // - 依存配列にも opts?.dayStartMs を入れて、設定変更（例: dayStartHour）の即時反映を保証
  const scheduleItems = useMemo(() => {
    const base = selectScheduleItems(
      reservations,
      opts?.courses,
      opts?.visibleTables,
      opts?.dayStartMs,
    ) as any[];

    // id -> freshUntilMs の辞書をつくる
    const freshMap: Record<string, number> = {};
    (reservations as any[]).forEach((r) => {
      if (r && typeof r.id === 'string' && Number.isFinite(Number(r.freshUntilMs))) {
        freshMap[r.id] = Math.trunc(Number(r.freshUntilMs));
      }
    });

    // id -> editedUntilMs の辞書
    const editedMap: Record<string, number> = {};
    (reservations as any[]).forEach((r) => {
      if (r && typeof r.id === 'string' && Number.isFinite(Number((r as any).editedUntilMs))) {
        editedMap[r.id] = Math.trunc(Number((r as any).editedUntilMs));
      }
    });

    // id -> durationMin / effectiveDurationMin の辞書
    const durMap: Record<string, { durationMin?: number; effectiveDurationMin?: number }> = {};
    (reservations as any[]).forEach((r) => {
      if (!r) return;
      const rid = typeof (r as any).id === 'string' ? (r as any).id : undefined;
      if (!rid) return;
      const dmin = Number((r as any).durationMin);
      const durationMin = Number.isFinite(dmin) && dmin > 0 ? Math.trunc(dmin) : undefined;
      const eff = (r as any).effectiveDurationMin;
      const effectiveDurationMin = Number.isFinite(Number(eff)) ? Math.trunc(Number(eff)) : undefined;
      durMap[rid] = { durationMin, effectiveDurationMin };
    });

    // scheduleItems 側にも同じフィールドを付与（描画でそのまま使えるように）
    return (Array.isArray(base) ? base : []).map((it: any) => {
      const fid = typeof it?.id === 'string' ? it.id : undefined;
      const fusedFresh = (fid && freshMap[fid] != null) ? freshMap[fid] : it?.freshUntilMs;
      const fusedEdited = (fid && editedMap[fid] != null) ? editedMap[fid] : it?.editedUntilMs;
      const dm = fid ? durMap[fid] : undefined;
      return {
        ...it,
        freshUntilMs: fusedFresh,
        editedUntilMs: fusedEdited,
        // Drawer 初期値用に生の durationMin をそのまま渡す（自動は undefined）
        durationMin: dm?.durationMin,
        // 表示・レイアウト用の実効分（必要に応じて使用）
        effectiveDurationMin: dm?.effectiveDurationMin,
      };
    });
  }, [reservations, opts?.courses, opts?.visibleTables, opts?.dayStartMs]);

  return { reservations, scheduleItems, initialized, setReservations: setReservationsStable, error } as const;
}

// ===== Wave 用セレクタフック =====
/**
 * Reservation -> WaveSourceReservation[] へマップするための関数型
 * - 1つの予約から複数の WaveSourceReservation を返してもOK
 * - 対象外は null を返す
 */
export type WaveReservationMapper = (r: Reservation) => WaveSourceReservation | WaveSourceReservation[] | null | undefined;

/**
 * useWaveSourceReservations
 * - 予約の live/once/cache を統合した useReservationsData を内部で使用
 * - 呼び出し側が与える mapper で WaveSourceReservation[] に変換して返す
 * - Reservation 型の詳細に依存しないため、このフックは安全に再利用可能
 */
export function useWaveSourceReservations(
  storeId: string,
  mapReservation: WaveReservationMapper
) {
  const { reservations, initialized, error } = useReservationsData(storeId);
  const data = useMemo<WaveSourceReservation[]>(() => {
    const out: WaveSourceReservation[] = [];
    if (!Array.isArray(reservations)) return out;
    for (const r of reservations) {
      const m = mapReservation?.(r);
      if (!m) continue;
      if (Array.isArray(m)) out.push(...m);
      else out.push(m);
    }
    // time 昇順（startMs がある前提）
    out.sort((a, b) => a.startMs - b.startMs);
    return out;
  }, [reservations, mapReservation]);

  return { data, initialized, error } as const;
}