'use client';

import React from 'react';
import type { Reservation, CourseDef } from '@/types';

type Props = {
  groupedStartTimes: Record<
    string,
    { courseName: string; reservations: Reservation[] }[]
  >;
  /** 無ければ内部で timeKey を "HH:MM" 升目に並べ替えて使う */
  sortedTimeKeys?: string[];

  showTableStart: boolean;
  setShowTableStart: React.Dispatch<React.SetStateAction<boolean>>;
  courseStartFiltered: boolean;
  setCourseStartFiltered: React.Dispatch<React.SetStateAction<boolean>>;
  filterCourse: string;
  setFilterCourse: React.Dispatch<React.SetStateAction<string>>;
  courses: CourseDef[];

  startSort?: 'table' | 'guests';
  setStartSort?: React.Dispatch<React.SetStateAction<'table' | 'guests'>>;
  showGuestsAll?: boolean;
  rotatingTables?: Record<string, string> | Set<string>;
  firstRotatingId?: Record<string, string>;
};

const parseTimeToMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const CourseStartSection: React.FC<Props> = React.memo((props) => {
  const {
    groupedStartTimes,
    sortedTimeKeys,
    showTableStart,
    setShowTableStart,
    courseStartFiltered,
    setCourseStartFiltered,
    filterCourse,
    setFilterCourse,
    courses,
    showGuestsAll = false,
  } = props;

  // 並び替えモード（親から渡されなければローカルで管理）
  const [innerStartSort, setInnerStartSort] = React.useState<'table' | 'guests'>(() => {
    return (props.startSort as 'table' | 'guests') ?? 'table';
  });
  const curStartSort: 'table' | 'guests' = props.startSort ?? innerStartSort;
  const onChangeStartSort = props.setStartSort ?? setInnerStartSort;

  // small info popovers for control toggles
  const [openInfo, setOpenInfo] = React.useState<null | 'showTable' | 'applyPre'>(null);
  const toggleInfo = (k: 'showTable' | 'applyPre') => {
    setOpenInfo(prev => (prev === k ? null : k));
  };

  // 親が startSort を後から渡してきた場合にローカルへ反映
  React.useEffect(() => {
    if (props.startSort && !props.setStartSort) setInnerStartSort(props.startSort);
  }, [props.startSort, props.setStartSort]);

  const keys =
    sortedTimeKeys ??
    React.useMemo(
      () =>
        Object.keys(groupedStartTimes).sort(
          (a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b)
        ),
      [groupedStartTimes]
    );

  return (
    <section className="space-y-4">
      {/* コントロール行 */}
      <div className="px-1 py-2 border-b border-gray-200">
        <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-4 gap-y-2">
          <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-indigo-600"
              checked={showTableStart}
              onChange={(e) => setShowTableStart(e.target.checked)}
              aria-label="卓番号を表示"
            />
            <span>卓番号を表示</span>
            <button
              type="button"
              onClick={() => toggleInfo('showTable')}
              className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] leading-4 text-gray-600 hover:bg-gray-50"
              aria-label="『卓番号を表示』の説明"
              aria-expanded={openInfo === 'showTable'}
              aria-controls="help-show-table"
            >
              i
            </button>
          </label>
          {openInfo === 'showTable' && (
            <div id="help-show-table" className="mt-1 ml-6 text-[11px] text-gray-600 space-y-1">
              <p>
                下のコース開始時間表で、<strong className="font-semibold">卓番号</strong>を表示するかどうかを切り替えられます。
                左側が卓番号、右側の括弧が<strong className="font-semibold">人数</strong>です。
              </p>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-500">例：</span>
                <span className="inline-flex items-center rounded border border-gray-200 px-1.5 py-0.5 text-[11px] leading-none text-gray-800 gap-1 bg-white">
                  <span className="tabular-nums">2</span>
                  <span>（<span className="tabular-nums">4</span>）</span>
                </span>
                <span className="inline-flex items-center rounded border border-gray-200 px-1.5 py-0.5 text-[11px] leading-none text-gray-800 gap-1 bg-white">
                  <span className="tabular-nums">7</span>
                  <span>（<span className="tabular-nums">6</span>）</span>
                </span>
              </div>
            </div>
          )}

          <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-indigo-600"
              checked={courseStartFiltered}
              onChange={(e) => setCourseStartFiltered(e.target.checked)}
              aria-label="営業前設定のフィルターを反映"
            />
            <span>営業前設定のフィルターを反映</span>
            <button
              type="button"
              onClick={() => toggleInfo('applyPre')}
              className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] leading-4 text-gray-600 hover:bg-gray-50"
              aria-label="『営業前設定のフィルターを反映』の説明"
              aria-expanded={openInfo === 'applyPre'}
              aria-controls="help-apply-pre"
            >
              i
            </button>
          </label>
          {openInfo === 'applyPre' && (
            <div id="help-apply-pre" className="mt-1 ml-6 text-[11px] text-gray-600 space-y-1">
              <p>
                下のコース開始時間表に、サイドメニューの<strong className="font-semibold">営業前設定</strong>で選んだ
                「本日表示する卓番号」を反映します。オンのときは選択した卓のみ、オフのときは<strong className="font-semibold">すべての卓</strong>が表示されます。
              </p>
            </div>
          )}

          <div className="hidden sm:block w-full" />
          <div className="block sm:hidden w-full" />

          <div className="flex items-center gap-1 whitespace-nowrap flex-1 min-w-[190px] sm:order-2 sm:flex-1 sm:justify-start">
            <span className="text-[11px] text-gray-500 mr-1 sm:hidden">並替：</span>
            <span className="hidden sm:inline text-[11px] text-gray-500 mr-1">並び替え：</span>
            <div className="inline-flex whitespace-nowrap rounded-md overflow-hidden border border-gray-300 h-7 sm:h-8">
              <button
                type="button"
                aria-pressed={curStartSort === 'table'}
                onClick={() => onChangeStartSort('table')}
                className={`inline-flex items-center h-7 px-2 text-[11px] leading-none sm:h-8 sm:px-3 sm:text-sm focus:outline-none transition-colors ${
                  curStartSort === 'table'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span>卓番順</span>
              </button>
              <button
                type="button"
                aria-pressed={curStartSort === 'guests'}
                onClick={() => onChangeStartSort('guests')}
                className={`inline-flex items-center h-7 px-2 text-[11px] leading-none sm:h-8 sm:px-3 sm:text-sm border-l border-gray-300 focus:outline-none transition-colors ${
                  curStartSort === 'guests'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span>人数順</span>
              </button>
            </div>
          </div>

          <div className="h-5 w-px bg-gray-200 hidden sm:hidden" />

          <div className="flex items-center gap-1.5 ml-auto justify-end flex-shrink-0 min-w-[108px] whitespace-nowrap sm:order-2 sm:ml-auto sm:justify-end">
            <span className="text-[11px] text-gray-500 mr-1 sm:hidden">絞込：</span>
            <span className="hidden sm:inline text-[11px] text-gray-500 mr-1">絞り込み：</span>
            <select
              className="h-7 sm:h-8 text-[12px] sm:text-sm rounded-md border border-gray-300 bg-white px-1.5 sm:px-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 min-w-[76px]"
              value={filterCourse}
              onChange={(e) => setFilterCourse(e.target.value)}
            >
              <option value="全体">全て</option>
              {courses.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>


      {/* タイムスロットごとの一覧 */}
      <div className="space-y-6">
        {keys.map((timeKey) => (
          <div key={timeKey} className="border-2 border-gray-300 rounded-md p-3 bg-white shadow-sm">
            {/* 時刻ヘッダー + 合計 */}
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-4 w-1 rounded bg-indigo-300" />
                <span className="text-xl font-bold text-gray-900 tracking-wide">{timeKey}</span>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                合計
                <span className="tabular-nums">
                  {(groupedStartTimes[timeKey]?.reduce((acc, g) => acc + g.reservations.length, 0) ?? 0)}
                </span>
                件（
                <span className="tabular-nums">
                  {(groupedStartTimes[timeKey]?.reduce((acc, g) => acc + g.reservations.reduce((s, r) => s + (Number(r.guests) || 0), 0), 0) ?? 0)}
                </span>
                人）
              </span>
            </div>

            {/* コースごとの行 */}
            <div className="space-y-2">
              {(groupedStartTimes[timeKey] || []).map((group) => {
                const courseCount = group.reservations.length;
                const courseGuests = group.reservations.reduce((s, r) => s + (Number(r.guests) || 0), 0);

                return (
                  <div
                    key={group.courseName + timeKey}
                    className="flex flex-wrap items-center gap-2 border rounded-md px-2 py-1 bg-gray-50 hover:bg-gray-100/50 transition-colors"
                  >
                    {/* コース名 + コース内合計 */}
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500" />
                      <span className="text-sm font-semibold text-gray-800 tracking-tight">{group.courseName}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50/70 px-2 py-0.5 text-[11px] font-medium text-emerald-700/90 ring-1 ring-inset ring-emerald-200/70">
                      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500/70" />
                      <span className="tabular-nums">{courseCount}</span>件（
                      <span className="tabular-nums">{courseGuests}</span>人）
                    </span>

                    {/* 予約のチップ（卓番（人数） or 名前） */}
                    <div className="flex flex-wrap items-center gap-1 w-full mt-1">
                      {[...group.reservations]
                        .sort((a, b) => {
                          if (curStartSort === 'guests') {
                            const ga = Number(a.guests) || 0;
                            const gb = Number(b.guests) || 0;
                            if (gb !== ga) return gb - ga; // 人数の多い順
                          }
                          const ta = Number(a.table) || 0;
                          const tb = Number(b.table) || 0;
                          return ta - tb; // 卓番の小さい順
                        })
                        .map((r) => (
                          <span
                            key={r.id}
                            className="inline-flex items-center rounded border border-gray-200 px-1.5 py-0.5 text-[11px] leading-none text-gray-800 gap-1"
                          >
                            {showTableStart ? (
                              <>
                                <span className="tabular-nums">{r.table}</span>
                                {showGuestsAll ? (
                                  <span className="text-black">({Number(r.guests) || 0})</span>
                                ) : null}
                              </>
                            ) : (
                              <span className="leading-none">
                                {r.name || (showGuestsAll ? `(${Number(r.guests) || 0})` : '')}
                              </span>
                            )}
                          </span>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
});

export default CourseStartSection;