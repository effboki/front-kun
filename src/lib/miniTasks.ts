

// ミニタスク関連の軽量ユーティリティ
// - 型は types/settings から取り込み
// - Firestore I/O は別ファイル（lib/firebase/miniTasks.ts）に分離する方針

import type { MiniTaskTemplate, StoreSettingsValue } from '@/types/settings';

/** 画面表示用のインスタンス（テンプレ + 完了状態） */
export type MiniTaskInstance = {
  id: string;
  label: string;
  done?: boolean;
};

/** ソート用：order（昇順）→ label（昇順） */
function sortByOrderThenLabel(a: MiniTaskTemplate, b: MiniTaskTemplate) {
  const od = (a.order ?? 0) - (b.order ?? 0);
  if (od !== 0) return od;
  return a.label.localeCompare(b.label, 'ja');
}

/**
 * 自分のポジション用のミニタスクテンプレ一覧を取得（activeのみ／並び替え済み）
 */
export function getMyMiniTaskTemplates(
  settings: StoreSettingsValue,
  positionId: string
): MiniTaskTemplate[] {
  const map = settings.miniTasksByPosition ?? {};
  const arr = map[positionId] ?? [];
  return arr.filter(t => t?.active !== false).sort(sortByOrderThenLabel);
}

/**
 * テンプレ一覧 + 完了集合(Set) から、画面表示用の配列へ変換
 */
export function toInstances(
  templates: MiniTaskTemplate[],
  doneSet: Set<string>
): MiniTaskInstance[] {
  return templates.map(t => ({
    id: t.id,
    label: t.label,
    done: doneSet.has(t.id),
  }));
}

/** 未完了数を数えるヘルパ（バッジ表示などに利用） */
export function countPending(instances: MiniTaskInstance[]): number {
  return instances.reduce((n, it) => n + (it.done ? 0 : 1), 0);
}

/** yyyymmdd 文字列（当日キー用） */
export function yyyymmdd(d = new Date()): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}   