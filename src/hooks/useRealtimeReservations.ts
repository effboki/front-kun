// src/hooks/useRealtimeReservations.ts
import { useEffect, useRef, useState } from 'react';
import {
  onSnapshot,
  collection,
  query,
  where,
  Timestamp,
  Unsubscribe,
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
    console.log('[RealtimeRes] listening on path:', `stores/${storeId}/reservations`);
    if (!joined || !storeId) {
      console.log('[RealtimeRes] skip subscription');
      return detach();
    }

    // すでに付いていれば一度外す（多重 attach 防止）
    detach();

    // 今日の日付（"YYYY-MM-DD"）
    const today = new Date().toISOString().slice(0, 10);

    // /stores/{id}/reservations から “本日” だけを listen
    const q = query(
      collection(db, 'stores', storeId, 'reservations'),
      where('date', '==', today)
    );
    console.log('[RealtimeRes] query object:', q);

    console.log('[RealtimeRes] subscribing to query:', q);
    unsubRef.current = onSnapshot(q, (snap) => {
      const arr = snap.docs.map(
        (d) =>
          ({
            id: d.id,
            ...d.data(),
          } as Reservation)
      );
      console.log('[RealtimeRes] got docs:', arr);
      setList(arr);
    });

    // 0:00 で自動 detach
    const timer = setTimeout(detach, msUntilMidnight());

    // コンポーネント unmount 時にも detach
    return () => {
      clearTimeout(timer);
      detach();
    };
  }, [joined, storeId]);

  return list;
}