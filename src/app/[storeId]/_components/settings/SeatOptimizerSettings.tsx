'use client';

import type { SeatOptimizerConfig } from '@/types/settings';

type Props = {
  value: SeatOptimizerConfig;
  onUpdate: (next: SeatOptimizerConfig) => void;
};

export default function SeatOptimizerSettings({ value, onUpdate }: Props) {
  const basePrompt = value?.basePrompt ?? '';

  return (
    <div className="flex flex-col gap-6 px-4 py-6">
      <section className="space-y-3">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">席効率化プロンプト</h2>
          <p className="text-sm text-gray-600">
            GPT に渡す基本方針を店舗ごとに登録します。席の結合・団体優先・避けたい卓など、固定のルールや注意事項を記載してください。
          </p>
        </header>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <label className="flex flex-col gap-2 text-sm">
            <span className="font-medium">ベースプロンプト</span>
            <textarea
              className="min-h-[160px] w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={basePrompt}
              onChange={(e) => onUpdate({ ...value, basePrompt: e.target.value })}
              placeholder="例: 31~35卓で20名まで連結可。37卓は36/38と分割可能…"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>営業中の追記はスケジュール画面の「当日の追記」で入力します。</span>
              <span>{basePrompt.length} 文字</span>
            </div>
          </label>
        </div>
      </section>
    </div>
  );
}
