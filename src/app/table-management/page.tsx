'use client';
import React, { useState, useEffect } from 'react';
import TableManagement from '@/components/TableManagement';
import { getReservations, saveReservations } from '@/lib/firebase'; // localStorage ユーティリティ
import { getStoreSettings } from '@/lib/firebase';
import { Reservation, CourseDef } from '../types'; // 必要に応じてパスを調整

export default function TableManagementPage() {
  // 1) 予約データを state で保持
  const [reservations, setReservations] = useState<Reservation[]>([]);
  // 2) 回転テーブル・最初の回転 ID を保持
  const [rotatingTables, setRotatingTables] = useState<Set<string>>(new Set());
  const [firstRotatingId, setFirstRotatingId] = useState<Record<string, number>>({});
  // コース情報を保持
  const [courses, setCourses] = useState<CourseDef[]>([]);
  // 事前設定のテーブル番号を保持
  const [presetTables, setPresetTables] = useState<string[]>([]);

  // 初回読み込みでローカルストレージから予約を取得
  useEffect(() => {
    const res = getReservations();      // ローカルストレージ読み込み関数
    setReservations(res);

    // ローカルストレージからコース情報を取得
    const { courses: storedCourses } = getStoreSettings();
    setCourses(storedCourses as CourseDef[]);

    // ローカルストレージからテーブル設定を取得
    const { tables: storedTables } = getStoreSettings();
    setPresetTables(storedTables);

    // ここで rotatingTables, firstRotatingId を計算・設定します
    // 例: 空のまま、あるいは予約データから導出する処理を追加
  }, []);

  // 退店ボタンが押されたときのハンドラ
  const handleDeparture = (id: number) => {
    // 例: 該当予約をリストから除外し、保存
    const next = reservations.filter(r => r.id !== id);
    setReservations(next);
    saveReservations(next);           // ローカルストレージ保存関数
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">テーブル管理</h1>
      <TableManagement
        reservations={reservations}
        courses={courses}
        rotatingTables={rotatingTables}
        firstRotatingId={firstRotatingId}
        onDeparture={handleDeparture}
        presetTables={presetTables}      // LocalStorage から読み込んだテーブル番号
      />
    </div>
  );
}