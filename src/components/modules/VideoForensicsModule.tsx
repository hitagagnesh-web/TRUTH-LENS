import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Film,
  Loader2,
  Upload,
  Video,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useInvestigation } from '../../context/InvestigationContext';
import type { EvidenceRecord, VideoAnalysisResult } from '../../types/forensics';
import {
  arrayBufferToBase64,
  computeSha256,
  formatBytes,
  formatTimestamp,
  processVideoFrames,
} from '../../utils/forensicDsp';
import { generateModuleForensicPdfReport } from '../../utils/pdfReportGenerator';

export function VideoForensicsModule() {
  const {
    investigationId,
    evidenceList,
    teieResult,
    teieMapSnapshot,
    auditLogs,
    upsertEvidence,
    updateEvidence,
    addAuditLog,
    pendingDrop,
    clearPendingDrop,
    generateEvidenceId,
  } = useInvestigation();

  const videoEvidence = evidenceList.filter((e) => e.modality === 'video');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeRecord =
    videoEvidence.find((e) => e.id === selectedId) ?? videoEvidence[videoEvidence.length - 1] ?? null;

  const [selectedFrameIdx, setSelectedFrameIdx] = useState<number>(0);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  const handleAnalyzeVideo = useCallback(
    async (file: File) => {
      const id = generateEvidenceId('video');
      const objectUrl = URL.createObjectURL(file);
      const ext = file.name.split('.').pop()?.toUpperCase() || 'VIDEO';
      const uploadTimestamp = new Date().toISOString();
      const bufferPromise = file.arrayBuffer();
      const shaPromise = bufferPromise.then((buf) => computeSha256(buf));
      const framesPromise = processVideoFrames(file, 8).then(
        (data) => ({ ok: true as const, data }),
        (err) => ({ ok: false as const, err }),
      );
      const [buffer, sha256] = await Promise.all([bufferPromise, shaPromise]);

      const initial: EvidenceRecord = {
        id,
        modality: 'video',
        fileName: file.name,
        format: ext,
        mimeType: file.type || 'video/mp4',
        sizeBytes: file.size,
        uploadTimestamp,
        sha256,
        objectUrl,
        status: 'processing',
      };
      upsertEvidence(initial);
      setSelectedId(id);
      setSelectedFrameIdx(0);
      addAuditLog('video', 'UPLOAD', `Uploaded ${file.name} (${formatBytes(file.size)}) · SHA-256 ${sha256.slice(0, 12)}...`);

      try {
        let extracted: Awaited<ReturnType<typeof processVideoFrames>> | null = null;
        const framesOutcome = await framesPromise;
        if (framesOutcome.ok) {
          extracted = framesOutcome.data;
          updateEvidence(id, {
            durationSec: extracted.durationSec,
            dimensions: { width: extracted.width, height: extracted.height },
            videoFrames: extracted.frames,
          });
        } else {
          const decodeErr = framesOutcome.err;
          if (file.size > 18 * 1024 * 1024) {
            const reason =
              decodeErr instanceof Error ? decodeErr.message : 'Browser could not decode video.';
            throw new Error(
              `${reason} File exceeds 18 MB direct upload limit — please convert to standard H.264 MP4.`,
            );
          }
          addAuditLog(
            'video',
            'FALLBACK',
            `Browser frame extraction skipped (${decodeErr instanceof Error ? decodeErr.message : 'unsupported codec'}); sending video stream directly to server.`,
          );
        }

        const inferredMime =
          file.type ||
          (ext === 'MOV'
            ? 'video/quicktime'
            : ext === 'AVI'
              ? 'video/x-msvideo'
              : 'video/mp4');

        const requestBody = extracted
          ? {
              fileName: file.name,
              durationSec: extracted.durationSec,
              width: extracted.width,
              height: extracted.height,
              hasAudio: extracted.hasAudio,
              frames: extracted.frames.map((f) => ({
                index: f.index,
                timestamp: f.timestamp,
                imageBase64: f.imageBase64,
                temporalDelta: f.temporalDelta,
                sharpnessScore: f.sharpnessScore,
              })),
            }
          : {
              fileName: file.name,
              videoBase64: arrayBufferToBase64(buffer),
              mimeType: inferredMime,
            };

        const response = await fetch('/api/forensics/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        const rawText = await response.text();
        let payload: (VideoAnalysisResult & { error?: string }) | null = null;
        try {
          payload = JSON.parse(rawText) as VideoAnalysisResult & { error?: string };
        } catch {
          throw new Error(
            rawText.trim().slice(0, 220) || `Server returned HTTP ${response.status}`,
          );
        }

        if (!response.ok || payload?.error) {
          throw new Error(payload?.error || `Video forensic inference failed (HTTP ${response.status}).`);
        }

        const firstFlagged = payload.frameAssessments.find((f) => f.verdict === 'suspicious');
        const snapFrame = extracted
          ? extracted.frames.find((f) => f.index === firstFlagged?.index) ?? extracted.frames[0]
          : undefined;

        updateEvidence(id, {
          status: 'analyzed',
          videoResult: payload,
          snapshots: {
            ...initial.snapshots,
            videoFrameDataUrl: snapFrame?.dataUrl,
          },
        });
        addAuditLog(
          'video',
          'ANALYZED',
          `Overall suspicion ${payload.overallSuspicionScore}/100 · ${payload.frameAssessments.filter((f) => f.verdict === 'suspicious').length} suspicious frames`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Video analysis failed.';
        updateEvidence(id, { status: 'error', errorMessage: msg });
        addAuditLog('video', 'ERROR', msg);
      }
    },
    [addAuditLog, generateEvidenceId, updateEvidence, upsertEvidence],
  );

  useEffect(() => {
    if (pendingDrop && pendingDrop.moduleId === 'video') {
      const f = pendingDrop.file;
      clearPendingDrop();
      void handleAnalyzeVideo(f);
    }
  }, [pendingDrop, clearPendingDrop, handleAnalyzeVideo]);

  const jumpToTimestamp = (timestamp: number, frameIdx: number) => {
    setSelectedFrameIdx(frameIdx);
    if (videoElRef.current) {
      videoElRef.current.currentTime = timestamp;
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleAnalyzeVideo(file);
  };

  const result = activeRecord?.videoResult;
  const frames = activeRecord?.videoFrames ?? [];
  const suspiciousFrames = result?.frameAssessments.filter((f) => f.verdict === 'suspicious') ?? [];
  const activeFrame = frames[selectedFrameIdx] ?? frames[0];
  const activeAssessment = result?.frameAssessments.find((f) => f.index === activeFrame?.index);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-white/[0.08] pb-5 lg:flex-row lg:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <Video className="h-5 w-5 text-indigo-300" />
            <h3 className="text-lg font-semibold text-white">
              Video Forensics — Frame &amp; Temporal Coherence Inspector
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Supports MP4, MOV, AVI · Extracts interval frames, computes inter-frame pixel delta &amp; sharpness, and flags manipulated timestamps
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-[#0B0F19] transition-opacity hover:opacity-90 whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload Video File
          </button>
          <button
            type="button"
            disabled={!activeRecord || activeRecord.status !== 'analyzed'}
            onClick={() => {
              if (!activeRecord || activeRecord.status !== 'analyzed') return;
              generateModuleForensicPdfReport({
                investigationId,
                modality: 'video',
                evidenceList,
                teieResult,
                auditLogs,
                teieMapDataUrl: teieMapSnapshot,
                targetEvidenceId: activeRecord.id,
              });
              addAuditLog(
                'video',
                'EXPORT_PDF',
                `Downloaded Video Forensics PDF report for ${activeRecord.id} (${activeRecord.fileName})`,
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
          accept=".mp4,.mov,.avi,video/mp4,video/quicktime,video/x-msvideo,video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleAnalyzeVideo(file);
            e.target.value = '';
          }}
        />
      </div>

      {!activeRecord && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition-colors ${
            dragActive
              ? 'border-indigo-400 bg-indigo-500/12'
              : 'border-white/15 bg-white/[0.02] hover:border-white/30'
          }`}
        >
          <Film className="h-8 w-8 text-indigo-300" strokeWidth={1.5} />
          <p className="mt-3 text-sm font-medium text-white">
            Drag &amp; drop MP4, MOV, or AVI video here
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Extracts key frames for facial manipulation, temporal flicker, and AIGVDBench-calibrated verification
          </p>
        </div>
      )}

      {videoEvidence.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">Video Evidence:</span>
          {videoEvidence.map((ev) => (
            <button
              key={ev.id}
              type="button"
              onClick={() => setSelectedId(ev.id)}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors ${
                ev.id === activeRecord?.id
                  ? 'border-indigo-400/60 bg-indigo-500/20 text-white'
                  : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-white'
              }`}
            >
              {ev.id} · {ev.fileName}
            </button>
          ))}
        </div>
      )}

      {activeRecord && (
        <div className="space-y-6">
          {/* Metadata strip */}
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:grid-cols-5">
            <div>
              <p className="text-[11px] text-slate-400">Video Name</p>
              <p className="mt-0.5 truncate text-xs font-medium text-white">{activeRecord.fileName}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Duration</p>
              <p className="mt-0.5 font-mono text-xs text-white tabular-nums">
                {activeRecord.durationSec ? formatTimestamp(activeRecord.durationSec) : 'Reading...'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Resolution</p>
              <p className="mt-0.5 font-mono text-xs text-white tabular-nums">
                {activeRecord.dimensions
                  ? `${activeRecord.dimensions.width} × ${activeRecord.dimensions.height}`
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Size &amp; Format</p>
              <p className="mt-0.5 font-mono text-xs text-white tabular-nums">
                {formatBytes(activeRecord.sizeBytes)} · {activeRecord.format}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">SHA-256 Digest</p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-indigo-300">
                {activeRecord.sha256}
              </p>
            </div>
          </div>

          {activeRecord.status === 'processing' && (
            <div className="flex items-center gap-3 rounded-xl border border-indigo-400/30 bg-indigo-500/10 p-4 text-xs text-indigo-100">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-300" />
              Extracting interval frames, computing temporal pixel delta, and running frame-level deepfake inspection...
            </div>
          )}

          {activeRecord.status === 'error' && (
            <div className="flex items-center gap-3 rounded-xl border border-red-500/35 bg-red-500/10 p-4 text-xs text-red-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{activeRecord.errorMessage}</span>
            </div>
          )}

          {/* Integrated Video Player + Interactive Suspicious Frame Timeline */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-[#090E1B] p-4 lg:col-span-7">
              {activeRecord.objectUrl && (
                <video
                  ref={videoElRef}
                  src={activeRecord.objectUrl}
                  controls
                  data-lens-compact="true"
                  className="max-h-80 w-full rounded-xl bg-black object-contain"
                />
              )}

              {/* Flagged Timeline Marker Track */}
              {frames.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Suspicious Frame Timeline (Click marker to inspect timestamp)</span>
                    <span className="font-mono text-red-400 tabular-nums">
                      {suspiciousFrames.length} flagged frames
                    </span>
                  </div>
                  <div className="relative h-7 rounded-lg border border-white/[0.08] bg-white/[0.03]">
                    {frames.map((frame, i) => {
                      const assess = result?.frameAssessments.find((f) => f.index === frame.index);
                      const isSusp = assess?.verdict === 'suspicious';
                      const leftPct = ((frame.timestamp / Math.max(0.5, activeRecord.durationSec ?? 1)) * 100);
                      return (
                        <button
                          key={frame.index}
                          type="button"
                          onClick={() => jumpToTimestamp(frame.timestamp, i)}
                          title={`${formatTimestamp(frame.timestamp)} · ${assess?.verdict ?? 'extracted'}`}
                          style={{ left: `${Math.min(96, Math.max(2, leftPct))}%` }}
                          className={`absolute top-1/2 h-4 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-sm transition-transform hover:scale-125 ${
                            i === selectedFrameIdx ? 'ring-2 ring-white ' : ''
                          }${
                            isSusp
                              ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]'
                              : assess?.verdict === 'inconclusive'
                                ? 'bg-amber-400'
                                : 'bg-indigo-400/70'
                          }`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex justify-between font-mono text-[10px] text-slate-500 tabular-nums">
                    <span>00:00.00</span>
                    <span>{formatTimestamp((activeRecord.durationSec ?? frames[frames.length - 1]?.timestamp ?? 0) / 2)}</span>
                    <span>{formatTimestamp(activeRecord.durationSec ?? frames[frames.length - 1]?.timestamp ?? 0)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Frame Inspector + Calibrated Scores */}
            <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-[#0B1020] p-4 lg:col-span-5">
              {result && (
                <>
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <p className="text-[11px] text-slate-400">Genuine</p>
                      <p className="mt-1 font-mono text-xl font-semibold text-emerald-400 tabular-nums">
                        {result.calibratedGenuineScore}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <p className="text-[11px] text-slate-400">Manipulated</p>
                      <p className="mt-1 font-mono text-xl font-semibold text-red-400 tabular-nums">
                        {result.calibratedManipulatedScore}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <p className="text-[11px] text-slate-400">Suspicion</p>
                      <p className="mt-1 font-mono text-xl font-semibold text-amber-300 tabular-nums">
                        {result.overallSuspicionScore}
                      </p>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400">{result.calibrationNote}</p>
                </>
              )}

              {activeFrame ? (
                <div className="space-y-2 border-t border-white/[0.07] pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-white">
                      Selected Frame #{activeFrame.index + 1} · {formatTimestamp(activeFrame.timestamp)}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      Delta {activeFrame.temporalDelta} · Sharpness {activeFrame.sharpnessScore}
                    </span>
                  </div>
                  <img
                    src={activeFrame.dataUrl}
                    alt={`Video frame at ${formatTimestamp(activeFrame.timestamp)}`}
                    referrerPolicy="no-referrer"
                    className="h-36 w-full rounded-lg border border-white/10 bg-black object-contain"
                  />
                  {activeAssessment && (
                    <div
                      className={`rounded-xl border p-3 text-xs ${
                        activeAssessment.verdict === 'suspicious'
                          ? 'border-red-500/40 bg-red-500/10 text-red-100'
                          : 'border-white/[0.08] bg-white/[0.02] text-slate-300'
                      }`}
                    >
                      <p className="font-mono text-[11px] font-semibold">
                        {activeAssessment.verdict.toUpperCase()} · Suspicion {activeAssessment.calibratedSuspicion}/100
                      </p>
                      <p className="mt-1 leading-relaxed">{activeAssessment.findings}</p>
                    </div>
                  )}
                </div>
              ) : (
                result &&
                result.frameAssessments.length > 0 && (
                  <div className="space-y-2 border-t border-white/[0.07] pt-3">
                    <p className="text-[11px] text-slate-400">
                      Direct server video stream inspection ({result.frameAssessments.length} timeline checkpoints):
                    </p>
                    <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                      {result.frameAssessments.map((fa) => (
                        <div
                          key={fa.index}
                          className={`rounded-xl border p-2.5 text-xs ${
                            fa.verdict === 'suspicious'
                              ? 'border-red-500/40 bg-red-500/10 text-red-100'
                              : 'border-white/[0.08] bg-white/[0.02] text-slate-300'
                          }`}
                        >
                          <p className="font-mono text-[11px] font-semibold">
                            #{fa.index + 1} · {formatTimestamp(fa.timestamp)} · {fa.verdict.toUpperCase()} ({fa.calibratedSuspicion}/100)
                          </p>
                          <p className="mt-1 leading-relaxed">{fa.findings}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>

          {/* Extracted Frame Strip + Temporal Chart + Detailed Indicators */}
          {frames.length > 0 && (
            <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-[#0B1020] p-4">
              <p className="text-xs font-medium text-slate-300">
                Extracted Frame Sequence (Click any frame to jump video &amp; inspect)
              </p>
              <div className="flex gap-2.5 overflow-x-auto pb-2">
                {frames.map((frame, i) => {
                  const assess = result?.frameAssessments.find((f) => f.index === frame.index);
                  const isSusp = assess?.verdict === 'suspicious';
                  return (
                    <button
                      key={frame.index}
                      type="button"
                      onClick={() => jumpToTimestamp(frame.timestamp, i)}
                      className={`w-32 shrink-0 cursor-pointer overflow-hidden rounded-xl border text-left transition-all ${
                        i === selectedFrameIdx
                          ? 'border-white ring-1 ring-white/40'
                          : isSusp
                            ? 'border-red-500/60 bg-red-500/10'
                            : 'border-white/10 bg-white/[0.02] hover:border-white/25'
                      }`}
                    >
                      <img
                        src={frame.dataUrl}
                        alt={`Frame ${frame.index + 1}`}
                        referrerPolicy="no-referrer"
                        className="h-20 w-full object-cover"
                      />
                      <div className="p-2 font-mono text-[10px] tabular-nums">
                        <div className="flex items-center justify-between text-slate-200">
                          <span>{formatTimestamp(frame.timestamp)}</span>
                          {isSusp && <span className="text-red-400">FLAG</span>}
                        </div>
                        <p className="mt-0.5 text-slate-500">Δ {frame.temporalDelta}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {result && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="min-w-0 rounded-2xl border border-white/[0.08] bg-[#0B1020] p-5 lg:col-span-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-white">
                    Temporal Suspicion &amp; Pixel Delta Curve
                  </h4>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      Suspicion
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-indigo-400" />
                      Pixel Delta
                    </span>
                  </div>
                </div>
                <div className="mt-3 h-48 w-full min-w-0">
                  <ResponsiveContainer width="100%" height={192} minWidth={0}>
                    <AreaChart
                      data={[...result.frameAssessments]
                        .sort((a, b) => a.timestamp - b.timestamp || a.index - b.index)
                        .map((fa) => {
                          const fr = frames.find((f) => f.index === fa.index);
                          const rawDelta = fr?.temporalDelta ?? 0;
                          return {
                            time: `${fa.timestamp.toFixed(1)}s`,
                            timestampLabel: formatTimestamp(fa.timestamp),
                            suspicion: fa.calibratedSuspicion,
                            delta: Math.min(100, Number((rawDelta * 3).toFixed(1))),
                            rawDelta,
                            verdict: fa.verdict,
                          };
                        })}
                      margin={{ top: 8, right: 10, left: -16, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" vertical={false} />
                      <XAxis dataKey="time" stroke="#94A3B8" fontSize={10} tickLine={false} />
                      <YAxis domain={[0, 100]} stroke="#94A3B8" fontSize={10} tickLine={false} />
                      <ReferenceLine
                        y={60}
                        stroke="#EF4444"
                        strokeDasharray="4 3"
                        strokeOpacity={0.7}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0F172A',
                          border: '1px solid rgba(255,255,255,0.15)',
                          borderRadius: '8px',
                          fontSize: '12px',
                          color: '#F8FAFC',
                        }}
                        labelStyle={{ color: '#CBD5E1', fontFamily: 'JetBrains Mono, monospace' }}
                        itemStyle={{ color: '#F8FAFC' }}
                        labelFormatter={(_label, items) => {
                          const p = items?.[0]?.payload as { timestampLabel?: string; verdict?: string } | undefined;
                          return p ? `${p.timestampLabel} · ${(p.verdict ?? '').toUpperCase()}` : String(_label);
                        }}
                        formatter={(value, name, item) => {
                          if (name === 'Scaled Pixel Delta') {
                            const raw = (item?.payload as { rawDelta?: number } | undefined)?.rawDelta ?? 0;
                            return [`${value}/100 (raw Δ ${raw})`, name];
                          }
                          return [`${value}/100`, name];
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="suspicion"
                        stroke="#EF4444"
                        strokeWidth={2}
                        dot={{ r: 3, fill: '#EF4444', strokeWidth: 0 }}
                        activeDot={{ r: 5 }}
                        fill="rgba(239,68,68,0.22)"
                        name="Frame Suspicion"
                      />
                      <Area
                        type="monotone"
                        dataKey="delta"
                        stroke="#818CF8"
                        strokeWidth={2}
                        dot={{ r: 2.5, fill: '#818CF8', strokeWidth: 0 }}
                        activeDot={{ r: 4.5 }}
                        fill="rgba(129,140,248,0.15)"
                        name="Scaled Pixel Delta"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-[#0B1020] p-5 text-xs lg:col-span-6">
                <div className="flex items-start gap-2">
                  {suspiciousFrames.length > 0 ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  )}
                  <p className="leading-relaxed text-slate-200">{result.explanation}</p>
                </div>
                <div className="space-y-1.5 border-t border-white/[0.07] pt-3 text-slate-400">
                  <p><span className="text-indigo-200">AI-Generated Indicators:</span> {result.detectionFeatures.aiGeneratedIndicators}</p>
                  <p><span className="text-indigo-200">Face Manipulation:</span> {result.detectionFeatures.faceManipulation}</p>
                  <p><span className="text-indigo-200">Temporal Consistency:</span> {result.detectionFeatures.temporalInconsistencies}</p>
                  <p><span className="text-indigo-200">Textures &amp; Compositing:</span> {result.detectionFeatures.textureAndCompositing}</p>
                </div>
                <p className="border-t border-white/[0.07] pt-2 text-[11px] text-slate-500">
                  Benchmark &amp; Limitations: {result.architectureNotes} · {result.limitations}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
