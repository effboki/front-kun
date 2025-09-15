'use client';
import * as React from 'react';
import { useMiniTasks } from '@/app/_providers/MiniTaskProvider';

/**
 * 右上ベル（紺帯ヘッダー用）
 * - 親ヘッダーに `relative` を付け、このコンポーネントは `absolute` で右上に出ます
 * - バッジ：未完了ミニタスク数
 * - ポップアップ：×で閉じるまで自動で閉じない
 * - 自動オープン：window.dispatchEvent(new CustomEvent('miniTasks:notify')) を受信
 * - a11y: aria-live polite / Escで閉じる / フォーカストラップ
 */
export default function BellMenu() {
  const { tasks, pendingCount, calmUntil, toggle } = useMiniTasks();
  const [open, setOpen] = React.useState(false);
  const [announce, setAnnounce] = React.useState<string>(''); // aria-live 用
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const titleRef = React.useRef<HTMLHeadingElement | null>(null);
  const [liveUntil, setLiveUntil] = React.useState<Date | null>(null);

  // 一覧は常に全件（完了も表示）。バッジは未完了件数（pendingCount）
  const allTasks = tasks;
  const badge = pendingCount;

  // “ヒマ開始+delay”のアプリ内通知を受信して自動オープン
  React.useEffect(() => {
    const onNotify = () => {
      setOpen(true);
      // 現在の推定で初期化（後続の miniTasks:update で上書きされる）
      setLiveUntil(calmUntil ?? null);
      const u = calmUntil ?? null;
      const until = u ? formatTime(u) : null;
      setAnnounce(until ? `${until} まで落ち着く予定です（推定）。` : 'ミニタスク通知');
      // 少し遅らせてフォーカス（描画完了後）
      requestAnimationFrame(() => titleRef.current?.focus());
    };
    window.addEventListener('miniTasks:notify', onNotify as EventListener);
    return () => window.removeEventListener('miniTasks:notify', onNotify as EventListener);
    // calmUntil が変わってもハンドラを貼り替える必要はないが、announce更新のため依存に含める
  }, [calmUntil]);

  // Calmウィンドウの延長/短縮：文面をライブ更新（再通知は出さない）
  React.useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ start: number; end: number }>).detail;
      if (!detail?.end) return;
      const d = new Date(detail.end);
      setLiveUntil(d);
      if (open) {
        setAnnounce(`${formatTime(d)} まで落ち着く予定です（推定）。`);
      }
    };
    window.addEventListener('miniTasks:update', onUpdate as EventListener);
    return () => window.removeEventListener('miniTasks:update', onUpdate as EventListener);
  }, [open]);

  const closeManually = () => {
    try { window.dispatchEvent(new CustomEvent('miniTasks:dismiss')); } catch {}
    setOpen(false);
    // 元のベルボタンにフォーカスを戻す
    triggerRef.current?.focus();
  };

  // フォーカストラップ & Esc 閉じ
  const onKeyDownDialog = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      closeManually();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = getFocusableElements();
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const ae = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (!ae || ae === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (!ae || ae === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const getFocusableElements = () => {
    const root = dialogRef.current;
    if (!root) return [] as HTMLElement[];
    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    return Array.from(root.querySelectorAll<HTMLElement>(selectors))
      .filter(el => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));
  };

  const focusFirstInDialog = () => {
    const els = getFocusableElements();
    // チェックボックス or 閉じるボタンにフォーカス
    const firstCheckbox = els.find(el => el instanceof HTMLInputElement && el.type === 'checkbox');
    (firstCheckbox ?? els[0] ?? dialogRef.current)?.focus();
  };

  const dialogId = 'miniTasksDialog';
  const titleId = 'miniTasksDialogTitle';

  const displayUntil: Date | null = liveUntil ?? calmUntil;

  return (
    <div className="absolute right-2 top-1/2 -translate-y-1/2 z-50">
      {/* 画面読み上げ用のライブリージョン（通知時に読み上げ） */}
      <span className="sr-only" aria-live="polite">{announce}</span>

      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen(v => {
            const next = !v;
            if (next) {
              // 現在の推定で初期化しつつ、開いたら初期フォーカス
              setLiveUntil(calmUntil ?? null);
              requestAnimationFrame(() => titleRef.current?.focus());
            }
            return next;
          });
        }}
        aria-label="ミニタスク通知"
        aria-controls={dialogId}
        aria-expanded={open}
        className="relative grid place-items-center h-9 w-9 rounded-full border border-white/30 bg-white/10 text-white hover:bg-white/20 active:scale-[.98] focus:outline-none focus:ring-2 focus:ring-white/60"
      >
        {/* ベルアイコン */}
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
          <path d="M12 2a7 7 0 00-7 7v3.586l-1.707 1.707A1 1 0 004 16h16a1 1 0 00.707-1.707L19 12.586V9a7 7 0 00-7-7zm0 20a3 3 0 01-3-3h6a3 3 0 01-3 3z"/>
        </svg>
        {/* 未完了バッジ */}
        {badge > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.2rem] h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold grid place-items-center leading-none">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>

      {/* ポップアップ（×で閉じるまで勝手に閉じない） */}
      {open && (
        <div
          id={dialogId}
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="absolute right-0 mt-2 w-[20rem] max-w-[85vw] rounded-md border border-black/10 bg-white text-gray-800 shadow-2xl outline-none"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onKeyDownDialog}
        >
          <div className="flex items-start gap-2 p-3 border-b bg-yellow-50">
            <div className="mt-0.5" aria-hidden>🟡</div>
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className="text-sm leading-snug font-medium">
              {displayUntil
                ? <span><strong>{formatTime(displayUntil)}</strong> まで落ち着く予定です（推定）。今のうちにミニタスクを進めましょう。</span>
                : <span>現在のミニタスク</span>}
            </h2>
            <button
              type="button"
              onClick={closeManually}
              className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded border bg-white hover:bg-gray-50"
              aria-label="閉じる"
              title="閉じる"
            >
              ×
            </button>
          </div>

          <div className="max-h-[60vh] overflow-auto p-2">
            {allTasks.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">ミニタスクはありません。</div>
            ) : (
              <ul className="space-y-1">
                {allTasks.map(t => (
                  <li key={t.id} className="flex items-center gap-2 rounded-md border px-2 py-1 bg-white">
                    <input
                      id={`mt-${t.id}`}
                      type="checkbox"
                      checked={!!t.done}
                      onChange={(e) => toggle(t.id, e.currentTarget.checked)}
                      className="h-5 w-5"
                    />
                    <label
                      htmlFor={`mt-${t.id}`}
                      className={"text-sm truncate flex-1 " + (t.done ? "text-gray-400 line-through" : "")}
                    >
                      {t.label}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(d: Date) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}