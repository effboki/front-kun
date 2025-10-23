'use client';
import * as React from 'react';
import { useMiniTasks, type OverdueTaskItem } from '@/app/_providers/MiniTaskProvider';
import { getStoreId } from '@/lib/firebase';

/**
 * 右上ベル（紺帯ヘッダー用）
 * - 親ヘッダーに `relative` を付け、このコンポーネントは `absolute` で右上に出ます
 * - バッジ：未完了ミニタスク数
 * - ポップアップ：×で閉じるまで自動で閉じない
 * - 自動オープン：window.dispatchEvent(new CustomEvent('miniTasks:notify')) を受信
 * - a11y: aria-live polite / Escで閉じる / フォーカストラップ
 */
export default function BellMenu() {
  const {
    tasks,
    pendingCount,
    calmUntil,
    toggle,
    resetAll,
    overdueTasks,
    completeOverdueTask,
    completingTaskIds,
  } = useMiniTasks();
  const [open, setOpen] = React.useState(false);
  const [announce, setAnnounce] = React.useState<string>(''); // aria-live 用
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const titleRef = React.useRef<HTMLHeadingElement | null>(null);
  const [liveUntil, setLiveUntil] = React.useState<Date | null>(null);

  type TaskPrefs = { showCourseAll: boolean; mergeSameTasks: boolean; taskSort: 'table' | 'guests' };
  const readTaskPrefs = React.useCallback((): TaskPrefs => {
    if (typeof window === 'undefined') {
      return { showCourseAll: true, mergeSameTasks: false, taskSort: 'table' };
    }
    const ns = `front-kun-${getStoreId()}`;
    const pick = (suffix: string, fallback: string) => {
      try {
        return window.localStorage.getItem(`${ns}-${suffix}`) ?? fallback;
      } catch {
        return fallback;
      }
    };
    const showCourseAll = pick('tasks_showCourseAll', '1') === '1';
    const mergeSameTasks = pick('tasks_mergeSameTasks', '0') === '1';
    const sortRaw = pick('tasks_taskSort', 'table');
    const taskSort = sortRaw === 'guests' ? 'guests' : 'table';
    return { showCourseAll, mergeSameTasks, taskSort };
  }, []);

  const [taskPrefs, setTaskPrefs] = React.useState<TaskPrefs>(() => readTaskPrefs());
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => setTaskPrefs(readTaskPrefs());
    sync();
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      const ns = `front-kun-${getStoreId()}`;
      if (e.key.startsWith(`${ns}-tasks_`)) {
        sync();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sync();
    };
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [readTaskPrefs]);

  // 一覧は常に全件（完了も表示）。バッジはミニタスク未完了＋遅延タスク数
  const allTasks = tasks;
  const overdueCount = overdueTasks.length;
  const badge = pendingCount + overdueCount;
  const totalTasks = allTasks.length;
  const completedCount = totalTasks - pendingCount;
  const progressPercent = totalTasks === 0 ? 0 : Math.round((completedCount / totalTasks) * 100);
  const pendingTasks = React.useMemo(() => allTasks.filter(t => !t.done), [allTasks]);
  const completedTasks = React.useMemo(() => allTasks.filter(t => t.done), [allTasks]);
  const completingSet = React.useMemo(() => new Set(completingTaskIds), [completingTaskIds]);
  const groupedOverdueTasks = React.useMemo(() => {
    if (!overdueTasks.length) return [] as Array<{ key: string; start: string; end: string | null; tasks: OverdueTaskItem[] }>;
    const order: string[] = [];
    const map = new Map<string, { start: string; end: string | null; tasks: OverdueTaskItem[] }>();
    overdueTasks.forEach((task) => {
      const endKey = task.scheduledEndTime ?? '';
      const key = `${task.scheduledTime}__${endKey}`;
      if (!map.has(key)) {
        map.set(key, { start: task.scheduledTime, end: task.scheduledEndTime ?? null, tasks: [] });
        order.push(key);
      }
      map.get(key)!.tasks.push(task);
    });
    return order.map((key) => ({ key, ...map.get(key)! }));
  }, [overdueTasks]);

  const sortTasksForDisplay = React.useCallback(
    (list: OverdueTaskItem[]): OverdueTaskItem[] => {
      const arr = [...list];
      if (taskPrefs.taskSort === 'guests') {
        arr.sort((a, b) => {
          if (a.guests !== b.guests) return a.guests - b.guests;
          const ta = parseInt(a.tableLabel, 10);
          const tb = parseInt(b.tableLabel, 10);
          if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
          return a.tableLabel.localeCompare(b.tableLabel, 'ja');
        });
      } else {
        arr.sort((a, b) => {
          const ta = parseInt(a.tableLabel, 10);
          const tb = parseInt(b.tableLabel, 10);
          if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
          if (!Number.isNaN(ta) && Number.isNaN(tb)) return -1;
          if (Number.isNaN(ta) && !Number.isNaN(tb)) return 1;
          return a.tableLabel.localeCompare(b.tableLabel, 'ja');
        });
      }
      return arr;
    },
    [taskPrefs.taskSort]
  );

  const displayGroups = React.useMemo(() => {
    return groupedOverdueTasks.map((group) => {
      const labelMap = new Map<string, { label: string; color?: string; courseMap: Map<string, { courseName: string; tasks: OverdueTaskItem[] }> }>();
      group.tasks.forEach((task) => {
        const labelKey = task.taskLabel || '(不明)';
        let entry = labelMap.get(labelKey);
        if (!entry) {
          entry = { label: labelKey, color: task.taskColor, courseMap: new Map() };
          labelMap.set(labelKey, entry);
        }
        if (!entry.color && task.taskColor) entry.color = task.taskColor;
        const courseKey = task.courseName || '未選択';
        let courseEntry = entry.courseMap.get(courseKey);
        if (!courseEntry) {
          courseEntry = { courseName: courseKey, tasks: [] };
          entry.courseMap.set(courseKey, courseEntry);
        }
        courseEntry.tasks.push(task);
      });

      const items = Array.from(labelMap.values()).map((entry) => {
        let courseGroups = Array.from(entry.courseMap.values()).map((cg) => ({
          courseName: cg.courseName,
          tasks: sortTasksForDisplay(cg.tasks),
        }));

        if (taskPrefs.mergeSameTasks) {
          const flattened = sortTasksForDisplay(courseGroups.flatMap((cg) => cg.tasks));
          courseGroups = [{ courseName: taskPrefs.showCourseAll ? '全コース' : '', tasks: flattened }];
        } else if (!taskPrefs.showCourseAll) {
          const flattened = sortTasksForDisplay(courseGroups.flatMap((cg) => cg.tasks));
          courseGroups = [{ courseName: '', tasks: flattened }];
        }

        const totalGuests = courseGroups
          .flatMap((cg) => cg.tasks)
          .reduce((sum, t) => sum + t.guests, 0);

        return {
          label: entry.label,
          color: entry.color,
          courseGroups,
          totalGuests,
        };
      });

      return {
        key: group.key,
        start: group.start,
        end: group.end,
        items,
      };
    });
  }, [groupedOverdueTasks, sortTasksForDisplay, taskPrefs.mergeSameTasks, taskPrefs.showCourseAll]);

  // “ヒマ開始+delay”のアプリ内通知を受信して自動オープン
  React.useEffect(() => {
    const onNotify = (event: Event) => {
      setOpen(true);
      // 現在の推定で初期化（後続の miniTasks:update で上書きされる）
      setLiveUntil(calmUntil ?? null);
      const detail = (event as CustomEvent<{ reason?: string; tasks?: unknown[] }>).detail;
      if (detail?.reason === 'overdueTasks') {
        const count = Array.isArray(detail.tasks) ? detail.tasks.length : overdueCount;
        setAnnounce(count > 0 ? `完了待ちタスクが${count}件あります。` : '完了待ちタスクがあります。');
      } else {
        const u = calmUntil ?? null;
        const until = u ? formatTime(u) : null;
        setAnnounce(until ? `${until} まで落ち着く予定です（推定）。` : 'ミニタスク通知');
      }
      // 少し遅らせてフォーカス（描画完了後）
      requestAnimationFrame(() => titleRef.current?.focus());
    };
    window.addEventListener('miniTasks:notify', onNotify as EventListener);
    return () => window.removeEventListener('miniTasks:notify', onNotify as EventListener);
    // calmUntil が変わってもハンドラを貼り替える必要はないが、announce更新のため依存に含める
  }, [calmUntil, overdueCount]);

  // Calmウィンドウの延長/短縮：文面をライブ更新（再通知は出さない）
  React.useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ start: number; end: number }>).detail;
      if (!detail?.end) return;
      const d = new Date(detail.end);
      setLiveUntil(d);
      if (open) {
        setAnnounce(`${formatTime(d)} まで落ち着く予定です（推定）。`);
      }
    };
    window.addEventListener('miniTasks:update', onUpdate as EventListener);
    return () => window.removeEventListener('miniTasks:update', onUpdate as EventListener);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    if (overdueCount > 0) {
      setAnnounce(`完了待ちタスクが${overdueCount}件あります。`);
    } else if (calmUntil) {
      setAnnounce(`${formatTime(calmUntil)} まで落ち着く予定です（推定）。`);
    }
  }, [open, overdueCount, calmUntil]);

  const closeManually = () => {
    try { window.dispatchEvent(new CustomEvent('miniTasks:dismiss')); } catch {}
    setOpen(false);
    // 元のベルボタンにフォーカスを戻す
    triggerRef.current?.focus();
  };

  // フォーカストラップ & Esc 閉じ
  const onKeyDownDialog = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      closeManually();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = getFocusableElements();
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const ae = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (!ae || ae === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (!ae || ae === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const getFocusableElements = () => {
    const root = dialogRef.current;
    if (!root) return [] as HTMLElement[];
    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    return Array.from(root.querySelectorAll<HTMLElement>(selectors))
      .filter(el => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));
  };

  const dialogId = 'miniTasksDialog';
  const titleId = 'miniTasksDialogTitle';

  const displayUntil: Date | null = liveUntil ?? calmUntil;

  return (
    <div className="absolute right-2 top-1/2 -translate-y-1/2 z-50">
      {/* 画面読み上げ用のライブリージョン（通知時に読み上げ） */}
      <span className="sr-only" aria-live="polite">{announce}</span>

      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen(v => {
            const next = !v;
            if (next) {
              // 現在の推定で初期化しつつ、開いたら初期フォーカス
              setLiveUntil(calmUntil ?? null);
              requestAnimationFrame(() => titleRef.current?.focus());
            }
            return next;
          });
        }}
        aria-label="ミニタスク通知"
        aria-controls={dialogId}
        aria-expanded={open}
        className="relative grid place-items-center h-9 w-9 rounded-full border border-white/30 bg-white/10 text-white hover:bg-white/20 active:scale-[.98] focus:outline-none focus:ring-2 focus:ring-white/60"
      >
        {/* ベルアイコン */}
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
          <path d="M12 2a7 7 0 00-7 7v3.586l-1.707 1.707A1 1 0 004 16h16a1 1 0 00.707-1.707L19 12.586V9a7 7 0 00-7-7zm0 20a3 3 0 01-3-3h6a3 3 0 01-3 3z"/>
        </svg>
        {/* 未完了バッジ */}
        {badge > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.2rem] h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold grid place-items-center leading-none">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>

      {/* ポップアップ（×で閉じるまで勝手に閉じない） */}
      {open && (
        <div
          id={dialogId}
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="absolute right-0 mt-2 w-[20rem] max-w-[85vw] rounded-md border border-black/10 bg-white text-gray-800 shadow-2xl outline-none"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onKeyDownDialog}
        >
          <div className="flex items-start gap-2 p-3 border-b bg-yellow-50">
            <div className="mt-0.5" aria-hidden>🟡</div>
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className="text-sm leading-snug font-medium">
              {overdueCount > 0 ? (
                <span className="flex flex-col gap-1">
                  <span className="text-red-600">
                    完了待ちタスクが <strong>{overdueCount}</strong> 件あります。
                  </span>
                </span>
              ) : displayUntil ? (
                <span>
                  <strong>{formatTime(displayUntil)}</strong> まで落ち着く予定です（推定）。今のうちにミニタスクを進めましょう。
                </span>
              ) : (
                <span>現在のミニタスク</span>
              )}
            </h2>
            <button
              type="button"
              onClick={closeManually}
              className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded border bg-white hover:bg-gray-50"
              aria-label="閉じる"
              title="閉じる"
            >
              ×
            </button>
          </div>

          <div className="border-b bg-slate-50 px-3 py-3 space-y-3">
            {overdueCount === 0 && (
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] text-gray-600">
                現在、完了待ちのタスクはありません。ミニタスクは下のセクションをご確認ください。
              </div>
            )}
          </div>

          <div className="max-h-[60vh] overflow-auto px-3 py-3">
            <div className="space-y-6">
              {displayGroups.length > 0 && (
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-300 bg-amber-100 text-[10px] text-amber-700">
                      !
                    </span>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-700">
                      完了待ちタスク
                    </p>
                  </div>

                  {displayGroups.map((group) => (
                    <div key={group.key} className="space-y-3">
                      <div className="flex items-baseline gap-2 text-gray-600">
                        <span className="text-lg font-semibold text-gray-900">{group.start}</span>
                        {group.end && group.end !== group.start && (
                          <span className="text-sm text-gray-500">ー{group.end}</span>
                        )}
                      </div>

                      {group.items.map((item) => {
                        const cardBg = item.color && item.color.trim().length > 0 ? item.color : 'bg-white';
                        const totalGuests = item.totalGuests;
                        const itemTasks = item.courseGroups.flatMap((cg) => cg.tasks);
                        const isCompletingItem = itemTasks.some((task) => completingSet.has(task.id));

                        return (
                          <div
                            key={`${group.key}-${item.label}`}
                            className={`rounded-lg border border-gray-200 px-3 py-2 shadow-sm ${cardBg} border-l-4 border-l-rose-200`}
                          >
                            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                              <span>{item.label}</span>
                              {totalGuests > 0 && (
                                <span className="text-[11px] font-normal text-gray-600">（計{totalGuests}人）</span>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  itemTasks.forEach((task) => {
                                    if (!completingSet.has(task.id)) {
                                      void completeOverdueTask(task);
                                    }
                                  });
                                }}
                                disabled={isCompletingItem || itemTasks.length === 0}
                                className={`ml-auto inline-flex items-center justify-center rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                  isCompletingItem || itemTasks.length === 0
                                    ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
                                    : 'border-rose-200 bg-rose-500 text-white hover:bg-rose-600 active:bg-rose-700'
                                }`}
                              >
                                {isCompletingItem ? '処理中…' : '完了'}
                              </button>
                            </div>

                            <div className="mt-2 space-y-2">
                              {item.courseGroups.map((cg, idx) => {
                                const showCourseLabel = taskPrefs.showCourseAll && cg.courseName && cg.courseName.length > 0 && (!taskPrefs.mergeSameTasks || item.courseGroups.length > 1);
                                return (
                                  <div key={idx} className="space-y-1">
                                    {showCourseLabel && (
                                      <div className="text-[11px] font-medium text-gray-600">{cg.courseName}</div>
                                    )}
                                    <div className="flex flex-wrap gap-2">
                                      {cg.tasks.map((task) => (
                                        <span
                                          key={task.id}
                                          className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white/85 px-2 py-0.5 text-xs font-medium text-gray-800"
                                        >
                                          <span>{task.tableLabel}</span>
                                          <span className="text-gray-500">({task.guests})</span>
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </section>
              )}

              <section className="rounded-md border border-slate-200 bg-white px-3 py-3 space-y-3">
                <div className="flex items-center text-sm font-semibold text-slate-700">
                  <span>ミニタスク</span>
                  <span className="ml-auto text-[12px] font-normal text-gray-500">
                    {completedCount}/{totalTasks} 完了
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-200" aria-hidden>
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-gray-500">残り {pendingCount} 件</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (completedCount === 0) return;
                      resetAll();
                    }}
                    disabled={completedCount === 0}
                    className={`ml-auto rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                      completedCount === 0
                        ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-100 active:bg-slate-200'
                    }`}
                    title="完了済みをすべて未完了に戻します"
                  >
                    完了をリセット
                  </button>
                </div>

                {allTasks.length === 0 ? (
                  <div className="rounded-md border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-500">
                    ミニタスクはありません。
                  </div>
                ) : (
                  <div className="space-y-3 border-t border-dashed border-gray-200 pt-3">
                    {pendingTasks.length > 0 ? (
                      <div>
                        {completedTasks.length > 0 && (
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">未完了</p>
                        )}
                        <ul className="space-y-1">
                          {pendingTasks.map((t) => (
                            <li
                              key={t.id}
                              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 shadow-sm hover:bg-slate-50"
                            >
                              <input
                                id={`mt-${t.id}`}
                                type="checkbox"
                                checked={!!t.done}
                                onChange={(e) => toggle(t.id, e.currentTarget.checked)}
                                className="h-5 w-5"
                              />
                              <label
                                htmlFor={`mt-${t.id}`}
                                className="flex-1 truncate text-sm text-slate-800"
                              >
                                {t.label}
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                        すべて完了しました。お疲れさまです！
                      </div>
                    )}

                    {completedTasks.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          完了済み
                        </p>
                        <ul className="space-y-1">
                          {completedTasks.map((t) => (
                            <li
                              key={t.id}
                              className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-500"
                            >
                              <input
                                id={`mt-${t.id}`}
                                type="checkbox"
                                checked={!!t.done}
                                onChange={(e) => toggle(t.id, e.currentTarget.checked)}
                                className="h-5 w-5"
                              />
                              <label
                                htmlFor={`mt-${t.id}`}
                                className="flex-1 truncate text-sm text-slate-500 line-through"
                              >
                                {t.label}
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function formatTime(d: Date) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
