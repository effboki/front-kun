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
  const list = Array.isArray(courses) ? (courses as any[]) : [];

  const strictFind = list.find((c: any) => {
    const v = String((c?.value ?? c?.name ?? c?.label ?? c?.title ?? '') || '').trim();
    return v === name;
  });

  let cs: any = strictFind;
  if (!cs) {
    // 空白無視・小文字化でのルーズ一致
    const key = name.replace(/\s+/g, '').toLowerCase();
    cs = list.find((c: any) => {
      const v = String((c?.value ?? c?.name ?? c?.label ?? c?.title ?? '') || '')
        .replace(/\s+/g, '')
        .toLowerCase();
      return v === key;
    });
  }
  if (!cs) return undefined;

  const candidates = [
    (cs as any).stayMinutes,
    (cs as any).durationMin,
    (cs as any).stayMin,
    (cs as any).durationMinutes,
    (cs as any).minutes,
    (cs as any).lengthMin,
    (cs as any).lengthMinutes,
    (cs as any).duration,
    (cs as any).stay,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return undefined;
}


// --- キャッシュの schema version ---
const RES_CACHE_VERSION = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

type CachedShape = {
  v: number;
  data: Reservation[];
  day?: number | null;
  savedAt?: number;
};

const ss = () => (typeof window !== 'undefined' ? window.sessionStorage : undefined);
const ls = () => (typeof window !== 'undefined' ? window.localStorage : undefined);

const normalizeDayKey = (dayStartMs?: number | null): number | null => {
  if (typeof dayStartMs !== 'number') return null;
  const n = Number(dayStartMs);
  if (!Number.isFinite(n)) return null;
  return startOfDayMs(n);
};

function cacheKey(storeId: string, dayStartMs?: number) {
  const dayKey = normalizeDayKey(dayStartMs);
  const safeStoreId = storeId || 'default';
  return dayKey != null
    ? `fk:${safeStoreId}:reservations:${dayKey}`
    : `fk:${safeStoreId}:reservations`;
}

function readCache(storeId: string, dayStartMs?: number): Reservation[] | null {
  try {
    const k = cacheKey(storeId, dayStartMs);
    const expectedDay = normalizeDayKey(dayStartMs);
    const s = ss();
    const l = ls();
    const pick = (raw: string | null) => {
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedShape | Reservation[];
      // 新旧両対応（旧形式は配列そのもの）
      if (Array.isArray(parsed)) {
        if (expectedDay == null) return parsed as Reservation[];
        const day0 = expectedDay;
        const dayEnd = day0 + DAY_MS;
        const sameDay = parsed.every((row: any) => {
          const start = Number(row?.startMs);
          if (!Number.isFinite(start)) return false;
          return start >= day0 && start < dayEnd;
        });
        return sameDay ? (parsed as Reservation[]) : null;
      }
      if (parsed && typeof parsed === 'object' && (parsed as CachedShape).v === RES_CACHE_VERSION) {
        const payload = parsed as CachedShape;
        const payloadDay = normalizeDayKey(payload.day ?? null);
        if (expectedDay != null) {
          if (payloadDay !== expectedDay) return null;
          if (payload.savedAt != null) {
            const savedAt = Number(payload.savedAt);
            if (Number.isFinite(savedAt) && savedAt < expectedDay) {
              return null;
            }
          }
        }
        if (Array.isArray(payload.data)) {
          if (expectedDay == null) return payload.data;
          const day0 = expectedDay;
          const dayEnd = day0 + DAY_MS;
          const sameDay = payload.data.every((row: any) => {
            const start = Number(row?.startMs);
            if (!Number.isFinite(start)) return false;
            return start >= day0 && start < dayEnd;
          });
          return sameDay ? payload.data : null;
        }
      }
      return null;
    };
    const rawS: string | null = s ? s.getItem(k) : null;
    const rawL: string | null = l ? l.getItem(k) : null;
    return pick(rawS) ?? pick(rawL);
  } catch {
    return null;
  }
};

function writeCache(storeId: string, dayStartMs: number | undefined, data: Reservation[]) {
  try {
    const payload: CachedShape = {
      v: RES_CACHE_VERSION,
      data,
      day: normalizeDayKey(dayStartMs),
      savedAt: Date.now(),
    };
    const raw = JSON.stringify(payload);
    const k = cacheKey(storeId, dayStartMs);
    ss()?.setItem(k, raw);
    ls()?.setItem(k, raw);
  } catch {
    // noop
  }
}

