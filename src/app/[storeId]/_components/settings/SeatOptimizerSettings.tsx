'use client';

import { useMemo } from 'react';
import type { SeatOptimizerConfig } from '@/types/settings';

type Props = {
  value: SeatOptimizerConfig;
  onUpdate: (next: SeatOptimizerConfig) => void;
};

const normalizeTags = (input: string): string[] => {
  return input
    .split(/[,\s\n]+/)
    .map((tag) => tag.trim())
    .filter((tag, idx, arr) => tag.length > 0 && arr.indexOf(tag) === idx);
};

export default function SeatOptimizerSettings({ value, onUpdate }: Props) {
  const basePrompt = value?.basePrompt ?? '';
  const tagsStr = useMemo(() => (value?.tags ?? []).join(', '), [value?.tags]);

  return (
    <div className="flex flex-col gap-6 px-4 py-6">
      <section className="space-y-3">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">席効率化プロンプト</h2>
          <p className="text-sm text-gray-600">
            GPT に渡す基本方針を店舗ごとに登録します。席の結合・団体優先・避けたい卓など、固定のルールを記載してください。
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
              <span>営業中も変更できる追記プロンプトはスケジュール画面で入力します。</span>
              <span>{basePrompt.length} 文字</span>
            </div>
          </label>
        </div>
      </section>
      <section className="space-y-3">
        <header className="space-y-1">
          <h3 className="text-base font-semibold">遅番では極力使いたくない卓</h3>
          <p className="text-sm text-gray-600">
            遅い時間帯の利用を避けたい卓番号があれば入力してください。席効率化のリクエストに含めます。複数ある場合はカンマ区切りで入力します。
          </p>
        </header>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <label className="flex flex-col gap-2 text-sm">
            <span className="font-medium">対象卓（カンマ / 改行で区切り）</span>
            <textarea
              className="min-h-[72px] w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={tagsStr}
              onChange={(e) => onUpdate({ ...value, tags: normalizeTags(e.target.value) })}
              placeholder="例: 41, 42, 43, 44"
            />
            <div className="text-xs text-gray-500">入力例: 41,42,43 / 41\n42\n43 など</div>
          </label>
        </div>
      </section>
    </div>
  );
}

