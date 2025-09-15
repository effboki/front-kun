'use client';
/**
 * MiniTaskProvider
 * - 波(忙しさ)計算 → Calmウィンドウ抽出
 * - 当日のミニタスク完了共有(購読/更新)
 * - 右上ベル用の tasks / pendingCount / calmUntil / toggle を供給
 * - Calm開始+notifyDelay にアプリ内通知(CustomEvent)を発火
 */

import * as React from 'react';
import type { ReactNode } from 'react';

import type { StoreSettingsValue } from '@/types/settings';
import { DEFAULT_WAVE } from '@/types/settings';
import { computeCalmAdaptive, type WaveInputTask } from '@/lib/wave';
import { getMyMiniTaskTemplates, toInstances, countPending, yyyymmdd } from '@/lib/miniTasks';
import { subscribeDoneSet, setDone } from '@/lib/firebase/miniTasks';

// ===== Context =====
export type MiniTaskItem = { id: string; label: string; done?: boolean };
type Ctx = {
  tasks: MiniTaskItem[];
  pendingCount: number;
  calmUntil: Date | null;
  toggle: (id: string, done: boolean) => void;
};
const MiniTaskContext = React.createContext<Ctx>({
  tasks: [],
  pendingCount: 0,
  calmUntil: null,
  toggle: () => {},
});
export const useMiniTasks = () => React.useContext(MiniTaskContext);

// ---- Notification helper ----
const NOTI_LS_KEY = 'miniTasks:notifyPermAsked';
function formatHHmm(input: number | Date) {
  const d = typeof input === 'number' ? new Date(input) : input;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ---- Telemetry & Dedup helpers ----
const NOTIFIED_LS_KEY = 'miniTasks:notifiedWindowIds';
const DISMISSED_LS_KEY = 'miniTasks:dismissedWindowIds';

function makeWindowId(win: { start: number; end: number }, positionId: string, tables: string[]) {
  // position + tables + start/end で一意に
  const sortedTables = [...(tables ?? [])].map(String).sort().join(',');
  return `win:${positionId}|${sortedTables}|${win.start}|${win.end}`;
}
function loadIdSet(key: string): Set<string> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((x) => typeof x === 'string'));
    return new Set();
  } catch {
    return new Set();
  }
}
function saveIdSet(key: string, set: Set<string>) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {}
}

