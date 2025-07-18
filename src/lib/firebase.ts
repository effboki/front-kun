// src/lib/firebase.ts
// ──────────────────────────────────────────────────────────────
// Firestore 初期化 + ローカルキャッシュ (localStorage) ヘルパー
// ──────────────────────────────────────────────────────────────

import { initializeApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';
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

/* ────────────────────────────────
   stores/{storeId} ドキュメントが
   無ければ空で自動生成するユーティリティ
────────────────────────────────*/
async function ensureStoreDoc(storeId: string) {
  try {
    const ref = doc(db, 'stores', storeId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {}); // フィールド空でOK
    }
  } catch (err) {
    console.warn('[ensureStoreDoc] failed:', err);
  }
}

/**
 * 確実に stores/{storeId} および stores/{storeId}/settings/config
 * を生成してから解決するユーティリティ。
 * どちらも空オブジェクト `{}` で OK。
 */
export async function ensureStoreStructure(storeId: string): Promise<void> {
  // ① ルートの店舗ドキュメント
  await ensureStoreDoc(storeId);

  // ② 設定ドキュメント (settings/config)
  try {
    const configRef = doc(db, 'stores', storeId, 'settings', 'config');
    const configSnap = await getDoc(configRef);
    if (!configSnap.exists()) {
      await setDoc(configRef, {}); // 空オブジェクトで作成
    }
  } catch (err) {
    console.warn('[ensureStoreStructure] failed:', err);
  }
}

// ── storeId取得ヘルパー ─────────────────
export function getStoreId(): string {
  /**
   * 店舗 ID 解決ルール
   *  1) URL 先頭セグメント（ /{storeId}/... ）
   *  2) NEXT_PUBLIC_STORE_ID（Vercel / .env.local）
   *  3) "default"
   *
   * ①が空文字やスラッシュのみだった場合は②へフォールバック。
   * 戻り値は両端のスラッシュを取り除き、必ず非空文字列になる。
   */
  const fallback =
    (process.env.NEXT_PUBLIC_STORE_ID || 'default').replace(/^\/+|\/+$/g, '');

  // SSR / ビルド時は window が無い
  if (typeof window === 'undefined') {
    return fallback;
  }

  // 例: "/", "//", "/demo/", "//demo//foo" なども安全に分解
  const rawSeg = window.location.pathname.split('/').filter(Boolean)[0] ?? '';
  const cleaned = rawSeg.replace(/^\/+|\/+$/g, '');

  return cleaned || fallback;
}

// ── localStorage 名前空間設定 ─────────────────

const ns = `front-kun-${getStoreId()}`;
const RES_KEY = `${ns}-reservations`;
const STORE_KEY = `${ns}-storeSettings`;

// Firebase config は .env.local (NEXT_PUBLIC_*) から取得
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

// アプリ／DB を初期化＆エクスポート
export const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
});

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
    // ドキュメントツリー自動生成
    await ensureStoreDoc(getStoreId());
    const ref = doc(db, 'stores', getStoreId(), 'settings', 'config');
    const snap = await getDoc(ref);

    // ── ドキュメントが存在しなければデフォルトを生成 ──
    if (!snap.exists()) {
      const defaults = {
        eatOptions: ['⭐︎', '⭐︎⭐︎'],
        drinkOptions: ['スタ', 'プレ'],
        courses: [],
        tables: [],
      };
      try {
        await setDoc(ref, defaults, { merge: true }); // 初回のみ作成
      } catch (e) {
        console.warn('[loadStoreSettings] setDoc failed (likely offline):', e);
      }
      return defaults;
    }

    const data = snap.data() as any;
    return {
      eatOptions: data.eatOptions ?? ['⭐︎', '⭐︎⭐︎'],
      drinkOptions: data.drinkOptions ?? ['スタ', 'プレ'],
      courses: data.courses ?? [],
      tables: data.tables ?? [],
    };
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
  if (!navigator.onLine) {
    enqueueOp({ type: 'storeSettings', payload: settings });
    return;
  }
  const ref = doc(db, 'stores', getStoreId(), 'settings', 'config');
  await runTransaction(db, async (trx) => {
    const snap = await trx.get(ref);
    const prev = snap.exists() ? snap.data() : {};
    trx.set(ref, { ...prev, ...settings }, { merge: true });
  });
  await waitForPendingWrites(db);
  // ローカルキャッシュも更新
  saveStoreSettings(settings);
}

// ── 溜め込んだ opsQueue を Firestore へ一括反映 ──────────────
async function _flushQueuedOps() {
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
        await updateReservationFS(op.id, { [op.field]: op.value });
        break;
      case 'delete':
        await deleteAllReservationsFS();
        break;
    }
  }
}

/** 手動 “予約確定” ボタン用：溜まったキューを送信 */
export async function flushQueuedOps(): Promise<void> {
  await _flushQueuedOps();
}

// ─────────────────────────────────────────────
// オンライン復帰時に溜めた操作を一括処理
// ─────────────────────────────────────────────
// if (typeof window !== 'undefined') {
//   console.log(
//     '[online event] navigator.onLine=',
//     navigator.onLine,
//     'queued ops=',
//     localStorage.getItem(QUEUE_KEY)
//   );

//   // ページ読み込み時点でオンラインなら即座にキューを反映
//   if (navigator.onLine) {
//     _flushQueuedOps();
//   }

//   // オンライン復帰時のみ再送
//   window.addEventListener('online', async () => {
//     await _flushQueuedOps();
//   });
// }