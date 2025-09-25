// Firestore adapter for reservations — single place to read/write.
// Save and load **number (UNIX ms)** only. Never use ISO strings or Timestamp for startMs/endMs.

import { db } from '@/lib/firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  serverTimestamp,
  type DocumentData,
  type DocumentSnapshot,
} from 'firebase/firestore';

// ---------- Utils ----------
export const coerceMs = (v: any): number => {
  if (typeof v === 'number') return Math.trunc(v);
  if (v?.toMillis) return Math.trunc(v.toMillis()); // Firestore Timestamp
  if (v instanceof Date) return Math.trunc(v.getTime());
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

export const coerceStr = (v: any, fallback = ''): string => {
  if (v == null) return fallback;
  const s = typeof v === 'string' ? v : String(v);
  return s.trim();
};

export const coerceTables = (v: any): string[] =>
  Array.isArray(v) ? v.map((x) => coerceStr(x)).filter(Boolean) : v ? [coerceStr(v)] : [];

const coerceCompletedMap = (value: any): Record<string, boolean> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (!key) return;
    if (typeof raw === 'boolean') {
      out[key] = raw;
      return;
    }
    if (typeof raw === 'number') {
      out[key] = raw !== 0;
      return;
    }
    if (typeof raw === 'string') {
      const norm = raw.trim().toLowerCase();
      if (!norm) {
        out[key] = false;
        return;
      }
      if (norm === 'true' || norm === '1' || norm === 'yes') {
        out[key] = true;
        return;
      }
      if (norm === 'false' || norm === '0' || norm === 'no') {
        out[key] = false;
        return;
      }
    }
  });
  return out;
};

const coerceTimeShiftMap = (value: any): Record<string, number> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  Object.entries(value).forEach(([key, raw]) => {
    const num = Number(raw);
    if (!key || !Number.isFinite(num)) return;
    out[key] = Math.trunc(num);
  });
  return Object.keys(out).length > 0 ? out : undefined;
};

// Remove all `undefined` fields (recursively). Firestore rejects `undefined`.
const omitUndefinedDeep = (obj: any): any => {
  if (obj === undefined) return undefined;
  if (obj === null) return null;
  if (Array.isArray(obj)) return obj.map(omitUndefinedDeep);
  if (typeof obj === 'object') {
    const out: any = {};
    for (const k of Object.keys(obj)) {
      const v = (obj as any)[k];
      if (v !== undefined) out[k] = omitUndefinedDeep(v);
    }
    return out;
  }
  return obj;
};

// Safe parsers for legacy fields (HH:mm and YYYY-MM-DD)
const safeParseHHmm = (s: any) => {
  if (!s) return { hh: 0, mm: 0 };
  const [h, m] = String(s).split(':');
  const hh = Math.max(0, Math.min(23, Number(h) || 0));
  const mm = Math.max(0, Math.min(59, Number(m) || 0));
  return { hh, mm };
};

const computeStartMsFromDateAndTime = (dateStr: any, timeStr: any): number => {
  if (!dateStr || !timeStr) return 0;
  // Expect 'YYYY-MM-DD'
  const [yy, mm, dd] = String(dateStr).split('-').map((n) => Number(n));
  if (!yy || !mm || !dd) return 0;
  const { hh, mm: mmin } = safeParseHHmm(timeStr);
  // Local 0:00 base — do NOT use ISO/UTC conversions
  const day0 = new Date(yy, (mm - 1), dd, 0, 0, 0, 0).getTime();
  return day0 + ((hh * 60 + mmin) * 60 * 1000);
};

// ---------- Types ----------
export type ReservationDoc = {
  startMs: number;
  endMs?: number;
  durationMin?: number;
  tables: string[];
  name?: string;
  courseName?: string;
  course?: string;
  drinkAllYouCan?: boolean;
  foodAllYouCan?: boolean;
  drinkLabel?: string;
  eatLabel?: string;
  memo?: string;
  guests?: number;
  table?: string;
  completed?: Record<string, boolean>;
  arrived?: boolean;
  paid?: boolean;
  departed?: boolean;
  timeShift?: Record<string, number>;
  version?: number;
  createdAtMs?: number; // client ms mirror
  updatedAtMs?: number; // client ms mirror
};

