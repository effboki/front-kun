'use client';

import type { ReservationDoc } from '@/lib/firestoreReservations';
import { parseTimeToMinutes, startOfDayMs, msToHHmmFromDay } from '@/lib/time';
import { deleteField } from 'firebase/firestore';
import { addReservationFS, updateReservationFS, deleteReservationFS } from '@/lib/reservations';

export type ReservationCreateInput = {
  startMs: number; // 予約開始（エポックms）
  tables: string[]; // 卓（複数可）
  table?: string; // 単一卓（UI 入力の便宜）
  guests: number; // 人数
  name?: string;
  courseName?: string;
  drinkAllYouCan?: boolean;
  foodAllYouCan?: boolean;
  drinkLabel?: string;
  eatLabel?: string;
  memo?: string;
  durationMin?: number; // 任意: 指定があれば保存
  endMs?: number; // 任意: 指定があれば保存
  time?: string;
  notes?: string;
  course?: string;
  drink?: string;
  eat?: string;
};

export type ReservationPatch = Partial<ReservationCreateInput> & Record<string, unknown>;

/**
 * Firestore I/O: stores/{storeId}/reservations/{reservationId}
 * すべて number(ms) で保存。toISOString()/Timestamp は使用しない。
 */
export function useReservationMutations(storeId: string, options?: { dayStartMs?: number }) {
  // --- sanitize helpers ---
  const toStr = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const trimOrEmpty = (v: unknown) => toStr(v).trim();
  const toNum = (v: unknown) => (typeof v === 'number' ? v : Number(v));
  const toBool = (v: unknown) => !!v;
  const toTables = (v: any) => (Array.isArray(v) ? v : v ? [v] : []).map((s) => String(s)).filter(Boolean);
  const storeSlug = (storeId ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) || 'res';

  // ---- create ----
  const generateReservationId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${storeSlug}-${crypto.randomUUID()}`;
    }
    return `${storeSlug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  };

  async function createReservation(input: ReservationCreateInput): Promise<string> {
    // startMs: 既に number 指定があれば尊重。無ければ dayStartMs + HH:mm
    let startMs: number | undefined;
    const startMsCandidate = toNum(input.startMs);
    if (Number.isFinite(startMsCandidate)) {
      startMs = Math.trunc(startMsCandidate);
    } else {
      const t = trimOrEmpty((input as any).time);
      if (t) {
        const mins = parseTimeToMinutes(t);
        const base0 = startOfDayMs(options?.dayStartMs ?? Date.now());
        startMs = Math.trunc(base0 + mins * 60_000);
      }
    }
    if (!Number.isFinite(startMs as number)) {
      throw new Error('startMs (number) or time (HH:mm) is required');
    }
    const guests = Math.trunc(Number(input.guests) || 0);
    const tableSingle = String((input as any).table ?? '');
    const tablesSrc = Array.isArray(input.tables)
      ? input.tables
      : (tableSingle ? [tableSingle] : []);
    const tablesNorm = toTables(tablesSrc);

    const drinkLabelNorm = trimOrEmpty(
      (input as any).drinkLabel ?? (input as any).drink
    );
    const eatLabelNorm = trimOrEmpty(
      (input as any).eatLabel ?? (input as any).eat
    );
    const hasDrinkFlag = 'drinkAllYouCan' in input;
    const hasFoodFlag = 'foodAllYouCan' in input;
    const drinkAllFlag = hasDrinkFlag ? toBool(input.drinkAllYouCan) : drinkLabelNorm.length > 0;
    const foodAllFlag = hasFoodFlag ? toBool(input.foodAllYouCan) : eatLabelNorm.length > 0;

    const payload: ReservationDoc & { id?: string } = {
      startMs,
      endMs: input.endMs != null ? toNum(input.endMs) : undefined,
      tables: tablesNorm,
      table: tableSingle || (tablesNorm[0] ?? ''),
      name: trimOrEmpty(input.name),
      courseName: trimOrEmpty(input.courseName) || undefined,
      drinkAllYouCan: drinkAllFlag,
      foodAllYouCan: foodAllFlag,
      drinkLabel: drinkLabelNorm,
      eatLabel: eatLabelNorm,
      memo: trimOrEmpty(input.memo),
    } as any;

    (payload as any).drink = drinkLabelNorm;
    (payload as any).eat = eatLabelNorm;

    // durationMin: save only when explicitly specified (auto = omit)
    if (input.durationMin != null) {
      const n = toNum(input.durationMin);
      if (Number.isFinite(n)) {
        (payload as any).durationMin = Math.trunc(n);
      }
    }

    // --- course/courseName を正規化して同値を保存 ---
    {
      const courseNameNorm = trimOrEmpty((input as any).course ?? input.courseName);
      const courseLabel = courseNameNorm || '未選択';
      (payload as any).course = courseLabel;     // UI 互換フィールド
      payload.courseName = courseLabel;          // 正規フィールド
    }

    // guests を number で保存（未設定は 0）
    (payload as any).guests = guests;

    // UI-互換のフィールド time と notes（必要なら memo も）を保存
    (payload as any).time = trimOrEmpty((input as any).time) || undefined;
    (payload as any).notes = trimOrEmpty((input as any).notes ?? (input as any).memo);

    // guests も一緒に保存したい場合は payload に追記
    //(payload as any).guests = Number.isFinite(toNum(input.guests)) ? Math.trunc(toNum(input.guests)) : 0;

    // client-side mirror (serverTimestamp is appended in adapter)
    (payload as any).createdAtMs = Date.now();
    (payload as any).updatedAtMs = Date.now();

    const id = (input as any)?.id ? String((input as any).id) : generateReservationId();
    (payload as any).id = id;

    await addReservationFS(payload as any);
    return id;
  }

  // ---- update (partial) ----
  async function updateReservation(id: string, patch: ReservationPatch): Promise<void> {
    const p: any = {};

    const guests = Math.trunc(Number((patch as any).guests) || 0);
    const tableStr = String((patch as any).table ?? '');
    const tablesNorm = Array.isArray((patch as any).tables)
      ? (patch as any).tables.map(String)
      : (tableStr ? [tableStr] : []);

    if (patch.startMs != null) {
      const n = toNum(patch.startMs);
      if (!Number.isFinite(n)) throw new Error('startMs must be a finite number');
      p.startMs = n;
    }
    if (patch.endMs != null) {
      const n = toNum(patch.endMs);
      if (!Number.isFinite(n)) throw new Error('endMs must be a finite number');
      p.endMs = n;
    }
    if ('durationMin' in patch) {
      const v = (patch as any).durationMin;
      // auto / reset: null, undefined, empty string, or string 'auto'
      if (v == null || v === '' || (typeof v === 'string' && v.toLowerCase() === 'auto')) {
        p.durationMin = deleteField() as any;
      } else {
        const n = toNum(v);
        if (!Number.isFinite(n)) throw new Error('durationMin must be a finite number');
        p.durationMin = Math.trunc(n);
      }
    }

    if (p.startMs == null && typeof (patch as any).time === 'string' && (patch as any).time) {
      const mins = parseTimeToMinutes(String((patch as any).time));
      const base0 = startOfDayMs(options?.dayStartMs ?? Date.now());
      p.startMs = Math.trunc(base0 + mins * 60_000);
    }

    if (patch.tables) p.tables = tablesNorm;
    if ('table' in patch) {
      p.table = tableStr;
      if (!p.tables) p.tables = tablesNorm;
    }

    if ('name' in patch) p.name = trimOrEmpty(patch.name);

    // --- course/courseName を正規化して同値に ---
    if ('course' in patch || 'courseName' in patch) {
      const courseNameNorm = trimOrEmpty((patch as any).course ?? patch.courseName);
      const courseLabel = courseNameNorm || '未選択';
      p.courseName = courseLabel;
      (p as any).course = courseLabel;
    }

    if ('drink' in patch) {
      const dl = trimOrEmpty((patch as any).drink);
      (p as any).drink = dl;
      if (!('drinkLabel' in patch)) p.drinkLabel = dl;
      if (!('drinkAllYouCan' in patch)) p.drinkAllYouCan = dl.length > 0;
    }
    if ('eat' in patch) {
      const el = trimOrEmpty((patch as any).eat);
      (p as any).eat = el;
      if (!('eatLabel' in patch)) p.eatLabel = el;
      if (!('foodAllYouCan' in patch)) p.foodAllYouCan = el.length > 0;
    }

    if ('drinkAllYouCan' in patch) p.drinkAllYouCan = toBool(patch.drinkAllYouCan);
    if ('foodAllYouCan' in patch) p.foodAllYouCan = toBool(patch.foodAllYouCan);

    if ('drinkLabel' in patch) p.drinkLabel = trimOrEmpty(patch.drinkLabel);
    if ('eatLabel' in patch) p.eatLabel = trimOrEmpty(patch.eatLabel);

    if ('memo' in patch) p.memo = trimOrEmpty(patch.memo);

    if ('notes' in patch) (p as any).notes = trimOrEmpty((patch as any).notes);
    if ('time' in patch) (p as any).time = trimOrEmpty((patch as any).time);

    if ('guests' in patch) (p as any).guests = guests;

    // --- sync display time (HH:mm) with startMs when it changes ---
    // We intentionally override any incoming `time` to ensure consistency.
    if (p.startMs != null) {
      const base0 = startOfDayMs(options?.dayStartMs ?? p.startMs);
      (p as any).time = msToHHmmFromDay(p.startMs, base0);
    }

    // client-side mirror (serverTimestamp is appended in adapter)
    (p as any).updatedAtMs = Date.now();

    await updateReservationFS(id, p as Partial<ReservationDoc>);
  }

  // ---- set (upsert) ----
  async function setReservation(id: string, input: ReservationCreateInput): Promise<string> {
    let startMs: number | undefined;
    const startMsCandidate = toNum(input.startMs);
    if (Number.isFinite(startMsCandidate)) {
      startMs = Math.trunc(startMsCandidate);
    } else {
      const t = trimOrEmpty((input as any).time);
      if (t) {
        const mins = parseTimeToMinutes(t);
        const base0 = startOfDayMs(options?.dayStartMs ?? Date.now());
        startMs = Math.trunc(base0 + mins * 60_000);
      }
    }
    if (!Number.isFinite(startMs as number)) {
      throw new Error('startMs is required and must be a finite number');
    }
    const guests = Math.trunc(Number(input.guests) || 0);
    const tableSingle = String((input as any).table ?? '');
    const tablesSrc = Array.isArray(input.tables)
      ? input.tables
      : (tableSingle ? [tableSingle] : []);
    const tablesNorm = toTables(tablesSrc);

    const drinkLabelNorm = trimOrEmpty(
      (input as any).drinkLabel ?? (input as any).drink
    );
    const eatLabelNorm = trimOrEmpty(
      (input as any).eatLabel ?? (input as any).eat
    );
    const hasDrinkFlag = 'drinkAllYouCan' in input;
    const hasFoodFlag = 'foodAllYouCan' in input;
    const drinkAllFlag = hasDrinkFlag ? toBool(input.drinkAllYouCan) : drinkLabelNorm.length > 0;
    const foodAllFlag = hasFoodFlag ? toBool(input.foodAllYouCan) : eatLabelNorm.length > 0;

    const __courseNameNorm = trimOrEmpty((input as any).course ?? input.courseName);
    const __courseLabel = __courseNameNorm || '未選択';

    const data: any = {
      id,
      startMs,
      endMs: input.endMs != null ? toNum(input.endMs) : undefined,
      tables: tablesNorm,
      table: tableSingle || (tablesNorm[0] ?? ''),
      name: trimOrEmpty(input.name),
      course: __courseLabel as any,
      courseName: __courseLabel,
      drinkAllYouCan: drinkAllFlag,
      foodAllYouCan: foodAllFlag,
      drinkLabel: drinkLabelNorm,
      eatLabel: eatLabelNorm,
      memo: trimOrEmpty(input.memo),
      guests,
      time: trimOrEmpty((input as any).time) || undefined,
      notes: trimOrEmpty((input as any).notes ?? (input as any).memo),
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };
    data.drink = drinkLabelNorm;
    data.eat = eatLabelNorm;
    if (input.durationMin != null) {
      const n = toNum(input.durationMin);
      if (Number.isFinite(n)) data.durationMin = Math.trunc(n);
    }
    await addReservationFS(data as any);
    return id;
  }

  // ---- delete ----
  async function deleteReservation(id: string): Promise<void> {
    await deleteReservationFS(id);
  }

  return {
    createReservation,
    updateReservation,
    setReservation,
    deleteReservation,
  };
}
