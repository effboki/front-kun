'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  parseClipboardText,
  saveMapping,
  loadMapping,
  type ColumnMapping,
  type ImportedReservation,
} from '@/lib/clipboardImport';

const REQUIRED_FIELDS: (keyof ColumnMapping)[] = ['startAt', 'name', 'people'];
const FIELD_ORDER: (keyof ColumnMapping)[] = ['startAt', 'name', 'people', 'table', 'course', 'notes'];
const FIELD_LABEL: Record<keyof ColumnMapping, string> = {
  startAt: '開始',
  name: '名前',
  people: '人数',
  table: '卓',
  course: 'コース',
  notes: 'メモ',
};

type Props = {
  storeId: string;
  dayStartMs: number;
  onClose: () => void;
  onApply: (rows: ImportedReservation[]) => Promise<void> | void;
};

function isMappingComplete(mapping: ColumnMapping | null | undefined): boolean {
  if (!mapping) return false;
  return REQUIRED_FIELDS.every((field) => mapping[field] != null);
}

export default function ReservationImportModal({ storeId, dayStartMs, onClose, onApply }: Props) {
  const [inputValue, setInputValue] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [mapping, setMapping] = useState<ColumnMapping | null>(() => loadMapping(storeId));
  const [savePreference, setSavePreference] = useState(true);
  const [forceMapping, setForceMapping] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setMapping(loadMapping(storeId));
  }, [storeId]);

  const result = useMemo(() => {
    return parseClipboardText(previewText, {
      dayStartMs,
      storeId,
      mappingOverride: mapping,
      preferMapping: true,
    });
  }, [previewText, mapping, dayStartMs, storeId]);

  useEffect(() => {
    if (!previewText) return;
    if (!mapping && result.mappingUsed) {
      setMapping(result.mappingUsed);
    }
  }, [previewText, mapping, result.mappingUsed]);

  const hasPreview = previewText.trim().length > 0;
  const colCount = useMemo(() => {
    if (!hasPreview) return 0;
    return Math.max(0, ...result.previewRows.map((row) => row.length));
  }, [hasPreview, result.previewRows]);

  const showMappingUi = forceMapping || result.needMapping;
  const mappingComplete = isMappingComplete(mapping);
  const canApply = hasPreview && mappingComplete && result.rows.length > 0 && !applying;

  const handlePreview = () => {
    setPreviewText(inputValue);
  };

  const handleApply = async () => {
    if (!canApply) return;
    try {
      setApplying(true);
      if (savePreference && mappingComplete && mapping) {
        saveMapping(storeId, mapping);
      }
      await onApply(result.rows);
      onClose();
    } catch (error) {
      console.error('[ReservationImportModal] apply failed', error);
    } finally {
      setApplying(false);
    }
  };

  const headerNames = useMemo(() => {
    if (result.headers && result.headers.length > 0) return result.headers;
    return Array.from({ length: colCount }).map((_, index) => `列${index + 1}`);
  }, [result.headers, colCount]);

  const previewRows = hasPreview ? result.previewRows : [];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 px-3">
      <div className="w-full max-w-4xl max-h-[92vh] overflow-auto rounded-md bg-white shadow-xl p-4 space-y-4">
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
          使い方：予約一覧をコピー → この画面に貼り付け → プレビュー → 適用
        </div>

        <textarea
          className="h-40 w-full resize-vertical rounded border border-gray-300 p-2 font-mono text-sm"
          placeholder="TSV / CSV / スペース区切りの予約データを貼り付けてください"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-200"
            onClick={handlePreview}
          >
            プレビュー
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 text-sm font-semibold text-white ${
              canApply ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-emerald-300 cursor-not-allowed'
            }`}
            onClick={handleApply}
            disabled={!canApply}
          >
            {applying ? '適用中…' : '適用'}
          </button>
          <button
            type="button"
            className="ml-auto rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            onClick={onClose}
          >
            閉じる
          </button>
        </div>

        {hasPreview && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
              <span>読み取り: {result.rows.length} 件</span>
              <span>除外: {result.skipped} 件</span>
              {result.needMapping && (
                <span className="text-red-600">必須列（開始・名前・人数）が未設定です</span>
              )}
              {result.warnings.map((warning, index) => (
                <span key={index} className="text-amber-600">
                  {warning}
                </span>
              ))}
              {!result.needMapping && !forceMapping && (
                <button
                  type="button"
                  className="ml-auto text-sm text-blue-600 hover:underline"
                  onClick={() => setForceMapping(true)}
                >
                  列の対応付けを編集
                </button>
              )}
            </div>

            {(showMappingUi || !mappingComplete) && (
              <div className="rounded border border-gray-200 bg-gray-50 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    列の対応付け（必須: 開始 / 名前 / 人数）
                  </span>
                  {forceMapping && (
                    <button
                      type="button"
                      className="text-xs text-gray-500 hover:underline"
                      onClick={() => setForceMapping(false)}
                    >
                      閉じる
                    </button>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {FIELD_ORDER.map((field) => {
                    const isRequired = REQUIRED_FIELDS.includes(field);
                    if (field === 'notes') {
                      const selectedNotes = Array.isArray(mapping?.notes) ? mapping.notes : [];
                      const toggleNote = (index: number) => {
                        setMapping((prev) => {
                          const next: ColumnMapping = { ...(prev ?? {}) };
                          const prevList = Array.isArray(next.notes) ? [...next.notes] : [];
                          const pos = prevList.indexOf(index);
                          if (pos >= 0) {
                            prevList.splice(pos, 1);
                          } else {
                            prevList.push(index);
                          }
                          prevList.sort((a, b) => a - b);
                          if (prevList.length > 0) {
                            next.notes = prevList;
                          } else {
                            delete (next as any).notes;
                          }
                          return next;
                        });
                      };
                      const clearNotes = () => setMapping((prev) => {
                        if (!prev) return prev;
                        const next: ColumnMapping = { ...prev };
                        delete (next as any).notes;
                        return next;
                      });
                      const selectedLabels = selectedNotes.map((idx) => headerNames[idx] ?? `列${idx + 1}`);

                      return (
                        <div key={field} className="flex items-start gap-2 text-sm text-gray-700">
                          <span className="w-28 text-gray-500 mt-1">
                            {FIELD_LABEL[field]}
                            {isRequired && <span className="text-red-500">*</span>}
                          </span>
                          <div className="flex-1 space-y-2">
                            <div className="flex flex-wrap gap-2">
                              {Array.from({ length: colCount }).map((_, index) => {
                                const label = headerNames[index] ?? `列${index + 1}`;
                                const active = selectedNotes.includes(index);
                                return (
                                  <label
                                    key={index}
                                    className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs cursor-pointer select-none transition-colors ${
                                      active
                                        ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="sr-only"
                                      checked={active}
                                      onChange={() => toggleNote(index)}
                                    />
                                    <span>{label}</span>
                                  </label>
                                );
                              })}
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                              <button
                                type="button"
                                onClick={clearNotes}
                                className="text-blue-600 hover:underline"
                              >
                                クリア
                              </button>
                              <span>複数列を選択できます</span>
                              {selectedLabels.length > 0 && (
                                <span className="text-emerald-600">
                                  選択: {selectedLabels.join(', ')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    const current = mapping?.[field] as number | undefined;
                    const selectValue = current != null ? String(current) : '';

                    return (
                      <label key={field} className="flex items-center gap-2 text-sm text-gray-700">
                        <span className="w-28 text-gray-500">
                          {FIELD_LABEL[field]}
                          {isRequired && <span className="text-red-500">*</span>}
                        </span>
                        <select
                          className="flex-1 rounded border border-gray-300 bg-white px-2 py-1"
                          value={selectValue}
                          onChange={(event) => {
                            const value = event.target.value === '' ? undefined : Number(event.target.value);
                            setMapping((prev) => ({ ...(prev ?? {}), [field]: value }));
                          }}
                        >
                          <option value="">未設定</option>
                          {Array.from({ length: colCount }).map((_, index) => (
                            <option key={index} value={index}>
                              {headerNames[index] ?? `列${index + 1}`}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={savePreference}
                    onChange={(event) => setSavePreference(event.target.checked)}
                  />
                  マッピングを保存する
                </label>
              </div>
            )}

            {previewRows.length > 0 ? (
              <div className="overflow-auto rounded border border-gray-200">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      {headerNames.slice(0, colCount).map((header, index) => (
                        <th key={index} className="border border-gray-200 px-2 py-1 text-left font-medium text-gray-600">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, rowIndex) => (
                      <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        {Array.from({ length: colCount }).map((_, colIndex) => (
                          <td key={colIndex} className="border border-gray-200 px-2 py-1 text-gray-800">
                            {row[colIndex] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                プレビュー結果はここに表示されます（最大50件）。
              </div>
            )}
          </div>
        )}

        <div className="text-xs text-gray-500">
          読み取れない行は自動的に除外されます。貼り付け内容はそのままテキストとして表示し、HTMLタグは解釈しません。
        </div>
      </div>
    </div>
  );
}
