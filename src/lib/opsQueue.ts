import { type Reservation, type ReservationFieldValue } from '@/types';
import { type StoreSettings } from '@/types/settings';
import { getStoreId } from './firebase';

// =========================
// Local storage key (per store, resolved lazily for SPA store switching)
// =========================
const queueKeyForStore = (storeId: string) => `front-kun-${storeId}-opsQueue`;
export const getQueueKey = () => queueKeyForStore(getStoreId());

// =========================
// Op types (store-aware / dedupe-able)
// =========================
type ReservationPayload = Pick<Reservation, 'id'> & Record<string, unknown>;
type UpdateValue = ReservationFieldValue | number;

interface BaseOp {
  storeId: string;
  dedupeKey?: string;
  /** enqueued timestamp (ms). Used to drop stale offline writes safely. */
  queuedAt?: number;
}

type AddOp = { type: 'add'; payload: ReservationPayload } & BaseOp;
type UpdateOp = { type: 'update'; id: string; field: string; value: UpdateValue } & BaseOp;
type DeleteOp = { type: 'delete'; id: string } & BaseOp;
type StoreSettingsOp = { type: 'storeSettings'; payload: Partial<StoreSettings> } & BaseOp;

export type Op = AddOp | UpdateOp | DeleteOp | StoreSettingsOp;
type EnqueueInput =
  | Omit<AddOp, 'storeId'>
  | Omit<UpdateOp, 'storeId'>
  | Omit<DeleteOp, 'storeId'>
  | Omit<StoreSettingsOp, 'storeId'>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

type LegacyQueuedAt = { queuedAt?: unknown; ts?: unknown };

const normalizeQueuedAt = (input: LegacyQueuedAt): number | undefined => {
  const raw = input.queuedAt ?? input.ts;
  const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(num) ? Math.trunc(num) : undefined;
};

const normalizeReservationPayload = (payload: unknown): ReservationPayload | null => {
  if (!isRecord(payload)) return null;
  const idValue = payload.id;
  if (typeof idValue !== 'string' && typeof idValue !== 'number') return null;
  return { ...payload, id: String(idValue) };
};

const normalizeOp = (op: unknown, fallbackStoreId: string): Op | null => {
  if (!isRecord(op)) return null;
  const dedupeKey = typeof op.dedupeKey === 'string' ? op.dedupeKey : undefined;
  const queuedAt = normalizeQueuedAt(op as LegacyQueuedAt);
  const storeId =
    typeof op.storeId === 'string' && op.storeId.length > 0 ? op.storeId : fallbackStoreId;

  switch (op.type) {
    case 'add': {
      const payload = normalizeReservationPayload(op.payload);
      if (!payload) return null;
      return { type: 'add', payload, storeId, dedupeKey, queuedAt };
    }
    case 'update': {
      const idValue = op.id;
      if (typeof idValue !== 'string' && typeof idValue !== 'number') return null;
      const fieldValue = typeof op.field === 'string' ? op.field : '';
      if (!fieldValue) return null;
      const field = fieldValue === 'updateTime' ? 'updatedAt' : fieldValue;
      return {
        type: 'update',
        id: String(idValue),
        field,
        value: op.value as UpdateValue,
        storeId,
        dedupeKey,
        queuedAt,
      };
    }
    case 'delete': {
      const idValue = op.id;
      if (typeof idValue !== 'string' && typeof idValue !== 'number') return null;
      return { type: 'delete', id: String(idValue), storeId, dedupeKey, queuedAt };
    }
    case 'storeSettings': {
      if (!isRecord(op.payload)) return null;
      return {
        type: 'storeSettings',
        payload: op.payload as Partial<StoreSettings>,
        storeId,
        dedupeKey,
        queuedAt,
      };
    }
    default:
      return null;
  }
};

// =========================
// Helpers: load/save queue
// =========================
function loadQueue(): Op[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(getQueueKey());
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    const sid = getStoreId();
    return parsed
      .map((item) => normalizeOp(item, sid))
      .filter((op): op is Op => Boolean(op));
  } catch {
    return [];
  }
}

function saveQueue(queue: Op[]) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (queue.length === 0) localStorage.removeItem(getQueueKey());
    else localStorage.setItem(getQueueKey(), JSON.stringify(queue));
  } catch {
    // no-op
  }
}

