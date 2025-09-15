// Firestore I/O for MiniTasks (テンプレの完了共有)
// パス構造:
//   stores/{storeId}/miniTasksDaily/{yyyymmdd}/done/{templateId}
//
// ドキュメント構造(例):
//   { done: true, updatedAt: 1736723456789 }
//
// 役割:
//   - subscribeDoneSet: 当日の「完了済みテンプレID集合」を購読
//   - setDone: テンプレIDの完了/未完了を書き込み（merge）

import { collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp, Unsubscribe } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { db as defaultDb } from '@/lib/firebase';

/** 内部: done コレクションへのパスを作成 */
const doneColRef = (db: Firestore, storeId: string, yyyymmdd: string) =>
  collection(db, 'stores', storeId, 'miniTasksDaily', yyyymmdd, 'done');

/**
 * 完了集合の購読
 * @param storeId 店舗ID
 * @param yyyymmdd '20250912' のような日付キー
 * @param cb Set<string> = 完了済み templateId の集合
 * @param db (任意) Firestore インスタンス（省略時は lib/firebase の db）
 * @returns Unsubscribe
 */
export function subscribeDoneSet(
  storeId: string,
  yyyymmdd: string,
  cb: (set: Set<string>) => void,
  db: Firestore = defaultDb
): Unsubscribe {
  const col = doneColRef(db, storeId, yyyymmdd);
  return onSnapshot(
    col,
    (snap) => {
      const set = new Set<string>();
      snap.forEach((d) => {
        const data = d.data() as { done?: boolean } | undefined;
        if (data?.done) set.add(d.id);
      });
      cb(set);
    },
    (err) => {
      console.error('[miniTasks] subscribeDoneSet error:', err);
      cb(new Set()); // エラー時は空集合を返す（UIを止めない）
    }
  );
}

/**
 * 完了フラグの書き込み
 * - done=true: setDoc(merge) で { done: true, updatedAt: serverTimestamp() }
 * - done=false: deleteDoc で削除（購読側から除外される）
 * @param storeId 店舗ID
 * @param yyyymmdd 日付キー
 * @param templateId ミニタスクテンプレID
 * @param done 完了なら true
 * @param db (任意) Firestore インスタンス
 */
export async function setDone(
  storeId: string,
  yyyymmdd: string,
  templateId: string,
  done: boolean,
  db: Firestore = defaultDb
): Promise<void> {
  const ref = doc(doneColRef(db, storeId, yyyymmdd), templateId);
  if (done) {
    await setDoc(
      ref,
      { done: true, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } else {
    await deleteDoc(ref);
  }
}