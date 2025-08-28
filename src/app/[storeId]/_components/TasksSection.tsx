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

  // ---- タスクセクション: ビューポートに応じてスクロール領域を確保 ----
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [scrollMax, setScrollMax] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const update = () => {
      if (!scrollRef.current) return;
      const top = scrollRef.current.getBoundingClientRect().top;
      const h = window.innerHeight - top - 8; // 余白ぶん差し引き
      setScrollMax(Math.max(200, Math.floor(h)));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
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
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 80);
    return () => window.clearTimeout(handle);
    // 初回のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Normalize possibly-stale course filter that hides all reservations on reload
  React.useEffect(() => {
    const validNames = new Set(['全体', '未選択', ...courses.map((c) => c.name)]);
    if (!filterCourse || !validNames.has(filterCourse)) {
      setFilterCourse('全体');
    }
  }, [filterCourse, courses, setFilterCourse]);

  // ---- 表示フォールバック: グループが空でも予約が存在する場合は絞り込みを全体に戻す ----
  React.useEffect(() => {
    const hasGroups = Object.keys(deferredGroupedTasks ?? {}).length > 0;
    const hasReservations = (filteredReservations?.length ?? 0) > 0;
    if (!hasGroups && hasReservations) {
      if (!filterCourse || filterCourse === '未選択') {
        setFilterCourse('全体');
      }
    }
  }, [deferredGroupedTasks, filteredReservations, filterCourse, setFilterCourse]);

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
    <>
      {/* ───────── コントロールバー ───────── */}
      <section className="mt-20 space-y-3 text-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <label className="mb-1">コース絞り込み：</label>
            <select
              value={filterCourse && filterCourse.length ? filterCourse : '全体'}
              onChange={(e) => setFilterCourse(e.target.value)}
              className="border px-2 py-1 rounded text-sm"
            >
              <option value="全体">全体</option>
              {courses.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
              <option value="未選択">未選択</option>
            </select>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={showCourseAll}
                aria-checked={showCourseAll}
                onChange={(e) => setShowCourseAll(e.target.checked)}
              />
              <span>コース表示</span>
            </label>

            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={showGuestsAll}
                aria-checked={showGuestsAll}
                onChange={(e) => setShowGuestsAll(e.target.checked)}
              />
              <span>人数表示</span>
            </label>

            {showCourseAll && (
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={mergeSameTasks}
                  aria-checked={mergeSameTasks}
                  onChange={(e) => setMergeSameTasks(e.target.checked)}
                />
                <span>同一タスクはまとめて表示</span>
              </label>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="mr-1">タスク並び替え：</span>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="taskSort"
                value="table"
                checked={taskSort === 'table'}
                aria-checked={taskSort === 'table'}
                onChange={() => setTaskSort('table')}
              />
              卓番順
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="taskSort"
                value="guests"
                checked={taskSort === 'guests'}
                aria-checked={taskSort === 'guests'}
                onChange={() => setTaskSort('guests')}
              />
              人数順
            </label>
          </div>
        </div>
      </section>

      {/* ───────── タスク表本体 ───────── */}
      <div ref={scrollRef} className="overflow-y-auto overscroll-contain" style={{ maxHeight: scrollMax ? `${scrollMax}px` : undefined }}>
        <section className="space-y-4 text-sm touch-pan-y pr-1">
        {timeKeys.map((timeKey) => {
          // この時間帯が「15分以上前」かどうか（表示を薄くするために使用）
          const isPast15 = parseTimeToMinutes(timeKey) <= (nowMinutes - 15);

          return (
            <div key={timeKey} id={`task-time-${timeKey}`} className="border-b pb-2">
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
                                <div className="flex items-center justify-between gap-2 flex-wrap whitespace-normal w-full text-[12px]">
                                  <div className="inline-flex items-center gap-1">
                                    <span className="text-[11px] text-gray-600">対象：</span>
                                    <span className="text-[11px]">{`選択中（${shiftTargets.length}件）`}</span>
                                  </div>
                                  <div className="inline-flex items-center gap-1 ml-auto">
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
                                  <span className="text-xs text-gray-600">
                                    {selectedShiftMinutes !== null ? 'ずらす' : '分ずらす'}
                                  </span>
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
                                  }}
                                  className="px-2 py-0.5 bg-green-700 text-white rounded text-sm"
                                >
                                  完了登録
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
                                aria-label="完了一括選択モード"
                              >
                                選択完了
                              </button>
                            )}
                          </>
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
                              <div className="flex items-center justify-between gap-2 flex-wrap whitespace-normal w-full text-[12px]">
                                <div className="inline-flex items-center gap-1">
                                  <span className="text-[11px] text-gray-600">対象：</span>
                                  <span className="text-[11px]">{`選択中（${shiftTargets.length}件）`}</span>
                                </div>
                                <div className="inline-flex items-center gap-1 ml-auto">
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
                                <span className="text-xs text-gray-600">
                                  {selectedShiftMinutes !== null ? 'ずらす' : '分ずらす'}
                                </span>
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
                                }}
                                className="px-2 py-0.5 bg-green-700 text-white rounded text-sm"
                              >
                                完了登録
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
                              aria-label="完了一括選択モード"
                            >
                              選択完了
                            </button>
                          )}
                        </>
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
      </div>
    </>
  );
});

export default TasksSection;