'use client';

// src/hooks/useRealtimeStoreSettings.ts
import { useEffect, useState } from 'react';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { db, DEFAULT_STORE_SETTINGS } from '@/lib/firebase';
import type { StoreSettings } from '@/types/settings';

/**
 * 店舗設定ドキュメント (/stores/{storeId}/settings/config) を
 * リアルタイム購読し、常に最新の StoreSettings を返すカスタムフック。
 *
 * - Firestore ドキュメントが存在しない場合や欠損フィールドは
 *   DEFAULT_STORE_SETTINGS で穴埋めして返す。
 * - オフライン時は購読を張らず、null を返す。
 *
 * @param storeId Firestore の店舗ドキュメント ID
 * @returns StoreSettings | null
 */
export const useRealtimeStoreSettings = (
  storeId: string | undefined,
): StoreSettings | null => {
  const [settings, setSettings] = useState<StoreSettings | null>(null);

  useEffect(() => {
    if (!storeId) return;   // オンライン判定を削除

    const ref = doc(db, 'stores', storeId, 'settings', 'config');

    // ① 初期読み込み: getDoc で即座に現在値を取得
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
        console.error('[useRealtimeStoreSettings] getDoc failed', err);
      }
    })();
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        // ドキュメント自体がまだ無い場合はデフォルトを返す
        setSettings({ ...DEFAULT_STORE_SETTINGS });
        return;
      }

      const raw = snap.data() as Partial<StoreSettings>;
      // 欠けているフィールドを DEFAULT で埋める
      const merged: StoreSettings = {
        ...DEFAULT_STORE_SETTINGS,
        ...raw,
      };
      setSettings(merged);
    });

    return () => unsub();
  }, [storeId]);

  return settings;
};