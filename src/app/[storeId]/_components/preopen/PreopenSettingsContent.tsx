import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AreaDef, CourseDef, TaskDef } from '@/types';

const formatTaskOffset = (offset: number) => {
  if (offset > 0) return `${offset}分後`;
  if (offset < 0) return `${Math.abs(offset)}分前`;
  return '0分後';
};
const formatTaskRange = (start: number, end?: number) => {
  const normalizedEnd = typeof end === 'number' ? end : start;
  if (normalizedEnd === start) return formatTaskOffset(start);
  return `${formatTaskOffset(start)} - ${formatTaskOffset(normalizedEnd)}`;
};

// ===== Types =====
export type CourseTask = TaskDef;

// Props expected from the parent page
export type PreopenSettingsProps = {
  // storage namespace for localStorage keys
  ns: string;

  // master data
  courses: CourseDef[];
  positions: string[];
  presetTables: string[];
  areas?: AreaDef[]; // ← エリア定義（任意）

  // 現在選択中のコース（「その他」モード用）
  selectedCourse: string;

  // 「その他」モードのチェック状態とトグルハンドラ
  checkedTasks: string[];
  // 任意: 親から setter を直接受け取る場合に使用（無い場合は内部で使わない）
  setCheckedTasks?: React.Dispatch<React.SetStateAction<string[]>>;
  // 任意: 親にトグル処理を委譲したい場合に使用（無い場合は setCheckedTasks で内部トグル）
  handleTaskCheck?: (label: string) => void;

  // 表示する卓（保存は親が持つ）
  checkedTables: string[];
  setCheckedTables: (next: string[]) => void;

  // ポジション × コースごとの表示タスク設定（保存は親が持つ）
  tasksByPosition: Record<string, Record<string, string[]>>;
  toggleTaskForPosition: (pos: string, courseName: string, taskLabel: string) => void;

  // UI 状態（選択中のポジション & コース）
  selectedDisplayPosition: string;
  setSelectedDisplayPosition: (pos: string) => void;
  displayTaskCourse: string;
  setDisplayTaskCourse: React.Dispatch<React.SetStateAction<string>>;
};

