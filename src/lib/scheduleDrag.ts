/**
 * scheduleDrag.ts
 *
 * ドラッグ移動／リサイズ用のユーティリティ関数群。
 * - Grid座標（列インデックス）と時間(ms) の相互変換
 * - スナップ（列単位）
 * - 安全域（タイムライン範囲外に出ないクランプ）
 * - 移動／リサイズの結果レンジ計算
 */

// ====== 型定義 ======
export type Ms = number;

export interface TimeRange {
  startMs: Ms;
  endMs: Ms;
}

/**
 * グリッド設定
 * gridStartMs ~ gridEndMs のタイムラインを、colMinutes分を1列として表す前提。
 * colWidthPx は1列の幅（px）。
 */
export interface GridConfig {
  gridStartMs: Ms; // タイムラインの左端（ms）
  gridEndMs: Ms;   // タイムラインの右端（ms）
  colMinutes: number; // 1列あたりの分数（例: 5）
  colWidthPx: number; // 1列あたりのpx幅（例: 16）
  minDurationMin: number; // 最小滞在時間（分）
  maxDurationMin?: number; // 最大滞在時間（分）。未指定なら制限なし
  edgePaddingMin?: number; // 左右の安全パディング（分）。未指定なら0
}

// ====== 基本ユーティリティ ======
const MINUTE_MS = 60_000;

export const minutesToMs = (min: number) => min * MINUTE_MS;
export const msToMinutes = (ms: number) => ms / MINUTE_MS;

export const stepMs = (cfg: GridConfig) => minutesToMs(cfg.colMinutes);

/** 総列数（タイムライン全体の列数） */
export const totalCols = (cfg: GridConfig) =>
  Math.round((cfg.gridEndMs - cfg.gridStartMs) / stepMs(cfg));

/** 安全域を列数で返す */
export const padCols = (cfg: GridConfig) =>
  Math.ceil((cfg.edgePaddingMin ?? 0) / cfg.colMinutes);

/** 最小/最大滞在時間を列数で返す */
export const minDurCols = (cfg: GridConfig) =>
  Math.max(1, Math.ceil(cfg.minDurationMin / cfg.colMinutes));
export const maxDurCols = (cfg: GridConfig) =>
  cfg.maxDurationMin ? Math.floor(cfg.maxDurationMin / cfg.colMinutes) : undefined;

/** ms → 列インデックス（グリッド開始を0列目とする） */
export const msToCol = (ms: Ms, cfg: GridConfig) =>
  Math.round((ms - cfg.gridStartMs) / stepMs(cfg));

/** 列インデックス → ms（列の左端のms） */
export const colToMs = (col: number, cfg: GridConfig) =>
  cfg.gridStartMs + col * stepMs(cfg);

/** px差分 → 列差分（四捨五入でスナップ） */
export const pxToColDelta = (deltaPx: number, cfg: GridConfig) =>
  Math.round(deltaPx / cfg.colWidthPx);

/** 列差分 → px差分 */
export const colDeltaToPx = (deltaCol: number, cfg: GridConfig) =>
  deltaCol * cfg.colWidthPx;

/** 範囲を start<end に正規化 */
export const normalizeRange = (r: TimeRange): TimeRange =>
  r.startMs <= r.endMs ? r : { startMs: r.endMs, endMs: r.startMs };

/**
 * レンジをタイムライン＋安全域内にクランプ。
 * （必要なら開始／終了のどちらかをずらして最小長を維持）
 */
export function clampRangeToGrid(rng: TimeRange, cfg: GridConfig): TimeRange {
  const r = normalizeRange(rng);
  const leftPadCols = padCols(cfg);
  const rightPadCols = padCols(cfg);
  const total = totalCols(cfg);
  const minLenCols = minDurCols(cfg);

  const minCol = leftPadCols;
  const maxCol = total - rightPadCols; // 右端はこの列までOK（右端ぴったり）

  let sCol = msToCol(r.startMs, cfg);
  let eCol = msToCol(r.endMs, cfg);

  // まず端にはみ出たら押し戻す（長さは保持）
  if (sCol < minCol) {
    eCol += (minCol - sCol);
    sCol = minCol;
  }
  if (eCol > maxCol) {
    sCol -= (eCol - maxCol);
    eCol = maxCol;
  }

  // 最小長を満たす
  if (eCol - sCol < minLenCols) {
    eCol = Math.min(maxCol, sCol + minLenCols);
    sCol = Math.max(minCol, eCol - minLenCols);
  }

  // 最大長がある場合
  const maxLen = maxDurCols(cfg);
  if (maxLen && eCol - sCol > maxLen) {
    eCol = sCol + maxLen;
    if (eCol > maxCol) {
      // 右が溢れるなら左へ寄せる
      sCol = Math.max(minCol, maxCol - maxLen);
      eCol = sCol + maxLen;
    }
  }

  return { startMs: colToMs(sCol, cfg), endMs: colToMs(eCol, cfg) };
}

// ====== 移動／リサイズ 計算 ======
export interface DragCalcInput {
  range: TimeRange;     // 現在のレンジ
  deltaPx: number;      // ドラッグのx差分（px, DnD Kitのevent.delta.x）
  cfg: GridConfig;      // グリッド設定
}

