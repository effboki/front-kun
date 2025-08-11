// src/lib/opsQueue.ts (hardened queue)

import { getStoreId } from './firebase';

// =========================
// Local storage key (per store)
// =========================
const ns = `front-kun-${getStoreId()}`;
export const QUEUE_KEY = `${ns}-opsQueue`;

// =========================
// Op types (store-aware / dedupe-able)
// =========================
interface BaseOp {
  storeId: string;
  dedupeKey?: string; // optional: replace same-key op
}

export type Op =
  | ({ type: 'add'; payload: any } & BaseOp)
  | ({ type: 'update'; id: string; field: string; value: any } & BaseOp)
  | ({ type: 'delete'; id: string } & BaseOp)
  | ({ type: 'storeSettings'; payload: any } & BaseOp);

// =========================
// Helpers: load/save queue
// =========================
function loadQueue(): Op[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(QUEUE_KEY);
    const arr: any[] = raw ? JSON.parse(raw) : [];
    // 旧フォーマットのマイグレーション（storeId がない場合は現在の storeId を付与）
    const sid = getStoreId();
    return arr.map((op) => ({ storeId: sid, ...op })) as Op[];
  } catch {
    return [];
  }
}

function saveQueue(queue: Op[]) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (queue.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // no-op
  }
}

// =========================
// Enqueue
// =========================
// Overload signatures (make TS happy at call sites)
export function enqueueOp(op: { type: 'add'; payload: any; storeId?: string; dedupeKey?: string }): void;
export function enqueueOp(op: { type: 'update'; id: string; field: string; value: any; storeId?: string; dedupeKey?: string }): void;
export function enqueueOp(op: { type: 'delete'; id: string; storeId?: string; dedupeKey?: string }): void;
export function enqueueOp(op: { type: 'storeSettings'; payload: any; storeId?: string; dedupeKey?: string }): void;

// Implementation
export function enqueueOp(op: any): void {
  const storeId = op.storeId || getStoreId();
  let normalized: Op;

  // ---- フィールド名マイグレーション ----
  if (op?.type === 'update' && op.field === 'updateTime') {
    op = { ...op, field: 'updatedAt' };
  }

  // ---- ID を文字列に統一 ----
  if (op?.type === 'update') {
    op.id = String(op.id);
  }
  if (op?.type === 'delete') {
    op.id = String(op.id);
  }
  if (op?.type === 'add') {
    op.payload = { ...(op.payload || {}), id: String(op.payload?.id ?? '') };
  }

  normalized = { ...(op as any), storeId } as Op;

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

    // Firestore helpers
    const { saveStoreSettingsTx } = await import('./firebase');
    const { addReservationFS, updateReservationFS, deleteReservationFS } = await import('./reservations');

    const failed: Op[] = [];

    for (const op of toProcess) {
      try {
        switch (op.type) {
          case 'storeSettings':
            await saveStoreSettingsTx(op.payload);
            break;
          case 'add':
            await addReservationFS(op.payload);
            break;
          case 'update': {
            // timeShift.* は差分インクリメントとして扱う
            const m = op.field.match(/^timeShift\.(.+)$/);
            if (m) {
              const label = m[1];
              const delta = Number(op.value) || 0;
              await updateReservationFS(op.id, {}, { [label]: delta });
            } else {
              await updateReservationFS(op.id, { [op.field]: op.value });
            }
            break;
          }
          case 'delete':
            await deleteReservationFS(op.id);
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