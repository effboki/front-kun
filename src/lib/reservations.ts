import { db } from './firebase';
import { enqueueOp } from './opsQueue';
import { getJoinedToday } from './firebase';
// ── store-specific Firestore helper ──
function getStoreId(): string {
  if (typeof window === 'undefined') return 'default';
  const parts = window.location.pathname.split('/');
  return parts[1] || 'default';
}
// localStorage namespace prefix
const ns = `front-kun-${getStoreId()}`;
/** 既存予約ドキュメントを部分更新。
 *   - ドキュメントが無い場合は setDoc で新規作成（merge:true）
 *   - オフライン時は pending 書き込みを待機
 */
export async function updateReservationFS(
  id: string | number,
  patch: Partial<any>,
) {
  // オフライン時はキューに積んで終了
  if (!getJoinedToday()) {
    Object.entries(patch).forEach(([field, value]) => {
      enqueueOp({ type: 'update', id: Number(id), field, value });
    });
    return;
  }
  try {
    // Firestore 動的 import
    const {
      doc,
      getDoc,
      updateDoc,
      setDoc,
      waitForPendingWrites,
    } = await import('firebase/firestore');

    const ref = doc(db, 'stores', getStoreId(), 'reservations', String(id));

    // ① ドキュメントが存在するか確認
    const snap = await getDoc(ref);

    if (snap.exists()) {
      // 既存 ⇒ 差分更新
      await updateDoc(ref, patch);
    } else {
      // 無い ⇒ 新規作成（merge:true で将来の update に耐える）
      await setDoc(ref, patch, { merge: true });
    }

    // ② オフライン時の再送同期
    await waitForPendingWrites(db);
  } catch (err) {
    console.error('updateReservationFS failed:', err);
  }
}

/** 指定タスク（compKey）の完了フラグをトグル */
export async function toggleTaskComplete(
  reservationId: number,
  compKey: string,
): Promise<void> {
  // オフライン時はキューに積んで終了
  if (!getJoinedToday()) {
    // Firestore update will be replayed later
    enqueueOp({
      type: 'update',
      id: reservationId,
      field: `completed.${compKey}`,
      value: !JSON.parse(localStorage.getItem(`${ns}-reservations-cache`) || '{}').completed?.[compKey]
    });
    return;
  }
  const { doc, runTransaction } = await import('firebase/firestore');
  const ref = doc(db, 'stores', getStoreId(), 'reservations', String(reservationId));

  await runTransaction(db, async trx => {
    const snap = await trx.get(ref);
    if (!snap.exists()) throw new Error('Reservation not found');

    const completed = { ...(snap.data().completed ?? {}) };
    completed[compKey] = !completed[compKey];
    trx.update(ref, { completed });
  });
}

/** 予約を 1 件追加 */
export async function addReservationFS(data: any): Promise<void> {
  // オフライン時はキューに積んで終了
  if (!getJoinedToday()) {
    enqueueOp({ type: 'add', payload: data });
    return;
  }
  const { addDoc, collection, waitForPendingWrites } = await import('firebase/firestore');
  const ref = collection(db, 'stores', getStoreId(), 'reservations');
  await addDoc(ref, data);
  await waitForPendingWrites(db);
}

/** 予約を 1 回だけ全件取得（初回キャッシュ用） */
export async function fetchAllReservationsOnce(): Promise<any[]> {
  const { collection, getDocs, query, orderBy } = await import('firebase/firestore');
  const q = query(collection(db, 'stores', getStoreId(), 'reservations'), orderBy('time', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: Number(d.id), ...(d.data() as any) }));
}

/**
 * 予約コレクションをすべて削除するユーティリティ
 * joinedToday 端末からのみ呼び出される想定
 */
export async function deleteAllReservationsFS(): Promise<void> {
  // オフライン時はキューに積んで終了
  if (!getJoinedToday()) {
    enqueueOp({ type: 'delete', id: 0 });
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