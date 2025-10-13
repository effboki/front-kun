'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { OPEN_EVENT, TOGGLE_EVENT } from '../global/SeatOptimizerButton';
import SeatOptimizerModal, { type SeatOptimizerPreviewRow } from './SeatOptimizerModal';
import { useSeatOptimizerSession } from '@/hooks/useSeatOptimizerSession';
import {
  buildSeatOptimizerRequest,
  deriveSeatOptimizerTables,
  mergeSeatOptimizerPrompts,
  parseSeatOptimizerResponse,
  type SeatOptimizerAssignment,
} from '@/lib/seatOptimizer';
import { startOfDayMs } from '@/lib/time';
import type { PendingTables, Reservation } from '@/types';
import type { StoreSettingsValue } from '@/types/settings';

type Props = {
  storeId: string;
  dayStartMs: number;
  settings: StoreSettingsValue;
  presetTables: string[];
  reservations: Reservation[];
  reservationsInitialized: boolean;
  commitTableMoves: (override?: PendingTables) => Promise<void>;
};

export default function SeatOptimizerController({
  storeId,
  dayStartMs,
  settings,
  presetTables,
  reservations,
  reservationsInitialized,
  commitTableMoves,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [previewRows, setPreviewRows] = useState<SeatOptimizerPreviewRow[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [rawText, setRawText] = useState<string>('');
  const [assignments, setAssignments] = useState<SeatOptimizerAssignment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { prompt, updatePrompt, clearPrompt, loading: sessionLoading, error: sessionError } =
    useSeatOptimizerSession(storeId, dayStartMs);

  const [sessionDraft, setSessionDraft] = useState<string>('');
  const [sessionSaving, setSessionSaving] = useState<boolean>(false);
  const sessionTimerRef = useRef<number | null>(null);

  const basePrompt = useMemo(() => settings?.seatOptimizer?.basePrompt ?? '', [settings?.seatOptimizer?.basePrompt]);
  const reservationsById = useMemo(() => {
    const map = new Map<string, Reservation>();
    reservations.forEach((r) => {
      if (r && typeof r.id === 'string') map.set(r.id, r);
    });
    return map;
  }, [reservations]);

  useEffect(() => {
    setSessionDraft(prompt ?? '');
  }, [prompt]);

  useEffect(() => {
    if (!sessionError) return;
    console.error('[SeatOptimizer] session subscription failed', sessionError);
    toast.error('席効率化の当日追記を取得できませんでした');
  }, [sessionError]);

  useEffect(() => {
    return () => {
      if (sessionTimerRef.current != null) {
        try {
          window.clearTimeout(sessionTimerRef.current);
        } catch {
          /* noop */
        }
        sessionTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, handleOpen as EventListener);
    return () => {
      window.removeEventListener(OPEN_EVENT, handleOpen as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const detail = { visible: !open };
    window.dispatchEvent(new CustomEvent(TOGGLE_EVENT, { detail }));
    return () => {
      window.dispatchEvent(new CustomEvent(TOGGLE_EVENT, { detail: { visible: false } }));
    };
  }, [open]);

  const handleSessionChange = useCallback(
    (value: string) => {
      setSessionDraft(value);
      if (sessionTimerRef.current != null) {
        try {
          window.clearTimeout(sessionTimerRef.current);
        } catch {
          /* noop */
        }
        sessionTimerRef.current = null;
      }
      setSessionSaving(true);
      sessionTimerRef.current = window.setTimeout(async () => {
        sessionTimerRef.current = null;
        try {
          await updatePrompt(value);
        } catch (err) {
          console.error('[SeatOptimizer] failed to save session prompt', err);
          toast.error('席効率化の当日追記を保存できませんでした');
        } finally {
          setSessionSaving(false);
        }
      }, 500) as unknown as number;
    },
    [updatePrompt],
  );

  const handleSessionClear = useCallback(async () => {
    if (sessionTimerRef.current != null) {
      try {
        window.clearTimeout(sessionTimerRef.current);
      } catch {
        /* noop */
      }
      sessionTimerRef.current = null;
    }
    setSessionDraft('');
    setSessionSaving(true);
    try {
      await clearPrompt();
    } catch (err) {
      console.error('[SeatOptimizer] failed to clear session prompt', err);
      toast.error('席効率化の当日追記を削除できませんでした');
    } finally {
      setSessionSaving(false);
    }
  }, [clearPrompt]);

  const clearPreview = useCallback(() => {
    setAssignments([]);
    setPreviewRows([]);
    setNotes([]);
    setRawText('');
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  const handlePreview = useCallback(async () => {
    if (loading) return;
    if (!reservationsInitialized) {
      toast.error('予約データを読み込み中です。少し待ってから再度お試しください。');
      return;
    }
    if (reservations.length === 0) {
      toast.error('対象となる予約がありません。');
      return;
    }

    const tables = deriveSeatOptimizerTables(settings, presetTables);
    const promptBundle = mergeSeatOptimizerPrompts(settings?.seatOptimizer, sessionDraft);
    const payload = buildSeatOptimizerRequest({
      reservations,
      tables,
      prompt: promptBundle,
      dayStartMs: startOfDayMs(dayStartMs),
    });

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/seat-optimizer/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, storeId }),
      });

      if (!response.ok) {
        const detailText = await response.text();
        let message = '席効率化のプレビューに失敗しました';
        if (detailText) {
          try {
            const parsed = JSON.parse(detailText);
            if (typeof parsed?.error === 'string') message = parsed.error;
            else if (typeof parsed?.detail === 'string') message = parsed.detail;
          } catch {
            message = detailText;
          }
        }
        setError(message || '席効率化のプレビューに失敗しました');
        return;
      }

      const data = await response.json();
      const raw = typeof data?.raw === 'string' ? data.raw : '';
      if (!raw.trim()) {
        setError('席効率化の提案を取得できませんでした');
        return;
      }

      const parsed = parseSeatOptimizerResponse(raw);
      const ordered = [...parsed.assignments].sort((a, b) => {
        const ra = reservationsById.get(a.reservationId);
        const rb = reservationsById.get(b.reservationId);
        const aStart = Number(ra?.startMs ?? 0);
        const bStart = Number(rb?.startMs ?? 0);
        return aStart - bStart;
      });

      setAssignments(ordered);
      setNotes(parsed.notes);
      setRawText(raw);
      setError(null);

      const rows: SeatOptimizerPreviewRow[] = ordered
        .map((assignment) => {
          const base = reservationsById.get(assignment.reservationId);
          if (!base) return null;
          const currentTables = Array.isArray(base.tables) && base.tables.length > 0
            ? base.tables.map((t) => String(t).trim()).filter(Boolean)
            : (base.table ? [String(base.table).trim()].filter(Boolean) : []);
          const guestsNum = Number(base.guests);
          const suggestedTables = Array.isArray(assignment.newTables)
            ? assignment.newTables.map((t) => t.trim()).filter(Boolean)
            : [];

          if (assignment.action === 'keep' && !assignment.reason && suggestedTables.length === 0) {
            return null;
          }

          const timeLabel =
            typeof base.time === 'string' && base.time.trim().length > 0
              ? base.time
              : (typeof base.timeHHmm === 'string' ? base.timeHHmm : '');

          const fallbackReason =
            assignment.reason ??
            (assignment.action === 'move'
              ? '人数に合わせて席の配置を調整します。'
              : assignment.action === 'split'
                ? '団体を複数のテーブルに分けてご案内します。'
                : assignment.action === 'cancel'
                  ? 'この予約を取り消す提案です。'
                  : undefined);

          return {
            id: assignment.reservationId,
            time: timeLabel || '',
            name: base.name ?? '',
            guests: Number.isFinite(guestsNum) ? guestsNum : 0,
            currentTables,
            suggestedTables,
            action: assignment.action,
            reason: fallbackReason,
            arrived: Boolean(base.arrived),
          } as SeatOptimizerPreviewRow;
        })
        .filter((row): row is SeatOptimizerPreviewRow => row !== null);

      setPreviewRows(rows);
      if (rows.length === 0 && parsed.notes.length === 0) {
        toast('席効率化の提案はありませんでした。');
      }
    } catch (err) {
      console.error('[SeatOptimizer] preview failed', err);
      setError('席効率化のプレビューに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [
    loading,
    reservationsInitialized,
    reservations.length,
    reservations,
    settings,
    presetTables,
    sessionDraft,
    dayStartMs,
    storeId,
    reservationsById,
  ]);

  const handleApply = useCallback(async () => {
    const actionable = assignments.filter((assignment) => {
      const normalizedTables = Array.isArray(assignment.newTables)
        ? assignment.newTables.map((t) => t.trim()).filter(Boolean)
        : [];
      return (assignment.action === 'move' || assignment.action === 'split') && normalizedTables.length > 0;
    });

    if (actionable.length === 0) {
      toast.error('適用できる移動提案がありません。');
      return;
    }

    const override: PendingTables = {};
    for (const assignment of actionable) {
      const base = reservationsById.get(assignment.reservationId);
      if (!base) continue;
      if (base.arrived || base.departed) continue;

      const oldTables = Array.isArray(base.tables) && base.tables.length > 0
        ? base.tables.map((t) => String(t).trim()).filter(Boolean)
        : (base.table ? [String(base.table).trim()].filter(Boolean) : []);

      const nextList = Array.from(
        new Set(assignment.newTables.map((t) => t.trim()).filter(Boolean)),
      );
      if (nextList.length === 0) continue;

      override[assignment.reservationId] = {
        old: oldTables[0] ?? '',
        nextList,
      };
    }

    const entries = Object.entries(override);
    if (entries.length === 0) {
      toast.error('適用対象の予約がありません。');
      return;
    }

    const counts: Record<string, number> = {};
    for (const [, value] of entries) {
      const key = value.nextList[0];
      if (!key) continue;
      counts[key] = (counts[key] || 0) + 1;
    }
    const dupTarget = Object.keys(counts).find((key) => counts[key] > 1);
    if (dupTarget) {
      toast.error(`同じ卓番号「${dupTarget}」への割り当てが重複しています。内容を調整してください。`);
      return;
    }

    setApplying(true);
    try {
      await commitTableMoves(override);
      clearPreview();
      setOpen(false);
    } catch (err) {
      console.error('[SeatOptimizer] apply failed', err);
      setError('席効率化の提案を適用できませんでした');
    } finally {
      setApplying(false);
    }
  }, [assignments, reservationsById, commitTableMoves, clearPreview]);

  return (
    <SeatOptimizerModal
      open={open}
      onClose={handleClose}
      basePrompt={basePrompt}
      sessionPrompt={sessionDraft}
      onSessionPromptChange={handleSessionChange}
      onClearSessionPrompt={handleSessionClear}
      onPreview={handlePreview}
      onApply={handleApply}
      onClearPreview={clearPreview}
      loading={loading || applying}
      sessionLoading={sessionLoading || sessionSaving}
      error={error}
      previewRows={previewRows}
      notes={notes}
      rawText={rawText}
    />
  );
}
