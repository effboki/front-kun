import type { FormEvent } from 'react';
// Shared types used across the app

// 並び順
export type ResOrder = 'time' | 'table' | 'created';

export type TaskSort = 'table' | 'guests';

// 予約(来店)情報
export interface Reservation {
  /** 予約レコードの一意 ID */
  id: string;
  /** 卓番号 */
  table: string;
  /** 複数卓（先頭に主卓 table を含める） */
  tables?: string[];
  /** 来店時刻 "HH:MM" 形式 */
  time: string;
  /** コース名 */
  course: string;
  /** 人数 */
  guests: number;
  /** 予約者氏名 */
  name: string;
  /** 備考 */
  notes: string;
  /** memo フィールド（既存データ互換用） */
  memo?: string;
  /** タスク完了フラグ (キー: `${timeKey}_${taskLabel}_${course}`) */
  completed: Record<string, boolean>;
  /** 卓変更プレビュー用 */
  pendingTable?: string;
  /** 来店/会計/退店フラグ */
  arrived?: boolean;
  paid?: boolean;
  departed?: boolean;
  /** 個別タスクの時間シフト (label → ±分) */
  timeShift?: { [label: string]: number };
  /** 食べ放題・飲み放題・日付等（任意） */
  date?: string;
  eat?: string;
  drink?: string;
  eatLabel?: string;
  drinkLabel?: string;
  foodAllYouCan?: boolean;
  drinkAllYouCan?: boolean;
  /** 当日の絶対開始時刻(ms) */
  startMs?: number;
  /** 終了時刻(ms) */
  endMs?: number;
  /** 手動指定の滞在分 */
  durationMin?: number;
  /** 表示・計算に使う実効滞在分 */
  effectiveDurationMin?: number;
  /** 'HH:mm' フォーマット済みの時間（startMs由来） */
  timeHHmm?: string;
  /** 新規作成後のハイライト終了時刻(ms) */
  freshUntilMs?: number;
  /** 編集後のハイライト終了時刻(ms) */
  editedUntilMs?: number;
}

// 卓番変更プレビュー用マップ
export type PendingTables = Record<string, { old: string; nextList: string[] }>;

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
export interface CourseDef {
  /** コース名 */
  name: string;
  /** 滞在時間（分） */
  stayMinutes?: number;
  /** そのコースで行うタスク一覧 */
  tasks: TaskDef[];
}

// 数値パッドで編集するフィールド種別

export type NumPadField =
  | 'table'
  | 'guests'
  | 'presetTable'
  | 'targetTable'
  | 'pendingTable';

/** エリア/フロア定義 */
export type AreaDef = {
  id: string;        // 例: 'area_1f'
  name: string;      // 例: '1F'
  tables: string[];  // 重複所属OK
  color?: string;
  icon?: string;
};

/** 店舗設定（最小定義：後方互換のため動的キーも許可） */
export type StoreSettingsValue = {
  tables?: string[];
  areas?: AreaDef[];
} & Record<string, unknown>;

// ======== Shared ViewModel types for cross-file reuse ========

/** タスク表：時刻キー -> タスクグループ配列 */
export type TaskCourseGroup = {
  courseName: string;
  reservations: Reservation[];
};

export type TaskGroup = {
  /** タスク名（例：提供・案内など） */
  label: string;
  /** 見出し背景の Tailwind クラス（例：bg-blue-50） */
  bgColor: string;
  /** 同じ開始時刻のタスクに対する終了時刻（任意） */
  endMinutes?: number;
  endTimeKey?: string;
  /** コースごとの予約配列 */
  courseGroups: TaskCourseGroup[];
};

/** 例: { "18:00": [ {label, bgColor, courseGroups}, ... ], "18:30": [...] } */
export type GroupedTasks = Record<string, TaskGroup[]>;

/** ページ側のデータVM（TasksSection 等が Pick で再利用） */
export type ViewData = {
  groupedTasks: GroupedTasks;
  /** 並び順キー（省略時は子で自動計算） */
  sortedTimeKeys?: string[];
  courses: CourseDef[];
  /** フィルタ後の予約一覧（完了登録などで参照） */
  filteredReservations: Reservation[];
  /** 卓番号 -> その卓の先頭予約ID */
  firstRotatingId: Record<string, string>;
};

/** ページ側のUI状態VM（TasksSection 等が Pick で再利用） */
export type UiState = {
  /** コース絞り込み（例：'全体' | '未選択' | 'コース名'） */
  filterCourse: string;
  /** コース名の表示ON/OFF */
  showCourseAll: boolean;
  /** 人数の表示ON/OFF */
  showGuestsAll: boolean;
  /** 同一タスクのまとめ表示ON/OFF */
  mergeSameTasks: boolean;
  /** タスクの並び順 */
  taskSort: TaskSort;
  /** 卓番号の表示ON/OFF（タスク表・開始時間表共通で利用可） */
  showTableStart: boolean;

  /** 完了一括の選択モード: `${timeKey}_${taskLabel}` or null */
  selectionModeTask: string | null;
  /** 時間シフトの対象モード: `${timeKey}_${taskLabel}` or null */
  shiftModeKey: string | null;

  /** 選択中の予約ID（完了一括用） */
  selectedForComplete: string[];
  /** 時間シフト対象の予約ID */
  shiftTargets: string[];
};

export type ReservationFieldKey =
  | 'time'
  | 'course'
  | 'eat'
  | 'drink'
  | 'eatLabel'
  | 'drinkLabel'
  | 'foodAllYouCan'
  | 'drinkAllYouCan'
  | 'guests'
  | 'name'
  | 'notes'
  | 'date'
  | 'table'
  | 'tables'
  | 'completed'
  | 'arrived'
  | 'paid'
  | 'departed';

export type ReservationFieldValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | Record<string, boolean>;

export type TasksActions = {
  addReservation: (e: FormEvent) => Promise<void>;
  deleteReservation: (id: string) => void;
  updateReservationField: (
    id: string,
    field: ReservationFieldKey,
    value: ReservationFieldValue
  ) => void;
  toggleArrivalChecked: (id: string) => void;
  togglePaymentChecked: (id: string) => void;
  toggleDepartureChecked: (id: string) => void;
  onToggleEditTableMode: () => void;
  resetAllReservations: () => void;
};

/** TasksSection に渡す props の型（親の型から Pick 再利用） */
export type TasksSectionProps = {
  data: Pick<ViewData, 'groupedTasks' | 'sortedTimeKeys' | 'courses' | 'firstRotatingId'>;
  ui: Pick<
    UiState,
    | 'filterCourse'
    | 'showCourseAll'
    | 'showGuestsAll'
    | 'mergeSameTasks'
    | 'taskSort'
    | 'showTableStart'
  >;
  actions: TasksActions;
};  
