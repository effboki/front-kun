'use client';
import * as React from 'react';
import type { StoreSettingsValue, MiniTaskTemplate } from '@/types/settings';

export default function MiniTasksSettings({
  value,
  onChange,
}: {
  value: StoreSettingsValue;
  onChange: (patch: Partial<StoreSettingsValue>) => void;
}) {
  const positions = React.useMemo(() => value.positions ?? [], [value.positions]);
  const map = value.miniTasksByPosition ?? {};

  // --- 開閉状態の永続化（リロードや親再マウントでも維持） ---
  const OPEN_KEY = 'miniTasksSettings:open:v1';
  const initialOpen = React.useMemo(() => {
    if (typeof window === 'undefined') return {} as Record<string, boolean>;
    try {
      const raw = window.localStorage.getItem(OPEN_KEY);
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {} as Record<string, boolean>;
    }
  }, []);

  // 開閉状態（ポジションごと）
  const [openPos, setOpenPos] = React.useState<Record<string, boolean>>(initialOpen);
  const toggleOpen = (p: string) =>
    setOpenPos((prev) => ({ ...prev, [p]: !prev[p] }));

  // 変更があれば localStorage に保存
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(OPEN_KEY, JSON.stringify(openPos));
    } catch {}
  }, [openPos]);

  // positions の変化で存在しないキーを整理（名前変更/削除に対応）
  React.useEffect(() => {
    setOpenPos((prev) => {
      const next: Record<string, boolean> = {};
      positions.forEach((pos) => { if (prev[pos]) next[pos] = true; });
      // 差分がなければそのまま返す
      if (Object.keys(next).length === Object.keys(prev).length) return prev;
      return next;
    });
  }, [positions]);

  // 行内編集用のドラフト（ラベル）
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const draftValue = (id: string, fallback: string) => drafts[id] ?? fallback;

  // 追加用の入力（ポジションごと）
  const [newLabelByPos, setNewLabelByPos] = React.useState<Record<string, string>>({});
  const inputRefs = React.useRef<Record<string, HTMLInputElement | null>>({});
  const [isComposingByPos, setIsComposingByPos] = React.useState<Record<string, boolean>>({});

  const listFor = React.useCallback(
    (pos: string): MiniTaskTemplate[] => {
      const arr = (map[pos] ?? []).slice();
      arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label, 'ja'));
      return arr;
    },
    [map]
  );

  const commitMapForPos = (pos: string, nextForPos: MiniTaskTemplate[]) => {
    // order を 0..n に正規化
    const normalized = nextForPos.map((t, i) => ({ ...t, order: i }));
    onChange({ miniTasksByPosition: { ...(value.miniTasksByPosition ?? {}), [pos]: normalized } });
  };

  const toggleActive = (pos: string, id: string, active: boolean) => {
    const list = listFor(pos);
    const next = list.map((t) => (t.id === id ? { ...t, active } : t));
    commitMapForPos(pos, next);
  };

  const move = (pos: string, id: string, dir: 'up' | 'down') => {
    const list = listFor(pos);
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const j = dir === 'up' ? idx - 1 : idx + 1;
    if (j < 0 || j >= list.length) return;
    const copy = list.slice();
    const tmp = copy[idx];
    copy[idx] = copy[j];
    copy[j] = tmp;
    commitMapForPos(pos, copy);
  };

  const remove = (pos: string, id: string) => {
    const list = listFor(pos);
    const copy = list.filter((t) => t.id !== id);
    commitMapForPos(pos, copy);
    setDrafts((d) => {
      const { [id]: _, ...rest } = d;
      return rest;
    });
  };

  const commitLabel = (pos: string, id: string) => {
    const list = listFor(pos);
    const current = list.find((t) => t.id === id);
    if (!current) return;
    const label = (drafts[id] ?? current.label).trim();
    if (!label) return; // 空は無視
    const next = list.map((t) => (t.id === id ? { ...t, label } : t));
    commitMapForPos(pos, next);
    setDrafts((d) => {
      const { [id]: _, ...rest } = d;
      return rest;
    });
  };

  const add = (pos: string) => {
    const label = (newLabelByPos[pos] ?? '').trim();
    if (!label) return;
    const list = listFor(pos);
    const id = makeId(label);
    const next: MiniTaskTemplate[] = [...list, { id, label, active: true, order: list.length }];
    commitMapForPos(pos, next);
    setNewLabelByPos((s) => ({ ...s, [pos]: '' }));
    // 追加後も該当ポジションのトグルを開いたまま維持
    setOpenPos((prev) => ({ ...prev, [pos]: true }));
  };

  return (
    <div className="space-y-4">
      {positions.length === 0 ? (
        <p className="px-2 py-4 text-sm text-gray-500">ポジションが未設定です。先に「ポジション」設定から追加してください。</p>
      ) : (
        <ul className="space-y-2">
          {positions.map((p) => {
                const list = listFor(p);
                const total = list.length;
                const activeCount = list.filter((t) => t.active !== false).length;
                const isOpen = !!openPos[p];
                return (
                  <li key={p} className="rounded-lg border bg-white overflow-hidden">
                    {/* トグルヘッダー（コース設定表風：行全体が押せる＋右にシェブロン） */}
                    <button
                      type="button"
                      className="w-full grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 active:bg-slate-100"
                      onClick={() => toggleOpen(p)}
                      aria-expanded={isOpen}
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">{p}</div>
                      </div>
                      <svg
                        className={`h-5 w-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path fillRule="evenodd" d="M10 12a1 1 0 01-.707-.293l-3-3a1 1 0 111.414-1.414L10 9.586l2.293-2.293a1 1 0 111.414 1.414l-3 3A1 1 0 0110 12z" clipRule="evenodd" />
                      </svg>
                    </button>

                    {/* 展開コンテンツ */}
                    {isOpen && (
                      <div className="border-t p-3 space-y-3">
                        {total === 0 ? (
                          <p className="px-1 py-2 text-sm text-gray-500">このポジションのミニタスクは未登録です。下のフォームから追加できます。</p>
                        ) : (
                          <div className="rounded-lg border border-slate-200 bg-slate-50/60">
                            <div className="px-2 pt-2 pb-1 flex items-center gap-2">
                              <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
                              <span className="text-[12px] font-semibold text-slate-700">登録済みミニタスク</span>
                              <span className="ml-auto text-[11px] text-slate-500">{total}件</span>
                            </div>
                            <ul className="px-2 pb-2 space-y-1">
                              {list.map((t, i) => (
                                <li key={t.id} className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 bg-white">
                                  {/* ラベル編集のみ（チェックは非表示） */}
                                  <input
                                    type="text"
                                    className="flex-1 rounded-md border px-2 py-1 text-sm"
                                    value={draftValue(t.id, t.label)}
                                    onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.currentTarget.value }))}
                                    onBlur={() => commitLabel(p, t.id)}
                                    onKeyDown={(e) => e.key === 'Enter' && commitLabel(p, t.id)}
                                  />
                                  {/* 削除 */}
                                  <button
                                    type="button"
                                    className="ml-1 h-8 rounded border px-2 text-sm text-red-600 hover:bg-red-50"
                                    onClick={() => remove(p, t.id)}
                                    title="削除"
                                  >削除</button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* 追加フォーム（StoreSettingContent の追加カードと同等トーン） */}
                        <div className="mb-1 rounded-lg border border-blue-200 bg-gradient-to-b from-white to-blue-50/50 p-3 shadow-sm">
                          <header className="mb-2 flex items-center gap-2">
                            <span aria-hidden className="inline-grid place-items-center h-5 w-5 rounded-full bg-blue-600 text-white text-[12px] leading-none">＋</span>
                            <span className="text-sm font-semibold text-blue-700">テンプレを追加（{p}）</span>
                          </header>
                          <p className="text-gray-500 text-xs">
                            名前を入力し<strong className="mx-1">「＋追加」</strong>を押してください（同名は追加できません）。
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              ref={(el) => { inputRefs.current[p] = el; }}
                              type="text"
                              placeholder="例：カトラリー補充"
                              value={newLabelByPos[p] ?? ''}
                              onChange={(e) => {
                                const v = (e.currentTarget as HTMLInputElement).value;
                                setNewLabelByPos((s) => ({ ...s, [p]: v }));
                              }}
                              onCompositionStart={() => setIsComposingByPos((s) => ({ ...s, [p]: true }))}
                              onCompositionEnd={(e) => {
                                const v = (e.currentTarget as HTMLInputElement).value;
                                setIsComposingByPos((s) => ({ ...s, [p]: false }));
                                setNewLabelByPos((s) => ({ ...s, [p]: v }));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !isComposingByPos[p]) {
                                  e.preventDefault();
                                  if ((newLabelByPos[p] ?? '').trim()) {
                                    add(p);
                                    requestAnimationFrame(() => inputRefs.current[p]?.focus());
                                  }
                                }
                              }}
                              className="border px-3 py-2 rounded-md text-sm flex-1 shadow-sm"
                              aria-label="新しいテンプレ名"
                            />
                            {(() => {
                              const canAdd = !!(newLabelByPos[p] ?? '').trim();
                              return (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!canAdd) return;
                                    add(p);
                                    requestAnimationFrame(() => inputRefs.current[p]?.focus());
                                  }}
                                  disabled={!canAdd}
                                  className={`px-3 py-2 rounded-md text-sm shadow-sm active:scale-[.99] ${canAdd ? 'bg-green-600 text-white hover:bg-green-500 active:bg-green-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
                                >
                                  ＋追加
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
    </div>
  );
}

// --- helpers ---
function makeId(label: string) {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .slice(0, 24);
  const rand = Math.random().toString(36).slice(2, 8);
  return `mt_${slug || 'item'}_${rand}`;
}