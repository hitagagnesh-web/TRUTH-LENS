import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  Download,
  FileText,
  Loader2,
  Plus,
  SearchCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { useInvestigation } from '../../context/InvestigationContext';
import type { EvidenceRecord, TextAnalysisResult } from '../../types/forensics';
import {
  arrayBufferToBase64,
  computeLexicalOverlap,
  computeSha256,
  formatBytes,
} from '../../utils/forensicDsp';
import { generateModuleForensicPdfReport } from '../../utils/pdfReportGenerator';

export function TextForensicsModule() {
  const {
    investigationId,
    evidenceList,
    teieResult,
    teieMapSnapshot,
    auditLogs,
    upsertEvidence,
    updateEvidence,
    removeEvidence,
    addAuditLog,
    pendingDrop,
    clearPendingDrop,
    generateEvidenceId,
  } = useInvestigation();

  const textEvidence = useMemo(
    () => evidenceList.filter((e) => e.modality === 'text'),
    [evidenceList],
  );

  const docs = useMemo(
    () =>
      textEvidence.map((e) => ({
        id: e.id,
        title: e.fileName,
        content: e.textContent ?? '',
        format: e.format,
        sizeBytes: e.sizeBytes,
        sha256: e.sha256,
      })),
    [textEvidence],
  );

  const [pasteContent, setPasteContent] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const latestAnalyzed = [...textEvidence].reverse().find((e) => e.textResult)?.textResult ?? null;

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      setExtracting(true);
      setErrorMsg(null);
      try {
        const results = await Promise.all(
          files.map(async (file) => {
            const buffer = await file.arrayBuffer();
            const sha256 = await computeSha256(buffer);
            const ext = file.name.split('.').pop()?.toUpperCase() || 'TXT';
            let extractedText = '';

            if (ext === 'TXT' || ext === 'MD' || ext === 'CSV' || file.type === 'text/plain') {
              extractedText = new TextDecoder().decode(buffer).trim();
            } else {
              const fileBase64 = arrayBufferToBase64(buffer);
              const resp = await fetch('/api/forensics/extract-text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fileBase64,
                  mimeType: file.type,
                  fileName: file.name,
                }),
              });
              const rawText = await resp.text();
              let data: { text?: string; error?: string } | null = null;
              try {
                data = JSON.parse(rawText) as { text?: string; error?: string };
              } catch {
                throw new Error(
                  rawText.trim().slice(0, 220) || `Extraction server returned HTTP ${resp.status}`,
                );
              }
              if (!resp.ok || data?.error) {
                throw new Error(data?.error || `Failed to extract text from ${file.name}`);
              }
              extractedText = (data?.text ?? '').trim();
            }

            if (!extractedText) {
              throw new Error(
                `No readable text could be extracted from "${file.name}". Please copy and paste the text below.`,
              );
            }

            return { file, sha256, ext, extractedText };
          }),
        );

        for (const { file, sha256, ext, extractedText } of results) {
          const id = generateEvidenceId('text');
          const record: EvidenceRecord = {
            id,
            modality: 'text',
            fileName: file.name,
            format: ext,
            mimeType: file.type || 'text/plain',
            sizeBytes: file.size,
            uploadTimestamp: new Date().toISOString(),
            sha256,
            textContent: extractedText,
            status: 'uploaded',
          };
          upsertEvidence(record);
          addAuditLog('text', 'UPLOAD', `Extracted ${extractedText.length} chars from ${file.name}`);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Document extraction error.');
      } finally {
        setExtracting(false);
      }
    },
    [addAuditLog, generateEvidenceId, upsertEvidence],
  );

  useEffect(() => {
    if (pendingDrop && pendingDrop.moduleId === 'text') {
      const f = pendingDrop.file;
      clearPendingDrop();
      void handleUploadFiles([f]);
    }
  }, [pendingDrop, clearPendingDrop, handleUploadFiles]);

  const addPastedDocument = async (): Promise<typeof docs[number] | null> => {
    const trimmed = pasteContent.trim();
    if (!trimmed) return null;
    setErrorMsg(null);
    const id = generateEvidenceId('text');
    const sha256 = await computeSha256(trimmed);
    const title = `Pasted Text ${docs.length + 1}`;
    const sizeBytes = new Blob([trimmed]).size;

    upsertEvidence({
      id,
      modality: 'text',
      fileName: title,
      format: 'TEXT',
      mimeType: 'text/plain',
      sizeBytes,
      uploadTimestamp: new Date().toISOString(),
      sha256,
      textContent: trimmed,
      status: 'uploaded',
    });
    setPasteContent('');
    addAuditLog('text', 'ADDED_TEXT', `Added ${title} (${trimmed.length} chars)`);
    return { id, title, content: trimmed, format: 'TEXT', sizeBytes, sha256 };
  };

  const runTextAnalysis = async () => {
    let activeDocs = [...docs];
    if (pasteContent.trim()) {
      const added = await addPastedDocument();
      if (added) {
        activeDocs = [...activeDocs, added];
      }
    }
    if (activeDocs.length === 0) return;

    setIsAnalyzing(true);
    setErrorMsg(null);
    try {
      // Compare strictly across the provided text documents when multiple are supplied; no external sources
      const peerReferences =
        activeDocs.length > 1
          ? activeDocs.map((d) => ({
              id: d.id,
              sourceTitle: d.title,
              content: d.content,
            }))
          : [];

      const lexicalMetrics =
        activeDocs.length > 1
          ? computeLexicalOverlap(
              activeDocs.map((d) => ({ id: d.id, title: d.title, content: d.content })),
              peerReferences,
            )
          : {};

      const resp = await fetch('/api/forensics/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: activeDocs.map((d) => ({ id: d.id, title: d.title, content: d.content })),
          referenceCorpus: [],
          lexicalMetrics,
        }),
      });
      const rawText = await resp.text();
      let payload: (TextAnalysisResult & { error?: string }) | null = null;
      try {
        payload = JSON.parse(rawText) as TextAnalysisResult & { error?: string };
      } catch {
        throw new Error(
          rawText.trim().slice(0, 220) || `Server returned HTTP ${resp.status}`,
        );
      }
      if (!resp.ok || payload?.error) {
        throw new Error(payload?.error || `Text forensic analysis failed (HTTP ${resp.status}).`);
      }

      activeDocs.forEach((d) => {
        updateEvidence(d.id, { status: 'analyzed', textResult: payload });
      });
      addAuditLog(
        'text',
        'ANALYZED',
        `Analyzed ${activeDocs.length} text item(s) · Contradictions: ${payload.contradictions.length} · Claims: ${payload.suspiciousClaims.length}`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Text analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) void handleUploadFiles(files);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-white/[0.08] pb-5 lg:flex-row lg:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <FileText className="h-5 w-5 text-indigo-300" />
            <h3 className="text-lg font-semibold text-white">
              Text Forensics — Document &amp; Text Analysis
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Drop TXT, PDF, or DOCX files or copy &amp; paste text to generate results strictly from the text provided.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-[#0B0F19] transition-opacity hover:opacity-90 whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload TXT / PDF / DOCX
          </button>
          <button
            type="button"
            disabled={!latestAnalyzed}
            onClick={() => {
              if (!latestAnalyzed) return;
              generateModuleForensicPdfReport({
                investigationId,
                modality: 'text',
                evidenceList,
                teieResult,
                auditLogs,
                teieMapDataUrl: teieMapSnapshot,
              });
              addAuditLog(
                'text',
                'EXPORT_PDF',
                `Downloaded Text Forensics PDF report (${docs.length} document(s))`,
              );
            }}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-3.5 py-2 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-slate-500 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            Download Report
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) void handleUploadFiles(files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Focused Text Input: Drop TXT/PDF/DOCX OR Copy & Paste Text */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-[#0B1020] p-4 lg:col-span-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border border-dashed p-5 text-center transition-colors ${
              dragActive
                ? 'border-indigo-400 bg-indigo-500/12'
                : 'border-white/15 bg-white/[0.02] hover:border-white/30'
            }`}
          >
            {extracting ? (
              <div className="flex items-center justify-center gap-2 text-xs text-indigo-200">
                <Loader2 className="h-4 w-4 animate-spin" />
                Extracting document text...
              </div>
            ) : (
              <p className="text-xs text-slate-300">
                Drop TXT, PDF, or DOCX files here (or click to browse)
              </p>
            )}
          </div>

          <div className="space-y-2.5">
            <label className="block text-xs font-medium text-slate-300">
              Copy &amp; Paste Text
            </label>
            <textarea
              rows={6}
              value={pasteContent}
              onChange={(e) => setPasteContent(e.target.value)}
              placeholder="Copy and paste the text you want analyzed here..."
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void addPastedDocument()}
              disabled={!pasteContent.trim()}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-white/[0.12] disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Pasted Text
            </button>
          </div>
        </div>

        {/* Provided Texts List + Analyze Action */}
        <div className="flex flex-col justify-between space-y-4 rounded-2xl border border-white/[0.08] bg-[#0B1020] p-4 lg:col-span-6">
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-white">
              Provided Text ({docs.length})
            </h4>

            {docs.length === 0 ? (
              <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-slate-400">
                Drop a TXT, PDF, or DOCX file, or paste text on the left and click Analyze Text.
              </p>
            ) : (
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {docs.map((d) => (
                  <div key={d.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-xs">
                    <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                      <span className="truncate text-white">{d.id} · {d.title}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-slate-400">
                          {d.format} · {formatBytes(d.sizeBytes)} · {d.content.length} chars
                        </span>
                        <button
                          type="button"
                          onClick={() => removeEvidence(d.id)}
                          aria-label={`Remove ${d.title}`}
                          title="Remove"
                          className="cursor-pointer rounded p-1 text-slate-400 transition-colors hover:bg-red-500/15 hover:text-red-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 line-clamp-2 text-slate-400">{d.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => void runTextAnalysis()}
            disabled={(docs.length === 0 && !pasteContent.trim()) || isAnalyzing}
            className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-[#0B0F19] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
            {isAnalyzing ? 'Analyzing Provided Text...' : 'Analyze Text'}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/35 bg-red-500/10 p-4 text-xs text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Results Dashboard (Strictly based on the provided text) */}
      {latestAnalyzed && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 rounded-2xl border border-white/[0.08] bg-[#0B1020] p-5 sm:grid-cols-3">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
              <p className="text-[11px] text-slate-400">Text Contradiction Risk</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-red-400 tabular-nums">
                {latestAnalyzed.contradictionRiskScore}/100
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
              <p className="text-[11px] text-slate-400">Preliminary AI Style Indicator (Non-Probative)</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-amber-300 tabular-nums">
                {latestAnalyzed.preliminaryAiIndicatorScore}/100
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
              <p className="text-[11px] text-slate-400">Internal Overlap / Repetition</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-indigo-300 tabular-nums">
                {latestAnalyzed.overallSimilarityScore}/100
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#0B1020] p-5 text-xs">
            <h4 className="text-sm font-semibold text-white">Text Analysis Summary</h4>
            <p className="mt-2 leading-relaxed text-slate-300">{latestAnalyzed.summary}</p>
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200">
              AI Indicator Limitation: {latestAnalyzed.aiIndicatorDisclaimer}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Contradictions */}
            <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-[#0B1020] p-5">
              <h4 className="text-sm font-semibold text-white">
                Inconsistencies &amp; Contradictions ({latestAnalyzed.contradictions.length})
              </h4>
              {latestAnalyzed.contradictions.length === 0 ? (
                <p className="text-xs text-slate-400">
                  No direct contradictions detected within the provided text.
                </p>
              ) : (
                latestAnalyzed.contradictions.map((c, idx) => (
                  <div key={idx} className="space-y-2 rounded-xl border border-red-500/35 bg-red-500/[0.07] p-3.5 text-xs">
                    <div className="flex justify-between font-mono text-[11px] text-red-300">
                      <span>{c.docA} ↔ {c.docB}</span>
                      <span>{c.nliLabel.toUpperCase()} ({c.severity})</span>
                    </div>
                    <p className="text-slate-200">“{c.statementA}”</p>
                    <p className="text-red-200">vs. “{c.statementB}”</p>
                    <p className="text-slate-400">{c.explanation}</p>
                  </div>
                ))
              )}
            </div>

            {/* Claims Requiring Verification */}
            <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-[#0B1020] p-5">
              <h4 className="text-sm font-semibold text-white">
                Claims Requiring Verification ({latestAnalyzed.suspiciousClaims.length})
              </h4>
              {latestAnalyzed.suspiciousClaims.length === 0 ? (
                <p className="text-xs text-slate-400">
                  No unverified or questionable factual claims flagged in the provided text.
                </p>
              ) : (
                <div className="space-y-2">
                  {latestAnalyzed.suspiciousClaims.map((sc, i) => (
                    <div key={i} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-xs">
                      <p className="font-medium text-indigo-200">{sc.docTitle}: “{sc.passage}”</p>
                      <p className="mt-1 text-slate-400">{sc.reason} · Verify: {sc.verificationNeeded}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
