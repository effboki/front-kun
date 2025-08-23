'use client';

import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, getDoc, type Unsubscribe } from 'firebase/firestore';
import { db, DEFAULT_STORE_SETTINGS } from '@/lib/firebase';
import type { StoreSettings } from '@/types/settings';

/**
 * 店舗設定ドキュメント (/stores/{storeId}/settings/config) を購読して
 * 常に最新の StoreSettings を返すカスタムフック。
 *
 * ✅ Hooks の呼び出し順が毎回一定になるように、条件分岐は useEffect 内に閉じ込める。
 *    （useState → useRef → useEffect の順番を維持）
 */
export const useRealtimeStoreSettings = (
  storeId?: string,
): StoreSettings | null => {
  // 1) useState —— 常に最初に呼ばれる
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  // 2) useRef —— 次に呼ばれる（購読解除用）
  const unsubRef = useRef<Unsubscribe | null>(null);

  // 3) useEffect —— 最後に呼ばれる（副作用の中で条件分岐）
  useEffect(() => {
    // 前回の購読を解除し、表示値を一旦クリア（読み込み中の意味）
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    setSettings(null);

    // storeId が無い場合は何もしない（呼び出し順は維持される）
    if (!storeId) return;

    const ref = doc(db, 'stores', storeId, 'settings', 'config');

    // 初期値を即時反映（ミスマッチを避け、UX を向上）
    (async () => {
      try {
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as Partial<StoreSettings>;
          setSettings({ ...DEFAULT_STORE_SETTINGS, ...data });
        } else {
          setSettings({ ...DEFAULT_STORE_SETTINGS });
        }
      } catch (err) {
        console.warn('[useRealtimeStoreSettings] getDoc failed:', err);
        setSettings({ ...DEFAULT_STORE_SETTINGS });
      }
    })();

    // リアルタイム購読
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setSettings({ ...DEFAULT_STORE_SETTINGS });
          return;
        }
        const raw = snap.data() as Partial<StoreSettings>;
        setSettings({ ...DEFAULT_STORE_SETTINGS, ...raw });
      },
      (err) => {
        console.warn('[useRealtimeStoreSettings] onSnapshot error:', err);
      },
    );

    unsubRef.current = unsub;

    // アンマウント時 / storeId 変更時に購読解除
    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [storeId]);

  return settings;
};