import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AreaDef } from '@/types';

// ===== Types =====
export type CourseTask = { timeOffset: number; label: string };
export type CourseDef = { name: string; tasks: CourseTask[] };

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
  setDisplayTaskCourse: (courseName: string) => void;
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
  const section = searchParams?.get('preopen');

  const openSection = (name: 'tables' | 'tasks') => {
    const q = new URLSearchParams(searchParams?.toString() ?? '');
    q.set('preopen', name);
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const closeSection = () => {
    const q = new URLSearchParams(searchParams?.toString() ?? '');
    q.delete('preopen');
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
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

  const openTaskPopover = React.useCallback((el: HTMLElement, pos: string) => {
    // select position and open bubble near the button
    setSelectedDisplayPosition(pos);
    const r = el.getBoundingClientRect();
    setTaskPopover({ open: true, x: r.left + r.width / 2, y: r.bottom });
  }, [setSelectedDisplayPosition]);

  const closeTaskPopover = React.useCallback(() => setTaskPopover(null), []);

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
            <h2 className="text-center text-base font-semibold">表示する卓</h2>
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
        <div className="px-4 pt-2 space-y-3">
          {/* 使い方ガイド */}
          <div className="rounded-md border border-blue-200 bg-blue-50/70 text-blue-900 p-2 text-[12px] leading-relaxed">
            <p className="font-medium mb-1">使い方</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>エリアボタンで、そのエリアの卓を <b>一括選択/解除</b> できます。</li>
              <li>卓のボタンをタップすると、<b>個別にON/OFF</b> できます。</li>
            </ul>
          </div>

          {/* エリア一括選択 */}
          {Array.isArray(areas) && areas.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">エリアで一括選択:</span>
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
          )}

          {/* 選択数と操作 */}
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-600" aria-live="polite">
              選択中: <b>{checkedTables.length}</b> 卓
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
        </div>

        {/* 本文 */}
        <div className="p-4">
          <div className="rounded-lg border bg-white p-3 shadow-sm">
            <div className="grid grid-cols-4 gap-2">
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
            <h2 className="text-center text-base font-semibold">表示するタスク</h2>
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
        <div className="p-0">
          {/* 目的を明示しつつポジション選択を最上段・強調表示（スクロール固定） */}
          <div className="sticky top-11 z-10 bg-white/90 backdrop-blur-sm border-b">
            <div className="px-4 py-3">
              <div className="text-[12px] text-gray-600 mb-2">
                <div>※ <b>ポジションのタスクは店舗設定で固定</b>です（この画面では変更できません）。</div>
                <div>※ <b>「その他」</b>は<span className="underline decoration-dotted">個人カスタム</span>として当日の自分用に表示タスクをON/OFFできます。</div>
              </div>
              <div className="-mx-1 overflow-x-auto py-0.5 px-1">
                <div className="flex items-center gap-2">
                  {positions.map((pos) => {
                    const active = selectedDisplayPosition === pos;
                    return (
                      <button
                        key={pos}
                        type="button"
                        onClick={(e) => openTaskPopover(e.currentTarget as HTMLElement, pos)}
                        className={[
                          "px-3 py-1.5 rounded-full text-sm border whitespace-nowrap transition",
                          active
                            ? "bg-blue-600 text-white border-blue-600 shadow"
                            : "bg-white border-gray-300 hover:bg-gray-50",
                        ].join(" ")}
                      >
                        {pos}
                      </button>
                    );
                  })}
                  {/* その他 */}
                  <button
                    type="button"
                    onClick={(e) => openTaskPopover(e.currentTarget as HTMLElement, 'その他')}
                    className={[
                      "px-3 py-1.5 rounded-full text-sm border whitespace-nowrap transition",
                      selectedDisplayPosition === 'その他'
                        ? "bg-blue-600 text-white border-blue-600 shadow"
                        : "bg-white border-gray-300 hover:bg-gray-50",
                    ].join(" ")}
                  >
                    その他
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 本文コンテンツ（パディングをここで与える） */}
          <div className="p-4">
            <div className="rounded-md border bg-white p-4 text-sm text-gray-600">
              ポジションのボタンを押すと、<b>表示するコース / タスク</b> を設定するパネルが
              ボタンのそばに開きます。
            </div>
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
                                    <div key={`${task.timeOffset}_${task.label}_${course.name}`} className="flex items-center gap-3 py-2 text-sm">
                                      <span className="inline-flex min-w-[56px] justify-center px-2 py-0.5 rounded-full text-[11px] bg-blue-50 text-blue-700">
                                        {task.timeOffset}分後
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
                                    <div key={`${course?.name ?? 'course'}_${task.timeOffset}_${task.label}`} className="flex items-center gap-3 py-2 text-sm">
                                      <span className="inline-flex min-w-[56px] justify-center px-2 py-0.5 rounded-full text-[11px] bg-blue-50 text-blue-700">
                                        {task.timeOffset}分後
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
        title="表示する卓の設定へ"
      >
        <span className="font-medium">表示する卓</span>
        <span aria-hidden className="text-gray-400 text-lg">▸</span>
      </button>

      <button
        type="button"
        onClick={() => openSection('tasks')}
        className="w-full flex items-center justify-between bg-white rounded-lg border px-4 py-3 shadow-sm active:opacity-80"
        title="表示するタスクの設定へ"
      >
        <span className="font-medium">表示するタスク</span>
        <span aria-hidden className="text-gray-400 text-lg">▸</span>
      </button>
    </section>
  );
};

export default PreopenSettingsContent;