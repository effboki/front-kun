// src/app/page.tsx
'use client';

import { useState, useEffect, ChangeEvent, FormEvent, useMemo } from 'react';

//
// ───────────────────────────── ① TYPES ────────────────────────────────────────────
//

// タスク定義
type TaskDef = {
  timeOffset: number; // 分後 (0～180)
  label: string;      // タスク名
  bgColor: string;    // 背景色 Tailwind クラス（少し透過気味）
};

// コース定義
type CourseDef = {
  name: string;
  tasks: TaskDef[];
};

// 予約(来店)情報
type Reservation = {
  id: number;
  table: string;       // 卓番 (文字列)
  time: string;        // "HH:MM"
  course: string;      // コース名
  guests: number;      // 人数
  completed: {         // 完了フラグ (キー: `${timeKey}_${taskLabel}_${course}`)
    [key: string]: boolean;
  };
};

//
// ───────────────────────────── ② MAIN コンポーネント ─────────────────────────────────
//

export default function Home() {
  //
  // ─── 2.1 コース・タスクの定義・状態管理 ─────────────────────────────────────
  //

  const [courses, setCourses] = useState<CourseDef[]>([
    {
      name: 'スタンダード',
      tasks: [
        { timeOffset: 0,   label: 'コース説明',     bgColor: 'bg-gray-100/80' },
        { timeOffset: 45,  label: 'カレー',         bgColor: 'bg-orange-200/80' },
        { timeOffset: 60,  label: 'リクエスト',     bgColor: 'bg-blue-200/80' },
        { timeOffset: 90,  label: 'ラストオーダー', bgColor: 'bg-pink-200/80' },
        { timeOffset: 120, label: '退席',           bgColor: 'bg-gray-200/80' },
      ],
    },
    {
      name: 'ランチ',
      tasks: [
        { timeOffset: 0,   label: 'コース説明',     bgColor: 'bg-gray-100/80' },
        { timeOffset: 30,  label: 'カレー',         bgColor: 'bg-yellow-200/80' },
        { timeOffset: 50,  label: 'リクエスト',     bgColor: 'bg-blue-200/80' },
        { timeOffset: 80,  label: 'ラストオーダー', bgColor: 'bg-pink-200/80' },
        { timeOffset: 110, label: '退席',           bgColor: 'bg-gray-200/80' },
      ],
    },
    {
      name: 'ディナー',
      tasks: [
        { timeOffset: 0,   label: 'コース説明',     bgColor: 'bg-gray-100/80' },
        { timeOffset: 10,  label: '皿ピメ',         bgColor: 'bg-yellow-200/80' },
        { timeOffset: 45,  label: 'カレー',         bgColor: 'bg-orange-200/80' },
        { timeOffset: 70,  label: 'リクエスト',     bgColor: 'bg-blue-200/80' },
        { timeOffset: 95,  label: 'ラストオーダー', bgColor: 'bg-pink-200/80' },
        { timeOffset: 125, label: '退席',           bgColor: 'bg-gray-200/80' },
      ],
    },
  ]);

  // 選択中のコース名 (タスク設定用)
  const [selectedCourse, setSelectedCourse] = useState<string>('スタンダード');
  // タスク設定セクションの開閉
  const [courseTasksOpen, setCourseTasksOpen] = useState<boolean>(false);
  // 新規タスク入力用ラベル・オフセット
  const [newTaskLabel, setNewTaskLabel] = useState<string>('');
  const [newTaskOffset, setNewTaskOffset] = useState<number>(0);
  // 編集中の既存タスク (offset と label で一意に判定)
  const [editingTask, setEditingTask] = useState<{ offset: number; label: string } | null>(null);

  //
  // ─── 2.2 予約(来店) の状態管理 ────────────────────────────────────────────
  //

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [nextResId, setNextResId] = useState<number>(1);

  // 新規予約入力用フィールド
  const [newResTable, setNewResTable] = useState<string>('');    // デフォルトは空文字
  const [newResTime, setNewResTime] = useState<string>('18:00');
  const [newResCourse, setNewResCourse] = useState<string>('スタンダード');
  const [newResGuests, setNewResGuests] = useState<number | ''>(''); // デフォルト空文字

  // 来店入力セクションの開閉
  const [resInputOpen, setResInputOpen] = useState<boolean>(false);

  //
  // ─── 2.3 コントロールバー: 検索・フィルター・表示切替 ────────────────────────
  //

  const [filterSearch, setFilterSearch] = useState<string>('');
  const [filterOrder, setFilterOrder] = useState<'table' | 'guests'>('table');
  const [filterCourse, setFilterCourse] = useState<string>('全体');
  const [showCourseAll, setShowCourseAll] = useState<boolean>(true);
  const [showGuestsAll, setShowGuestsAll] = useState<boolean>(true);
  // タスクまとめ表示：コース表示 ON のときのみ現れる
  const [mergeSameTasks, setMergeSameTasks] = useState<boolean>(false);

  //
  // ─── 2.4 時刻操作ヘルパー ────────────────────────────────────────────────────
  //

  const parseTimeToMinutes = (time: string): number => {
    const [hh, mm] = time.split(':').map(Number);
    return hh * 60 + mm;
  };
  const formatMinutesToTime = (minutes: number): string => {
    const hh = Math.floor(minutes / 60);
    const mm = minutes % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  // 5分刻みの時刻リスト (00:00～23:55)
  const timeOptions = useMemo(() => {
    const arr: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 5) {
        arr.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return arr;
  }, []);

  //
  // ─── 2.5 コース/タスク設定用イベントハンドラ ───────────────────────────────
  //

  // コースを選択変更
  const handleCourseChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setSelectedCourse(e.target.value);
  };

  // タスク設定セクションの開閉 (開くときに確認ダイアログ)
  const toggleCourseTasks = () => {
    if (!courseTasksOpen) {
      if (!confirm('タスク設定を開きますか？')) return;
    }
    setCourseTasksOpen((prev) => !prev);
  };

  // 新規タスク名を入力
  const handleNewTaskLabelChange = (e: ChangeEvent<HTMLInputElement>) => {
    setNewTaskLabel(e.target.value);
  };

  // 既存タスクを削除
  const deleteTaskFromCourse = (offset: number, label: string) => {
    if (!confirm(`「${label}」を削除しますか？`)) return;
    setCourses((prev) =>
      prev.map((c) => {
        if (c.name !== selectedCourse) return c;
        return { ...c, tasks: c.tasks.filter((t) => !(t.timeOffset === offset && t.label === label)) };
      })
    );
    // 編集モード解除
    if (editingTask && editingTask.offset === offset && editingTask.label === label) {
      setEditingTask(null);
    }
  };

  // 既存タスク時間を ±5 分ずらす
  const shiftTaskOffset = (offset: number, label: string, delta: number) => {
    setCourses((prev) =>
      prev.map((c) => {
        if (c.name !== selectedCourse) return c;
        const newTasks = c.tasks.map((t) => {
          if (t.timeOffset !== offset || t.label !== label) return t;
          const newOffset = Math.max(0, Math.min(180, t.timeOffset + delta));
          return { ...t, timeOffset: newOffset };
        });
        newTasks.sort((a, b) => a.timeOffset - b.timeOffset);
        return { ...c, tasks: newTasks };
      })
    );
    // 編集モードのオフセットも更新
    if (editingTask && editingTask.offset === offset && editingTask.label === label) {
      setEditingTask({ offset: Math.max(0, Math.min(180, offset + delta)), label });
    }
  };

  // タスクの「編集モード」を切り替え
  const toggleEditingTask = (offset: number, label: string) => {
    if (editingTask && editingTask.offset === offset && editingTask.label === label) {
      setEditingTask(null);
    } else {
      setEditingTask({ offset, label });
    }
  };

  // 新規タスクをコースに追加
  const addTaskToCourse = (e: FormEvent) => {
    e.preventDefault();
    if (!newTaskLabel) return;
    setCourses((prev) =>
      prev.map((c) => {
        if (c.name !== selectedCourse) return c;
        // 重複防止
        if (c.tasks.some((t) => t.timeOffset === newTaskOffset && t.label === newTaskLabel)) {
          return c;
        }
        const bgColorMap: Record<string, string> = {
          'コース説明': 'bg-gray-100/80',
          '皿ピメ': 'bg-yellow-200/80',
          'カレー': 'bg-orange-200/80',
          'リクエスト': 'bg-blue-200/80',
          'ラストオーダー': 'bg-pink-200/80',
          '退席': 'bg-gray-200/80',
        };
        const color = bgColorMap[newTaskLabel] || 'bg-gray-100/80';
        const updatedTasks = [...c.tasks, { timeOffset: newTaskOffset, label: newTaskLabel, bgColor: color }];
        updatedTasks.sort((a, b) => a.timeOffset - b.timeOffset);
        return { ...c, tasks: updatedTasks };
      })
    );
    setNewTaskLabel('');
    setNewTaskOffset(0);
  };

  //
  // ─── 2.6 来店入力(Reservation)イベントハンドラ ─────────────────────────────
  //

  // 既存予約フィールドを直接更新 (「time」「course」は select で直接渡される)
  const updateReservationField = (
    id: number,
    field: 'time' | 'course',
    value: string
  ) => {
    setReservations((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (field === 'time') {
          return { ...r, time: value };
        } else {
          return { ...r, course: value };
        }
      })
    );
  };

  // 来店入力開閉時の確認ダイアログ
  const toggleResInput = () => {
    if (!resInputOpen) {
      if (!confirm('来店入力を開きますか？')) return;
    }
    setResInputOpen((prev) => !prev);
  };

  // 新規来店予約を追加
  const addReservation = (e: FormEvent) => {
    e.preventDefault();
    if (!newResTable || !newResTime || newResGuests === '' || isNaN(Number(newResGuests))) return;
    const newRes: Reservation = {
      id: nextResId,
      table: newResTable,
      time: newResTime,
      course: newResCourse,
      guests: Number(newResGuests),
      completed: {},
    };
    setReservations((prev) => [...prev, newRes]);
    setNextResId((prev) => prev + 1);
    setNewResTable('');
    setNewResTime('18:00');
    setNewResGuests(''); // 空文字に戻す
    setNewResCourse('スタンダード');
  };

  // 既存予約を削除
  const deleteReservation = (id: number) => {
    if (!confirm('この来店情報を削除しますか？')) return;
    setReservations((prev) => prev.filter((r) => r.id !== id));
  };

  //
  // ─── 2.7 予約を「来店時刻順」にソート ─────────────────────────────────────────
  //

  const sortedReservationsByTime = useMemo(() => {
    return [...reservations].sort((a, b) => {
      return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
    });
  }, [reservations]);

  //
  // ─── 2.8 コントロールバー: 検索・フィルター・表示切替適用 ──────────────────────────
  //

  const filteredReservations = useMemo(() => {
    return sortedReservationsByTime
      .filter((r) => {
        if (filterSearch.trim()) {
          const f = filterSearch.trim();
          return (
            r.table.includes(f) ||
            r.guests.toString().includes(f) ||
            r.course.includes(f) ||
            r.time.includes(f)
          );
        }
        return true;
      })
      .filter((r) => {
        if (filterCourse === '全体') return true;
        return r.course === filterCourse;
      })
      .sort((a, b) => {
        if (filterOrder === 'table') {
          return a.table.localeCompare(b.table);
        } else {
          return a.guests - b.guests;
        }
      });
  }, [sortedReservationsByTime, filterSearch, filterCourse, filterOrder]);

  //
  // ─── 2.9 タスク表示用グルーピングロジック ────────────────────────────────────────
  //

  type TaskGroup = {
    timeKey: string;              // "HH:MM"
    label: string;                // タスク名
    bgColor: string;              // 背景色
    courseGroups: {
      courseName: string;
      reservations: Reservation[];
    }[];
  };

  // groupedTasks[timeKey] = TaskGroup[]
  const groupedTasks: Record<string, TaskGroup[]> = {};

  filteredReservations.forEach((res) => {
    if (res.course === '未選択') return; // 未選択は表示しない
    const courseDef = courses.find((c) => c.name === res.course);
    if (!courseDef) return;
    const baseMinutes = parseTimeToMinutes(res.time);

    courseDef.tasks.forEach((t) => {
      const slot = baseMinutes + t.timeOffset;
      const timeKey = formatMinutesToTime(slot);
      if (!groupedTasks[timeKey]) groupedTasks[timeKey] = [];

      // "label" でのグループを探す
      let taskGroup = groupedTasks[timeKey].find((g) => g.label === t.label);
      if (!taskGroup) {
        taskGroup = { timeKey, label: t.label, bgColor: t.bgColor, courseGroups: [] };
        groupedTasks[timeKey].push(taskGroup);
      }

      // "courseName" でのサブグループを探す
      let courseGroup = taskGroup.courseGroups.find((cg) => cg.courseName === res.course);
      if (!courseGroup) {
        courseGroup = { courseName: res.course, reservations: [] };
        taskGroup.courseGroups.push(courseGroup);
      }
      // 予約を追加
      courseGroup.reservations.push(res);
    });
  });

  // 時間順・タスク順・コース順でソート
  const sortedTimeKeys = Object.keys(groupedTasks).sort((a, b) => {
    return parseTimeToMinutes(a) - parseTimeToMinutes(b);
  });
  sortedTimeKeys.forEach((timeKey) => {
    groupedTasks[timeKey].sort((a, b) => {
      // 同じ時間帯のタスクを元コースの timeOffset 順でソート
      const aOffset = (() => {
        const cg = a.courseGroups[0];
        const cdef = courses.find((c) => c.name === cg.courseName);
        return cdef?.tasks.find((t) => t.label === a.label)?.timeOffset ?? 0;
      })();
      const bOffset = (() => {
        const cg = b.courseGroups[0];
        const cdef = courses.find((c) => c.name === cg.courseName);
        return cdef?.tasks.find((t) => t.label === b.label)?.timeOffset ?? 0;
      })();
      return aOffset - bOffset;
    });
    groupedTasks[timeKey].forEach((tg) => {
      tg.courseGroups.sort((x, y) => x.courseName.localeCompare(y.courseName));
    });
  });

  //
  // ─── 2.10 数値パッド用状態とハンドラ ─────────────────────────────────────────
  //

  // 数値パッドを開いているか？どの予約 (id=-1: 新規行) のどのフィールドか？入力中の文字列
  const [numPadState, setNumPadState] = useState<{
    id: number;
    field: 'table' | 'guests';
    value: string;
  } | null>(null);

  // 数値パッドの「数字ボタン」「←（バックスペース）」「C（クリア）」イベント
  const onNumPadPress = (char: string) => {
    if (!numPadState) return;
    setNumPadState((prev) => {
      if (!prev) return null;
      let newVal = prev.value;
      if (char === '←') {
        newVal = newVal.slice(0, -1);
      } else if (char === 'C') {
        newVal = '';
      } else {
        // 数字を押したとき。最大 3 桁まで
        if (newVal.length < 3) {
          newVal = newVal + char;
        }
      }
      return { ...prev, value: newVal };
    });
  };

  // 数値パッドの「確定」ボタン
  const onNumPadConfirm = () => {
    if (!numPadState) return;
    const { id, field, value } = numPadState;

    if (id === -1) {
      // 「新規行で入力中」の場合
      if (field === 'table') {
        setNewResTable(value);
      } else {
        const n = Number(value);
        if (!isNaN(n) && n >= 1 && n <= 999) {
          setNewResGuests(n);
        } else {
          // 無効な値の場合は 1 をセット
          setNewResGuests(1);
        }
      }
    } else {
      // 既存予約 (id >= 1) の場合
      setReservations((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          if (field === 'table') {
            return { ...r, table: value };
          } else {
            const n = Number(value);
            if (!isNaN(n) && n >= 1 && n <= 999) {
              return { ...r, guests: n };
            } else {
              return r; // 無効な値は無視
            }
          }
        })
      );
    }

    setNumPadState(null);
  };

  // 数値パッドの「キャンセル」ボタン
  const onNumPadCancel = () => {
    setNumPadState(null);
  };

  //
  // ─── 2.11 localStorage へのバックアップ＆リストア ─────────────────────────────────
  //

  // ① まず、コンポーネントが初回マウントされたときに localStorage から読み込む
  useEffect(() => {
    try {
      const raw = localStorage.getItem('reservations_backup');
      if (raw) {
        const fromStorage: Reservation[] = JSON.parse(raw);
        setReservations(fromStorage);
        // nextResId を当該データの最大 ID +1 に合わせる
        const maxId = fromStorage.reduce((m, x) => (x.id > m ? x.id : m), 0);
        setNextResId(maxId + 1);
      }
    } catch (e) {
      console.error('localStorage read error:', e);
    }
  }, []);

  // ② 予約情報 (reservations) が変化するたびに localStorage に保存する
  useEffect(() => {
    try {
      localStorage.setItem('reservations_backup', JSON.stringify(reservations));
    } catch (e) {
      console.error('localStorage write error:', e);
    }
  }, [reservations]);

  //
  // ─── ③ レンダリング ───────────────────────────────────────────────────────────
  //

  return (
    <main className="p-4 space-y-6">
      {/* ─────────────── 1. コース設定セクション ─────────────── */}
      <section>
        <h2 className="font-bold text-lg mb-2">① コース設定（コースごと）</h2>
        <div className="flex items-center space-x-2 mb-2">
          <label className="whitespace-nowrap">設定中のコース：</label>
          <select
            value={selectedCourse}
            onChange={handleCourseChange}
            className="border px-2 py-1 rounded text-sm"
          >
            {courses.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              const courseName = prompt('新しいコース名を入力してください：');
              if (!courseName) return;
              if (courses.some((c) => c.name === courseName)) {
                alert('そのコース名は既に存在します。');
                return;
              }
              setCourses((prev) => [...prev, { name: courseName, tasks: [] }]);
              setSelectedCourse(courseName);
            }}
            className="ml-2 px-3 py-1 bg-green-500 text-white rounded text-sm"
          >
            ＋新コース作成
          </button>
        </div>

        <details
          open={courseTasksOpen}
          onToggle={toggleCourseTasks}
          className="border rounded"
        >
          <summary className="cursor-pointer p-2 font-semibold bg-gray-100 text-sm">
            {courseTasksOpen ? '▼▼ タスク設定を閉じる' : '▶▶ タスク設定を開く'}
          </summary>
          <div className="p-4 space-y-3 text-sm">
            {/* 既存タスク一覧 */}
            {courses
              .find((c) => c.name === selectedCourse)!
              .tasks.slice()
              .sort((a, b) => a.timeOffset - b.timeOffset)
              .map((task) => (
                <div
                  key={`${task.timeOffset}-${task.label}`}
                  className="flex items-center space-x-2 border-b pb-1"
                >
                  {/* 編集モード切り替え */}
                  <div className="flex items-center space-x-1">
                    {editingTask &&
                    editingTask.offset === task.timeOffset &&
                    editingTask.label === task.label ? (
                      <>
                        <button
                          onClick={() =>
                            shiftTaskOffset(task.timeOffset, task.label, -5)
                          }
                          className="w-6 h-6 bg-gray-300 rounded text-sm"
                        >
                          −5
                        </button>
                        <span className="w-12 text-center">{task.timeOffset}分後</span>
                        <button
                          onClick={() =>
                            shiftTaskOffset(task.timeOffset, task.label, +5)
                          }
                          className="w-6 h-6 bg-gray-300 rounded text-sm"
                        >
                          ＋5
                        </button>
                      </>
                    ) : (
                      <span
                        onClick={() =>
                          toggleEditingTask(task.timeOffset, task.label)
                        }
                        className="w-20 cursor-pointer"
                      >
                        {task.timeOffset}分後
                      </span>
                    )}
                  </div>
                  {/* タスク名編集 */}
                  <input
                    type="text"
                    value={task.label}
                    onChange={(e) => {
                      const newLabel = e.target.value;
                      setCourses((prev) =>
                        prev.map((c) => {
                          if (c.name !== selectedCourse) return c;
                          const updatedTasks = c.tasks.map((t) =>
                            t.timeOffset === task.timeOffset && t.label === task.label
                              ? { ...t, label: newLabel }
                              : t
                          );
                          return { ...c, tasks: updatedTasks };
                        })
                      );
                    }}
                    className="flex-1 border px-2 py-1 rounded"
                  />
                  {/* 削除ボタン */}
                  <button
                    onClick={() => deleteTaskFromCourse(task.timeOffset, task.label)}
                    className="px-3 py-1 bg-red-500 text-white rounded text-sm"
                  >
                    削除
                  </button>
                </div>
              ))}

            {/* 新規タスク追加フォーム */}
            <form
              onSubmit={addTaskToCourse}
              className="flex items-center space-x-2 pt-2"
            >
              <input
                type="text"
                placeholder="タスク名"
                value={newTaskLabel}
                onChange={handleNewTaskLabelChange}
                className="border px-2 py-1 flex-1 rounded text-sm"
              />
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={() => setNewTaskOffset((prev) => Math.max(0, prev - 5))}
                  className="w-8 h-8 bg-gray-300 rounded text-sm"
                >
                  −5
                </button>
                <span className="w-12 text-center">{newTaskOffset}分後</span>
                <button
                  type="button"
                  onClick={() =>
                    setNewTaskOffset((prev) => Math.min(180, prev + 5))
                  }
                  className="w-8 h-8 bg-gray-300 rounded text-sm"
                >
                  ＋5
                </button>
              </div>
              <button
                type="submit"
                className="px-3 py-1 bg-blue-500 text-white rounded text-sm"
              >
                ＋タスク追加
              </button>
            </form>
          </div>
        </details>
      </section>

      {/* ─────────────── 2. 来店入力セクション ─────────────── */}
      <section>
        <details
          open={resInputOpen}
          onToggle={toggleResInput}
          className="border rounded"
        >
          <summary className="cursor-pointer p-2 font-semibold bg-gray-100 text-sm">
            {resInputOpen ? '▼▼ 来店入力を閉じる' : '▶▶ 来店入力を開く'}
          </summary>
          <div className="p-4 space-y-4 text-sm">
            <table className="min-w-full table-auto border text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="border px-1 py-1 w-20">卓番</th>
                  <th className="border px-1 py-1 w-20">来店時刻</th>
                  <th className="border px-1 py-1 w-24">コース</th>
                  <th className="border px-1 py-1 w-16">人数</th>
                  <th className="border px-1 py-1 w-12">削除</th>
                </tr>
              </thead>
              <tbody>
                {sortedReservationsByTime.map((r) => (
                  <tr key={r.id} className="text-center">
                    {/* 卓番セル */}
                    <td className="border px-1 py-1">
                      <input
                        type="text"
                        value={r.table}
                        readOnly
                        onClick={() =>
                          setNumPadState({ id: r.id, field: 'table', value: r.table })
                        }
                        className="border px-1 py-0.5 w-full rounded text-sm text-center cursor-pointer"
                      />
                    </td>

                    {/* 来店時刻セル */}
                    <td className="border px-1 py-1">
                      <select
                        value={r.time}
                        onChange={(e) => updateReservationField(r.id, 'time', e.target.value)}
                        className="border px-1 py-0.5 rounded text-sm"
                      >
                        {timeOptions.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* コースセル */}
                    <td className="border px-1 py-1">
                      <select
                        value={r.course}
                        onChange={(e) => updateReservationField(r.id, 'course', e.target.value)}
                        className="border px-1 py-0.5 rounded text-sm"
                      >
                        {courses.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                        <option value="未選択">未選択</option>
                      </select>
                    </td>

                    {/* 人数セル */}
                    <td className="border px-1 py-1">
                      <input
                        type="text"
                        value={r.guests}
                        readOnly
                        onClick={() =>
                          setNumPadState({ id: r.id, field: 'guests', value: r.guests.toString() })
                        }
                        className="border px-1 py-0.5 w-full rounded text-sm text-center cursor-pointer"
                      />
                    </td>

                    {/* 削除ボタンセル */}
                    <td className="border px-1 py-1">
                      <button
                        onClick={() => deleteReservation(r.id)}
                        className="bg-red-500 text-white px-2 py-0.5 rounded text-sm"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}

                {/* 追加入力行 */}
                <tr className="bg-gray-50">
                  {/* 新規卓番セル */}
                  <td className="border px-1 py-1">
                    <input
                      type="text"
                      value={newResTable}
                      readOnly
                      onClick={() => {
                        // 数値パッドを開く (新規行)
                        setNumPadState({ id: -1, field: 'table', value: '' });
                      }}
                      placeholder="例:101"
                      maxLength={3}
                      className="border px-1 py-0.5 w-full rounded text-sm text-center cursor-pointer"
                      required
                    />
                  </td>

                  {/* 新規来店時刻セル */}
                  <td className="border px-1 py-1">
                    <select
                      value={newResTime}
                      onChange={(e) => setNewResTime(e.target.value)}
                      className="border px-1 py-0.5 rounded text-sm"
                      required
                    >
                      {timeOptions.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* 新規コースセル */}
                  <td className="border px-1 py-1">
                    <select
                      value={newResCourse}
                      onChange={(e) => setNewResCourse(e.target.value)}
                      className="border px-1 py-0.5 rounded text-sm"
                    >
                      {courses.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                      <option value="未選択">未選択</option>
                    </select>
                  </td>

                  {/* 新規人数セル */}
                  <td className="border px-1 py-1">
                    <input
                      type="text"
                      value={newResGuests}
                      readOnly
                      onClick={() => {
                        // 数値パッドを開く (新規行)
                        setNumPadState({ id: -1, field: 'guests', value: '' });
                      }}
                      placeholder="人数"
                      maxLength={3}
                      className="border px-1 py-0.5 w-full rounded text-sm text-center cursor-pointer"
                      required
                    />
                  </td>

                  {/* 追加ボタンセル */}
                  <td className="border px-1 py-1 text-center">
                    <button
                      onClick={addReservation}
                      className="bg-blue-500 text-white px-2 py-0.5 rounded text-sm"
                    >
                      ＋
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* ─────────────── 3. コントロールバー(検索・表示切替) ─────────────── */}
      <section className="flex flex-wrap items-start space-x-4 space-y-2 text-sm">
        <div>
          <label className="mr-2">🔍 卓検索：</label>
          <input
            type="text"
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="卓番 / 人数 / コース / 時刻"
            className="border px-2 py-1 rounded text-sm"
          />
        </div>

        <div className="flex items-center space-x-2">
          <label>表示順：</label>
          <label>
            <input
              type="radio"
              name="order"
              checked={filterOrder === 'table'}
              onChange={() => setFilterOrder('table')}
              className="mr-1"
            />
            卓番順
          </label>
          <label>
            <input
              type="radio"
              name="order"
              checked={filterOrder === 'guests'}
              onChange={() => setFilterOrder('guests')}
              className="mr-1"
            />
            人数順
          </label>
        </div>

        <div className="flex flex-col">
          <label className="mb-1">コース絞り込み：</label>
          <select
            value={filterCourse}
            onChange={(e) => setFilterCourse(e.target.value)}
            className="border px-2 py-1 rounded text-sm"
          >
            <option value="全体">全体</option>
            {courses.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
            <option value="未選択">未選択</option>
          </select>
        </div>

        {/* 以下、md以上（タブレット・PC）では縦並び、sm以下（スマホ）では横並びにする */}
        <div className="flex flex-col md:flex-col md:space-y-2 space-x-4 md:space-x-0">
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={showCourseAll}
              onChange={() => {
                setShowCourseAll((prev) => !prev);
                // コース表示OFFのときはタスクまとめもOFF
                if (showCourseAll) setMergeSameTasks(false);
              }}
              className="mr-1"
            />
            <span>コース表示</span>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              checked={showGuestsAll}
              onChange={() => setShowGuestsAll((prev) => !prev)}
              className="mr-1"
            />
            <span>人数表示</span>
          </div>

          {/* コース表示ONのときのみ現れる「タスクまとめ表示」 */}
          {showCourseAll && (
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={mergeSameTasks}
                onChange={() => setMergeSameTasks((prev) => !prev)}
                className="mr-1"
              />
              <span>タスクまとめ表示</span>
            </div>
          )}
        </div>
      </section>

      {/* ─────────────── 4. タスク表示セクション ─────────────── */}
      <section className="space-y-4 text-sm">
        {sortedTimeKeys.map((timeKey) => (
          <div key={timeKey} className="border-b pb-2">
            {/* 時間帯見出し */}
            <div className="font-bold text-base mb-1">{timeKey}</div>

            {/* ── ここから「タスクまとめ表示」ON/OFF によって表示を切り替える ── */}
            {mergeSameTasks
              ? (() => {
                  // 【タスクまとめ表示 ON のとき】→「同じタスク名」をひとまとめにして表示
                  type Collected = {
                    label: string;
                    bgColor: string;
                    allReservations: Reservation[];
                  };
                  const collectMap: Record<string, Collected> = {};

                  // 各 TaskGroup(tg) を「label」だけでまとめる
                  groupedTasks[timeKey].forEach((tg) => {
                    if (!collectMap[tg.label]) {
                      collectMap[tg.label] = {
                        label: tg.label,
                        bgColor: tg.bgColor,
                        allReservations: tg.courseGroups.flatMap((cg) => cg.reservations),
                      };
                    } else {
                      // すでにキーがある場合は reservations を追加
                      collectMap[tg.label].allReservations.push(...tg.courseGroups.flatMap((cg) => cg.reservations));
                    }
                  });

                  // collectMap を配列にしてソート
                  const collectArr = Object.values(collectMap).sort((a, b) => {
                    return a.label.localeCompare(b.label);
                  });

                  return collectArr.map((ct) => {
                    // そのタスク名（ct.label）に対応するすべての reservations
                    const allRes = ct.allReservations;

                    // 「一括完了」ボタン判定
                    const allDone = allRes.every((r) =>
                      Boolean(r.completed[`${timeKey}_${ct.label}_${r.course}`])
                    );

                    return (
                      <div key={ct.label} className={`p-2 rounded mb-2 ${ct.bgColor}`}>
                        {/* タスク名と一括完了ボタン */}
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">{ct.label}</span>
                          <button
                            onClick={() => {
                              setReservations((prev) =>
                                prev.map((r) => {
                                  if (!allRes.find((ar) => ar.id === r.id)) return r;
                                  const key = `${timeKey}_${ct.label}_${r.course}`;
                                  const was = Boolean(r.completed[key]);
                                  const updated = { ...r.completed, [key]: !was };
                                  return { ...r, completed: updated };
                                })
                              );
                            }}
                            className="px-2 py-0.5 bg-green-500 text-white rounded text-sm"
                          >
                            {allDone ? '完了済み' : '全完了'}
                          </button>
                        </div>

                        {/* 全予約をひとつにまとめて左から並べて表示 */}
                        <div className="flex flex-wrap gap-2">
                          {allRes.map((r) => {
                            const compKeyDetail = `${timeKey}_${ct.label}_${r.course}`;
                            const isDone = Boolean(r.completed[compKeyDetail]);
                            return (
                              <div
                                key={r.id}
                                className={`border px-2 py-1 rounded text-xs ${
                                  isDone ? 'opacity-50 line-through' : ''
                                }`}
                              >
                                {r.table}
                                {showGuestsAll ? `(${r.guests})` : ''}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  });
                })()
              : (
                // 【タスクまとめ表示 OFF のとき】→「コースごと」に分けて表示
                groupedTasks[timeKey].map((tg) => (
                  <div key={tg.label} className={`p-2 rounded mb-2 ${tg.bgColor}`}>
                    {/* タスク名と全コース完了ボタン */}
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">{tg.label}</span>
                      <button
                        onClick={() => {
                          const allRes = tg.courseGroups.flatMap((cg) => cg.reservations);
                          setReservations((prev) =>
                            prev.map((r) => {
                              if (!allRes.find((ar) => ar.id === r.id)) return r;
                              const key = `${timeKey}_${tg.label}_${r.course}`;
                              const was = Boolean(r.completed[key]);
                              const updated = { ...r.completed, [key]: !was };
                              return { ...r, completed: updated };
                            })
                          );
                        }}
                        className="px-2 py-0.5 bg-green-500 text-white rounded text-sm"
                      >
                        全完了
                      </button>
                    </div>

                    {/* 各コースグループ */}
                    {showCourseAll
                      ? tg.courseGroups.map((cg) => {
                          const compKeyCourse = `${timeKey}_${tg.label}_${cg.courseName}`;
                          const allDone = cg.reservations.every((r) =>
                            Boolean(r.completed[compKeyCourse])
                          );
                          return (
                            <div
                              key={cg.courseName}
                              className="mb-1 border-b pb-1 last:border-0"
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="italic">（{cg.courseName}）</span>
                                <button
                                  onClick={() => {
                                    setReservations((prev) =>
                                      prev.map((r) => {
                                        if (!cg.reservations.find((cr) => cr.id === r.id)) return r;
                                        const key = `${timeKey}_${tg.label}_${cg.courseName}`;
                                        const was = Boolean(r.completed[key]);
                                        const updated = { ...r.completed, [key]: !was };
                                        return { ...r, completed: updated };
                                      })
                                    );
                                  }}
                                  className={`px-2 py-0.5 rounded text-sm ${
                                    allDone
                                      ? 'bg-green-700 text-white'
                                      : 'bg-green-600 text-white hover:bg-green-700'
                                  }`}
                                >
                                  {allDone ? '完了済み' : '完了'}
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {cg.reservations.map((r) => {
                                  const compKeyDetail = `${timeKey}_${tg.label}_${cg.courseName}`;
                                  const isDone = Boolean(r.completed[compKeyDetail]);
                                  return (
                                    <div
                                      key={r.id}
                                      className={`border px-2 py-1 rounded text-xs ${
                                        isDone ? 'opacity-50 line-through' : ''
                                      }`}
                                    >
                                      {r.table}
                                      {showGuestsAll ? `(${r.guests})` : ''}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })
                      : (() => {
                          // コース表示OFF → 一括表示
                          const allRes = tg.courseGroups.flatMap((cg) => cg.reservations);
                          const allDone = allRes.every((r) =>
                            Boolean(r.completed[`${timeKey}_${tg.label}_${r.course}`])
                          );
                          return (
                            <div key={`${tg.label}-all`} className="mb-1">
                              <div className="flex items-center justify-between mb-1">
                                <button
                                  onClick={() => {
                                    setReservations((prev) =>
                                      prev.map((r) => {
                                        if (!allRes.find((ar) => ar.id === r.id)) return r;
                                        const key = `${timeKey}_${tg.label}_${r.course}`;
                                        const was = Boolean(r.completed[key]);
                                        const updated = { ...r.completed, [key]: !was };
                                        return { ...r, completed: updated };
                                      })
                                    );
                                  }}
                                  className={`px-2 py-0.5 rounded text-sm ${
                                    allDone
                                      ? 'bg-green-700 text-white'
                                      : 'bg-green-600 text-white hover:bg-green-700'
                                  }`}
                                >
                                  {allDone ? '完了済み' : '完了'}
                                </button>
                                <div className="italic">(一括)</div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {allRes.map((r) => {
                                  const compKeyDetail = `${timeKey}_${tg.label}_${r.course}`;
                                  const isDone = Boolean(r.completed[compKeyDetail]);
                                  return (
                                    <div
                                      key={r.id}
                                      className={`border px-2 py-1 rounded text-xs ${
                                        isDone ? 'opacity-50 line-through' : ''
                                      }`}
                                    >
                                      {r.table}
                                      {showGuestsAll ? `(${r.guests})` : ''}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                  </div>
                ))
              )}
          </div>
        ))}
        {sortedTimeKeys.length === 0 && (
          <div className="text-center text-gray-500">
            表示するタスクはありません。
          </div>
        )}
      </section>

      {/* ─────────────── 5. 数値パッドモーダル ─────────────── */}
      {numPadState && (
        <div className="fixed inset-0 bg-black/30 flex items-end justify-center z-50">
          <div className="bg-white w-full max-w-md rounded-t-lg pb-4 shadow-lg">
            <div className="p-4 border-b">
              <p className="text-center text-lg font-semibold">
                {numPadState.field === 'table' ? '卓番' : '人数'} を入力
              </p>
              <p className="mt-2 text-center text-2xl font-mono">
                {numPadState.value || '　'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 p-4">
              {['1','2','3','4','5','6','7','8','9','0'].map((digit) => (
                <button
                  key={digit}
                  onClick={() => onNumPadPress(digit)}
                  className="bg-gray-200 rounded text-xl font-mono py-2"
                >
                  {digit}
                </button>
              ))}
              <button
                onClick={() => onNumPadPress('←')}
                className="bg-gray-200 rounded text-xl font-mono py-2"
              >
                ←
              </button>
              <button
                onClick={() => onNumPadPress('C')}
                className="bg-gray-200 rounded text-xl font-mono py-2"
              >
                C
              </button>
              <button
                onClick={onNumPadConfirm}
                className="col-span-3 bg-blue-500 rounded text-white text-lg py-2"
              >
                確定
              </button>
            </div>
            <button
              onClick={onNumPadCancel}
              className="w-full text-center text-sm text-gray-500 py-2"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

//
// ─────────────────────────────── EOF ────────────────────────────────────────────
//