'use client';
import * as React from 'react';
import type { StoreSettingsValue, ScheduleConfig, CourseDef } from '@/types/settings';

export type ScheduleSettingsProps = {
  value: StoreSettingsValue;
  onChange: (patch: Partial<StoreSettingsValue>) => void;
};

const clampHour = (n: number) => Math.min(47, Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));

export default function ScheduleSettings({ value, onChange }: ScheduleSettingsProps) {
  // ---- Schedule hours (0..47) ----
  const schedule: ScheduleConfig = (value.schedule ?? { dayStartHour: 17, dayEndHour: 23 }) as ScheduleConfig;
  const [start, setStart] = React.useState<number>(schedule.dayStartHour);
  const [end, setEnd] = React.useState<number>(schedule.dayEndHour);

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

  const updateStay = (idx: number, raw: string) => {
    const num = Number(raw);
    const stayMinutes = Number.isFinite(num) && num > 0 ? Math.floor(num) : undefined;
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
    <div className="space-y-8 min-h-0 pb-24">
      {/* スケジュール表示時間 */}
      <section>
        <h3 className="text-sm font-semibold mb-2">スケジュール表示時間</h3>
        <p className="text-xs text-gray-500 mb-3">0〜47 時（例：26 = 翌日 2:00）で設定できます。</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            開始（時）
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={47}
              step={1}
              className="ml-2 w-20 px-2 py-1 border rounded"
              value={start}
              onChange={(e) => setStart(clampHour(Number(e.currentTarget.value)))}
              onBlur={() => commitSchedule({ start })}
            />
          </label>
          <label className="text-sm">
            終了（時）
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={47}
              step={1}
              className="ml-2 w-20 px-2 py-1 border rounded"
              value={end}
              onChange={(e) => setEnd(clampHour(Number(e.currentTarget.value)))}
              onBlur={() => commitSchedule({ end })}
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-1 border rounded text-sm"
              onClick={() => commitSchedule()}
              aria-label="スケジュール時間を保存"
            >
              保存
            </button>
            <button
              type="button"
              className="px-3 py-1 border rounded text-sm"
              onClick={() => { setStart(10); setEnd(23); commitSchedule({ start: 10, end: 23 }); }}
            >
              10–23
            </button>
            <button
              type="button"
              className="px-3 py-1 border rounded text-sm"
              onClick={() => { setStart(15); setEnd(23); commitSchedule({ start: 15, end: 23 }); }}
            >
              15–23
            </button>
            <button
              type="button"
              className="px-3 py-1 border rounded text-sm"
              onClick={() => { setStart(17); setEnd(23); commitSchedule({ start: 17, end: 23 }); }}
            >
              既定(17–23)
            </button>
          </div>
        </div>
      </section>

      {/* コース滞在時間 */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">コース滞在時間（分）</h3>
          {courses.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1">
                一括設定：
                <input
                  type="number"
                  min={15}
                  step={5}
                  placeholder="例: 120"
                  className="w-24 px-2 py-1 border rounded"
                  onChange={(e) => setAllStay(e.currentTarget.value)}
                />
              </label>
              <select
                className="px-2 py-1 border rounded"
                onChange={(e) => setAllStay(e.currentTarget.value)}
                defaultValue=""
                aria-label="コース滞在時間を一括設定"
              >
                <option value="">未設定（自動）</option>
                {[60, 90, 120, 150, 180].map((m) => (
                  <option key={m} value={String(m)}>{m}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {courses.length === 0 ? (
          <p className="text-xs text-gray-500">コースが未設定です。「コース設定」から追加してください。</p>
        ) : (
          <div className="overflow-x-auto border rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">コース名</th>
                  <th className="text-left px-3 py-2 font-medium w-56">滞在時間（分）</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((c, idx) => (
                  <tr key={c.name ?? idx} className="border-t">
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={15}
                          step={5}
                          className="w-24 px-2 py-1 border rounded"
                          value={typeof c.stayMinutes === 'number' && c.stayMinutes > 0 ? c.stayMinutes : ''}
                          placeholder="例: 120"
                          onChange={(e) => updateStay(idx, e.currentTarget.value)}
                          aria-label={`${c.name} の滞在時間（分）`}
                        />
                        <select
                          className="px-2 py-1 border rounded"
                          value={typeof c.stayMinutes === 'number' && c.stayMinutes > 0 ? String(c.stayMinutes) : ''}
                          onChange={(e) => updateStay(idx, e.currentTarget.value)}
                          aria-label={`${c.name} の滞在時間プリセット`}
                        >
                          <option value="">未設定</option>
                          {[60, 90, 120, 150, 180].map((m) => (
                            <option key={m} value={String(m)}>{m}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="text-xs px-2 py-1 border rounded"
                          onClick={() => updateStay(idx, '')}
                          aria-label={`${c.name} の滞在時間をクリア`}
                        >
                          クリア
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}