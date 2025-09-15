export type SlotMs = number; // バケットの先頭時刻(ms)

export type WaveInputTask = {
  /** そのタスクが発生する確定時刻(ms) — タスク表の「変更後時刻」を渡す */
  timeMs: number;
  /** その時刻に対応する人数(合計) */
  guests: number;
  /** タスク担当のポジションID */
  positionId: string;
  /** 卓番号（フィルタに使う。未指定なら全体扱い） */
  table?: string;
};

export type WaveParams = {
  /** 忙しさの閾値（これ未満が“ヒマ寄り”） */
  threshold: number;
  /** バケット幅（分） */
  bucketMinutes: number; // 例: 5
  /** Calm と見なす最小連続分数 */
  minCalmMinutes: number; // 例: 15
};

export type WaveFilter = {
  /** 集計対象のポジションID（自分の担当） */
  positionId: string;
  /** 表示対象の卓番号（空なら全卓） */
  visibleTables: string[];
};

export type CalmWindow = { start: SlotMs; end: SlotMs };

/** 指定ミリ秒を含むバケット先頭時刻を返す（floor） */
export const bucketOf = (ms: number, bucketMin: number): SlotMs =>
  Math.floor(ms / (bucketMin * 60_000)) * (bucketMin * 60_000);

/** start〜end を bucketMinutes 刻みで離散スロットにする */
export function buildSlots(startMs: number, endMs: number, bucketMinutes: number): SlotMs[] {
  const slots: SlotMs[] = [];
  if (endMs < startMs) return slots;
  for (let t = bucketOf(startMs, bucketMinutes); t <= endMs; t += bucketMinutes * 60_000) {
    slots.push(t);
  }
  return slots;
}

/** 各スロットの “タスク件数 × 人数合計” を作る */
export function buildSeries(
  tasks: WaveInputTask[],
  range: { startMs: number; endMs: number },
  params: WaveParams,
  filter: WaveFilter
): { slots: SlotMs[]; score: number[] } {
  const { bucketMinutes } = params;
  const slots = buildSlots(range.startMs, range.endMs, bucketMinutes);

  const score = slots.map((slot) => {
    // フィルタ後に該当バケットへ入るタスクだけを数える
    const inSlot = tasks.filter((tk) => {
      if (tk.positionId !== filter.positionId) return false;
      if (filter.visibleTables.length > 0) {
        if (!tk.table || !filter.visibleTables.includes(String(tk.table))) return false;
      }
      return bucketOf(tk.timeMs, bucketMinutes) === slot;
    });
    const count = inSlot.length;
    const guests = inSlot.reduce((s, x) => s + (x.guests || 0), 0);
    return count * guests;
  });

  return { slots, score };
}

/** 前後1本を使った簡易スムージング（ガタつき抑制） */
export const smooth = (arr: number[]): number[] =>
  arr.map((_, i) => {
    const a = arr[i - 1] ?? arr[i];
    const b = arr[i];
    const c = arr[i + 1] ?? arr[i];
    return Math.round((a + b + c) / 3);
  });

/** 閾値未満が minCalmMinutes 以上連続する区間を Calm として抽出 */
export function extractCalmWindows(
  slots: SlotMs[],
  series: number[],
  params: WaveParams
): CalmWindow[] {
  const { threshold, minCalmMinutes, bucketMinutes } = params;
  const need = Math.ceil(minCalmMinutes / bucketMinutes);
  const out: CalmWindow[] = [];
  let i = 0;
  while (i < series.length) {
    if (series[i] < threshold) {
      const startIdx = i;
      while (i < series.length && series[i] < threshold) i++;
      const len = i - startIdx;
      if (len >= need) {
        // end はスロット末尾（次スロット先頭の直前）＝ 視覚的に end まで落ち着く想定
        out.push({ start: slots[startIdx], end: slots[i - 1] + bucketMinutes * 60_000 });
      }
    } else {
      i++;
    }
  }
  return out;
}

/**
 * 上記をまとめて実行し、Calmウィンドウ・スコア列・スムージング列を返すヘルパ
 */
export function computeCalm(
  tasks: WaveInputTask[],
  range: { startMs: number; endMs: number },
  params: WaveParams,
  filter: WaveFilter
): { slots: SlotMs[]; score: number[]; smoothed: number[]; windows: CalmWindow[] } {
  const { slots, score } = buildSeries(tasks, range, params, filter);
  const smoothed = smooth(score);
  const windows = extractCalmWindows(slots, smoothed, params);
  return { slots, score, smoothed, windows };
}

/**
 * 通知予定時刻を計算（Calm開始 + notifyDelay）
 * - 現在時刻 nowMs を受け取り、now 以降で発火すべき最初の通知時刻を返す
 * - なければ null
 */
export function computeNextNotifyAt(
  windows: CalmWindow[],
  notifyDelayMinutes: number,
  nowMs: number
): number | null {
  const delayMs = notifyDelayMinutes * 60_000;
  for (const w of windows) {
    const t = w.start + delayMs;
    if (t >= nowMs) return t;
  }
  return null;
}

