'use client';
import * as React from 'react';
import type { StoreSettingsValue, ScheduleConfig, CourseDef } from '@/types/settings';

export type ScheduleSettingsProps = {
  value: StoreSettingsValue;
  onChange: (patch: Partial<StoreSettingsValue>) => void;
};

const clampHour = (n: number) => Math.min(47, Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));

function Chevron({ open, className = '' }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`transform transition-transform duration-200 ${open ? 'rotate-180' : ''} ${className}`}
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M6 8L10 12L14 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ScheduleSettings({ value, onChange }: ScheduleSettingsProps) {
  // ---- Schedule hours (0..47) ----
  const schedule: ScheduleConfig = (value.schedule ?? { dayStartHour: 17, dayEndHour: 23 }) as ScheduleConfig;
  const [start, setStart] = React.useState<number>(schedule.dayStartHour);
  const [end, setEnd] = React.useState<number>(schedule.dayEndHour);

  const [openScheduleSec, setOpenScheduleSec] = React.useState(true);
  const [openCoursesSec, setOpenCoursesSec] = React.useState(true);

  const hourOptions = React.useMemo(() => Array.from({ length: 48 }, (_, h) => h), []);

  React.useEffect(() => {
    setStart(value.schedule?.dayStartHour ?? 17);
    setEnd(value.schedule?.dayEndHour ?? 23);
  }, [value.schedule?.dayStartHour, value.schedule?.dayEndHour]);

  const commitSchedule = React.useCallback((next?: { start?: number; end?: number }) => {
    const s = clampHour(next?.start ?? start);
    const e = clampHour(next?.end ?? end);
    onChange({ schedule: { dayStartHour: s, dayEndHour: e } as ScheduleConfig });
  }, [start, end, onChange]);

  // ---- Courses stay minutes ----
  const courses = React.useMemo<CourseDef[]>(() => (value.courses ?? []) as CourseDef[], [value.courses]);

  const stayChoices = React.useMemo(() => Array.from({ length: 49 }, (_, i) => i * 5), []);

  const updateStay = (idx: number, raw: string) => {
    const s = raw.trim();
    let stayMinutes: number | undefined;
    if (s === '') {
      stayMinutes = undefined;
    } else {
      const num = Number(s);
      stayMinutes = Number.isFinite(num) ? Math.max(0, Math.floor(num)) : undefined;
    }
    const next = courses.map((c, i) => (i === idx ? { ...c, stayMinutes } : c));
    onChange({ courses: next });
  };

  const setAllStay = (raw: string) => {
    const num = Number(raw);
    const stayMinutes = Number.isFinite(num) && num > 0 ? Math.floor(num) : undefined;
    const next = courses.map((c) => ({ ...c, stayMinutes }));
    onChange({ courses: next });
  };

  return (
    <div className="space-y-8 min-h-0 pb-24 max-w-[720px] mx-auto text-[13px]">
      {/* スケジュール表示時間（トグル） */}
      <section>
        <div className="overflow-hidden rounded-lg border border-slate-200 shadow-sm">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-[13px]"
            onClick={() => setOpenScheduleSec((v) => !v)}
            aria-expanded={openScheduleSec}
          >
            <span className="font-medium">スケジュール表示時間</span>
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full border text-sky-700 border-sky-300 bg-sky-50">
              <Chevron open={openScheduleSec} />
            </span>
          </button>
          {openScheduleSec && (
            <div className="px-4 py-3 bg-white">
              <p className="text-[11px] inline-block mb-3 px-2 py-1 rounded border border-sky-200 bg-sky-50 text-sky-700">0〜47 時（例：26 = 翌日 2:00）で設定できます。</p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs">
                  開始（時）
                  <select
                    className="ml-2 w-20 px-2 py-0.5 text-xs border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400"
                    value={start}
                    onChange={(e) => {
                      const v = clampHour(Number(e.currentTarget.value));
                      setStart(v);
                      commitSchedule({ start: v });
                    }}
                    aria-label="開始時刻を選択"
                  >
                    {hourOptions.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  終了（時）
                  <select
                    className="ml-2 w-20 px-2 py-0.5 text-xs border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400"
                    value={end}
                    onChange={(e) => {
                      const v = clampHour(Number(e.currentTarget.value));
                      setEnd(v);
                      commitSchedule({ end: v });
                    }}
                    aria-label="終了時刻を選択"
                  >
                    {hourOptions.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* コース滞在時間（トグル） */}
      <section>
        <div className="overflow-hidden rounded-lg border border-slate-200 shadow-sm">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-[13px]"
            onClick={() => setOpenCoursesSec((v) => !v)}
            aria-expanded={openCoursesSec}
          >
            <span className="font-medium">コース滞在時間（分）</span>
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full border text-emerald-700 border-emerald-300 bg-emerald-50">
              <Chevron open={openCoursesSec} />
            </span>
          </button>
          {openCoursesSec && (
            <div className="px-4 py-3 bg-white">
              {courses.length === 0 ? (
                <p className="text-xs text-slate-500">コースが未設定です。「コース設定」から追加してください。</p>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="min-w-full text-xs table-fixed">
                    <colgroup>
                      <col className="w-[44%]" />
                      <col className="w-[36%]" />
                      <col className="w-[96px]" />
                    </colgroup>
                    <thead className="bg-emerald-50/60 text-emerald-900 text-xs">
                      <tr>
                        <th className="text-left px-2.5 py-1.5 font-medium">コース名</th>
                        <th className="text-center px-2.5 py-1.5 font-medium">滞在時間（分）</th>
                        <th className="text-right px-2.5 py-1.5 font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {courses.map((c, idx) => (
                        <tr key={c.name ?? idx} className="border-t hover:bg-emerald-50/40 transition-colors align-middle">
                          {/* コース名：折り返し禁止 */}
                          <td className="px-2.5 py-1.5 whitespace-nowrap">{c.name}</td>

                          {/* 滞在時間セレクト：中央配置 */}
                          <td className="px-2.5 py-1.5 text-center">
                            <select
                              className="px-2 py-0.5 w-16 mx-auto text-xs border rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400"
                              value={c.stayMinutes != null && c.stayMinutes >= 0 ? String(c.stayMinutes) : ''}
                              onChange={(e) => updateStay(idx, e.currentTarget.value)}
                              aria-label={`${c.name} の滞在時間プリセット`}
                            >
                              <option value="">未設定</option>
                              {stayChoices.map((m) => (
                                <option key={m} value={String(m)}>{m}</option>
                              ))}
                            </select>
                          </td>

                          {/* クリア：一番右 */}
                          <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                            <button
                              type="button"
                              className="inline-flex items-center justify-center min-w-[3rem] text-xs px-2 py-0.5 border rounded-md text-rose-700 border-rose-200 hover:bg-rose-50 whitespace-nowrap"
                              onClick={() => updateStay(idx, '')}
                              aria-label={`${c.name} の滞在時間をクリア`}
                            >
                              クリア
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}