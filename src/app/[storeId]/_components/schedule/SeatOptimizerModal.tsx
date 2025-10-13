'use client';

import { useState } from 'react';

export type SeatOptimizerPreviewRow = {
  id: string;
  time: string;
  name: string;
  guests: number;
  currentTables: string[];
  suggestedTables: string[];
  action: 'keep' | 'move' | 'split' | 'cancel';
  reason?: string;
  arrived?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  basePrompt: string;
  sessionPrompt: string;
  onSessionPromptChange: (value: string) => void;
  onClearSessionPrompt: () => void;
  onPreview: () => Promise<void> | void;
  onApply: () => Promise<void> | void;
  onClearPreview: () => void;
  loading: boolean;
  sessionLoading?: boolean;
  error?: string | null;
  previewRows: SeatOptimizerPreviewRow[];
  notes: string[];
  rawText?: string;
};

const PromptBlock = ({ label, text }: { label: string; text: string }) => (
  <section className="space-y-2">
    <header className="flex items-center justify-between">
      <span className="text-sm font-semibold text-gray-700">{label}</span>
      <span className="text-xs text-gray-400">{text.length} 文字</span>
    </header>
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
      {text || '（未設定）'}
    </pre>
  </section>
);

export default function SeatOptimizerModal({
  open,
  onClose,
  basePrompt,
  sessionPrompt,
  onSessionPromptChange,
  onClearSessionPrompt,
  onPreview,
  onApply,
  onClearPreview,
  loading,
  sessionLoading,
  error,
  previewRows,
  notes,
  rawText,
}: Props) {
  const [showRaw, setShowRaw] = useState(false);

  if (!open) return null;

  const hasPreview = previewRows.length > 0;

  return (
    <div className="fixed inset-0 z-[2000] flex items-start justify-center bg-black/40 px-2 py-4 sm:px-4 sm:py-6 overflow-y-auto">
      <div className="relative flex w-full max-w-5xl flex-col gap-6 rounded-xl bg-white p-4 sm:p-6 shadow-2xl max-h-[calc(100vh-3rem)] overflow-y-auto">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">席効率化プレビュー</h2>
            <p className="mt-1 text-sm text-gray-600">
              ベースプロンプトと当日の追記を GPT に送信し、卓割り提案をプレビューします。提案内容は適用ボタンを押すまで他端末には反映されません。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-100"
            aria-label="閉じる"
          >
            ×
          </button>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <PromptBlock label="ベースプロンプト" text={basePrompt} />
          <section className="space-y-2">
            <header className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">当日の追記</span>
              {sessionLoading && <span className="text-xs text-blue-500">同期中…</span>}
            </header>
            <textarea
              className="h-40 w-full resize-y rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={sessionPrompt}
              onChange={(e) => onSessionPromptChange(e.target.value)}
              placeholder="例: 12時の8名様は31卓をご希望なので移動させない"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <button
                type="button"
                className="text-blue-600 hover:underline"
                onClick={onClearSessionPrompt}
              >
                入力をクリア
              </button>
              <span>{sessionPrompt.length} 文字</span>
            </div>
          </section>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">提案内容</h3>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <button
                type="button"
                onClick={() => setShowRaw((prev) => !prev)}
                className="rounded border border-gray-200 px-2 py-1 transition hover:bg-gray-100"
              >
                {showRaw ? '構造表示に戻る' : '生データを見る'}
              </button>
              {hasPreview && (
                <button
                  type="button"
                  onClick={onClearPreview}
                  className="rounded border border-gray-200 px-2 py-1 text-gray-600 transition hover:bg-gray-100"
                >
                  プレビュー解除
                </button>
              )}
            </div>
          </div>

          {showRaw ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {rawText || '（プレビューがありません）'}
            </pre>
          ) : (
            <div className="space-y-4">
              {notes.length > 0 && (
                <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                  <p className="mb-1 font-semibold">GPT からの補足</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {notes.map((note, idx) => (
                      <li key={idx}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">時刻</th>
                      <th className="px-3 py-2 text-left">予約</th>
                      <th className="px-3 py-2 text-left">人数</th>
                      <th className="px-3 py-2 text-left">現在の卓</th>
                      <th className="px-3 py-2 text-left">提案された卓</th>
                      <th className="px-3 py-2 text-left">理由</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {previewRows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                          プレビューがありません。プレビューを実行すると提案が表示されます。
                        </td>
                      </tr>
                    )}
                    {previewRows.map((row) => (
                      <tr key={row.id} className="align-top">
                        <td className="px-3 py-2 text-gray-700">{row.time}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-800">{row.name || `予約ID: ${row.id}`}</div>
                          <div className="text-xs text-gray-500">{row.action === 'keep' ? '変更なし' : row.action === 'cancel' ? 'キャンセル提案' : row.action === 'split' ? '分割提案' : '移動提案'}</div>
                          {row.arrived && <div className="text-xs text-green-600">来店済み（固定）</div>}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{row.guests}</td>
                        <td className="px-3 py-2 text-gray-700">{row.currentTables.join(', ') || '-'}</td>
                        <td className="px-3 py-2 text-gray-700">{row.suggestedTables.join(', ') || '-'}</td>
                        <td className="px-3 py-2 text-gray-600">{row.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <footer className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
          >
            閉じる
          </button>
          <button
            type="button"
            onClick={onPreview}
            disabled={loading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {loading ? '計算中…' : 'プレビュー'}
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!hasPreview || loading}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            適用
          </button>
        </footer>
      </div>
    </div>
  );
}
