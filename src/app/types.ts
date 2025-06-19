// src/app/types.ts

/** 予約情報の型 */
export interface Reservation {
  /** 予約レコードの一意 ID */
  id: number;
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
}

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