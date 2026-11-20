import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  GitCompareArrows,
  Loader2,
  Network,
  Trash2,
} from 'lucide-react';
import { useInvestigation } from '../../context/InvestigationContext';
import type { TeieAnalysisResult, TeieRelationship } from '../../types/forensics';
import { formatBytes } from '../../utils/forensicDsp';

export function TeieModule() {
  const {
    investigationId,
    evidenceList,
    removeEvidence,
    teieResult,
    setTeieResult,
    setTeieMapSnapshot,
    addAuditLog,
  } = useInvestigation();

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedRel, setSelectedRel] = useState<TeieRelationship | null>(null);
  const [activeCrossTab, setActiveCrossTab] = useState<
    'audioText' | 'videoText' | 'imageText' | 'imageVideo' | 'audioVideo' | 'collectiveTimeline'
  >('audioText');
  const svgRef = useRef<SVGSVGElement | null>(null);

  const runTeieCorrelation = async () => {
    if (evidenceList.length === 0) return;
    setLoading(true);
    setErrorMsg(null);
    setSelectedRel(null);

    try {
      const summaries = evidenceList.map((ev) => ({
        evidenceId: ev.id,
        fileName: ev.fileName,
        modality: ev.modality,
        format: ev.format,
        uploadTimestamp: ev.uploadTimestamp,
        sha256: ev.sha256,
        status: ev.status,
        audioSummary: ev.audioResult
          ? {
              genuine: ev.audioResult.calibratedGenuineScore,
              manipulated: ev.audioResult.calibratedManipulatedScore,
              suspicion: ev.audioResult.overallSuspicionScore,
              verdict: ev.audioResult.summaryVerdict,
              transcript: ev.audioResult.transcript,
              suspiciousSegments: ev.audioResult.segments.filter((s) => s.verdict === 'suspicious'),
            }
          : undefined,
        videoSummary: ev.videoResult
          ? {
              genuine: ev.videoResult.calibratedGenuineScore,
              manipulated: ev.videoResult.calibratedManipulatedScore,
              suspicion: ev.videoResult.overallSuspicionScore,
              explanation: ev.videoResult.explanation,
              flaggedFrames: ev.videoResult.frameAssessments.filter((f) => f.verdict === 'suspicious'),
            }
          : undefined,
        imageSummary: ev.imageResult
          ? {
              authenticity: ev.imageResult.calibratedAuthenticityScore,
              suspicion: ev.imageResult.manipulationSuspicionScore,
              classification: ev.imageResult.primaryClassification,
              sceneDescription: ev.imageResult.sceneDescription,
              suspiciousRegions: ev.imageResult.suspiciousRegions,
              metadata: ev.imageMetadata,
            }
          : undefined,
        textSummary: ev.textContent
          ? {
              excerpt: ev.textContent.slice(0, 1200),
              analysis: ev.textResult,
            }
          : undefined,
      }));

      const resp = await fetch('/api/forensics/teie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          investigationId,
          evidenceSummaries: summaries,
        }),
      });
      const rawText = await resp.text();
      let payload: (TeieAnalysisResult & { error?: string }) | null = null;
      try {
        payload = JSON.parse(rawText) as TeieAnalysisResult & { error?: string };
      } catch {
        throw new Error(
          rawText.trim().slice(0, 220) || `Server returned HTTP ${resp.status}`,
        );
      }
      if (!resp.ok || payload?.error) {
        throw new Error(payload?.error || `TEIE correlation failed (HTTP ${resp.status}).`);
      }

      setTeieResult(payload);
      if (payload.relationships.length > 0) {
        setSelectedRel(payload.relationships[0]);
      }
      addAuditLog(
        'teie',
        'CORRELATED',
        `Correlated ${evidenceList.length} evidence items · ${payload.relationships.length} cross-modal links`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'TEIE error.');
    } finally {
      setLoading(false);
    }
  };

  const nodePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    const n = evidenceList.length;
    if (n === 0) return map;
    if (n === 1) {
      map.set(evidenceList[0].id.toUpperCase(), { x: 340, y: 165 });
      return map;
    }
    if (n === 2) {
      map.set(evidenceList[0].id.toUpperCase(), { x: 165, y: 165 });
      map.set(evidenceList[1].id.toUpperCase(), { x: 515, y: 165 });
      return map;
    }

    const cx = 340;
    const cy = 165;
    const rx = 215;
    const ry = 108;

    evidenceList.forEach((ev, idx) => {
      const angle = (idx / n) * Math.PI * 2 - Math.PI / 2;
      map.set(ev.id.toUpperCase(), {
        x: cx + rx * Math.cos(angle),
        y: cy + ry * Math.sin(angle),
      });
    });
    return map;
  }, [evidenceList]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !teieResult) return;
    try {
      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(svg);
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 680;
        canvas.height = 330;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#090E1B';
          ctx.fillRect(0, 0, 680, 330);
          ctx.drawImage(img, 0, 0, 680, 330);
          setTeieMapSnapshot(canvas.toDataURL('image/png'));
        }
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } catch {
      // ignore snapshot failure
    }
  }, [teieResult, setTeieMapSnapshot]);

  const relColor = (type: TeieRelationship['relationshipType']) => {
    if (type === 'supporting') return '#10B981';
    if (type === 'contradictory') return '#EF4444';
    if (type === 'suspicious') return '#F59E0B';
    return '#94A3B8';
  };

  const crossModalTabs: Array<{
    key: typeof activeCrossTab;
    label: string;
  }> = [
    { key: 'audioText', label: 'Audio + Text' },
    { key: 'videoText', label: 'Video + Text' },
    { key: 'imageText', label: 'Image + Text' },
    { key: 'imageVideo', label: 'Image + Video' },
    { key: 'audioVideo', label: 'Audio + Video' },
    { key: 'collectiveTimeline', label: 'Collective' },
  ];

  return (
    <section
      id="teie"
      className="relative mx-auto w-full max-w-[1400px] px-5 py-14 sm:px-8"
    >
      <div className="overflow-hidden rounded-3xl border border-indigo-400/20 bg-gradient-to-b from-[#0E162B] to-[#090D1A] shadow-[0_28px_80px_rgba(0,0,0,0.55)]">
        {/* Top Command Header */}
        <div className="flex flex-col justify-between gap-5 border-b border-white/[0.08] bg-white/[0.02] px-6 py-6 lg:flex-row lg:items-center sm:px-8">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Network className="h-5 w-5 text-indigo-300" />
              <h2 className="text-xl font-semibold tracking-[-0.02em] text-white sm:text-2xl">
                TEIE — Multimodal Evidence Intelligence Engine
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="text-right font-mono text-xs tabular-nums">
              <p className="text-slate-400">Investigation ID</p>
              <p className="text-indigo-200">{investigationId}</p>
            </div>
            <button
              type="button"
              onClick={() => void runTeieCorrelation()}
              disabled={evidenceList.length === 0 || loading}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-indigo-500 px-5 py-2.5 text-xs font-semibold text-white shadow-[0_8px_24px_rgba(99,102,241,0.35)] transition-colors hover:bg-indigo-400 disabled:opacity-40 whitespace-nowrap"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompareArrows className="h-4 w-4" />}
              {loading ? 'Fusing Evidence...' : 'Correlate All Evidence'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-white/[0.08] lg:grid-cols-12 lg:divide-x lg:divide-y-0">
          {/* Left Column: Evidence Chain-of-Custody Locker */}
          <div className="p-6 lg:col-span-5">
            <div className="mb-4 flex items-center justify-between text-xs">
              <span className="font-semibold text-white">
                Evidence Chain ({evidenceList.length} Uploaded)
              </span>
              <span className="font-mono text-[11px] text-slate-400">SHA-256 Verified</span>
            </div>

            {evidenceList.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.015] p-8 text-center text-xs text-slate-400">
                Upload audio, video, images, or text in the module row above. Every file automatically registers here with its SHA-256 hash and module findings.
              </div>
            ) : (
              <div className="max-h-[360px] space-y-2.5 overflow-y-auto pr-1">
                {evidenceList.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#0B1020] p-3.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        <span className="font-semibold text-indigo-300">{ev.id}</span>
                        <span className="text-slate-500">·</span>
                        <span className="uppercase text-slate-300">{ev.modality}</span>
                        <span className="text-slate-500">·</span>
                        <span
                          className={
                            ev.status === 'analyzed'
                              ? 'text-emerald-400'
                              : ev.status === 'error'
                                ? 'text-red-400'
                                : 'text-amber-300'
                          }
                        >
                          {ev.status}
                        </span>
                      </div>
                      <p className="mt-1 truncate font-medium text-white">{ev.fileName}</p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                        {formatBytes(ev.sizeBytes)} · {ev.sha256}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeEvidence(ev.id)}
                      aria-label={`Remove ${ev.fileName}`}
                      className="cursor-pointer rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {errorMsg && (
              <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-red-500/35 bg-red-500/10 p-3.5 text-xs text-red-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* Right Column: Interactive Evidence Relationship Map & Cross-Modal Matrix */}
          <div className="p-6 lg:col-span-7">
            {!teieResult ? (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-2xl border border-white/[0.06] bg-[#070B15]/70 p-8 text-center">
                <Network className="h-8 w-8 text-indigo-400/70" strokeWidth={1.5} />
                <p className="mt-3 text-sm font-medium text-white">
                  Multimodal Relationship Graph Ready
                </p>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-400">
                  Run TEIE correlation once evidence is uploaded to visualize supporting links, contradictions, suspicious overlaps, and human review recommendations.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-white">
                    Interactive Evidence Relationship Map
                  </span>
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="text-emerald-400">Supporting</span>
                    <span className="text-red-400">Contradictory</span>
                    <span className="text-amber-300">Suspicious</span>
                    <span className="text-slate-400">Inconclusive</span>
                  </div>
                </div>

                <svg
                  ref={svgRef}
                  viewBox="0 0 680 330"
                  className="w-full rounded-2xl border border-white/[0.08] bg-[#060913]"
                >
                  {(() => {
                    // Group relationships between the same node pair so parallel links offset smoothly
                    const pairGroups = new Map<string, TeieRelationship[]>();
                    teieResult.relationships.forEach((rel) => {
                      const a = rel.sourceId.toUpperCase();
                      const b = rel.targetId.toUpperCase();
                      const pairKey = a < b ? `${a}__${b}` : `${b}__${a}`;
                      const list = pairGroups.get(pairKey) ?? [];
                      list.push(rel);
                      pairGroups.set(pairKey, list);
                    });

                    return teieResult.relationships.map((rel) => {
                      const a = rel.sourceId.toUpperCase();
                      const b = rel.targetId.toUpperCase();
                      const p1 = nodePositions.get(a);
                      const p2 = nodePositions.get(b);
                      if (!p1 || !p2) return null;

                      const pairKey = a < b ? `${a}__${b}` : `${b}__${a}`;
                      const siblings = pairGroups.get(pairKey) ?? [rel];
                      const sibIdx = siblings.indexOf(rel);
                      const totalSibs = siblings.length;
                      const offsetIdx = sibIdx - (totalSibs - 1) / 2;

                      const dx = p2.x - p1.x;
                      const dy = p2.y - p1.y;
                      const len = Math.max(1, Math.hypot(dx, dy));
                      // Canonical perpendicular direction so reverse-direction edges curve oppositely
                      const nx = (a < b ? -dy : dy) / len;
                      const ny = (a < b ? dx : -dx) / len;
                      const curveOffset = offsetIdx * 48;

                      const cx = (p1.x + p2.x) / 2 + nx * curveOffset;
                      const cy = (p1.y + p2.y) / 2 + ny * curveOffset;
                      // Quadratic Bezier point at t=0.5
                      const mx = 0.25 * p1.x + 0.5 * cx + 0.25 * p2.x;
                      const my = 0.25 * p1.y + 0.5 * cy + 0.25 * p2.y;

                      const color = relColor(rel.relationshipType);
                      const isSel = selectedRel?.id === rel.id;

                      return (
                        <g
                          key={rel.id}
                          onClick={() => setSelectedRel(rel)}
                          className="cursor-pointer"
                        >
                          <path
                            d={`M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`}
                            fill="none"
                            stroke={color}
                            strokeWidth={isSel ? 3.5 : 2}
                            strokeDasharray={
                              rel.relationshipType === 'contradictory'
                                ? '6 4'
                                : rel.relationshipType === 'suspicious'
                                  ? '3 3'
                                  : undefined
                            }
                            strokeOpacity={isSel ? 1 : 0.78}
                          />
                          <rect
                            x={Math.max(6, Math.min(554, mx - 60))}
                            y={Math.max(6, Math.min(302, my - 11))}
                            width={120}
                            height={22}
                            rx={6}
                            fill="#0F172A"
                            stroke={color}
                            strokeWidth={isSel ? 1.5 : 0.8}
                          />
                          <text
                            x={Math.max(66, Math.min(614, mx))}
                            y={Math.max(20.5, Math.min(316.5, my + 3.5))}
                            textAnchor="middle"
                            fill="#F8FAFC"
                            fontSize="9.5"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {rel.label.slice(0, 19)}
                          </text>
                        </g>
                      );
                    });
                  })()}

                  {evidenceList.map((ev) => {
                    const pos = nodePositions.get(ev.id.toUpperCase());
                    if (!pos) return null;
                    return (
                      <g key={ev.id}>
                        <circle
                          cx={pos.x}
                          cy={pos.y}
                          r={30}
                          fill="#121A38"
                          stroke="#818CF8"
                          strokeWidth={1.6}
                        />
                        <text
                          x={pos.x}
                          y={pos.y - 2}
                          textAnchor="middle"
                          fill="#FFFFFF"
                          fontSize="10"
                          fontWeight="600"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {ev.id}
                        </text>
                        <text
                          x={pos.x}
                          y={pos.y + 11}
                          textAnchor="middle"
                          fill="#A5B4FC"
                          fontSize="8.5"
                        >
                          {ev.modality.toUpperCase()}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                {selectedRel && (
                  <div className="rounded-xl border border-indigo-400/35 bg-indigo-500/10 p-4 text-xs">
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <span className="text-white">
                        {selectedRel.sourceId} ↔ {selectedRel.targetId}
                      </span>
                      <span style={{ color: relColor(selectedRel.relationshipType) }}>
                        {selectedRel.relationshipType.toUpperCase()} ({selectedRel.confidence}/100)
                      </span>
                    </div>
                    <p className="mt-1 font-medium text-indigo-100">{selectedRel.label}</p>
                    <p className="mt-1 leading-relaxed text-slate-200">{selectedRel.detailedFinding}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Cross-Modal Synthesis Strip (when analyzed) */}
        {teieResult && (
          <div className="grid grid-cols-1 gap-6 border-t border-white/[0.08] bg-[#080C18] p-6 lg:grid-cols-12 sm:p-8">
            <div className="space-y-3 lg:col-span-7">
              <div className="flex flex-wrap items-center gap-1.5">
                {crossModalTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveCrossTab(tab.key)}
                    className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      activeCrossTab === tab.key
                        ? 'bg-white text-[#0B0F19]'
                        : 'bg-white/[0.04] text-slate-400 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-xs leading-relaxed text-slate-200">
                {teieResult.crossModalFindings[activeCrossTab]}
              </div>
              <p className="text-[11px] text-slate-500">
                Fusion Note: {teieResult.fusionMethodologyNote}
              </p>
            </div>

            <div className="space-y-3 text-xs lg:col-span-5">
              <div className="flex items-baseline justify-between border-b border-white/[0.07] pb-2">
                <span className="text-slate-400">Preliminary Calibrated Index</span>
                <span className="font-mono text-xl font-semibold text-indigo-300 tabular-nums">
                  {teieResult.preliminaryCalibratedIndex}/100
                </span>
              </div>
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 font-semibold text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Supporting Evidence ({teieResult.supportingEvidence.length})
                </p>
                {teieResult.supportingEvidence.slice(0, 2).map((s, i) => (
                  <p key={i} className="text-slate-300">· {s}</p>
                ))}
              </div>
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 font-semibold text-red-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Contradictions ({teieResult.contradictoryEvidence.length})
                </p>
                {teieResult.contradictoryEvidence.slice(0, 2).map((c, i) => (
                  <p key={i} className="text-slate-300">· {c}</p>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
