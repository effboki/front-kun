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

  // ローカル入力状態（空文字も許容してタイピングしやすく）
  const [threshold, setThreshold] = React.useState(String(wave.threshold));

  // 相対%（メイン設定）
  const [relativePct, setRelativePct] = React.useState<number>(Number(wave.percentile ?? 30));
  React.useEffect(() => {
    setRelativePct(Number(wave.percentile ?? 30));
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
      <section className="rounded-md border bg-white">
        <header className="px-4 py-3 border-b font-medium">波（忙しさ）設定</header>
        <div className="p-4 space-y-4">
          {/* 相対%（メイン設定） */}
          <div>
            <label htmlFor="wave-relative" className="block text-sm font-medium text-gray-700">
              通知感度（相対%）
            </label>
            <div className="mt-2 flex items-center gap-4">
              <input
                id="wave-relative"
                type="range"
                min={10}
                max={50}
                step={1}
                value={relativePct}
                onChange={(e) => {
                  const v = Math.min(50, Math.max(10, Number(e.currentTarget.value)));
                  setRelativePct(v);
                  // メインの操作は相対%のみ：内部はハイブリッドで賢く判定
                  onChange({
                    wave: {
                      ...wave,
                      mode: 'hybrid',
                      percentile: v,
                      maxRatio: v / 100, // 10〜50% をそのまま比率に
                    },
                  });
                }}
                className="flex-1 accent-indigo-600"
              />
              <div className="w-12 text-right text-sm font-medium text-gray-800">{relativePct}%</div>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              当日の波の強さに自動で合わせます。値が小さいほど「静かな帯」だけを狙って通知します（10〜50%）。
            </p>
          </div>

          {/* 詳細設定（折りたたみ） */}
          <details className="rounded-md border bg-white/40">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-gray-800">
              詳細設定
              <span className="ml-2 text-xs text-gray-500">(必要な店舗のみ)</span>
            </summary>
            <div className="border-t px-4 py-3 space-y-4">

              {/* 閾値（相対の下限） */}
              <div>
                <label htmlFor="wave-threshold" className="block text-sm font-medium text-gray-700">
                  忙しさの閾値（しきい値）
                </label>
                <div className="mt-1 flex items-center gap-3">
                  <input
                    id="wave-threshold"
                    type="number"
                    inputMode="numeric"
                    className="w-40 rounded-md border px-2 py-1.5"
                    value={threshold}
                    onChange={(e) => setThreshold(e.currentTarget.value)}
                    onBlur={commitThreshold}
                    onKeyDown={(e) => e.key === 'Enter' && commitThreshold()}
                    min={0}
                    step={1}
                  />
                  <span className="text-xs text-gray-500">
                    相対判定の下限として使用します。これ以下ならヒマ扱いになります。
                  </span>
                </div>
              </div>

            </div>
          </details>

          {/* 参考情報 */}
          <div className="mt-4 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <ul className="list-disc pl-4 space-y-1">
              <li>忙しさスコア = その時刻の <strong>タスク件数 × 人数合計</strong>。</li>
              <li>対象は「あなたのポジション ＋ 表示卓番」の範囲だけ。</li>
              <li>Calm 判定: 閾値未満が <strong>15 分</strong> 以上連続した区間。</li>
              <li>通知: Calm 開始 + <strong>3 分</strong> で発火。</li>
              <li>バケット幅: <strong>{step} 分</strong>（固定）</li>
            </ul>
          </div>
        </div>
      </section>

      <p className="text-[12px] text-gray-500">
        ※ 入力はこの画面から即時反映されます（保存ボタンのある場合は、店舗設定全体の保存と連動します）。
      </p>
    </div>
  );
}
