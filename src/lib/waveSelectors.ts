

/**
 * waveSelectors.ts
 * タスク表に渡すための WaveInputTask[] を、予約由来のソースから生成する軽量セレクタ。
 *
 * 使い方（例）:
 *   const tasksForWave = selectWaveInputTasks(reservations, { positionId, tables }, {
 *     // もしコースから“確定時刻”を導出する独自ロジックがある場合はここで注入
 *     mapToTimeMs: (r) => r.startMs, // デフォルトは startMs をそのまま使う
 *   });
 *
 * メモ:
 * - ここでは Firestore 等に依存しない純関数のみを置く
 * - コースの「タスク時間オフセット → 確定時刻」展開は useReservationsData 側のロジックを渡してもOK
 */

import type { WaveInputTask } from '@/lib/wave';

/** 予約ソース（必要に応じて拡張可） */
export type WaveSourceReservation = {
  /** 予約の基準開始ミリ秒（コース開始時刻など） */
  startMs: number;
  courseName: string;
  /** 卓番号 (UI上の表示に合わせて string 化しておく) */
  table: string;
  /** 対象人数 */
  guests: number;
  /** 担当ポジションID（集計フィルタに使用） */
  position: string;
  /** 任意: 他のフィールドが必要であれば自由に追加してください */
  // [key: string]: unknown;
};

export type WaveInputFilters = {
  positionId: string;
  tables: string[]; // 空配列 = フィルタなし（全卓）
};

export type SelectWaveOpts = {
  /**
   * 予約 → 確定時刻(ms)の導出ロジック。
   * - number を返した場合はその1本を採用
   * - number[] を返した場合は複数タスクとして展開
   * 未指定の場合は `r.startMs` を使用
   */
  mapToTimeMs?: (r: WaveSourceReservation) => number | number[];
};

/**
 * 予約配列から WaveInputTask[] を生成
 * - position / tables でフィルタ後、確定時刻に変換
 * - 返値は timeMs 昇順でソート
 */
export function selectWaveInputTasks(
  reservations: WaveSourceReservation[],
  filters: WaveInputFilters,
  opts: SelectWaveOpts = {}
): WaveInputTask[] {
  const { positionId, tables } = filters;
  const allowAllTables = !tables || tables.length === 0;
  const mapToTimeMs =
    opts.mapToTimeMs ??
    ((r: WaveSourceReservation) => r.startMs);

  const out: WaveInputTask[] = [];

  for (const r of reservations || []) {
    // フィルタ：ポジション
    if (r.position !== positionId) continue;
    // フィルタ：卓
    const tableStr = String(r.table ?? '');
    if (!allowAllTables && !tables.includes(tableStr)) continue;

    // 確定時刻へマッピング
    const t = mapToTimeMs(r);
    const times: number[] = Array.isArray(t) ? t : [t];

    for (const timeMs of times) {
      if (!Number.isFinite(timeMs)) continue;
      out.push({
        timeMs,
        guests: Number(r.guests) || 0,
        positionId: r.position,
        table: tableStr,
      });
    }
  }

  // 時刻昇順で返す
  out.sort((a, b) => a.timeMs - b.timeMs);
  return out;
}