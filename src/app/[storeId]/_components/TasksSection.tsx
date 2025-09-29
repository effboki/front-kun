'use client';

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Reservation, ViewData, UiState, AreaDef } from '@/types';
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

const TaskPill = memo(function TaskPill({
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
}: TaskPillProps) {
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
      className={`border px-2 py-1 rounded text-sm ${
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
});
export type TaskSort = 'table' | 'guests';

// ViewModel breakdown（親型から Pick で再利用）
export type TasksDataVM = Pick<
  ViewData,
  'groupedTasks' | 'sortedTimeKeys' | 'filteredReservations' | 'firstRotatingId'
>;

export type TasksUiVM = Pick<
  UiState,
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
  setShowCourseAll: Dispatch<SetStateAction<boolean>>;
  setShowGuestsAll: Dispatch<SetStateAction<boolean>>;
  setMergeSameTasks: Dispatch<SetStateAction<boolean>>;
  setTaskSort: Dispatch<SetStateAction<TaskSort>>;
  setShiftModeKey: Dispatch<SetStateAction<string | null>>;
  setShiftTargets: Dispatch<SetStateAction<string[]>>;
  batchAdjustTaskTime: (ids: string[], taskLabel: string, deltaMinutes: number) => void;
  setSelectionModeTask: Dispatch<SetStateAction<string | null>>;
  setSelectedForComplete: Dispatch<SetStateAction<string[]>>;
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
  // NEW: タスク表のエリア絞り込み（親管理）
  filterArea: string; // '全て' | '未割当' | areaId
  setFilterArea: Dispatch<SetStateAction<string>>;
  // エリア定義（セレクト用・任意）
  areas?: AreaDef[];
  // 親がフィルタ済みの予約配列を渡す場合に使用（任意、未使用でもOK）
  reservations?: Reservation[];
  // Optional: 親が永続化した並び順を渡す場合に使用（未指定なら内部/既存uiを利用）
  taskSort?: TaskSort;
  setTaskSort?: Dispatch<SetStateAction<TaskSort>>;
};

const parseTimeToMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

// Ensure guest counts are treated as numbers (avoid string concatenation in totals)
const toGuests = (g: number | string | null | undefined): number => {
  const n = typeof g === 'number' ? g : Number(g);
  return Number.isFinite(n) ? n : 0;
};

const TasksSection = memo(function TasksSection(props: TasksSectionProps) {
  const { data, ui, actions } = props;

  // 並び順の参照優先度: props.taskSort > ui.taskSort > 内部state
  const [innerTaskSort, setInnerTaskSort] = useState<TaskSort>('table');
  const curTaskSort: TaskSort = props.taskSort ?? ui.taskSort ?? innerTaskSort;
  const onChangeTaskSort: Dispatch<SetStateAction<TaskSort>> =
    props.setTaskSort ?? actions.setTaskSort ?? setInnerTaskSort;

  const { groupedTasks, sortedTimeKeys, filteredReservations, firstRotatingId } = data;

  // Defer large groupedTasks updates to keep UI responsive when filters change
  const deferredGroupedTasks = useDeferredValue(groupedTasks);

  const {
    showCourseAll,
    showGuestsAll,
    mergeSameTasks,
    shiftModeKey,
    selectionModeTask,
    showTableStart,
    shiftTargets,
    selectedForComplete,
  } = ui;

  const {
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

  const { filterArea, setFilterArea, areas = [] } = props;

  // iボタン（説明ポップ）開閉状態
  const [openInfo, setOpenInfo] = useState<null | 'course' | 'merge' | 'guests'>(null);
  const toggleInfo = (k: 'course' | 'merge' | 'guests') =>
    setOpenInfo((prev) => (prev === k ? null : k));

  // ヘルプポップオーバー（shift/complete）
  const [taskHelp, setTaskHelp] = useState<null | 'shift' | 'complete'>(null);

  // ---- 時間変更：1ボタントグル + クイックメニュー（±15/10/5） ----
  const [openShiftMenuFor, setOpenShiftMenuFor] = useState<string | null>(null);
  const [minutePickerOpenFor, setMinutePickerOpenFor] = useState<string | null>(null);
  const [selectedShiftMinutes, setSelectedShiftMinutes] = useState<number | null>(null);

  // ---- 二重スクロール対策: 最寄りのスクロール親を無効化（ページ全体でスクロール） ----
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
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

  // ---- 完了一括の適用ヒント（2.5秒で自動消滅） ----
  const [completeApplyHint, setCompleteApplyHint] = useState<string | null>(null);
  useEffect(() => {
    if (!completeApplyHint) return;
    const t = window.setTimeout(() => setCompleteApplyHint(null), 2500);
    return () => window.clearTimeout(t);
  }, [completeApplyHint]);


  const handleQuickShift = useCallback(
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
  const [nowMinutes, setNowMinutes] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const fallbackTimeKeys = useMemo(
    () =>
      Object.keys(deferredGroupedTasks).sort(
        (a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b)
      ),
    [deferredGroupedTasks]
  );

  const timeKeys = sortedTimeKeys ?? fallbackTimeKeys;

  // ---- 初回表示時：これからの最初の時間帯へスクロール（なければ最後） ----
  useEffect(() => {
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

  // Normalize possibly-stale area filter that could hide all reservations on reload
  const didNormalizeAreaFilterRef = useRef(false);
  useEffect(() => {
    if (didNormalizeAreaFilterRef.current) return; // run only once at mount
    const valid = new Set<string>(['全て', '未割当', ...areas.map((a) => a.id)]);
    if (!filterArea || !valid.has(filterArea)) {
      didNormalizeAreaFilterRef.current = true;
      setFilterArea('全て');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas]);

  // ---- 表示フォールバック: グループが空でも予約が存在する場合はエリア絞り込みを全体に戻す ----
  const didCoerceAreaFilterRef = useRef(false);
  useEffect(() => {
    if (didCoerceAreaFilterRef.current) return; // coerce only once per mount if needed
    const hasGroups = Object.keys(deferredGroupedTasks ?? {}).length > 0;
    const hasReservations = (filteredReservations?.length ?? 0) > 0;
    if (!hasGroups && hasReservations) {
      if (!filterArea || filterArea === '未割当') {
        didCoerceAreaFilterRef.current = true;
        setFilterArea('全て');
      }
    }
  }, [deferredGroupedTasks, filteredReservations, filterArea, setFilterArea]);

  const onToggleShiftTarget = useCallback(
    (id: string) => {
      setShiftTargets(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      );
    },
    [setShiftTargets]
  );

  const onToggleSelectComplete = useCallback(
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
          {/* 表示：縦配置（コース→同一名まとめ→人数） */}
          <div className="mt-0">
            <div className="grid grid-cols-[auto,1fr] items-start gap-x-2 gap-y-1">
              <span className="text-xs text-gray-600 shrink-0">表示：</span>
              <div className="flex flex-col gap-1">
                {/* コースを表示 */}
                <div className="flex flex-col gap-0.5">
                  <label className="flex items-center gap-1 text-xs select-none">
                    <input
                      type="checkbox"
                      className="accent-blue-600"
                      checked={showCourseAll}
                      onChange={(e) => setShowCourseAll(e.target.checked)}
                      aria-label="コースを表示する"
                    />
                    コースを表示
                    <button
                      type="button"
                      onClick={() => toggleInfo('course')}
                      className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full border border-gray-300 text-[10px] leading-4 text-gray-600 hover:bg-gray-50"
                      aria-label="『コースを表示』の説明"
                      aria-expanded={openInfo === 'course'}
                      aria-controls="help-course"
                    >
                      i
                    </button>
                  </label>
                  {openInfo === 'course' && (
                    <p id="help-course" className="ml-5 text-[11px] text-gray-600">
                      タスク表の各時間帯で、タスクを<strong className="font-semibold">コースごと</strong>にグループ表示します。
                    </p>
                  )}
                </div>

                {/* 同一名のタスクはまとめて表示 */}
                {showCourseAll && (
                  <div className="flex flex-col gap-0.5">
                    <label className="flex items-center gap-1 text-xs select-none">
                      <input
                        type="checkbox"
                        className="accent-blue-600"
                        checked={mergeSameTasks}
                        onChange={(e) => setMergeSameTasks(e.target.checked)}
                        aria-label="同一名のタスクはまとめて表示"
                      />
                      同一名のタスクはまとめて表示
                      <button
                        type="button"
                        onClick={() => toggleInfo('merge')}
                        className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full border border-gray-300 text-[10px] leading-4 text-gray-600 hover:bg-gray-50"
                        aria-label="『同一名のタスクはまとめて表示』の説明"
                        aria-expanded={openInfo === 'merge'}
                        aria-controls="help-merge"
                      >
                        i
                      </button>
                    </label>
                    {openInfo === 'merge' && (
                      <p id="help-merge" className="ml-5 text-[11px] text-gray-600">
                        コースが異なっても<strong className="font-semibold">同じ名前のタスク</strong>をひとつにまとめて表示します。
                        <span className="ml-1 text-gray-500">（※「コースを表示」ONのときのみ選択可）</span>
                      </p>
                    )}
                  </div>
                )}

                {/* 人数表示 */}
                <div className="flex flex-col gap-0.5">
                  <label className="flex items-center gap-1 text-xs select-none">
                    <input
                      type="checkbox"
                      className="accent-blue-600"
                      checked={showGuestsAll}
                      onChange={(e) => setShowGuestsAll(e.target.checked)}
                      aria-label="人数を表示する"
                    />
                    人数表示
                    <button
                      type="button"
                      onClick={() => toggleInfo('guests')}
                      className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full border border-gray-300 text-[10px] leading-4 text-gray-600 hover:bg-gray-50"
                      aria-label="『人数表示』の説明"
                      aria-expanded={openInfo === 'guests'}
                      aria-controls="help-guests"
                    >
                      i
                    </button>
                  </label>
                  {openInfo === 'guests' && (
                    <div id="help-guests" className="ml-5 text-[11px] text-gray-600 space-y-1.5">
                      <p>
                        各タスクの小さな「ピル」に<strong className="font-semibold">人数</strong>を括弧で表示します。
                        <span className="ml-1">左が卓番号、括弧内が人数です。</span>
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500">表示例：</span>
                        <span className="inline-flex items-center border px-1.5 py-0.5 rounded text-[11px] bg-white">
                          3（4）
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 並び替え：左／ コース：右寄せ（同じ行） */}
          <div className="mt-5 flex items-center justify-between gap-2 whitespace-nowrap">
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-[11px] text-gray-600 shrink-0">並び替え：</span>
              <div className="inline-flex rounded border overflow-hidden">
                <button
                  type="button"
                  onClick={() => onChangeTaskSort('table')}
                  className={`px-2 py-0.5 text-[11px] ${curTaskSort === 'table' ? 'bg-blue-600 text-white' : 'bg-white'}`}
                  aria-pressed={curTaskSort === 'table'}
                >
                  卓番順
                </button>
                <button
                  type="button"
                  onClick={() => onChangeTaskSort('guests')}
                  className={`px-2 py-0.5 text-[11px] border-l ${curTaskSort === 'guests' ? 'bg-blue-600 text-white' : 'bg-white'}`}
                  aria-pressed={curTaskSort === 'guests'}
                >
                  人数順
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-[11px] text-gray-600 shrink-0">エリア：</span>
              <select
                value={filterArea && filterArea.length ? filterArea : '全て'}
                onChange={(e) => setFilterArea(e.target.value)}
                className="border px-1 py-0.5 rounded text-[10px] w-[6.5rem]"
                aria-label="エリアを絞り込み"
              >
                <option value="全て">全て</option>
                <option value="未割当">未割当</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || a.id}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        {/* 完了一括ヒント（2.5秒で自動消滅） */}
        {completeApplyHint && (
          <div className="mt-2 text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
            {completeApplyHint}
          </div>
        )}
      </div>
      {/* ───────── スペーサー（sticky直後のかぶり防止） ───────── */}
      <div className="h-3" />

      {/* ───────── タスク表本体 ───────── */}
        <section className="space-y-4 text-sm touch-pan-y">
        {timeKeys.map((timeKey, timeIdx) => {
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

                return collectArr.map((ct, groupIdx) => {
                  const keyForTask = `${timeKey}_${ct.label}`;
                  const showHelpBadge = timeIdx === 0 && groupIdx === 0;
                  const sortedArr =
                    curTaskSort === 'guests'
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
                            （計{sortedArr.reduce<number>((sum, r) => sum + toGuests(r.guests), 0)}人）
                          </span>
                        )}
                        {/* 時間変更モード（選択モード中は非表示） */}
                        {selectionModeTask !== keyForTask && (
                          <>
                            {shiftModeKey !== keyForTask && (
                              <div className="ml-auto inline-flex items-center gap-1">
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
                                      setShiftTargets([]);
                                      setSelectedShiftMinutes(null);
                                    }
                                  }}
                                  className="px-2 py-0.5 bg-gray-300 rounded text-xs"
                                  aria-label="時間変更"
                                  aria-expanded={openShiftMenuFor === keyForTask}
                                >
                                  時間変更
                                </button>
                                {showHelpBadge && (
                                  <button
                                    type="button"
                                    onClick={() => setTaskHelp(taskHelp === 'shift' ? null : 'shift')}
                                    className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-gray-300 text-[10px] leading-4 text-gray-600 hover:bg-gray-50"
                                    aria-label="『時間変更』の説明を表示"
                                    aria-expanded={taskHelp === 'shift'}
                                    aria-controls="help-shift"
                                  >
                                    i
                                  </button>
                                )}
                              </div>
                            )}
                            {openShiftMenuFor === keyForTask && (
                              <div className="ml-2 mt-1 p-2 border rounded bg-gray-50 relative">
                                {/* 1段目：対象／適用／キャンセル */}
                                <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap w-full text-[11px]">
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
                                      className={`px-2 py-0.5 border rounded text-xs whitespace-nowrap ${
                                        selectedShiftMinutes === null
                                          ? 'bg-gray-50 border-gray-300 text-gray-700'
                                          : selectedShiftMinutes > 0
                                          ? 'bg-green-50 border-green-300 text-green-700'
                                          : 'bg-red-50 border-red-300 text-red-700'
                                      }`}
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
                                        {[-5, -10, -15, 5, 10, 15].map((m) => (
                                          <button
                                            key={m}
                                            onClick={() => {
                                              setSelectedShiftMinutes(m);
                                              setMinutePickerOpenFor(null);
                                            }}
                                            className={`inline-flex items-center justify-center px-2 py-1 rounded text-xs border text-center whitespace-nowrap min-w-[3.25rem] leading-tight ${
                                              m > 0
                                                ? 'bg-green-50 hover:bg-green-100 border-green-300 text-green-700'
                                                : 'bg-red-50 hover:bg-red-100 border-red-300 text-red-700'
                                            } ${selectedShiftMinutes === m ? 'ring-1 ring-offset-1 ring-current' : ''}`}
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
                              <div className="ml-2 inline-flex items-center gap-1">
                                <button
                                  onClick={() =>
                                    setSelectionModeTask((prev) =>
                                      prev === keyForTask ? null : keyForTask
                                    )
                                  }
                                  className="px-2 py-0.5 bg-yellow-500 text-white rounded text-sm"
                                  aria-pressed={false}
                                  aria-label="完了を選ぶモード"
                                >
                                  完了
                                </button>
                                {showHelpBadge && (
                                  <button
                                    type="button"
                                    onClick={() => setTaskHelp(taskHelp === 'complete' ? null : 'complete')}
                                    className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-gray-300 text-[10px] leading-4 text-gray-600 hover:bg-gray-50"
                                    aria-label="『完了』の説明を表示"
                                    aria-expanded={taskHelp === 'complete'}
                                    aria-controls="help-complete"
                                  >
                                    i
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* Help popovers for shift/complete */}
                      {showHelpBadge && taskHelp === 'shift' && (
                        <div id="help-shift" className="mt-1 text-[11px] text-gray-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-1">
                          <p className="font-medium">時間変更の使い方</p>
                          <ol className="list-decimal ml-5 space-y-0.5">
                            <li>
                              <button className="px-1 py-0.5 bg-gray-300 rounded text-[10px]" disabled>時間変更</button>
                              を押します。
                            </li>
                            <li>時間をずらしたい卓番号をタップして選択します。</li>
                            <li>
  <button className="px-2 py-0.5 border rounded text-xs bg-gray-50 border-gray-300 text-gray-700 whitespace-nowrap" disabled>未選択</button>
  をタップし、ずらしたい分数（−5／−10／−15／＋5／＋10／＋15）を選びます。
</li>
                            <li><span className="font-semibold">適用</span>を押すと変更が反映されます。</li>
                          </ol>
                        </div>
                      )}
                      {showHelpBadge && taskHelp === 'complete' && (
                        <div id="help-complete" className="mt-1 text-[11px] text-gray-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                          <p className="font-medium">完了の使い方</p>
                          <ol className="list-decimal ml-5 space-y-0.5">
                            <li>
                              <button className="px-1 py-0.5 bg-yellow-500 text-white rounded text-[10px]" disabled>完了</button>
                              を押します。
                            </li>
                            <li>完了した（または完了予定の）卓をタップして選択します。</li>
                            <li><span className="font-semibold">適用</span>を押して共有します。</li>
                          </ol>
                        </div>
                      )}

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
              (deferredGroupedTasks[timeKey] ?? []).map((tg, groupIdx) => {
                const keyForTask = `${timeKey}_${tg.label}`;
                const showHelpBadge = timeIdx === 0 && groupIdx === 0;
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
                            (renderCourseGroups.flatMap((g) => g.reservations) ?? []).reduce<number>(
                              (sum, r) => sum + toGuests((r as any)?.guests),
                              0
                            )
                          }人）
                        </span>
                      )}
                      {/* 時間変更モード（選択モード中は非表示） */}
                      {selectionModeTask !== keyForTask && (
                        <>
                          {shiftModeKey !== keyForTask && (
                            <div className="ml-auto inline-flex items-center gap-1">
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
                                className="px-2 py-0.5 bg-gray-300 rounded text-xs"
                                aria-label="時間変更"
                                aria-expanded={openShiftMenuFor === keyForTask}
                              >
                                時間変更
                              </button>
                              {showHelpBadge && (
                                <button
                                  type="button"
                                  onClick={() => setTaskHelp(taskHelp === 'shift' ? null : 'shift')}
                                  className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-gray-300 text-[10px] leading-4 text-gray-600 hover:bg-gray-50"
                                  aria-label="『時間変更』の説明を表示"
                                  aria-expanded={taskHelp === 'shift'}
                                  aria-controls="help-shift"
                                >
                                  i
                                </button>
                              )}
                            </div>
                          )}

                          {openShiftMenuFor === keyForTask && (
                            <div className="ml-2 mt-1 p-2 border rounded bg-gray-50 relative">
                              {/* 1段目：対象／適用／キャンセル */}
                              <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap w-full text-[11px]">
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
                                    className={`px-2 py-0.5 border rounded text-xs whitespace-nowrap ${
                                      selectedShiftMinutes === null
                                        ? 'bg-gray-50 border-gray-300 text-gray-700'
                                        : selectedShiftMinutes > 0
                                        ? 'bg-green-50 border-green-300 text-green-700'
                                        : 'bg-red-50 border-red-300 text-red-700'
                                    }`}
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
                                      {[-5, -10, -15, 5, 10, 15].map((m) => (
                                        <button
                                          key={m}
                                          onClick={() => {
                                            setSelectedShiftMinutes(m);
                                            setMinutePickerOpenFor(null);
                                          }}
                                          className={`inline-flex items-center justify-center px-2 py-1 rounded text-xs border text-center whitespace-nowrap min-w-[3.25rem] leading-tight ${
                                            m > 0
                                              ? 'bg-green-50 hover:bg-green-100 border-green-300 text-green-700'
                                              : 'bg-red-50 hover:bg-red-100 border-red-300 text-red-700'
                                          } ${selectedShiftMinutes === m ? 'ring-1 ring-offset-1 ring-current' : ''}`}
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
                            <div className="ml-2 inline-flex items-center gap-1">
                              <button
                                onClick={() =>
                                  setSelectionModeTask((prev) =>
                                    prev === keyForTask ? null : keyForTask
                                  )
                                }
                                className="px-2 py-0.5 bg-yellow-500 text-white rounded text-sm"
                                aria-pressed={false}
                                aria-label="完了を選ぶモード"
                              >
                                完了
                              </button>
                              {showHelpBadge && (
                                <button
                                  type="button"
                                  onClick={() => setTaskHelp(taskHelp === 'complete' ? null : 'complete')}
                                  className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-gray-300 text-[10px] leading-4 text-gray-600 hover:bg-gray-50"
                                  aria-label="『完了』の説明を表示"
                                  aria-expanded={taskHelp === 'complete'}
                                  aria-controls="help-complete"
                                >
                                  i
                                </button>
                              )}
                            </div>
                          )}
                        </>
                      )}

                    </div>

                    {/* Help popovers for shift/complete */}
                    {showHelpBadge && taskHelp === 'shift' && (
                      <div id="help-shift" className="mt-1 text-[11px] text-gray-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-1">
                        <p className="font-medium">時間変更の使い方</p>
                        <ol className="list-decimal ml-5 space-y-0.5">
                          <li>
                            <button className="px-1 py-0.5 bg-gray-300 rounded text-[10px]" disabled>時間変更</button>
                            を押します。
                          </li>
                          <li>時間をずらしたい卓番号をタップして選択します。</li>
                          <li>
  <button className="px-2 py-0.5 border rounded text-xs bg-gray-50 border-gray-300 text-gray-700 whitespace-nowrap" disabled>未選択</button>
  をタップし、ずらしたい分数（−5／−10／−15／＋5／＋10／＋15）を選びます。
</li>
                          <li><span className="font-semibold">適用</span>を押すと変更が反映されます。</li>
                        </ol>
                      </div>
                    )}
                    {showHelpBadge && taskHelp === 'complete' && (
                      <div id="help-complete" className="mt-1 text-[11px] text-gray-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                        <p className="font-medium">完了の使い方</p>
                        <ol className="list-decimal ml-5 space-y-0.5">
                          <li>
                            <button className="px-1 py-0.5 bg-yellow-500 text-white rounded text-[10px]" disabled>完了</button>
                            を押します。
                          </li>
                          <li>完了した（または完了予定の）卓をタップして選択します。</li>
                          <li><span className="font-semibold">適用</span>を押して共有します。</li>
                        </ol>
                      </div>
                    )}

                    {renderCourseGroups.map((cg) => {
                      const sortedArr =
                        curTaskSort === 'guests'
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
                                （計{cg.reservations.reduce<number>((sum, r) => sum + toGuests(r?.guests as any), 0)}人）
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