/**
 * ドラッグ移動：開始・終了を等しくシフト
 * - px差分を列差分にスナップし、はみ出しは範囲内に収める
 */
export function moveByPx({ range, deltaPx, cfg }: DragCalcInput): TimeRange {
  const r = normalizeRange(range);
  const dCol = pxToColDelta(deltaPx, cfg);

  const sCol = msToCol(r.startMs, cfg) + dCol;
  const eCol = msToCol(r.endMs, cfg) + dCol;

  return clampRangeToGrid({ startMs: colToMs(sCol, cfg), endMs: colToMs(eCol, cfg) }, cfg);
}

/**
 * リサイズ（開始側）
 * - 開始のみ列単位で動かし、最小長・最大長・範囲外を考慮
 */
export function resizeStartByPx({ range, deltaPx, cfg }: DragCalcInput): TimeRange {
  const r = normalizeRange(range);
  const dCol = pxToColDelta(deltaPx, cfg);

  const total = totalCols(cfg);
  const left = padCols(cfg);
  const right = padCols(cfg);
  const minLen = minDurCols(cfg);
  const maxLen = maxDurCols(cfg);

  let sCol = msToCol(r.startMs, cfg) + dCol;
  const eCol = msToCol(r.endMs, cfg);

  // 左端の境界
  sCol = Math.max(left, sCol);
  // 最小長
  sCol = Math.min(sCol, eCol - minLen);
  // 最大長（ある場合）
  if (maxLen) {
    sCol = Math.max(sCol, eCol - maxLen);
  }

  // 右端チェック（長さを満たす前提での最終ガード）
  const maxCol = total - right;
  if (eCol > maxCol) {
    // 終了が溢れているケースは、全体を左へ寄せてから再計算
    const overflow = eCol - maxCol;
    sCol -= overflow;
  }

  return clampRangeToGrid({ startMs: colToMs(sCol, cfg), endMs: colToMs(eCol, cfg) }, cfg);
}

/**
 * リサイズ（終了側）
 * - 終了のみ列単位で動かし、最小長・最大長・範囲外を考慮
 */
export function resizeEndByPx({ range, deltaPx, cfg }: DragCalcInput): TimeRange {
  const r = normalizeRange(range);
  const dCol = pxToColDelta(deltaPx, cfg);

  const total = totalCols(cfg);
  const right = padCols(cfg);
  const left = padCols(cfg);
  const minLen = minDurCols(cfg);
  const maxLen = maxDurCols(cfg);

  const sCol = msToCol(r.startMs, cfg);
  let eCol = msToCol(r.endMs, cfg) + dCol;

  // 右端の境界
  const maxCol = total - right;
  eCol = Math.min(maxCol, eCol);
  // 最小長
  eCol = Math.max(eCol, sCol + minLen);
  // 最大長（ある場合）
  if (maxLen) {
    eCol = Math.min(eCol, sCol + maxLen);
  }

  // 左端チェック（最終ガード）
  const minCol = left;
  if (sCol < minCol) {
    const deficit = minCol - sCol;
    eCol += deficit;
  }

  return clampRangeToGrid({ startMs: colToMs(sCol, cfg), endMs: colToMs(eCol, cfg) }, cfg);
}

// ====== 便利関数（列レンジベース） ======
export interface ColRange { startCol: number; endCol: number }

export const timeToColRange = (rng: TimeRange, cfg: GridConfig): ColRange => ({
  startCol: msToCol(rng.startMs, cfg),
  endCol: msToCol(rng.endMs, cfg),
});

export const colRangeToTime = (cr: ColRange, cfg: GridConfig): TimeRange => ({
  startMs: colToMs(cr.startCol, cfg),
  endMs: colToMs(cr.endCol, cfg),
});

// ====== 構成ショートカット ======
export interface MakeGridConfigInput {
  gridStartMs: Ms;
  gridEndMs: Ms;
  colMinutes?: number;
  colWidthPx?: number;
  minDurationMin?: number;
  maxDurationMin?: number;
  edgePaddingMin?: number;
}

/**
 * よく使うデフォルトを含めた設定生成（必要に応じて上書き）
 */
export function makeGridConfig(input: MakeGridConfigInput): GridConfig {
  return {
    gridStartMs: input.gridStartMs,
    gridEndMs: input.gridEndMs,
    colMinutes: input.colMinutes ?? 5,
    colWidthPx: input.colWidthPx ?? 16,
    minDurationMin: input.minDurationMin ?? 15,
    maxDurationMin: input.maxDurationMin,
    edgePaddingMin: input.edgePaddingMin ?? 0,
  };
}

// ====== 使用例（参考） ======
/**
 *
 * // 移動
 * const next = moveByPx({ range: { startMs, endMs }, deltaPx: e.delta.x, cfg });
 *
 * // リサイズ（左／右）
 * const nextL = resizeStartByPx({ range, deltaPx: e.delta.x, cfg });
 * const nextR = resizeEndByPx({ range, deltaPx: e.delta.x, cfg });
 *
 * // 変換
 * const col = msToCol(Date.now(), cfg);
 * const ms  = colToMs(12, cfg);
 */
