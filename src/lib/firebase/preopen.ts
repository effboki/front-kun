

// Firestore I/O for "営業前設定" (端末/ユーザーごとのアクティブポジション・表示卓)
// パス設計:
//   stores/{storeId}/preopenUsers/{uid}/days/{yyyymmdd}
//   - activePositionId: string | null
//   - visibleTables: string[]
//   - updatedAt: serverTimestamp()

import {
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { db as defaultDb } from '@/lib/firebase';

export type PreopenValue = {
  activePositionId?: string | null;
  visibleTables?: string[];
  updatedAt?: unknown;
};

/** 内部: ドキュメント参照を生成 */
const preopenDocRef = (
  db: Firestore,
  storeId: string,
  uid: string,
  yyyymmdd: string
) => doc(db, 'stores', storeId, 'preopenUsers', uid, 'days', yyyymmdd);

/**
 * 営業前設定の購読
 * - ドキュメントが存在しない場合でも { activePositionId: null, visibleTables: [] } を返す
 */
export function subscribePreopen(
  storeId: string,
  uid: string,
  yyyymmdd: string,
  cb: (v: { activePositionId: string | null; visibleTables: string[] }) => void,
  db: Firestore = defaultDb
): Unsubscribe {
  const ref = preopenDocRef(db, storeId, uid, yyyymmdd);
  return onSnapshot(ref, (snap) => {
    const data = (snap.data() as PreopenValue) ?? {};
    cb({
      activePositionId: data.activePositionId ?? null,
      visibleTables: Array.isArray(data.visibleTables) ? data.visibleTables : [],
    });
  });
}

/** 部分更新（merge） */
export async function setPreopen(
  storeId: string,
  uid: string,
  yyyymmdd: string,
  patch: Partial<PreopenValue>,
  db: Firestore = defaultDb
): Promise<void> {
  const ref = preopenDocRef(db, storeId, uid, yyyymmdd);
  await setDoc(
    ref,
    { ...patch, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/** activePositionId だけ更新 */
export function setActivePositionId(
  storeId: string,
  uid: string,
  yyyymmdd: string,
  id: string | null,
  db: Firestore = defaultDb
): Promise<void> {
  return setPreopen(storeId, uid, yyyymmdd, { activePositionId: id }, db);
}

/** visibleTables だけ更新 */
export function setVisibleTables(
  storeId: string,
  uid: string,
  yyyymmdd: string,
  tables: string[],
  db: Firestore = defaultDb
): Promise<void> {
  return setPreopen(storeId, uid, yyyymmdd, { visibleTables: tables }, db);
}