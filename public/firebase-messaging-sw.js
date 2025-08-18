// firebase-messaging-sw.js

importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

// あなたの Firebase プロジェクトの設定（firebaseConfig）はすでにフロントで使っているものと同じです。
// ここでは最低限の初期化だけをしておきます。
firebase.initializeApp({
  apiKey: "AIzaSyBL1PuxWNE6mOeQoGENQar5uNRjU61w",
  authDomain: "front-kun-project.firebaseapp.com",
  projectId: "front-kun-project",
  storageBucket: "front-kun-project.firebasestorage.app",
  messagingSenderId: "931867395204",
  appId: "1:931867395204:web:5bb31acbe9cddfd265eed1",
});

// バックグラウンドで通知を受け取るための設定
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log(
    "[firebase-messaging-sw.js] Received background message ",
    payload
  );
  const notificationTitle = payload.notification?.title || "通知があります";
  const notificationOptions = {
    body: payload.notification?.body,
    icon: "/icons/icon-192.png", // PWA用PNGに合わせる（存在するPNGに合わせてください）
  };
  const clickAction =
    payload?.fcmOptions?.link ||
    payload?.notification?.click_action ||
    "/";
  // Pass the click target via data so we can open it on click
  notificationOptions.data = { click_action: clickAction };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// When the user clicks a notification, open/focus the target URL
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    event.notification?.data?.click_action ||
    "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client && client.url.includes(target)) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(target);
        }
      })
  );
});