// =========================
// Enqueue
// =========================
export function enqueueOp(op: EnqueueInput): void {
  const normalized = normalizeOp(op, getStoreId());
  if (!normalized) {
    console.warn('[enqueueOp] dropped invalid op', op);
    return;
  }
  // Stamp enqueue time (legacy entries may not have it)
  if (!Number.isFinite(normalized.queuedAt ?? Number.NaN)) {
    normalized.queuedAt = Date.now();
  }

  // 既存キューを読み取り
  const queue = loadQueue();

  // dedupeKey があれば置き換え（最後の状態のみ保持）
  if (normalized.dedupeKey) {
    const idx = queue.findIndex((q) => q.dedupeKey === normalized.dedupeKey);
    if (idx >= 0) {
      queue[idx] = normalized;
    } else {
      queue.push(normalized);
    }
  } else {
    queue.push(normalized);
  }

  // 直ちに永続化
  saveQueue(queue);
}

// 互換関数（呼び出し側の利用を考慮して残す）
export function dequeueAll(): Op[] {
  const q = loadQueue();
  // 空 ID を除去
  const cleaned = q.filter((op) => {
    if (op.type === 'add') return Boolean(op.payload?.id);
    if (op.type === 'update' || op.type === 'delete') return Boolean(op.id);
    return true; // storeSettings は残す
  });
  saveQueue(cleaned);
  return cleaned;
}

// =========================
// Flush (fails are re-queued)
// =========================
let _flushing = false;

export async function flushQueuedOps(): Promise<void> {
  if (_flushing) return; // 再入防止
  _flushing = true;
  try {
    const currentStore = getStoreId();
    const all = loadQueue();
    const toProcess = all.filter((op) => op.storeId === currentStore);
    const keepOthers = all.filter((op) => op.storeId !== currentStore);

    if (toProcess.length === 0) {
      // 他店舗のキューだけならそのまま保持
      saveQueue(keepOthers);
      return;
    }

    // Drop obviously stale operations (例: 前日のオフライン編集を今日反映しない)
    const now = Date.now();
    const STALE_MS = 36 * 60 * 60 * 1000; // 36h safety window to allow overnight work
    const freshOps: Op[] = [];
    let dropped = 0;
    toProcess.forEach((op) => {
      const ts = normalizeQueuedAt(op as LegacyQueuedAt);
      if (ts !== undefined && now - ts > STALE_MS) {
        dropped += 1;
        return;
      }
      if (ts === undefined) {
        // legacy entry: keep but stamp to avoid future indefinite retries
        op.queuedAt = now;
      }
      freshOps.push(op);
    });
    if (dropped > 0) {
      console.warn(`[flushQueuedOps] dropped ${dropped} stale queued ops (older than ${STALE_MS / 3600000}h)`);
    }

    // Firestore helpers
    const { saveStoreSettingsTx } = await import('./firebase');
    const {
      addReservationFS,
      updateReservationFS,
      deleteReservationFS,
      deleteAllReservationsFS,
    } = await import('./reservations');

    const failed: Op[] = [];

    for (const op of freshOps) {
      try {
        switch (op.type) {
          case 'storeSettings':
            await saveStoreSettingsTx(op.payload, { force: true });
            break;
          case 'add':
            await addReservationFS(op.payload, { force: true });
            break;
          case 'update': {
            // timeShift.* は差分インクリメントとして扱う
            const m = op.field.match(/^timeShift\.(.+)$/);
            if (m) {
              const label = m[1];
              const delta = Number(op.value) || 0;
              await updateReservationFS(op.id, {}, { [label]: delta }, { force: true });
            } else {
              await updateReservationFS(op.id, { [op.field]: op.value }, undefined, { force: true });
            }
            break;
          }
          case 'delete':
            if (op.id === '0') {
              await deleteAllReservationsFS({ force: true });
            } else {
              await deleteReservationFS(op.id, { force: true });
            }
            break;
          default:
            console.warn('[flushQueuedOps] Unknown op', op);
        }
      } catch (err) {
        console.error('[flushQueuedOps] failed:', op, err);
        failed.push(op); // 失敗は戻し入れ
      }
    }

    // 失敗分 + 他店舗分を戻す
    saveQueue(keepOthers.concat(failed));
  } finally {
    _flushing = false;
  }
}

// 自動フラッシュ（オンライン復帰）
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    flushQueuedOps().catch((err) => console.error('[opsQueue] auto flush on online failed:', err));
  });
}
