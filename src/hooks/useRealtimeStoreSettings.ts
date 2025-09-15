'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, getDoc, setDoc, serverTimestamp, type Unsubscribe } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sanitizeCourses, type StoreSettings } from '@/types/settings';

/**
 * 店舗設定ドキュメント (/stores/{storeId}/settings/config) を購読しつつ、
 * 画面側の編集ドラフトを保持・保存できるフック。
 *
 * 返り値：
 *  - value: 画面で編集中のドラフト（StoreSettings）
 *  - patch: ドラフトへの部分更新
 *  - save: Firestore へ保存（merge 書き込み）
 *  - loading: Firestore 初期ロード中
 *  - error: 初期ロード中のエラー
 *  - isSaving: 保存中フラグ
 */
export const useRealtimeStoreSettings = (storeId?: string) => {
  // ---- local draft ----
  const [value, setValue] = useState<StoreSettings>({} as StoreSettings);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<unknown>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // keep last server value to decide when to reset draft (optional; not strictly necessary)
  const lastServerValueRef = useRef<StoreSettings | null>(null);

  // unsubscribe holder
  const unsubRef = useRef<Unsubscribe | null>(null);

  // Firestore -> StoreSettings（courses だけは安全化）
  const normalizeRead = useCallback((raw: unknown): StoreSettings => {
    const r = (raw || {}) as any;
    const out: any = { ...r };
    // ensure areas always exists as an array (even if missing on the doc)
    out.areas = Array.isArray(r?.areas) ? r.areas : [];
    if (Array.isArray(r?.courses)) {
      out.courses = sanitizeCourses(r.courses);
    }
    return out as StoreSettings;
  }, []);

  const ref = useMemo(() => {
    if (!storeId) return null;
    return doc(db, 'stores', storeId, 'settings', 'config');
  }, [storeId]);

  // 初期ロード + リアルタイム購読
  useEffect(() => {
    // 既存購読を解除
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    // storeId が無ければ終了
    if (!ref) {
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    // 1) 先に getDoc で即時反映
    (async () => {
      try {
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const server = normalizeRead(snap.data());
          lastServerValueRef.current = server;
          setValue((prev) => {
            // 初回はサーバ値で上書き（画面初期表示を最新化）
            return Object.keys(prev ?? {}).length === 0 ? server : prev;
          });
        } else {
          lastServerValueRef.current = {} as StoreSettings;
          // サーバに存在しない場合でも空を維持
        }
      } catch (e) {
        setError(e);
      } finally {
        setLoading(false);
      }
    })();

    // 2) onSnapshot で追随
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          lastServerValueRef.current = {} as StoreSettings;
          return;
        }
        const server = normalizeRead(snap.data());
        console.info(
          '[useRealtimeStoreSettings.svcp] path:',
          `stores/${storeId}/settings/config`,
          'keys:',
          Object.keys((snap.data() || {}))
        );
        lastServerValueRef.current = server;
        // サーバから来た差分をドラフトにマージ（編集中でも新規キーは取り込む）
        setValue((prev) => ({ ...(prev as StoreSettings), ...(server as StoreSettings) }));
        // ここでドラフトを無条件に上書きしない。ユーザー編集中の値は維持する。
        // （編集中にサーバが更新されても破壊しないため）
      },
      (err) => {
        setError(err);
      }
    );

    unsubRef.current = unsub;

    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [ref, normalizeRead]);

  // areas（なければ空配列）
  const areas = useMemo(() => {
    return (((value as any)?.areas ?? []) as any[]);
  }, [ (value as any)?.areas ]);

  // table -> areaIds（重複所属OK）
  const tableToAreas = useMemo(() => {
    const map: Record<string, string[]> = {};
    const list = (((value as any)?.areas ?? []) as any[]);
    list.forEach((a: any) => {
      const areaId = String(a?.id ?? '');
      (a?.tables ?? []).forEach((t: any) => {
        const key = String(t);
        if (!map[key]) map[key] = [];
        if (areaId && !map[key].includes(areaId)) map[key].push(areaId);
      });
    });
    return map;
  }, [ (value as any)?.areas ]);

  // 画面からの部分更新
  const patch = useCallback((p: Partial<StoreSettings>) => {
    setValue((prev) => ({ ...(prev as StoreSettings), ...p }));
  }, []);

  // Firestore へ保存（merge） — 画面側から上書き値も受け取れるように
  const save = useCallback(async (override?: StoreSettings) => {
    setIsSaving(true);
    try {
      const ref = doc(db, 'stores', storeId as string, 'settings', 'config');
      const payload = (override ?? value ?? {}) as StoreSettings;

      console.info(
        '[useRealtimeStoreSettings.save] path:',
        `stores/${storeId}/settings/config`,
        'keys:',
        Object.keys(payload || {})
      );

      await setDoc(ref, { ...payload, updatedAt: serverTimestamp() }, { merge: true });
    } finally {
      setIsSaving(false);
    }
  }, [storeId, value]);

  return { value, areas, tableToAreas, patch, save, loading, error, isSaving };
};