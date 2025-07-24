// src/hooks/useRealtimeReservations.ts
import { useEffect, useRef, useState } from 'react';
import {
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  Unsubscribe
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Reservation } from '@/types/reservation';

/**
 * 「今日だけリアルタイム参加」用フック
 * @param storeId Firestore の /stores/{storeId}
 * @param joined  参加ボタン ON/OFF
 */
export function useRealtimeReservations(
  storeId: string | undefined,
  joined: boolean
): Reservation[] {
  // detach 用 unsubscribe を覚えておく
  const unsubRef = useRef<Unsubscribe | null>(null);

  // 取得した予約をここに入れる
  const [list, setList] = useState<Reservation[]>([]);

  /** 0:00 までの残りミリ秒を計算 */
  const msUntilMidnight = () => {
    const now = new Date();
    const next = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      0
    );
    return next.getTime() - now.getTime();
  };

  /** listener の解除を安全に行う */
  const detach = () => {
    unsubRef.current?.();
    unsubRef.current = null;
  };

  useEffect(() => {
    console.log('[RealtimeRes] storeId=', storeId, 'joined=', joined);
    if (!storeId) {
      console.warn('[RealtimeRes] storeId is undefined, skipping listener');
      return detach();
    }
    if (!joined) {
      console.log('[RealtimeRes] joined flag is false; detaching listener');
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

    unsubRef.current = onSnapshot(q, (snap) => {
      const arr = snap.docs.map((d) => {
        // Extract reservation data with id field
        const data = d.data() as Partial<Reservation>;
        return { ...data, id: d.id } as Reservation;
      });
      console.log('[RealtimeRes] got docs:', arr);
      setList(arr);
    });

    // 0:00 で自動 detach
    const timer = setTimeout(detach, msUntilMidnight());

    // cleanup on unmount
    return () => {
      clearTimeout(timer);
      detach();
    };
  }, [storeId, joined]);

  return list;
}