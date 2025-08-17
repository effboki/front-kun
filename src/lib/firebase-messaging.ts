import { doc, setDoc } from "firebase/firestore";
import { db, app } from "./firebase";

/**
 * ---- Messaging resolver (SSR-safe) ----
 * firebase/messaging はブラウザ専用のため、動的 import + window ガードで解決します。
 */
let _messaging: import("firebase/messaging").Messaging | null = null;
async function resolveMessaging(): Promise<import("firebase/messaging").Messaging | null> {
  if (typeof window === "undefined") return null;
  if (_messaging) return _messaging;
  const { getMessaging } = await import("firebase/messaging");
  _messaging = getMessaging(app);
  return _messaging;
}

/**
 * Firebase Messaging 用の Service Worker を登録（未登録なら登録、登録済みならそのまま返す）
 */
export async function ensureServiceWorkerRegistered(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    console.warn("[FCM] Service Worker not supported on this environment.");
    return null;
  }

  // すでに登録済みか確認（同じパスに限定）
  const existing = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
  if (existing) {
    return existing;
  }

  // 未登録なら登録
  try {
    const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    console.log("[FCM] Service Worker registered:", reg.scope);
    return reg;
  } catch (e) {
    console.error("[FCM] Service Worker registration failed:", e);
    throw e;
  }
}

/**
 * 端末ごとの一意なIDを取得（例: localStorageに保存）
 */
function getDeviceId(): string {
  let id = typeof window !== "undefined" ? localStorage.getItem("deviceId") : null;
  if (!id) {
    id = `device-${Math.random().toString(36).slice(2)}`;
    if (typeof window !== "undefined") localStorage.setItem("deviceId", id);
  }
  return id!;
}

/**
 * 通知許可をリクエストして、FCM トークンを取得する（単体テスト用ヘルパー）
 * - SW を先に登録
 * - SSR では何もしない
 */
export async function requestPermissionAndGetToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  console.log("[FCM] Requesting permission...");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    console.warn("[FCM] Notification permission not granted:", permission);
    return null;
  }

  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    console.error("[FCM] VAPID 公開キーが設定されていません（NEXT_PUBLIC_FIREBASE_VAPID_KEY）");
    return null;
  }

  // SW を先に確実に登録
  const swReg = await ensureServiceWorkerRegistered().catch(() => null);

  // ブラウザ側でのみ messaging / getToken を解決
  const messaging = await resolveMessaging();
  if (!messaging) return null;
  const { getToken } = await import("firebase/messaging");

  try {
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: swReg ?? undefined,
    });
    console.log("[FCM] Token:", token);
    return token ?? null;
  } catch (e) {
    console.error("[FCM] getToken failed:", e);
    return null;
  }
}

/**
 * 通知用に FCM トークンを取得して Firestore に保存する
 */
export async function ensureFcmRegistered(deviceId: string = getDeviceId(), storeId: string) {
  try {
    // ① 許可→トークン（内部で SW 登録も実施）
    const token = await requestPermissionAndGetToken();
    if (!token) {
      console.warn("[FCM] トークン未取得のため保存スキップ");
      return;
    }

    // ② Firestore に保存
    await setDoc(
      doc(db, "cmTokens", deviceId),
      {
        token,
        storeId,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    console.log("[FCM] トークンを保存しました:", deviceId, token);

    // ③ フォアグラウンドでの受信リスナ（任意）
    const messaging = await resolveMessaging();
    if (messaging) {
      const { onMessage } = await import("firebase/messaging");
      onMessage(messaging, (payload) => {
        console.log("[FCM] フォアグラウンド通知を受信:", payload);
        // 必要ならここでトースト表示など
      });
    }
  } catch (err) {
    console.error("[FCM] 登録に失敗しました:", err);
  }
}