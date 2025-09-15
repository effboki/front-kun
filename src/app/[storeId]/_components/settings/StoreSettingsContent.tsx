'use client';

import React, { useMemo, useState, useCallback, useRef } from 'react';
import type { CourseDef, TaskDef } from '@/types';
import type { AreaDef } from '@/types';
import type { StoreSettingsValue } from '@/types/settings';
import MiniTasksSettings from './MiniTasksSettings';
import WaveSettings from './WaveSettings';

// ============== helpers ==============
const normalizeLabel = (s: string) =>
  String(s ?? '')
    .replace(/\u3000/g, ' ')
    .trim()
    .normalize('NFKC')
    .toLowerCase();
const normEq = (a: string, b: string) => normalizeLabel(a) === normalizeLabel(b);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const getTasks = (c?: CourseDef) => (Array.isArray(c?.tasks) ? (c!.tasks as TaskDef[]) : ([] as TaskDef[]));
const normalizeTiny = (s: string) =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/[\s\u3000]/g, '');

// Grapheme-aware slicer: correctly counts emoji + variation selectors as 1 char
const takeGraphemes = (input: string, n: number): string => {
  const s = String(input ?? '');
  // Prefer Intl.Segmenter when available (modern browsers)
  const Seg: any = (Intl as any)?.Segmenter;
  if (Seg) {
    const seg = new Seg('ja', { granularity: 'grapheme' });
    const out: string[] = [];
    for (const { segment } of seg.segment(s)) {
      out.push(segment);
      if (out.length >= n) break;
    }
    return out.join('');
  }
  // Fallback: split by code points, then glue variation selectors/ZWJ to previous
  const cps = Array.from(s);
  const clusters: string[] = [];
  for (const cp of cps) {
    if (/[\uFE0E\uFE0F\u200D]/.test(cp) && clusters.length) {
      clusters[clusters.length - 1] += cp;
    } else {
      clusters.push(cp);
    }
  }
  return clusters.slice(0, n).join('');
};

// ============== props ==============
export type StoreSettingsContentProps = {
  value: StoreSettingsValue; // 親のドラフト
  onChange: (patch: Partial<StoreSettingsValue>) => void; // 親ドラフトにパッチ
  onSave: () => void | Promise<void>; // 保存（同期/非同期どちらでもOK）
  isSaving?: boolean; // 親が渡す保存中フラグ（任意）
  baseline?: StoreSettingsValue | null; // 直近保存済みスナップショット（dirty 判定用）
};

