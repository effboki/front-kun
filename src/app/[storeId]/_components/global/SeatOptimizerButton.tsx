'use client';

import { useEffect, useState } from 'react';

const TOGGLE_EVENT = 'frontkun:seat-optimizer-toggle';
const OPEN_EVENT = 'frontkun:seat-optimizer-open';

type ToggleDetail = {
  visible?: boolean;
};

export default function SeatOptimizerButton() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ToggleDetail>).detail;
      setVisible(Boolean(detail?.visible));
    };
    window.addEventListener(TOGGLE_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(TOGGLE_EVENT, handler as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!visible) setBusy(false);
  }, [visible]);

  const handleClick = () => {
    if (typeof window === 'undefined') return;
    setBusy(true);
    window.dispatchEvent(new CustomEvent(OPEN_EVENT));
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!visible || busy}
      className={`absolute right-36 top-1/2 -translate-y-1/2 inline-flex items-center gap-2 rounded-full border border-white/30 bg-indigo-500/80 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 enabled:active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60 ${visible ? '' : 'pointer-events-none opacity-0'}`}
      aria-hidden={visible ? 'false' : 'true'}
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M4 4h7v7H4z" />
        <path d="M13 4h7v7h-7z" />
        <path d="M4 13h7v7H4z" />
        <path d="M16 16h2v2h-2z" />
      </svg>
      席効率化
    </button>
  );
}

export { TOGGLE_EVENT, OPEN_EVENT };

