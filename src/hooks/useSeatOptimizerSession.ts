'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp, type Unsubscribe } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export type SeatOptimizerSessionDoc = {
  prompt: string;
  updatedAt?: unknown;
  updatedBy?: string;
};

const formatDayKey = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
};

export const useSeatOptimizerSession = (storeId?: string, dayMs?: number) => {
  const [prompt, setPrompt] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<unknown>(null);
  const unsubRef = useRef<Unsubscribe | null>(null);

  const dayKey = useMemo(() => (Number.isFinite(dayMs as number) ? formatDayKey(dayMs as number) : null), [dayMs]);

  useEffect(() => {
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    if (!storeId || !dayKey) {
      setPrompt('');
      return;
    }

    const ref = doc(db, 'stores', storeId, 'seatOptimizerSessions', dayKey);
    setLoading(true);
    setError(null);

    const unsub = onSnapshot(ref, (snap) => {
      const data = (snap.data() || {}) as SeatOptimizerSessionDoc;
      setPrompt(typeof data.prompt === 'string' ? data.prompt : '');
      setLoading(false);
    }, (err) => {
      setError(err);
      setLoading(false);
    });

    unsubRef.current = unsub;

    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [storeId, dayKey]);

  const updatePrompt = useCallback(async (next: string) => {
    if (!storeId || !dayKey) return;
    const ref = doc(db, 'stores', storeId, 'seatOptimizerSessions', dayKey);
    await setDoc(ref, { prompt: next, updatedAt: serverTimestamp() }, { merge: true });
  }, [storeId, dayKey]);

  const clearPrompt = useCallback(async () => {
    await updatePrompt('');
  }, [updatePrompt]);

  return { prompt, updatePrompt, clearPrompt, loading, error } as const;
};

export { formatDayKey };

