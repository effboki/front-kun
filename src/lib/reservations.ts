import { db, getStoreId, ensureStoreStructure } from './firebase';
import { enqueueOp, flushQueuedOps } from './opsQueue';

console.log('[reservations.ts] module loaded, storeId=', getStoreId());

/** 当日の日付 "YYYY-MM-DD" を返すヘルパー */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
/** Firestore で使えない "/" などを "_" に置換して返す */
function sanitizeSegment(seg: string): string {
  return String(seg).replace(/[\/\\.#$\[\]]/g, '_');
}
/** 予約・ローカルキャッシュ用の dynamic localStorage 名前空間 */
function ns(): string {
  return `front-kun-${getStoreId()}`;
}
/** 既存予約ドキュメントを部分更新。
 *   - ドキュメントが無い場合は setDoc で新規作成（merge:true）
 *   - オフライン時は pending 書き込みを待機
 */
export async function updateReservationFS(
  id: string,
  patch: Partial<any>,
  timeShiftDelta?: Record<string, number>,
  options?: { todayStr?: string }
) {
  if (!id) {
    console.warn('[updateReservationFS] called with empty id, skipping');
    return;
  }
  const rawStoreId = getStoreId();
  const storeId = sanitizeSegment(rawStoreId);
  const docId = sanitizeSegment(String(id));

  // オフライン時は即キュー退避
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    try {
      Object.entries(patch || {}).forEach(([field, value]) => {
        enqueueOp({ type: 'update', id: docId, field, value });
      });
      if (timeShiftDelta) {
        Object.entries(timeShiftDelta).forEach(([label, delta]) => {
          if (delta) enqueueOp({ type: 'update', id: docId, field: `timeShift.${label}`, value: delta });
        });
      }
      enqueueOp({ type: 'update', id: docId, field: 'updatedAt', value: Date.now() });
    } finally {
      return;
    }
  }

  // オンライン: まずは通常の Firestore 更新を試みる
  try {
    try {
      await ensureStoreStructure(storeId);
    } catch (e) {
      console.warn(`[updateReservationFS] ensureStoreStructure failed for ${storeId}:`, e);
    }

    const { doc, updateDoc, waitForPendingWrites, serverTimestamp, increment } =
      await import('firebase/firestore');

    const ref = doc(db, 'stores', storeId, 'reservations', docId);

    // timeShift はインクリメント更新に変換
    const shiftPayload: Record<string, any> = {};
    if (timeShiftDelta) {
      Object.entries(timeShiftDelta).forEach(([label, delta]) => {
        if (delta) shiftPayload[`timeShift.${label}`] = increment(delta);
      });
    }

    await updateDoc(ref, {
      ...(patch || {}),
      ...shiftPayload,
      version: increment(1),
      updatedAt: serverTimestamp(),
    });

    await waitForPendingWrites(db);

    // 念のため自前キューも flush（オフライン→復帰の境目でも回収）
    try {
      await flushQueuedOps();
    } catch (e) {
      console.warn('[updateReservationFS] flushQueuedOps failed:', e);
    }
  } catch (err) {
    console.error('[updateReservationFS] online update failed, enqueueing fallback:', err);
    // 失敗時は必ずキューに退避（オフライン時と同じ扱い）
    try {
      Object.entries(patch || {}).forEach(([field, value]) => {
        enqueueOp({ type: 'update', id: docId, field, value });
      });
      if (timeShiftDelta) {
        Object.entries(timeShiftDelta).forEach(([label, delta]) => {
          if (delta) enqueueOp({ type: 'update', id: docId, field: `timeShift.${label}`, value: delta });
        });
      }
      enqueueOp({ type: 'update', id: docId, field: 'updatedAt', value: Date.now() });
    } catch (e2) {
      console.error('[updateReservationFS] enqueue fallback failed:', e2);
    }
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
  const rawStoreId = getStoreId();
  const storeId = sanitizeSegment(rawStoreId);
  // 親ドキュメントの存在を保証
  try {
    await ensureStoreStructure(storeId);
  } catch (e) {
    console.warn(`[toggleTaskComplete] ensureStoreStructure failed for ${storeId}:`, e);
  }
  // オフライン時はキューに積んで終了
  if (!navigator.onLine) {
    // Firestore update will be replayed later
    enqueueOp({
      type: 'update',
      id: sanitizeSegment(reservationId),
      field: `completed.${compKey}`,
      value: !JSON.parse(localStorage.getItem(`${ns()}-reservations-cache`) || '{}').completed?.[compKey]
    });
    return;
  }
  const { doc, runTransaction, serverTimestamp, increment } = await import('firebase/firestore');
  const docId = sanitizeSegment(reservationId);
  const ref = doc(db, 'stores', storeId, 'reservations', docId);

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
  if (!data?.id) {
    console.warn('[addReservationFS] called with empty id, abort');
    return;
  }
  const rawStoreId = getStoreId();
  const storeId = sanitizeSegment(rawStoreId);
  if (!storeId) {
    console.warn('[addReservationFS] empty storeId, abort');
    return;
  }

  const docId = sanitizeSegment(String(data.id));

  // オフラインは即キュー
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOp({
      type: 'add',
      payload: {
        ...data,
        // NEWバッジ用。未指定ならクライアント時刻で埋める（後続オンライン追加時は serverTimestamp に統一）
        createdAt: (data as any)?.createdAt ?? Date.now(),
        // 以降の表示安定のために更新時刻と楽観バージョンを付与
        updatedAt: Date.now(),
        version: (typeof (data as any)?.version === 'number' ? (data as any).version : 0) + 1,
      },
    });
    return;
  }

  try {
    try {
      await ensureStoreStructure(storeId);
    } catch (e) {
      console.warn(`[addReservationFS] ensureStoreStructure failed for ${storeId}:`, e);
    }

    const { doc, setDoc, waitForPendingWrites, serverTimestamp } = await import('firebase/firestore');
    const ref = doc(db, 'stores', storeId, 'reservations', docId);

    await setDoc(
      ref,
      {
        ...data,
        version: (typeof data.version === 'number' ? data.version : 0) + 1,
        createdAt: (data as any)?.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    await waitForPendingWrites(db);
    try {
      await flushQueuedOps();
    } catch (e) {
      console.warn('[addReservationFS] flushQueuedOps failed:', e);
    }
  } catch (err) {
    console.error('[addReservationFS] online add failed, enqueueing fallback:', err);
    try {
      enqueueOp({ type: 'add', payload: { ...data } });
    } catch (e2) {
      console.error('[addReservationFS] enqueue fallback failed:', e2);
    }
  }
}

/** 予約を 1 件削除 */
export async function deleteReservationFS(id: string): Promise<void> {
  if (!id) {
    console.warn('[deleteReservationFS] empty id, skip');
    return;
  }
  const rawStoreId = getStoreId();
  const storeId = sanitizeSegment(rawStoreId);
  const docId = sanitizeSegment(id);

  // オフラインは即キュー
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOp({ type: 'delete', id: docId });
    return;
  }

  try {
    try {
      await ensureStoreStructure(storeId);
    } catch (e) {
      console.warn(`[deleteReservationFS] ensureStoreStructure failed for ${storeId}:`, e);
    }

    const { doc, deleteDoc, waitForPendingWrites } = await import('firebase/firestore');
    const ref = doc(db, 'stores', storeId, 'reservations', docId);
    await deleteDoc(ref);
    await waitForPendingWrites(db);
  } catch (err) {
    console.error('[deleteReservationFS] online delete failed, enqueueing fallback:', err);
    try {
      enqueueOp({ type: 'delete', id: docId });
    } catch (e2) {
      console.error('[deleteReservationFS] enqueue fallback failed:', e2);
    }
  }
}

/** 予約を 1 回だけ全件取得（初回キャッシュ用） */
export async function fetchAllReservationsOnce(storeId: string): Promise<any[]> {
  const sId = sanitizeSegment(String(storeId));
  const { collection, getDocs, query, orderBy } = await import('firebase/firestore');
  const q = query(collection(db, 'stores', sId, 'reservations'), orderBy('time', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
}

/**
 * 予約コレクションをすべて削除するユーティリティ
 * joinedToday 端末からのみ呼び出される想定
 */
export async function deleteAllReservationsFS(): Promise<void> {
  const rawStoreId = getStoreId();
  const storeId = sanitizeSegment(rawStoreId);
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
  const snap = await getDocs(collection(db, 'stores', storeId, 'reservations'));
  if (snap.empty) return;           // ドキュメントが無ければ終了

  // 一括削除バッチ
  const batch = writeBatch(db);
  snap.forEach(docSnap => batch.delete(docSnap.ref));

  await batch.commit();
  await waitForPendingWrites(db);   // オフライン時の整合を待つ
}