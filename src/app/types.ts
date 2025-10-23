// src/app/types.ts

import type { EatDrinkOption } from '@/types/settings';

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
  /** 来店から何分後までか（未設定時は timeOffset と同じ） */
  timeOffsetEnd?: number;
  /** タスク名 */
  label: string;
  /** テーブル管理画面での背景色 Tailwind クラス */
  bgColor: string;
}

/** コース定義の型 */
import type { CourseColorKey } from '@/lib/courseColors';

export interface CourseDef {
  /** コース名 */
  name: string;
  /** そのコースで行うタスク一覧 */
  tasks: TaskDef[];
  /** コースの表示色 */
  color?: CourseColorKey;
}

/** エリア定義 */
export type AreaDef = {
  id: string;        // 例: 'area_1f'
  name: string;      // 例: '1F'
  tables: string[];  // 重複所属OK方針
  color?: string;
  icon?: string;
};

/** 店舗設定の保存フォーマット（アプリ側） */
export type StoreSettingsValue = {
  courses?: CourseDef[];                    // コース定義
  positions?: string[];                     // ポジション名一覧
  tables?: string[];                        // 卓番号（文字列）
  tasksByPosition?: Record<string, string[]>; // ポジション→表示タスク
  eatOptions?: EatDrinkOption[];            // 食べ放題など
  drinkOptions?: EatDrinkOption[];          // 飲み放題など
  plans?: string[];                         // 任意のプラン名
  updatedAt?: unknown;                      // サーバ側で付与されることがある
  areas?: AreaDef[];                        // ★ 追加: エリア設定
};

// ------------ 数値パッドで編集するフィールド種別 -----------------
export type NumPadField =
  | 'table'
  | 'guests'
  | 'presetTable'
  | 'targetTable'
  | 'pendingTable';
