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

import type { StoreSettingsValue, MiniTaskTemplate, CourseTask } from '@/types/settings';
import { DEFAULT_WAVE } from '@/types/settings';
import { computeCalmAdaptive, type WaveInputTask } from '@/lib/wave';
import { getMyMiniTaskTemplates, toInstances, countPending, yyyymmdd } from '@/lib/miniTasks';
import { subscribeDoneSet, setDone } from '@/lib/firebase/miniTasks';
import { DEFAULT_POSITION_LABEL } from '@/constants/positions';
import { useReservationsData } from '@/hooks/useReservationsData';
import { formatMinutesToTime, parseTimeToMinutes, resolveScheduleAnchorMs } from '@/lib/time';
import { updateReservationFS } from '@/lib/reservations';

// ===== Context =====
export type MiniTaskItem = { id: string; label: string; done?: boolean };
export type OverdueTaskItem = {
  id: string;
  reservationId: string;
  compKey: string;
  tableLabel: string;
  taskLabel: string;
  courseName: string;
  scheduledTime: string;
  scheduledMs: number;
  overdueMinutes: number;
  scheduledEndTime?: string | null;
  guests: number;
  taskColor?: string;
};
type Ctx = {
  tasks: MiniTaskItem[];
  pendingCount: number;
  calmUntil: Date | null;
  toggle: (id: string, done: boolean) => void;
  resetAll: () => void;
  overdueTasks: OverdueTaskItem[];
  completeOverdueTask: (task: OverdueTaskItem) => Promise<void>;
  completingTaskIds: string[];
};
const MiniTaskContext = React.createContext<Ctx>({
  tasks: [],
  pendingCount: 0,
  calmUntil: null,
  toggle: () => {},
  resetAll: () => {},
  overdueTasks: [],
  completeOverdueTask: async () => {},
  completingTaskIds: [],
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
  selectedPositionId?: string | null;
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
    selectedPositionId,
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

  const normalizedSelectedPositionId =
    typeof selectedPositionId === 'string' ? selectedPositionId.trim() : '';

  const reservationsDayStartMs = React.useMemo(
    () => resolveScheduleAnchorMs(settings.schedule?.dayStartHour),
    [settings.schedule?.dayStartHour]
  );

  const { reservations, setReservations } = useReservationsData(storeId, {
    courses: settings.courses,
    dayStartMs: reservationsDayStartMs,
    schedule: settings.schedule,
  });

  const courseTaskMap = React.useMemo(() => {
    const map = new Map<string, CourseTask[]>();
    const courses = Array.isArray(settings.courses) ? settings.courses : [];
    courses.forEach((course) => {
      if (!course || typeof course.name !== 'string') return;
      const tasks = Array.isArray(course.tasks) ? (course.tasks as CourseTask[]) : [];
      map.set(course.name, tasks);
    });
    return map;
  }, [settings.courses]);

  const fallbackTemplates = React.useMemo(() => {
    const map = settings.miniTasksByPosition ?? {};
    const orderedPositions = Array.isArray(settings.positions) ? settings.positions : [];
    const seen = new Set<string>();
    const combined: MiniTaskTemplate[] = [];

    const appendFrom = (pos: string | undefined) => {
      if (!pos) return;
      const list = getMyMiniTaskTemplates(settings, pos);
      list.forEach((task) => {
        if (seen.has(task.id)) return;
        seen.add(task.id);
        combined.push(task);
      });
    };

    orderedPositions.forEach((pos) => appendFrom(pos));
    Object.keys(map).forEach((pos) => {
      if (orderedPositions.includes(pos)) return;
      appendFrom(pos);
    });

    return combined;
  }, [settings]);

  // ---- ミニタスク（自分のポジションのみ） ----
  const templates = React.useMemo(() => {
    const map = settings.miniTasksByPosition ?? {};
    const selectedKey = normalizedSelectedPositionId;
    if (selectedKey && Object.prototype.hasOwnProperty.call(map, selectedKey)) {
      return getMyMiniTaskTemplates(settings, selectedKey);
    }
    if (!selectedKey) {
      return fallbackTemplates;
    }
    // 選択値が未登録の場合はフォールバック（未選択と同様に全件表示）
    return fallbackTemplates;
  }, [settings, normalizedSelectedPositionId, fallbackTemplates]);
  // NOTE:
  // toInstances(...) はテンプレ全件（active=true のみ）を返し、doneSet に含まれる id に done=true を付与するだけ。
  // 「完了済みだから除外」はしない（UI 側で取り消し線表示に留める）。
  const instances = React.useMemo(
    () => toInstances(templates, doneSet),
    [templates, doneSet]
  );
  // バッジ用: 未完了件数。UI側のバッジはこの値（pendingCount）をそのまま表示します。
  const pendingCount = React.useMemo(() => countPending(instances), [instances]);

  const [nowMs, setNowMs] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const tick = () => setNowMs(Date.now());
    const id = window.setInterval(tick, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    tick();
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const overdueTasks = React.useMemo<OverdueTaskItem[]>(() => {
    if (!Array.isArray(reservations) || reservations.length === 0) return [];
    const thresholdMs = nowMs - 10 * 60_000;
    const dayStartMs = todayRange.startMs;
    const items: OverdueTaskItem[] = [];

    reservations.forEach((res) => {
      if (!res) return;
      if ((res as any).departed) return;
      const courseName = typeof res.course === 'string' ? res.course : '';
      if (!courseName || !courseTaskMap.has(courseName)) return;
      const tasks = courseTaskMap.get(courseName) ?? [];
      if (!tasks.length) return;

      const tables = Array.isArray(res.tables)
        ? res.tables.map((t: any) => String(t).trim()).filter(Boolean)
        : [];
      const primaryTable = String(res.table ?? tables[0] ?? '').trim();

      const baseMinutes = (() => {
        if (typeof res.time === 'string' && res.time.trim()) {
          return parseTimeToMinutes(res.time);
        }
        if (Number.isFinite(res.startMs)) {
          return Math.round((Number(res.startMs) - dayStartMs) / 60_000);
        }
        return null;
      })();
      if (baseMinutes == null) return;

      tasks.forEach((task) => {
        if (!task || typeof task.timeOffset !== 'number') return;
        const offset = Number(task.timeOffset) || 0;
        const shiftRaw = (res.timeShift ?? {})[task.label];
        const shift =
          typeof shiftRaw === 'number' && Number.isFinite(shiftRaw) ? shiftRaw : 0;
        const scheduledMinutes = baseMinutes + offset + shift;
        if (!Number.isFinite(scheduledMinutes)) return;
        const baseStartMs = Number((res as any).startMs);
        const scheduledMs = Number.isFinite(baseStartMs)
          ? baseStartMs + (offset + shift) * 60_000
          : dayStartMs + scheduledMinutes * 60_000;
        if (!Number.isFinite(scheduledMs)) return;
        if (scheduledMs > thresholdMs) return;

        const timeKey = formatMinutesToTime(scheduledMinutes);
        const endOffset =
          typeof task.timeOffsetEnd === 'number' ? task.timeOffsetEnd : task.timeOffset;
        const endMinutes = baseMinutes + endOffset + shift;
        const scheduledEndTime = Number.isFinite(endMinutes)
          ? formatMinutesToTime(endMinutes)
          : null;
        const compKey = `${timeKey}_${task.label}_${courseName}`;
        if ((res.completed ?? {})[compKey]) return;

        const overdueMinutes = Math.floor((nowMs - scheduledMs) / 60_000);
        const tableLabel =
          primaryTable || (tables.length ? tables.join(', ') : '卓未設定');
        const guestsCount = Number.isFinite(Number(res.guests))
          ? Math.max(0, Math.trunc(Number(res.guests)))
          : 0;

        items.push({
          id: `${res.id}__${compKey}`,
          reservationId: res.id,
          compKey,
          tableLabel,
          taskLabel: task.label,
          courseName,
          scheduledTime: timeKey,
          scheduledMs,
          overdueMinutes,
          scheduledEndTime,
          guests: guestsCount,
          taskColor:
            typeof (task as any)?.bgColor === 'string' && (task as any).bgColor.trim().length > 0
              ? (task as any).bgColor
              : undefined,
        });
      });
    });

    items.sort((a, b) => {
      if (a.scheduledMs !== b.scheduledMs) return a.scheduledMs - b.scheduledMs;
      if (a.tableLabel !== b.tableLabel) {
        return a.tableLabel.localeCompare(b.tableLabel, 'ja');
      }
      return a.taskLabel.localeCompare(b.taskLabel, 'ja');
    });

    return items;
  }, [reservations, courseTaskMap, nowMs, todayRange.startMs]);

  const notifiedOverdueRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const notified = notifiedOverdueRef.current;
    const currentIds = new Set(overdueTasks.map((task) => task.id));
    notified.forEach((id) => {
      if (!currentIds.has(id)) {
        notified.delete(id);
      }
    });
    const newlyOverdue = overdueTasks.filter((task) => !notified.has(task.id));
    if (newlyOverdue.length > 0) {
      newlyOverdue.forEach((task) => notified.add(task.id));
      try {
        window.dispatchEvent(
          new CustomEvent('miniTasks:notify', {
            detail: {
              reason: 'overdueTasks',
              tasks: newlyOverdue.map((task) => ({
                reservationId: task.reservationId,
                table: task.tableLabel,
                taskLabel: task.taskLabel,
                scheduledTime: task.scheduledTime,
              })),
            },
          })
        );
      } catch {
        /* ignore */
      }
    }
  }, [overdueTasks]);

  const [completingMap, setCompletingMap] = React.useState<Record<string, boolean>>({});
  const completeOverdueTask = React.useCallback(
    async (task: OverdueTaskItem) => {
      const uniqueId = task.id;
      setCompletingMap((prev) => ({ ...prev, [uniqueId]: true }));

      let previous: { existed: boolean; value: boolean } | null = null;
      setReservations((prev) =>
        prev.map((res) => {
          if (res.id !== task.reservationId) return res;
          const prevCompleted = res.completed ? { ...res.completed } : {};
          previous = {
            existed: Object.prototype.hasOwnProperty.call(prevCompleted, task.compKey),
            value: Boolean(prevCompleted[task.compKey]),
          };
          prevCompleted[task.compKey] = true;
          return { ...res, completed: prevCompleted };
        })
      );

      try {
        await updateReservationFS(task.reservationId, { [`completed.${task.compKey}`]: true });
      } catch (err) {
        console.error('[MiniTaskProvider] completeOverdueTask failed:', err);
        if (previous) {
          setReservations((prev) =>
            prev.map((res) => {
              if (res.id !== task.reservationId) return res;
              const prevCompleted = res.completed ? { ...res.completed } : {};
              if (previous?.existed) {
                prevCompleted[task.compKey] = previous.value;
              } else {
                delete prevCompleted[task.compKey];
              }
              return { ...res, completed: prevCompleted };
            })
          );
        }
      } finally {
        setCompletingMap((prev) => {
          const next = { ...prev };
          delete next[uniqueId];
          return next;
        });
      }
    },
    [setReservations]
  );

  const completingTaskIds = React.useMemo(
    () => Object.keys(completingMap).filter((key) => completingMap[key]),
    [completingMap]
  );

  // ---- 波 → Calm抽出 ----
  const waveCfg = settings.wave ?? DEFAULT_WAVE;
  const { windows } = React.useMemo(() => {
    const range = { startMs: todayRange.startMs, endMs: todayRange.endMs };
    const waveParams = {
      threshold: waveCfg.threshold,
      bucketMinutes: waveCfg.bucketMinutes,
      minCalmMinutes: 15, // 固定
    };
    const shouldFilterByPosition =
      normalizedSelectedPositionId.length > 0 &&
      normalizedSelectedPositionId !== DEFAULT_POSITION_LABEL;
    const filter = {
      positionId: shouldFilterByPosition ? normalizedSelectedPositionId : null,
      visibleTables: visibleTables ?? ([] as string[]),
    };
    return computeCalmAdaptive(tasksForWave, range, waveParams, filter, {
      mode: 'hybrid',
      percentile: waveCfg.percentile,
      maxRatio: waveCfg.maxRatio,
    });
  }, [tasksForWave, todayRange.startMs, todayRange.endMs, waveCfg.threshold, waveCfg.bucketMinutes, waveCfg.percentile, waveCfg.maxRatio, normalizedSelectedPositionId, visibleTables]);

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

  const resetAll = React.useCallback(() => {
    if (!storeId || doneSet.size === 0) return;
    const ids = Array.from(doneSet);
    ids.forEach((id) => {
      setDone(storeId, dayKey, id, false);
    });
  }, [storeId, dayKey, doneSet]);

  const value = React.useMemo(() => ({
    tasks: instances,
    pendingCount,
    calmUntil,
    toggle,
    resetAll,
    overdueTasks,
    completeOverdueTask,
    completingTaskIds,
  }), [
    instances,
    pendingCount,
    calmUntil,
    toggle,
    resetAll,
    overdueTasks,
    completeOverdueTask,
    completingTaskIds,
  ]);

  return (
    <MiniTaskContext.Provider value={value}>
      {children}
    </MiniTaskContext.Provider>
  );
}
