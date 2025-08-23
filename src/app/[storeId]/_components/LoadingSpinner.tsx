'use client';
import React from 'react';

const LoadingSpinner: React.FC = () => (
  <div suppressHydrationWarning className="fixed inset-0 flex items-center justify-center bg-white/60 z-50">
    <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent" />
  </div>
);

export default LoadingSpinner;