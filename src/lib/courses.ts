// src/lib/courses.ts
// コース関連ユーティリティ
import {
  collection,
  query,
  where,
  runTransaction,
  getDocs,
  doc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getStoreId } from '@/lib/firebase';

/**
 * Firestore 予約コレクション内でコース名を一括リネームするヘルパー。
 * - completed フィールドにも旧コース名がキーとして入っている場合があるので合わせて置換。
 * - 1 予約 = 1 ドキュメント設計のため、全件走査＆更新でもコストは「書込み件数」と同じ。
 */
export async function renameCourseTx(oldName: string, newName: string) {
  if (oldName === newName) return;

  const storeId = getStoreId();          // ← 既存ヘルパー
  const reservationsRef = collection(
    db,
    'stores',
    storeId,
    'reservations'
  );
  // course === oldName のドキュメントだけ取得
  const q = query(reservationsRef, where('course', '==', oldName));
  const snap = await getDocs(q);

  if (snap.empty) return;

  await runTransaction(db, async (trx) => {
    snap.forEach((docSnap) => {
      const data = docSnap.data() as any;
      const completed: Record<string, boolean> = data.completed ?? {};
      const editedCompleted: Record<string, boolean> = {};

      // completed キーの名前も置換
      Object.entries(completed).forEach(([key, val]) => {
        const replacedKey = key.replace(oldName, newName);
        editedCompleted[replacedKey] = val;
      });

      trx.update(
        doc(db, 'stores', storeId, 'reservations', docSnap.id),
        {
          course: newName,
          completed: editedCompleted,
        }
      );
    });
  });
}
