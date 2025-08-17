import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
initializeApp();
const db = getFirestore();
export const onTaskEventCreated = onDocumentCreated("taskEvents/{id}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const data = snap.data();
    const docRef = snap.ref;
    // 1) 入力の軽い検証
    const required = ["storeId", "reservationId", "table", "course", "taskLabel", "timeKey", "date", "dedupeKey", "deviceId"];
    for (const k of required) {
        if (!data[k]) {
            logger.warn("missing field", k);
            await docRef.update({ status: { ok: false, reason: `missing:${k}`, at: FieldValue.serverTimestamp() } });
            return;
        }
    }
    const dedupeKey = String(data.dedupeKey);
    const deviceId = String(data.deviceId);
    // 2) 冪等ロック（同じ dedupeKey は一度だけ実行）
    const lockRef = db.collection("taskEventsStatus").doc(dedupeKey);
    try {
        await db.runTransaction(async (trx) => {
            const lock = await trx.get(lockRef);
            if (lock.exists)
                throw new Error("already-processed");
            trx.set(lockRef, { processedAt: FieldValue.serverTimestamp(), eventId: docRef.id });
        });
    }
    catch (e) {
        if (e.message === "already-processed") {
            await docRef.update({ status: { ok: true, reason: "duplicated-ignored", at: FieldValue.serverTimestamp() } });
            return;
        }
        logger.error("lock failed", e);
        await docRef.update({ status: { ok: false, reason: "lock-failed", at: FieldValue.serverTimestamp() } });
        return;
    }
    // 3) デバイストークン取得
    const tokenDoc = await db.collection("fcmTokens").doc(deviceId).get();
    if (!tokenDoc.exists) {
        await docRef.update({ status: { ok: false, reason: "token-not-found", at: FieldValue.serverTimestamp() } });
        return;
    }
    const token = tokenDoc.get("token");
    if (!token) {
        await docRef.update({ status: { ok: false, reason: "token-empty", at: FieldValue.serverTimestamp() } });
        return;
    }
    // 4) 送信
    const title = data.taskLabel;
    const body = `卓${data.table} / ${data.course} / ${data.timeKey}`;
    try {
        await getMessaging().send({
            token,
            notification: { title, body },
            data: {
                type: "taskEvent",
                reservationId: String(data.reservationId),
                table: String(data.table),
                course: String(data.course),
                taskLabel: String(data.taskLabel),
                timeKey: String(data.timeKey),
                date: String(data.date),
            }
        });
        await docRef.update({ status: { ok: true, reason: "sent", at: FieldValue.serverTimestamp() } });
    }
    catch (e) {
        logger.error("send failed", e?.errorInfo || e);
        const code = e?.errorInfo?.code || "";
        // 無効トークンなら掃除
        if (code === "messaging/registration-token-not-registered") {
            await tokenDoc.ref.delete().catch(() => { });
        }
        await docRef.update({ status: { ok: false, reason: `send-failed:${code}`, at: FieldValue.serverTimestamp() } });
    }
});
