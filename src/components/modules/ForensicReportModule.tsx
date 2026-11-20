import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileCheck2,
  FileSearch,
  FileText,
  Gauge,
  GitCompareArrows,
  Image as ImageIcon,
  Network,
  ShieldAlert,
  Video,
  Volume2,
} from 'lucide-react';
import { useInvestigation } from '../../context/InvestigationContext';
import {
  buildStructuredForensicReport,
  type ForensicReportScope,
} from '../../utils/forensicReportBuilder';
import { generateForensicPdfReport } from '../../utils/pdfReportGenerator';

export function ForensicReportModule() {
  const {
    investigationId,
    evidenceList,
    teieResult,
    teieMapSnapshot,
    auditLogs,
    addAuditLog,
    openModuleWorkbench,
  } = useInvestigation();

  const [checkedHumanSteps, setCheckedHumanSteps] = useState<Record<number, boolean>>({});

  const report = useMemo(
    () =>
      buildStructuredForensicReport({
        investigationId,
        evidenceList,
        teieResult,
        auditLogs,
        teieMapDataUrl: teieMapSnapshot,
      }),
    [auditLogs, evidenceList, investigationId, teieMapSnapshot, teieResult],
  );

  const handleDownloadPdf = (scope: Exclude<ForensicReportScope, 'all'>) => {
    const scopedReport = buildStructuredForensicReport({
      investigationId,
      evidenceList,
      teieResult,
      auditLogs,
      teieMapDataUrl: teieMapSnapshot,
      scope,
    });
    generateForensicPdfReport({
      investigationId,
      evidenceList,
      teieResult,
      auditLogs,
      teieMapDataUrl: teieMapSnapshot,
      scope,
    });
    addAuditLog(
      scope,
      'EXPORT_PDF',
      `Exported ${scope.toUpperCase()} PDF report (${scopedReport.evidenceConfidences.length} evidence items, ${scopedReport.flaggedEvidence.length} flagged findings)`,
    );
  };

  const sectionReportButtons: Array<{
    scope: Exclude<ForensicReportScope, 'all'>;
    label: string;
    icon: typeof Volume2;
    disabled: boolean;
  }> = [
    {
      scope: 'audio',
      label: 'Audio PDF',
      icon: Volume2,
      disabled: !evidenceList.some((e) => e.modality === 'audio'),
    },
    {
      scope: 'text',
      label: 'Text PDF',
      icon: FileText,
      disabled: !evidenceList.some((e) => e.modality === 'text'),
    },
    {
      scope: 'video',
      label: 'Video PDF',
      icon: Video,
      disabled: !evidenceList.some((e) => e.modality === 'video'),
    },
    {
      scope: 'image',
      label: 'Image PDF',
      icon: ImageIcon,
      disabled: !evidenceList.some((e) => e.modality === 'image'),
    },
    {
      scope: 'teie',
      label: 'TEIE Engine PDF',
      icon: Network,
      disabled: !teieResult,
    },
  ];

  const toggleCheck = (idx: number) => {
    setCheckedHumanSteps((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const pillars = [
    {
      label: 'Flagged Evidence',
      detail: 'Suspicious region, frame, timestamp or audio segment',
      count: `${report.flaggedEvidence.length} flagged`,
      icon: AlertTriangle,
      accent: 'text-red-300',
    },
    {
      label: 'Indicator',
      detail: 'Observed forensic signal and why it was flagged',
      count: `${report.flaggedEvidence.reduce((sum, f) => sum + f.signals.length, 0)} signals`,
      icon: Activity,
      accent: 'text-amber-300',
    },
    {
      label: 'Cross-Modal Context',
      detail: 'Related evidence from other media or sources',
      count: `${report.crossModalContext.length} links`,
      icon: GitCompareArrows,
      accent: 'text-indigo-300',
    },
    {
      label: 'Confidence',
      detail: 'Calibrated score with limitations and uncertainty',
      count: `${report.evidenceConfidences.filter((c) => c.primaryScoreValue !== null).length} calibrated`,
      icon: Gauge,
      accent: 'text-emerald-300',
    },
    {
      label: 'Source Trace',
      detail: 'Input file, SHA-256 digest & evidence reference',
      count: `${report.evidenceConfidences.length} traced`,
      icon: FileSearch,
      accent: 'text-sky-300',
    },
    {
      label: 'Summary',
      detail: 'Findings, caveats and recommended human checks',
      count: `${report.summary.recommendedHumanChecks.length} checks`,
      icon: ClipboardCheck,
      accent: 'text-slate-200',
    },
  ];

  return (
    <section
      id="report"
      className="relative mx-auto w-full max-w-[1400px] px-5 pb-20 sm:px-8"
    >
      <div className="overflow-hidden rounded-3xl border border-white/[0.1] bg-[#0B1020] shadow-[0_24px_70px_rgba(0,0,0,0.5)]">
        {/* Executive Dossier Header */}
        <div className="flex flex-col justify-between gap-5 border-b border-white/[0.08] bg-gradient-to-r from-[#111830] to-[#0B1020] px-6 py-6 lg:flex-row lg:items-center sm:px-8">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <FileCheck2 className="h-5 w-5 text-emerald-300" />
              <h2 className="text-xl font-semibold tracking-[-0.02em] text-white sm:text-2xl">
                Forensic Report Dossier (PDF)
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {sectionReportButtons.map((btn) => {
              const Icon = btn.icon;
              return (
                <button
                  key={btn.scope}
                  type="button"
                  onClick={() => handleDownloadPdf(btn.scope)}
                  disabled={btn.disabled}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-[#0B0F19] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{btn.label}</span>
                  <Download className="h-3 w-3 opacity-70" />
                </button>
              );
            })}
          </div>
        </div>

        {/* 6-Pillar Report Coverage Strip */}
        <div className="grid grid-cols-2 gap-3 border-b border-white/[0.08] bg-[#080C17]/80 px-6 py-4 sm:grid-cols-3 lg:grid-cols-6 sm:px-8">
          {pillars.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div
                key={pillar.label}
                className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${pillar.accent}`}>
                    {pillar.label}
                  </span>
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${pillar.accent}`} />
                </div>
                <p className="mt-1.5 font-mono text-xs font-semibold text-white tabular-nums">
                  {pillar.count}
                </p>
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-400">
                  {pillar.detail}
                </p>
              </div>
            );
          })}
        </div>

        {/* Main Dossier Body */}
        <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-12 sm:p-8">
          {/* Left 8 Cols: Flagged Evidence + Cross-Modal Context + Source Trace Cards */}
          <div className="space-y-6 lg:col-span-8">
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3.5 text-xs text-amber-100">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <p className="leading-relaxed">
                All scores and classifications represent calibrated analytical indicators assisting human investigators—not legally established conclusions.
              </p>
            </div>

            {evidenceList.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.015] p-8 text-center text-xs text-slate-400">
                Upload and inspect audio, video, images, or text above to populate Flagged Evidence, Indicators, Cross-Modal Context, Calibrated Confidence, Source Trace, and PDF export.
              </div>
            ) : (
              <>
                {/* 1 & 2: FLAGGED EVIDENCE + INDICATOR + CONFIDENCE + SOURCE TRACE */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-white">
                      Flagged Evidence &amp; Observed Indicators ({report.flaggedEvidence.length})
                    </h3>
                    <span className="font-mono text-[11px] text-slate-400">
                      Regions · Frames · Timestamps · Audio Segments · Claims
                    </span>
                  </div>

                  {report.flaggedEvidence.length === 0 ? (
                    <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4 text-xs text-emerald-100">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                      <span>
                        No suspicious region, frame, timestamp, audio segment, or text contradiction has been flagged in the currently analyzed files.
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {report.flaggedEvidence.map((item) => (
                        <div
                          key={item.key}
                          className={`rounded-2xl border p-4 text-xs ${
                            item.severity === 'high'
                              ? 'border-red-500/35 bg-red-500/[0.06]'
                              : 'border-amber-500/30 bg-amber-500/[0.05]'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`font-mono text-[10px] font-semibold uppercase ${
                                  item.severity === 'high' ? 'text-red-300' : 'text-amber-300'
                                }`}
                              >
                                {item.kindLabel}
                              </span>
                              <span className="text-slate-600">·</span>
                              <span className="font-semibold text-white">{item.flaggedTarget}</span>
                            </div>

                            <span className="font-mono text-xs font-semibold text-white tabular-nums">
                              Confidence: {item.confidenceScore}/100
                            </span>
                          </div>

                          {/* Indicator signals + explanation */}
                          <div className="mt-2.5 space-y-1.5">
                            <p className="text-slate-200 leading-relaxed">
                              <span className="font-semibold text-indigo-200">Indicator: </span>
                              {item.whyFlagged}
                            </p>
                            <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
                              {item.signals.map((sig, i) => (
                                <span
                                  key={i}
                                  className="rounded border border-white/10 bg-[#080C17]/80 px-2 py-0.5 text-slate-300"
                                >
                                  {sig}
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* Cross-Modal Context + Uncertainty */}
                          <div className="mt-3 grid grid-cols-1 gap-2 border-t border-white/[0.08] pt-2.5 text-[11px] sm:grid-cols-2">
                            <div>
                              <span className="font-semibold text-indigo-300">Cross-Modal Context: </span>
                              <span className="text-slate-300">{item.crossModalContext[0]}</span>
                            </div>
                            <div>
                              <span className="font-semibold text-slate-300">Uncertainty &amp; Caveat: </span>
                              <span className="text-slate-400">{item.uncertaintyNote}</span>
                            </div>
                          </div>

                          {/* Source Trace Footer */}
                          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] pt-2 font-mono text-[10px] text-slate-400">
                            <span className="truncate">
                              Source Trace: {item.sourceTrace.evidenceId} · {item.sourceTrace.fileName} ({item.sourceTrace.artifactCoordinate}) · SHA-256 {item.sourceTrace.sha256.slice(0, 16)}...
                            </span>
                            <button
                              type="button"
                              onClick={() => openModuleWorkbench(item.sourceTrace.modality)}
                              className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-indigo-300 hover:text-indigo-200"
                            >
                              Review in {item.sourceTrace.modality.toUpperCase()}
                              <ArrowUpRight className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3: CROSS-MODAL CONTEXT */}
                <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-[#080C17] p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-white">
                      Cross-Modal Context ({report.crossModalContext.length})
                    </h3>
                    <span className="font-mono text-[11px] text-indigo-300">
                      TEIE &amp; Source Links
                    </span>
                  </div>

                  {report.crossModalContext.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      Upload evidence across multiple modalities and click &ldquo;Correlate All Evidence&rdquo; in TEIE above to map supporting and contradictory cross-media links.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {report.crossModalContext.map((cm) => (
                        <div
                          key={cm.id}
                          className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                            <span
                              className={
                                cm.relationType === 'contradictory'
                                  ? 'font-semibold text-red-300'
                                  : cm.relationType === 'supporting'
                                    ? 'font-semibold text-emerald-300'
                                    : cm.relationType === 'suspicious'
                                      ? 'font-semibold text-amber-300'
                                      : 'text-indigo-300'
                              }
                            >
                              {cm.relationType.toUpperCase()}
                            </span>
                            {cm.confidence !== null && (
                              <span className="text-slate-300 tabular-nums">{cm.confidence}/100</span>
                            )}
                          </div>
                          <p className="mt-1 font-medium text-white">{cm.pairLabel}</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{cm.finding}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 4 & 5: SOURCE TRACE, CONFIDENCE & CAPTURED VISUAL SNAPSHOTS */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-white">
                    Source Trace, Calibrated Confidence &amp; Visual Snapshots ({report.evidenceConfidences.length})
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {report.evidenceConfidences.map((ec) => (
                      <div
                        key={ec.evidenceId}
                        className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-xs"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                            <span className="font-semibold text-indigo-300">{ec.evidenceId}</span>
                            <span className="text-slate-400">
                              {ec.modality.toUpperCase()} · {ec.sourceTrace.sizeLabel}
                            </span>
                          </div>
                          <p className="mt-1 truncate font-medium text-white">{ec.fileName}</p>
                          <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                            SHA-256: {ec.sourceTrace.sha256}
                          </p>

                          <div className="mt-3 flex items-baseline justify-between border-t border-white/[0.07] pt-2.5">
                            <span className="text-[11px] text-slate-400">{ec.primaryScoreLabel}</span>
                            <span className="font-mono text-sm font-semibold text-white tabular-nums">
                              {ec.primaryScoreValue !== null ? `${ec.primaryScoreValue}/100` : ec.status.toUpperCase()}
                            </span>
                          </div>

                          {ec.secondaryMetrics.length > 0 && (
                            <div className="mt-2 grid grid-cols-2 gap-1.5 font-mono text-[10px] text-slate-300 tabular-nums">
                              {ec.secondaryMetrics.map((m) => (
                                <div key={m.label} className="flex justify-between rounded bg-white/[0.02] px-2 py-1">
                                  <span className="text-slate-500">{m.label}</span>
                                  <span>{m.value}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          <p className="mt-2.5 line-clamp-2 text-[11px] leading-relaxed text-slate-400">
                            {ec.uncertaintyAndLimitations}
                          </p>

                          {(ec.snapshots?.waveformDataUrl ||
                            ec.snapshots?.spectrogramDataUrl ||
                            ec.snapshots?.heatmapDataUrl ||
                            ec.snapshots?.videoFrameDataUrl) && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {ec.snapshots?.waveformDataUrl && (
                                <img
                                  src={ec.snapshots.waveformDataUrl}
                                  alt="Waveform snapshot"
                                  referrerPolicy="no-referrer"
                                  className="h-14 rounded border border-white/10 object-contain"
                                />
                              )}
                              {ec.snapshots?.spectrogramDataUrl && (
                                <img
                                  src={ec.snapshots.spectrogramDataUrl}
                                  alt="Mel spectrogram snapshot"
                                  referrerPolicy="no-referrer"
                                  className="h-14 rounded border border-white/10 object-contain"
                                />
                              )}
                              {ec.snapshots?.heatmapDataUrl && (
                                <img
                                  src={ec.snapshots.heatmapDataUrl}
                                  alt="Heatmap snapshot"
                                  referrerPolicy="no-referrer"
                                  className="h-14 rounded border border-white/10 object-contain"
                                />
                              )}
                              {ec.snapshots?.videoFrameDataUrl && (
                                <img
                                  src={ec.snapshots.videoFrameDataUrl}
                                  alt="Video frame snapshot"
                                  referrerPolicy="no-referrer"
                                  className="h-14 rounded border border-white/10 object-contain"
                                />
                              )}
                            </div>
                          )}
                        </div>

                        <div className="mt-3 border-t border-white/[0.06] pt-2 text-right">
                          <button
                            type="button"
                            onClick={() => openModuleWorkbench(ec.modality)}
                            className="inline-flex cursor-pointer items-center gap-1 font-mono text-[11px] text-indigo-300 hover:text-indigo-200"
                          >
                            Open Source Evidence
                            <ArrowUpRight className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Right 4 Cols: SUMMARY (Findings, Caveats, Recommended Human Checks) & Audit Trail */}
          <div className="space-y-5 rounded-2xl border border-white/[0.07] bg-[#080C17] p-5 lg:col-span-4">
            <div className="flex items-center justify-between border-b border-white/[0.07] pb-2.5 text-xs">
              <span className="font-semibold text-white">Executive Summary &amp; Human Review</span>
              <span className="font-mono text-[11px] text-indigo-300">{investigationId}</span>
            </div>

            <div className="rounded-xl border border-indigo-400/20 bg-indigo-500/[0.07] p-3 text-xs">
              <p className="font-mono text-[10px] uppercase tracking-wider text-indigo-300">
                Overall Dossier Status
              </p>
              <p className="mt-1 font-semibold text-white">{report.summary.headlineVerdict}</p>
            </div>

            {/* Summary Findings */}
            <div className="space-y-1.5 text-xs">
              <p className="font-semibold text-white">Findings</p>
              {report.summary.findings.length === 0 ? (
                <p className="text-slate-400">Awaiting module analysis.</p>
              ) : (
                <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-300">
                  {report.summary.findings.map((f, i) => (
                    <li key={i}>• {f}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* Caveats */}
            <div className="space-y-1.5 border-t border-white/[0.07] pt-3 text-xs">
              <p className="font-semibold text-amber-200">Caveats &amp; Limitations</p>
              <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-400">
                {report.summary.caveats.slice(0, 4).map((c, i) => (
                  <li key={i}>• {c}</li>
                ))}
              </ul>
            </div>

            {/* Recommended Human Checks */}
            <div className="space-y-2 border-t border-white/[0.07] pt-3 text-xs">
              <p className="font-semibold text-white">Recommended Human Checks</p>
              {report.summary.recommendedHumanChecks.length === 0 ? (
                <p className="text-[11px] text-slate-400">
                  Human review steps will populate automatically once evidence is analyzed.
                </p>
              ) : (
                <div className="space-y-2">
                  {report.summary.recommendedHumanChecks.map((check, idx) => (
                    <label
                      key={idx}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-[11px] leading-snug text-slate-300 transition-colors hover:border-white/15"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(checkedHumanSteps[idx])}
                        onChange={() => toggleCheck(idx)}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-indigo-400"
                      />
                      <span className={checkedHumanSteps[idx] ? 'line-through text-slate-500' : ''}>
                        {check}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Chain-of-Custody Audit Log */}
            <div className="border-t border-white/[0.07] pt-3">
              <p className="text-[11px] font-medium text-slate-400">
                Session Audit Trail ({auditLogs.length})
              </p>
              <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto font-mono text-[10px] text-slate-400">
                {auditLogs.length === 0 ? (
                  <p>No session events recorded yet.</p>
                ) : (
                  auditLogs.map((log, i) => (
                    <p key={i}>
                      {log.timestamp.slice(11, 19)} [{log.module.toUpperCase()}] {log.action}
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-white/[0.07] pt-6 text-xs text-slate-500 sm:flex-row sm:items-center">
        <span className="font-medium text-slate-300">TruthLens</span>
        <span>Calibrated Multimodal Forensics · © {new Date().getFullYear()}</span>
      </footer>
    </section>
  );
}
