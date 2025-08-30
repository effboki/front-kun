'use client';

// src/hooks/useRealtimeReservations.ts
import { useEffect, useRef, useState } from 'react';
import {
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  Unsubscribe
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Reservation } from '@/types/reservation';

/**
 * 今日の日付（YYYY-MM-DD）に該当する予約を
 * /stores/{storeId}/reservations からリアルタイム購読するフック。
 * @param storeId Firestore の /stores/{storeId}
 */
export function useRealtimeReservations(
  storeId: string | undefined
): Reservation[] {
  // detach 用 unsubscribe を覚えておく
  const unsubRef = useRef<Unsubscribe | null>(null);
  const gotServerRef = useRef(false);

  // 取得した予約をここに入れる
  const [list, setList] = useState<Reservation[]>([]);

  /** listener の解除を安全に行う */
  const detach = () => {
    unsubRef.current?.();
    unsubRef.current = null;
  };

  /**
   * Local timezone YYYY-MM-DD (avoids UTC off-by-one on .toISOString())
   */
  const ymdTodayLocal = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  useEffect(() => {
    console.log('[RealtimeRes] storeId=', storeId);
    if (!storeId) {
      console.warn('[RealtimeRes] storeId is undefined, skipping listener');
      return detach();
    }

    // 今日の日付（"YYYY-MM-DD"）
    const today = ymdTodayLocal();

    // listen 先コレクション: /stores/{id}/reservations, フィルタ: date === today, 時間順
    const reservationsCol = collection(db, 'stores', storeId, 'reservations');
    const q = query(
      reservationsCol,
      where('date', '==', today),
      orderBy('time', 'asc')
    );

    console.log('[RealtimeRes] listening on collection:', 'stores', storeId, 'reservations');
    console.log('[RealtimeRes] query object:', q);

    (async () => {
      try {
        const snap = await getDocs(q);
        const initial = snap.docs.map(
          (d) =>
            ({
              id: d.id,
              ...(d.data() as Omit<Reservation, 'id'>),
            } as Reservation)
        );
        setList(initial);
      } catch (err) {
        console.error('[RealtimeRes] initial getDocs failed', err);
      }
    })();

    unsubRef.current = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        const { fromCache, hasPendingWrites } = snap.metadata;
        const isEmpty = snap.empty;

        // 初回の「キャッシュ起点の空スナップショット」は無視（サーバ応答を待つ）
        if (!gotServerRef.current && fromCache && !hasPendingWrites && isEmpty) {
          console.log('[RealtimeRes] skip first cache-empty snapshot');
          return;
        }
        if (!fromCache) {
          gotServerRef.current = true; // サーバ由来を受信
        }

        const arr = snap.docs.map(
          (d) =>
            ({
              id: d.id,
              ...(d.data() as Omit<Reservation, 'id'>),
            } as Reservation)
        );
        console.log('[RealtimeRes] got docs:', { count: arr.length, fromCache, hasPendingWrites });
        setList(arr);
      },
      (err) => {
        console.error('[RealtimeRes] onSnapshot error', err);
      }
    );

    // cleanup on unmount
    return () => detach();
  }, [storeId]);

  return list;
}