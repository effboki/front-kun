

import type { ScheduleItem } from '@/types/schedule';

/** 5分グリッド関連（波と合わせる） */
export const SLOT_MIN = 5;
export const SLOT_MS = SLOT_MIN * 60 * 1000;

/** ミリ秒を5分単位にスナップ（四捨五入） */
export const snap5m = (ms: number) => Math.round(ms / SLOT_MS) * SLOT_MS;

/** 5分あたりのpx（UI側で調整してOK） */
export const colPx = 12;

/** ミリ秒を「5分=1col」のpxに変換 */
export const msToPx = (ms: number) => Math.round(ms / SLOT_MS) * colPx;

/** 時間重複判定（端が接しているだけなら重複なし） */
export const isOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  Math.max(aStart, bStart) < Math.min(aEnd, bEnd);

/** 配列の交差（テーブルIDの共通要素があるか） */
const tablesIntersect = (a: readonly string[] = [], b: readonly string[] = []) => {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  for (const t of b) {
    if (set.has(t)) return true;
  }
  return false;
};

/**
 * 同卓・同時間帯の重なりがあるものに status: 'warn' を付与して返す
 * 既存 status がある場合は 'warn' を優先、未設定は 'normal'
 */
export function markConflicts(items: ScheduleItem[]): ScheduleItem[] {
  const n = items.length;
  if (n <= 1) {
    return items.map((it) => ({ ...it, status: it.status ?? 'normal' }));
  }

  const warned = new Array<boolean>(n).fill(false);

  for (let i = 0; i < n; i++) {
    const ai = items[i];
    for (let j = i + 1; j < n; j++) {
      const bj = items[j];
      if (
        tablesIntersect(ai.tables, bj.tables) &&
        isOverlap(ai.startMs, ai.endMs, bj.startMs, bj.endMs)
      ) {
        warned[i] = true;
        warned[j] = true;
      }
    }
  }

  return items.map((it, idx) => {
    if (warned[idx]) return { ...it, status: 'warn' };
    return { ...it, status: it.status ?? 'normal' };
  });
}