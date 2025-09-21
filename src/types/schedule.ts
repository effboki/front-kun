

/**
 * スケジュール表示用の最小単位（1つの予約を画面に描画するための型）
 * 予約リストと同一ソースを前提に、描画に必要な情報だけを正規化します。
 */
export type ScheduleItem = {
  /** 予約ID（FirestoreのドキュメントIDなど） */
  id: string;
  /** お名前（代表者） */
  name: string;
  /** 人数 */
  people: number;
  /** コース名（未設定可） */
  course?: string;
  /** 飲み放題フラグ */
  drink?: boolean;
  /** 食べ放題フラグ */
  eat?: boolean;
  /** 飲み放題のプラン名など（任意） */
  drinkLabel?: string;
  /** 食べ放題のプラン名など（任意） */
  eatLabel?: string;
  /**
   * 予約の卓（複数卓連結に対応）
   * スケジュール描画では行スパン／複数行にまたがる表示を想定
   */
  tables: string[];
  /** 開始時刻（ms, 5分スナップ済み） */
  startMs: number;
  /** 終了時刻（ms, コース滞在時間などを反映済み） */
  endMs: number;
  /** 見た目の色（任意） */
  color?: string;
  /** 警告などの状態（同卓・同時刻の重なりなど） */
  status?: 'normal' | 'warn';
};

/** スケジュールの時間範囲（その日の表示ウィンドウ） */
export type ScheduleRange = {
  startMs: number;
  endMs: number;
};

/** 卓のメタ情報（表示順やラベルに利用） */
export type TableInfo = {
  id: string;
  label: string;
  order?: number;
};
