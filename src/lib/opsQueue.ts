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
  | { type: 'update'; id: number; field: string; value: any }
  | { type: 'delete'; id: number }
  | { type: 'storeSettings'; payload: StoreSettings };

/** キューに操作を追加する */
export function enqueueOp(op: Op): void {
  if (!navigator.onLine) {
    const existing = localStorage.getItem(QUEUE_KEY);
    const queue: Op[] = existing ? JSON.parse(existing) : [];
    queue.push(op);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }
}

/** キュー内のすべての操作を取り出し、クリアして返す */
export function dequeueAll(): Op[] {
  const existing = localStorage.getItem(QUEUE_KEY);
  const queue: Op[] = existing ? JSON.parse(existing) : [];
  localStorage.removeItem(QUEUE_KEY);
  return queue;
}