// ============== component ==============
export default function StoreSettingsContent({ value, onChange, onSave, isSaving, baseline }: StoreSettingsContentProps) {
  // navigation (drill-in style)
  type View = 'root' | 'courses' | 'positions' | 'tables' | 'tablesTables' | 'tablesAreas' | 'eatdrink' | 'minitasks' | 'wavesettings';
  const [view, setView] = useState<View>('root');

  // derived arrays
  const courses = useMemo(() => (Array.isArray(value.courses) ? value.courses : []), [value.courses]);
  const positions = useMemo(() => (Array.isArray(value.positions) ? value.positions : []), [value.positions]);
  const presetTables = useMemo(() => (Array.isArray(value.tables) ? value.tables : []), [value.tables]);
  const eatOptions = useMemo(() => (Array.isArray(value.eatOptions) ? value.eatOptions : []), [value.eatOptions]);
  const drinkOptions = useMemo(() => (Array.isArray(value.drinkOptions) ? value.drinkOptions : []), [value.drinkOptions]);
  const tasksByPosition = useMemo(
    () =>
      value.tasksByPosition && typeof value.tasksByPosition === 'object'
        ? value.tasksByPosition
        : ({} as Record<string, Record<string, string[]>>),
    [value.tasksByPosition]
  );
  const areas = useMemo<AreaDef[]>(() => (Array.isArray((value as any)?.areas) ? ((value as any).areas as AreaDef[]) : []), [(value as any)?.areas]);

  // local UI state only
  const [selectedCourse, setSelectedCourse] = useState<string>(courses[0]?.name ?? '');
  // courses: settings popover (per course) + accordion open state
  const [courseMenuFor, setCourseMenuFor] = useState<string | null>(null);
  const courseMenuRef = useRef<HTMLDivElement | null>(null);
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  // positions: settings popover (only one open at a time)
  const [posMenuFor, setPosMenuFor] = useState<string | null>(null);
  const posMenuRef = useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (posMenuFor && posMenuRef.current && !posMenuRef.current.contains(e.target as Node)) {
        setPosMenuFor(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [posMenuFor]);
  // areas: settings popover (only one open at a time)
  const [areaMenuFor, setAreaMenuFor] = useState<string | null>(null);
  const areaMenuRef = useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (areaMenuFor && areaMenuRef.current && !areaMenuRef.current.contains(e.target as Node)) {
        setAreaMenuFor(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [areaMenuFor]);
  React.useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (courseMenuFor && courseMenuRef.current && !courseMenuRef.current.contains(e.target as Node)) {
        setCourseMenuFor(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [courseMenuFor]);
  // Helper to toggle course accordion (open/close) and sync selectedCourse
  const toggleCourseOpen = useCallback((name: string) => {
    setOpenCourse((prev) => {
      const next = prev === name ? null : name;
      if (next) setSelectedCourse(name);
      return next;
    });
  }, []);
  const [editingLabelTask, setEditingLabelTask] = useState<{ offset: number; label: string } | null>(null);
  const [editingTimeTask, setEditingTimeTask] = useState<{ offset: number; label: string } | null>(null);
  const [editingTaskDraft, setEditingTaskDraft] = useState('');
  const editingInputRef = useRef<HTMLInputElement | null>(null);
  const editingLabelComposingRef = useRef(false);
  const [newTaskDraft, setNewTaskDraft] = useState('');
  const newTaskInputRef = useRef<HTMLInputElement | null>(null);
  const [newTaskOffset, setNewTaskOffset] = useState(0);
  // 新規タスク名入力の IME 合成状態
  const [isComposingNewTask, setIsComposingNewTask] = React.useState(false);


  // track unsaved changes (for Save button "活きてる感")
  const [localDirty, setLocalDirty] = useState(false);
  const prevSavingRef = useRef<boolean>(false);
  React.useEffect(() => {
    // when saving completed, consider it saved -> clear dirty
    if (prevSavingRef.current && !isSaving) {
      setLocalDirty(false);
    }
    prevSavingRef.current = !!isSaving;
  }, [isSaving]);

  // ---- dirty 判定（baseline 優先、無い場合はローカル追跡）----
  const stable = (v: any): any => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      const out: Record<string, any> = {};
      Object.keys(v).sort().forEach((k) => { out[k] = stable((v as any)[k]); });
      return out;
    }
    return v;
  };
  const stableStringify = (v: any) => JSON.stringify(stable(v));
  const baselineDirty = React.useMemo(() => {
    if (!baseline) return null;
    try {
      return stableStringify(value) !== stableStringify(baseline);
    } catch {
      return true;
    }
  }, [value, baseline]);
  const isDirty = baselineDirty ?? localDirty;
  
  // Cmd/Ctrl+S で保存（未保存かつ保存中でない場合）
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (isDirty && !isSaving) {
          Promise.resolve(onSave?.()).catch(() => {});
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDirty, isSaving, onSave]);
  
  // 未保存の変更がある場合は離脱ガード
  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  // ===== patch helpers =====
  const setCourses = useCallback((next: CourseDef[]) => {
    setLocalDirty(true);
    onChange({ courses: next });
  }, [onChange]);
  const setPositions = useCallback((next: string[]) => {
    setLocalDirty(true);
    onChange({ positions: next });
  }, [onChange]);
  const setTables = useCallback((next: string[]) => {
    setLocalDirty(true);
    // 数字キー前提のため、常に数値昇順に並び替え & 重複除去
    const sorted = Array.from(new Set(next.map((n) => String(Number(n)))))
      .sort((a, b) => Number(a) - Number(b));
    onChange({ tables: sorted });
  }, [onChange]);
  const setTasksByPosition = useCallback(
    (next: Record<string, Record<string, string[]>>) => {
      setLocalDirty(true);
      onChange({ tasksByPosition: next });
    },
    [onChange]
  );
  const setEatOptions = useCallback((next: string[]) => {
    setLocalDirty(true);
    onChange({ eatOptions: next });
  }, [onChange]);
  const setDrinkOptions = useCallback((next: string[]) => {
    setLocalDirty(true);
    onChange({ drinkOptions: next });
  }, [onChange]);
  const setAreas = useCallback((next: AreaDef[]) => {
    setLocalDirty(true);
    onChange({ areas: next } as any);
  }, [onChange]);

  // 子ページ（ミニタスク設定／波設定）からの変更も dirty を立てて親にパッチ
  const patchRoot = useCallback((p: Partial<StoreSettingsValue>) => {
    setLocalDirty(true);
    onChange(p);
  }, [onChange]);

  // eat/drink inputs
  const [newEatOption, setNewEatOption] = useState('');
  const [newDrinkOption, setNewDrinkOption] = useState('');
  // IME 合成対策：合成中は onChange で確定させない
  const [isComposingEatOption, setIsComposingEatOption] = useState(false);
  const [isComposingDrinkOption, setIsComposingDrinkOption] = useState(false);
  const eatInputRef = useRef<HTMLInputElement | null>(null);
  const drinkInputRef = useRef<HTMLInputElement | null>(null);

  // 「食べ放題 / 飲み放題」使い方ヒントの開閉
  const [showEatDrinkHelp, setShowEatDrinkHelp] = useState(false);
  // コース設定表の説明パネルの開閉
  const [showCoursesInfo, setShowCoursesInfo] = useState(false);
  // ルートの各項目にある情報パネル（iボタン）
  const [showPositionsInfo, setShowPositionsInfo] = useState(false);
  const [showTablesInfo, setShowTablesInfo] = useState(false);
  const [showEatDrinkInfo, setShowEatDrinkInfo] = useState(false);

  // 入力値の追加（ボタン／Enter 共通）
  const addEatOption = useCallback(() => {
    const raw = (eatInputRef.current?.value ?? newEatOption) as string;
    const v = takeGraphemes(normalizeTiny(raw), 2);
    if (!v) return;
    if (eatOptions.includes(v)) return;
    setEatOptions([...eatOptions, v]);
    // 入力欄クリア（uncontrolled のため DOM を直接クリア）
    if (eatInputRef.current) eatInputRef.current.value = '';
    setNewEatOption('');
  }, [newEatOption, eatOptions, setEatOptions]);

  const addDrinkOption = useCallback(() => {
    const raw = (drinkInputRef.current?.value ?? newDrinkOption) as string;
    const v = takeGraphemes(normalizeTiny(raw), 2);
    if (!v) return;
    if (drinkOptions.includes(v)) return;
    setDrinkOptions([...drinkOptions, v]);
    if (drinkInputRef.current) drinkInputRef.current.value = '';
    setNewDrinkOption('');
  }, [newDrinkOption, drinkOptions, setDrinkOptions]);

  // 入力のバリデーション／重複チェック
  const eatCandidate = takeGraphemes(normalizeTiny(newEatOption), 2);
  const drinkCandidate = takeGraphemes(normalizeTiny(newDrinkOption), 2);
  const eatIsDup = !!eatCandidate && eatOptions.includes(eatCandidate);
  const drinkIsDup = !!drinkCandidate && drinkOptions.includes(drinkCandidate);

  // ===== courses & tasks =====

  const [openPositions, setOpenPositions] = useState<Record<string, boolean>>({});
  const [openAreas, setOpenAreas] = useState<Record<string, boolean>>({});
  // --- ポジション名の新規入力（IME 合成対応のため uncontrolled + composition guard）---
  const newPositionInputRef = useRef<HTMLInputElement | null>(null);
  const [newPositionDraft, setNewPositionDraft] = useState('');
  const [isComposingNewPosition, setIsComposingNewPosition] = useState(false);
  const [courseByPosition, setCourseByPosition] = useState<Record<string, string>>(() => {
    const first = courses[0]?.name ?? '';
    const init: Record<string, string> = {};
    for (const p of positions) init[p] = first;
    return init;
  });

  const [numPadState, setNumPadState] = useState<{ id: string; field: 'presetTable' | 'table' | 'guests'; value: string } | null>(null);
  const [newTableTemp, setNewTableTemp] = useState('');
  const [tableEditMode, setTableEditMode] = useState(false);

  // keep selectedCourse valid
  React.useEffect(() => {
    if (!courses.some((c) => c.name === selectedCourse)) setSelectedCourse(courses[0]?.name ?? '');
  }, [courses, selectedCourse]);

  // memo: currently selected course & its sorted tasks for rendering
  const selectedCourseDef = useMemo(() => {
    return courses.find((c) => c.name === selectedCourse) ?? null;
  }, [courses, selectedCourse]);

  // 親反映の遅れで「消えた」ように見えないための一時表示
  const [optimisticTasks, setOptimisticTasks] = useState<Record<string, TaskDef[]>>({});

  const courseTasksForList = useMemo(() => {
    const base = getTasks(selectedCourseDef || undefined);
    const pending = optimisticTasks[selectedCourse] ?? [];
    const merged = [...base, ...pending];
    // timeOffset + 正規化ラベルで重複排除
    const seen = new Set<string>();
    const deduped = merged.filter((t) => {
      const k = `${t.timeOffset}__${normalizeLabel(t.label)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return deduped.slice().sort((a, b) => a.timeOffset - b.timeOffset);
  }, [selectedCourseDef, optimisticTasks, selectedCourse]);
  // 親から courses が更新されたら、pending をクリア（実データに置き換わったため）
  React.useEffect(() => {
    if (Object.keys(optimisticTasks).length) {
      setOptimisticTasks({});
    }
  }, [courses]);

  // --- 新規コース名の入力（IME 合成対応のため uncontrolled + composition guard）---
  const newCourseInputRef = useRef<HTMLInputElement | null>(null);
  const [newCourseDraft, setNewCourseDraft] = useState('');
  const [isComposingNewCourse, setIsComposingNewCourse] = useState(false);


  // ===== courses & tasks =====
  const addTaskToCourse = useCallback(
    (label: string, offset: number): boolean => {
      const base = courses.map((c) => ({ ...c, tasks: getTasks(c).slice() }));
      const idx = base.findIndex((c) => c.name === selectedCourse);
      if (idx < 0) {
        console.warn('[addTaskToCourse] selectedCourse not found:', selectedCourse);
        return false;
      }
      const newTask: TaskDef = { label, timeOffset: clamp(offset, 0, 180), bgColor: 'default' } as TaskDef; // bgColor 必須対策
      base[idx].tasks.push(newTask);
      base[idx].tasks.sort((a, b) => a.timeOffset - b.timeOffset);
      setCourses(base);
      return true;
    },
    [courses, selectedCourse, setCourses]
  );

  const handleAddNew = useCallback(() => {
    const raw = newTaskDraft;
    const label = raw.trim();
    if (!label) return;
    const ok = addTaskToCourse(label, newTaskOffset);
    if (!ok) {
      // 追加できなかった場合は何も消さず残す
      return;
    }
    // 楽観的に画面へ即時反映（親の onChange 反映前に“消えた”ように見えないように）
    setOptimisticTasks((prev) => {
      const arr = prev[selectedCourse] ?? [];
      const nextTask: TaskDef = { label, timeOffset: clamp(newTaskOffset, 0, 180), bgColor: 'default' } as TaskDef;
      return { ...prev, [selectedCourse]: [...arr, nextTask] };
    });
    // uncontrolled input のため DOM もクリア
    if (newTaskInputRef.current) newTaskInputRef.current.value = '';
    setNewTaskDraft('');
    setNewTaskOffset(0);
    requestAnimationFrame(() => newTaskInputRef.current?.focus());
  }, [newTaskDraft, newTaskOffset, addTaskToCourse, selectedCourse]);

  const shiftTaskOffset = useCallback(
    (offset: number, label: string, delta: number) => {
      const base = courses.map((c) => ({ ...c, tasks: getTasks(c).slice() }));
      const idx = base.findIndex((c) => c.name === selectedCourse);
      if (idx < 0) return;
      const newOffset = clamp(offset + delta, 0, 180);
      base[idx].tasks = base[idx].tasks
        .map((t) => (t.timeOffset !== offset || !normEq(t.label, label) ? t : { ...t, timeOffset: newOffset }))
        .sort((a, b) => a.timeOffset - b.timeOffset);
      setCourses(base);
      // keep editing state pinned to the same task while its offset changes
      setEditingTimeTask((curr) => (curr && curr.offset === offset && normEq(curr.label, label) ? { offset: newOffset, label: curr.label } : curr));
      setEditingLabelTask((curr) => (curr && curr.offset === offset && normEq(curr.label, label) ? { offset: newOffset, label: curr.label } : curr));
    },
    [courses, selectedCourse, setCourses]
  );

  // ===== time step helpers for editing UI =====
  const stepHoldRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopHold = () => {
    if (stepHoldRef.current) {
      clearInterval(stepHoldRef.current);
      stepHoldRef.current = null;
    }
  };
  const startHold = (delta: number, offset: number, label: string) => {
    shiftTaskOffset(offset, label, delta);
    stopHold();
    stepHoldRef.current = setInterval(() => shiftTaskOffset(offset, label, delta), 180);
  };
  React.useEffect(() => () => stopHold(), []);

  const deleteTaskFromCourse = useCallback(
    (offset: number, label: string) => {
      // 事故防止のため、削除前に確認
      if (!confirm('削除しますか？')) return;
      const base = courses.map((c) => ({ ...c, tasks: getTasks(c).slice() }));
      const idx = base.findIndex((c) => c.name === selectedCourse);
      if (idx < 0) return;
      base[idx].tasks = base[idx].tasks.filter((t) => !(t.timeOffset === offset && normEq(t.label, label)));
      setCourses(base);
    },
    [courses, selectedCourse, setCourses]
  );

  const startLabelEdit = useCallback((offset: number, label: string) => {
    setEditingTimeTask(null); // ラベル編集時は時間編集を必ずオフ
    setEditingLabelTask({ offset, label });
    setEditingTaskDraft(label);
  }, []);

  const startTimeEdit = useCallback((offset: number, label: string) => {
    setEditingLabelTask(null); // 時間編集時はラベル編集を必ずオフ
    setEditingTimeTask({ offset, label });
  }, []);

  const cancelTaskLabelEdit = useCallback(() => {
    setEditingLabelTask(null);
    setEditingTaskDraft('');
  }, []);
  const commitTaskLabelEdit = useCallback(
    (oldLabel: string, timeOffset: number) => {
      const nextLabel = (editingInputRef.current?.value ?? '').trim();
      if (!nextLabel) return cancelTaskLabelEdit();
      const base = courses.map((c) => ({ ...c, tasks: getTasks(c).slice() }));
      const idx = base.findIndex((c) => c.name === selectedCourse);
      if (idx < 0) return;
      base[idx].tasks = base[idx].tasks.map((t) =>
        t.timeOffset === timeOffset && normEq(t.label, oldLabel) ? { ...t, label: nextLabel } : t
      );
      setCourses(base);
      setEditingLabelTask(null);
      setEditingTaskDraft('');
    },
    [courses, selectedCourse, cancelTaskLabelEdit, setCourses]
  );

  const renameCourse = useCallback(() => {
    const name = prompt('新しいコース名を入力してください：');
    if (!name) return;
    if (courses.some((c) => c.name === name)) {
      alert('そのコース名は既に存在します。');
      return;
    }
    const base = courses.map((c) => ({ ...c }));
    const idx = base.findIndex((c) => c.name === selectedCourse);
    if (idx < 0) return;
    base[idx].name = name;
    setCourses(base);
    setSelectedCourse(name);
  }, [courses, selectedCourse, setCourses]);

  const deleteCourse = useCallback(() => {
    if (!confirm(`コース『${selectedCourse}』を削除しますか？`)) return;
    const base = courses.filter((c) => c.name !== selectedCourse);
    setCourses(base);
    setSelectedCourse(base[0]?.name ?? '');
  }, [courses, selectedCourse, setCourses]);

  const addCourse = useCallback(() => {
    const raw = newCourseInputRef.current?.value ?? '';
    const name = raw.trim();
    if (!name) return;
    // 同名コースは追加不可（表記ゆれを吸収）
    if (courses.some((c) => normEq(c.name, name))) return;
    const next = [...courses, { name, tasks: [] } as CourseDef];
    setCourses(next);
    // 入力欄クリア（uncontrolled のため DOM を直接クリア）
    if (newCourseInputRef.current) newCourseInputRef.current.value = '';
    setNewCourseDraft('');
    // 追加したコースを選択状態にする
    setSelectedCourse(name);
  }, [courses, setCourses]);

  // ===== positions =====
  const addPosition = useCallback(() => {
    const raw = newPositionInputRef.current?.value ?? '';
    const name = raw.trim();
    if (!name) return;
    if (positions.some((p) => normEq(p, name))) return;
    const next = [...positions, name];
    setPositions(next);
    // 入力欄をクリア（uncontrolled のため DOM を直接クリア）
    if (newPositionInputRef.current) newPositionInputRef.current.value = '';
    setNewPositionDraft('');
  }, [positions, setPositions]);

  const removePosition = useCallback(
    (pos: string) => {
      if (!confirm(`${pos} を削除しますか？`)) return;
      const next = positions.filter((p) => !normEq(p, pos));
      setPositions(next);
      const tbp = { ...tasksByPosition } as Record<string, Record<string, string[]>>;
      delete tbp[pos];
      setTasksByPosition(tbp);
    },
    [positions, tasksByPosition, setPositions, setTasksByPosition]
  );

  const renamePosition = useCallback(
    (pos: string) => {
      const name = (prompt('新しいポジション名: ', pos) ?? '').trim();
      if (!name || normEq(name, pos)) return;
      const next = positions.map((p) => (normEq(p, pos) ? name : p));
      setPositions(next);
      const tbp = { ...tasksByPosition } as Record<string, Record<string, string[]>>;
      if (tbp[pos]) {
        tbp[name] = tbp[pos];
        delete tbp[pos];
      }
      setTasksByPosition(tbp);
      setCourseByPosition((prev) => ({ ...prev, [name]: prev[pos] ?? courses[0]?.name ?? '' }));
    },
    [positions, tasksByPosition, courses, setPositions, setTasksByPosition]
  );

  const togglePositionOpen = useCallback(
    (pos: string) => setOpenPositions((prev) => ({ ...prev, [pos]: !prev[pos] })),
    []
  );
  const setCourseForPosition = useCallback(
    (pos: string, courseName: string) => setCourseByPosition((prev) => ({ ...prev, [pos]: courseName })),
    []
  );
  // --- Areas helpers ---
  const toggleAreaOpen = useCallback(
    (areaId: string) => setOpenAreas((prev) => ({ ...prev, [areaId]: !prev[areaId] })),
    []
  );

  const renameArea = useCallback(
    (target: AreaDef) => {
      const name = (prompt('新しいエリア名: ', target.name ?? '') ?? '').trim();
      if (!name || name === target.name) return;
      const next = areas.map((a) => (a.id === target.id ? { ...a, name } : a));
      setAreas(next);
    },
    [areas, setAreas]
  );

  const removeArea = useCallback(
    (target: AreaDef) => {
      if (!confirm('このエリアを削除しますか？')) return;
      setAreas(areas.filter((a) => a.id !== target.id));
    },
    [areas, setAreas]
  );


  // 指定ポジション×コースの「表示中タスク数」を返す
  const getEnabledCount = (pos: string, courseName: string) => {
    const arr = tasksByPosition[pos]?.[courseName] ?? [];
    return Array.isArray(arr) ? arr.length : 0;
  };

  // 指定ポジション×コースでタスクを一括ON/OFF
  const toggleAllForPositionCourse = useCallback(
    (pos: string, courseName: string, enable: boolean) => {
      const tbp = { ...(tasksByPosition || {}) } as Record<string, Record<string, string[]>>;
      const courseTasks = (courses.find((c) => c.name === courseName)?.tasks ?? []).map((t) => t.label);
      const posMap = { ...(tbp[pos] || {}) } as Record<string, string[]>;
      posMap[courseName] = enable ? courseTasks : [];
      tbp[pos] = posMap;
      setTasksByPosition(tbp);
    },
    [tasksByPosition, setTasksByPosition, courses]
  );

  const toggleTaskForPosition = useCallback(
    (pos: string, courseName: string, label: string) => {
      const tbp = { ...(tasksByPosition || {}) } as Record<string, Record<string, string[]>>;
      const posMap = { ...(tbp[pos] || {}) } as Record<string, string[]>;
      const arr = Array.isArray(posMap[courseName]) ? [...posMap[courseName]] : [];
      const i = arr.findIndex((l) => normEq(l, label));
      if (i >= 0) arr.splice(i, 1);
      else arr.push(label);
      posMap[courseName] = arr;
      tbp[pos] = posMap;
      setTasksByPosition(tbp);
    },
    [tasksByPosition, setTasksByPosition]
  );

  // --- エリア名の新規入力（IME 合成対応のため uncontrolled + composition guard）---
  const newAreaInputRef = useRef<HTMLInputElement | null>(null);
  const [newAreaDraft, setNewAreaDraft] = useState('');
  const [isComposingNewArea, setIsComposingNewArea] = useState(false);

  const addArea = useCallback(() => {
    const raw = newAreaInputRef.current?.value ?? '';
    const name = raw.trim();
    if (!name) return;
    // 同名チェック（ひらがな/カタカナ/全半角の差を吸収）
    if (areas.some((a) => normalizeLabel(a.name) === normalizeLabel(name))) return;
    const id = `area_${Date.now()}`;
    const next: AreaDef[] = [...areas, { id, name, tables: [] }];
    setAreas(next);
    // 入力欄クリア（uncontrolled のため DOM を直接クリア）
    if (newAreaInputRef.current) newAreaInputRef.current.value = '';
    setNewAreaDraft('');
  }, [areas, setAreas]);
  // ===== tables (num pad) =====
  const onNumPadPress = (digit: string) => {
    if (!numPadState) return;
    if (digit === 'C') setNewTableTemp('');
    else if (digit === '←') setNewTableTemp((prev) => prev.slice(0, -1));
    else setNewTableTemp((prev) => (prev + digit).slice(0, 3));
  };
  const onNumPadConfirm = () => {
    const v = newTableTemp.trim();
    if (!v) return;
    // 追加後の整列・重複排除は setTables 側で行う
    setTables([...presetTables, v]);
    // 連続入力のため、パッドは開いたままにし、入力だけリセット
    setNewTableTemp('');
  };
  const onNumPadCancel = () => {
    setNumPadState(null);
    setNewTableTemp('');
  };

  // ===== UI shells =====
  const ListItem: React.FC<{ label: React.ReactNode; onClick: () => void }> = ({ label, onClick }) => (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="w-full flex items-center justify-between px-4 py-4 bg-white text-base border-b active:bg-gray-50 cursor-pointer"
    >
      <span className="flex items-center gap-2 min-w-0">{label}</span>
      <span className="text-gray-400">›</span>
    </div>
  );

  const SubPageShell: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section>
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b">
        <div className="h-12 grid grid-cols-[auto,1fr,auto] items-center">
          <button
            onClick={() => setView('root')}
            className="px-3 pl-0 text-blue-600 justify-self-start"
          >
            {'\u2039'} 戻る
          </button>
          <div className="justify-self-center font-semibold pointer-events-none">{title}</div>
          <div />
        </div>
      </div>
      <div className="p-4 space-y-4">{children}</div>
      <div className={`sticky bottom-0 z-10 border-t bg-white/90 backdrop-blur p-4 ${isDirty ? 'shadow-[0_-6px_12px_rgba(0,0,0,0.06)]' : ''}`}>
        <button
          type="button"
          onClick={() => {
            if (!isDirty || isSaving) return;
            onSave();
          }}
          disabled={!isDirty || !!isSaving}
          className={`w-full px-4 py-3 rounded-md transition active:scale-[.99] ${isDirty && !isSaving ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-500'} ${isSaving ? 'opacity-60' : ''}`}
          aria-live="polite"
        >
          {isSaving ? '保存中…' : isDirty ? '保存' : '保存済み'}
        </button>
      </div>
    </section>
  );

  // ============== render ==============
  // Root list (like iOS Settings top level)
  if (view === 'root') {
    return (
      <section className="overflow-hidden rounded-md border border-gray-200 bg-white">
        <ListItem
          label={
            <>
              <span>コース設定表</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowCoursesInfo((v) => !v); }}
                aria-expanded={showCoursesInfo}
                aria-controls="courses-info"
                className="inline-grid place-items-center h-6 w-6 rounded-full border border-blue-300 text-blue-600 bg-white hover:bg-blue-50 active:scale-[.98]"
                title="コース設定表の説明"
              >
                i
              </button>
            </>
          }
          onClick={() => setView('courses')}
        />
        {showCoursesInfo && (
          <div id="courses-info" className="px-4 py-3 text-[13px] text-blue-900 border-b bg-blue-50/60">
            <p className="mb-1 font-medium">コース設定表とは？</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                この画面では、<strong className="mx-1">コース</strong>と、そのコースに紐づく
                <strong className="mx-1">タスク（開始からの相対時間）</strong>を作成・編集します。
              </li>
              <li>
                用語の補足：<strong className="mx-1">予約リスト</strong>＝予約の一覧画面 ／
                <strong className="mx-1">タスク表</strong>＝各予約の作業手順を時系列に並べた画面。
              </li>
              <li>
                ヒント：タスクの時間は「0分後」「15分後」のように、開始時刻からの分オフセットで設定します。
              </li>
            </ul>
            <div className="mt-2">
              <p className="font-medium">運用の流れ</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>
                  この画面で<strong className="mx-1">コース</strong>を作成し、各コースに
                  <strong className="mx-1">タスク</strong>を登録します。
                </li>
                <li>
                  <strong className="mx-1">予約リスト</strong>で、該当する予約にコースを選択します。
                </li>
                <li>
                  <strong className="mx-1">タスク表</strong>に、選んだコースのタスクが時系列で自動計算されて表示されます。
                </li>
              </ol>
            </div>
          </div>
        )}
        <ListItem
          label={
            <>
              <span>ポジション設定</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowPositionsInfo((v) => !v); }}
                aria-expanded={showPositionsInfo}
                aria-controls="positions-info"
                className="inline-grid place-items-center h-6 w-6 rounded-full border border-blue-300 text-blue-600 bg-white hover:bg-blue-50 active:scale-[.98]"
                title="ポジション設定の説明"
              >
                i
              </button>
            </>
          }
          onClick={() => setView('positions')}
        />
        {showPositionsInfo && (
          <div id="positions-info" className="px-4 py-3 text-[13px] text-blue-900 border-b bg-blue-50/60">
            <p className="mb-1 font-medium">ポジション設定とは？</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                フロント／ホール／キッチンなどの<strong className="mx-1">ポジション</strong>ごとに、各コースで表示する
                <strong className="mx-1">タスク</strong>を切り替えます。
              </li>
              <li>
                例：ホールでは「ドリンク説明」を表示、キッチンでは非表示 といった運用が可能です。
              </li>
              <li>ポジションの追加・名前変更・削除ができます。</li>
            </ul>
            <div className="mt-2">
              <p className="font-medium">運用の流れ</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>
                  この画面で<strong className="mx-1">ポジション</strong>を作成し、各ポジションで
                  <strong className="mx-1">表示するタスク</strong>を設定します。
                </li>
                <li>
                  「<strong className="mx-1">営業前設定</strong>」の「<strong className="mx-1">本日のポジションを選択しよう</strong>」で、
                  当日の自分のポジションを選びます。
                </li>
                <li>
                  タスク表には、<strong className="mx-1">選択したポジションのタスクだけ</strong>が表示されます。
                </li>
              </ol>
            </div>
          </div>
        )}
        <ListItem
          label={
            <>
              <span>卓設定およびエリア設定</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowTablesInfo((v) => !v); }}
                aria-expanded={showTablesInfo}
                aria-controls="tables-info"
                className="inline-grid place-items-center h-6 w-6 rounded-full border border-blue-300 text-blue-600 bg-white hover:bg-blue-50 active:scale-[.98]"
                title="卓設定の説明"
              >
                i
              </button>
            </>
          }
          onClick={() => setView('tables')}
        />
        {showTablesInfo && (
          <div id="tables-info" className="px-4 py-3 text-[13px] text-blue-900 border-b bg-blue-50/60">
            <p className="mb-1 font-medium">卓設定とは？</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>お店で使用する<strong className="mx-1">卓番号（テーブル番号）</strong>を登録・編集します。</li>
              <li>数字パッドで追加（<strong className="mx-1">重複は自動除外／番号順に整列</strong>）。編集モードで個別削除・全削除が可能です。</li>
              <li>卓番号は最大<strong className="mx-1">3桁</strong>まで登録できます。</li>
              <li>ここで登録していない番号でも、<strong className="mx-1">予約作成時に直接入力</strong>して利用できます。卓番制の運用（卓ごとに担当を分ける等）に活用してください。</li>
            </ul>
            <div className="mt-2">
              <p className="font-medium">運用の流れ（卓番制の例）</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>この画面で、よく使う卓番号を登録しておきます。</li>
                <li>「<strong className="mx-1">営業前設定</strong>」の「<strong className="mx-1">本日の担当する卓番号を選択しよう</strong>」で、当日の自分の担当卓を選びます。</li>
                <li>選んだ卓の予約だけが<strong className="mx-1">予約リスト</strong>と<strong className="mx-1">タスク表</strong>に表示されます（担当外の卓は非表示）。</li>
              </ol>
            </div>
          </div>
        )}
        <ListItem
          label={
            <>
              <span>食べ放題 / 飲み放題</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowEatDrinkInfo((v) => !v); }}
                aria-expanded={showEatDrinkInfo}
                aria-controls="eatdrink-info"
                className="inline-grid place-items-center h-6 w-6 rounded-full border border-blue-300 text-blue-600 bg-white hover:bg-blue-50 active:scale-[.98]"
                title="食べ放題 / 飲み放題の説明"
              >
                i
              </button>
            </>
          }
          onClick={() => setView('eatdrink')}
        />
        {showEatDrinkInfo && (
          <div id="eatdrink-info" className="px-4 py-3 text-[13px] text-blue-900 border-b bg-blue-50/60">
            <p className="mb-1 font-medium">食べ放題 / 飲み放題とは？</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>予約リストに表示する<strong className="mx-1">2文字までの略称</strong>を登録します。記号や絵文字（例：⭐︎, ⭐︎⭐︎）も利用できます。</li>
              <li>同じ表記は重複登録できません。ポイント利用など他の識別用途にも自由に使えます。</li>
            </ul>
            <div className="mt-2">
              <p className="font-medium">運用の流れ</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>
                  この画面で<strong className="mx-1">食べ放題／飲み放題</strong>の<strong className="mx-1">略称（2文字まで）
                  </strong>を登録します。
                </li>
                <li>
                  <strong className="mx-1">予約リスト</strong>で、該当する予約に登録した略称を選択します（※表示設定により、この欄を非表示にすることもできます）。
                </li>
                <li>
                  選択した略称が<strong className="mx-1">予約リスト</strong>に表示され、現場での識別に役立ちます（※ポイント利用など任意の識別にも流用可）。
                </li>
              </ol>
            </div>
          </div>
        )}
        <ListItem label={<span>ミニタスク</span>} onClick={() => setView('minitasks')} />
        <ListItem label={<span>波設定</span>} onClick={() => setView('wavesettings')} />
        <div className={`sticky bottom-0 z-10 border-t bg-white/90 backdrop-blur p-4 ${isDirty ? 'shadow-[0_-6px_12px_rgba(0,0,0,0.06)]' : ''}`}>
          <button
            type="button"
            onClick={() => {
              if (!isDirty || isSaving) return;
              onSave();
            }}
            disabled={!isDirty || !!isSaving}
            className={`w-full px-4 py-3 rounded-md transition active:scale-[.99] ${isDirty && !isSaving ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-500'} ${isSaving ? 'opacity-60' : ''}`}
            aria-live="polite"
          >
            {isSaving ? '保存中…' : isDirty ? '保存' : '保存済み'}
          </button>
        </div>
      </section>
    );
  }
  // --- MiniTasks settings page (stub) ---
  if (view === 'minitasks') {
    return (
      <SubPageShell title="ミニタスク">
        <div className="text-sm text-gray-600">
          <MiniTasksSettings value={value} onChange={patchRoot} />
        </div>
      </SubPageShell>
    );
  }

  // --- Wave settings page (stub) ---
  if (view === 'wavesettings') {
    return (
      <SubPageShell title="波設定">
        <div className="text-sm text-gray-600">
          <WaveSettings value={value} onChange={patchRoot} />
        </div>
      </SubPageShell>
    );
  }


  // --- Courses page ---
  if (view === 'courses') {
    return (
      <SubPageShell title="コース設定表">
        <div className="space-y-4 text-sm">
          {/* 新しいコースの追加 */}
          <div className="mb-3 rounded-lg border border-blue-200 bg-gradient-to-b from-white to-blue-50/50 p-3 shadow-sm">
            <header className="mb-2 flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-grid place-items-center h-5 w-5 rounded-full bg-blue-600 text-white text-[12px] leading-none"
                title="新規追加"
              >
                ＋
              </span>
              <span className="text-sm font-semibold text-blue-700">新しいコースを追加</span>
            </header>
            <p className="text-gray-500 text-xs">
              名前を入力し<strong className="mx-1">「＋追加」</strong>を押してください（同名は追加できません）。
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                ref={newCourseInputRef}
                type="text"
                placeholder="例: 2時間デモ"
                defaultValue={newCourseDraft}
                onInput={(e) => {
                  if (!isComposingNewCourse) {
                    setNewCourseDraft((e.currentTarget as HTMLInputElement).value);
                  }
                }}
                onCompositionStart={() => setIsComposingNewCourse(true)}
                onCompositionEnd={() => {
                  setIsComposingNewCourse(false);
                  setNewCourseDraft(newCourseInputRef.current?.value ?? '');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isComposingNewCourse) {
                    e.preventDefault();
                    addCourse();
                  }
                }}
                className="border px-3 py-2 rounded-md text-sm flex-1 shadow-sm"
                aria-label="新しいコース名"
              />
              <button
                type="button"
                onClick={addCourse}
                disabled={!newCourseDraft.trim()}
                className={`px-3 py-2 rounded-md text-sm shadow-sm active:scale-[.99] ${newCourseDraft.trim() ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
              >
                ＋追加
              </button>
            </div>
          </div>

          {/* 登録済みコース（アコーディオン） */}
          {courses.length > 0 ? (
            <>
              <div className="flex items-center gap-2 mt-4 mb-1">
                <div className="h-px bg-gray-200 flex-1" />
                <span className="text-xs text-gray-500">登録済みコース</span>
                <div className="h-px bg-gray-200 flex-1" />
              </div>
              <div className="space-y-3">
              {courses.map((c) => {
                const name = c.name;
                const isOpen = openCourse === name;

                return (
                  <div key={name} className="rounded-lg border bg-white shadow-sm overflow-visible">
                    {/* ヘッダー行（行全体クリックで開閉） */}
                    <div
                      className="flex items-center justify-between px-3 py-2 bg-gray-50/80 border-b cursor-pointer select-none hover:bg-gray-50"
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleCourseOpen(name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleCourseOpen(name);
                        }
                      }}
                      aria-expanded={isOpen}
                      aria-controls={`course-panel-${name}`}
                    >
                      {/* 左：コース名 */}
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900 min-w-0">
                        <span className="truncate">{name}</span>
                      </div>

                      {/* 右：開閉インジケータ + 設定メニュー（三点） */}
                      <div className="flex items-center gap-2">
                        {/* 開閉インジケータ */}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`h-4 w-4 text-gray-600 transition-transform ${isOpen ? 'rotate-180' : 'rotate-0'}`}
                          aria-hidden="true"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>

                        {/* 設定メニュー（三点） */}
                        <div
                          className="relative"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          ref={courseMenuFor === name ? (el) => { courseMenuRef.current = el; } : undefined}
                        >
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => setCourseMenuFor((prev) => (prev === name ? null : name))}
                            className="h-8 w-8 grid place-items-center rounded-md border border-gray-300 bg-white hover:bg-gray-100 active:scale-[.98] shadow-sm text-gray-700"
                            aria-haspopup="menu"
                            aria-expanded={courseMenuFor === name}
                            aria-label={`${name} の設定`}
                            title="その他の操作"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                              <circle cx="5" cy="12" r="1.5" />
                              <circle cx="12" cy="12" r="1.5" />
                              <circle cx="19" cy="12" r="1.5" />
                            </svg>
                          </button>
                          {courseMenuFor === name && (
                            <div role="menu" className="absolute right-0 mt-2 w-44 rounded-md border bg-white shadow-lg py-1 text-sm z-20">
                              <button
                                type="button"
                                onClick={() => { setCourseMenuFor(null); setSelectedCourse(name); renameCourse(); }}
                                className="w-full text-left px-3 py-2 hover:bg-gray-50"
                              >
                                ✎ コース名変更
                              </button>
                              <button
                                type="button"
                                onClick={() => { setCourseMenuFor(null); setSelectedCourse(name); deleteCourse(); }}
                                className="w-full text-left px-3 py-2 text-red-600 hover:bg-red-50"
                              >
                                🗑 コース削除
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 展開エリア：タスク編集（既存UIを流用） */}
                    {isOpen && selectedCourse === name && (
                      <div id={`course-panel-${name}`} className="p-3 space-y-3">
                        {/* 既存タスクリスト */}
                        <div className="space-y-1">
                          {courseTasksForList.length === 0 ? (
                            <div className="py-6 px-3 rounded-md border border-dashed bg-gray-50/60 text-sm text-gray-600 text-center">
                              まだタスクがありません。下の<strong className="mx-1">「追加」</strong>ボタンから新規タスクを追加してください。
                            </div>
                          ) : (
                            courseTasksForList.map((task, idx) => (
                              <div
                                key={`${task.timeOffset}_${normalizeLabel(task.label)}_${idx}`}
                                className="py-2 px-2 bg-white rounded-md border border-gray-200 shadow-sm hover:shadow-md transition group"
                              >
                                <div className="grid grid-cols-[auto,1fr,64px] items-center gap-3">
                                  {/* col 1: time (with stepper in edit mode) */}
                                  {editingTimeTask && editingTimeTask.offset === task.timeOffset && normEq(editingTimeTask.label, task.label) ? (
                                    <div className="flex items-center justify-center shrink-0 min-w-[152px]">
                                      <div className="inline-flex items-stretch rounded-md border border-sky-300 bg-sky-50/70 shadow-sm overflow-hidden shrink-0" role="group" aria-label="時間調整">
                                        <button
                                          type="button"
                                          data-keepedit="1"
                                          onPointerDown={(e) => { e.preventDefault(); startHold(-5, task.timeOffset, task.label); }}
                                          onPointerUp={stopHold}
                                          onPointerCancel={stopHold}
                                          onPointerLeave={stopHold}
                                          className="px-2 w-10 h-10 text-sm font-medium text-sky-700 bg-white hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-400"
                                          aria-label="5分早く"
                                        >
                                          -5
                                        </button>
                                        <button
                                          type="button"
                                          data-keepedit="1"
                                          onClick={() => { stopHold(); setEditingTimeTask(null); }}
                                          className="min-w-[72px] h-10 px-2 grid place-items-center text-sm font-semibold text-sky-900 tabular-nums bg-sky-50 shrink-0"
                                          aria-label="時間編集を閉じる"
                                        >
                                          {task.timeOffset}分後
                                        </button>
                                        <button
                                          type="button"
                                          data-keepedit="1"
                                          onPointerDown={(e) => { e.preventDefault(); startHold(+5, task.timeOffset, task.label); }}
                                          onPointerUp={stopHold}
                                          onPointerCancel={stopHold}
                                          onPointerLeave={stopHold}
                                          className="px-2 w-10 h-10 text-sm font-medium text-sky-700 bg-white hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-400"
                                          aria-label="5分遅く"
                                        >
                                          +5
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => startTimeEdit(task.timeOffset, task.label)}
                                      className="h-9 inline-flex items-center justify-center px-3 rounded-full border border-sky-200 bg-sky-50 text-sky-800 text-sm font-medium tabular-nums active:scale-[.99] hover:bg-sky-100 focus:outline-none focus:ring-2 focus:ring-sky-400 shrink-0"
                                      title="タップで時間編集"
                                    >
                                      {task.timeOffset}分後
                                    </button>
                                  )}

                                  {/* col 2: label */}
                                  {editingLabelTask && editingLabelTask.offset === task.timeOffset && normEq(editingLabelTask.label, task.label) ? (
                                    <input
                                      ref={editingInputRef}
                                      type="text"
                                      defaultValue={editingTaskDraft}
                                      inputMode="text"
                                      autoCapitalize="none"
                                      autoCorrect="off"
                                      spellCheck={false}
                                      lang="ja"
                                      onCompositionStart={() => { editingLabelComposingRef.current = true; }}
                                      onCompositionEnd={() => { editingLabelComposingRef.current = false; }}
                                      onBlur={() => { /* no-op */ }}
                                      onKeyDown={(e) => {
                                        const isComp = (e as any).nativeEvent?.isComposing;
                                        if (e.key === 'Enter' && !isComp && !editingLabelComposingRef.current) {
                                          e.preventDefault();
                                          commitTaskLabelEdit(task.label, task.timeOffset);
                                        } else if (e.key === 'Escape') {
                                          e.preventDefault();
                                          cancelTaskLabelEdit();
                                        }
                                      }}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onClick={(e) => e.stopPropagation()}
                                      autoFocus
                                      className="min-w-0 h-9 w-full px-3 rounded-md border border-gray-300 bg-white text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                                      key={`edit-${task.timeOffset}-${task.label}`}
                                    />
                                  ) : (
                                    <span
                                      className="min-w-0 h-9 w-full inline-flex items-center px-3 rounded-md border border-gray-200 bg-white text-gray-900 text-sm cursor-text overflow-hidden text-ellipsis whitespace-nowrap transition group-hover:bg-gray-50"
                                      onMouseDown={(e) => { e.preventDefault(); }}
                                      onClick={() => startLabelEdit(task.timeOffset, task.label)}
                                      title="クリックして名前を編集"
                                    >
                                      {task.label}
                                    </span>
                                  )}

                                  {/* col 3: delete */}
                                  <button
                                    onClick={() => deleteTaskFromCourse(task.timeOffset, task.label)}
                                    className="w-[56px] h-9 rounded-md border border-red-200 text-red-600/90 hover:bg-red-50 active:scale-[.99] justify-self-end text-sm shrink-0"
                                  >
                                    削除
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>

                        {/* 新規タスクを追加 */}
                        <div className="mt-4">
                          <div className="rounded-lg border border-emerald-200 bg-gradient-to-b from-white to-emerald-50/50 p-3 shadow-sm">
                            <header className="mb-2 flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="inline-grid place-items-center h-5 w-5 rounded-full bg-emerald-600 text-white text-[12px] leading-none"
                                title="新規追加"
                              >
                                ＋
                              </span>
                              <span className="text-sm font-semibold text-emerald-700">このコースに新しいタスクを追加</span>
                            </header>
                            <p className="text-gray-500 text-xs">
                              タスク名を入力し<strong className="mx-1">時間（0〜180分）</strong>を調整して「追加」を押してください。
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <input
                                ref={newTaskInputRef}
                                type="text"
                                placeholder="例: ドリンク説明"
                                defaultValue={newTaskDraft}
                                inputMode="text"
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                autoComplete="off"
                                lang="ja"
                                onCompositionStart={() => { setIsComposingNewTask(true); }}
                                onCompositionEnd={(e) => {
                                  // 合成確定時に state を最終値へ（ボタン活性のため）
                                  setIsComposingNewTask(false);
                                  setNewTaskDraft((e.currentTarget as HTMLInputElement).value);
                                }}
                                onInput={(e) => {
                                  // 編集中の値は state に同期（活性/非活性のため）。入力自体は uncontrolled
                                  if (!isComposingNewTask) {
                                    setNewTaskDraft((e.currentTarget as HTMLInputElement).value);
                                  }
                                }}
                                className="border px-3 py-2 rounded-md text-sm flex-1 min-w-[10rem]"
                                aria-label="新規タスク名"
                                enterKeyHint="done"
                                onKeyDown={(e) => {
                                  const isComp = (e as any).nativeEvent?.isComposing;
                                  if (e.key === 'Enter' && !isComp && !isComposingNewTask) {
                                    e.preventDefault();
                                    handleAddNew();
                                  }
                                }}
                              />
                              <div className="inline-flex items-stretch rounded-md border border-gray-300 overflow-hidden" role="group" aria-label="追加するタスクの時間">
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => setNewTaskOffset((prev) => clamp(prev - 5, 0, 180))}
                                  className="px-3 h-10 text-sm bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                                  aria-label="5分早く"
                                >
                                  -5
                                </button>
                                <div className="min-w-[72px] h-10 grid place-items-center px-2 text-sm font-semibold tabular-nums bg-gray-50">
                                  {newTaskOffset}分後
                                </div>
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => setNewTaskOffset((prev) => clamp(prev + 5, 0, 180))}
                                  className="px-3 h-10 text-sm bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                                  aria-label="5分遅く"
                                >
                                  +5
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={handleAddNew}
                                disabled={!newTaskDraft.trim()}
                                className={`h-10 px-4 rounded-md text-sm transition active:scale-[.99] ${newTaskDraft.trim() ? 'bg-emerald-600 text-white shadow-sm' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
                                title="タスクを追加"
                              >
                                追加
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed bg-gray-50/60 p-4 text-sm text-gray-600">
              まだコースはありません。上の「新しいコースを追加」から作成してください。
            </div>
          )}
        </div>
      </SubPageShell>
    );
  }

  // --- Positions page ---
  if (view === 'positions') {
    return (
      <SubPageShell title="ポジション設定">
        <div className="space-y-4">
          {/* 新規ポジションの追加 */}
          <div className="mb-3 rounded-lg border border-blue-200 bg-gradient-to-b from-white to-blue-50/50 p-3 shadow-sm">
            <header className="mb-2 flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-grid place-items-center h-5 w-5 rounded-full bg-blue-600 text-white text-[12px] leading-none"
                title="新規追加"
              >
                ＋
              </span>
              <span className="text-sm font-semibold text-blue-700">新しいポジションを追加</span>
            </header>
            <p className="text-gray-500 text-xs">
              名前を入力し<strong className="mx-1">「＋追加」</strong>を押してください（同名は追加できません）。
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                ref={newPositionInputRef}
                type="text"
                placeholder="例: フロント"
                defaultValue={newPositionDraft}
                onInput={(e) => {
                  if (!isComposingNewPosition) {
                    setNewPositionDraft((e.currentTarget as HTMLInputElement).value);
                  }
                }}
                onCompositionStart={() => setIsComposingNewPosition(true)}
                onCompositionEnd={() => {
                  setIsComposingNewPosition(false);
                  setNewPositionDraft(newPositionInputRef.current?.value ?? '');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isComposingNewPosition) {
                    e.preventDefault();
                    addPosition();
                  }
                }}
                className="border px-3 py-2 rounded-md text-sm flex-1 shadow-sm"
                aria-label="新しいポジション名"
              />
              <button
                type="button"
                onClick={addPosition}
                disabled={!newPositionDraft.trim()}
                className={`px-3 py-2 rounded-md text-sm shadow-sm active:scale-[.99] ${newPositionDraft.trim() ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
              >
                ＋追加
              </button>
            </div>
          </div>

          {/* 登録済みポジション 見出し/リスト or 空状態 */}
          {positions.length > 0 ? (
            <>
              <div className="flex items-center gap-2 mt-4 mb-1">
                <div className="h-px bg-gray-200 flex-1" />
                <span className="text-xs text-gray-500">登録済みポジション</span>
                <div className="h-px bg-gray-200 flex-1" />
              </div>

              {/* ポジションごとのカード */}
              {positions.map((pos) => {
                const currentCourse = courseByPosition[pos] ?? courses[0]?.name ?? '';
                const tasksForCourse = (courses.find((c) => c.name === currentCourse)?.tasks ?? [])
                  .slice()
                  .sort((a, b) => a.timeOffset - b.timeOffset);

                return (
                  <div key={pos} className="rounded-lg border bg-white shadow-sm overflow-visible">
                    {/* ヘッダー行（行全体クリックで開閉） */}
                    <div
                      className="flex items-center justify-between px-3 py-2 bg-gray-50/80 border-b cursor-pointer select-none hover:bg-gray-50"
                      role="button"
                      tabIndex={0}
                      onClick={() => togglePositionOpen(pos)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          togglePositionOpen(pos);
                        }
                      }}
                      aria-expanded={openPositions[pos] ? true : false}
                      aria-controls={`pos-panel-${pos}`}
                    >
                      {/* 左：ポジション名 */}
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        <span>{pos}</span>
                      </div>

                      {/* 右：開閉インジケータ + 設定メニュー（三点）*/}
                      <div className="flex items-center gap-2">
                        {/* 開閉インジケータ（矢印） */}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`h-4 w-4 text-gray-600 transition-transform ${openPositions[pos] ? 'rotate-180' : 'rotate-0'}`}
                          aria-hidden="true"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>

                        {/* 設定メニュー（三点） */}
                        <div
                          className="relative"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          ref={posMenuFor === pos ? (el) => { posMenuRef.current = el; } : undefined}
                        >
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); setPosMenuFor((prev) => (prev === pos ? null : pos)); }}
                            className="h-8 w-8 grid place-items-center rounded-md border border-gray-300 bg-white hover:bg-gray-100 active:scale-[.98] shadow-sm text-gray-700"
                            aria-haspopup="menu"
                            aria-expanded={posMenuFor === pos}
                            aria-label={`${pos} の設定`}
                            title="その他の操作"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                              <circle cx="5" cy="12" r="1.5" />
                              <circle cx="12" cy="12" r="1.5" />
                              <circle cx="19" cy="12" r="1.5" />
                            </svg>
                          </button>
                          {posMenuFor === pos && (
                            <div role="menu" className="absolute right-0 mt-2 w-40 rounded-md border bg-white shadow-lg py-1 text-sm z-20">
                              <button
                                type="button"
                                onClick={() => { setPosMenuFor(null); renamePosition(pos); }}
                                className="w-full text-left px-3 py-2 hover:bg-gray-50"
                              >
                                ✎ 名前変更
                              </button>
                              <button
                                type="button"
                                onClick={() => { setPosMenuFor(null); removePosition(pos); }}
                                className="w-full text-left px-3 py-2 text-red-600 hover:bg-red-50"
                              >
                                🗑 削除
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 展開エリア */}
                    {openPositions[pos] && (
                      <div id={`pos-panel-${pos}`} className="p-3 space-y-3">
                        {/* ツールバー：コース選択のみ */}
                        <div className="flex items-center gap-2">
                          <label className="text-sm text-gray-600">コース：</label>
                          <select
                            value={currentCourse}
                            onChange={(e) => setCourseForPosition(pos, e.target.value)}
                            className="px-3 py-2 rounded-md border border-gray-300 text-sm shadow-sm bg-white"
                          >
                            {courses.map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* タスクリスト（テーブル風） */}
                        <div className="rounded-md border overflow-hidden">
                          <div className="flex flex-wrap items-center px-3 py-2 bg-gray-50 text-sm text-gray-500 gap-4 md:gap-6">
                            <div className="min-w-[5.5rem]">時間</div>
                            <div className="flex-1 min-w-0">タスク名</div>
                            <div className="ml-4 md:ml-6 text-right">表示</div>
                          </div>
                          <div>
                            {tasksForCourse.map((task) => (
                              <div
                                key={`${task.timeOffset}_${task.label}`}
                                className="flex flex-wrap items-center px-3 py-2 border-t odd:bg-white even:bg-gray-50/40 hover:bg-gray-50 text-sm gap-4 md:gap-6"
                              >
                                <div className="min-w-[5.5rem] tabular-nums text-gray-700">{task.timeOffset}分後</div>
                                <div className="flex-1 min-w-0 truncate" title={task.label}>{task.label}</div>
                                <div className="ml-4 md:ml-6 text-right">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(
                                      tasksByPosition[pos]?.[currentCourse]?.some((l) => normEq(l, task.label))
                                    )}
                                    onChange={() => toggleTaskForPosition(pos, currentCourse, task.label)}
                                    className="h-5 w-5 align-middle"
                                  />
                                </div>
                              </div>
                            ))}
                            {tasksForCourse.length === 0 && (
                              <div className="px-3 py-6 text-sm text-gray-500">該当するタスクがありません。</div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed bg-gray-50/60 p-4 text-sm text-gray-600">
              まだ登録済みのポジションはありません。上の「新しいポジション名」に入力して「＋追加」を押してください。
            </div>
          )}
        </div>
      </SubPageShell>
    );
  }

  // --- Tables index (drill-in) ---
  if (view === 'tables') {
    return (
      <SubPageShell title="卓設定およびエリア設定">
        <div className="rounded-md border overflow-hidden bg-white">
          <ListItem label={<span>卓設定</span>} onClick={() => setView('tablesTables')} />
          <ListItem label={<span>エリア設定</span>} onClick={() => setView('tablesAreas')} />
        </div>
      </SubPageShell>
    );
  }

  // --- Tables > 卓設定 ---
  if (view === 'tablesTables') {
    return (
      <>
        <SubPageShell title="卓設定">
          <div className="space-y-3 text-sm">
            <div className="mb-2">
              <div className="rounded-lg border border-blue-200 bg-gradient-to-b from-white to-blue-50/50 p-3 shadow-sm">
                <header className="mb-2 flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-grid place-items-center h-5 w-5 rounded-full bg-blue-600 text-white text-[12px] leading-none"
                    title="新規追加"
                  >
                    ＋
                  </span>
                  <span className="text-sm font-semibold text-blue-700">新しい卓を追加</span>
                </header>
                <p className="text-gray-500 text-xs">
                  数字パッドで卓番号を入力し<strong className="mx-1">「追加」</strong>を押してください（重複は自動で除外／番号順に整列）。
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={newTableTemp}
                    readOnly
                    onClick={() => setNumPadState({ id: '-1', field: 'presetTable', value: '' })}
                    placeholder="卓番号を入力"
                    maxLength={3}
                    className="border px-2 py-1 w-full rounded text-sm text-center cursor-pointer shadow-sm"
                  />
                </div>
              </div>

              {/* 視覚的な区切り（新規追加 と 設定済みリスト） */}
              <div className="flex items-center gap-2 mt-4 mb-1">
                <div className="h-px bg-gray-200 flex-1" />
                <span className="text-xs text-gray-500">設定済み卓</span>
                <div className="h-px bg-gray-200 flex-1" />
              </div>
            </div>

            {presetTables.length > 0 ? (
              <div className="mt-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium mb-1">設定済み卓（{presetTables.length}）</p>
                  <div className="flex items-center gap-2">
                    {tableEditMode && (
                      <button
                        onClick={() => setTables([])}
                        className="px-2 py-0.5 text-xs text-red-600 border border-red-200 rounded bg-white hover:bg-red-50 active:scale-[.99]"
                      >
                        全削除
                      </button>
                    )}
                    <button onClick={() => setTableEditMode((p) => !p)} className="px-2 py-0.5 bg-yellow-500 text-white rounded text-xs active:scale-[.99]">
                      {tableEditMode ? '完了' : '編集'}
                    </button>
                  </div>
                </div>
                <div className="grid gap-1.5 p-0 grid-cols-[repeat(auto-fit,minmax(3.5rem,1fr))]">
                  {presetTables.map((tbl) =>
                    tableEditMode ? (
                      <div key={tbl} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 bg-white shadow-sm whitespace-nowrap">
                        <span className="text-sm font-medium tabular-nums">{tbl}</span>
                        <button
                          onClick={() => setTables(presetTables.filter((t) => t !== tbl))}
                          className="ml-0.5 inline-flex items-center justify-center h-6 w-6 rounded-full border border-red-200 bg-red-50 text-red-600 text-[14px] leading-none hover:bg-red-100 hover:text-red-700 active:scale-[.98]"
                          aria-label={`${tbl} を削除`}
                          title="削除"
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <div key={tbl} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 bg-white shadow-sm whitespace-nowrap">
                        <span className="text-sm font-medium tabular-nums">{tbl}</span>
                      </div>
                    )
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-dashed bg-gray-50/60 p-4 text-sm text-gray-600">
                まだ卓は登録されていません。上の「卓番号を入力」から追加してください。
              </div>
            )}
          </div>
        </SubPageShell>

        {/* ===== 数値パッド（画面下部のボトムシート）===== */}
        {numPadState && (
          <div className="fixed inset-0 z-[120]">
            {/* backdrop */}
            <button
              type="button"
              onClick={onNumPadCancel}
              aria-label="数字パッドを閉じる"
              className="absolute inset-0 bg-black/30"
            />
            {/* sheet */}
            <div className="absolute left-0 right-0 bottom-0 bg-white border-t rounded-t-2xl shadow-2xl">
              <div className="mx-auto w-full max-w-md p-3 pb-5">
                {/* 現在の入力表示 */}
                <div className="w-full text-center mb-2">
                  <div className="inline-block min-w-[6rem] px-3 py-2 rounded-md border bg-gray-50 text-2xl font-mono tracking-widest tabular-nums">
                    {newTableTemp || '‒‒‒'}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {['1','2','3','4','5','6','7','8','9','0','←','C'].map((d) => (
                    <button
                      key={d}
                      onClick={() => onNumPadPress(d)}
                      className="bg-white border rounded-lg text-xl font-mono py-3 shadow-sm hover:bg-gray-50 active:scale-[.99]"
                      aria-label={`キー ${d}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={onNumPadCancel}
                    className="px-4 py-3 rounded-md border bg-white text-gray-700 hover:bg-gray-50 active:scale-[.99]"
                  >
                    閉じる
                  </button>
                  <button
                    onClick={onNumPadConfirm}
                    className="px-4 py-3 rounded-md bg-blue-600 text-white shadow-sm active:scale-[.99]"
                  >
                    追加
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // --- Tables > エリア設定 ---
  if (view === 'tablesAreas') {
    return (
      <SubPageShell title="エリア設定">
        <div className="space-y-3 text-sm">
          <div className="mb-3 rounded-lg border border-blue-200 bg-gradient-to-b from-white to-blue-50/50 p-3 shadow-sm">
            <header className="mb-2 flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-grid place-items-center h-5 w-5 rounded-full bg-blue-600 text-white text-[12px] leading-none"
                title="新規追加"
              >
                ＋
              </span>
              <span className="text-sm font-semibold text-blue-700">新しいエリアを追加</span>
            </header>
            <p className="text-gray-500 text-xs">
              名前を入力し<strong className="mx-1">「＋追加」</strong>を押してください（同名は追加できません）。
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                ref={newAreaInputRef}
                type="text"
                placeholder="例: 1F / 2F / 個室"
                defaultValue={newAreaDraft}
                onInput={(e) => {
                  if (!isComposingNewArea) {
                    setNewAreaDraft((e.currentTarget as HTMLInputElement).value);
                  }
                }}
                onCompositionStart={() => setIsComposingNewArea(true)}
                onCompositionEnd={() => {
                  setIsComposingNewArea(false);
                  setNewAreaDraft(newAreaInputRef.current?.value ?? '');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isComposingNewArea) {
                    e.preventDefault();
                    addArea();
                  }
                }}
                className="border px-3 py-2 rounded-md text-sm flex-1 shadow-sm"
                aria-label="新しいエリア名"
              />
              <button
                type="button"
                onClick={addArea}
                disabled={!newAreaDraft.trim()}
                className={`px-3 py-2 rounded-md text-sm shadow-sm active:scale-[.99] ${newAreaDraft.trim() ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
              >
                ＋追加
              </button>
            </div>
          </div>

          {areas.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-gray-50/60 p-4 text-sm text-gray-600">
              まだエリアはありません。「＋ エリア追加」から作成し、所属する卓を選択してください。
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mt-4 mb-1">
                <div className="h-px bg-gray-200 flex-1" />
                <span className="text-xs text-gray-500">登録済みエリア</span>
                <div className="h-px bg-gray-200 flex-1" />
              </div>
              {areas.map((area, idx) => {
                const aid = String(area.id ?? idx);
                const isOpen = !!openAreas[aid];

                return (
                  <div key={aid} className="rounded-lg border bg-white shadow-sm">
                    {/* ヘッダー行（行全体クリックで開閉） */}
                    <div
                      className="flex items-center justify-between px-3 py-2 bg-gray-50/80 border-b cursor-pointer select-none hover:bg-gray-50"
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleAreaOpen(aid)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleAreaOpen(aid);
                        }
                      }}
                      aria-expanded={isOpen}
                      aria-controls={`area-panel-${aid}`}
                    >
                      {/* 左：エリア名 */}
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900 min-w-0">
                        <span className="truncate">{area.name || '(名称未設定)'}</span>
                      </div>

                      {/* 右：開閉インジケータ + 設定メニュー（三点） */}
                      <div className="flex items-center gap-2">
                        {/* 開閉インジケータ（矢印） */}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`h-4 w-4 text-gray-600 transition-transform ${isOpen ? 'rotate-180' : 'rotate-0'}`}
                          aria-hidden="true"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>

                        {/* 設定メニュー（三点） */}
                        <div
                          className="relative"
                          ref={areaMenuFor === aid ? (el) => { areaMenuRef.current = el; } : undefined}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setAreaMenuFor((prev) => (prev === aid ? null : aid)); }}
                            className="h-8 w-8 grid place-items-center rounded-md border border-gray-300 bg-white hover:bg-gray-100 active:scale-[.98] shadow-sm text-gray-700"
                            aria-haspopup="menu"
                            aria-expanded={areaMenuFor === aid}
                            aria-label={`${area.name || 'このエリア'} の設定`}
                            title="その他の操作"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                              <circle cx="5" cy="12" r="1.5" />
                              <circle cx="12" cy="12" r="1.5" />
                              <circle cx="19" cy="12" r="1.5" />
                            </svg>
                          </button>
                          {areaMenuFor === aid && (
                            <div role="menu" className="absolute right-0 mt-2 w-40 rounded-md border bg-white shadow-lg py-1 text-sm z-20">
                              <button
                                type="button"
                                onClick={() => { setAreaMenuFor(null); renameArea(area); }}
                                className="w-full text-left px-3 py-2 hover:bg-gray-50"
                              >
                                ✎ 名前変更
                              </button>
                              <button
                                type="button"
                                onClick={() => { setAreaMenuFor(null); removeArea(area); }}
                                className="w-full text-left px-3 py-2 text-red-600 hover:bg-red-50"
                              >
                                🗑 削除
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 展開エリア：卓の割当（既存のタイルUIを流用） */}
                    {isOpen && (
                      <div id={`area-panel-${aid}`} className="p-3">
                        {presetTables.length === 0 ? (
                          <p className="text-sm text-gray-500">先に「卓設定」で卓番号を登録してください。</p>
                        ) : (
                          <div className="grid gap-1.5 grid-cols-[repeat(auto-fit,minmax(3.5rem,1fr))]">
                            {presetTables.map((tbl) => {
                              const key = String(tbl);
                              const selected = Array.isArray(area.tables) && area.tables.includes(key);
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => {
                                    const next = areas.map((a) => {
                                      if (a.id !== area.id) return a;
                                      const set = new Set<string>(Array.isArray(a.tables) ? a.tables.map(String) : []);
                                      if (set.has(key)) set.delete(key); else set.add(key);
                                      return { ...a, tables: Array.from(set).sort((x, y) => Number(x) - Number(y)) } as AreaDef;
                                    });
                                    setAreas(next);
                                  }}
                                  className={`inline-flex items-center justify-center gap-1 rounded-full border px-2.5 py-1 shadow-sm whitespace-nowrap tabular-nums ${selected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white'} active:scale-[.99]`}
                                  title={`${key} を${selected ? '除外' : '追加'}`}
                                >
                                  <span className="text-sm font-medium">{key}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SubPageShell>
    );
  }

  // --- Eat/Drink page ---
  if (view === 'eatdrink') {
    return (
      <SubPageShell title="食べ放題 / 飲み放題">
        <div className="space-y-6 text-sm">
          {/* 使い方のヒントトグル */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowEatDrinkHelp((v) => !v)}
              aria-expanded={showEatDrinkHelp}
              aria-controls="eatdrink-help"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-white text-gray-700 hover:bg-gray-50 active:scale-[.99] shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8.5v.01M11 11h2v5h-2z" />
              </svg>
              <span>使い方のヒント</span>
            </button>
          </div>

          {showEatDrinkHelp && (
            <div id="eatdrink-help" className="rounded-md border border-blue-200 bg-blue-50/70 p-3 text-[13px] text-blue-900">
              <p className="mb-1">この略称は次の用途に使えます：</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>予約リストで、どの<strong className="mx-1">食べ放題／飲み放題</strong>かをひと目で判別するための表示。</li>
                <li>運用に応じて、<strong className="mx-1">ポイント利用卓・記念日席</strong>など、他の識別目的に使ってもOK。</li>
                <li>表示幅の都合で<strong className="mx-1">2文字まで</strong>。記号や絵文字（例：⭐︎, ⭐︎⭐︎）も利用できます。</li>
                <li>同じ表記は重複として追加できません。</li>
              </ul>
            </div>
          )}

          {/* 食べ放題 */}
          <section className="rounded-lg border bg-white shadow-sm overflow-hidden">
            <header className="px-3 py-2 bg-gray-50/80 border-b font-semibold">食べ放題</header>
            <div className="p-3 space-y-3">
              {/* 登録済みのチップ */}
              <div className="flex flex-wrap gap-2">
                {eatOptions.length > 0 ? (
                  eatOptions.map((opt) => (
                    <span key={opt} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 bg-white shadow-sm">
                      <span className="tabular-nums">{opt}</span>
                      <button
                        onClick={() => setEatOptions(eatOptions.filter((o) => o !== opt))}
                        className="ml-0.5 inline-grid place-items-center h-6 w-6 rounded-full border border-red-200 bg-red-50 text-red-600 text-sm hover:bg-red-100 hover:text-red-700 active:scale-[.98]"
                        aria-label={`${opt} を削除`}
                        title="削除"
                      >
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-gray-500 text-xs">まだ登録がありません。下の入力欄から追加してください。</span>
                )}
              </div>

              {/* 追加フォーム */}
              <div>
                <div className="flex items-center gap-2">
                  <input
                    ref={eatInputRef}
                    type="text"
                    defaultValue={newEatOption}
                    onInput={(e) => {
                      if (!isComposingEatOption) {
                        setNewEatOption((e.currentTarget as HTMLInputElement).value);
                      }
                    }}
                    onCompositionStart={() => setIsComposingEatOption(true)}
                    onCompositionEnd={(e) => {
                      setIsComposingEatOption(false);
                      setNewEatOption((e.currentTarget as HTMLInputElement).value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isComposingEatOption) {
                        e.preventDefault();
                        addEatOption();
                      }
                    }}
                    placeholder="例: ⭐︎ / ⭐︎⭐︎"
                    className={`border px-3 py-2 w-24 rounded text-center shadow-sm text-sm ${eatIsDup ? 'border-red-300 bg-red-50' : ''}`}
                    aria-invalid={eatIsDup}
                    aria-describedby="eat-help"
                  />
                  <button
                    onClick={addEatOption}
                    disabled={!eatCandidate || eatIsDup}
                    className={`px-3 py-2 rounded-md text-sm active:scale-[.99] ${!eatCandidate || eatIsDup ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white shadow-sm'}`}
                  >
                    追加
                  </button>
                </div>
                <p id="eat-help" className={`mt-1 text-xs ${eatIsDup ? 'text-red-600' : 'text-gray-500'}`}>
                  {eatIsDup ? 'この略称はすでに登録されています。' : 'Enter でも追加できます（2文字まで）。'}
                </p>
              </div>
            </div>
          </section>

          {/* 飲み放題 */}
          <section className="rounded-lg border bg-white shadow-sm overflow-hidden">
            <header className="px-3 py-2 bg-gray-50/80 border-b font-semibold">飲み放題</header>
            <div className="p-3 space-y-3">
              {/* 登録済みのチップ */}
              <div className="flex flex-wrap gap-2">
                {drinkOptions.length > 0 ? (
                  drinkOptions.map((opt) => (
                    <span key={opt} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 bg-white shadow-sm">
                      <span className="tabular-nums">{opt}</span>
                      <button
                        onClick={() => setDrinkOptions(drinkOptions.filter((o) => o !== opt))}
                        className="ml-0.5 inline-grid place-items-center h-6 w-6 rounded-full border border-red-200 bg-red-50 text-red-600 text-sm hover:bg-red-100 hover:text-red-700 active:scale-[.98]"
                        aria-label={`${opt} を削除`}
                        title="削除"
                      >
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-gray-500 text-xs">まだ登録がありません。下の入力欄から追加してください。</span>
                )}
              </div>

              {/* 追加フォーム */}
              <div>
                <div className="flex items-center gap-2">
                  <input
                    ref={drinkInputRef}
                    type="text"
                    defaultValue={newDrinkOption}
                    onInput={(e) => {
                      if (!isComposingDrinkOption) {
                        setNewDrinkOption((e.currentTarget as HTMLInputElement).value);
                      }
                    }}
                    onCompositionStart={() => setIsComposingDrinkOption(true)}
                    onCompositionEnd={(e) => {
                      setIsComposingDrinkOption(false);
                      setNewDrinkOption((e.currentTarget as HTMLInputElement).value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isComposingDrinkOption) {
                        e.preventDefault();
                        addDrinkOption();
                      }
                    }}
                    placeholder="例: スタ / プレ"
                    className={`border px-3 py-2 w-24 rounded text-center shadow-sm text-sm ${drinkIsDup ? 'border-red-300 bg-red-50' : ''}`}
                    aria-invalid={drinkIsDup}
                    aria-describedby="drink-help"
                  />
                  <button
                    onClick={addDrinkOption}
                    disabled={!drinkCandidate || drinkIsDup}
                    className={`px-3 py-2 rounded-md text-sm active:scale-[.99] ${!drinkCandidate || drinkIsDup ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white shadow-sm'}`}
                  >
                    追加
                  </button>
                </div>
                <p id="drink-help" className={`mt-1 text-xs ${drinkIsDup ? 'text-red-600' : 'text-gray-500'}`}>
                  {drinkIsDup ? 'この略称はすでに登録されています。' : 'Enter でも追加できます（2文字まで）。'}
                </p>
              </div>
            </div>
          </section>
        </div>
      </SubPageShell>
    );
  }

  return null;
}