const PreopenSettingsContent: React.FC<PreopenSettingsProps> = ({
  ns,
  courses,
  positions,
  presetTables,
  areas,
  selectedCourse,
  checkedTasks,
  setCheckedTasks,
  handleTaskCheck,
  checkedTables,
  setCheckedTables,
  tasksByPosition,
  toggleTaskForPosition,
  selectedDisplayPosition,
  setSelectedDisplayPosition,
  displayTaskCourse,
  setDisplayTaskCourse,
}) => {
  // Route-based section switching (open new "page" via query)
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sectionParam = searchParams?.get('preopen');
  const [localSection, setLocalSection] = React.useState<'tables' | 'tasks' | null>(null);

  React.useEffect(() => {
    if (sectionParam === 'tables' || sectionParam === 'tasks') {
      setLocalSection((prev) => (prev === sectionParam ? prev : sectionParam));
    } else if (!sectionParam) {
      setLocalSection((prev) => (prev === null ? prev : null));
    }
  }, [sectionParam]);

  const section = sectionParam === 'tables' || sectionParam === 'tasks'
    ? sectionParam
    : localSection;

  const openSection = (name: 'tables' | 'tasks') => {
    setLocalSection(name);
    try {
      const q = new URLSearchParams(searchParams?.toString() ?? '');
      q.set('preopen', name);
      const query = q.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    } catch (err) {
      console.warn('[preopen] Failed to update route for section open:', err);
    }
  };
  const closeSection = () => {
    setLocalSection(null);
    try {
      const q = new URLSearchParams(searchParams?.toString() ?? '');
      q.delete('preopen');
      const query = q.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    } catch (err) {
      console.warn('[preopen] Failed to update route for section close:', err);
    }
  };

  const nsKey = ns ?? 'preopen';

  // --- Area quick-select (persist to localStorage) ---
  const [selectedAreas, setSelectedAreas] = React.useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`${nsKey}-selectedAreas`) ?? '[]');
    } catch {
      return [];
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem(`${nsKey}-selectedAreas`, JSON.stringify(selectedAreas));
    } catch {}
  }, [nsKey, selectedAreas]);

  // Memoized helper: selected area names for UI
  const selectedAreaNames = React.useMemo(
    () => (areas ?? []).filter((a) => selectedAreas.includes(a.id)).map((a) => a.name),
    [areas, selectedAreas]
  );

  // Build union of tables for given area ids and REPLACE current selection
  const applyAreas = React.useCallback((areaIds: string[]) => {
    const s = new Set<string>();
    (areaIds || []).forEach((id) => {
      const area = (areas ?? []).find((a) => a.id === id);
      area?.tables?.forEach((t) => s.add(String(t)));
    });
    const next = Array.from(s).sort((a, b) => Number(a) - Number(b));
    setCheckedTables(next);
    try {
      localStorage.setItem(`${nsKey}-checkedTables`, JSON.stringify(next));
    } catch {}
  }, [areas, nsKey, setCheckedTables]);

  const toggleArea = React.useCallback((id: string) => {
    setSelectedAreas((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return Array.from(s);
    });
  }, []);

  // 復元時に選択があれば反映
  React.useEffect(() => {
    if (!Array.isArray(areas)) return; // areas 未取得時は何もしない
    applyAreas(selectedAreas);
  }, [areas, selectedAreas, applyAreas]);

  const toggleTable = React.useCallback((key: string) => {
    const next = checkedTables.includes(key)
      ? checkedTables.filter((t) => t !== key)
      : [...checkedTables, key];
    try {
      localStorage.setItem(`${nsKey}-checkedTables`, JSON.stringify(next));
    } catch {}
    setCheckedTables(next);
  }, [checkedTables, setCheckedTables, nsKey]);

  // 共通: 一括設定（保存 & 永続化）
  const setTablesAndPersist = React.useCallback((next: string[]) => {
    try {
      localStorage.setItem(`${nsKey}-checkedTables`, JSON.stringify(next));
    } catch {}
    setCheckedTables(next);
  }, [nsKey, setCheckedTables]);

  // 全て選択 / 全て解除
  const selectAllTables = React.useCallback(() => {
    const next = (presetTables ?? []).map((t) => String(t));
    setTablesAndPersist(next);
  }, [presetTables, setTablesAndPersist]);

  const clearAllTables = React.useCallback(() => {
    setTablesAndPersist([]);
  }, [setTablesAndPersist]);

  // 「その他」タブ用: チェックの切替（handleTaskCheck が来ていなければ setCheckedTasks でトグル）
  const toggleOtherTask = React.useCallback((label: string) => {
    if (typeof handleTaskCheck === 'function') {
      handleTaskCheck(label);
      return;
    }
    if (setCheckedTasks) {
      setCheckedTasks((prev) => {
        const next = prev.includes(label)
          ? prev.filter((l) => l !== label)
          : [...prev, label];
        try {
          localStorage.setItem(`${nsKey}-checkedTasks`, JSON.stringify(next));
        } catch {}
        return next;
      });
    }
  }, [handleTaskCheck, setCheckedTasks, nsKey]);

  // --- Popover state for task settings (anchor: position button) ---
  const [taskPopover, setTaskPopover] = React.useState<{ open: boolean; x: number; y: number } | null>(null);

  const handleSelectPosition = React.useCallback(
    (pos: string) => {
      // queue state updates so React applies them after the current render
      Promise.resolve().then(() => {
        setSelectedDisplayPosition(pos);
        if (courses.length === 0) return;
        const fallback = courses[0]?.name ?? '';
        setDisplayTaskCourse((current: string) => {
          if (pos === 'その他') {
            return current && current.length > 0 ? current : fallback;
          }
          if (current && courses.some((c) => c.name === current)) {
            return current;
          }
          return fallback;
        });
      });
    },
    [courses, setDisplayTaskCourse, setSelectedDisplayPosition]
  );

  const openTaskPopover = React.useCallback((el: HTMLElement, pos: string) => {
    // select position and open bubble near the button
    handleSelectPosition(pos);
    const r = el.getBoundingClientRect();
    setTaskPopover({ open: true, x: r.left + r.width / 2, y: r.bottom });
  }, [handleSelectPosition]);

  const closeTaskPopover = React.useCallback(() => setTaskPopover(null), []);

  // --- Today's enabled positions (local only) ---
  const [enabledPositions, setEnabledPositions] = React.useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`${nsKey}-enabledPositions`) ?? '[]');
    } catch {
      return [];
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem(`${nsKey}-enabledPositions`, JSON.stringify(enabledPositions));
    } catch {}
  }, [nsKey, enabledPositions]);

  const isEnabledPosition = React.useCallback(
    (pos: string) => enabledPositions.includes(pos),
    [enabledPositions]
  );
  const togglePositionEnabled = React.useCallback((pos: string) => {
    setEnabledPositions((prev) => {
      const set = new Set(prev);
      if (set.has(pos)) {
        set.delete(pos);
      } else {
        set.add(pos);
        handleSelectPosition(pos);
      }
      return Array.from(set);
    });
  }, [handleSelectPosition]);

  // ===== Render =====
  if (section === 'tables') {
    return (
      <section>
        <header className="px-4">
          <div className="h-11 grid grid-cols-[auto_1fr_auto] items-center">
            <button
              type="button"
              onClick={closeSection}
              className="-ml-2 px-2 py-1 text-blue-600 text-sm rounded hover:bg-blue-50 active:opacity-80"
              aria-label="戻る"
            >
              ＜ 戻る
            </button>
            <h2 className="text-center font-semibold text-[13px] leading-snug tracking-tight whitespace-nowrap sm:text-base">
              本日の卓番号（エリア）を設定しよう
            </h2>
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              className="-ml-2 px-2 py-1 text-blue-600 text-sm rounded opacity-0 pointer-events-none"
            >
              ＜ 戻る
            </button>
          </div>
          <div className="border-b border-gray-200" />
        </header>
        {/* summary / actions bar */}
        <div className="sticky top-11 z-10 bg-white/95 backdrop-blur">
          <div className="px-4 py-2 flex items-center justify-between">
            <div className="text-xs text-gray-600" aria-live="polite">
              選択中: <b>{checkedTables.length}</b> 卓
              {selectedAreaNames.length > 0 && (
                <span className="ml-2">・エリア: {selectedAreaNames.join('、')}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={selectAllTables}
                className="px-2 py-1 rounded text-xs border bg-white hover:bg-gray-50"
                title="全ての卓を選択"
              >
                全て選択
              </button>
              <button
                type="button"
                onClick={clearAllTables}
                className="px-2 py-1 rounded text-xs border bg-white hover:bg-gray-50"
                title="選択をすべて解除"
              >
                全て解除
              </button>
            </div>
          </div>
          <div className="border-b border-gray-200" />
        </div>

        {/* 本文 */}
        <div className="p-4 space-y-3">
          {/* エリアでまとめて選ぶ */}
          {Array.isArray(areas) && areas.length > 0 && (
            <div className="rounded-lg border bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">エリアでまとめて選ぶ</h3>
                {selectedAreas.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setSelectedAreas([]); }}
                    className="ml-1 px-2 py-1 rounded text-xs border bg-white hover:bg-gray-50"
                    title="エリア選択をクリア"
                  >
                    クリア
                  </button>
                )}
              </div>
              <p className="mt-1 text-[12px] text-gray-500">選んだエリアの卓が下の一覧に反映されます。</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {areas.map((a) => {
                  const on = selectedAreas.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleArea(a.id)}
                      className={[
                        "px-2 py-1 rounded-full text-xs border transition",
                        on
                          ? "bg-blue-600 text-white border-blue-600 shadow"
                          : "bg-gray-100 text-gray-800 hover:bg-gray-200 border-gray-300",
                      ].join(" ")}
                      title={`${a.name} の卓を一括選択 / 解除`}
                    >
                      {a.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 卓を個別に選ぶ */}
          <div className="rounded-lg border bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">卓を個別に選ぶ</h3>
              <span className="text-[12px] text-gray-500">青＝選択中 / 白＝未選択</span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {presetTables.map((tbl) => {
                const key = String(tbl);
                const on = checkedTables.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleTable(key)}
                    className={[
                      "relative h-12 min-h-[48px] rounded-md text-sm font-medium font-mono tracking-wider transition-colors",
                      "focus:outline-none focus:ring-2 focus:ring-blue-400",
                      on
                        ? "bg-blue-600 text-white shadow ring-1 ring-blue-600"
                        : "bg-white text-gray-900 hover:bg-gray-50 ring-1 ring-inset ring-gray-200",
                    ].join(" ")}
                    aria-label={`卓 ${key} を${on ? '解除' : '選択'}`}
                  >
                    {key}
                    {on && (
                      <span className="absolute right-1 top-1 text-[10px] leading-none">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (section === 'tasks') {
    return (
      <section>
        <header className="px-4">
          <div className="h-11 grid grid-cols-[auto_1fr_auto] items-center">
            <button
              type="button"
              onClick={closeSection}
              className="-ml-2 px-2 py-1 text-blue-600 text-sm rounded hover:bg-blue-50 active:opacity-80"
              aria-label="戻る"
            >
              ＜ 戻る
            </button>
            <h2 className="text-center text-base font-semibold">本日のポジションを設定しよう</h2>
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              className="-ml-2 px-2 py-1 text-blue-600 text-sm rounded opacity-0 pointer-events-none"
            >
              ＜ 戻る
            </button>
          </div>
          <div className="border-b border-gray-200" />
        </header>

        {/* 本文 */}
        <div className="p-4 space-y-3">
          {/* 説明 */}
          <div className="text-[12px] text-gray-600">
            <div>※ <b>ポジションのタスクは店舗設定で固定</b>です（この画面では変更できません）。</div>
            <div>※ <b>「その他」</b>は<span className="underline decoration-dotted">個人カスタム</span>として当日の自分用に表示タスクをON/OFFできます。</div>
          </div>


          {/* 縦並びリスト */}
          <div className="space-y-2">
            {[...positions, 'その他'].map((pos) => {
              const enabled = isEnabledPosition(pos);
              return (
                <div
                  key={pos}
                  className="rounded-lg border bg-white px-3 py-2 shadow-sm cursor-pointer transition hover:border-blue-200"
                  onClick={() => handleSelectPosition(pos)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelectPosition(pos);
                    }
                  }}
                  aria-pressed={selectedDisplayPosition === pos}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{pos}</div>
                      <div className="text-[11px] text-gray-500">
                        {pos === 'その他' ? '個人カスタム：当日の自分用' : '店舗設定で決めたタスクを表示'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* 設定（タスク確認/個人カスタム） */}
                      <button
                        type="button"
                        onClick={(e) => openTaskPopover(e.currentTarget as HTMLElement, pos)}
                        className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs"
                      >
                        設定
                      </button>

                      {/* ON/OFF トグル */}
                      <label
                        className="relative inline-flex items-center cursor-pointer select-none"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(event) => {
                            event.stopPropagation();
                            togglePositionEnabled(pos);
                          }}
                          className="sr-only peer"
                        />
                        <span className="w-9 h-5 bg-gray-200 rounded-full peer-checked:bg-blue-600 transition-colors"></span>
                        <span className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transform peer-checked:translate-x-4 transition-transform"></span>
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 補足 */}
          <div className="rounded-md border bg-white p-3 text-[12px] text-gray-600">
            「設定」から<b>表示するコース / タスク</b>を確認・（その他は）個人カスタムできます。
          </div>
        </div>
        {/* ===== Popover (吹き出し) for course & task selection ===== */}
        {taskPopover?.open && (
          <div className="fixed inset-0 z-50" onClick={closeTaskPopover}>
            {/* backdrop */}
            <div className="absolute inset-0 bg-black/10" />
            {/* centered panel */}
            <div className="absolute inset-0 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <div className="w-[360px] max-w-[92vw]">
                <div className="rounded-lg border bg-white shadow-lg relative">
                  <div className="px-4 pt-3 pb-2 border-b bg-gray-50 rounded-t-lg">
                    <div className="text-sm font-semibold">
                      {selectedDisplayPosition === 'その他' ? 'その他' : selectedDisplayPosition}
                      <span className="ml-2 text-xs text-gray-500">
                        {selectedDisplayPosition === 'その他'
                          ? '個人カスタム：当日の自分用'
                          : '以下は店舗設定で設定したタスクを表示'}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 space-y-3 max-h-[60vh] overflow-auto">
                    {selectedDisplayPosition !== 'その他' ? (
                      <>
                        {/* コース選択（集約セレクト） */}
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">コース選択</label>
                          <div className="relative">
                            <select
                              value={displayTaskCourse}
                              onChange={(e) => setDisplayTaskCourse(e.target.value)}
                              className="w-full appearance-none px-3 py-2 pr-8 rounded border bg-white text-sm"
                            >
                              {courses.map((c) => (
                                <option key={c.name} value={c.name}>{c.name}</option>
                              ))}
                            </select>
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-500">▾</span>
                          </div>
                        </div>

                        {/* タスク一覧（選択中コース） */}
                        {(() => {
                          const course = courses.find((c) => c.name === displayTaskCourse) ?? courses[0];
                          const total = (course?.tasks ?? []).length;
                          const onCount = (tasksByPosition[selectedDisplayPosition]?.[course?.name ?? ""] ?? []).length;

                          if (!course || total === 0) {
                            return (
                              <div className="border rounded p-4 text-sm text-gray-500 bg-gray-50">
                                このコースには登録されたタスクがありません。
                              </div>
                            );
                          }

                          const checkedSet = new Set(tasksByPosition[selectedDisplayPosition]?.[course.name] ?? []);
                          const list = (course.tasks ?? []).slice().sort((a, b) => a.timeOffset - b.timeOffset);

                          return (
                            <div className="border rounded">
                              <div className="px-3 py-2 text-[12px] text-amber-700 bg-amber-50 border-t border-b border-amber-200">
                                変更は「店舗設定 ＞ ポジション設定」で行えます。（この画面では変更不可）
                              </div>
                              <div className="divide-y divide-gray-100 p-2">
                                {list.map((task) => {
                                  const checked = checkedSet.has(task.label);
                                  return (
                                    <div key={`${task.timeOffset}_${task.timeOffsetEnd ?? task.timeOffset}_${task.label}_${course.name}`} className="flex items-center gap-3 py-2 text-sm">
                                      <span className="inline-flex min-w-[56px] justify-center px-2 py-0.5 rounded-full text-[11px] bg-blue-50 text-blue-700">
                                        {formatTaskRange(task.timeOffset, task.timeOffsetEnd)}
                                      </span>
                                      <span className="flex-1">{task.label}</span>
                                      <label className="flex items-center space-x-1">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          readOnly
                                          aria-disabled="true"
                                          className="mr-1 accent-blue-600 pointer-events-none"
                                        />
                                        <span>表示</span>
                                      </label>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </>
                    ) : (
                      <>
                        <div className="text-xs text-gray-600">
                          「その他」：<b>個人用に表示タスクを選択</b>（当日の自分用にON/OFFできます）。
                        </div>

                        {/* コース選択（集約セレクト／その他） */}
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">コース選択</label>
                          <div className="relative">
                            <select
                              value={displayTaskCourse}
                              onChange={(e) => setDisplayTaskCourse(e.target.value)}
                              className="w-full appearance-none px-3 py-2 pr-8 rounded border bg-white text-sm"
                            >
                              {courses.map((c) => (
                                <option key={c.name} value={c.name}>{c.name}</option>
                              ))}
                            </select>
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-500">▾</span>
                          </div>
                        </div>

                        {/* 選択中コースのタスク一覧 */}
                        <div className="border rounded">
                          <div className="divide-y divide-gray-100 p-2">
                            {(() => {
                              const course = courses.find((c) => c.name === displayTaskCourse) ?? courses[0];
                              const list = (course?.tasks ?? []).slice().sort((a, b) => a.timeOffset - b.timeOffset);

                              return (
                                <>
                                  {list.map((task) => (
                                    <div key={`${course?.name ?? 'course'}_${task.timeOffset}_${task.timeOffsetEnd ?? task.timeOffset}_${task.label}`} className="flex items-center gap-3 py-2 text-sm">
                                      <span className="inline-flex min-w-[56px] justify-center px-2 py-0.5 rounded-full text-[11px] bg-blue-50 text-blue-700">
                                      {formatTaskRange(task.timeOffset, task.timeOffsetEnd)}
                                      </span>
                                      <span className="flex-1">{task.label}</span>
                                      <label className="flex items-center space-x-1">
                                        <input
                                          type="checkbox"
                                          checked={checkedTasks.includes(task.label)}
                                          onChange={() => toggleOtherTask(task.label)}
                                          className="mr-1 accent-blue-600"
                                        />
                                        <span>表示</span>
                                      </label>
                                    </div>
                                  ))}
                                  {list.length === 0 && (
                                    <div className="py-6 text-center text-xs text-gray-500">該当するタスクがありません。</div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* footer actions */}
                  <div className="flex items-center justify-end gap-2 px-3 pb-3">
                    <button
                      type="button"
                      onClick={closeTaskPopover}
                      className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm"
                    >
                      閉じる
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    );
  }

  // Default: list menu like the Store Settings top
  return (
    <section className="p-4 space-y-3">
      <button
        type="button"
        onClick={() => openSection('tables')}
        className="w-full flex items-center justify-between bg-white rounded-lg border px-4 py-3 shadow-sm active:opacity-80"
        title="本日の担当する卓番号（エリア）を設定"
      >
        <span className="font-medium whitespace-nowrap text-[13px] leading-snug tracking-tight sm:text-[14px]">
          本日の担当する卓番号（エリア）を設定しよう
        </span>
        <span aria-hidden className="text-gray-400 text-lg">▸</span>
      </button>

      <button
        type="button"
        onClick={() => openSection('tasks')}
        className="w-full flex items-center justify-between bg-white rounded-lg border px-4 py-3 shadow-sm active:opacity-80"
        title="本日のポジションを設定"
      >
        <span className="font-medium">本日のポジションを設定しよう</span>
        <span aria-hidden className="text-gray-400 text-lg">▸</span>
      </button>
    </section>
  );
};

export default PreopenSettingsContent;
