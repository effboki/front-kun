// src/types/reservation.ts

/** 予約 1 件の型定義 */
export interface Reservation {
  /** Firestore ドキュメント ID（数値文字列でも OK） */
  id: string;

  /** 卓番号 */
  table_no: string;

  /** コース名 */
  course: string;

  /** 人数 */
  guests: number;

  /** 予約時刻（例: "18:30"） */
  time: string;

  /** タスク (= key) ごとの完了フラグ */
  completed?: Record<string, boolean>;

  /** 顧客名（任意） */
  name?: string | null;

  /** メモ（任意） */
  notes?: string | null;

  /** 最終更新時刻（サーバ側で自動付与） */
  updatedAt?: any;  // Firebase Timestamp

  /** ドキュメントの世代番号（1,2,3…） */
  version?: number;
}