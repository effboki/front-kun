// src/lib/opsQueue.ts

import { getStoreId } from './firebase';
import type { Reservation } from '../types/reservation';
import type { StoreSettings } from '../types/settings';

// 名前空間化した localStorage キー
const ns = `front-kun-${getStoreId()}`;
export const QUEUE_KEY = `${ns}-opsQueue`;

// オペレーションの型定義
export type Op =
  | { type: 'add'; payload: Reservation }
  | { type: 'update'; id: string; field: string; value: any }
  | { type: 'delete'; id: string }
  | { type: 'storeSettings'; payload: StoreSettings };

/** キューに操作を追加する */
export function enqueueOp(op: Op): void {
  // ---- フィールド名マイグレーション -----------------------------
  if (op.type === 'update' && op.field === 'updateTime') {
    // 旧フィールド名を新フィールド名へ置換
    op = { ...op, field: 'updatedAt' };
  }
  // --- ID を文字列に統一 (update/delete ops) ---
  if (op.type === 'update' || op.type === 'delete') {
    op = { ...op, id: String(op.id) };
  }
  // --- ADD: payload.id を文字列に統一 ---
  if (op.type === 'add') {
    op = {
      ...op,
      payload: {
        ...op.payload,
        id: String(op.payload.id),
      } as Reservation,
    };
  }
  // ---------------------------------------------
  if (!navigator.onLine) {
    const existing = localStorage.getItem(QUEUE_KEY);
    const queue: Op[] = existing ? JSON.parse(existing) : [];
    queue.push(op);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }
}

/** キュー内のすべての操作を取り出し、空 ID エントリを除去して返す */
export function dequeueAll(): Op[] {
  const existing = localStorage.getItem(QUEUE_KEY);
  const queue: Op[] = existing ? JSON.parse(existing) : [];

  // 空 id エントリを除外
  const cleaned = queue.filter(op => {
    if (op.type === 'add') {
      // payload.id が truthy なら残す
      return op.payload?.id;
    }
    if (op.type === 'update' || op.type === 'delete') {
      // id が truthy なら残す
      return op.id;
    }
    // storeSettings などは常に残す
    return true;
  });

  // クリアして、空でなければ掃除後キューを書き戻す
  if (cleaned.length > 0) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(cleaned));
  } else {
    localStorage.removeItem(QUEUE_KEY);
  }
  return cleaned;
}

/** Flush all queued operations to Firestore (used whenオンライン復帰や手動更新時) */
export async function flushQueuedOps(): Promise<void> {
  const ops = dequeueAll();
  if (ops.length === 0) return;

  // Firestore‑related helpers
  const { saveStoreSettingsTx } = await import('./firebase');
  // Reservation CRUD helpers
  const {
    addReservationFS,
    updateReservationFS,
    deleteReservationFS,
  } = await import('./reservations');

  for (const op of ops) {
    try {
      switch (op.type) {
        case 'storeSettings':
          await saveStoreSettingsTx(op.payload);
          break;
        case 'add':
          await addReservationFS(op.payload);
          break;
        case 'update':
          await updateReservationFS(op.id, { [op.field]: op.value });
          break;
        case 'delete':
          await deleteReservationFS(op.id);
          break;
        default:
          console.warn('[flushQueuedOps] 未知の op', op);
      }
    } catch (err) {
      console.error('[flushQueuedOps] 失敗:', op, err);
    }
  }
}

// ブラウザがオンラインに戻った瞬間にキューを自動フラッシュ
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    flushQueuedOps().catch(err =>
      console.error('[opsQueue] auto flush on online failed:', err)
    );
  });
}