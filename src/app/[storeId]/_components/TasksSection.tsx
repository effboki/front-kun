'use client';

import React from 'react';
// NOTE: For further performance on very large lists,
// consider replacing the simple .map over reservations with a
// virtualized horizontal list (e.g., react-window FixedSizeList).
// The new <TaskPill /> is isolated and can be used as the row renderer.
type TaskPillProps = {
  id: string;
  table: string;
  guests: number;
  compKey: string; // completion key for this pill
  completedMap?: Record<string, boolean>;
  showTableStart: boolean;
  showGuestsAll: boolean;

  // selection / shift states
  keyForTask: string;
  shiftModeKey: string | null;
  selectionModeTask: string | null;
  shiftTargets: string[];
  selectedForComplete: string[];
  isFirstRotating: boolean;

  // handlers
  onToggleShiftTarget: (id: string) => void;
  onToggleSelectComplete: (id: string) => void;
};

const TaskPill: React.FC<TaskPillProps> = React.memo(
  ({
    id,
    table,
    guests,
    compKey,
    completedMap,
    showTableStart,
    showGuestsAll,
    keyForTask,
    shiftModeKey,
    selectionModeTask,
    shiftTargets,
    selectedForComplete,
    isFirstRotating,
    onToggleShiftTarget,
    onToggleSelectComplete,
  }) => {
    const currentDone = Boolean(completedMap?.[compKey]);
    const previewDone =
      selectionModeTask === keyForTask && selectedForComplete.includes(id)
        ? !currentDone
        : currentDone;

    const isShiftTarget = shiftModeKey === keyForTask && shiftTargets.includes(id);
    const isSelectTarget =
      selectionModeTask === keyForTask && selectedForComplete.includes(id);

    const handleClick = () => {
      if (shiftModeKey === keyForTask) {
        onToggleShiftTarget(id);
        return;
      }
      if (selectionModeTask === keyForTask) {
        onToggleSelectComplete(id);
      }
    };

    return (
      <div
        onClick={handleClick}
        className={`border px-1.5 py-0.5 rounded text-xs ${
          previewDone ? 'opacity-70 text-gray-600 line-through' : ''
        } ${isShiftTarget ? 'ring-2 ring-blue-400' : ''} ${
          isSelectTarget ? 'ring-2 ring-yellow-400' : ''
        } ${isFirstRotating ? 'text-red-500' : ''}`}
        role={shiftModeKey === keyForTask ? 'checkbox' : undefined}
        aria-checked={shiftModeKey === keyForTask ? isShiftTarget : undefined}
      >
        {shiftModeKey === keyForTask && (
          <span
            className={`inline-block mr-1 h-3 w-3 border rounded-sm text-[10px] leading-3 text-center ${
              isShiftTarget ? 'bg-blue-600 text-white border-blue-600' : 'bg-white'
            }`}
            aria-hidden
          >
            {isShiftTarget ? '✓' : ''}
          </span>
        )}
        {showTableStart && table}
        {showGuestsAll && <>({guests})</>}
      </div>
    );
  }
);
import type { Reservation, CourseDef, ViewData, UiState } from '@/types';


export type TaskSort = 'table' | 'guests';

type TaskCourseGroup = { courseName: string; reservations: Reservation[] };
type TaskGroup = { label: string; bgColor: string; courseGroups: TaskCourseGroup[] };
type GroupedTasks = Record<string, TaskGroup[]>;

// ViewModel breakdown（親型から Pick で再利用）
export type TasksDataVM = Pick<
  ViewData,
  'groupedTasks' | 'sortedTimeKeys' | 'courses' | 'filteredReservations' | 'firstRotatingId'
>;

export type TasksUiVM = Pick<
  UiState,
  | 'filterCourse'
  | 'showCourseAll'
  | 'showGuestsAll'
  | 'mergeSameTasks'
  | 'taskSort'
  | 'showTableStart'
  | 'selectionModeTask'
  | 'shiftModeKey'
  | 'selectedForComplete'
  | 'shiftTargets'
>;

