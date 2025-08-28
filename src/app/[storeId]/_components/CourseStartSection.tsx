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

  // 将来用の拡張（渡されなくてもOK）
  taskSort?: 'table' | 'guests';
  setTaskSort?: React.Dispatch<React.SetStateAction<'table' | 'guests'>>;
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
  } = props;

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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-indigo-600"
              checked={showTableStart}
              onChange={(e) => setShowTableStart(e.target.checked)}
            />
            <span>卓番号を表示</span>
          </label>

          <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-indigo-600"
              checked={courseStartFiltered}
              onChange={(e) => setCourseStartFiltered(e.target.checked)}
            />
            <span>営業前設定のフィルターを反映</span>
          </label>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-500">絞り込み</span>
            <select
              className="text-sm rounded-md border border-gray-300 bg-white px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={filterCourse}
              onChange={(e) => setFilterCourse(e.target.value)}
            >
              <option value="全体">全体</option>
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
          <div key={timeKey} className="border rounded-md p-3 bg-white shadow-sm">
            {/* 時刻ヘッダー + 合計 */}
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-4 w-1 rounded bg-indigo-300" />
                <span className="text-lg font-bold text-gray-900 tracking-wide">{timeKey}</span>
              </div>
              <span className="text-xs text-gray-700">
                <span className="inline-flex items-center gap-1">
                  <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  合計 {
                    (groupedStartTimes[timeKey]?.reduce((acc, g) => acc + g.reservations.length, 0) ?? 0)
                  } 件（{
                    (groupedStartTimes[timeKey]?.reduce((acc, g) => acc + g.reservations.reduce((s, r) => s + (Number(r.guests) || 0), 0), 0) ?? 0)
                  }人）
                </span>
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
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-white text-gray-700 border border-gray-200 inline-flex items-center gap-1">
                      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400" />
                      {group.courseName}
                    </span>
                    <span className="text-[11px] text-gray-500">
                      （{courseCount}件 / {courseGuests}人）
                    </span>

                    {/* 予約のチップ（卓番（人数） or 名前） */}
                    <div className="flex flex-wrap items-center gap-1 w-full mt-1">
                      {group.reservations.map((r) => (
                        <span
                          key={r.id}
                          className="inline-flex items-center rounded border border-gray-200 px-1.5 py-0.5 text-[11px] leading-none text-gray-800"
                        >
                          {showTableStart ? `${r.table}(${r.guests})` : (r.name || r.id)}
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