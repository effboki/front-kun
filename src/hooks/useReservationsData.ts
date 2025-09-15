

'use client';

// src/hooks/useReservationsData.ts
// 役割：live > onceFetch > cache を一元管理するフック
// 返り値：{ reservations, initialized, setReservations, error }

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { Reservation } from '@/types';
import { useRealtimeReservations } from './useRealtimeReservations';
import { fetchAllReservationsOnce } from '@/lib/reservations';
import type { WaveSourceReservation } from '@/lib/waveSelectors';

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

export function useReservationsData(storeId: string) {
  // 1) 初期値：キャッシュから復元（あれば）
  const [reservations, setReservations] = useState<Reservation[]>(() => readCache(storeId) ?? []);
  const [initialized, setInitialized] = useState<boolean>(() => (readCache(storeId) ? true : false));
  const [error, setError] = useState<Error | null>(null);

  const writeCacheDebounced = useDebouncedCacheWriter(storeId);

  // live（hook内にガードあり：初回の cache-empty は流れない）
  const { data: liveData, initialized: liveInit, error: liveErr } = useRealtimeReservations(storeId);

  // onceFetch は live が到着するまでだけ採用
  const onceAppliedRef = useRef(false);
  const liveAppliedRef = useRef(false);

  // 2) onceFetch（初回のみ / live 未到着時のみ採用）
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        if (liveInit || onceAppliedRef.current) return; // live 優先／二重防止
        const list = await fetchAllReservationsOnce(storeId);
        if (aborted) return;
        if (!liveInit && !onceAppliedRef.current) {
          onceAppliedRef.current = true;
          setReservations(list as Reservation[]);
          setInitialized(true);
          writeCacheDebounced(list as Reservation[]);
        }
      } catch (e: any) {
        if (!aborted) setError(e instanceof Error ? e : new Error(String(e)));
      }
    })();
    return () => { aborted = true; };
  }, [storeId, liveInit, writeCacheDebounced]);

  // 3) live 到着：以後 live を正として反映（空も含む）
  useEffect(() => {
    if (!liveInit || liveAppliedRef.current) return;
    liveAppliedRef.current = true;
    const arr = Array.isArray(liveData) ? (liveData as Reservation[]) : [];
    setReservations(arr);
    setInitialized(true);
    writeCacheDebounced(arr);
  }, [liveInit, liveData, writeCacheDebounced]);

  // 4) 画面からの直接更新時もキャッシュへ（setReservations をラップして使う想定なら不要）
  useEffect(() => {
    // 初期 mount 時に二重で書かないための軽ガード
    if (!initialized) return;
    writeCacheDebounced(reservations);
  }, [reservations, initialized, writeCacheDebounced]);

  // live のエラー反映
  useEffect(() => {
    if (liveErr) setError(liveErr);
  }, [liveErr]);

  // 外部からも state を更新できるように安定化コールバックを返す
  const setReservationsStable = useCallback((updater: Reservation[] | ((prev: Reservation[]) => Reservation[])) => {
    setReservations((prev) => (typeof updater === 'function' ? (updater as any)(prev) : updater));
  }, []);

  return { reservations, initialized, setReservations: setReservationsStable, error } as const;
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