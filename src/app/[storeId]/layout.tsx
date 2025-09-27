'use client';
import * as React from 'react';
import BellMenu from '@/app/[storeId]/_components/global/BellMenu';
import { MiniTaskProvider } from '@/app/_providers/MiniTaskProvider';
import { ensureStoreSettingsDefaults, type StoreSettingsValue } from '@/types/settings';
import { selectWaveInputTasks, type WaveSourceReservation } from '@/lib/waveSelectors';
import { useWaveSourceReservations, type WaveReservationMapper } from '@/hooks/useReservationsData';
import { useRealtimeStoreSettings } from '@/hooks/useRealtimeStoreSettings';
import { useParams } from 'next/navigation';
import { usePreopenSettings } from '@/hooks/usePreopenSettings';

export default function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authEnabled = process.env.NEXT_PUBLIC_FIREBASE_AUTH_ENABLED === '1';
  const { storeId } = useParams<{ storeId: string }>();
  // 型の安全性のために string 化（Nextの型は string | string[] の可能性がある）
  const storeIdStr = String(storeId || '');

  // 店舗設定を購読（既定値を適用して欠損を防ぐ）
  const { value: settingsValue } = useRealtimeStoreSettings(storeIdStr);
  const settings = ensureStoreSettingsDefaults((settingsValue ?? {}) as StoreSettingsValue);

  // 認証UIDを監視（取得できる場合は購読に使用）
  const [uid, setUid] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    if (!authEnabled) return undefined;

    let isMounted = true;
    let unsubscribe: (() => void) | undefined;

    (async () => {
      try {
        const { getAuth, onAuthStateChanged } = await import('firebase/auth');
        const auth = getAuth();
        if (!isMounted) return;
        setUid(auth.currentUser?.uid ?? undefined);
        unsubscribe = onAuthStateChanged(auth, (u) => {
          if (!isMounted) return;
          setUid(u?.uid ?? undefined);
        });
      } catch (err) {
        console.warn('[StoreLayout] Firebase Auth is unavailable:', err);
      }
    })();

    return () => {
      isMounted = false;
      try {
        unsubscribe?.();
      } catch {
        /* ignore */
      }
    };
  }, [authEnabled]);

  // 営業前設定（端末/ユーザーごと）の購読値を使用。uid 未指定時はフォールバック。
  const { activePositionId: prePos, visibleTables: preTables } = usePreopenSettings(storeIdStr, { uid });
  const activePositionId = prePos ?? (settings.positions?.[0] ?? 'default');
  const visibleTables: string[] = Array.isArray(preTables) && preTables.length > 0 ? preTables : [];

  // 今日は 00:00〜23:59:59.999 を対象
  const todayRange = React.useMemo(() => getTodayRange(), []);

  // Reservation -> WaveSourceReservation[] （実データのキーに合わせて一本化）
  const mapReservation = React.useCallback<WaveReservationMapper>((r: any) => {
    // 期待する構造：
    // - r.startAt: ISO 文字列（例: "2025-09-13T19:00:00+09:00"）
    // - r.course.taskOffsetsMin: number[]（各タスクのオフセット[分]）
    // - r.tableNo: string | number
    // - r.positionId: string
    // - r.guests: number
    const base = Date.parse(r?.startAt as string);
    if (!Number.isFinite(base) || base <= 0) return null;

    const offsetsMin: number[] =
      (Array.isArray(r?.course?.taskOffsetsMin) && r.course.taskOffsetsMin.length
        ? r.course.taskOffsetsMin
        : [0]);

    const table = String(r?.tableNo ?? '');
    const position = String(r?.positionId ?? activePositionId ?? '');
    const guests = Number(r?.guests ?? 0) || 0;
    const courseName = String(r?.course?.name ?? '');

    return offsetsMin.map((m: number) => ({
      startMs: base + (Number(m) || 0) * 60_000,
      courseName,
      table,
      guests,
      position,
    }));
  }, [activePositionId]);

  // 実データの予約 → 波ソース
  const { data: rawWaveSource } = useWaveSourceReservations(storeIdStr, mapReservation);
  // 安定化メモ化：同値配列なら同一参照を返す（不要な再計算を抑制）
  const prevWaveRef = React.useRef<{ key: string; value: WaveSourceReservation[] } | null>(null);
  const waveSource = React.useMemo(() => {
    const src = ((rawWaveSource as WaveSourceReservation[]) ?? []).filter(Boolean);
    // 正規化
    const normalized: WaveSourceReservation[] = src.map((s) => ({
      startMs: Number((s as any).startMs) || 0,
      courseName: String((s as any).courseName ?? ''),
      table: String((s as any).table ?? ''),
      guests: Number((s as any).guests ?? 0) || 0,
      position: String((s as any).position ?? ''),
    }));
    // 並びを安定化（ソート）
    normalized.sort((a, b) => {
      if (a.startMs !== b.startMs) return a.startMs - b.startMs;
      if (a.table !== b.table) return a.table < b.table ? -1 : 1;
      if (a.position !== b.position) return a.position < b.position ? -1 : 1;
      if (a.guests !== b.guests) return a.guests - b.guests;
      if (a.courseName !== b.courseName) return a.courseName < b.courseName ? -1 : 1;
      return 0;
    });
    // キー化（安価な安定同値判定）
    const key = JSON.stringify(normalized);
    if (prevWaveRef.current && prevWaveRef.current.key === key) {
      return prevWaveRef.current.value;
    }
    // 同一参照を維持するために配列を固定
    const frozen = normalized.slice();
    prevWaveRef.current = { key, value: frozen };
    return frozen;
  }, [rawWaveSource]);

  // フィルタを通して WaveInputTask[] に（当日範囲に限定）
  const tasksForWave = React.useMemo(() => {
    const src = (waveSource as WaveSourceReservation[]) ?? [];
    // 当日範囲に限定してから、ポジション／卓でフィルタ
    const daySrc = src.filter(
      (s) =>
        s &&
        typeof s.startMs === 'number' &&
        s.startMs >= todayRange.startMs &&
        s.startMs <= todayRange.endMs
    );
    return selectWaveInputTasks(daySrc, {
      positionId: activePositionId,
      tables: visibleTables,
    });
  }, [waveSource, activePositionId, visibleTables, todayRange]);

  return (
    <MiniTaskProvider
      storeId={storeIdStr}
      settings={settings}
      activePositionId={activePositionId}
      visibleTables={visibleTables}
      todayRange={todayRange}
      tasksForWave={tasksForWave}
    >
      {/* 紺帯ヘッダーの右上にベルを重ねて表示 */}
      <div className="fixed right-0 top-0 h-12 w-0 z-[100]">
        <BellMenu />
      </div>

      {/* 既存画面は常に表示（下タブやサイドメニューを残す） */}
      {children}

    </MiniTaskProvider>
  );
}

function getTodayRange() {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
  return { startMs: start, endMs: end };
}
