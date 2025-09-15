

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { subscribePreopen, setActivePositionId as ioSetActivePositionId, setVisibleTables as ioSetVisibleTables } from '@/lib/firebase/preopen';
import { yyyymmdd } from '@/lib/miniTasks';

export type UsePreopenOptions = {
  /** 指定がない場合は購読しません（呼び出し側で uid を渡してください） */
  uid?: string;
  /** 省略時は当日キー（yyyymmdd） */
  dayKey?: string;
};

export type UsePreopenResult = {
  activePositionId: string | null;
  visibleTables: string[];
  /** Firestore の購読が開始され、初回値が反映されたか */
  initialized: boolean;
  /** 保存：activePositionId */
  setActivePositionId: (id: string | null) => Promise<void>;
  /** 保存：visibleTables */
  setVisibleTables: (tables: string[]) => Promise<void>;
};

/**
 * 営業前設定（端末/ユーザーごと）の購読フック
 * - 保存先: stores/{storeId}/preopenUsers/{uid}/days/{yyyymmdd}
 * - uid が未指定の場合は購読せず、初期値を返します（呼び出し側で uid を渡してください）
 */
export function usePreopenSettings(storeId: string, options?: UsePreopenOptions): UsePreopenResult {
  const uid = options?.uid;
  const day = useMemo(() => options?.dayKey ?? yyyymmdd(), [options?.dayKey]);

  const [activePositionId, setActivePositionIdState] = useState<string | null>(null);
  const [visibleTables, setVisibleTablesState] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  // 購読
  useEffect(() => {
    if (!storeId || !uid) return; // uid がない場合は購読しない
    setInitialized(false);
    const unsub = subscribePreopen(storeId, uid, day, (v) => {
      setActivePositionIdState(v.activePositionId ?? null);
      setVisibleTablesState(Array.isArray(v.visibleTables) ? v.visibleTables : []);
      setInitialized(true);
    });
    return () => unsub?.();
  }, [storeId, uid, day]);

  // 保存関数
  const setActivePositionId = useCallback(
    (id: string | null) => {
      if (!storeId || !uid) return Promise.resolve();
      return ioSetActivePositionId(storeId, uid, day, id);
    },
    [storeId, uid, day]
  );

  const setVisibleTables = useCallback(
    (tables: string[]) => {
      if (!storeId || !uid) return Promise.resolve();
      return ioSetVisibleTables(storeId, uid, day, tables);
    },
    [storeId, uid, day]
  );

  return {
    activePositionId,
    visibleTables,
    initialized,
    setActivePositionId,
    setVisibleTables,
  };
}