// src/lib/firebase.ts
// ──────────────────────────────────────────────────────────────
// Firestore 初期化 + ローカルキャッシュ (localStorage) ヘルパー
// ──────────────────────────────────────────────────────────────

import { initializeApp } from 'firebase/app';
import { getFirestore }   from 'firebase/firestore';
import {
  doc,
  getDoc,
  runTransaction,
  setDoc,
  waitForPendingWrites,
} from 'firebase/firestore';
import { enqueueOp } from './opsQueue';
import { dequeueAll } from './opsQueue';
import { QUEUE_KEY } from './opsQueue';
import {
  addReservationFS,
  updateReservationFS,
  deleteAllReservationsFS,
} from './reservations';

// ── storeId取得ヘルパー ─────────────────
export function getStoreId(): string {
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_STORE_ID || 'default';
  }
  const parts = window.location.pathname.split('/');
  return parts[1] || (process.env.NEXT_PUBLIC_STORE_ID || 'default');
}

// ── localStorage 名前空間設定 ─────────────────

const ns = `front-kun-${getStoreId()}`;
const RES_KEY   = `${ns}-reservations`;
const STORE_KEY = `${ns}-storeSettings`;

// ── joinedToday flag for offline queue control ──
const JOINED_KEY = `${ns}-joinedToday`;

/** 本日の営業に参加状態を取得 */
export function getJoinedToday(): boolean {
  return localStorage.getItem(JOINED_KEY) === 'true';
}

/** 本日の営業に参加状態を設定 (参加ボタン押下時に呼び出し) */
export function setJoinedToday(flag: boolean): void {
  localStorage.setItem(JOINED_KEY, flag ? 'true' : 'false');
}

// Firebase config は .env.local (NEXT_PUBLIC_*) から取得
const firebaseConfig = {
  apiKey:      process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:   process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

// アプリ／DB を初期化＆エクスポート
export const app = initializeApp(firebaseConfig);
export const db  = getFirestore(app);

// ─────────────────────────────────────────────
// 既存ローカルストレージ版 API も引き継ぎ
// 予約リスト・店舗設定は offline でも動かすためキャッシュとして利用
// ─────────────────────────────────────────────

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

/** 店舗設定（eatOptions / drinkOptions / courses / tables）を取得 */
export function getStoreSettings(): {
  eatOptions: string[];
  drinkOptions: string[];
  courses: any[];
  tables: any[];
} {
  try {
    return JSON.parse(
      localStorage.getItem(STORE_KEY) ??
        '{"eatOptions":["⭐︎","⭐︎⭐︎"],"drinkOptions":["スタ","プレ"],"courses":[],"tables":[]}'
    );
  } catch {
    return {
      eatOptions: ['⭐︎', '⭐︎⭐︎'],
      drinkOptions: ['スタ', 'プレ'],
      courses: [],
      tables: [],
    };
  }
}

/** 店舗設定（eatOptions / drinkOptions / courses / tables）を保存 */
export function saveStoreSettings(obj: {
  eatOptions: string[];
  drinkOptions: string[];
  courses: any[];
  tables: any[];
}): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(obj));
}


/* ────────────────────────────────
   Firestore 版 店舗設定 CRUD
   ────────────────────────────────*/

/**
 * Firestore から店舗設定 (eatOptions / drinkOptions / courses / tables) を取得。
 * ドキュメントが無い場合は空の設定を返す。
 */
export async function loadStoreSettings(): Promise<{
  eatOptions: string[];
  drinkOptions: string[];
  courses: any[];
  tables: any[];
}> {
  try {
    const ref = doc(db, 'stores', getStoreId(), 'settings', 'config');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as any;
      return {
        eatOptions: data.eatOptions ?? ['⭐︎', '⭐︎⭐︎'],
        drinkOptions: data.drinkOptions ?? ['スタ', 'プレ'],
        courses: data.courses ?? [],
        tables: data.tables ?? [],
      };
    }
  } catch (err) {
    console.error('loadStoreSettings failed', err);
  }
  // フォールバック: localStorage
  return getStoreSettings();
}

/**
 * 店舗設定をトランザクションで保存。
 * 同時編集を防ぐため、既存ドキュメントを読んで merge 更新。
 */
export async function saveStoreSettingsTx(settings: {
  eatOptions: string[];
  drinkOptions: string[];
  courses: any[];
  tables: any[];
}) {
  // オフライン時はキューに積んで終了
  if (!getJoinedToday()) {
    enqueueOp({ type: 'storeSettings', payload: settings });
    return;
  }
  const ref = doc(db, 'stores', getStoreId(), 'settings', 'config');
  await runTransaction(db, async (trx) => {
    const snap = await trx.get(ref);
    const prev = snap.exists() ? snap.data() : {};
    trx.set(
      ref,
      { ...prev, ...settings },
      { merge: true }
    );
  });
  await waitForPendingWrites(db);
  // ローカルキャッシュも更新
  saveStoreSettings(settings);
}

// ─────────────────────────────────────────────
// オンライン復帰時に溜めた操作を一括処理
// ─────────────────────────────────────────────
if (typeof window !== 'undefined') {
  console.log('[online event] navigator.onLine=', navigator.onLine, 'queued ops=', localStorage.getItem(QUEUE_KEY));
  window.addEventListener('online', async () => {
    const ops = dequeueAll();
    for (const op of ops) {
      switch (op.type) {
        case 'storeSettings':
          await saveStoreSettingsTx(op.payload);
          break;
        case 'add':
          await addReservationFS(op.payload);
          break;
            case 'update':
      // Op の型が { type: 'update'; id; field; value; } なので
      await updateReservationFS(op.id, { [op.field]: op.value });
      break;
        case 'delete':
          await deleteAllReservationsFS();
          break;
      }
    }
  });
}