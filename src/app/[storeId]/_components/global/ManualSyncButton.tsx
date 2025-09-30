'use client';

import { useState } from 'react';
import { flushQueuedOps } from '@/lib/opsQueue';
import { toast } from 'react-hot-toast';

export default function ManualSyncButton() {
  const [running, setRunning] = useState(false);

  const handleClick = async () => {
    if (running) return;
    setRunning(true);
    try {
      await flushQueuedOps();
      toast.success('最新のデータに更新しました');
    } catch (err) {
      console.error('[ManualSyncButton] flushQueuedOps failed', err);
      toast.error('更新に失敗しました');
    } finally {
      setRunning(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={running}
      className="absolute right-14 top-1/2 -translate-y-1/2 inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-white/20 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
      title="手動で更新"
      aria-label="手動で更新"
    >
      {running ? (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 3v2" />
          <path d="M16.24 7.76l1.42-1.42" />
          <path d="M21 12h-2" />
          <path d="M16.24 16.24l1.42 1.42" />
          <path d="M12 19v2" />
          <path d="M7.76 16.24l-1.42 1.42" />
          <path d="M5 12H3" />
          <path d="M7.76 7.76L6.34 6.34" />
        </svg>
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M21 12a9 9 0 11-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
      )}
      <span className="hidden sm:inline">更新</span>
      <span className="sm:hidden">↻</span>
    </button>
  );
}
