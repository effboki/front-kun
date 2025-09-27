import { doc, setDoc } from "firebase/firestore";
import { db, app } from "./firebase";

const VIBRATION_PATTERN = [200, 80, 200];

type MessagePayload = import("firebase/messaging").MessagePayload;

type FcmMessagePayload = MessagePayload & {
  fcmOptions?: { link?: string | null } | null;
  notification?: (MessagePayload["notification"] & { click_action?: string }) | null;
  data?: (Record<string, string> & { click_action?: string }) | undefined;
};

let audioCtx: AudioContext | null = null;
let onMessageHandlerRegistered = false;

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioCtx) return audioCtx;
  try {
    const globalWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = globalWindow.AudioContext ?? globalWindow.webkitAudioContext;
    audioCtx = Ctor ? new Ctor() : null;
  } catch (err) {
    console.warn("[FCM] Failed to create AudioContext:", err);
    audioCtx = null;
  }
  return audioCtx;
}

function primeNotificationAudio(): void {
  if (typeof window === "undefined") return;
  const ctx = getOrCreateAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => { /* ignore */ });
  }
}

function playNotificationTone(): void {
  if (typeof window === "undefined") return;
  const ctx = getOrCreateAudioContext();
  if (!ctx || ctx.state === "closed") return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => { /* ignore */ });
  }
  if (ctx.state !== "running") {
    return;
  }

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = 880;

    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.65);
  } catch (err) {
    console.warn("[FCM] Failed to play notification tone:", err);
  }
}

function resolveClickTarget(payload: FcmMessagePayload): string | undefined {
  const fromOptions = payload.fcmOptions?.link ?? undefined;
  const fromNotification = payload.notification ? (payload.notification as { click_action?: string }).click_action : undefined;
  const fromData = payload.data?.click_action;
  return fromOptions || fromNotification || fromData || undefined;
}

function presentForegroundNotification(payload: MessagePayload): void {
  if (typeof window === "undefined") return;

  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(VIBRATION_PATTERN);
  }
  playNotificationTone();

  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    console.log("[FCM] Foreground payload:", payload);
    return;
  }

  const extended = payload as FcmMessagePayload;

  const title = extended.notification?.title
    || extended.data?.taskLabel
    || "フロント君";

  const fallbackParts: string[] = [];
  if (extended.data?.table) fallbackParts.push(`卓${extended.data.table}`);
  if (extended.data?.course) fallbackParts.push(extended.data.course);
  if (extended.data?.timeKey) fallbackParts.push(extended.data.timeKey);

  const fallbackBody = fallbackParts.length > 0 ? fallbackParts.join(" / ") : undefined;

  const body = extended.notification?.body || fallbackBody || "";
  const clickTarget = resolveClickTarget(extended);

  try {
    const notificationOptions: NotificationOptions & {
      vibrate?: number[];
      renotify?: boolean;
    } = {
      body,
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-192x192.png",
      vibrate: VIBRATION_PATTERN,
      tag: extended.data?.dedupeKey || extended.data?.reservationId || undefined,
      renotify: true,
      data: {
        ...(extended.data ?? {}),
        click_action: clickTarget,
      },
    };

    const notification = new Notification(title, notificationOptions);

    notification.onclick = () => {
      notification.close();
      if (clickTarget) {
        window.location.assign(clickTarget);
      } else {
        window.focus();
      }
    };
  } catch (err) {
    console.warn("[FCM] Failed to show foreground notification:", err);
  }
}

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
  if (typeof Notification === "undefined") {
    console.warn("[FCM] Notification API is unavailable in this environment.");
    return null;
  }

  primeNotificationAudio();

  console.log("[FCM] Requesting permission...");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    console.warn("[FCM] Notification permission not granted:", permission);
    return null;
  }

  primeNotificationAudio();

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
export async function ensureFcmRegistered(
  deviceId: string = getDeviceId(),
  storeId: string,
  providedToken?: string | null
) {
  try {
    primeNotificationAudio();

    // ① 許可→トークン（内部で SW 登録も実施）
    const token = providedToken ?? (await requestPermissionAndGetToken());
    if (!token) {
      console.warn("[FCM] トークン未取得のため保存スキップ");
      return;
    }

    // ② Firestore に保存
    await setDoc(
      doc(db, "fcmTokens", deviceId),
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
    if (messaging && !onMessageHandlerRegistered) {
      const { onMessage } = await import("firebase/messaging");
      onMessage(messaging, (payload) => {
        console.log("[FCM] フォアグラウンド通知を受信:", payload);
        presentForegroundNotification(payload);
      });
      onMessageHandlerRegistered = true;
    }
  } catch (err) {
    console.error("[FCM] 登録に失敗しました:", err);
  }
}
