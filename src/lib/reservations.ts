import { db } from './firebase';
import { enqueueOp } from './opsQueue';
// ── store-specific Firestore helper ──
function getStoreId(): string {
  if (typeof window === 'undefined') return 'default';
  // 例:  /demo/   →  demo
  const raw = window.location.pathname.split('/')[1] || 'default';
  return raw.replace(/^\/+|\/+$/g, '') || 'default';
}
// localStorage namespace prefix
const ns = `front-kun-${getStoreId()}`;
/** 当日の日付 "YYYY-MM-DD" を返すヘルパー */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
/** 既存予約ドキュメントを部分更新。
 *   - ドキュメントが無い場合は setDoc で新規作成（merge:true）
 *   - オフライン時は pending 書き込みを待機
 */
export async function updateReservationFS(
  id: string | number,
  patch: Partial<any>,
  options?: { todayStr?: string }
) {
  // オフライン時はキューに積んで終了
  if (!navigator.onLine) {
    Object.entries(patch).forEach(([field, value]) => {
      enqueueOp({ type: 'update', id: Number(id), field, value });
    });
    return;
  }
  try {
    // Firestore 動的 import
    const {
      doc,
      runTransaction,
      waitForPendingWrites,
      increment,
      serverTimestamp,
      setDoc,
    } = await import('firebase/firestore');

    const useTodayStr = options?.todayStr ?? todayStr();
    const ref = doc(db, 'stores', getStoreId(), `reservations-${useTodayStr}`, String(id));

    const autoPatch = {
      version: increment(1),
      updatedAt: serverTimestamp(),
    };

    await runTransaction(db, async (trx) => {
      const snap = await trx.get(ref);
      const serverVer = snap.exists() ? ((snap.data() as any).version ?? 0) : 0;

      const { baseVersion, ...editPatch } = patch as any;
      if (baseVersion !== undefined && baseVersion < serverVer) {
        throw new Error('STALE_WRITE');
      }

      if (snap.exists()) {
        trx.update(ref, { ...editPatch, ...autoPatch });
      } else {
        // 新規作成 (merge:true 相当の挙動を再現)
        trx.set(ref, { ...editPatch, ...autoPatch });
      }
    });

    // オフライン時の再送同期
    await waitForPendingWrites(db);
  } catch (err) {
    console.error('updateReservationFS failed:', err);
  }
}

/** 指定タスク（compKey）の完了フラグをトグル */
export async function toggleTaskComplete(
  reservationId: number,
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
  const ref = doc(db, 'stores', getStoreId(), `reservations-${todayStr()}`, String(reservationId));

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
  // オフライン時はキューに積んで終了
  if (!navigator.onLine) {
    enqueueOp({ type: 'add', payload: data });
    return;
  }
  const { addDoc, collection, waitForPendingWrites, serverTimestamp } = await import('firebase/firestore');
  const ref = collection(db, 'stores', getStoreId(), `reservations-${todayStr()}`);
  await addDoc(ref, {
    ...data,
    version: 1,
    updatedAt: serverTimestamp(),
  });
  await waitForPendingWrites(db);
}

/** 予約を 1 回だけ全件取得（初回キャッシュ用） */
export async function fetchAllReservationsOnce(): Promise<any[]> {
  const { collection, getDocs, query, orderBy } = await import('firebase/firestore');
  const q = query(collection(db, 'stores', getStoreId(), `reservations-${todayStr()}`), orderBy('time', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: Number(d.id), ...(d.data() as any) }));
}

/**
 * 予約コレクションをすべて削除するユーティリティ
 * joinedToday 端末からのみ呼び出される想定
 */
export async function deleteAllReservationsFS(): Promise<void> {
  // オフライン時はキューに積んで終了
  if (!navigator.onLine) {
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
  const snap = await getDocs(collection(db, 'stores', getStoreId(), `reservations-${todayStr()}`));
  if (snap.empty) return;           // ドキュメントが無ければ終了

  // 一括削除バッチ
  const batch = writeBatch(db);
  snap.forEach(docSnap => batch.delete(docSnap.ref));

  await batch.commit();
  await waitForPendingWrites(db);   // オフライン時の整合を待つ
}