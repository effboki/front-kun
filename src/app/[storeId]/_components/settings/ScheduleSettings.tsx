

import * as React from 'react';
import type { StoreSettingsValue, ScheduleConfig, CourseDef } from '@/types/settings';

export type ScheduleSettingsProps = {
  value: StoreSettingsValue;
  onChange: (patch: Partial<StoreSettingsValue>) => void;
};

const clampHour = (n: number) => Math.min(47, Math.max(0, Math.floor(n)));

export default function ScheduleSettings({ value, onChange }: ScheduleSettingsProps) {
  const schedule = value.schedule ?? { dayStartHour: 17, dayEndHour: 23 } as ScheduleConfig;
  const [start, setStart] = React.useState<number>(schedule.dayStartHour);
  const [end, setEnd] = React.useState<number>(schedule.dayEndHour);

  React.useEffect(() => {
    setStart(value.schedule?.dayStartHour ?? 17);
    setEnd(value.schedule?.dayEndHour ?? 23);
  }, [value.schedule?.dayStartHour, value.schedule?.dayEndHour]);

  const commitSchedule = React.useCallback((next: { start?: number; end?: number }) => {
    const s = clampHour(next.start ?? start);
    const e = clampHour(next.end ?? end);
    onChange({ schedule: { dayStartHour: s, dayEndHour: e } });
  }, [start, end, onChange]);

  const courses = React.useMemo<CourseDef[]>(() => value.courses ?? [], [value.courses]);

  const updateStay = (idx: number, raw: string) => {
    const min = Number(raw);
    const stayMinutes = Number.isFinite(min) && min > 0 ? Math.floor(min) : undefined;
    const next = courses.map((c, i) => i === idx ? { ...c, stayMinutes } : c);
    onChange({ courses: next });
  };

  const setAllStay = (raw: string) => {
    const min = Number(raw);
    const stayMinutes = Number.isFinite(min) && min > 0 ? Math.floor(min) : undefined;
    const next = courses.map((c) => ({ ...c, stayMinutes }));
    onChange({ courses: next });
  };

  return (
    <div className="space-y-8">
      {/* スケジュール表示時間 */}
      <section>
        <h3 className="text-sm font-semibold mb-2">スケジュール表示時間</h3>
        <p className="text-xs text-gray-500 mb-3">※ 0〜47 時の範囲で設定できます（例：26 = 翌日 2:00）。</p>
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
          <button
            type="button"
            className="px-3 py-1 border rounded text-sm"
            onClick={() => commitSchedule({})}
            aria-label="スケジュール時間を保存"
          >保存</button>
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
                  placeholder="例: 60"
                  className="w-24 px-2 py-1 border rounded"
                  onChange={(e) => setAllStay(e.currentTarget.value)}
                />
              </label>
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
                  <th className="text-left px-3 py-2 font-medium w-48">滞在時間（分）</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((c, idx) => (
                  <tr key={c.name} className="border-t">
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={15}
                        step={5}
                        className="w-28 px-2 py-1 border rounded"
                        value={typeof c.stayMinutes === 'number' && c.stayMinutes > 0 ? c.stayMinutes : ''}
                        placeholder="例: 60"
                        onChange={(e) => updateStay(idx, e.currentTarget.value)}
                      />
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