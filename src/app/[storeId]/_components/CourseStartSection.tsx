'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Reservation, CourseDef } from '@/types';
import { parseTimeToMinutes } from '@/lib/time';
import {
  getCourseColorStyle,
  normalizeCourseColor,
  type CourseColorStyle,
} from '@/lib/courseColors';

const NEW_THRESHOLD = 15 * 60 * 1000; // 15 minutes

type Props = {
  groupedStartTimes: Record<
    string,
    { courseName: string; reservations: Reservation[] }[]
  >;
  /** 無ければ内部で timeKey を "HH:MM" 升目に並べ替えて使う */
  sortedTimeKeys?: string[];

  showTableStart: boolean;
  setShowTableStart: Dispatch<SetStateAction<boolean>>;
  courseStartFiltered: boolean;
  setCourseStartFiltered: Dispatch<SetStateAction<boolean>>;
  filterCourse: string;
  setFilterCourse: Dispatch<SetStateAction<string>>;
  courses: CourseDef[];

  startSort?: 'table' | 'guests';
  setStartSort?: Dispatch<SetStateAction<'table' | 'guests'>>;
  showGuestsAll?: boolean;
  rotatingTables?: Record<string, string> | Set<string>;
  firstRotatingId?: Record<string, string>;
};

const CourseStartSection = memo(function CourseStartSection(props: Props) {
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

  const [highlightNow, setHighlightNow] = useState(() => Date.now());
  const defaultCourseColorStyle = useMemo(() => getCourseColorStyle(null), []);
  const courseColorMap = useMemo(() => {
    const map = new Map<string, CourseColorStyle>();
    for (const course of courses) {
      const key = normalizeCourseColor(course.color);
      map.set(course.name, getCourseColorStyle(key));
    }
    map.set('未選択', defaultCourseColorStyle);
    return map;
  }, [courses, defaultCourseColorStyle]);

  // 並び替えモード（親から渡されなければローカルで管理）
  const [innerStartSort, setInnerStartSort] = useState<'table' | 'guests'>(() => {
    return (props.startSort as 'table' | 'guests') ?? 'table';
  });
  const curStartSort: 'table' | 'guests' = props.startSort ?? innerStartSort;
  const onChangeStartSort = props.setStartSort ?? setInnerStartSort;

  // small info popovers for control toggles
  const [openInfo, setOpenInfo] = useState<null | 'showTable' | 'applyPre'>(null);
  const toggleInfo = (k: 'showTable' | 'applyPre') => {
    setOpenInfo(prev => (prev === k ? null : k));
  };

  // 親が startSort を後から渡してきた場合にローカルへ反映
  useEffect(() => {
    if (props.startSort && !props.setStartSort) setInnerStartSort(props.startSort);
  }, [props.startSort, props.setStartSort]);

  useEffect(() => {
    const id = window.setInterval(() => setHighlightNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const getCreatedAtMs = useCallback((r: Reservation): number => {
    const createdAtMs = Number((r as any)?.createdAtMs);
    if (Number.isFinite(createdAtMs) && createdAtMs > 0) return Math.trunc(createdAtMs);

    const createdAt = (r as any)?.createdAt;
    if (createdAt?.toMillis) return createdAt.toMillis();
    if (
      createdAt &&
      typeof createdAt?.seconds === 'number' &&
      Number.isFinite(createdAt.seconds)
    ) {
      const seconds = Math.trunc(createdAt.seconds);
      const nanos = Number.isFinite(createdAt.nanoseconds)
        ? Math.trunc(createdAt.nanoseconds)
        : 0;
      return seconds * 1000 + Math.floor(nanos / 1_000_000);
    }
    if (typeof createdAt === 'number' && Number.isFinite(createdAt)) {
      return Math.trunc(createdAt);
    }
    if (typeof createdAt === 'string') {
      const ms = Date.parse(createdAt);
      if (!Number.isNaN(ms)) return ms;
    }

    if (typeof r.id === 'string' && /^\d{10,}$/.test(r.id)) {
      const n = Number(r.id);
      if (Number.isFinite(n)) return Math.trunc(n);
    }

    return 0;
  }, []);

  const getFreshUntilMs = useCallback(
    (r: Reservation): number => {
      const raw = Number((r as any)?.freshUntilMs);
      if (Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
      const created = getCreatedAtMs(r);
      return created > 0 ? created + NEW_THRESHOLD : 0;
    },
    [getCreatedAtMs]
  );

  const fallbackKeys = useMemo(
    () =>
      Object.keys(groupedStartTimes).sort(
        (a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b)
      ),
    [groupedStartTimes]
  );

  const keys = sortedTimeKeys ?? fallbackKeys;

  const timeSummaries = useMemo(() => {
    const summary: Record<string, { totalReservations: number; totalGuests: number }> = {};
    for (const timeKey of keys) {
      const groups = groupedStartTimes[timeKey] ?? [];
      let totalReservations = 0;
      let totalGuests = 0;
      for (const group of groups) {
        totalReservations += group.reservations.length;
        for (const r of group.reservations) {
          totalGuests += Number(r.guests) || 0;
        }
      }
      summary[timeKey] = { totalReservations, totalGuests };
    }
    return summary;
  }, [keys, groupedStartTimes]);

  useEffect(() => {
    setHighlightNow(Date.now());
  }, [groupedStartTimes, keys]);

  return (
    <section className="space-y-4">
      {/* コントロール行 */}
      <div className="px-1 py-2 border-b border-gray-200">
        <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-4 gap-y-2">
          <div className="inline-flex items-center gap-1.5 text-sm md:text-base text-gray-700">
            <button
              type="button"
              onClick={() => setShowTableStart((prev) => !prev)}
              aria-pressed={showTableStart}
              aria-label="卓番号を表示"
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
                showTableStart ? 'bg-emerald-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                  showTableStart ? 'translate-x-4' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-xs md:text-sm text-gray-700">卓番号を表示</span>
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
          </div>
          {openInfo === 'showTable' && (
            <div id="help-show-table" className="mt-1 ml-6 text-[11px] md:text-xs text-gray-600 space-y-1">
              <p>
                下のコース開始時間表で、<strong className="font-semibold">卓番号</strong>を表示するかどうかを切り替えられます。
                左側が卓番号、右側の括弧が<strong className="font-semibold">人数</strong>です。
              </p>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-500">例：</span>
                <span className="inline-flex items-center rounded-md border border-gray-200 px-2 py-0.5 text-[12px] leading-tight text-gray-800 gap-1 bg-white md:px-2.5 md:py-1 md:text-sm">
                  <span className="tabular-nums">2</span>
                  <span>（<span className="tabular-nums">4</span>）</span>
                </span>
                <span className="inline-flex items-center rounded-md border border-gray-200 px-2 py-0.5 text-[12px] leading-tight text-gray-800 gap-1 bg-white md:px-2.5 md:py-1 md:text-sm">
                  <span className="tabular-nums">7</span>
                  <span>（<span className="tabular-nums">6</span>）</span>
                </span>
              </div>
            </div>
          )}

          <div className="inline-flex items-center gap-1.5 text-sm md:text-base text-gray-700">
            <button
              type="button"
              onClick={() => setCourseStartFiltered((prev) => !prev)}
              aria-pressed={courseStartFiltered}
              aria-label="営業前設定のフィルターを反映"
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
                courseStartFiltered ? 'bg-emerald-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                  courseStartFiltered ? 'translate-x-4' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-xs md:text-sm text-gray-700">営業前設定のフィルターを反映</span>
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
          </div>
          {openInfo === 'applyPre' && (
            <div id="help-apply-pre" className="mt-1 ml-6 text-[11px] md:text-xs text-gray-600 space-y-1">
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
            <span className="hidden sm:inline text-[11px] md:text-xs text-gray-500 mr-1">並び替え：</span>
            <div className="inline-flex whitespace-nowrap rounded-md overflow-hidden border border-gray-300 h-7 sm:h-8">
              <button
                type="button"
                aria-pressed={curStartSort === 'table'}
                onClick={() => onChangeStartSort('table')}
                className={`inline-flex items-center h-7 px-2 text-[11px] leading-none sm:h-8 sm:px-3 sm:text-sm md:h-9 md:px-3.5 md:text-base focus:outline-none transition-colors ${
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
                className={`inline-flex items-center h-7 px-2 text-[11px] leading-none sm:h-8 sm:px-3 sm:text-sm md:h-9 md:px-3.5 md:text-base border-l border-gray-300 focus:outline-none transition-colors ${
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
            <span className="hidden sm:inline text-[11px] md:text-xs text-gray-500 mr-1">絞り込み：</span>
            <select
              className="h-7 sm:h-8 md:h-9 text-[12px] sm:text-sm md:text-base rounded-md border border-gray-300 bg-white px-1.5 sm:px-2.5 md:px-3 focus:outline-none focus:ring-2 focus:ring-indigo-400 min-w-[76px]"
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
        {keys.map((timeKey) => {
          const summary = timeSummaries[timeKey] ?? { totalReservations: 0, totalGuests: 0 };
          const groups = groupedStartTimes[timeKey] ?? [];
          return (
            <div key={timeKey} className="border-2 border-gray-300 rounded-md p-3 bg-white shadow-sm">
            {/* 時刻ヘッダー + 合計 */}
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-4 w-1 rounded bg-indigo-300" />
                <span className="text-xl lg:text-2xl font-bold text-gray-900 tracking-wide">
                  {timeKey}
                </span>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[12px] md:text-[13px] lg:text-sm font-semibold text-gray-800 shadow-sm">
                <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-gray-500" />
                合計
                <span className="tabular-nums">{summary.totalReservations}</span>
                件（
                <span className="tabular-nums">{summary.totalGuests}</span>
                人）
              </span>
            </div>

            {/* コースごとの行 */}
            <div className="space-y-2">
              {groups.map((group) => {
                const courseCount = group.reservations.length;
                const courseGuests = group.reservations.reduce((s, r) => s + (Number(r.guests) || 0), 0);

                // --- フォールバック：コース名が空/undefined の場合は '未選択' に寄せる ---
                const courseLabel = (group.courseName && group.courseName.trim()) ? group.courseName : '未選択';

                const courseStyle =
                  courseColorMap.get(courseLabel) ?? defaultCourseColorStyle;

                return (
                  <div
                    key={courseLabel + timeKey}
                    className="flex flex-wrap items-center gap-2 border rounded-md px-2 py-1 bg-gray-50 hover:bg-gray-100/50 transition-colors"
                  >
                    {/* コース名 + コース内合計 */}
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: courseStyle.text }}
                      />
                      <span
                        className="text-sm md:text-sm lg:text-base font-semibold tracking-tight"
                        style={{ color: courseStyle.text }}
                      >
                        {courseLabel}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] md:text-[11px] lg:text-xs font-medium text-gray-700 shadow-sm">
                      <span className="tabular-nums">{courseCount}</span>
                      <span>
                        件（
                        <span className="tabular-nums">{courseGuests}</span>
                        人）
                      </span>
                    </span>

                    {/* 予約のチップ（卓番（人数） or 名前） */}
                    <div className="flex flex-wrap items-center gap-1 w-full mt-1 md:gap-1.5 md:mt-1.5">
                      {[...group.reservations]
                        .sort((a, b) => {
                          if (curStartSort === 'guests') {
                            const ga = Number(a.guests) || 0;
                            const gb = Number(b.guests) || 0;
                            if (gb !== ga) return gb - ga; // 人数の多い順
                          }
                          // 卓番のフォールバック：a.table -> a.tables[0] -> 0
                          const ta = Number((a.table ?? (Array.isArray(a.tables) ? a.tables[0] : '')) || 0) || 0;
                          const tb = Number((b.table ?? (Array.isArray(b.tables) ? b.tables[0] : '')) || 0) || 0;
                          return ta - tb; // 卓番の小さい順
                        })
                        .map((r) => {
                          const tableValue = r.table ?? (Array.isArray(r.tables) ? r.tables[0] : '');
                          const tableStr = String(tableValue ?? '');
                          const guestsNum = Number(r.guests) || 0;
                          const freshUntil = getFreshUntilMs(r);
                          const isFresh = freshUntil > 0 && highlightNow <= freshUntil;

                          return (
                            <span
                              key={r.id}
                              className="relative inline-flex items-center rounded-md border border-gray-200 px-2.5 py-0.5 text-[13px] leading-tight text-gray-800 gap-1 md:px-3 md:py-1 md:text-[0.8rem] lg:text-sm"
                            >
                              {isFresh && (
                                <span
                                  aria-hidden="true"
                                  className="absolute -left-1 -top-1 h-2 w-2 rounded-full border border-white bg-emerald-500 shadow-sm"
                                />
                              )}
                              {showTableStart ? (
                                <>
                                  <span className="tabular-nums">{tableStr}</span>
                                  {showGuestsAll ? (
                                    <span className="text-black">({guestsNum})</span>
                                  ) : null}
                                </>
                              ) : (
                                <span className="leading-none">
                                  {r.name || (showGuestsAll ? `(${guestsNum})` : '')}
                                </span>
                              )}
                            </span>
                          );
                        })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
        })}
      </div>
    </section>
  );
});

export default CourseStartSection;
