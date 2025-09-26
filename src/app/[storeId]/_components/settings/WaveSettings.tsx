'use client';
import * as React from 'react';
import { DEFAULT_WAVE, type StoreSettingsValue } from '@/types/settings';

export default function WaveSettings({
  value,
  onChange,
}: {
  value: StoreSettingsValue;
  onChange: (patch: Partial<StoreSettingsValue>) => void;
}) {
  // 既定値を適用した現在の wave 設定
  const wave = React.useMemo(
    () => ({ ...DEFAULT_WAVE, ...(value.wave ?? {}) }),
    [value.wave]
  );
  const step = wave.bucketMinutes ?? 5; // 5分刻み

  // UI用: メーター表示（静か寄りの割合 = 相対%）
  const [relativePct, setRelativePct] = React.useState<number>(
    Math.max(0, Math.min(100, Math.round(((Number(wave.percentile ?? 30) - 10) / 40) * 100)))
  );
  const activeSegs = Math.min(5, Math.floor(relativePct / 20) + 1);

  // ローカル入力状態（空文字も許容してタイピングしやすく）
  const [threshold, setThreshold] = React.useState(String(wave.threshold));

  // 相対%（メイン設定）
  React.useEffect(() => {
    const ui = Math.max(0, Math.min(100, Math.round(((Number(wave.percentile ?? 30) - 10) / 40) * 100)));
    setRelativePct(ui);
  }, [wave.percentile]);

  // 親の値が変わったら同期
  React.useEffect(() => setThreshold(String(wave.threshold)), [wave.threshold]);

  // Utilities
  const clampNonNeg = (n: number) => (Number.isFinite(n) && n >= 0 ? n : 0);

  const commit = (next: Partial<typeof wave>) => {
    const merged = { ...wave, ...next };
    onChange({ wave: merged });
  };

  // 各フィールドの commit
  const commitThreshold = () => {
    const n = clampNonNeg(Number(threshold));
    commit({ threshold: n });
  };

  return (
    <div className="space-y-5">
      <section className="rounded-md border bg-gradient-to-b from-white to-sky-50/40">
        <header className="px-4 py-3 border-b font-semibold text-slate-800 flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-sky-500" />
          「余裕のある時間」の判断基準
        </header>
        <div className="p-4 space-y-4">
          {/* 相対%（メイン設定） */}
          <div>
            <label htmlFor="wave-relative" className="block text-sm font-medium text-gray-700">
              余裕のある時間の判断基準
            </label>
            <div className="mt-2 flex items-center gap-4">
              <input
                id="wave-relative"
                type="range"
                min={0}
                max={100}
                step={1}
                value={relativePct}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(100, Number(e.currentTarget.value)));
                  setRelativePct(v);
                  const p = 10 + (v / 100) * 40; // 内部は 10〜50 に写像
                  onChange({
                    wave: {
                      ...wave,
                      mode: 'hybrid',
                      percentile: p,
                      maxRatio: p / 100,
                    },
                  });
                }}
                className="flex-1 accent-sky-600"
              />
            </div>

            {/* 視覚メーター（段階表示：左=厳しめ／右=ゆるめ） */}
            <div className="mt-3 space-y-1.5">
              <div className="grid grid-cols-5 gap-1">
                {[0,1,2,3,4].map((i) => (
                  <div key={i} className={`h-2 rounded ${i < activeSegs ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                ))}
              </div>
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>厳しめ</span>
                <span>ゆるめ</span>
              </div>
            </div>

            <p className="mt-2 text-xs text-gray-600">
              数値が小さいほど「余裕のある時間」と判断される時間帯が減ります。数値が大きいほど、その時間帯は増えます。ミニタスクは「余裕のある時間」に通知されます。
            </p>
          </div>

          {/* 詳細設定（折りたたみ） */}
          <details className="group rounded-md border border-slate-200 bg-white/60">
            <summary className="flex items-center gap-2 cursor-pointer select-none px-3 py-2 text-sm font-medium text-gray-800">
              <svg viewBox="0 0 20 20" className="h-3 w-3 text-slate-500 transition-transform group-open:rotate-90" fill="none">
                <path d="M7 5l6 5-6 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>詳細設定</span>
              <span className="ml-2 text-xs text-gray-500">(必要な店舗のみ)</span>
            </summary>
            <div className="border-t px-4 py-3 space-y-4">

              {/* 閾値（相対の下限） */}
              <div>
                <label htmlFor="wave-threshold" className="block text-sm font-medium text-gray-700">
                  下限の基準（指標）
                </label>
                <div className="mt-1 space-y-1">
                  <div className="flex items-center gap-3">
                    <input
                      id="wave-threshold"
                      type="number"
                      inputMode="numeric"
                      className="w-40 rounded-md border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                      value={threshold}
                      onChange={(e) => setThreshold(e.currentTarget.value)}
                      onBlur={commitThreshold}
                      onKeyDown={(e) => e.key === 'Enter' && commitThreshold()}
                      min={0}
                      step={1}
                    />
                  </div>
                  <div className="text-[11px] text-gray-500 leading-relaxed">
                    指標の考え方：<span className="font-medium">その時間の「タスク数 × 関わるお客様の人数」</span>を目安にしています。<br />
                    この指標より低い時間帯を「余裕のある時間」と判断します。
                  </div>
                </div>
              </div>

            </div>
          </details>

        </div>
      </section>

      <p className="text-[12px] text-gray-500">
        ※ 入力はこの画面から即時反映されます（保存ボタンのある場合は、店舗設定全体の保存と連動します）。
      </p>
    </div>
  );
}
