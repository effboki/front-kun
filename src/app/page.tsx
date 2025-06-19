'use client';
// 📌 ChatGPT からのテスト編集: 拡張機能連携確認済み

import { useState, ChangeEvent, FormEvent, useMemo, useEffect } from 'react';

//
// ───────────────────────────── ① TYPES ────────────────────────────────────────────
//

// タスク定義
type TaskDef = {
  timeOffset: number; // 分後 (0〜180)
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
  table: string;       // 卓番 (文字列で OK)
  time: string;        // "HH:MM"
  course: string;      // コース名
  guests: number;      // 人数
  name: string;        // 追加：予約者氏名
  notes: string;       // 追加：備考
  completed: {         // 完了フラグ (キー: `${timeKey}_${taskLabel}_${course}`)
    [key: string]: boolean;
  };
};

// ===== LocalStorage helpers =====
const RES_KEY = 'front-kun-reservations';

function loadReservations(): Reservation[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(RES_KEY) || '[]');
  } catch {
    return [];
  }
}

function persistReservations(arr: Reservation[]) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(RES_KEY, JSON.stringify(arr));
  }
}
// =================================

//
// ───────────────────────────── ② MAIN コンポーネント ─────────────────────────────────
//

export default function Home() {
  // Sidebar open state
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  // Hydration guard
  const [hydrated, setHydrated] = useState<boolean>(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const [selectedMenu, setSelectedMenu] = useState<string>('予約リスト×タスク表');
  // ─────────────── 追加: コントロールバー用 state ───────────────
  const [showCourseAll, setShowCourseAll] = useState<boolean>(true);
  const [showGuestsAll, setShowGuestsAll] = useState<boolean>(true);
  // 「コース開始時間表」でコース名を表示するかどうか
  const [showCourseStart, setShowCourseStart] = useState<boolean>(true);
  // 「コース開始時間表」で卓番を表示するかどうか
const [showTableStart, setShowTableStart] = useState<boolean>(true);  
      {/* ─────────────── 予約リスト×コース開始時間表セクション ─────────────── */}
      {selectedMenu === '予約リスト×コース開始時間表' && (
        <>
          <section>
            {/* ── フィルター切り替え ── */}
            <div className="flex items-center space-x-2 mb-4">
              <span className="font-semibold text-sm">フィルター:</span>
              {/* フィルターコントロール等ここに挿入されている前提 */}
              {/* ...既存のフィルターUI... */}
            </div>
            {/* ── コース名表示 切り替え ── */}
            <div className="flex items-center space-x-2 mb-4">
              <span className="font-semibold text-sm">コース名:</span>
              <button
                onClick={() => setShowCourseStart(true)}
                className={`px-2 py-0.5 rounded text-xs ${
                  showCourseStart ? 'bg-blue-500 text-white' : 'bg-gray-200'
                }`}
              >
                ON
              </button>
              <button
                onClick={() => setShowCourseStart(false)}
                className={`px-2 py-0.5 rounded text-xs ${
                  !showCourseStart ? 'bg-blue-500 text-white' : 'bg-gray-200'
                }`}
              >
                OFF
              </button>
            </div>
            {/* ...以下「コース開始時間表」の内容... */}
            {/* 例: groupedStartTimes のレンダリング */}
            {/* 
            {Object.entries(groupedStartTimes).map(([time, courseGroups]) => (
              <div key={time}>
                <div className="font-bold">{time}</div>
                {courseGroups.map((cg) => (
                  <div key={cg.courseName}>
                    {showCourseStart && (
                      <div className="text-xs mb-1">({cg.courseName})</div>
                    )}
                    // ...その他の内容...
                  </div>
                ))}
              </div>
            ))}
            */}
          </section>
        </>
      )}
  const [mergeSameTasks, setMergeSameTasks] = useState<boolean>(false);
  const [taskSort, setTaskSort] = useState<'table' | 'guests'>('table');
  const [filterCourse, setFilterCourse] = useState<string>('全体');

  // タスク選択モード状態
  const [selectionModeTask, setSelectionModeTask] = useState<string | null>(null);
  const [selectedForComplete, setSelectedForComplete] = useState<number[]>([]);

  // 来店チェック用 state
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

  const [checkedArrivals, setCheckedArrivals] = useState<number[]>([]);
  const [checkedDepartures, setCheckedDepartures] = useState<number[]>([]);

  // 来店チェック切り替え用ヘルパー
  const toggleArrivalChecked = (id: number) => {
    setCheckedArrivals((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  // 退店チェック切り替え用ヘルパー
  const toggleDepartureChecked = (id: number) => {
    setCheckedDepartures((prev) => {
      const isDeparted = prev.includes(id);
      if (isDeparted) {
        return prev.filter((x) => x !== id);
      } else {
        setCheckedArrivals((arr) => arr.filter((x) => x !== id));
        return [...prev, id];
      }
    });
  };
  // ─── 2.1 コース・タスクの定義・状態管理 ─────────────────────────────────────
  //

  const defaultCourses: CourseDef[] = [
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
  ];

  // 初期レンダリング時は必ず defaultCourses で一致させる（SSR ↔ CSR）
  const [courses, setCourses] = useState<CourseDef[]>(defaultCourses);

  // CSR でのみ localStorage を参照して上書き（Hydration mismatch 回避）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('front-kun-courses');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as CourseDef[];
        setCourses(parsed);
      } catch {
        /* ignore JSON parse error */
      }
    }
  }, []);

  // 選択中のコース名 (タスク設定用)
  const [selectedCourse, setSelectedCourse] = useState<string>(() => {
    if (typeof window === 'undefined') return 'スタンダード';
    return localStorage.getItem('front-kun-selectedCourse') || 'スタンダード';
  });
  // タスク設定セクションの開閉
  const [courseTasksOpen, setCourseTasksOpen] = useState<boolean>(false);
  // 編集中の既存タスク (offset と label で一意に判定)
  const [editingTask, setEditingTask] = useState<{ offset: number; label: string } | null>(null);
  // タスク追加用フィールド
  const [newTaskLabel, setNewTaskLabel] = useState<string>('');
  const [newTaskOffset, setNewTaskOffset] = useState<number>(0);

  // “表示タスクフィルター” 用チェック済みタスク配列
  const [checkedTasks, setCheckedTasks] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem('front-kun-checkedTasks');
    return stored ? JSON.parse(stored) : [];
  });

  //
  // ─── 2.2 予約(来店) の状態管理 ────────────────────────────────────────────
  //

  const [reservations, setReservations] = useState<Reservation[]>(loadReservations());
  const [nextResId, setNextResId] = useState<number>(1);

  // 新規予約入力用フィールド（卓番・時刻・コース・人数・氏名・備考）
  const [newResTable, setNewResTable] = useState<string>('');
  const [newResTime, setNewResTime] = useState<string>('18:00');
  const [newResCourse, setNewResCourse] = useState<string>('スタンダード');
  const [newResGuests, setNewResGuests] = useState<number | ''>('');
  const [newResName, setNewResName] = useState<string>('');   // タブレット用：予約者氏名
  const [newResNotes, setNewResNotes] = useState<string>(''); // タブレット用：備考

  // 来店入力セクションの開閉
  const [resInputOpen, setResInputOpen] = useState<boolean>(false);
  // 来店入力：氏名表示・備考表示（タブレット専用）
  const [showNameCol, setShowNameCol] = useState<boolean>(true);
  const [showNotesCol, setShowNotesCol] = useState<boolean>(true);
  // 来店入力: 人数列を表示するかどうか
  const [showGuestsCol, setShowGuestsCol] = useState<boolean>(true);
  // 表示順選択 (table/time)
  const [resOrder, setResOrder] = useState<'table' | 'time'>(() => {
    if (typeof window === 'undefined') return 'table';
    return (localStorage.getItem('front-kun-resOrder') as 'table' | 'time') || 'table';
  });

  //
  // ─── 2.3 「店舗設定」関連の state ───────────────────────────────────────────
  //

  // “事前に設定する卓番号リスト” を管理
  const [presetTables, setPresetTables] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem('front-kun-presetTables');
    return stored ? JSON.parse(stored) : [];
  });
  // 新規テーブル入力用 (numeric pad)
  const [newTableTemp, setNewTableTemp] = useState<string>('');
  // 卓設定セクション開閉
  const [tableSettingsOpen, setTableSettingsOpen] = useState<boolean>(false);
  // フロア図エディット用テーブル設定トグル
  const [tableConfigOpen, setTableConfigOpen] = useState<boolean>(false);
  // “フィルター表示する卓番号” 用チェック済みテーブル配列
  const [checkedTables, setCheckedTables] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem('front-kun-checkedTables');
    return stored ? JSON.parse(stored) : [];
  });
  // 卓リスト編集モード
  const [tableEditMode, setTableEditMode] = useState<boolean>(false);
  const [posSettingsOpen, setPosSettingsOpen] = useState<boolean>(false);
  // ─── ポジション設定 state ───
  const [positions, setPositions] = useState<string[]>(() => {
    const stored = typeof window !== 'undefined' && localStorage.getItem('front-kun-positions');
    return stored ? JSON.parse(stored) : ['フロント', 'ホール', '刺し場', '焼き場', 'オーブン', 'ストーブ', '揚げ場'];
  });
  const [newPositionName, setNewPositionName] = useState<string>('');
  // ポジションごと × コースごと でタスクを保持する  {pos: {course: string[]}}
  const [tasksByPosition, setTasksByPosition] =
    useState<Record<string, Record<string, string[]>>>(() => {
      if (typeof window === 'undefined') return {};
      const stored = localStorage.getItem('front-kun-tasksByPosition');
      if (!stored) return {};
      try {
        const parsed = JSON.parse(stored);
        // 旧フォーマット (pos -> string[]) を course:"*" に移行
        const isOldFormat =
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          Object.values(parsed).every((v) => Array.isArray(v));

        if (isOldFormat) {
          const migrated: Record<string, Record<string, string[]>> = {};
          Object.entries(parsed).forEach(([p, arr]) => {
            migrated[p] = { '*': arr as string[] };
          });
          return migrated;
        }
        return parsed;
      } catch {
        return {};
      }
    });
  // ポジションごとの開閉 state
  const [openPositions, setOpenPositions] = useState<Record<string, boolean>>(() => {
    const obj: Record<string, boolean> = {};
    positions.forEach((p) => { obj[p] = false; });
    return obj;
  });
  const togglePositionOpen = (pos: string) => {
    setOpenPositions((prev) => ({ ...prev, [pos]: !prev[pos] }));
  };
  // ─── ポジションごとの選択中コース ───
  const [courseByPosition, setCourseByPosition] = useState<Record<string, string>>(() => {
    const stored = typeof window !== 'undefined' && localStorage.getItem('front-kun-courseByPosition');
    if (stored) return JSON.parse(stored);
    // default to first course for each position
    const map: Record<string, string> = {};
    positions.forEach((pos) => {
      map[pos] = courses[0]?.name || '';
    });
    return map;
  });
  const setCourseForPosition = (pos: string, courseName: string) => {
    const next = { ...courseByPosition, [pos]: courseName };
    setCourseByPosition(next);
    localStorage.setItem('front-kun-courseByPosition', JSON.stringify(next));
  };
  // 全コースからタスクラベル一覧を取得
  const allTasks = useMemo(() => {
    const labels = new Set<string>();
    courses.forEach((c) => c.tasks.forEach((t) => labels.add(t.label)));
    return Array.from(labels);
  }, [courses]);
  // ポジション操作ヘルパー
  const addPosition = () => {
    if (!newPositionName.trim() || positions.includes(newPositionName.trim())) return;
    const next = [...positions, newPositionName.trim()];
    setPositions(next);
    localStorage.setItem('front-kun-positions', JSON.stringify(next));
    setNewPositionName('');
  };
  const removePosition = (pos: string) => {
    const next = positions.filter((p) => p !== pos);
    setPositions(next);
    localStorage.setItem('front-kun-positions', JSON.stringify(next));
    const nextTasks = { ...tasksByPosition };
    delete nextTasks[pos];
    setTasksByPosition(nextTasks);
    localStorage.setItem('front-kun-tasksByPosition', JSON.stringify(nextTasks));
  };

  // ポジションの並び替え: 上へ移動
  const movePositionUp = (pos: string) => {
    setPositions(prev => {
      const idx = prev.indexOf(pos);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      localStorage.setItem('front-kun-positions', JSON.stringify(next));
      return next;
    });
  };

  // ポジションの並び替え: 下へ移動
  const movePositionDown = (pos: string) => {
    setPositions(prev => {
      const idx = prev.indexOf(pos);
      if (idx < 0 || idx === prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      localStorage.setItem('front-kun-positions', JSON.stringify(next));
      return next;
    });
  };
  // ポジション名を変更
  const renamePosition = (pos: string) => {
    const newName = prompt(`「${pos}」の新しいポジション名を入力してください`, pos);
    if (!newName || newName.trim() === "" || newName === pos) return;
    if (positions.includes(newName)) {
      alert("同名のポジションが既に存在します。");
      return;
    }
    // positions 配列の更新
    setPositions(prev => {
      const next = prev.map(p => (p === pos ? newName : p));
      localStorage.setItem("front-kun-positions", JSON.stringify(next));
      return next;
    });
    // tasksByPosition のキーを更新
    setTasksByPosition(prev => {
      const next = { ...prev, [newName]: prev[pos] || {} };
      delete next[pos];
      localStorage.setItem("front-kun-tasksByPosition", JSON.stringify(next));
      return next;
    });
    // openPositions のキーを更新
    setOpenPositions(prev => {
      const next = { ...prev, [newName]: prev[pos] };
      delete next[pos];
      return next;
    });
    // courseByPosition のキーを更新
    setCourseByPosition(prev => {
      const next = { ...prev, [newName]: prev[pos] };
      delete next[pos];
      localStorage.setItem("front-kun-courseByPosition", JSON.stringify(next));
      return next;
    });
  };
  // pos・course 単位でタスク表示をトグル
  const toggleTaskForPosition = (pos: string, courseName: string, label: string) => {
    setTasksByPosition(prev => {
      const courseTasks = prev[pos]?.[courseName] ?? [];
      const nextTasks = courseTasks.includes(label)
        ? courseTasks.filter(l => l !== label)
        : [...courseTasks, label];

      const nextPos = { ...(prev[pos] || {}), [courseName]: nextTasks };
      const next = { ...prev, [pos]: nextPos };
      localStorage.setItem('front-kun-tasksByPosition', JSON.stringify(next));
      return next;
    });
  };
  const [courseSettingsTableOpen, setCourseSettingsTableOpen] = useState<boolean>(false);
  // ─── 営業前設定タブのトグル state ───
  const [displayTablesOpen1, setDisplayTablesOpen1] = useState<boolean>(false);
  const [displayTablesOpen2, setDisplayTablesOpen2] = useState<boolean>(false);
  // 「コース開始時間表」でポジション／卓フィルターを使うかどうか
const [courseStartFiltered, setCourseStartFiltered] = useState<boolean>(true);
  // ─── 営業前設定：表示タスク用選択中ポジション ───
  const [selectedDisplayPosition, setSelectedDisplayPosition] = useState<string>(
    positions[0] || ''
  );
  // 営業前設定・タスクプレビュー用に表示中のコース
  const [displayTaskCourse, setDisplayTaskCourse] = useState<string>(() => courses[0]?.name || '');

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

  // コース選択変更
  const handleCourseChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setSelectedCourse(e.target.value);
    localStorage.setItem('front-kun-selectedCourse', e.target.value);
  };

  // タスク設定セクションの開閉
  const toggleCourseTasks = () => {
    if (!courseTasksOpen) {
      if (!confirm('タスク設定を開きますか？')) return;
    }
    setCourseTasksOpen((prev) => !prev);
  };

  // 既存タスクを削除
  const deleteTaskFromCourse = (offset: number, label: string) => {
    if (!confirm(`「${label}」を削除しますか？`)) return;
    setCourses((prev) => {
      const next = prev.map((c) => {
        if (c.name !== selectedCourse) return c;
        return {
          ...c,
          tasks: c.tasks.filter((t) => !(t.timeOffset === offset && t.label === label)),
        };
      });
      localStorage.setItem('front-kun-courses', JSON.stringify(next));
      return next;
    });
    setEditingTask(null);
  };

  // 既存タスク時間を ±5 分ずらす
  const shiftTaskOffset = (offset: number, label: string, delta: number) => {
    setCourses((prev) => {
      const next = prev.map((c) => {
        if (c.name !== selectedCourse) return c;
        const newTasks = c.tasks.map((t) => {
          if (t.timeOffset !== offset || t.label !== label) return t;
          const newOffset = Math.max(0, Math.min(180, t.timeOffset + delta));
          return { ...t, timeOffset: newOffset };
        });
        newTasks.sort((a, b) => a.timeOffset - b.timeOffset);
        return { ...c, tasks: newTasks };
      });
      localStorage.setItem('front-kun-courses', JSON.stringify(next));
      return next;
    });
    if (editingTask && editingTask.offset === offset && editingTask.label === label) {
      setEditingTask({ offset: Math.max(0, Math.min(180, offset + delta)), label });
    }
  };

  // 編集モード切り替え
  const toggleEditingTask = (offset: number, label: string) => {
    if (editingTask && editingTask.offset === offset && editingTask.label === label) {
      setEditingTask(null);
    } else {
      setEditingTask({ offset, label });
    }
  };

  // 新規タスクをコースに追加
  const addTaskToCourse = (label: string, offset: number) => {
    setCourses((prev) => {
      const next = prev.map((c) => {
        if (c.name !== selectedCourse) return c;
        if (c.tasks.some((t) => t.timeOffset === offset && t.label === label)) {
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
        const color = bgColorMap[label] || 'bg-gray-100/80';
        const updatedTasks = [
          ...c.tasks,
          { timeOffset: offset, label, bgColor: color },
        ];
        updatedTasks.sort((a, b) => a.timeOffset - b.timeOffset);
        return { ...c, tasks: updatedTasks };
      });
      localStorage.setItem('front-kun-courses', JSON.stringify(next));
      return next;
    });
  };

  // コース名を変更
  const renameCourse = () => {
    const oldName = selectedCourse;
    const newName = prompt(`「${oldName}」の新しいコース名を入力してください`, oldName);
    if (!newName || newName.trim() === "" || newName === oldName) return;
    if (courses.some(c => c.name === newName)) {
      alert("同名のコースが既に存在します。");
      return;
    }
    // courses 配列の更新
    setCourses(prev => {
      const next = prev.map(c => (c.name === oldName ? { ...c, name: newName } : c));
      localStorage.setItem('front-kun-courses', JSON.stringify(next));
      return next;
    });
    // 選択中コース名も更新
    setSelectedCourse(newName);
    localStorage.setItem('front-kun-selectedCourse', newName);
    // ポジションごとの設定済みコース名 (courseByPosition) のキーを更新
    setCourseByPosition(prev => {
      const next = { ...prev };
      if (oldName in next) {
        next[newName] = next[oldName];
        delete next[oldName];
        localStorage.setItem('front-kun-courseByPosition', JSON.stringify(next));
      }
      return next;
    });
  };

  // “表示タスクフィルター” のチェック操作
  const handleTaskCheck = (label: string) => {
    setCheckedTasks((prev) => {
      if (prev.includes(label)) {
        const next = prev.filter((l) => l !== label);
        localStorage.setItem('front-kun-checkedTasks', JSON.stringify(next));
        return next;
      } else {
        const next = [...prev, label];
        localStorage.setItem('front-kun-checkedTasks', JSON.stringify(next));
        return next;
      }
    });
  };

  // ─── 2.6c localStorage から予約バックアップを復元 ──────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem('front-kun-reservations_cache');
      if (raw) {
        const cached: Reservation[] = JSON.parse(raw);
        if (cached.length > 0) {
          setReservations(cached);
          const maxId = cached.reduce((m, x) => (x.id > m ? x.id : m), 0);
          setNextResId(maxId + 1);
        }
      }
    } catch (err) {
      console.error('localStorage read error:', err);
    }
  }, []);

  // ─── 2.6d 予約が変わるたびに localStorage に保存 ──────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem('front-kun-reservations_cache', JSON.stringify(reservations));
    } catch (err) {
      console.error('localStorage write error:', err);
    }
  }, [reservations]);
  //
  // ─── 2.7 “予約リストのソートとフィルター” ─────────────────────────────────────────
  //

  const sortedByTable = useMemo(() => {
    return [...reservations].sort((a, b) => Number(a.table) - Number(b.table));
  }, [reservations]);

  const sortedByTime = useMemo(() => {
    return [...reservations].sort((a, b) => {
      return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
    });
  }, [reservations]);

  // 表示順決定
  const sortedReservations = resOrder === 'time' ? sortedByTime : sortedByTable;

  // “事前設定テーブル” で選ばれたもののみ表示＋コース絞り込み
  const filteredReservations = useMemo(() => {
    return sortedReservations
      .filter((r) => {
        // Table filter
        if (checkedTables.length > 0 && !checkedTables.includes(r.table)) return false;
        // Course filter
        if (filterCourse !== '全体' && r.course !== filterCourse) return false;
        return true;
      });
  }, [sortedReservations, checkedTables, filterCourse, checkedDepartures]);

  /* ─── 2.x リマインド機能 state & ロジック ───────────────────────── */
  // 通知の ON/OFF
  const [remindersEnabled, setRemindersEnabled] = useState<boolean>(false);

  // 現在時刻 "HH:MM"
  const [currentTime, setCurrentTime] = useState<string>(() => {
    const now = new Date();
    return formatMinutesToTime(now.getHours() * 60 + now.getMinutes());
  });

  // 1 分ごとに currentTime を更新
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCurrentTime(formatMinutesToTime(now.getHours() * 60 + now.getMinutes()));
    };
    const id = setInterval(tick, 60_000);
    tick(); // 初回即実行
    return () => clearInterval(id);
  }, []);

  /** 「これから来るタスク」を時刻キーごとにまとめた配列
   *  [{ timeKey: "18:15", tasks: ["コース説明", "カレー"] }, ... ]
   */
  const upcomingReminders = useMemo<Array<{ timeKey: string; tasks: string[] }>>(() => {
    if (!filteredReservations.length) return [];
    const nowMin = parseTimeToMinutes(currentTime);

    const map: Record<string, Set<string>> = {};

    filteredReservations.forEach((res) => {
      const courseDef = courses.find((c) => c.name === res.course);
      if (!courseDef) return;
      const baseMin = parseTimeToMinutes(res.time);

      courseDef.tasks.forEach((t) => {
        const absMin = baseMin + t.timeOffset;
        // ---------- 表示タスクフィルター ----------
{
  const set = new Set<string>();
  checkedTasks.forEach((l) => set.add(l));
  if (selectedDisplayPosition !== 'その他') {
    const posObj = tasksByPosition[selectedDisplayPosition] || {};
    (posObj[courseByPosition[selectedDisplayPosition]] || []).forEach((l) => set.add(l));
  }
  if (set.size > 0 && !set.has(t.label)) return; // 非表示タスクはスキップ
}
// ------------------------------------------
        if (absMin < nowMin) return; // 既に過ぎているタスクは対象外
        const timeKey = formatMinutesToTime(absMin);
        if (!map[timeKey]) map[timeKey] = new Set();
        map[timeKey].add(t.label);
      });
    });

    // map → 配列へ変換し時刻順にソート
    return Object.entries(map)
      .sort((a, b) => parseTimeToMinutes(a[0]) - parseTimeToMinutes(b[0]))
      .map(([timeKey, set]) => ({ timeKey, tasks: Array.from(set) }));
  }, [filteredReservations, courses, currentTime]);

  // 回転テーブル判定: 同じ卓番号が複数予約されている場合、その卓は回転中とみなす
  const tableCounts: Record<string, number> = {};
  filteredReservations.forEach((r) => {
    tableCounts[r.table] = (tableCounts[r.table] || 0) + 1;
  });
  const rotatingTables = new Set(Object.keys(tableCounts).filter((t) => tableCounts[t] > 1));
  // 各回転テーブルごとに最初の予約IDを記録
  const firstRotatingId: Record<string, number> = {};
  filteredReservations.forEach((r) => {
    if (rotatingTables.has(r.table) && !(r.table in firstRotatingId)) {
      firstRotatingId[r.table] = r.id;
    }
  });


  //
  // ─── 2.8 “タスク表示用グルーピングロジック” ────────────────────────────────────────
  //

  // ─── コース開始時間表用グルーピング ─────────────────────────────
  const groupedStartTimes = useMemo(() => {
    const map: Record<string, Record<string, Reservation[]>> = {};
    const source = courseStartFiltered ? filteredReservations : sortedReservations;
source.forEach((r) => {
      // コース絞り込み
      if (filterCourse !== '全体' && r.course !== filterCourse) return;
      if (!map[r.time]) map[r.time] = {};
      if (!map[r.time][r.course]) map[r.time][r.course] = [];
      map[r.time][r.course].push(r);
    });
    // timeKey → [{ courseName, reservations }]
    return Object.fromEntries(
      Object.entries(map).map(([timeKey, coursesMap]) => [
        timeKey,
        Object.entries(coursesMap).map(([courseName, reservations]) => ({ courseName, reservations })),
      ])
    );
  }, [filteredReservations, sortedReservations, filterCourse, courseStartFiltered]);

  type TaskGroup = {
    timeKey: string;
    label: string;
    bgColor: string;
    courseGroups: {
      courseName: string;
      reservations: Reservation[];
    }[];
  };

  const groupedTasks: Record<string, TaskGroup[]> = {};

  filteredReservations.forEach((res) => {
    // Skip tasks for departed reservations
    if (checkedDepartures.includes(res.id)) return;
    if (res.course === '未選択') return;
    const courseDef = courses.find((c) => c.name === res.course);
    if (!courseDef) return;
    const baseMinutes = parseTimeToMinutes(res.time);
    courseDef.tasks.forEach((t) => {
     // === 営業前設定の「表示するタスク」フィルター ===========================
// 「その他」タブ (checkedTasks) ＋ 選択中ポジション × コース(tasksByPosition)
// の両方を合算し、含まれないタスクは描画しない
const allowedTaskLabels = (() => {
  const set = new Set<string>();
  // その他タブでチェックされたタスク
  checkedTasks.forEach((l) => set.add(l));
  // 選択中ポジション側
  if (selectedDisplayPosition !== 'その他') {
    const posObj = tasksByPosition[selectedDisplayPosition] || {};
    (posObj[courseByPosition[selectedDisplayPosition]] || []).forEach((l) => set.add(l));
  }
  return set;
})();
if (allowedTaskLabels.size > 0 && !allowedTaskLabels.has(t.label)) return;
      const slot = baseMinutes + t.timeOffset;
      const timeKey = formatMinutesToTime(slot);
      if (!groupedTasks[timeKey]) groupedTasks[timeKey] = [];
      let taskGroup = groupedTasks[timeKey].find((g) => g.label === t.label);
      if (!taskGroup) {
        taskGroup = { timeKey, label: t.label, bgColor: t.bgColor, courseGroups: [] };
        groupedTasks[timeKey].push(taskGroup);
      }
      let courseGroup = taskGroup.courseGroups.find((cg) => cg.courseName === res.course);
      if (!courseGroup) {
        courseGroup = { courseName: res.course, reservations: [] };
        taskGroup.courseGroups.push(courseGroup);
      }
      courseGroup.reservations.push(res);
    });
  });

  const sortedTimeKeys = Object.keys(groupedTasks).sort((a, b) => {
    return parseTimeToMinutes(a) - parseTimeToMinutes(b);
  });
  // ─── “リマインド用” 直近タイムキー（現在含む先頭4つ） ───
  const futureTimeKeys = useMemo(() => {
    const nowMin = parseTimeToMinutes(currentTime);
    return sortedTimeKeys
      .filter((tk) => parseTimeToMinutes(tk) >= nowMin)
      .slice(0, 4);
  }, [sortedTimeKeys, currentTime]);
  sortedTimeKeys.forEach((timeKey) => {
    groupedTasks[timeKey].sort((a, b) => {
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
  // ─── 2.9 “数値パッド” 用の状態とハンドラ ─────────────────────────────────────────
  //

  const [numPadState, setNumPadState] = useState<{
    id: number;
    field: 'table' | 'guests' | 'presetTable';
    value: string;
  } | null>(null);

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
        if (newVal.length < 3) {
          newVal = newVal + char;
        }
      }
      return { ...prev, value: newVal };
    });
  };

  const onNumPadConfirm = () => {
    if (!numPadState) return;
    const { id, field, value } = numPadState;
    if (field === 'presetTable') {
      // 新しい卓番を追加
      if (value.trim()) {
        const newTable = value.trim();
        setPresetTables((prev) => {
          const next = [...prev.filter((t) => t !== newTable), newTable].sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true })
          );
          localStorage.setItem('front-kun-presetTables', JSON.stringify(next));
          return next;
        });
      }
      setNewTableTemp('');
    } else if (id === -1) {
      // 新規予約行
      if (field === 'table') {
        setNewResTable(value);
      } else {
        const n = Number(value);
        if (!isNaN(n) && n >= 1 && n <= 999) {
          setNewResGuests(n);
        } else {
          setNewResGuests(1);
        }
      }
    } else {
      // 既存予約編集
      const n = Number(value);
      if (field === 'table') {
        updateReservationField(id, 'table', value);
      } else if (field === 'guests') {
        if (!isNaN(n) && n >= 1 && n <= 999) {
          updateReservationField(id, 'guests', n);
        }
      }
    }
    setNumPadState(null);
  };

  const onNumPadCancel = () => {
    setNumPadState(null);
    setNewTableTemp('');
  };

  //
  // ─── 2.10 LocalStorage 操作 ────────────────────────────────
  //

  const addReservation = (e: FormEvent) => {
    e.preventDefault();
    if (!newResTable || !newResTime || newResGuests === '' || isNaN(Number(newResGuests))) return;

    const newEntry: Reservation = {
      id: nextResId,
      table: newResTable,
      time: newResTime,
      course: newResCourse,
      guests: Number(newResGuests),
      name: newResName.trim(),
      notes: newResNotes.trim(),
      completed: {},
    };

    setReservations(prev => {
      const next = [...prev, newEntry];
      persistReservations(next);
      return next;
    });
    setNextResId(prev => prev + 1);
    setNewResTable('');
    setNewResTime('18:00');
    setNewResGuests('');
    setNewResCourse('スタンダード');
    setNewResName('');
    setNewResNotes('');
  };

  const deleteReservation = (id: number) => {
    if (!confirm('この来店情報を削除しますか？')) return;
    setReservations(prev => {
      const next = prev.filter(r => r.id !== id);
      persistReservations(next);
      return next;
    });
  };

  const updateReservationField = (
    id: number,
    field: 'time' | 'course' | 'guests' | 'name' | 'notes' | 'table' | 'completed',
    value: string | number | { [key: string]: boolean }
  ) => {
    setReservations(prev => {
      const next = prev.map(r => {
        if (r.id !== id) return r;
        if (field === 'guests') return { ...r, guests: Number(value) };
        else if (field === 'course') {
          const oldCourse = r.course;
          const newCourse = value as string;
          // --- 完了フラグのキーを旧コース名から新コース名へ置換 ---
          const migratedCompleted: { [key: string]: boolean } = {};
          Object.entries(r.completed || {}).forEach(([key, done]) => {
            if (key.endsWith(`_${oldCourse}`)) {
              const newKey = key.replace(new RegExp(`_${oldCourse}$`), `_${newCourse}`);
              migratedCompleted[newKey] = done;
            } else {
              migratedCompleted[key] = done;
            }
          });
          return { ...r, course: newCourse, completed: migratedCompleted };
        }
        return { ...r, [field]: value };
      });
      persistReservations(next);
      return next;
    });
  };
  // ───────────────────────────────────────────────────────────

  return (
    <>
      {/* Header with hamburger */}
      <header className="fixed top-0 left-0 w-full bg-white z-40 p-2 shadow">
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
          className="text-2xl"
        >
          ☰
        </button>
      </header>
      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Sidebar panel */}
          <div className="w-64 bg-gray-800 text-white p-4">
            <button
              onClick={() => setSidebarOpen(false)}
              aria-label="Close menu"
              className="text-xl mb-4"
            >
              ×
            </button>
            <ul className="space-y-2">
              <li>
                <button
                  onClick={() => {
                    setSelectedMenu('店舗設定画面');
                    setSidebarOpen(false);
                  }}
                  className="w-full text-left"
                >
                  店舗設定画面
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    setSelectedMenu('営業前設定');
                    setSidebarOpen(false);
                  }}
                  className="w-full text-left"
                >
                  営業前設定
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    setSelectedMenu('リマインド');
                    setSidebarOpen(false);
                  }}
                  className="w-full text-left"
                >
                  リマインド
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    setSelectedMenu('予約リスト×タスク表');
                    setSidebarOpen(false);
                  }}
                  className="w-full text-left"
                >
                  予約リスト×タスク表
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    setSelectedMenu('予約リスト×コース開始時間表');
                    setSidebarOpen(false);
                  }}
                  className="w-full text-left"
                >
                  予約リスト×コース開始時間表
                </button>
              </li>
            </ul>
          </div>
          {/* Backdrop */}
          <div
            className="flex-1 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
        </div>
      )}
      <main className="pt-12 p-4 space-y-6">
      {/* ─────────────── 店舗設定セクション ─────────────── */}
      {selectedMenu === '店舗設定画面' && (
        <section>
          {/* コース設定表ボタンと内容を上に移動 */}
          <button
            onClick={() => setCourseSettingsTableOpen(prev => !prev)}
            className="w-full text-left p-2 font-semibold bg-gray-100 rounded text-sm"
          >
            {courseSettingsTableOpen ? '▼▼ コース設定表' : '▶▶ コース設定表'}
          </button>
          {courseSettingsTableOpen && (
            <div className="p-4 space-y-3 text-sm border rounded">
              {/* 設定中のコース・新コース作成 */}
              <div className="flex items-center space-x-2 mb-3">
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
                  onClick={renameCourse}
                  className="ml-2 px-3 py-1 bg-blue-500 text-white rounded text-sm"
                >
                  ✎ コース名変更
                </button>
                <button
                  onClick={() => {
                    const courseName = prompt('新しいコース名を入力してください：');
                    if (!courseName) return;
                    if (courses.some((c) => c.name === courseName)) {
                      alert('そのコース名は既に存在します。');
                      return;
                    }
                    const next = [...courses, { name: courseName, tasks: [] }];
                    setCourses(next);
                    localStorage.setItem('front-kun-courses', JSON.stringify(next));
                    setSelectedCourse(courseName);
                  }}
                  className="ml-2 px-3 py-1 bg-green-500 text-white rounded text-sm"
                >
                  ＋新コース作成
                </button>
              </div>
            {courses
              .find((c) => c.name === selectedCourse)!
              .tasks.slice()
              .sort((a, b) => a.timeOffset - b.timeOffset)
              .map((task) => (
                <div
                  key={`${task.timeOffset}_${task.label}`}
                  className="flex flex-wrap items-center space-x-2 border-b pb-1"
                >
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
                          -5
                        </button>
                        <span className="w-12 text-center">{task.timeOffset}分後</span>
                        <button
                          onClick={() =>
                            shiftTaskOffset(task.timeOffset, task.label, +5)
                          }
                          className="w-6 h-6 bg-gray-300 rounded text-sm"
                        >
                          +5
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

                  <input
                    type="text"
                    value={task.label}
                    onChange={(e) => {
                      const newLabel = e.target.value;
                      setCourses((prev) => {
                        const next = prev.map((c) => {
                          if (c.name !== selectedCourse) return c;
                          const updatedTasks = c.tasks.map((t) =>
                            t.timeOffset === task.timeOffset && t.label === task.label
                              ? { ...t, label: newLabel }
                              : t
                          );
                          return { ...c, tasks: updatedTasks };
                        });
                        localStorage.setItem('front-kun-courses', JSON.stringify(next));
                        return next;
                      });
                      setEditingTask({ offset: task.timeOffset, label: newLabel });
                    }}
                    className="border px-2 py-1 rounded flex-1 text-sm"
                  />

                  <button
                    onClick={() => deleteTaskFromCourse(task.timeOffset, task.label)}
                    className="px-2 py-1 bg-red-500 text-white rounded text-xs order-1 sm:order-2"
                  >
                    削除
                  </button>
                </div>
              ))}

              <div className="pt-2 space-y-2">
                <div className="flex flex-wrap items-center space-x-2">
                  <input
                    type="text"
                    placeholder="タスク名"
                    value={newTaskLabel}
                    onChange={(e) => setNewTaskLabel(e.target.value)}
                    className="border px-2 py-1 flex-1 rounded text-sm"
                  />
                  <button
                    onClick={() => setNewTaskOffset((prev) => Math.max(0, prev - 5))}
                    className="w-8 h-8 bg-gray-300 rounded text-sm"
                  >
                    -5
                  </button>
                  <span className="w-12 text-center">{newTaskOffset}分後</span>
                  <button
                    onClick={() => setNewTaskOffset((prev) => Math.min(180, prev + 5))}
                    className="w-8 h-8 bg-gray-300 rounded text-sm"
                  >
                    +5
                  </button>
                  <button
                    onClick={() => {
                      if (!newTaskLabel.trim()) return;
                      addTaskToCourse(newTaskLabel.trim(), newTaskOffset);
                      setNewTaskLabel('');
                      setNewTaskOffset(0);
                    }}
                    className="px-3 py-1 bg-blue-500 text-white rounded text-sm"
                  >
                    ＋タスク追加
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ポジション設定ボタンと内容 */}
          <button
            onClick={() => setPosSettingsOpen(prev => !prev)}
            className="w-full text-left p-2 font-semibold bg-gray-100 rounded text-sm"
          >
            {posSettingsOpen ? '▼▼ ポジション設定' : '▶▶ ポジション設定'}
          </button>
          {posSettingsOpen && (
            <div className="space-y-4 mt-8">
              {/* 新規ポジション追加 */}
              <div className="flex items-center space-x-2 mb-4">
                <input
                  type="text"
                  placeholder="新しいポジション名"
                  value={newPositionName}
                  onChange={(e) => setNewPositionName(e.target.value)}
                  className="border px-2 py-1 rounded text-sm flex-1"
                />
                <button onClick={addPosition} className="px-3 py-1 bg-green-500 text-white rounded text-sm">
                  ＋追加
                </button>
              </div>
              {/* 各ポジションカード */}
              {positions.map((pos) => (
                <div key={pos} className="border rounded p-3 bg-white shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    {/* Improved up/down/toggle block */}
                    <div className="flex items-center space-x-2">
                      {/* Up/Down move buttons */}
                      <div className="flex items-center space-x-1">
                        {positions.indexOf(pos) > 0 && (
                          <button
                            onClick={() => movePositionUp(pos)}
                            aria-label={`Move ${pos} up`}
                            className="p-1 bg-gray-200 hover:bg-gray-300 rounded focus:outline-none"
                          >
                            ↑
                          </button>
                        )}
                        {positions.indexOf(pos) < positions.length - 1 && (
                          <button
                            onClick={() => movePositionDown(pos)}
                            aria-label={`Move ${pos} down`}
                            className="p-1 bg-gray-200 hover:bg-gray-300 rounded focus:outline-none"
                          >
                            ↓
                          </button>
                        )}
                      </div>
                      {/* Expand/Collapse with position name */}
                      <button
                        onClick={() => togglePositionOpen(pos)}
                        aria-label={`${openPositions[pos] ? 'Collapse' : 'Expand'} ${pos}`}
                        className="flex items-center font-medium text-sm space-x-1 focus:outline-none"
                      >
                        <span>{openPositions[pos] ? '▼' : '▶'}</span>
                        <span>{pos}</span>
                      </button>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => renamePosition(pos)}
                        aria-label={`Rename ${pos}`}
                        className="text-blue-500 text-sm"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => removePosition(pos)}
                        aria-label={`Remove ${pos}`}
                        className="text-red-500 text-sm"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  {openPositions[pos] && (
                    <>
                      {/* コース選択（ポジションごと） */}
                      <div className="flex items-center space-x-2 mb-2">
                        <label className="whitespace-nowrap">コース：</label>
                        <select
                          value={courseByPosition[pos]}
                          onChange={(e) => setCourseForPosition(pos, e.target.value)}
                          className="border px-2 py-1 rounded text-sm"
                        >
                          {courses.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        {courses
                          .find((c) => c.name === courseByPosition[pos])!
                          .tasks.slice()
                          .sort((a, b) => a.timeOffset - b.timeOffset)
                          .map((task) => (
                            <div
                              key={`${task.timeOffset}_${task.label}`}
                              className="flex items-center space-x-2 border-b pb-1 text-sm"
                            >
                              <span className="w-20">{task.timeOffset}分後</span>
                              <span className="flex-1">{task.label}</span>
                              <label className="flex items-center space-x-1">
                                <input
                                  type="checkbox"
                                  checked={tasksByPosition[pos]?.[courseByPosition[pos]]?.includes(task.label) || false}
                                  onChange={() => toggleTaskForPosition(pos, courseByPosition[pos], task.label)}
                                  className="mr-1"
                                />
                                <span>表示</span>
                              </label>
                            </div>
                          ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* 卓設定ボタンと内容（そのまま） */}
          <button
            onClick={() => {
              if (!tableSettingsOpen && !confirm('卓設定を開きますか？')) return;
              setTableSettingsOpen((prev) => !prev);
            }}
            className="w-full text-left p-2 font-semibold bg-gray-100 rounded text-sm"
          >
            {tableSettingsOpen ? '▼▼ 卓設定' : '▶▶ 卓設定'}
          </button>
          {tableSettingsOpen && (
            <div className="p-4 space-y-3 text-sm border rounded">
              <div className="space-y-2">
                <p className="text-gray-500 text-xs">
                  電卓型パッドで卓番号を入力し、Enter で追加します。追加された卓は番号順に並びます。
                </p>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={numPadState && numPadState.field === 'presetTable' ? numPadState.value : newTableTemp}
                    readOnly
                    onClick={() =>
                      setNumPadState({ id: -1, field: 'presetTable', value: newTableTemp })
                    }
                    placeholder="卓番号を入力"
                    maxLength={3}
                    className="border px-2 py-1 w-full rounded text-sm text-center cursor-pointer"
                  />
                </div>
                <div className="grid grid-cols-3 gap-0 p-1">
                  {numPadState && numPadState.field === 'presetTable'
                    ? ['1','2','3','4','5','6','7','8','9','0','←','C'].map((digit) => (
                        <button
                          key={digit}
                          onClick={() => onNumPadPress(digit)}
                          className="bg-gray-200 rounded text-xl font-mono py-2"
                        >
                          {digit}
                        </button>
                      ))
                    : null}
                  {numPadState && numPadState.field === 'presetTable' && (
                    <button
                      onClick={onNumPadConfirm}
                      className="col-span-3 bg-blue-500 rounded text-white text-lg py-2"
                    >
                      追加
                    </button>
                  )}
                  {numPadState && numPadState.field === 'presetTable' && (
                    <button
                      onClick={onNumPadCancel}
                      className="col-span-3 text-center text-sm text-gray-500 py-2"
                    >
                      キャンセル
                    </button>
                  )}
                </div>
              </div>

              {presetTables.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium mb-1">設定済み卓リスト：</p>
                    <button
                      onClick={() => setTableEditMode((prev) => !prev)}
                      className="px-2 py-0.5 bg-yellow-500 text-white rounded text-xs"
                    >
                      {tableEditMode ? '完了' : '編集'}
                    </button>
                  </div>
                  <div className="grid gap-1 p-0 grid-cols-[repeat(auto-fit,minmax(3rem,1fr))]">
                    {presetTables.map((tbl) =>
                      tableEditMode ? (
                        <div key={tbl} className="flex items-center space-x-1">
                          <span className="border px-1 py-0.5 rounded text-xs">{tbl}</span>
                          <button
                            onClick={() => {
                              setPresetTables((prev) => {
                                const nextTables = prev.filter((t) => t !== tbl);
                                localStorage.setItem('front-kun-presetTables', JSON.stringify(nextTables));
                                return nextTables;
                              });
                              setCheckedTables((prev) => {
                                const nextChecked = prev.filter((t) => t !== tbl);
                                localStorage.setItem('front-kun-checkedTables', JSON.stringify(nextChecked));
                                return nextChecked;
                              });
                            }}
                            className="text-red-500 text-sm"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <div key={tbl} className="flex items-center space-x-1">
                          <span className="border px-1 py-0.5 rounded text-xs">{tbl}</span>
                        </div>
                      )
                    )}
                  </div>
                  {/* <p className="text-gray-500 text-xs">
                    チェックした卓のみを予約リスト・タスク表示に反映します。未チェックなら全卓表示。
                  </p> */}
                </div>
              )}

              {presetTables.length > 0 && (
                <button
                  onClick={() => {
                    if (!confirm('すべての卓設定をリセットしますか？')) return;
                    setPresetTables([]);
                    setCheckedTables([]);
                    localStorage.removeItem('front-kun-presetTables');
                    localStorage.removeItem('front-kun-checkedTables');
                  }}
                  className="mt-4 px-3 py-1 bg-red-500 text-white rounded text-sm"
                >
                  すべてリセット
                </button>
              )}
            </div>
          )}

         {/* ─── テーブル設定トグル ─── */}
        
        
        </section>
      )}

      {/* ─────────────── 営業前設定セクション ─────────────── */}
      {selectedMenu === '営業前設定' && (
        <section>
          <button
            onClick={() => setDisplayTablesOpen1(prev => !prev)}
            className="w-full text-left p-2 font-semibold bg-gray-100 rounded text-sm"
          >
            {displayTablesOpen1 ? '▼▼ 表示する卓' : '▶▶ 表示する卓'}
          </button>
          {displayTablesOpen1 && (
            <div className="p-4 space-y-3 text-sm border rounded">
              <div className="grid gap-1 p-0 grid-cols-[repeat(auto-fit,minmax(3rem,1fr))]">
                {presetTables.map((tbl) => (
                  <div key={tbl} className="flex flex-col items-center">
                    <span className="border px-1 py-0.5 rounded text-xs">{tbl}</span>
                    <label className="mt-1 flex items-center space-x-1">
                      <input
                        type="checkbox"
                        checked={checkedTables.includes(tbl)}
                        onChange={() => {
                          setCheckedTables((prev) => {
                            const next = prev.includes(tbl)
                              ? prev.filter((t) => t !== tbl)
                              : [...prev, tbl];
                            localStorage.setItem('front-kun-checkedTables', JSON.stringify(next));
                            return next;
                          });
                        }}
                        className="mr-1"
                      />
                      <span className="text-xs">表示</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button
            onClick={() => setDisplayTablesOpen2(prev => !prev)}
            className="w-full text-left p-2 font-semibold bg-gray-100 rounded text-sm mt-2"
          >
            {displayTablesOpen2 ? '▼▼ 表示するタスク' : '▶▶ 表示するタスク'}
          </button>
          {displayTablesOpen2 && (
            <div className="p-4 space-y-4 text-sm border rounded">
              {/* ポジション選択 */}
              <div className="flex items-center space-x-2 mb-4">
                <label className="whitespace-nowrap">ポジション選択：</label>
                <select
                  value={selectedDisplayPosition}
                  onChange={(e) => setSelectedDisplayPosition(e.target.value)}
                  className="border px-2 py-1 rounded text-sm"
                >
                  {positions.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                  <option key="その他" value="その他">
                    その他
                  </option>
                </select>
              </div>

              {/* タスク一覧 */}
              {selectedDisplayPosition !== 'その他' ? (
                <div className="space-y-4">
                  {/* コース切り替えボタン行 */}
                  <div className="flex flex-wrap gap-2 mb-2">
                    {courses.map((c) => (
                      <button
                        key={c.name}
                        onClick={() => setDisplayTaskCourse(c.name)}
                        className={`px-3 py-1 rounded text-sm ${
                          displayTaskCourse === c.name ? 'bg-blue-500 text-white' : 'bg-gray-200'
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                  {/* 選択中コースのタスク一覧 */}
                  {(() => {
                    const course = courses.find((c) => c.name === displayTaskCourse) || courses[0];
                    return (
                      <div className="border rounded p-2">
                        <div className="font-semibold mb-1">{course.name}</div>
                        {course.tasks
                          .slice()
                          .sort((a, b) => a.timeOffset - b.timeOffset)
                          .map((task) => (
                            <div
                              key={`${task.timeOffset}_${task.label}_${course.name}`}
                              className="flex items-center space-x-2 border-b pb-1 text-sm"
                            >
                              <span className="w-20">{task.timeOffset}分後</span>
                              <span className="flex-1">{task.label}</span>
                              <label className="flex items-center space-x-1">
                                <input
                                  type="checkbox"
                                  checked={tasksByPosition[selectedDisplayPosition]?.[displayTaskCourse]?.includes(task.label) || false}
                                  onChange={() => toggleTaskForPosition(selectedDisplayPosition, displayTaskCourse, task.label)}
                                  className="mr-1"
                                />
                                <span>表示</span>
                              </label>
                            </div>
                          ))}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="space-y-1">
                  {courses
                    .find((c) => c.name === selectedCourse)!
                    .tasks.slice()
                    .sort((a, b) => a.timeOffset - b.timeOffset)
                    .map((task) => (
                      <div
                        key={`${task.timeOffset}_${task.label}`}
                        className="flex items-center space-x-2 border-b pb-1 text-sm"
                      >
                        <span className="w-20">{task.timeOffset}分後</span>
                        <span className="flex-1">{task.label}</span>
                        <label className="flex items-center space-x-1">
                          <input
                            type="checkbox"
                            checked={checkedTasks.includes(task.label)}
                            onChange={() => handleTaskCheck(task.label)}
                            className="mr-1"
                          />
                          <span>表示</span>
                        </label>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}


      {/* ─────────────── 2. 来店入力セクション ─────────────── */}
      {/* ─────────────── 営業前設定セクション ─────────────── */}
      {selectedMenu === '営業前設定' && (
        <section>
          {/* 営業前設定の内容は後で実装 */}
        </section>
      )}

      {/* ─────────────── リマインドセクション ─────────────── */}
      {selectedMenu === 'リマインド' && (
        <>
          {/* 通知有効トグル */}
          <div className="flex items-center space-x-2">
            <label className="flex items-center space-x-1">
              <input
                type="checkbox"
                checked={remindersEnabled}
                onChange={() => setRemindersEnabled((prev) => !prev)}
                className="mr-1"
              />
              <span>リマインド通知を有効にする</span>
            </label>
            <span className="ml-auto text-sm text-gray-600">現在時刻：{currentTime}</span>
          </div>

          <section className="mt-20 flex flex-wrap items-start space-x-4 space-y-2 text-sm">
            {/* コントロールバー (検索・表示切替) */}
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

            <div className="flex flex-col md:flex-col md:space-y-2 space-x-4 md:space-x-0">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={showCourseAll}
                  onChange={(e) => setShowCourseAll(e.target.checked)}
                  className="mr-1"
                />
                <span>コース表示</span>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={showGuestsAll}
                  onChange={(e) => setShowGuestsAll(e.target.checked)}
                  className="mr-1"
                />
                <span>人数表示</span>
              </div>

              {showCourseAll && (
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={mergeSameTasks}
                    onChange={(e) => setMergeSameTasks(e.target.checked)}
                    className="mr-1"
                  />
                  <span>タスクまとめ表示</span>
                </div>
              )}
            </div>

            {/* タスク並び替えコントロール */}
            <div className="flex items-center space-x-2">
              <label className="mr-1">タスク並び替え：</label>
              <label>
                <input
                  type="radio"
                  name="taskSort"
                  value="table"
                  checked={taskSort === 'table'}
                  onChange={() => setTaskSort('table')}
                  className="mr-1"
                />
                卓番順
              </label>
              <label className="ml-2">
                <input
                  type="radio"
                  name="taskSort"
                  value="guests"
                  checked={taskSort === 'guests'}
                  onChange={() => setTaskSort('guests')}
                  className="mr-1"
                />
                人数順
              </label>
            </div>
          </section>

          <section className="space-y-4 text-sm">
            {/* タスク表示セクション */}
            {/* ...同じロジックを流用... */}
            {hydrated && futureTimeKeys.map((timeKey, idx) => (
              <div key={timeKey} className={`border-b pb-2 ${idx > 0 ? 'opacity-40' : ''}`}>
                <div className="font-bold text-base mb-1">{timeKey}</div>
                {mergeSameTasks ? (
                  // タスクまとめ表示 ON のとき：同じタスク名をまとめる
                  (() => {
                    type Collected = {
                      label: string;
                      bgColor: string;
                      allReservations: Reservation[];
                    };
                    const collectMap: Record<string, Collected> = {};
                    groupedTasks[timeKey].forEach((tg) => {
                      const allRes = tg.courseGroups.flatMap((cg) => cg.reservations);
                      if (!collectMap[tg.label]) {
                        collectMap[tg.label] = {
                          label: tg.label,
                          bgColor: tg.bgColor,
                          allReservations: allRes,
                        };
                      } else {
                        collectMap[tg.label].allReservations.push(...allRes);
                      }
                    });
                    const collectArr = Object.values(collectMap).sort((a, b) =>
                      a.label.localeCompare(b.label)
                    );
                    return collectArr.map((ct) => {
                      const allRes = ct.allReservations;
                      const selKey = `${timeKey}_${ct.label}`;
                      const sortedArr = taskSort === 'guests'
                        ? allRes.slice().sort((a, b) => a.guests - b.guests)
                        : allRes.slice().sort((a, b) => Number(a.table) - Number(b.table));
                      return (
                        <div key={ct.label} className={`p-2 rounded mb-2 ${ct.bgColor}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold">{ct.label}</span>
                            <div className="flex items-center">
                              <button
                                onClick={() => {
                                  // 完了: 予約リスト×タスク表と同じロジック
                                  // まとめ表示のため、allRes から courseGroups 的に分けて処理
                                  // ここでは、各 course で group
                                  const courseMap: Record<string, Reservation[]> = {};
                                  allRes.forEach((res) => {
                                    if (!courseMap[res.course]) courseMap[res.course] = [];
                                    courseMap[res.course].push(res);
                                  });
                                  Object.entries(courseMap).forEach(([courseName, reservations]) => {
                                    const compKey = `${timeKey}_${ct.label}_${courseName}`;
                                    reservations.forEach((res) => {
                                      updateReservationField(
                                        res.id,
                                        'completed',
                                        (() => {
                                          const prev = res.completed || {};
                                          return { ...prev, [compKey]: !prev[compKey] };
                                        })()
                                      );
                                    });
                                  });
                                }}
                                className="px-2 py-0.5 bg-yellow-500 text-white rounded text-xs"
                              >
                                完了
                              </button>
                              <button
                                onClick={() => {
                                  const key = `${timeKey}_${ct.label}`;
                                  if (selectionModeTask === key) {
                                    // exit selection mode
                                    setSelectionModeTask(null);
                                    setSelectedForComplete([]);
                                  } else {
                                    // enter selection mode for this task
                                    setSelectionModeTask(key);
                                    setSelectedForComplete([]);
                                  }
                                }}
                                className="ml-2 px-2 py-0.5 bg-yellow-500 text-white rounded text-sm"
                              >
                                {selectionModeTask === `${timeKey}_${ct.label}` ? 'キャンセル' : '選択完了'}
                              </button>
                              {selectionModeTask === `${timeKey}_${ct.label}` && (
                                <button
                                  onClick={() => {
                                    // mark selected reservations complete for this task (toggle)
                                    selectedForComplete.forEach((resId) => {
                                      const key = `${timeKey}_${ct.label}_${filteredReservations.find(r => r.id === resId)?.course}`;
                                      updateReservationField(
                                        resId,
                                        'completed',
                                        (() => {
                                          const prevCompleted = filteredReservations.find(r => r.id === resId)?.completed || {};
                                          const wasDone = Boolean(prevCompleted[key]);
                                          return {
                                            ...prevCompleted,
                                            [key]: !wasDone
                                          };
                                        })()
                                      );
                                    });
                                    setSelectionModeTask(null);
                                    setSelectedForComplete([]);
                                  }}
                                  className="ml-2 px-2 py-0.5 bg-green-700 text-white rounded text-sm"
                                >
                                  完了登録
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {sortedArr.map((r) => (
                              <span
                                key={r.id}
                                className={`border px-2 py-1 rounded text-xs cursor-pointer ${
                                  selectionModeTask === selKey && selectedForComplete.includes(r.id)
                                    ? 'bg-green-200'
                                    : ''
                                }`}
                                onClick={() => {
                                  if (selectionModeTask === selKey) {
                                    setSelectedForComplete((prev) =>
                                      prev.includes(r.id)
                                        ? prev.filter((x) => x !== r.id)
                                        : [...prev, r.id]
                                    );
                                  }
                                }}
                              >
                                {r.table}
                                {showGuestsAll && <>({r.guests})</>}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    });
                  })()
                ) : (
                  // non-mergeSameTasks branch with selection UI
                  groupedTasks[timeKey].map((tg) => {
                    const selKey = `${timeKey}_${tg.label}`;
                    return (
                      <div key={tg.label} className={`p-2 rounded mb-2 ${tg.bgColor}`}>
                        {/* ── タスク行ヘッダ ──────────────────── */}
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold">{tg.label}</span>

                          {/* 右側の操作ボタン（既存のまま） */}
                          <div className="flex items-center">
                            <button
                              onClick={() => {
                                if (selectionModeTask === selKey) {
                                  setSelectionModeTask(null);
                                  setSelectedForComplete([]);
                                } else {
                                  setSelectionModeTask(selKey);
                                  setSelectedForComplete([]);
                                }
                              }}
                              className="ml-2 px-2 py-0.5 bg-yellow-500 text-white rounded text-sm"
                            >
                              {selectionModeTask === selKey ? 'キャンセル' : '選択完了'}
                            </button>
                            {selectionModeTask === selKey && (
                              <button
                                onClick={() => {
                                  selectedForComplete.forEach((resId) => {
                                    const courseName =
                                      filteredReservations.find((r) => r.id === resId)?.course;
                                    const compKey = `${timeKey}_${tg.label}_${courseName}`;
                                    updateReservationField(resId, 'completed', (() => {
                                      const prev =
                                        filteredReservations.find((r) => r.id === resId)?.completed ||
                                        {};
                                      return { ...prev, [compKey]: !prev[compKey] };
                                    })());
                                  });
                                  setSelectionModeTask(null);
                                  setSelectedForComplete([]);
                                }}
                                className="ml-2 px-2 py-0.5 bg-green-700 text-white rounded text-sm"
                              >
                                完了登録
                              </button>
                            )}
                          </div>
                        </div>

                        {/* ── 予約リスト部分 ─────────────────── */}
                        {/** If コース表示 OFF → 1つにまとめて表示 / ON → コースごとに表示 */}
                        {showCourseAll ? (
                          /* --- Course Display ON : 既存のコースごと表示 --- */
                          <div>
                            {tg.courseGroups.map((cg) => {
                              const sortedRes =
                                taskSort === 'guests'
                                  ? cg.reservations
                                      .slice()
                                      .sort((a, b) => a.guests - b.guests)
                                  : cg.reservations
                                      .slice()
                                      .sort((a, b) => Number(a.table) - Number(b.table));

                              return (
                                <div key={cg.courseName} className="mb-1">
                                  {/* コースラベルは ON のときだけ表示 */}
                                  <div className="text-xs mb-1">({cg.courseName})</div>
                                  <div className="flex flex-wrap gap-2">
                                    {sortedRes.map((r) => {
                                      const previewDone =
                                        selectionModeTask === selKey &&
                                        selectedForComplete.includes(r.id)
                                          ? !Boolean(
                                              r.completed[
                                                `${timeKey}_${tg.label}_${cg.courseName}`
                                              ]
                                            )
                                          : Boolean(
                                              r.completed[
                                                `${timeKey}_${tg.label}_${cg.courseName}`
                                              ]
                                            );

                                      return (
                                        <span
                                          key={r.id}
                                          className={`border px-2 py-1 rounded text-xs cursor-pointer ${
                                            previewDone
                                              ? 'opacity-50 line-through bg-gray-300'
                                              : ''
                                          } ${
                                            selectionModeTask === selKey &&
                                            selectedForComplete.includes(r.id)
                                              ? 'ring-2 ring-yellow-400'
                                              : ''
                                          } ${
                                            firstRotatingId[r.table] === r.id
                                              ? 'text-red-500'
                                              : ''
                                          }`}
                                          onClick={() => {
                                            if (selectionModeTask === selKey) {
                                              setSelectedForComplete((prev) =>
                                                prev.includes(r.id)
                                                  ? prev.filter((x) => x !== r.id)
                                                  : [...prev, r.id]
                                              );
                                            }
                                          }}
                                        >
                                          {showTableStart && r.table}
{showGuestsAll && `(${r.guests})`}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          /* --- Course Display OFF : すべての予約をまとめて表示 --- */
                          (() => {
                            const combined = tg.courseGroups.flatMap(
                              (cg) => cg.reservations
                            );
                            const sortedRes =
                              taskSort === 'guests'
                                ? combined.slice().sort((a, b) => a.guests - b.guests)
                                : combined
                                    .slice()
                                    .sort((a, b) => Number(a.table) - Number(b.table));

                            return (
                              <div className="flex flex-wrap gap-2">
                                {sortedRes.map((r) => {
                                  /* completion keyは courseName を含まない共通キー */
                                  const compKey = `${timeKey}_${tg.label}`;
                                  const previewDone =
                                    selectionModeTask === selKey &&
                                    selectedForComplete.includes(r.id)
                                      ? !Boolean(r.completed[compKey])
                                      : Boolean(r.completed[compKey]);

                                  return (
                                    <span
                                      key={r.id}
                                      className={`border px-2 py-1 rounded text-xs cursor-pointer ${
                                        previewDone
                                          ? 'opacity-50 line-through bg-gray-300'
                                          : ''
                                      } ${
                                        selectionModeTask === selKey &&
                                        selectedForComplete.includes(r.id)
                                          ? 'ring-2 ring-yellow-400'
                                          : ''
                                      } ${
                                        firstRotatingId[r.table] === r.id
                                          ? 'text-red-500'
                                          : ''
                                      }`}
                                      onClick={() => {
                                        if (selectionModeTask === selKey) {
                                          setSelectedForComplete((prev) =>
                                            prev.includes(r.id)
                                              ? prev.filter((x) => x !== r.id)
                                              : [...prev, r.id]
                                          );
                                        }
                                      }}
                                    >
                                      {showTableStart && r.table}
{showGuestsAll && `(${r.guests})`}
                                    </span>
                                  );
                                })}
                              </div>
                            );
                          })()
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ))}
          </section>
        </>
      )}

      {/* ─────────────── 予約リスト×タスク表セクション ─────────────── */}
      {selectedMenu === '予約リスト×タスク表' && (
        <>
          <section>
            {/* 来店入力セクション */}
            <button
              onClick={() => setResInputOpen(prev => !prev)}
              className="w-full text-left p-2 font-semibold bg-gray-100 rounded text-sm"
            >
              {resInputOpen ? '▼▼ 予約リスト' : '▶▶ 予約リスト'}
            </button>
            {resInputOpen && (
              <div className="sm:p-4 p-2 space-y-4 text-sm border rounded overflow-x-auto">
                {/* ...existing 来店入力 JSX unchanged... */}
                <div className="flex flex-wrap items-center space-x-4">
                  <div>
                    <label className="mr-2">表示順：</label>
                    <label>
                      <input
                        type="radio"
                        name="resOrder"
                        checked={resOrder === 'table'}
                        onChange={() => {
                          setResOrder('table');
                          localStorage.setItem('front-kun-resOrder', 'table');
                        }}
                        className="mr-1"
                      />
                      卓番順
                    </label>
                    <label className="ml-2">
                      <input
                        type="radio"
                        name="resOrder"
                        checked={resOrder === 'time'}
                        onChange={() => {
                          setResOrder('time');
                          localStorage.setItem('front-kun-resOrder', 'time');
                        }}
                        className="mr-1"
                      />
                      時間順
                    </label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => {
                        if (!confirm('来店リストをすべてリセットしますか？')) return;
                        reservations.forEach((r) => {
                          deleteReservation(r.id);
                        });
                      }}
                      className="px-3 py-1 bg-red-500 text-white rounded text-sm"
                    >
                      全リセット
                    </button>
                  </div>
                </div>

                <div className="hidden sm:flex items-center space-x-4">
                  <label className="flex items-center space-x-1">
                    <input
                      type="checkbox"
                      checked={showNameCol}
                      onChange={() => setShowNameCol((p) => !p)}
                      className="mr-1"
                    />
                    <span>氏名表示</span>
                  </label>
                  <label className="flex items-center space-x-1">
                    <input
                      type="checkbox"
                      checked={showNotesCol}
                      onChange={() => setShowNotesCol((p) => !p)}
                      className="mr-1"
                    />
                    <span>備考表示</span>
                  </label>
                </div>

                <table className="min-w-full table-auto border text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="border px-1 py-1 w-24">来店時刻</th>
                      <th className="border px-1 py-1 w-20">卓番</th>
                      {showNameCol && <th className="border px-1 py-1 w-24 hidden sm:table-cell">氏名</th>}
                      <th className="border px-1 py-1 w-24">コース</th>
                      <th className="border px-1 py-1 w-20">人数</th>
                      {showNotesCol && <th className="border px-1 py-1 w-24 hidden sm:table-cell">備考</th>}
                      <th className="border px-1 py-1 w-12 hidden sm:table-cell">来店</th>
                      <th className="border px-1 py-1 w-12 hidden sm:table-cell">退店</th>
                      <th className="border px-1 py-1 w-12">削除</th>
                    </tr>
                  </thead>
                  <tbody>
                   {filteredReservations.map((r, idx) => {

                     const prev = filteredReservations[idx - 1];
                     const borderClass = !prev || prev.time !== r.time
                       ? 'border-t-2 border-gray-300' // 時刻が変わる行 → 太線
                       : 'border-b border-gray-300';  // 同時刻の行 → 細線

                     return (
                      <tr
                        key={r.id}
                        className={`${borderClass} text-center ${checkedArrivals.includes(r.id) ? 'bg-green-100' : ''} ${checkedDepartures.includes(r.id) ? 'bg-red-100' : ''} ${firstRotatingId[r.table] === r.id ? 'text-red-500' : ''}`}
                      >
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
                        {/* 卓番セル */}
                        <td className="border px-1 py-1">
                        <input
                          type="text"
                          value={r.table}
                          readOnly
                          onClick={() =>
                            setNumPadState({ id: r.id, field: 'table', value: r.table })
                          }
                          className={`border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer ${
                            rotatingTables.has(r.table) && firstRotatingId[r.table] === r.id ? 'text-red-500' : ''
                          }`}
                        />
                        </td>
                        {/* 氏名セル (タブレット表示) */}
                        {showNameCol && (
                          <td className="border px-1 py-1 hidden sm:table-cell">
                            <input
                              type="text"
                              value={r.name}
                              onChange={(e) => {
                                const newValue = e.target.value;
                                setReservations((prev) =>
                                  prev.map((x) => (x.id === r.id ? { ...x, name: newValue } : x))
                                );
                                updateReservationField(r.id, 'name', newValue);
                              }}
                              placeholder="氏名"
                              className="border px-1 py-0.5 w-full rounded text-sm text-center"
                            />
                          </td>
                        )}
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
                          className="border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer"
                        />
                        </td>
                        {/* 備考セル (タブレット表示) */}
                        {showNotesCol && (
                          <td className="border px-1 py-1 hidden sm:table-cell">
                            <input
                              type="text"
                              value={r.notes}
                              onChange={(e) => {
                                const newValue = e.target.value;
                                setReservations((prev) =>
                                  prev.map((x) => (x.id === r.id ? { ...x, notes: newValue } : x))
                                );
                                updateReservationField(r.id, 'notes', newValue);
                              }}
                              placeholder="備考"
                              className="border px-1 py-0.5 w-full rounded text-sm text-center"
                            />
                          </td>
                        )}
                        {/* 来店チェックセル (タブレット表示) */}
                        <td className="border px-1 py-1 hidden sm:table-cell">
                          <button
                            onClick={() => toggleArrivalChecked(r.id)}
                            className={`px-2 py-0.5 rounded text-sm ${checkedArrivals.includes(r.id) ? 'bg-green-500 text-white' : 'bg-gray-200 text-black'}`}
                          >
                            来店
                          </button>
                        </td>
                        {/* 退店チェックセル (タブレット表示) */}
                        <td className="border px-1 py-1 hidden sm:table-cell">
                          <button
                            onClick={() => toggleDepartureChecked(r.id)}
                            className={`px-2 py-0.5 rounded text-sm ${
                              checkedDepartures.includes(r.id) ? 'bg-gray-500 text-white' : 'bg-gray-200 text-black'
                            }`}
                          >
                            退店
                          </button>
                        </td>
                        {/* 削除セル */}
                        <td className="border px-1 py-1">
                          <button
                            onClick={() => deleteReservation(r.id)}
                            className="bg-red-500 text-white px-2 py-0.5 rounded text-sm"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                    {/* 追加入力行 */}
                    <tr className="bg-gray-50">
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
                      {/* 新規卓番セル */}
                      <td className="border px-1 py-1">
                        <input
                          type="text"
                          value={newResTable}
                          readOnly
                          onClick={() => setNumPadState({ id: -1, field: 'table', value: '' })}
                          placeholder="例:101"
                          maxLength={3}
                          className="border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer"
                          required
                        />
                      </td>
                      {/* 新規氏名セル (タブレット表示) */}
                      {showNameCol && (
                        <td className="border px-1 py-1 hidden sm:table-cell">
                          <input
                            type="text"
                            value={newResName}
                            onChange={(e) => setNewResName(e.target.value)}
                            placeholder="氏名"
                            className="border px-1 py-0.5 w-full rounded text-sm text-center"
                          />
                        </td>
                      )}
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
                        </select>
                      </td>
                      {/* 新規人数セル */}
                      {showGuestsCol && (
                        <td className="border px-1 py-1">
                          <input
                            type="text"
                            value={newResGuests}
                            readOnly
                            onClick={() => setNumPadState({ id: -1, field: 'guests', value: '' })}
                            placeholder="人数"
                            maxLength={3}
                            className="border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer"
                            required
                          />
                        </td>
                      )}
                      {/* 新規備考セル (タブレット表示) */}
                      {showNotesCol && (
                        <td className="border px-1 py-1 hidden sm:table-cell">
                          <input
                            type="text"
                            value={newResNotes}
                            onChange={(e) => setNewResNotes(e.target.value)}
                            placeholder="備考"
                            className="border px-1 py-0.5 w-full rounded text-sm text-center"
                          />
                        </td>
                      )}
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
            )}
          </section>

          <section className="mt-20 flex flex-wrap items-start space-x-4 space-y-2 text-sm">
            {/* コントロールバー (検索・表示切替) */}
            {/* ...existing コントロールバー JSX unchanged... */}
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

            <div className="flex flex-col md:flex-col md:space-y-2 space-x-4 md:space-x-0">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={showCourseAll}
                  onChange={(e) => setShowCourseAll(e.target.checked)}
                  className="mr-1"
                />
                <span>コース表示</span>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={showGuestsAll}
                  onChange={(e) => setShowGuestsAll(e.target.checked)}
                  className="mr-1"
                />
                <span>人数表示</span>
              </div>

              {showCourseAll && (
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={mergeSameTasks}
                    onChange={(e) => setMergeSameTasks(e.target.checked)}
                    className="mr-1"
                  />
                  <span>タスクまとめ表示</span>
                </div>
              )}
            </div>

            {/* タスク並び替えコントロール */}
            <div className="flex items-center space-x-2">
              <label className="mr-1">タスク並び替え：</label>
              <label>
                <input
                  type="radio"
                  name="taskSort"
                  value="table"
                  checked={taskSort === 'table'}
                  onChange={() => setTaskSort('table')}
                  className="mr-1"
                />
                卓番順
              </label>
              <label className="ml-2">
                <input
                  type="radio"
                  name="taskSort"
                  value="guests"
                  checked={taskSort === 'guests'}
                  onChange={() => setTaskSort('guests')}
                  className="mr-1"
                />
                人数順
              </label>
            </div>
          </section>

          <section className="space-y-4 text-sm">
            {/* タスク表示セクション */}
            {/* ...existing タスク表示 JSX unchanged... */}
            {hydrated && sortedTimeKeys.map((timeKey) => (
              <div key={timeKey} className="border-b pb-2">
                <div className="font-bold text-base mb-1">{timeKey}</div>
                {mergeSameTasks ? (
                  // タスクまとめ表示 ON のとき：同じタスク名をまとめる
                  (() => {
                    type Collected = {
                      label: string;
                      bgColor: string;
                      allReservations: Reservation[];
                    };
                    const collectMap: Record<string, Collected> = {};
                    groupedTasks[timeKey].forEach((tg) => {
                      const allRes = tg.courseGroups.flatMap((cg) => cg.reservations);
                      if (!collectMap[tg.label]) {
                        collectMap[tg.label] = {
                          label: tg.label,
                          bgColor: tg.bgColor,
                          allReservations: allRes,
                        };
                      } else {
                        collectMap[tg.label].allReservations.push(...allRes);
                      }
                    });
                    const collectArr = Object.values(collectMap).sort((a, b) =>
                      a.label.localeCompare(b.label)
                    );
                    return collectArr.map((ct) => {
                      const allRes = ct.allReservations;
                      const selKey = `${timeKey}_${ct.label}`;
                      const sortedArr = taskSort === 'guests'
                        ? allRes.slice().sort((a, b) => a.guests - b.guests)
                        : allRes.slice().sort((a, b) => Number(a.table) - Number(b.table));
                      return (
                        <div key={ct.label} className={`p-2 rounded mb-2 ${ct.bgColor}`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-bold">{ct.label}</span>
                              <div className="flex items-center">
                                <button
                                  onClick={() => {
                                    const key = `${timeKey}_${ct.label}`;
                                    if (selectionModeTask === key) {
                                      // exit selection mode
                                      setSelectionModeTask(null);
                                      setSelectedForComplete([]);
                                    } else {
                                      // enter selection mode for this task
                                      setSelectionModeTask(key);
                                      setSelectedForComplete([]);
                                    }
                                  }}
                                  className="ml-2 px-2 py-0.5 bg-yellow-500 text-white rounded text-sm"
                                >
                                  {selectionModeTask === `${timeKey}_${ct.label}` ? 'キャンセル' : '選択完了'}
                                </button>
                                {selectionModeTask === `${timeKey}_${ct.label}` && (
                                  <button
                                    onClick={() => {
                                      // mark selected reservations complete for this task (toggle)
                                      selectedForComplete.forEach((resId) => {
                                        const key = `${timeKey}_${ct.label}_${filteredReservations.find(r => r.id === resId)?.course}`;
                                        updateReservationField(
                                          resId,
                                          'completed',
                                          (() => {
                                            const prevCompleted = filteredReservations.find(r => r.id === resId)?.completed || {};
                                            const wasDone = Boolean(prevCompleted[key]);
                                            return {
                                              ...prevCompleted,
                                              [key]: !wasDone
                                            };
                                          })()
                                        );
                                      });
                                      setSelectionModeTask(null);
                                      setSelectedForComplete([]);
                                    }}
                                    className="ml-2 px-2 py-0.5 bg-green-700 text-white rounded text-sm"
                                  >
                                    完了登録
                                  </button>
                                )}
                              </div>
                            </div>
                          <div className="flex flex-wrap gap-2">
                            {sortedArr.map((r) => {
                              const keyForThisTask = `${timeKey}_${ct.label}`;
                              const compKeyDetail = `${timeKey}_${ct.label}_${r.course}`;
                              const currentDone = Boolean(r.completed[compKeyDetail]);
                              const previewDone =
                                selectionModeTask === keyForThisTask && selectedForComplete.includes(r.id)
                                  ? !currentDone
                                  : currentDone;
                              return (
                                <div
                                  key={r.id}
                                  onClick={() => {
                                    if (selectionModeTask === keyForThisTask) {
                                      setSelectedForComplete((prev) =>
                                        prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                                      );
                                    }
                                  }}
                                  className={`border px-2 py-1 rounded text-xs ${
                                    previewDone ? 'opacity-50 line-through bg-gray-300' : ''
                                  } ${selectionModeTask === keyForThisTask && selectedForComplete.includes(r.id) ? 'ring-2 ring-yellow-400' : ''} ${firstRotatingId[r.table] === r.id ? 'text-red-500' : ''}`}
                                >
                                  {r.table}
                                  {showTableStart && showGuestsAll && <>({r.guests})</>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    });
                  })()
                ) : (
                  // まとめ表示 OFF のとき：従来のコース単位表示
                  groupedTasks[timeKey].map((tg) => {
                    const selKey = `${timeKey}_${tg.label}`;
                    return (
                      <div key={tg.label} className={`p-2 rounded mb-2 ${tg.bgColor}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold">{tg.label}</span>
                          <div className="flex items-center">
                            <button
                              onClick={() => {
                                const key = `${timeKey}_${tg.label}`;
                                if (selectionModeTask === key) {
                                  setSelectionModeTask(null);
                                  setSelectedForComplete([]);
                                } else {
                                  setSelectionModeTask(key);
                                  setSelectedForComplete([]);
                                }
                              }}
                              className="ml-2 px-2 py-0.5 bg-yellow-500 text-white rounded text-sm"
                            >
                              {selectionModeTask === `${timeKey}_${tg.label}` ? 'キャンセル' : '選択完了'}
                            </button>
                            {selectionModeTask === `${timeKey}_${tg.label}` && (
                              <button
                                onClick={() => {
                                  selectedForComplete.forEach((resId) => {
                                    const key = `${timeKey}_${tg.label}_${filteredReservations.find(r => r.id === resId)?.course}`;
                                    updateReservationField(
                                      resId,
                                      'completed',
                                      (() => {
                                        const prevCompleted = filteredReservations.find(r => r.id === resId)?.completed || {};
                                        const wasDone = Boolean(prevCompleted[key]);
                                        return {
                                          ...prevCompleted,
                                          [key]: !wasDone
                                        };
                                      })()
                                    );
                                  });
                                  setSelectionModeTask(null);
                                  setSelectedForComplete([]);
                                }}
                                className="ml-2 px-2 py-0.5 bg-green-700 text-white rounded text-sm"
                              >
                                完了登録
                              </button>
                            )}
                          </div>
                        </div>
                        {(showCourseAll
                          ? tg.courseGroups.map((cg) => {
                              const allRes = cg.reservations;
                              const sortedArr = taskSort === 'guests'
                                ? allRes.slice().sort((a, b) => a.guests - b.guests)
                                : allRes.slice().sort((a, b) => Number(a.table) - Number(b.table));
                              return (
                                <div key={cg.courseName} className="mb-1">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="italic">（{cg.courseName}）</span>
                                    {/* 削除: per-course 全完了ボタン */}
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {sortedArr.map((r) => {
                                      const keyForThisTask = `${timeKey}_${tg.label}`;
                                      const compKeyDetail = `${timeKey}_${tg.label}_${cg.courseName}`;
                                      const currentDone = Boolean(r.completed[compKeyDetail]);
                                      const previewDone =
                                        selectionModeTask === keyForThisTask && selectedForComplete.includes(r.id)
                                          ? !currentDone
                                          : currentDone;
                                      return (
                                        <div
                                          key={r.id}
                                          onClick={() => {
                                            if (selectionModeTask === keyForThisTask) {
                                              setSelectedForComplete((prev) =>
                                                prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                                              );
                                            }
                                          }}
                                          className={`border px-2 py-1 rounded text-xs ${
                                            previewDone ? 'opacity-50 line-through bg-gray-300' : ''
                                          } ${selectionModeTask === keyForThisTask && selectedForComplete.includes(r.id) ? 'ring-2 ring-yellow-400' : ''} ${firstRotatingId[r.table] === r.id ? 'text-red-500' : ''}`}
                                        >
                                          {showTableStart && r.table}
                                          {showGuestsAll && <>({r.guests})</>}  
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })
                          : (() => {
                              const allRes = tg.courseGroups.flatMap((cg) => cg.reservations);
                              const sortedArr = taskSort === 'guests'
                                ? allRes.slice().sort((a, b) => a.guests - b.guests)
                                : allRes.slice().sort((a, b) => Number(a.table) - Number(b.table));
                              return (
                                <div key={`${tg.label}-all`} className="mb-1">
                                  <div className="flex items-center justify-between mb-1">
                                    {/* 削除: 全完了ボタン (一括) */}
                                    <button
                                      onClick={() => {
                                        const key = `${timeKey}_${tg.label}`;
                                        if (selectionModeTask === key) {
                                          setSelectionModeTask(null);
                                          setSelectedForComplete([]);
                                        } else {
                                          setSelectionModeTask(key);
                                          setSelectedForComplete([]);
                                        }
                                      }}
                                      className="ml-2 px-2 py-0.5 bg-yellow-500 text-white rounded text-xs"
                                    >
                                      {selectionModeTask === `${timeKey}_${tg.label}` ? 'キャンセル' : '選択完了'}
                                    </button>
                                    {selectionModeTask === `${timeKey}_${tg.label}` && (
                                      <button
                                        onClick={() => {
                                          selectedForComplete.forEach((resId) => {
                                            const key = `${timeKey}_${tg.label}_${filteredReservations.find(r => r.id === resId)?.course}`;
                                            updateReservationField(
                                              resId,
                                              'completed',
                                              {
                                                ...filteredReservations.find(r => r.id === resId)?.completed,
                                                [key]: true
                                              }
                                            );
                                          });
                                          setSelectionModeTask(null);
                                          setSelectedForComplete([]);
                                        }}
                                        className="ml-2 px-2 py-0.5 bg-green-700 text-white rounded text-xs"
                                      >
                                        完了登録
                                      </button>
                                    )}
                                    <div className="italic">(一括)</div>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {sortedArr.map((r) => {
                                      const keyForThisTask = `${timeKey}_${tg.label}`;
                                      const compKeyDetail = `${timeKey}_${tg.label}_${r.course}`;
                                      const currentDone = Boolean(r.completed[compKeyDetail]);
                                      const previewDone =
                                        selectionModeTask === keyForThisTask && selectedForComplete.includes(r.id)
                                          ? !currentDone
                                          : currentDone;
                                      return (
                                        <div
                                          key={r.id}
                                          onClick={() => {
                                            if (selectionModeTask === keyForThisTask) {
                                              setSelectedForComplete((prev) =>
                                                prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                                              );
                                            }
                                          }}
                                          className={`border px-2 py-1 rounded text-xs ${
                                            previewDone ? 'opacity-50 line-through bg-gray-300' : ''
                                          } ${selectionModeTask === keyForThisTask && selectedForComplete.includes(r.id) ? 'ring-2 ring-yellow-400' : ''} ${firstRotatingId[r.table] === r.id ? 'text-red-500' : ''}`}
                                        >
                                          {showTableStart && r.table}
                                          {showGuestsAll && <>({r.guests})</>}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })())}
                      </div>
                    );
                  })
                )}
                {sortedTimeKeys.length === 0 && (
                  <div className="text-center text-gray-500">
                    表示するタスクはありません。
                  </div>
                )}
              </div>
            ))}
          </section>
        </>
      )}

      {/* ─────────────── 5. 数値パッドモーダル ─────────────── */}
      {numPadState && numPadState.field !== 'presetTable' && (
        <div className="fixed inset-0 bg-black/30 flex items-end justify-center z-50">
          <div className="bg-white w-full max-w-md rounded-t-lg pb-4 shadow-lg">
            <div className="p-4 border-b">
              <p className="text-center text-lg font-semibold">
                {numPadState.field === 'table'
                  ? '卓番 を入力'
                  : numPadState.field === 'guests'
                  ? '人数 を入力'
                  : ''}
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

     {/* ─────────────── 予約リスト×コース開始時間表セクション ─────────────── */}
{/* ─────────────── 予約リスト×コース開始時間表セクション ─────────────── */}
{selectedMenu === '予約リスト×コース開始時間表' && (
  <section>
    {/* 来店入力セクション */}
    <button
      onClick={() => setResInputOpen(prev => !prev)}
      className="w-full text-left p-2 font-semibold bg-gray-100 rounded text-sm"
    >
      {resInputOpen ? '▼▼ 予約リスト' : '▶▶ 予約リスト'}
    </button>
    {resInputOpen && (
      <div className="sm:p-4 p-2 space-y-4 text-sm border rounded overflow-x-auto">
        {/* ─────────────── 予約リスト（入力＆テーブル） ─────────────── */}
        <div className="flex flex-wrap items-center space-x-4">
          <div>
            <label className="mr-2">表示順：</label>
            <label>
              <input
                type="radio"
                name="resOrder"
                checked={resOrder === 'table'}
                onChange={() => {
                  setResOrder('table');
                  localStorage.setItem('front-kun-resOrder', 'table');
                }}
                className="mr-1"
              />
              卓番順
            </label>
            <label className="ml-2">
              <input
                type="radio"
                name="resOrder"
                checked={resOrder === 'time'}
                onChange={() => {
                  setResOrder('time');
                  localStorage.setItem('front-kun-resOrder', 'time');
                }}
                className="mr-1"
              />
              時間順
            </label>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                if (!confirm('来店リストをすべてリセットしますか？')) return;
                reservations.forEach((r) => deleteReservation(r.id));
              }}
              className="px-3 py-1 bg-red-500 text-white rounded text-sm"
            >
              全リセット
            </button>
          </div>
        </div>

        <div className="hidden sm:flex items-center space-x-4">
          <label className="flex items-center space-x-1">
            <input
              type="checkbox"
              checked={showNameCol}
              onChange={() => setShowNameCol((p) => !p)}
              className="mr-1"
            />
            <span>氏名表示</span>
          </label>
          <label className="flex items-center space-x-1">
            <input
              type="checkbox"
              checked={showNotesCol}
              onChange={() => setShowNotesCol((p) => !p)}
              className="mr-1"
            />
            <span>備考表示</span>
          </label>
        </div>

        <table className="min-w-full table-auto border text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="border px-1 py-1 w-24">来店時刻</th>
              <th className="border px-1 py-1 w-20">卓番</th>
              {showNameCol && <th className="border px-1 py-1 w-24 hidden sm:table-cell">氏名</th>}
              <th className="border px-1 py-1 w-24">コース</th>
              <th className="border px-1 py-1 w-20">人数</th>
              {showNotesCol && <th className="border px-1 py-1 w-24 hidden sm:table-cell">備考</th>}
              <th className="border px-1 py-1 w-12 hidden sm:table-cell">来店</th>
              <th className="border px-1 py-1 w-12 hidden sm:table-cell">退店</th>
              <th className="border px-1 py-1 w-12">削除</th>
            </tr>
          </thead>
            <tbody>
            {filteredReservations.map((r, idx) => {
              const prev = filteredReservations[idx - 1];
              const borderClass = !prev || prev.time !== r.time
                ? 'border-t-2 border-gray-300'   // 時刻が変わる行 → 太線
                : 'border-b border-gray-300';    // 同時刻の行 → 細線
              return (
              <tr
                key={r.id}
                className={`${borderClass} text-center ${
                  checkedArrivals.includes(r.id) ? 'bg-green-100' : ''
                } ${
                  checkedDepartures.includes(r.id) ? 'bg-red-100' : ''
                } ${
                  firstRotatingId[r.table] === r.id ? 'text-red-500' : ''
                }`}
              >
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
                {/* 卓番セル */}
                <td className="border px-1 py-1">
                  <input
                    type="text"
                    value={r.table}
                    readOnly
                    onClick={() => setNumPadState({ id: r.id, field: 'table', value: r.table })}
                    className={`
                      border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer
                      ${rotatingTables.has(r.table) && firstRotatingId[r.table] === r.id ? 'text-red-500' : ''}
                    `}
                  />
                </td>
                {/* 氏名セル */}
                {showNameCol && (
                  <td className="border px-1 py-1 hidden sm:table-cell">
                    <input
                      type="text"
                      value={r.name}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        setReservations((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, name: newValue } : x))
                        );
                        updateReservationField(r.id, 'name', newValue);
                      }}
                      placeholder="氏名"
                      className="border px-1 py-0.5 w-full rounded text-sm text-center"
                    />
                  </td>
                )}
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
                    className="border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer"
                  />
                </td>
                {/* 備考セル */}
                {showNotesCol && (
                  <td className="border px-1 py-1 hidden sm:table-cell">
                    <input
                      type="text"
                      value={r.notes}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        setReservations((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, notes: newValue } : x))
                        );
                        updateReservationField(r.id, 'notes', newValue);
                      }}
                      placeholder="備考"
                      className="border px-1 py-0.5 w-full rounded text-sm text-center"
                    />
                  </td>
                )}
                {/* 来店チェックセル */}
                <td className="border px-1 py-1 hidden sm:table-cell">
                  <button
                    onClick={() => toggleArrivalChecked(r.id)}
                    className={`
                      px-2 py-0.5 rounded text-sm
                      ${checkedArrivals.includes(r.id) ? 'bg-green-500 text-white' : 'bg-gray-200 text-black'}
                    `}
                  >
                    来店
                  </button>
                </td>
                {/* 退店チェックセル */}
                <td className="border px-1 py-1 hidden sm:table-cell">
                  <button
                    onClick={() => toggleDepartureChecked(r.id)}
                    className={`
                      px-2 py-0.5 rounded text-sm
                      ${checkedDepartures.includes(r.id) ? 'bg-gray-500 text-white' : 'bg-gray-200 text-black'}
                    `}
                  >
                    退店
                  </button>
                </td>
                {/* 削除セル */}
                <td className="border px-1 py-1">
                  <button
                    onClick={() => deleteReservation(r.id)}
                    className="bg-red-500 text-white px-2 py-0.5 rounded text-sm"
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
            })}
            {/* 新規予約行 */}
            <tr className="bg-gray-50">
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
              <td className="border px-1 py-1">
                <input
                  type="text"
                  value={newResTable}
                  readOnly
                  onClick={() => setNumPadState({ id: -1, field: 'table', value: '' })}
                  placeholder="例:101"
                  maxLength={3}
                  className="border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer"
                  required
                />
              </td>
              {showNameCol && (
                <td className="border px-1 py-1 hidden sm:table-cell">
                  <input
                    type="text"
                    value={newResName}
                    onChange={(e) => setNewResName(e.target.value)}
                    placeholder="氏名"
                    className="border px-1 py-0.5 w-full rounded text-sm text-center"
                  />
                </td>
              )}
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
                </select>
              </td>
              {showGuestsCol && (
                <td className="border px-1 py-1">
                  <input
                    type="text"
                    value={newResGuests}
                    readOnly
                    onClick={() => setNumPadState({ id: -1, field: 'guests', value: '' })}
                    placeholder="人数"
                    maxLength={3}
                    className="border px-1 py-0.5 w-8 rounded text-sm text-center cursor-pointer"
                    required
                  />
                </td>
              )}
              {showNotesCol && (
                <td className="border px-1 py-1 hidden sm:table-cell">
                  <input
                    type="text"
                    value={newResNotes}
                    onChange={(e) => setNewResNotes(e.target.value)}
                    placeholder="備考"
                    className="border px-1 py-0.5 w-full rounded text-sm text-center"
                  />
                </td>
              )}
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
    )}
{selectedMenu === '予約リスト×コース開始時間表' && (
  <section className="mt-6">
    {/* コース開始時間表 */}
    <h2 className="text-xl font-bold mb-4">コース開始時間表</h2>

    {/* 並び替えコントロール */}
    <div className="flex items-center space-x-4 mb-4">
      <span className="font-medium">並び替え：</span>
      <label className="flex items-center space-x-1">
        <input
          type="radio"
          name="courseStartSort"
          value="table"
          checked={taskSort === 'table'}
          onChange={() => setTaskSort('table')}
          className="mr-1"
        />
        卓番順
      </label>
      <label className="flex items-center space-x-1">
        <input
          type="radio"
          name="courseStartSort"
          value="guests"
          checked={taskSort === 'guests'}
          onChange={() => setTaskSort('guests')}
          className="mr-1"
        />
        人数順
      </label>
    </div>
    {/* ── 卓番表示 切り替え ── */}
<div className="flex items-center space-x-2 mb-4">
  <span className="font-semibold text-sm">卓番:</span>
  <button
    onClick={() => setShowTableStart(true)}
    className={`px-2 py-0.5 rounded text-xs ${
      showTableStart ? 'bg-blue-500 text-white' : 'bg-gray-200'
    }`}
  >
    ON
  </button>
  <button
    onClick={() => setShowTableStart(false)}
    className={`px-2 py-0.5 rounded text-xs ${
      !showTableStart ? 'bg-blue-500 text-white' : 'bg-gray-200'
    }`}
  >
    OFF
  </button>
</div>
    {/* ── フィルター切り替え ── */}
<div className="flex items-center space-x-2 mb-4">
  <span className="font-semibold text-sm">フィルター:</span>
  <button
    onClick={() => setCourseStartFiltered(true)}
    className={`px-2 py-0.5 rounded text-xs ${
      courseStartFiltered ? 'bg-blue-500 text-white' : 'bg-gray-200'
    }`}
  >
    ON
  </button>
  <button
    onClick={() => setCourseStartFiltered(false)}
    className={`px-2 py-0.5 rounded text-xs ${
      !courseStartFiltered ? 'bg-blue-500 text-white' : 'bg-gray-200'
    }`}
  >
    OFF
  </button>
</div>

    <div className="space-y-6 text-sm">
      {Object.entries(groupedStartTimes).map(([timeKey, groups], timeIdx) => (
        <div
          key={timeKey}
          className={`
            mb-4 rounded-lg p-3
            ${timeIdx % 2 === 0 ? 'bg-blue-50 border-l-4 border-blue-400' : 'bg-gray-50 border-l-4 border-gray-400'}
          `}
        >
          {/* 時間帯ヘッダー */}
          <div className="font-bold text-lg mb-2">{timeKey}</div>

          {/* 各コースごとの卓バッジ */}
          {groups.map((g) => (
            <div key={g.courseName} className="mb-2">
              <div className="font-medium mb-1">{g.courseName}</div>
              <div className="flex flex-wrap gap-2">
                {g.reservations
                  .slice()
                  .sort((a, b) =>
                    taskSort === 'guests'
                      ? a.guests - b.guests
                      : Number(a.table) - Number(b.table)
                  )
                  .map((r) => (
                    <span
                      key={r.id}
                      className={`
                        border px-2 py-1 rounded text-xs
                        ${rotatingTables.has(r.table) && firstRotatingId[r.table] === r.id ? 'text-red-500' : ''}
                      `}
                    >
                      {showTableStart && r.table}
                      {showGuestsAll && <>({r.guests})</>}
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  </section>
)}
  </section>
)}    
{/* ─────────────── テーブル管理セクション ─────────────── */}

 
 </main>
    </>
  );
}

//
// ─────────────────────────────── EOF ────────────────────────────────────────────
//