export type ReservationRow = ReservationDoc & { id: string };

// ---------- Mappers ----------
export const fromSnapshot = (snap: DocumentSnapshot<DocumentData>): ReservationRow => {
  const x: any = snap.data() || {};
  let startMs = coerceMs(x.startMs);
  // Backward compatibility: when legacy docs have only date/time, build startMs safely
  if (!startMs) {
    startMs = computeStartMsFromDateAndTime(x.date, x.time);
  }
  const endMs = x.endMs != null ? coerceMs(x.endMs) : undefined;
  const durationMin =
    x.durationMin != null
      ? Math.trunc(Number(x.durationMin))
      : (endMs ? Math.trunc((endMs - startMs) / 60_000) : undefined);
  const tables = coerceTables(x.tables ?? x.table);
  const table = (x.table != null && String(x.table).trim() !== '') ? String(x.table) : (tables[0] ?? '');
  const g = Number(x.guests);
  const guests = Number.isFinite(g) ? g : 0;
  const createdAtMs = coerceMs(x.createdAtMs) || coerceMs(x.createdAt) || 0;
  const updatedAtMs = coerceMs(x.updatedAtMs) || coerceMs(x.updatedAt) || 0;
  const completed = coerceCompletedMap(x.completed);
  const timeShift = coerceTimeShiftMap(x.timeShift);
  const versionRaw = Number(x.version);
  const version = Number.isFinite(versionRaw) ? Math.trunc(versionRaw) : undefined;
  return {
    id: snap.id,
    startMs,
    endMs,
    durationMin,
    tables,
    table,
    guests,
    name: coerceStr(x.name),
    courseName: coerceStr(x.courseName ?? x.course),
    course: coerceStr(x.course ?? x.courseName),
    drinkAllYouCan: !!x.drinkAllYouCan,
    foodAllYouCan: !!x.foodAllYouCan,
    drinkLabel: coerceStr(x.drinkLabel),
    eatLabel: coerceStr(x.eatLabel),
    memo: coerceStr(x.memo),
    completed,
    arrived: !!x.arrived,
    paid: !!x.paid,
    departed: !!x.departed,
    version,
    timeShift,
    createdAtMs,
    updatedAtMs,
  };
};

export const toReservationDoc = (input: Partial<ReservationDoc> & { startMs: any; tables: any }): ReservationDoc => {
  const startMs = coerceMs(input.startMs);
  const rawEndMs = input.endMs != null ? coerceMs(input.endMs) : undefined;
  const rawDur = input.durationMin != null ? Math.trunc(Number(input.durationMin)) : undefined;
  const endMs = rawEndMs ?? (rawDur != null ? startMs + rawDur * 60_000 : undefined);
  const durationMin = rawDur ?? (endMs != null ? Math.trunc((endMs - startMs) / 60_000) : undefined);
  return {
    startMs,
    endMs,
    durationMin,
    tables: coerceTables(input.tables ?? (input as any).table),
    name: coerceStr(input.name),
    courseName: coerceStr((input as any).courseName ?? (input as any).course),
    drinkAllYouCan: !!input.drinkAllYouCan,
    foodAllYouCan: !!input.foodAllYouCan,
    drinkLabel: coerceStr(input.drinkLabel),
    eatLabel: coerceStr(input.eatLabel),
    memo: coerceStr(input.memo),
    guests: input.guests != null ? Math.trunc(Number(input.guests)) : undefined,
  };
};

