// ─────────────────────────────────────────────────────────────────────────────
// src/lib/firebase.ts
//  Firebase SDK を Next.js クライアントで初期化するためのコード
//  - Firestore（リアルタイム共有）を使う例
//  - 環境変数は .env.local に定義済み（NEXT_PUBLIC_XXX）
//  - すでに初期化済みの場合は再利用する（複数回ロードを防止）
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

let firebaseApp;
if (!getApps().length) {
  // Firebase 初回初期化
  firebaseApp = initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });
} else {
  // すでに初期化済みならそれを再利用
  firebaseApp = getApp();
}

// Firestore をエクスポート（リアルタイム共有用）
export const firestore = getFirestore(firebaseApp);

// もしリアルタイムでリスナーを張るなら以下のように使えます（例）
// import { collection, onSnapshot } from 'firebase/firestore';
// const colRef = collection(firestore, 'reservations');
// onSnapshot(colRef, (snapshot) => {
//   // snapshot.docs からリアルタイム更新を受け取る
// });