/** 300ms デバウンス + idle でキャッシュ書き込み */
function useDebouncedCacheWriter(storeId: string, dayStartMs?: number) {
  const tRef = useRef<number | null>(null);
  const write = useCallback((data: Reservation[]) => {
    if (tRef.current) {
      window.clearTimeout(tRef.current);
      tRef.current = null;
    }
    const task = () => writeCache(storeId, dayStartMs, data);
    // @ts-ignore
    const ric: typeof window.requestIdleCallback | undefined = (window as any).requestIdleCallback;
    const runner = () => (ric ? ric(() => task()) : task());
    tRef.current = window.setTimeout(runner, 300);
  }, [storeId, dayStartMs]);

  // unmount cleanup
  useEffect(() => () => {
    if (tRef.current) {
      window.clearTimeout(tRef.current);
      tRef.current = null;
    }
  }, [storeId, dayStartMs]);

  return write;
}

export function useReservationsData(storeId: string, opts?: { courses?: CourseDef[]; visibleTables?: string[]; dayStartMs?: number; schedule?: { dayStartHour?: number; dayEndHour?: number } }) {
  // 1) 初期値：キャッシュから復元（あれば）
  const [reservations, setReservations] = useState<Reservation[]>(() => readCache(storeId, opts?.dayStartMs) ?? []);
  const [initialized, setInitialized] = useState<boolean>(() => (readCache(storeId, opts?.dayStartMs) ? true : false));
  const [error, setError] = useState<Error | null>(null);

  const writeCacheDebounced = useDebouncedCacheWriter(storeId, opts?.dayStartMs);
  const dayKey = normalizeDayKey(opts?.dayStartMs);
  const cacheSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    const signature = `${storeId || 'default'}:${dayKey ?? 'all'}`;
    const prevSignature = cacheSignatureRef.current;
    if (prevSignature === signature) return;
    cacheSignatureRef.current = signature;

    const cached = readCache(storeId, opts?.dayStartMs);
    if (cached) {
      setReservations(cached);
      setInitialized(true);
      return;
    }

    if (prevSignature) {
      setReservations((prev) => {
        if (!prev || prev.length === 0) return prev;
        if (dayKey != null) {
          const day0 = dayKey;
          const dayEnd = day0 + DAY_MS;
          const matchesNewDay = prev.every((row) => {
            const start = Number((row as any)?.startMs);
            return Number.isFinite(start) && start >= day0 && start < dayEnd;
          });
          if (matchesNewDay) return prev;
        }
        return [];
      });
    }
    setInitialized(false);
  }, [storeId, dayKey, opts?.dayStartMs]);

  // 店舗設定由来も含めたコース配列（重複は name/label/value/title 正規化で除去）
  const mergedCourses = useMemo<CourseDef[]>(() => {
    const src: any[] = Array.isArray(opts?.courses) ? (opts!.courses as any[]) : [];
    const out: any[] = [];
    const seen = new Set<string>();
    for (const c of src) {
      if (!c) continue;
      const label = String((c as any).value ?? (c as any).name ?? (c as any).label ?? (c as any).title ?? '').trim();
      const key = label ? label.replace(/\s+/g, '').toLowerCase() : '';
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push(c);
    }
    return out as CourseDef[];
  }, [opts?.courses]);

  // コース名から滞在分を解決（デフォルトで mergedCourses を見る）
  const resolveStayMin = useCallback((course?: string | null) => {
    return getCourseStayMin(course ?? '', mergedCourses);
  }, [mergedCourses]);

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
        const normalizeLabel = (value: any): string => {
          if (value == null) return '';
          if (Array.isArray(value)) return value.map(normalizeLabel).filter(Boolean).join(',');
          if (typeof value === 'string') return value.trim();
          if (typeof value === 'number') return String(value);
          if (typeof (value as any)?.label === 'string') return (value as any).label.trim();
          return String(value ?? '').trim();
        };
        const pickString = (...candidates: any[]): string => {
          for (const c of candidates) {
            const v = normalizeLabel(c);
            if (v) return v;
          }
          return '';
        };
        const normalizeTables = (r: any): string[] => {
          const acc: any[] = [];
          const push = (v: any) => {
            if (v == null) return;
            if (Array.isArray(v)) acc.push(...v);
            else acc.push(v);
          };
          push(r?.tables);
          push(r?.tableIds);
          push(r?.tableId);
          push(r?.table);
          push((r as any)?.meta?.tables);
          push((r as any)?.meta?.table);
          push((r as any)?.reservation?.tables);
          push((r as any)?.reservation?.table);
          const mapped = acc.map((v) => normalizeLabel(v)).filter(Boolean);
          const out: string[] = [];
          const seen = new Set<string>();
          for (const v of mapped) {
            if (seen.has(v)) continue;
            seen.add(v);
            out.push(v);
          }
          return out;
        };
        const resolveGuests = (r: any): number => {
          const candidates = [
            (r as any)?.guests,
            (r as any)?.people,
            (r as any)?.reservation?.guests,
            (r as any)?.reservation?.people,
            (r as any)?.meta?.guests,
          ];
          for (const c of candidates) {
            const n = Number(c);
            if (Number.isFinite(n)) return Math.trunc(n);
          }
          return 0;
        };
        const resolveNumber = (v: any): number | undefined => {
          const n = Number(v);
          return Number.isFinite(n) ? Math.trunc(n) : undefined;
        };
        const resolveTimestampMs = (v: any): number | undefined => {
          if (v && typeof v === 'object' && typeof (v as any).toMillis === 'function') {
            return resolveNumber((v as any).toMillis());
          }
          return resolveNumber(v);
        };
        const resolveStartMs = (r: any): number => {
          const cand = [
            (r as any)?.startMs,
            (r as any)?.reservation?.startMs,
            (r as any)?.meta?.startMs,
          ];
          for (const c of cand) {
            const n = resolveNumber(c);
            if (n != null) return n;
          }
          return 0;
        };
        const resolveDuration = (r: any): number | undefined => {
          const cand = [
            (r as any)?.durationMin,
            (r as any)?.reservation?.durationMin,
            (r as any)?.meta?.durationMin,
          ];
          for (const c of cand) {
            const n = resolveNumber(c);
            if (n != null && n > 0) return n;
          }
          return undefined;
        };

        // UI 互換フィールドを付与してから state へ
        const uiRows = (Array.isArray(rows) ? rows : []).map((r: any) => {
          const resolvedStart = resolveStartMs(r);
          const startMs = Number.isFinite(resolvedStart) && resolvedStart > 0 ? resolvedStart : (d0 as number);
          const timeHHmm = Number.isFinite(startMs) ? msToHHmmFromDay(startMs, base0) : '';
          const time = timeHHmm; // 旧 r.time は信用しない

          const tables = normalizeTables(r);
          const table = pickString(r?.table, (r as any)?.meta?.table, (r as any)?.reservation?.table, tables[0]);

          const guests = resolveGuests(r);

          const course = pickString(
            r?.course,
            r?.courseName,
            (r as any)?.reservation?.course,
            (r as any)?.reservation?.courseName,
            (r as any)?.meta?.course,
            (r as any)?.meta?.courseName,
          );
          const courseName = pickString(
            r?.courseName,
            (r as any)?.reservation?.courseName,
            (r as any)?.meta?.courseName,
            course,
          );

          // 滞在時間：手動 > コース規定 の優先で算出
          const durationMin = resolveDuration(r);
          const courseStay = resolveStayMin(course);
          const effectiveDurationMin = durationMin ?? courseStay; // ← 優先度を固定

          // endMs も用意（scheduleItems 側が使えるように）
          const endMs = (Number.isFinite(startMs) && Number.isFinite(effectiveDurationMin as any))
            ? (startMs + (effectiveDurationMin as number) * 60_000)
            : (Number((r as any)?.endMs) || undefined);

          const drinkLabel = normalizeLabel(
            r?.drinkLabel ??
            (r as any)?.reservation?.drinkLabel ??
            (r as any)?.reservation?.drink ??
            (r as any)?.meta?.drinkLabel ??
            (r as any)?.meta?.drink ??
            r?.drink
          );
          const eatLabel = normalizeLabel(
            r?.eatLabel ??
            (r as any)?.reservation?.eatLabel ??
            (r as any)?.reservation?.eat ??
            (r as any)?.meta?.eatLabel ??
            (r as any)?.meta?.eat ??
            r?.eat
          );
          const rawNotes = pickString(
            r?.notes,
            (r as any)?.reservation?.notes,
            (r as any)?.meta?.notes,
            r?.memo,
            (r as any)?.reservation?.memo,
            (r as any)?.meta?.memo,
          ) || undefined;
          const memo = pickString(
            r?.memo,
            (r as any)?.reservation?.memo,
            (r as any)?.meta?.memo,
            rawNotes,
          ) || undefined;
          const notes = rawNotes ?? memo;
          const name = pickString(
            r?.name,
            (r as any)?.reservation?.name,
            (r as any)?.meta?.name,
            r?.guestName,
            r?.customerName,
            r?.clientName,
          );

          const createdAtMs = resolveTimestampMs((r as any)?.createdAtMs ?? (r as any)?.createdAt) ?? 0;
          const freshUntilMs = createdAtMs ? createdAtMs + 15 * 60 * 1000 : 0;

          const updatedAtMs = resolveTimestampMs((r as any)?.updatedAtMs ?? (r as any)?.updatedAt) ?? 0;
          const editedUntilMs = updatedAtMs ? updatedAtMs + 15 * 60 * 1000 : 0;

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
            notes,
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
  }, [storeId, opts?.dayStartMs, opts?.schedule?.dayStartHour, opts?.schedule?.dayEndHour, writeCacheDebounced, mergedCourses]);

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
      mergedCourses,
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
  }, [reservations, mergedCourses, opts?.visibleTables, opts?.dayStartMs]);

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
