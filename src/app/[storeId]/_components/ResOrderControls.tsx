

'use client';
import React from 'react';

export type ResOrder = 'time' | 'table' | 'created';

type Props = {
  value: ResOrder;
  onChange: (v: ResOrder) => void;
  className?: string;
};

const ResOrderControls: React.FC<Props> = ({ value, onChange, className }) => {
  const btnClass = (active: boolean) => [
    'px-2 py-1 text-sm focus:outline-none',
    active ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100',
  ].join(' ');

  return (
    <div className={['flex items-center gap-2', className ?? ''].join(' ').trim()}>
      <span className="text-xs text-gray-500">表示順</span>
      <div className="inline-flex rounded-md border overflow-hidden">
        <button
          type="button"
          onClick={() => onChange('time')}
          className={btnClass(value === 'time')}
          aria-pressed={value === 'time'}
        >
          時間順
        </button>
        <button
          type="button"
          onClick={() => onChange('table')}
          className={btnClass(value === 'table')}
          aria-pressed={value === 'table'}
        >
          卓順
        </button>
        <button
          type="button"
          onClick={() => onChange('created')}
          className={btnClass(value === 'created')}
          aria-pressed={value === 'created'}
        >
          追加順
        </button>
      </div>
    </div>
  );
};

export default ResOrderControls;