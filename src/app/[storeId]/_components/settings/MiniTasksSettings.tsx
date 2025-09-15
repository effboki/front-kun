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
  const [pos, setPos] = React.useState<string>(positions[0] ?? '');
  React.useEffect(() => {
    // positions が変わったら先頭を選択
    if (!pos && positions.length > 0) setPos(positions[0]!);
    if (pos && !positions.includes(pos) && positions.length > 0) setPos(positions[0]!);
  }, [positions, pos]);

  const map = value.miniTasksByPosition ?? {};
  const list = React.useMemo<MiniTaskTemplate[]>(() => {
    const arr = (map[pos] ?? []).slice();
    arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label, 'ja'));
    return arr;
  }, [map, pos]);

  // ラベル編集中のドラフト
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const draftValue = (id: string, fallback: string) => drafts[id] ?? fallback;

  const commitMap = (nextForPos: MiniTaskTemplate[]) => {
    // order を 0..n で振り直し
    const normalized = nextForPos.map((t, i) => ({ ...t, order: i }));
    const next = { ...(value.miniTasksByPosition ?? {}), [pos]: normalized };
    onChange({ miniTasksByPosition: next });
  };

  const toggleActive = (id: string, active: boolean) => {
    const next = list.map((t) => (t.id === id ? { ...t, active } : t));
    commitMap(next);
  };

  const move = (id: string, dir: 'up' | 'down') => {
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const j = dir === 'up' ? idx - 1 : idx + 1;
    if (j < 0 || j >= list.length) return;
    const copy = list.slice();
    const tmp = copy[idx];
    copy[idx] = copy[j];
    copy[j] = tmp;
    commitMap(copy);
  };

  const remove = (id: string) => {
    const copy = list.filter((t) => t.id !== id);
    commitMap(copy);
    setDrafts((d) => {
      const { [id]: _, ...rest } = d;
      return rest;
    });
  };

  const commitLabel = (id: string) => {
    const current = list.find((t) => t.id === id);
    if (!current) return;
    const label = (drafts[id] ?? current.label).trim();
    if (!label) return; // 空は無視
    const next = list.map((t) => (t.id === id ? { ...t, label } : t));
    commitMap(next);
    setDrafts((d) => {
      const { [id]: _, ...rest } = d;
      return rest;
    });
  };

  // 追加
  const [newLabel, setNewLabel] = React.useState('');
  const add = () => {
    const label = newLabel.trim();
    if (!label || !pos) return;
    const id = makeId(label);
    const next: MiniTaskTemplate[] = [
      ...list,
      { id, label, active: true, order: list.length },
    ];
    commitMap(next);
    setNewLabel('');
  };

  const disabled = positions.length === 0;

  return (
    <div className="space-y-5">
      {/* ポジション選択 */}
      <section className="rounded-md border bg-white">
        <header className="px-4 py-3 border-b font-medium">ポジション別ミニタスク</header>
        <div className="p-4 space-y-3">
          {disabled ? (
            <p className="text-sm text-gray-600">ポジションが未設定です。先に「ポジション」設定から追加してください。</p>
          ) : (
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700">ポジション</label>
              <select
                className="rounded-md border px-2 py-1.5"
                value={pos}
                onChange={(e) => setPos(e.currentTarget.value)}
              >
                {positions.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <span className="text-xs text-gray-500">選択したポジションのミニタスクを編集します。</span>
            </div>
          )}
        </div>
      </section>

      {/* テンプレ一覧 */}
      <section className="rounded-md border bg-white">
        <header className="px-4 py-3 border-b font-medium flex items-center gap-3">
          <span>テンプレ一覧</span>
          <span className="text-xs text-gray-500">（{list.length}件）</span>
        </header>
        <div className="p-2">
          {list.length === 0 ? (
            <p className="px-2 py-4 text-sm text-gray-500">このポジションのミニタスクは未登録です。下のフォームから追加できます。</p>
          ) : (
            <ul className="space-y-1">
              {list.map((t, i) => (
                <li key={t.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 bg-white">
                  {/* active */}
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={t.active !== false}
                    onChange={(e) => toggleActive(t.id, e.currentTarget.checked)}
                    title="有効/無効"
                  />
                  {/* ラベル編集 */}
                  <input
                    type="text"
                    className="flex-1 rounded-md border px-2 py-1 text-sm"
                    value={draftValue(t.id, t.label)}
                    onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.currentTarget.value }))}
                    onBlur={() => commitLabel(t.id)}
                    onKeyDown={(e) => e.key === 'Enter' && commitLabel(t.id)}
                  />
                  {/* 並び替え */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="h-8 w-8 rounded border text-sm"
                      onClick={() => move(t.id, 'up')}
                      disabled={i === 0}
                      title="上へ"
                    >↑</button>
                    <button
                      type="button"
                      className="h-8 w-8 rounded border text-sm"
                      onClick={() => move(t.id, 'down')}
                      disabled={i === list.length - 1}
                      title="下へ"
                    >↓</button>
                  </div>
                  {/* 削除 */}
                  <button
                    type="button"
                    className="ml-1 h-8 rounded border px-2 text-sm text-red-600 hover:bg-red-50"
                    onClick={() => remove(t.id)}
                    title="削除"
                  >削除</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 追加フォーム */}
      <section className="rounded-md border bg-white">
        <header className="px-4 py-3 border-b font-medium">テンプレを追加</header>
        <div className="p-4 flex items-center gap-2">
          <input
            type="text"
            className="flex-1 rounded-md border px-2 py-1.5 text-sm"
            placeholder="例：カトラリー補充"
            value={newLabel}
            onChange={(e) => setNewLabel(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            disabled={disabled || !pos}
          />
          <button
            type="button"
            className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
            onClick={add}
            disabled={disabled || !pos || !newLabel.trim()}
          >追加</button>
        </div>
        <p className="px-4 pb-3 text-xs text-gray-500">チェックで有効／無効を切替。↑↓で並び替えできます。</p>
      </section>
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