/** 表示用の HH:mm */
export function hhmm(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ================================
// 相対しきい値 / ヒステリシス 拡張
// ================================

export type AdaptiveMode = 'fixed' | 'maxRatio' | 'percentile' | 'hybrid';

/** 単純なclamp */
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** p(%) パーセンタイル（0〜100, 最近傍丸め） */
export function percentile(arr: number[], p: number): number {
  if (!arr || arr.length === 0) return 0;
  const pp = clamp(p, 0, 100);
  const a = [...arr].sort((x, y) => x - y);
  const idx = Math.round((pp / 100) * (a.length - 1));
  return a[idx] ?? 0;
}

/**
 * 自動しきい値の解決
 * - maxRatio: ピーク × ratio
 * - percentile: 下位p%の値
 * - hybrid: パーセンタイル値を [ピーク×lo, ピーク×hi] にクランプ
 *   lo/hi は maxRatio を中心に ±20% のレンジを既定にする
 */
export function resolveAdaptiveThreshold(
  smoothed: number[],
  mode: AdaptiveMode,
  opt?: { percentile?: number; maxRatio?: number }
): number {
  const peak = smoothed.length ? Math.max(...smoothed) : 0;
  const p = opt?.percentile ?? 30;
  const ratio = opt?.maxRatio ?? 0.3;

  if (mode === 'maxRatio') {
    return Math.round(peak * ratio);
  }
  if (mode === 'percentile') {
    return Math.round(percentile(smoothed, p));
  }
  if (mode === 'hybrid') {
    const base = percentile(smoothed, p);
    const lo = peak * clamp(ratio * 0.8, 0, 1);  // 例: ratio=0.3 → lo=0.24×peak
    const hi = peak * clamp(ratio * 1.2, 0, 1);  // 例: ratio=0.3 → hi=0.36×peak
    return Math.round(clamp(base, lo, hi));
  }
  // fixed はここでは扱わない（呼び出し側で params.threshold を使う）
  return NaN;
}

/**
 * ヒステリシス付き Calm 抽出
 * - 入り条件: series[i] < thrLow
 * - 維持条件: series[i] <= thrHigh
 * - 抜け条件: series[i] >  thrHigh
 */
export function extractCalmWindowsHysteresis(
  slots: SlotMs[],
  series: number[],
  opt: { thrLow: number; thrHigh: number; minCalmMinutes: number; bucketMinutes: number }
): CalmWindow[] {
  const { thrLow, thrHigh, minCalmMinutes, bucketMinutes } = opt;
  const need = Math.ceil(minCalmMinutes / bucketMinutes);
  const out: CalmWindow[] = [];
  let i = 0;
  while (i < series.length) {
    if (series[i] < thrLow) {
      const startIdx = i;
      i++;
      while (i < series.length && series[i] <= thrHigh) i++;
      const len = i - startIdx;
      if (len >= need) {
        out.push({ start: slots[startIdx], end: slots[i - 1] + bucketMinutes * 60_000 });
      }
    } else {
      i++;
    }
  }
  return out;
}

/**
 * 相対しきい値対応の Calm 計算（既存 computeCalm の拡張）
 * - スロット／スコア／スムージングは既存ロジックを流用
 * - mode に応じてしきい値を解決し、ヒステリシスが指定されていれば適用
 */
export function computeCalmAdaptive(
  tasks: WaveInputTask[],
  range: { startMs: number; endMs: number },
  params: WaveParams,
  filter: WaveFilter,
  opt?: {
    mode?: AdaptiveMode;
    percentile?: number;
    maxRatio?: number;
    hysteresisPct?: number; // thrHigh = thrLow * (1 + hysteresisPct/100)
  }
): {
  slots: SlotMs[];
  score: number[];
  smoothed: number[];
  windows: CalmWindow[];
  resolvedThreshold: number;
  resolvedThresholdHigh?: number;
  resolvedThresholdRelative?: number;
} {
  const { slots, score } = buildSeries(tasks, range, params, filter);
  const smoothed = smooth(score);

  const mode = opt?.mode ?? 'fixed';
  let thrLow: number;
  let thrHigh: number | undefined;
  let thrRel: number | undefined;

  if (mode === 'fixed') {
    thrLow = params.threshold;
    thrRel = undefined;
  } else {
    thrRel = resolveAdaptiveThreshold(smoothed, mode, {
      percentile: opt?.percentile,
      maxRatio: opt?.maxRatio,
    });
    if (!Number.isFinite(thrRel)) thrRel = params.threshold;
    thrLow = Math.max(thrRel, params.threshold);
  }

  const hysteresisPct = opt?.hysteresisPct;
  const useHyst = Number.isFinite(hysteresisPct as number) && (hysteresisPct as number) > 0;
  let windows: CalmWindow[] = [];

  if (useHyst) {
    thrHigh = Math.round(thrLow * (1 + (hysteresisPct as number) / 100));
    windows = extractCalmWindowsHysteresis(slots, smoothed, {
      thrLow,
      thrHigh,
      minCalmMinutes: params.minCalmMinutes,
      bucketMinutes: params.bucketMinutes,
    });
  } else {
    windows = extractCalmWindows(slots, smoothed, {
      threshold: thrLow,
      minCalmMinutes: params.minCalmMinutes,
      bucketMinutes: params.bucketMinutes,
    } as WaveParams);
  }

  return { slots, score, smoothed, windows, resolvedThreshold: thrLow, resolvedThresholdHigh: thrHigh, resolvedThresholdRelative: thrRel };
}