// ---------- Readers (Realtime) ----------
// Overloads to maintain backward compatibility
export function listenReservationsByDay(
  storeId: string,
  dayStartMs: number,
  onNext: (rows: ReservationRow[]) => void
): () => void;
export function listenReservationsByDay(
  storeId: string,
  dayStartMs: number,
  dayEndMs: number | undefined,
  onNext: (rows: ReservationRow[]) => void
): () => void;
export function listenReservationsByDay(
  storeId: string,
  dayStartMs: number,
  a: number | ((rows: ReservationRow[]) => void) | undefined,
  b?: (rows: ReservationRow[]) => void
): () => void {
  const cb: (rows: ReservationRow[]) => void = (typeof a === 'function' ? a : b)!;
  const dayEndMs = (typeof a === 'number' && Number.isFinite(a))
    ? a
    : (dayStartMs + 24 * 60 * 60 * 1000);

  const col = collection(db, 'stores', storeId, 'reservations');
  const q = query(
    col,
    where('startMs', '>=', dayStartMs),
    where('startMs', '<', dayEndMs),
    orderBy('startMs', 'asc')
  );
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => fromSnapshot(d));
    cb(rows);
  });
}

export const listenReservationsByRange = (
  storeId: string,
  rangeStartMs: number,
  rangeEndMs: number,
  onNext: (rows: ReservationRow[]) => void
): (() => void) => {
  const col = collection(db, 'stores', storeId, 'reservations');
  const q = query(
    col,
    where('startMs', '>=', rangeStartMs),
    where('startMs', '<', rangeEndMs),
    orderBy('startMs', 'asc')
  );
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => fromSnapshot(d));
    onNext(rows);
  });
};

// ---------- Writers ----------
export const createReservation = async (
  storeId: string,
  data: ReservationDoc & { id?: string }
): Promise<string> => {
  const col = collection(db, 'stores', storeId, 'reservations');
  const payloadBase = toReservationDoc(data);
  const payload: any = {
    ...payloadBase,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  };
  const cleaned = omitUndefinedDeep(payload);
  if (data.id) {
    // caller fixed id
    const ref = doc(col, data.id);
    await setDoc(ref, cleaned, { merge: false });
    return data.id;
  }
  const ref = await addDoc(col, cleaned);
  return ref.id;
};

export const patchReservation = async (
  storeId: string,
  id: string,
  partial: Partial<ReservationDoc>
): Promise<void> => {
  const ref = doc(db, 'stores', storeId, 'reservations', id);
  const data: any = {};
  if (partial.startMs != null) data.startMs = coerceMs(partial.startMs);
  if (partial.endMs != null) data.endMs = coerceMs(partial.endMs);
  if (partial.durationMin != null) data.durationMin = Math.trunc(Number(partial.durationMin));
  if (partial.tables) data.tables = coerceTables(partial.tables);
  else if ((partial as any).table) data.tables = coerceTables((partial as any).table);
  if ('name' in partial) data.name = partial.name ?? '';
  if ('courseName' in partial) data.courseName = partial.courseName ?? '';
  if ('drinkAllYouCan' in partial) data.drinkAllYouCan = !!partial.drinkAllYouCan;
  if ('foodAllYouCan' in partial) data.foodAllYouCan = !!partial.foodAllYouCan;
  if ('drinkLabel' in partial) data.drinkLabel = partial.drinkLabel ?? '';
  if ('eatLabel' in partial) data.eatLabel = partial.eatLabel ?? '';
  if ('memo' in partial) data.memo = partial.memo ?? '';
  if (partial.guests != null) data.guests = Math.trunc(Number(partial.guests));
  // server/client timestamps for freshness markers
  (data as any).updatedAt = serverTimestamp();
  (data as any).updatedAtMs = Date.now();
  const cleaned = omitUndefinedDeep(data);
  await updateDoc(ref, cleaned);
};

export const deleteReservation = async (
  storeId: string,
  id: string
): Promise<void> => {
  const ref = doc(db, 'stores', storeId, 'reservations', id);
  await deleteDoc(ref);
};