export type TasksActionsVM = {
  setFilterCourse: React.Dispatch<React.SetStateAction<string>>;
  setShowCourseAll: React.Dispatch<React.SetStateAction<boolean>>;
  setShowGuestsAll: React.Dispatch<React.SetStateAction<boolean>>;
  setMergeSameTasks: React.Dispatch<React.SetStateAction<boolean>>;
  setTaskSort: React.Dispatch<React.SetStateAction<TaskSort>>;
  setShiftModeKey: React.Dispatch<React.SetStateAction<string | null>>;
  setShiftTargets: React.Dispatch<React.SetStateAction<string[]>>;
  batchAdjustTaskTime: (ids: string[], taskLabel: string, deltaMinutes: number) => void;
  setSelectionModeTask: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedForComplete: React.Dispatch<React.SetStateAction<string[]>>;
  updateReservationField: (
    id: string,
    field: 'completed',
    value: Record<string, boolean>
  ) => void;
};

export type TasksSectionProps = {
  data: TasksDataVM;
  ui: TasksUiVM;
  actions: TasksActionsVM;
};

const parseTimeToMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

const TasksSection: React.FC<TasksSectionProps> = React.memo((props) => {
  const { data, ui, actions } = props;

  const {
    groupedTasks,
    sortedTimeKeys,
    courses,
    filteredReservations,
    firstRotatingId,
  } = data;

  // Defer large groupedTasks updates to keep UI responsive when filters change
  const deferredGroupedTasks = React.useDeferredValue(groupedTasks);

  const {
    filterCourse,
    showCourseAll,
    showGuestsAll,
    mergeSameTasks,
    taskSort,
    shiftModeKey,
    selectionModeTask,
    showTableStart,
    shiftTargets,
    selectedForComplete,
  } = ui;

  const {
    setFilterCourse,
    setShowCourseAll,
    setShowGuestsAll,
    setMergeSameTasks,
    setTaskSort,
    setShiftModeKey,
    setShiftTargets,
    batchAdjustTaskTime,
    setSelectionModeTask,
    setSelectedForComplete,
    updateReservationField,
  } = actions;

  // ---- 時間変更：1ボタントグル + クイックメニュー（±15/10/5） ----
  const [openShiftMenuFor, setOpenShiftMenuFor] = React.useState<string | null>(null);
  const [minutePickerOpenFor, setMinutePickerOpenFor] = React.useState<string | null>(null);
  const [selectedShiftMinutes, setSelectedShiftMinutes] = React.useState<number | null>(null);

  // 完了一括適用のヒント表示（0件で適用を押した時など）
  const [completeApplyHint, setCompleteApplyHint] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!completeApplyHint) return;
    const t = setTimeout(() => setCompleteApplyHint(null), 2500);
    return () => clearTimeout(t);
  }, [completeApplyHint]);

  // ---- 二重スクロール対策: 最寄りのスクロール親を無効化（ページ全体でスクロール） ----
  const hostRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const root = hostRef.current;
    if (!root) return;
    const isScrollable = (el: HTMLElement) => {
      const st = window.getComputedStyle(el);
      return /(auto|scroll)/.test(st.overflowY) || /(auto|scroll)/.test(st.overflow);
    };
    let el = root.parentElement as HTMLElement | null;
    while (el && el !== document.body) {
      if (isScrollable(el)) {
        // 内側スクロールを無効化（外側＝ページ全体のみスクロール）
        el.style.overflow = 'visible';
        el.style.overflowY = 'visible';
        el.style.maxHeight = 'none';
        break;
      }
      el = el.parentElement as HTMLElement | null;
    }
  }, []);


  const handleQuickShift = React.useCallback(
    (ids: string[], taskLabel: string, deltaMinutes: number) => {
      batchAdjustTaskTime(ids, taskLabel, deltaMinutes);
      // 実行後はメニューとモードを閉じる
      setOpenShiftMenuFor(null);
      setMinutePickerOpenFor(null);
      setShiftModeKey(null);
      setShiftTargets([]);
      setSelectedShiftMinutes(null);
    },
    [batchAdjustTaskTime, setShiftModeKey, setShiftTargets, setSelectedShiftMinutes]
  );

  // ---- 現在時刻（分）を1分ごとに更新して、過去タスクの薄表示やスクロール基準に使う ----
  const [nowMinutes, setNowMinutes] = React.useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  React.useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const timeKeys =
    sortedTimeKeys ??
    React.useMemo(
      () =>
        Object.keys(deferredGroupedTasks).sort(
          (a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b)
        ),
      [deferredGroupedTasks]
    );

  // ---- 初回表示時：これからの最初の時間帯へスクロール（なければ最後） ----
  React.useEffect(() => {
    if (!timeKeys || timeKeys.length === 0) return;
    const firstUpcoming = timeKeys.find((t) => parseTimeToMinutes(t) >= nowMinutes);
    const targetKey = firstUpcoming ?? timeKeys[timeKeys.length - 1];
    const handle = window.setTimeout(() => {
      const el = document.getElementById(`task-time-${targetKey}`);
      const ctrl = document.getElementById('tasks-toolbar');
      const stickyOffset = (ctrl?.offsetHeight ?? 64) + 8; // control height + small gap
      if (el) {
        const rect = el.getBoundingClientRect();
        const y = rect.top + window.scrollY - stickyOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }, 80);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Normalize possibly-stale course filter that hides all reservations on reload
  const didNormalizeFilterRef = React.useRef(false);
  React.useEffect(() => {
    if (didNormalizeFilterRef.current) return; // run only once at mount to normalize
    const validNames = new Set(['全て', '未選択', ...courses.map((c) => c.name)]);
    if (!filterCourse || !validNames.has(filterCourse)) {
      didNormalizeFilterRef.current = true;
      setFilterCourse('全て');
    }
  }, [courses]);

  // ---- 表示フォールバック: グループが空でも予約が存在する場合は絞り込みを全体に戻す ----
  const didCoerceFilterRef = React.useRef(false);
  React.useEffect(() => {
    if (didCoerceFilterRef.current) return; // coerce only once per mount if needed
    const hasGroups = Object.keys(deferredGroupedTasks ?? {}).length > 0;
    const hasReservations = (filteredReservations?.length ?? 0) > 0;
    if (!hasGroups && hasReservations) {
      if (!filterCourse || filterCourse === '未選択') {
        didCoerceFilterRef.current = true;
        setFilterCourse('全て');
      }
    }
  }, [deferredGroupedTasks, filteredReservations, filterCourse]);

  const onToggleShiftTarget = React.useCallback(
    (id: string) => {
      setShiftTargets(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      );
    },
    [setShiftTargets]
  );

  const onToggleSelectComplete = React.useCallback(
    (id: string) => {
      setSelectedForComplete(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      );
    },
    [setSelectedForComplete]
  );

  return (
    <section id="tasks-root" ref={hostRef} className="w-full pb-2 mb-0">
      {/* ───────── コントロールバー ───────── */}
      <div
        id="tasks-toolbar"
        className="sticky top-0 inset-x-0 z-40 bg-white/95 supports-[backdrop-filter]:bg-white/70 backdrop-blur border-b-2 border-gray-200/80 shadow px-3 pt-3 pb-3"
      >
        <div className="max-w-full">
          {/* 表示：コース表示／人数表示（1段目） */}
          <div className="mt-0">
            <div className="grid grid-cols-[auto,1fr] items-center gap-x-2 gap-y-1">
              <span className="text-xs text-gray-600 shrink-0">表示：</span>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-1 text-xs select-none">
                  <input
                    type="checkbox"
                    className="accent-blue-600"
                    checked={showCourseAll}
                    onChange={(e) => setShowCourseAll(e.target.checked)}
                    aria-label="コースを表示する"
                  />
                  コースを表示
                </label>
                <label className="flex items-center gap-1 text-xs select-none">
                  <input
                    type="checkbox"
                    className="accent-blue-600"
                    checked={showGuestsAll}
                    onChange={(e) => setShowGuestsAll(e.target.checked)}
                    aria-label="人数を表示する"
                  />
                  人数表示
                </label>
              </div>

              {/* 2行目：コース表示ONのときだけ出す（同一名まとめ） */}
              {showCourseAll && (
                <>
                  <span className="text-xs text-transparent select-none">表示：</span>
                  <label className="flex items-center gap-1 text-xs select-none">
                    <input
                      type="checkbox"
                      className="accent-blue-600"
                      checked={mergeSameTasks}
                      onChange={(e) => setMergeSameTasks(e.target.checked)}
                      aria-label="同一名のタスクはまとめて表示"
                    />
                    同一名のタスクはまとめて表示
                  </label>
                </>
              )}
            </div>
          </div>

          {/* 並び替え：左／ コース：右寄せ（同じ行） */}
          <div className="mt-3 flex items-center justify-between gap-2 whitespace-nowrap">
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-[11px] text-gray-600 shrink-0">並び替え：</span>
              <div className="inline-flex rounded border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setTaskSort('table')}
                  className={`px-2 py-0.5 text-[11px] ${taskSort === 'table' ? 'bg-blue-600 text-white' : 'bg-white'}`}
                  aria-pressed={taskSort === 'table'}
                >
                  卓番順
                </button>
                <button
                  type="button"
                  onClick={() => setTaskSort('guests')}
                  className={`px-2 py-0.5 text-[11px] border-l ${taskSort === 'guests' ? 'bg-blue-600 text-white' : 'bg-white'}`}
                  aria-pressed={taskSort === 'guests'}
                >
                  人数順
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-[11px] text-gray-600 shrink-0">コース：</span>
             <select
  value={filterCourse && filterCourse.length ? filterCourse : '全て'}
  onChange={(e) => setFilterCourse(e.target.value)}
  className="border px-1 py-0.5 rounded text-[10px] w-[5.75rem]"
  aria-label="コースを絞り込み"
>
                <option value="全て">全て</option>
                {courses.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
                <option value="未選択">未選択</option>
              </select>
            </div>
          </div>
        </div>
      </div>
      {/* ───────── スペーサー（sticky直後のかぶり防止） ───────── */}
      <div className="h-3" />

      {/* ───────── タスク表本体 ───────── */}
        <section className="space-y-4 text-sm touch-pan-y">
        {timeKeys.map((timeKey) => {
          // この時間帯が「15分以上前」かどうか（表示を薄くするために使用）
          const isPast15 = parseTimeToMinutes(timeKey) <= (nowMinutes - 15);

          return (
            <div
              key={timeKey}
              id={`task-time-${timeKey}`}
              className="border-b pb-2 last:border-b-0 last:pb-0"
            >
              <div className="text-gray-900 font-semibold text-lg mb-2">{timeKey}</div>

            {/* まとめ表示 ON */}
            {mergeSameTasks ? (
              (() => {
                type Collected = {
                  label: string;
                  bgColor: string;
                  allReservations: Reservation[];
                };
                const collectMap: Record<string, Collected> = {};
                (deferredGroupedTasks[timeKey] ?? []).forEach((tg) => {
                  const allRes = tg.courseGroups.flatMap((cg) => cg.reservations ?? []);
                  if (!collectMap[tg.label]) {
                    collectMap[tg.label] = {
                      label: tg.label,
                      bgColor: tg.bgColor,
                      allReservations: allRes,
                    };
                  } else {
                    collectMap[tg.label].allReservations.push(...allRes);
                  }
                });
                const collectArr = Object.values(collectMap).sort((a, b) =>
                  a.label.localeCompare(b.label)
                );

                return collectArr.map((ct) => {
                  const keyForTask = `${timeKey}_${ct.label}`;
                  const sortedArr =
                    taskSort === 'guests'
                      ? ct.allReservations.slice().sort((a, b) => a.guests - b.guests)
                      : ct.allReservations
                          .slice()
                          .sort((a, b) => Number(a.table) - Number(b.table));

                  // isPast15: 15分以上前の時間帯
                  // const isPast15 = parseTimeToMinutes(timeKey) <= (nowMinutes - 15); // removed duplicate
                  return (
                    <div key={ct.label} className={`p-2 rounded mb-2 ${ct.bgColor} ${isPast15 ? 'opacity-70' : ''}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">{ct.label}</span>
                        {shiftModeKey !== keyForTask && selectionModeTask !== keyForTask && (
                          <span className="text-xs text-gray-600">
                            （計{sortedArr.reduce((sum, r) => sum + (r.guests ?? 0), 0)}人）
                          </span>
                        )}
                        {/* 時間変更モード（選択モード中は非表示） */}
                        {selectionModeTask !== keyForTask && (
                          <>
                            {shiftModeKey !== keyForTask && (
                            <button
                              onClick={() => {
                                const isOpen = openShiftMenuFor === keyForTask;
                                if (isOpen) {
                                  setOpenShiftMenuFor(null);
                                  setMinutePickerOpenFor(null);
                                  setShiftModeKey(null);
                                  setShiftTargets([]);
                                  setSelectedShiftMinutes(null);
                                } else {
                                  setOpenShiftMenuFor(keyForTask);
                                  setMinutePickerOpenFor(null); // デフォルトは閉じた状態（分選択は開かない）
                                  setShiftModeKey(keyForTask);
                                  setShiftTargets([]);                // 対象は毎回リセット（必要に応じて外してOK）
                                  setSelectedShiftMinutes(null);      // ★毎回リセット
                                }
                              }}
                              className="ml-auto px-2 py-0.5 bg-gray-300 rounded text-xs"
                              aria-label="時間変更"
                              aria-expanded={openShiftMenuFor === keyForTask}
                            >
                              時間変更
                            </button>
                            )}

                            {openShiftMenuFor === keyForTask && (
                              <div className="ml-2 mt-1 p-2 border rounded bg-gray-50 relative">
                                {/* 1段目：対象／適用／キャンセル */}
                                <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap w-full text-[11px]">
                                  <div className="inline-flex items-center gap-1 shrink-0">
                                    <span className="text-[11px] text-gray-600">対象：</span>
                                    <span className="text-[11px]">{`選択中（${shiftTargets.length}件）`}</span>
                                  </div>
                                  <div className="inline-flex items-center gap-1 ml-auto shrink-0">
                                    <button
                                      onClick={() => {
                                        if (selectedShiftMinutes === null) return;
                                        if (shiftTargets.length === 0) return;
                                        handleQuickShift(shiftTargets, ct.label, selectedShiftMinutes);
                                      }}
                                      className={`px-2 py-0.5 rounded text-[11px] text-white ${
                                        selectedShiftMinutes === null || shiftTargets.length === 0
                                          ? 'bg-gray-300 cursor-not-allowed opacity-60'
                                          : 'bg-blue-600 hover:bg-blue-700'
                                      }`}
                                      disabled={selectedShiftMinutes === null || shiftTargets.length === 0}
                                    >
                                      適用
                                    </button>
                                    <button
                                      onClick={() => {
                                        setOpenShiftMenuFor(null);
                                        setMinutePickerOpenFor(null);
                                        setShiftModeKey(null);
                                        setShiftTargets([]);
                                        setSelectedShiftMinutes(null);
                                      }}
                                      className="px-2 py-0.5 bg-gray-400 text-white rounded text-[11px]"
                                    >
                                      キャンセル
                                    </button>
                                  </div>
                                </div>
                                {/* 2段目：分選択（横一文） */}
                                <div className="mt-2 flex items-center gap-2 whitespace-nowrap overflow-visible">
                                  <span className="text-xs text-gray-600">タスク時間を</span>
                                  <div className="relative inline-block">
                                    <button
                                      onClick={() =>
                                        setMinutePickerOpenFor((prev) => (prev === keyForTask ? null : keyForTask))
                                      }
                                      className="px-2 py-0.5 bg-white border rounded text-xs"
                                      aria-expanded={minutePickerOpenFor === keyForTask}
                                      aria-haspopup="listbox"
                                    >
                                      {selectedShiftMinutes !== null
                                        ? `${selectedShiftMinutes > 0 ? '＋' : ''}${selectedShiftMinutes}分`
                                        : '未選択'}
                                    </button>
                                    {minutePickerOpenFor === keyForTask && (
                                      <div
                                        className="absolute left-0 md:left-auto md:right-0 z-30 mt-1 p-1 bg-white border rounded shadow grid grid-cols-3 gap-1 min-w-[9rem] max-w-[90vw]"
                                        role="listbox"
                                      >
                                        {[-15, -10, -5, 5, 10, 15].map((m) => (
                                          <button
                                            key={m}
                                            onClick={() => {
                                              setSelectedShiftMinutes(m);
                                              setMinutePickerOpenFor(null);
                                            }}
                                            className="px-2 py-1 rounded text-xs hover:bg-gray-100 border text-center"
                                            role="option"
                                            aria-selected={selectedShiftMinutes === m}
                                          >
                                            {m > 0 ? `＋${m}` : `${m}`}分
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <span className="text-xs text-gray-600">ずらす</span>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                        {/* 完了一括登録（選択モード） */}
                        {shiftModeKey !== keyForTask && (
                          <>
                            {selectionModeTask === keyForTask ? (
                              <div className="ml-auto flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    if (selectedForComplete.length === 0) {
                                      setCompleteApplyHint('① 完了したい卓をタップで選ぶ\n② 「適用」を押す');
                                      return;
                                    }
                                    selectedForComplete.forEach((resId) => {
                                      const courseName =
                                        filteredReservations.find((r) => r.id === resId)?.course || '';
                                      const compKey = `${timeKey}_${ct.label}_${courseName}`;
                                      const prevCompleted =
                                        filteredReservations.find((r) => r.id === resId)?.completed || {};
                                      const next = {
                                        ...prevCompleted,
                                        [compKey]: !Boolean(prevCompleted[compKey]),
                                      };
                                      updateReservationField(resId, 'completed', next);
                                    });
                                    setSelectionModeTask(null);
                                    setSelectedForComplete([]);
                                    setCompleteApplyHint('適用しました（取り消す場合は再度タップで選択 → 適用）');
                                  }}
                                  className={`px-2 py-0.5 rounded text-sm text-white ${
                                    selectedForComplete.length === 0
                                      ? 'bg-blue-300 cursor-not-allowed'
                                      : 'bg-blue-600 hover:bg-blue-700'
                                  }`}
                                >
                                  適用
                                </button>
                                <button
                                  onClick={() =>
                                    setSelectionModeTask((prev) =>
                                      prev === keyForTask ? null : keyForTask
                                    )
                                  }
                                  className="px-2 py-0.5 bg-gray-400 text-white rounded text-xs"
                                  aria-pressed
                                  aria-label="完了一括選択モードをキャンセル"
                                >
                                  キャンセル
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() =>
                                  setSelectionModeTask((prev) =>
                                    prev === keyForTask ? null : keyForTask
                                  )
                                }
                                className="ml-2 px-2 py-0.5 bg-yellow-500 text-white rounded text-sm"
                                aria-pressed={false}
                                aria-label="完了を選ぶモード"
                              >
                                完了
                              </button>
                            )}
                          </>
                        )}
                      {/* 完了一括適用ヒント（まとめ表示ON/選択モードのみ表示） */}
                      {selectionModeTask === keyForTask && completeApplyHint && (
                        <div className="mt-1 text-[11px] text-blue-700 whitespace-pre-line">{completeApplyHint}</div>
                      )}
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {sortedArr.map((r) => (
                          <TaskPill
                            key={r.id}
                            id={r.id}
                            table={String(r.table)}
                            guests={r.guests}
                            compKey={`${timeKey}_${ct.label}_${r.course}`}
                            completedMap={r.completed}
                            showTableStart={showTableStart}
                            showGuestsAll={showGuestsAll}
                            keyForTask={keyForTask}
                            shiftModeKey={shiftModeKey}
                            selectionModeTask={selectionModeTask}
                            shiftTargets={shiftTargets}
                            selectedForComplete={selectedForComplete}
                            isFirstRotating={firstRotatingId[r.table] === r.id}
                            onToggleShiftTarget={onToggleShiftTarget}
                            onToggleSelectComplete={onToggleSelectComplete}
                          />
                        ))}
                      </div>
                    </div>
                  );
                });
              })()
            ) : (
              // まとめ表示 OFF：従来表示
              (deferredGroupedTasks[timeKey] ?? []).map((tg) => {
                const keyForTask = `${timeKey}_${tg.label}`;
                const renderCourseGroups = showCourseAll
                  ? tg.courseGroups
                  : [
                      {
                        courseName: '(all)',
                        reservations: tg.courseGroups.flatMap((cg) => cg.reservations),
                      },
                    ];

                // isPast15: 15分以上前の時間帯
                // const isPast15 = parseTimeToMinutes(timeKey) <= (nowMinutes - 15); // removed duplicate
                return (
                  <div key={tg.label} className={`p-2 rounded mb-2 ${tg.bgColor} ${isPast15 ? 'opacity-70' : ''}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{tg.label}</span>
                      {shiftModeKey !== keyForTask && selectionModeTask !== keyForTask && (
                        <span className="text-xs text-gray-600">
                          （計{
                            (renderCourseGroups.flatMap((g) => g.reservations) ?? []).reduce(
                              (sum, r) => sum + (r?.guests ?? 0),
                              0
                            )
                          }人）
                        </span>
                      )}
                      {/* 時間変更モード（選択モード中は非表示） */}
                      {selectionModeTask !== keyForTask && (
                        <>
                          {shiftModeKey !== keyForTask && (
                            <button
                              onClick={() => {
                                const isOpen = openShiftMenuFor === keyForTask;
                                if (isOpen) {
                                  setOpenShiftMenuFor(null);
                                  setMinutePickerOpenFor(null);
                                  setShiftModeKey(null);
                                  setShiftTargets([]);
                                  setSelectedShiftMinutes(null);
                                } else {
                                  setOpenShiftMenuFor(keyForTask);
                                  setMinutePickerOpenFor(null); // デフォルトは閉じた状態（分選択は開かない）
                                  setShiftModeKey(keyForTask);
                                  setShiftTargets([]);                // 対象は毎回リセット（必要に応じて外してOK）
                                  setSelectedShiftMinutes(null);      // ★毎回リセット
                                }
                              }}
                              className="ml-auto px-2 py-0.5 bg-gray-300 rounded text-xs"
                              aria-label="時間変更"
                              aria-expanded={openShiftMenuFor === keyForTask}
                            >
                              時間変更
                            </button>
                          )}

                          {openShiftMenuFor === keyForTask && (
                            <div className="ml-2 mt-1 p-2 border rounded bg-gray-50 relative">
                              {/* 1段目：対象／適用／キャンセル */}
                              <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap w-full text-[11px]">
                                <div className="inline-flex items-center gap-1 shrink-0">
                                  <span className="text-[11px] text-gray-600">対象：</span>
                                  <span className="text-[11px]">{`選択中（${shiftTargets.length}件）`}</span>
                                </div>
                                <div className="inline-flex items-center gap-1 ml-auto shrink-0">
                                  <button
                                    onClick={() => {
                                      if (selectedShiftMinutes === null) return;
                                      if (shiftTargets.length === 0) return;
                                      handleQuickShift(shiftTargets, tg.label, selectedShiftMinutes);
                                    }}
                                    className={`px-2 py-0.5 rounded text-[11px] text-white ${
                                      selectedShiftMinutes === null || shiftTargets.length === 0
                                        ? 'bg-gray-300 cursor-not-allowed opacity-60'
                                        : 'bg-blue-600 hover:bg-blue-700'
                                    }`}
                                    disabled={selectedShiftMinutes === null || shiftTargets.length === 0}
                                  >
                                    適用
                                  </button>
                                  <button
                                    onClick={() => {
                                      setOpenShiftMenuFor(null);
                                      setMinutePickerOpenFor(null);
                                      setShiftModeKey(null);
                                      setShiftTargets([]);
                                      setSelectedShiftMinutes(null);
                                    }}
                                    className="px-2 py-0.5 bg-gray-400 text-white rounded text-[11px]"
                                  >
                                    キャンセル
                                  </button>
                                </div>
                              </div>
                              {/* 2段目：分選択（横一文） */}
                              <div className="mt-2 flex items-center gap-2 whitespace-nowrap overflow-visible">
                                <span className="text-xs text-gray-600">タスク時間を</span>
                                <div className="relative inline-block">
                                  <button
                                    onClick={() =>
                                      setMinutePickerOpenFor((prev) => (prev === keyForTask ? null : keyForTask))
                                    }
                                    className="px-2 py-0.5 bg-white border rounded text-xs"
                                    aria-expanded={minutePickerOpenFor === keyForTask}
                                    aria-haspopup="listbox"
                                  >
                                    {selectedShiftMinutes !== null
                                      ? `${selectedShiftMinutes > 0 ? '＋' : ''}${selectedShiftMinutes}分`
                                      : '未選択'}
                                  </button>
                                  {minutePickerOpenFor === keyForTask && (
                                    <div
                                      className="absolute left-0 md:left-auto md:right-0 z-30 mt-1 p-1 bg-white border rounded shadow grid grid-cols-3 gap-1 min-w-[9rem] max-w-[90vw]"
                                      role="listbox"
                                    >
                                      {[-15, -10, -5, 5, 10, 15].map((m) => (
                                        <button
                                          key={m}
                                          onClick={() => {
                                            setSelectedShiftMinutes(m);
                                            setMinutePickerOpenFor(null);
                                          }}
                                          className="px-2 py-1 rounded text-xs hover:bg-gray-100 border text-center"
                                          role="option"
                                          aria-selected={selectedShiftMinutes === m}
                                        >
                                          {m > 0 ? `＋${m}` : `${m}`}分
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <span className="text-xs text-gray-600">ずらす</span>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      {shiftModeKey !== keyForTask && (
                        <>
                          {selectionModeTask === keyForTask ? (
                            <div className="ml-auto flex items-center gap-2">
                              <button
                                onClick={() => {
                                  if (selectedForComplete.length === 0) {
                                    setCompleteApplyHint('① 完了したい卓をタップで選ぶ\n② 「適用」を押す');
                                    return;
                                  }
                                  selectedForComplete.forEach((resId) => {
                                    const courseName =
                                      filteredReservations.find((r) => r.id === resId)?.course || '';
                                    const compKey = `${timeKey}_${tg.label}_${courseName}`;
                                    const prevCompleted =
                                      filteredReservations.find((r) => r.id === resId)?.completed || {};
                                    const next = {
                                      ...prevCompleted,
                                      [compKey]: !Boolean(prevCompleted[compKey]),
                                    };
                                    updateReservationField(resId, 'completed', next);
                                  });
                                  setSelectionModeTask(null);
                                  setSelectedForComplete([]);
                                  setCompleteApplyHint('適用しました（取り消す場合は再度タップで選択 → 適用）');
                                }}
                                className={`px-2 py-0.5 rounded text-sm text-white ${
                                  selectedForComplete.length === 0
                                    ? 'bg-blue-300 cursor-not-allowed'
                                    : 'bg-blue-600 hover:bg-blue-700'
                                }`}
                              >
                                適用
                              </button>
                              <button
                                onClick={() =>
                                  setSelectionModeTask((prev) =>
                                    prev === keyForTask ? null : keyForTask
                                  )
                                }
                                className="px-2 py-0.5 bg-gray-400 text-white rounded text-xs"
                                aria-pressed
                                aria-label="完了一括選択モードをキャンセル"
                              >
                                キャンセル
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() =>
                                setSelectionModeTask((prev) =>
                                  prev === keyForTask ? null : keyForTask
                                )
                              }
                              className="ml-2 px-2 py-0.5 bg-yellow-500 text-white rounded text-sm"
                              aria-pressed={false}
                              aria-label="完了を選ぶモード"
                            >
                              完了
                            </button>
                          )}
                        </>
                      )}

                      {/* 完了一括適用ヒント（まとめ表示OFF/選択モードのみ表示） */}
                      {selectionModeTask === keyForTask && completeApplyHint && (
                        <div className="mt-1 text-[11px] text-blue-700 whitespace-pre-line">{completeApplyHint}</div>
                      )}
                    </div>

                    {renderCourseGroups.map((cg) => {
                      const sortedArr =
                        taskSort === 'guests'
                          ? cg.reservations.slice().sort((a, b) => a.guests - b.guests)
                          : cg.reservations
                              .slice()
                              .sort((a, b) => Number(a.table) - Number(b.table));

                      return (
                        <div key={cg.courseName} className="mb-1">
                          {showCourseAll && (
                            <div className="mb-1.5 flex items-center gap-2">
                              <span aria-hidden className="h-3 w-1.5 rounded bg-sky-400" />
                              <span className="text-[13px] font-medium text-gray-800">
                                {cg.courseName}
                              </span>
                              <span className="text-[12px] text-gray-500">
                                （計{cg.reservations.reduce((sum, r) => sum + (r?.guests ?? 0), 0)}人）
                              </span>
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1.5">
                            {sortedArr.map((r) => (
                              <TaskPill
                                key={r.id}
                                id={r.id}
                                table={String(r.table)}
                                guests={r.guests}
                                compKey={`${timeKey}_${tg.label}_${showCourseAll ? cg.courseName : r.course}`}
                                completedMap={r.completed}
                                showTableStart={showTableStart}
                                showGuestsAll={showGuestsAll}
                                keyForTask={keyForTask}
                                shiftModeKey={shiftModeKey}
                                selectionModeTask={selectionModeTask}
                                shiftTargets={shiftTargets}
                                selectedForComplete={selectedForComplete}
                                isFirstRotating={firstRotatingId[r.table] === r.id}
                                onToggleShiftTarget={onToggleShiftTarget}
                                onToggleSelectComplete={onToggleSelectComplete}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
            </div>
          );
        })}

        {timeKeys.length === 0 && (
          <div className="text-center text-gray-500">表示するタスクはありません。</div>
        )}
        </section>
    </section>
  );
});

export default TasksSection;    