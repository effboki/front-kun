// src/lib/firebase.ts
// ─────────────────────────────────────────────
// Firestore を一切使わず、LocalStorage だけでデータを保持するヘルパー
// ─────────────────────────────────────────────

const RES_KEY   = 'front-kun-res';
const STORE_KEY = 'front-kun-store';

/** 予約一覧を取得 */
export function getReservations(): any[] {
  try {
    return JSON.parse(localStorage.getItem(RES_KEY) || '[]');
  } catch {
    return [];
  }
}

/** 予約一覧を保存 */
export function saveReservations(arr: any[]): void {
  localStorage.setItem(RES_KEY, JSON.stringify(arr));
}

/** 店舗設定（courses/tables）を取得 */
export function getStoreSettings(): { courses: any[]; tables: any[] } {
  try {
    return JSON.parse(
      localStorage.getItem(STORE_KEY) || '{"courses":[],"tables":[]}'
    );
  } catch {
    return { courses: [], tables: [] };
  }
}

/** 店舗設定（courses/tables）を保存 */
export function saveStoreSettings(obj: { courses: any[]; tables: any[] }): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(obj));
}