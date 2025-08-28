// src/app/types.ts

// 並び順
export type ResOrder = 'time' | 'table' | 'created';

// 予約(来店)情報
export interface Reservation {
  /** 予約レコードの一意 ID */
  id: string; // 文字列に統一
  /** 卓番号（文字列）例："21" */
  table: string;
  /** 来店時刻 "HH:MM" 形式 */
  time: string;
  /** コース名（courses 配列のいずれかの name） */
  course: string;
  /** 人数 */
  guests: number;
  /** 予約者氏名 */
  name: string;
  /** 備考 */
  notes: string;
  /** タスク完了フラグ (キー: `${timeKey}_${taskLabel}_${course}`, 値: boolean) */
  completed: Record<string, boolean>;
  /** 卓変更プレビュー用 */
  pendingTable?: string;
  /** 来店/会計/退店フラグ */
  arrived?: boolean;
  paid?: boolean;
  departed?: boolean;
  /** 個別タスクの時間シフト (label → ±分) */
  timeShift?: { [label: string]: number };
}

// 卓番変更プレビュー用マップ
export type PendingTables = Record<string, { old: string; next: string }>;

/** １コースあたりのタスク定義 */
export interface TaskDef {
  /** 来店から何分後か */
  timeOffset: number;
  /** タスク名 */
  label: string;
  /** テーブル管理画面での背景色 Tailwind クラス */
  bgColor: string;
}

/** コース定義の型 */
export interface CourseDef {
  /** コース名 */
  name: string;
  /** そのコースで行うタスク一覧 */
  tasks: TaskDef[];
}

// ------------ 数値パッドで編集するフィールド種別 -----------------
export type NumPadField =
  | 'table'
  | 'guests'
  | 'presetTable'
  | 'targetTable'
  | 'pendingTable';