// ===== Provider =====
export function MiniTaskProvider(props: {
  children: ReactNode;
  storeId: string;
  settings: StoreSettingsValue;               // ensureStoreSettingsDefaults 済みを推奨
  activePositionId: string;
  visibleTables: string[];
  todayRange: { startMs: number; endMs: number };
  tasksForWave: WaveInputTask[];              // タスク表から供給：確定時刻/人数/ポジション/卓
  autoNotify?: boolean;                       // Calm開始+delayで自動オープン（既定 true）
}) {
  const {
    children,
    storeId,
    settings,
    activePositionId,
    visibleTables,
    todayRange,
    tasksForWave,
    autoNotify = true,
  } = props;

  // ---- 完了集合の購読 ----
  const [doneSet, setDoneSet] = React.useState<Set<string>>(new Set());
  const dayKey = React.useMemo(() => yyyymmdd(), []);
  React.useEffect(() => {
    if (!storeId || !dayKey) return;
    const unsub = subscribeDoneSet(storeId, dayKey, (set) => setDoneSet(set));
    return () => unsub?.();
  }, [storeId, dayKey]);

  // ---- ミニタスク（自分のポジションのみ） ----
  const templates = React.useMemo(
    () => getMyMiniTaskTemplates(settings, activePositionId),
    [settings, activePositionId]
  );
  // NOTE:
  // toInstances(...) はテンプレ全件（active=true のみ）を返し、doneSet に含まれる id に done=true を付与するだけ。
  // 「完了済みだから除外」はしない（UI 側で取り消し線表示に留める）。
  const instances = React.useMemo(
    () => toInstances(templates, doneSet),
    [templates, doneSet]
  );
  // バッジ用: 未完了件数。UI側のバッジはこの値（pendingCount）をそのまま表示します。
  const pendingCount = React.useMemo(() => countPending(instances), [instances]);

  // ---- 波 → Calm抽出 ----
  const waveCfg = settings.wave ?? DEFAULT_WAVE;
  const { windows } = React.useMemo(() => {
    const range = { startMs: todayRange.startMs, endMs: todayRange.endMs };
    const waveParams = {
      threshold: waveCfg.threshold,
      bucketMinutes: waveCfg.bucketMinutes,
      minCalmMinutes: 15, // 固定
    };
    const filter = { positionId: activePositionId, visibleTables: visibleTables ?? [] as string[] };
    return computeCalmAdaptive(tasksForWave, range, waveParams, filter, {
      mode: 'hybrid',
      percentile: waveCfg.percentile,
      maxRatio: waveCfg.maxRatio,
    });
  }, [tasksForWave, todayRange.startMs, todayRange.endMs, waveCfg.threshold, waveCfg.bucketMinutes, waveCfg.percentile, waveCfg.maxRatio, activePositionId, visibleTables]);

  const calmUntil = React.useMemo<Date | null>(() => {
    if (!windows?.length) return null;
    // 最初の CalmWindow の終了時刻を表示（「〜まで落ち着く予定」）
    return new Date(windows[0].end);
  }, [windows]);

  // ---- Calmウィンドウの延長/短縮をライブ通知（重複通知は増やさず、文面だけ更新） ----
  const lastCalmRef = React.useRef<{ start: number; end: number } | null>(null);
  React.useEffect(() => {
    // 最新の CalmWindow を取得（先頭を採用）
    const w = Array.isArray(windows) && windows.length > 0 ? windows[0] : null;
    const prev = lastCalmRef.current;
    if (!w) {
      lastCalmRef.current = null;
      return;
    }
    // 同じ start のまま end が変化したら更新イベントを発火
    if (prev && prev.start === w.start && prev.end !== w.end) {
      try {
        window.dispatchEvent(new CustomEvent('miniTasks:update', {
          detail: { start: w.start, end: w.end }
        }));
      } catch {}
    }
    // 最新の CalmWindow を保持
    lastCalmRef.current = { start: w.start, end: w.end };
  }, [windows]);

  // ---- Calm開始 + notifyDelay でアプリ内通知（×で閉じるまで閉じない想定） ----
  const notifyTimerRef = React.useRef<number | null>(null);
  const lastNotifiedWinStartRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!autoNotify) return;
    // 既存タイマーをクリア
    if (notifyTimerRef.current) {
      window.clearTimeout(notifyTimerRef.current);
      notifyTimerRef.current = null;
    }
    if (!windows?.length) return;

    const first = windows[0];
    // ウィンドウID（去重用）
    const windowId = makeWindowId(first, activePositionId, visibleTables ?? []);
    // すでに通知済みならスキップ（永続去重）
    const notifiedSet = loadIdSet(NOTIFIED_LS_KEY);
    if (notifiedSet.has(windowId)) return;

    // 同一ウィンドウへは去重
    if (lastNotifiedWinStartRef.current === first.start) return;

    const now = Date.now();
    const delayMs = 3 * 60_000; // 固定3分
    const fireAt = first.start + delayMs;
    const wait = Math.max(0, fireAt - now);

    notifyTimerRef.current = window.setTimeout(() => {
      lastNotifiedWinStartRef.current = first.start;
      // 永続去重：この CalmWindow は通知済みにする
      try {
        notifiedSet.add(windowId);
        saveIdSet(NOTIFIED_LS_KEY, notifiedSet);
      } catch {}
      // テレメトリ（任意）：通知発火イベントを投げる
      try {
        window.dispatchEvent(new CustomEvent('miniTasks:telemetry', {
          detail: { type: 'notify', windowId, start: first.start, end: first.end, at: Date.now() }
        }));
      } catch {}
      // アプリ内通知（BellMenu側で window 'miniTasks:notify' を拾って自動オープン）
      window.dispatchEvent(new CustomEvent('miniTasks:notify'));

      // --- 任意: ブラウザ通知（フォアグラウンド時はベルのみでOKなので hidden 時のみ発火） ---
      try {
        if (typeof window !== 'undefined' && 'Notification' in window) {
          const isVisible = document.visibilityState === 'visible';
          if (!isVisible) {
            const until = formatHHmm(first.end);
            const title = `${until} まで落ち着く予定です（推定）`;
            const body = '今のうちにミニタスクを進めましょう。';

            if (Notification.permission === 'granted') {
              new Notification(title, { body });
            } else if (Notification.permission === 'default') {
              // 初回のみ permission をリクエスト
              const asked = (typeof localStorage !== 'undefined') && localStorage.getItem(NOTI_LS_KEY);
              if (!asked) {
                Notification.requestPermission().then((perm) => {
                  try { localStorage.setItem(NOTI_LS_KEY, '1'); } catch {}
                  if (perm === 'granted') {
                    new Notification(title, { body });
                  }
                }).catch(() => {});
              }
            }
          }
        }
      } catch {}
    }, wait) as unknown as number;

    return () => {
      if (notifyTimerRef.current) {
        window.clearTimeout(notifyTimerRef.current);
        notifyTimerRef.current = null;
      }
    };
  }, [autoNotify, windows]);

  // ---- 任意: ダイアログを手動で閉じたイベント（BellMenu 側で発火）を記録 ----
  React.useEffect(() => {
    const onDismiss = (e: Event) => {
      try {
        const detail = (e as CustomEvent<{ windowId?: string }>).detail;
        const win = windows?.[0];
        const id = detail?.windowId ?? (win ? makeWindowId(win, activePositionId, visibleTables ?? []) : null);
        if (!id) return;
        const dismissed = loadIdSet(DISMISSED_LS_KEY);
        dismissed.add(id);
        saveIdSet(DISMISSED_LS_KEY, dismissed);
        window.dispatchEvent(new CustomEvent('miniTasks:telemetry', {
          detail: { type: 'dismiss', windowId: id, at: Date.now() }
        }));
      } catch {}
    };
    window.addEventListener('miniTasks:dismiss', onDismiss as EventListener);
    return () => {
      window.removeEventListener('miniTasks:dismiss', onDismiss as EventListener);
    };
  }, [windows, activePositionId, visibleTables]);

  // ---- トグル（完了/戻す） ----
  const toggle = React.useCallback((id: string, done: boolean) => {
    if (!storeId) return;
    setDone(storeId, dayKey, id, done);
  }, [storeId, dayKey]);

  const value = React.useMemo(() => ({
    tasks: instances,
    pendingCount,
    calmUntil,
    toggle,
  }), [instances, pendingCount, calmUntil, toggle]);

  return (
    <MiniTaskContext.Provider value={value}>
      {children}
    </MiniTaskContext.Provider>
  );
}