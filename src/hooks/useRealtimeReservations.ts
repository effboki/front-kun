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

  // 取得した予約をここに入れる
  const [list, setList] = useState<Reservation[]>([]);

  /** listener の解除を安全に行う */
  const detach = () => {
    unsubRef.current?.();
    unsubRef.current = null;
  };

  useEffect(() => {
    console.log('[RealtimeRes] storeId=', storeId);
    if (!storeId) {
      console.warn('[RealtimeRes] storeId is undefined, skipping listener');
      return detach();
    }

    // 今日の日付（"YYYY-MM-DD"）
    const today = new Date().toISOString().slice(0, 10);

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

    unsubRef.current = onSnapshot(q, (snap) => {
      const arr = snap.docs.map(
        (d) =>
          ({
            id: d.id,
            ...(d.data() as Omit<Reservation, 'id'>),
          } as Reservation)
      );
      console.log('[RealtimeRes] got docs:', arr);
      setList(arr);
    });

    // cleanup on unmount
    return () => detach();
  }, [storeId]);

  return list;
}