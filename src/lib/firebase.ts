// src/lib/firebase.ts
// ──────────────────────────────────────────────────────────────
// Firestore 初期化 + ローカルキャッシュ (localStorage) ヘルパー
// ──────────────────────────────────────────────────────────────

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { doc, getDoc, setDoc, waitForPendingWrites } from 'firebase/firestore';
import { enqueueOp } from './opsQueue';
import type { StoreSettings } from '@/types/settings';

// ── StoreSettings のデフォルト（Firestore / localStorage 双方で使い回す）──
export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  eatOptions: ['⭐︎', '⭐︎⭐︎'],
  drinkOptions: ['スタ', 'プレ'],
  courses: [],
  tables: [],
  positions: [],
  tasksByPosition: {},
};

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
    const snap = await getDoc(configRef);

    if (!snap.exists()) {
      // ドキュメントが無い場合のみデフォルト設定で初期化
      await setDoc(configRef, DEFAULT_STORE_SETTINGS);
      console.info('[ensureStoreStructure] config created with DEFAULT');
    } else {
      console.info('[ensureStoreStructure] config exists → no overwrite');
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
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID, // optional
};

// アプリ／DB を初期化＆エクスポート
export const app = initializeApp(firebaseConfig);
// NOTE: デバッグ（保留書き込みや複数タブ競合の切り分け）のため、まずは無印の getFirestore を使用
//       必要であれば下の initializeFirestore（persistentLocalCache 有効）のブロックに戻せます。
export const db = getFirestore(app);
// --- 以前の永続キャッシュ有効パターン（必要になったら復帰） ---
// export const db = initializeFirestore(app, {
//   localCache: persistentLocalCache(),
//   // 接続安定化オプション（ローカルや一部ネットワークでの backend 到達不可対策）
//   experimentalForceLongPolling: true,
// });

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

/** 店舗設定（eatOptions / drinkOptions / courses / tables / positions / tasksByPosition）を取得 */
export function getStoreSettings(): {
  eatOptions: string[];
  drinkOptions: string[];
  courses: any[];
  tables: any[];
  positions: string[];
  tasksByPosition: Record<string, Record<string, string[]>>;
} {
  try {
    return JSON.parse(
      localStorage.getItem(STORE_KEY) ??
        '{"eatOptions":["⭐︎","⭐︎⭐︎"],"drinkOptions":["スタ","プレ"],"courses":[],"tables":[],"positions":[],"tasksByPosition":{}}'
    );
  } catch {
    return {
      eatOptions: ['⭐︎', '⭐︎⭐︎'],
      drinkOptions: ['スタ', 'プレ'],
      courses: [],
      tables: [],
      positions: [],
      tasksByPosition: {},
    };
  }
}

/** 店舗設定（eatOptions / drinkOptions / courses / tables / positions / tasksByPosition）を保存 */
export function saveStoreSettings(obj: StoreSettings): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(obj));
}

/* ────────────────────────────────
   Firestore 版 店舗設定 CRUD
   ────────────────────────────────*/

/**
 * Firestore から店舗設定 (eatOptions / drinkOptions / courses / tables / positions / tasksByPosition) を取得。
 * ドキュメントが無い場合は空の設定を返す。
 */
export async function loadStoreSettings(): Promise<Partial<StoreSettings>> {
  try {
    // ルート店舗ドキュメントだけ最低限保証
    await ensureStoreDoc(getStoreId());
    const ref = doc(db, 'stores', getStoreId(), 'settings', 'config');
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      // 空ドキュメントを用意（デフォルトは注入しない）
      try {
        await setDoc(ref, {}, { merge: true });
      } catch (e) {
        console.warn('[loadStoreSettings] setDoc(empty) failed (offline?):', e);
      }
      return {};
    }

    // 変換・デフォルト注入は呼び出し側に任せる（as-is で返却）
    return snap.data() as Partial<StoreSettings>;
  } catch (err) {
    console.error('loadStoreSettings failed', err);
  }
  // フォールバック: localStorage（形は as-is でない可能性あり）
  try {
    const cached = getStoreSettings();
    return cached as Partial<StoreSettings>;
  } catch {
    return {};
  }
}

/**
 * 店舗設定をトランザクションで保存。
 * 同時編集を防ぐため、既存ドキュメントを読んで merge 更新。
 */
