import { db, getStoreId, ensureStoreStructure } from './firebase';
import { enqueueOp } from './opsQueue';
// localStorage namespace prefix
const ns = `front-kun-${getStoreId()}`;

console.log('[reservations.ts] module loaded, storeId=', getStoreId());

/** 当日の日付 "YYYY-MM-DD" を返すヘルパー */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
/** 既存予約ドキュメントを部分更新。
 *   - ドキュメントが無い場合は setDoc で新規作成（merge:true）
 *   - オフライン時は pending 書き込みを待機
 */
export async function updateReservationFS(
  id: string,
  patch: Partial<any>,
  options?: { todayStr?: string }
) {
  if (!id) {
    console.warn('[updateReservationFS] called with empty id, skipping');
    return;
  }
  // オフライン時はキューに積んで終了
  if (!navigator.onLine) {
    Object.entries(patch).forEach(([field, value]) => {
      enqueueOp({ type: 'update', id: String(id), field, value });
    });
    return;
  }
  try {
    // Firestore 動的 import
    const {
      doc,
      updateDoc,
      waitForPendingWrites,
    } = await import('firebase/firestore');

    const ref = doc(db, 'stores', getStoreId(), 'reservations', String(id));
    await updateDoc(ref, patch);
    await waitForPendingWrites(db);
  } catch (err) {
    console.error('updateReservationFS failed:', err);
  }
}

/** 指定タスク（compKey）の完了フラグをトグル
 * @param reservationId 予約ID（string型）
 */
export async function toggleTaskComplete(
   reservationId: string,
   compKey: string,
   baseVersion?: number,
 ): Promise<void> {
  // オフライン時はキューに積んで終了
  if (!navigator.onLine) {
    // Firestore update will be replayed later
    enqueueOp({
      type: 'update',
      id: reservationId,
      field: `completed.${compKey}`,
      value: !JSON.parse(localStorage.getItem(`${ns}-reservations-cache`) || '{}').completed?.[compKey]
    });
    return;
  }
  const { doc, runTransaction, serverTimestamp, increment } = await import('firebase/firestore');
  const ref = doc(db, 'stores', getStoreId(), 'reservations', reservationId);

  await runTransaction(db, async trx => {
    const snap = await trx.get(ref);
    if (!snap.exists()) throw new Error('Reservation not found');

    const serverVer = (snap.data() as any).version ?? 0;
    if (baseVersion !== undefined && baseVersion < serverVer) {
      throw new Error('STALE_WRITE');
    }

    const completed = { ...(snap.data().completed ?? {}) };
    completed[compKey] = !completed[compKey];
    trx.update(ref, {
      completed,
      version: increment(1),
      updatedAt: serverTimestamp(),
    });
  });
}

/** 予約を 1 件追加 */
export async function addReservationFS(data: any): Promise<void> {
  // ガード: 空 ID なら予約を送信しない
  if (!data.id) {
    console.warn('[addReservationFS] called with empty id, abort');
    return;
  }
  const storeId = getStoreId();
  if (!storeId) {
    console.warn('[addReservationFS] empty storeId, abort');
    return;
  }
  // オフライン時はキューに積んで終了
  if (!navigator.onLine) {
    enqueueOp({ type: 'add', payload: data });
    return;
  }

  console.log(`[addReservationFS] online; ensuring store structure for storeId=${storeId}`);
  // --- 親ドキュメントと設定ドキュメントを自動生成 -----------------
  try {
    await ensureStoreStructure(storeId);
    console.log(`[addReservationFS] ensureStoreStructure succeeded for ${storeId}`);
  } catch (e) {
    console.warn(`[addReservationFS] ensureStoreStructure failed for ${storeId}:`, e);
  }
  // ----------------------------------------------------------------

  const {
    doc,
    setDoc,
    waitForPendingWrites,
    serverTimestamp,
  } = await import('firebase/firestore');

  // UI が管理する連番 / 文字列 ID をそのままドキュメント ID に使う
  const ref = doc(db, 'stores', storeId, 'reservations', String(data.id));

  await setDoc(
    ref,
    {
      ...data,
      version: 1,
      updatedAt: serverTimestamp(),
    },
    { merge: true } // 既にあっても上書きできるように
  );

  await waitForPendingWrites(db);
}

/** 予約を 1 件削除 */
export async function deleteReservationFS(id: string): Promise<void> {
  if (!id) {
    console.warn('[deleteReservationFS] empty id, skip');
    return;
  }

  // オフライン時はキューに積んで終了
  if (!navigator.onLine) {
    enqueueOp({ type: 'delete', id });
    return;
  }

  const {
    doc,
    deleteDoc,
    waitForPendingWrites,
  } = await import('firebase/firestore');

  const ref = doc(db, 'stores', getStoreId(), 'reservations', id);
  await deleteDoc(ref);
  await waitForPendingWrites(db);
}

/** 予約を 1 回だけ全件取得（初回キャッシュ用） */
export async function fetchAllReservationsOnce(): Promise<any[]> {
  const { collection, getDocs, query, orderBy } = await import('firebase/firestore');
  const q = query(collection(db, 'stores', getStoreId(), 'reservations'), orderBy('time', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
}

/**
 * 予約コレクションをすべて削除するユーティリティ
 * joinedToday 端末からのみ呼び出される想定
 */
export async function deleteAllReservationsFS(): Promise<void> {
  // オフライン時はキューに積んで終了
  if (!navigator.onLine) {
    enqueueOp({ type: 'delete', id: '0' });
    return;
  }
  const {
    collection,
    getDocs,
    writeBatch,
    waitForPendingWrites,
  } = await import('firebase/firestore');

  // 予約コレクションを取得
  const snap = await getDocs(collection(db, 'stores', getStoreId(), 'reservations'));
  if (snap.empty) return;           // ドキュメントが無ければ終了

  // 一括削除バッチ
  const batch = writeBatch(db);
  snap.forEach(docSnap => batch.delete(docSnap.ref));

  await batch.commit();
  await waitForPendingWrites(db);   // オフライン時の整合を待つ
}