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
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Reservation } from '@/types/reservation';

export type RealtimeResState = {
  data: Reservation[];
  initialized: boolean; // 最初の「サーバ由来」のスナップショットを受信したら true（空でも true）
  error: Error | null;
};

/**
 * 今日（ローカル日付）の予約を /stores/{storeId}/reservations から購読。
 * 返り値は `{ data, initialized, error }`。
 * - 初回の「キャッシュ起点の空スナップショット」は無視
 * - 最初の「サーバ由来」が到着したら `initialized=true`（空でも true）
 * - 以降は空配列もそのまま流す
 */
export function useRealtimeReservations(
  storeId: string | undefined
): RealtimeResState {
  const unsubRef = useRef<Unsubscribe | null>(null);
  const sawServerRef = useRef(false); // サーバ由来を一度でも受け取ったか

  const [data, setData] = useState<Reservation[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const detach = () => {
    unsubRef.current?.();
    unsubRef.current = null;
  };

  const ymdTodayLocal = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  useEffect(() => {
    if (!storeId) {
      detach();
      setData([]);
      setInitialized(false);
      setError(null);
      sawServerRef.current = false;
      return;
    }

    let canceled = false;

    const today = ymdTodayLocal();
    const col = collection(db, 'stores', storeId, 'reservations');
    const q = query(col, where('date', '==', today), orderBy('time', 'asc'));

    // 初回の描画体験改善: 一度だけ getDocs() でキャッシュ/サーバのどちらかを拾って即時描画
    // （サーバからの onSnapshot が来たらそちらを優先。ここでは initialized は決めない）
    (async () => {
      try {
        const snap = await getDocs(q);
        const arr = snap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as Omit<Reservation, 'id'>) } as Reservation)
        );
        if (canceled) return;
        setData(arr);
      } catch (e: any) {
        if (canceled) return;
        console.error('[RealtimeRes] initial getDocs failed', e);
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    })();

    unsubRef.current = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        const { fromCache, hasPendingWrites } = snap.metadata;
        const isEmpty = snap.empty;

        // 初回の「キャッシュ＆空」は無視（サーバ応答を待つ）
        if (!sawServerRef.current && fromCache && !hasPendingWrites && isEmpty) {
          // console.log('[RealtimeRes] skip first cache-empty snapshot');
          return;
        }

        if (!fromCache) {
          sawServerRef.current = true; // サーバ由来を受信
          setInitialized(true);        // 空でも true にする（状態に依存しない）
        }

        const arr = snap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as Omit<Reservation, 'id'>) } as Reservation)
        );
        setData(arr);
      },
      (e) => {
        console.error('[RealtimeRes] onSnapshot error', e);
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    );

    return () => {
      canceled = true;
      detach();
      // 次の storeId へ切り替える準備
      setInitialized(false);
      setError(null);
      sawServerRef.current = false;
    };
  }, [storeId]);

  return { data, initialized, error };
}