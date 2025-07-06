// src/app/page.tsx
import { redirect } from 'next/navigation';

export default function RootPage() {
  // デフォルトで飛ばしたい storeId を書き換えてください
  redirect('/demo');
}