export async function saveStoreSettingsTx(
  settings: Partial<StoreSettings>,
  options?: { force?: boolean },
): Promise<void> {
  const force = options?.force === true;

  // オフライン時はキューに積んで終了（force 指定時はそのまま続行）
  if (!force && typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOp({ type: 'storeSettings', payload: settings });
    return;
  }

  const ref = doc(db, 'stores', getStoreId(), 'settings', 'config');

  // 送信前に浅いクローン（まずは受け取り shape を保つ）
  const payload: Partial<StoreSettings> & Record<string, any> = { ...settings };

  // === Deep sanitize (Firestore が禁止する undefined を全除去) ===
  // - トップレベル: undefined のキーは削除
  // - 配列: undefined / null を除去し、空配列になったらキーごと削除
  // - tasksByPosition: ネスト内配列の undefined / null を除去。空の配列・空の内側オブジェクトを落とし、
  //   最終的に空オブジェクトならキーごと削除
  const safe: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue; // Firestore は undefined を禁止

    if (Array.isArray(value)) {
      const filtered = value.filter((x) => x !== undefined && x !== null);
      if (filtered.length === 0) continue; // 空で上書きしない
      safe[key] = filtered;
      continue;
    }

    if (key === 'tasksByPosition' && value && typeof value === 'object' && !Array.isArray(value)) {
      const tbp: Record<string, Record<string, string[]>> = {};
      for (const [pos, cmap] of Object.entries(value as Record<string, any>)) {
        if (!cmap || typeof cmap !== 'object') continue;
        const inner: Record<string, string[]> = {};
        for (const [course, arr] of Object.entries(cmap as Record<string, any>)) {
          if (!Array.isArray(arr)) continue;
          const filtered = (arr as any[]).filter((x) => x !== undefined && x !== null).map((x) => String(x));
          if (filtered.length > 0) inner[String(course)] = filtered;
        }
        if (Object.keys(inner).length > 0) tbp[String(pos)] = inner;
      }
      if (Object.keys(tbp).length > 0) safe[key] = tbp;
      continue;
    }

    // それ以外のオブジェクトやプリミティブはそのまま
    safe[key] = value;
  }

  // そのまま merge 保存（差分チェック等は行わない）
  await setDoc(ref, safe, { merge: true });
  await waitForPendingWrites(db);

  // ローカルキャッシュ更新（Firestore の merge イメージに合わせる）
  try {
    const cached = getStoreSettings();
    const full = { ...cached, ...safe } as StoreSettings;
    saveStoreSettings(full);
  } catch {
    // 失敗しても payload を保存しておけば次回起動時に復元可能
    saveStoreSettings(safe as StoreSettings);
  }
}

// ─────────────────────────────────────────────
// オンライン復帰時に SDK キュー ＋ 自前キューを確実にフラッシュ
// ─────────────────────────────────────────────
let _onlineSyncStarted = false;

async function flushOpsQueueSafely() {
  try {
    const { flushQueuedOps } = await import('./opsQueue');
    await flushQueuedOps();
  } catch (e) {
    console.warn('[firebase.flushOpsQueueSafely] failed:', e);
  }
}

async function flushAllQueues() {
  try {
    // Firestore SDK 側のローカル書き込み（IndexedDB）の送信完了を待つ
    await waitForPendingWrites(db);
  } catch (e) {
    // no-op: offline などではここで落ちる可能性があるが、自前キューの送信に進む
  }
  await flushOpsQueueSafely();
}

export function ensureOnlineSyncStarted() {
  if (_onlineSyncStarted || typeof window === 'undefined') return;
  _onlineSyncStarted = true;

  const trigger = () => {
    // 何度呼ばれても安全（内部で waitForPendingWrites は短時間で解決/失敗）
    void flushAllQueues();
  };

  // 1) 画面ロード時（初回）にも実行
  //    setTimeout でイベントループを一周させてから実行することで初期化競合を避ける
  setTimeout(trigger, 0);

  // 2) オンライン復帰時に実行
  window.addEventListener('online', trigger);

  // 2.5) フォーカス復帰時にも実行（PWA / Safari対策）
  window.addEventListener('focus', trigger);

  // 3) タブ復帰時にも実行（バックグラウンドで失敗していても回収できる）
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') trigger();
    });
  }
}

// ブラウザ環境なら即座にリスナーを立てる（SSR では動かない）
if (typeof window !== 'undefined') {
  ensureOnlineSyncStarted();
}
