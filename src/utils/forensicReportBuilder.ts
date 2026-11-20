import type {
  AuditLogEntry,
  EvidenceRecord,
  MediaModuleId,
  TeieAnalysisResult,
} from '../types/forensics';
import { formatBytes, formatTimestamp } from './forensicDsp';

export interface SourceTraceRef {
  evidenceId: string;
  fileName: string;
  modality: MediaModuleId;
  format: string;
  sizeLabel: string;
  uploadTimestamp: string;
  sha256: string;
  artifactCoordinate: string;
}

export interface FlaggedEvidenceEntry {
  key: string;
  severity: 'high' | 'medium' | 'low';
  kindLabel: string;
  /** 1. FLAGGED EVIDENCE: Suspicious region, frame, timestamp, audio segment, or text claim */
  flaggedTarget: string;
  /** 2. INDICATOR: Observed signal and why it was flagged */
  signals: string[];
  whyFlagged: string;
  /** 3. CROSS-MODAL CONTEXT: Related evidence from other media or sources */
  crossModalContext: string[];
  /** 4. CONFIDENCE: Calibrated score with limitations and uncertainty */
  confidenceScore: number;
  uncertaintyNote: string;
  /** 5. SOURCE TRACE: Input file and evidence reference for review */
  sourceTrace: SourceTraceRef;
}

export interface EvidenceConfidenceEntry {
  evidenceId: string;
  fileName: string;
  modality: MediaModuleId;
  status: EvidenceRecord['status'];
  primaryScoreLabel: string;
  primaryScoreValue: number | null;
  secondaryMetrics: Array<{ label: string; value: string }>;
  uncertaintyAndLimitations: string;
  sourceTrace: SourceTraceRef;
  snapshots?: EvidenceRecord['snapshots'];
}

export interface CrossModalContextEntry {
  id: string;
  relationType: 'supporting' | 'contradictory' | 'suspicious' | 'inconclusive' | 'linked';
  pairLabel: string;
  finding: string;
  confidence: number | null;
  references: string;
}

export interface ReportSummarySection {
  headlineVerdict: string;
  findings: string[];
  caveats: string[];
  recommendedHumanChecks: string[];
}

export type ForensicReportScope = 'all' | 'audio' | 'text' | 'video' | 'image' | 'teie';

export interface StructuredForensicReport {
  investigationId: string;
  scope: ForensicReportScope;
  generatedAt: string;
  flaggedEvidence: FlaggedEvidenceEntry[];
  evidenceConfidences: EvidenceConfidenceEntry[];
  crossModalContext: CrossModalContextEntry[];
  summary: ReportSummarySection;
  auditLogs: AuditLogEntry[];
  teieMapDataUrl?: string;
}

export function buildStructuredForensicReport(params: {
  investigationId: string;
  evidenceList: EvidenceRecord[];
  teieResult: TeieAnalysisResult | null;
  auditLogs: AuditLogEntry[];
  teieMapDataUrl?: string;
  scope?: ForensicReportScope;
}): StructuredForensicReport {
  const {
    investigationId,
    evidenceList,
    teieResult,
    auditLogs,
    teieMapDataUrl,
    scope = 'all',
  } = params;
  const generatedAt = new Date().toISOString();

  const isSingleModalityScope =
    scope === 'audio' || scope === 'text' || scope === 'video' || scope === 'image';
  const scopedEvidenceList = isSingleModalityScope
    ? evidenceList.filter((ev) => ev.modality === scope)
    : evidenceList;
  const scopedAuditLogs =
    scope === 'all' ? auditLogs : auditLogs.filter((log) => log.module === scope);
  const scopedEvidenceIds = new Set(scopedEvidenceList.map((ev) => ev.id.toUpperCase()));

  // Helper: find cross-modal context for a given evidenceId from TEIE & other uploaded records
  const getCrossModalForEvidence = (ev: EvidenceRecord): string[] => {
    const notes: string[] = [];
    if (teieResult) {
      const matchingRels = teieResult.relationships.filter(
        (r) =>
          r.sourceId.toUpperCase() === ev.id.toUpperCase() ||
          r.targetId.toUpperCase() === ev.id.toUpperCase(),
      );
      matchingRels.forEach((rel) => {
        const peer =
          rel.sourceId.toUpperCase() === ev.id.toUpperCase() ? rel.targetId : rel.sourceId;
        notes.push(
          `TEIE [${rel.relationshipType.toUpperCase()} · ${rel.confidence}/100] with ${peer}: ${rel.detailedFinding}`,
        );
      });
    }

    if (ev.modality === 'audio' && ev.audioResult?.transcript) {
      const textDocs = evidenceList.filter((e) => e.modality === 'text' && e.textResult);
      if (textDocs.length > 0) {
        notes.push(
          `Audio transcript auto-linked to Text Forensics (${textDocs.map((t) => t.id).join(', ')}) for lexical & NLI comparison.`,
        );
      }
    }

    if (notes.length === 0) {
      const otherModalities = Array.from(
        new Set(evidenceList.filter((e) => e.id !== ev.id).map((e) => `${e.id} (${e.modality.toUpperCase()})`)),
      );
      if (otherModalities.length > 0 && !teieResult) {
        notes.push(
          `Pending TEIE cross-modal correlation against ${otherModalities.slice(0, 4).join(', ')}.`,
        );
      } else if (otherModalities.length === 0) {
        notes.push('Single-modality upload; no secondary media or external source uploaded for cross-checking.');
      } else {
        notes.push('No direct cross-modal anomaly link flagged in TEIE for this item.');
      }
    }
    return notes;
  };

  const flaggedEvidence: FlaggedEvidenceEntry[] = [];
  const evidenceConfidences: EvidenceConfidenceEntry[] = [];
  const seenTextFindings = new Set<string>();

  for (const ev of (scope === 'teie' ? [] : scopedEvidenceList)) {
    const baseTrace: SourceTraceRef = {
      evidenceId: ev.id,
      fileName: ev.fileName,
      modality: ev.modality,
      format: ev.format,
      sizeLabel: formatBytes(ev.sizeBytes),
      uploadTimestamp: ev.uploadTimestamp,
      sha256: ev.sha256,
      artifactCoordinate: 'Full file',
    };
    const crossNotes = getCrossModalForEvidence(ev);

    if (ev.audioResult) {
      const ar = ev.audioResult;
      const flaggedSegs = ar.segments.filter(
        (s) => s.verdict === 'suspicious' || s.verdict === 'inconclusive',
      );
      flaggedSegs.forEach((seg) => {
        const range = `${formatTimestamp(seg.startTime)} – ${formatTimestamp(seg.endTime)}`;
        flaggedEvidence.push({
          key: `${ev.id}-seg-${seg.index}`,
          severity: seg.verdict === 'suspicious' ? 'high' : 'medium',
          kindLabel: 'AUDIO SEGMENT',
          flaggedTarget: `Segment #${seg.index + 1} (${range})`,
          signals:
            seg.detectedSignals.length > 0
              ? seg.detectedSignals
              : [seg.verdict.toUpperCase(), `AASIST ${ar.modelIndicators.aasistScore}/100`],
          whyFlagged: seg.reason || ar.explanation,
          crossModalContext: crossNotes,
          confidenceScore: seg.calibratedSuspicion,
          uncertaintyNote: `${ar.calibrationNote} ${ar.limitations}`.trim(),
          sourceTrace: {
            ...baseTrace,
            artifactCoordinate: `Window ${range} (Segment #${seg.index + 1})`,
          },
        });
      });

      evidenceConfidences.push({
        evidenceId: ev.id,
        fileName: ev.fileName,
        modality: ev.modality,
        status: ev.status,
        primaryScoreLabel: 'Overall Suspicion',
        primaryScoreValue: ar.overallSuspicionScore,
        secondaryMetrics: [
          { label: 'Genuine', value: `${ar.calibratedGenuineScore}/100` },
          { label: 'Manipulated', value: `${ar.calibratedManipulatedScore}/100` },
          { label: 'AASIST', value: `${ar.modelIndicators.aasistScore}/100` },
          { label: 'RawNet2', value: `${ar.modelIndicators.rawnet2Score}/100` },
        ],
        uncertaintyAndLimitations: `${ar.calibrationNote} Limitations: ${ar.limitations}`,
        sourceTrace: baseTrace,
        snapshots: ev.snapshots,
      });
    } else if (ev.videoResult) {
      const vr = ev.videoResult;
      const flaggedFrames = vr.frameAssessments.filter(
        (f) => f.verdict === 'suspicious' || f.verdict === 'inconclusive',
      );
      flaggedFrames.forEach((fa) => {
        const tsLabel = formatTimestamp(fa.timestamp);
        flaggedEvidence.push({
          key: `${ev.id}-frame-${fa.index}`,
          severity: fa.verdict === 'suspicious' ? 'high' : 'medium',
          kindLabel: 'VIDEO FRAME / TIMESTAMP',
          flaggedTarget: `Frame #${fa.index + 1} at ${tsLabel}`,
          signals:
            fa.detectedTags.length > 0
              ? fa.detectedTags
              : [fa.verdict.toUpperCase(), 'Temporal Coherence'],
          whyFlagged: fa.findings || vr.explanation,
          crossModalContext: crossNotes,
          confidenceScore: fa.calibratedSuspicion,
          uncertaintyNote: `${vr.calibrationNote} ${vr.limitations}`.trim(),
          sourceTrace: {
            ...baseTrace,
            artifactCoordinate: `Frame #${fa.index + 1} @ ${tsLabel}`,
          },
        });
      });

      evidenceConfidences.push({
        evidenceId: ev.id,
        fileName: ev.fileName,
        modality: ev.modality,
        status: ev.status,
        primaryScoreLabel: 'Overall Suspicion',
        primaryScoreValue: vr.overallSuspicionScore,
        secondaryMetrics: [
          { label: 'Genuine', value: `${vr.calibratedGenuineScore}/100` },
          { label: 'Manipulated', value: `${vr.calibratedManipulatedScore}/100` },
          { label: 'Flagged Frames', value: `${flaggedFrames.length}/${vr.frameAssessments.length}` },
        ],
        uncertaintyAndLimitations: `${vr.calibrationNote} Limitations: ${vr.limitations}`,
        sourceTrace: baseTrace,
        snapshots: ev.snapshots,
      });
    } else if (ev.imageResult) {
      const ir = ev.imageResult;
      ir.suspiciousRegions.forEach((reg) => {
        const boxStr = `[${reg.box2d.join(', ')}]`;
        flaggedEvidence.push({
          key: `${ev.id}-reg-${reg.id}`,
          severity: reg.severity,
          kindLabel: 'IMAGE REGION',
          flaggedTarget: `${reg.label} · Box ${boxStr}`,
          signals: [
            `${reg.severity.toUpperCase()} SEVERITY`,
            ir.primaryClassification,
            `ELA Mean ${ev.imageMetadata?.elaMeanResidual ?? 0}`,
          ],
          whyFlagged: reg.rationale || ir.detectionExplanation,
          crossModalContext: crossNotes,
          confidenceScore: reg.confidence,
          uncertaintyNote: ir.limitations,
          sourceTrace: {
            ...baseTrace,
            artifactCoordinate: `Region "${reg.label}" box2d=${boxStr}`,
          },
        });
      });

      // If overall suspicion is elevated (>=45) even without bounding boxes, surface the image assessment
      if (ir.suspiciousRegions.length === 0 && ir.manipulationSuspicionScore >= 45) {
        flaggedEvidence.push({
          key: `${ev.id}-global`,
          severity: ir.manipulationSuspicionScore >= 65 ? 'high' : 'medium',
          kindLabel: 'IMAGE GLOBAL SIGNAL',
          flaggedTarget: `Full frame (${ev.dimensions ? `${ev.dimensions.width}×${ev.dimensions.height}` : ev.format})`,
          signals: [
            ir.primaryClassification,
            `AI-Gen Cue ${ir.aiGenerationIndicatorScore}/100`,
            `Splicing Cue ${ir.traditionalForgeryIndicatorScore}/100`,
          ],
          whyFlagged: ir.detectionExplanation,
          crossModalContext: crossNotes,
          confidenceScore: ir.manipulationSuspicionScore,
          uncertaintyNote: ir.limitations,
          sourceTrace: {
            ...baseTrace,
            artifactCoordinate: 'Full-frame spectral & metadata inspection',
          },
        });
      }

      evidenceConfidences.push({
        evidenceId: ev.id,
        fileName: ev.fileName,
        modality: ev.modality,
        status: ev.status,
        primaryScoreLabel: 'Manipulation Suspicion',
        primaryScoreValue: ir.manipulationSuspicionScore,
        secondaryMetrics: [
          { label: 'Authenticity', value: `${ir.calibratedAuthenticityScore}/100` },
          { label: 'AI-Gen Cue', value: `${ir.aiGenerationIndicatorScore}/100` },
          { label: 'Splicing Cue', value: `${ir.traditionalForgeryIndicatorScore}/100` },
          { label: 'Regions', value: String(ir.suspiciousRegions.length) },
        ],
        uncertaintyAndLimitations: ir.limitations,
        sourceTrace: baseTrace,
        snapshots: ev.snapshots,
      });
    } else if (ev.textResult) {
      const tr = ev.textResult;

      tr.contradictions.forEach((c, idx) => {
        const sigKey = `c:${c.docA}|${c.docB}|${c.statementA}|${c.statementB}`;
        if (seenTextFindings.has(sigKey)) return;
        seenTextFindings.add(sigKey);
        flaggedEvidence.push({
          key: `text-contradiction-${ev.id}-${idx}`,
          severity: c.severity.toLowerCase().includes('high') ? 'high' : 'medium',
          kindLabel: 'TEXT CONTRADICTION (NLI)',
          flaggedTarget: `${c.docA} ↔ ${c.docB}`,
          signals: [c.nliLabel.toUpperCase(), `${c.severity} severity`],
          whyFlagged: `"${c.statementA}" vs. "${c.statementB}" — ${c.explanation}`,
          crossModalContext: crossNotes,
          confidenceScore: tr.contradictionRiskScore,
          uncertaintyNote: `${tr.aiIndicatorDisclaimer} ${tr.limitations}`.trim(),
          sourceTrace: {
            ...baseTrace,
            artifactCoordinate: `Claim pair: ${c.docA} vs ${c.docB}`,
          },
        });
      });

      tr.plagiarismMatches.forEach((m, idx) => {
        const sigKey = `m:${m.docTitle}|${m.sourceReference}|${m.matchedPassage}`;
        if (seenTextFindings.has(sigKey)) return;
        seenTextFindings.add(sigKey);
        flaggedEvidence.push({
          key: `text-match-${ev.id}-${idx}`,
          severity: m.similarityScore >= 70 ? 'high' : 'medium',
          kindLabel: 'SOURCE OVERLAP / MATCH',
          flaggedTarget: `${m.docTitle} → ${m.sourceReference}`,
          signals: [`${m.similarityScore}% Lexical/Semantic Overlap`],
          whyFlagged: `"${m.matchedPassage}" — ${m.explanation}`,
          crossModalContext: crossNotes,
          confidenceScore: m.similarityScore,
          uncertaintyNote: tr.limitations,
          sourceTrace: {
            ...baseTrace,
            artifactCoordinate: `Matched passage vs ${m.sourceReference}`,
          },
        });
      });

      tr.suspiciousClaims.forEach((sc, idx) => {
        const sigKey = `s:${sc.docTitle}|${sc.passage}`;
        if (seenTextFindings.has(sigKey)) return;
        seenTextFindings.add(sigKey);
        flaggedEvidence.push({
          key: `text-claim-${ev.id}-${idx}`,
          severity: 'medium',
          kindLabel: 'CLAIM REQUIRING REVIEW',
          flaggedTarget: `${sc.docTitle}: "${sc.passage.slice(0, 72)}${sc.passage.length > 72 ? '...' : ''}"`,
          signals: ['Unverified Claim', sc.verificationNeeded],
          whyFlagged: sc.reason,
          crossModalContext: crossNotes,
          confidenceScore: tr.contradictionRiskScore,
          uncertaintyNote: `${tr.aiIndicatorDisclaimer} ${tr.limitations}`.trim(),
          sourceTrace: {
            ...baseTrace,
            artifactCoordinate: `Document "${sc.docTitle}"`,
          },
        });
      });

      evidenceConfidences.push({
        evidenceId: ev.id,
        fileName: ev.fileName,
        modality: ev.modality,
        status: ev.status,
        primaryScoreLabel: 'Contradiction Risk',
        primaryScoreValue: tr.contradictionRiskScore,
        secondaryMetrics: [
          { label: 'Similarity', value: `${tr.overallSimilarityScore}/100` },
          { label: 'Contradictions', value: String(tr.contradictions.length) },
          { label: 'AI Style (Non-Probative)', value: `${tr.preliminaryAiIndicatorScore}/100` },
        ],
        uncertaintyAndLimitations: `${tr.aiIndicatorDisclaimer} Limitations: ${tr.limitations}`,
        sourceTrace: baseTrace,
      });
    } else {
      // Uploaded / processing / error record
      evidenceConfidences.push({
        evidenceId: ev.id,
        fileName: ev.fileName,
        modality: ev.modality,
        status: ev.status,
        primaryScoreLabel: 'Analysis Status',
        primaryScoreValue: null,
        secondaryMetrics: [
          { label: 'Format', value: ev.format },
          { label: 'Size', value: formatBytes(ev.sizeBytes) },
        ],
        uncertaintyAndLimitations:
          ev.errorMessage || 'Awaiting module forensic analysis execution.',
        sourceTrace: baseTrace,
        snapshots: ev.snapshots,
      });
    }
  }

  // For TEIE Engine scope, populate evidence confidence / source trace summary for all correlated items without duplicating single-modality snapshots
  if (scope === 'teie') {
    for (const ev of scopedEvidenceList) {
      const baseTrace: SourceTraceRef = {
        evidenceId: ev.id,
        fileName: ev.fileName,
        modality: ev.modality,
        format: ev.format,
        sizeLabel: formatBytes(ev.sizeBytes),
        uploadTimestamp: ev.uploadTimestamp,
        sha256: ev.sha256,
        artifactCoordinate: 'TEIE correlated artifact',
      };
      const primaryScore =
        ev.audioResult?.overallSuspicionScore ??
        ev.videoResult?.overallSuspicionScore ??
        ev.imageResult?.manipulationSuspicionScore ??
        ev.textResult?.contradictionRiskScore ??
        null;
      evidenceConfidences.push({
        evidenceId: ev.id,
        fileName: ev.fileName,
        modality: ev.modality,
        status: ev.status,
        primaryScoreLabel:
          ev.modality === 'text' ? 'Contradiction Risk' : 'Overall Suspicion',
        primaryScoreValue: primaryScore,
        secondaryMetrics: [
          { label: 'Format', value: ev.format },
          { label: 'Size', value: formatBytes(ev.sizeBytes) },
        ],
        uncertaintyAndLimitations:
          teieResult?.modelLimitations ||
          'Cross-modal correlation indicator assisting human investigators.',
        sourceTrace: baseTrace,
      });
    }
  }

  // Sort flagged evidence by severity then confidence descending
  const sevWeight = { high: 3, medium: 2, low: 1 };
  flaggedEvidence.sort(
    (a, b) => sevWeight[b.severity] - sevWeight[a.severity] || b.confidenceScore - a.confidenceScore,
  );

  // Build Cross-Modal Context section
  const crossModalContext: CrossModalContextEntry[] = [];
  if (teieResult) {
    teieResult.relationships
      .filter(
        (rel) =>
          !isSingleModalityScope ||
          scopedEvidenceIds.has(rel.sourceId.toUpperCase()) ||
          scopedEvidenceIds.has(rel.targetId.toUpperCase()),
      )
      .forEach((rel) => {
        crossModalContext.push({
          id: rel.id,
          relationType: rel.relationshipType,
          pairLabel: `${rel.sourceId} ↔ ${rel.targetId} · ${rel.label}`,
          finding: rel.detailedFinding,
          confidence: rel.confidence,
          references: rel.referencedTimestampsOrRegions || 'Full artifacts',
        });
      });

    if (scope === 'all' || scope === 'teie') {
      const tabLabels: Array<[keyof TeieAnalysisResult['crossModalFindings'], string]> = [
        ['audioVideo', 'Audio ↔ Video'],
        ['audioText', 'Audio ↔ Text'],
        ['videoText', 'Video ↔ Text'],
        ['imageText', 'Image ↔ Text'],
        ['imageVideo', 'Image ↔ Video'],
        ['collectiveTimeline', 'Collective Timeline'],
      ];
      tabLabels.forEach(([key, label]) => {
        const val = teieResult.crossModalFindings[key]?.trim();
        if (val && !/no .* uploaded|not applicable|n\/a|none/i.test(val.slice(0, 32))) {
          crossModalContext.push({
            id: `cm-${key}`,
            relationType: 'linked',
            pairLabel: label,
            finding: val,
            confidence: teieResult.preliminaryCalibratedIndex,
            references: 'TEIE Cross-Modal Matrix',
          });
        }
      });
    }
  } else if (scope === 'all' || scope === 'audio' || scope === 'text') {
    // Surface auto-linked audio transcripts -> text evidence even before TEIE is run
    const audioWithTranscript = evidenceList.filter((e) => e.modality === 'audio' && e.audioResult?.transcript);
    const textDocs = evidenceList.filter((e) => e.modality === 'text');
    audioWithTranscript.forEach((a) => {
      if (textDocs.length > 0) {
        crossModalContext.push({
          id: `auto-link-${a.id}`,
          relationType: 'linked',
          pairLabel: `${a.id} (Audio Transcript) ↔ ${textDocs.map((t) => t.id).join(', ')} (Text)`,
          finding: `Transcribed speech from ${a.fileName} is shared as reference input for lexical overlap and NLI contradiction checks.`,
          confidence: null,
          references: 'Run TEIE Correlation for full multimodal link graph',
        });
      }
    });
  }

  // Build Summary: Findings, Caveats, and Recommended Human Checks
  const findings: string[] = [];
  if ((scope === 'all' || scope === 'teie') && teieResult?.overallInvestigationAssessment) {
    findings.push(teieResult.overallInvestigationAssessment);
  }
  if (scope === 'teie' && teieResult) {
    teieResult.supportingEvidence.forEach((s) => findings.push(`Supporting: ${s}`));
    teieResult.contradictoryEvidence.forEach((c) => findings.push(`Contradiction: ${c}`));
  }
  const highRiskCount = flaggedEvidence.filter((f) => f.severity === 'high').length;
  if (scope !== 'teie' && scopedEvidenceList.length > 0) {
    findings.push(
      `Inspected ${scopedEvidenceList.length} ${isSingleModalityScope ? `${scope} ` : ''}evidence item(s); surfaced ${flaggedEvidence.length} flagged finding(s) (${highRiskCount} high-severity).`,
    );
  }
  if (scope !== 'teie') {
    scopedEvidenceList.forEach((ev) => {
      if (ev.audioResult) {
        findings.push(`[${ev.id}] Audio: ${ev.audioResult.summaryVerdict} (Suspicion ${ev.audioResult.overallSuspicionScore}/100).`);
      } else if (ev.videoResult) {
        findings.push(`[${ev.id}] Video: Suspicion ${ev.videoResult.overallSuspicionScore}/100 across ${ev.videoResult.frameAssessments.length} checkpoints.`);
      } else if (ev.imageResult) {
        findings.push(`[${ev.id}] Image: ${ev.imageResult.primaryClassification} (Suspicion ${ev.imageResult.manipulationSuspicionScore}/100).`);
      } else if (ev.textResult) {
        findings.push(`[${ev.id}] Text: Contradiction Risk ${ev.textResult.contradictionRiskScore}/100, Similarity ${ev.textResult.overallSimilarityScore}/100.`);
      }
    });
  }

  const caveats: string[] = [
    'All calibrated scores and classifications are analytical decision-support indicators, not legally conclusive proof of forgery or authenticity.',
  ];
  if ((scope === 'all' || scope === 'teie') && teieResult?.modelLimitations) {
    caveats.push(`TEIE Limitation: ${teieResult.modelLimitations}`);
  }
  const uniqueModalityCaveats = new Set<string>();
  if (scope !== 'teie') {
    scopedEvidenceList.forEach((ev) => {
      const lim =
        ev.audioResult?.limitations ||
        ev.videoResult?.limitations ||
        ev.imageResult?.limitations ||
        ev.textResult?.limitations;
      if (lim) uniqueModalityCaveats.add(lim);
    });
  }
  uniqueModalityCaveats.forEach((c) => caveats.push(c));

  const recommendedHumanChecks: string[] = [];
  if ((scope === 'all' || scope === 'teie') && teieResult?.humanReviewRecommendations?.length) {
    recommendedHumanChecks.push(...teieResult.humanReviewRecommendations);
  }
  if (
    (scope === 'all' || scope === 'audio') &&
    scopedEvidenceList.some((e) => e.audioResult?.segments.some((s) => s.verdict !== 'genuine'))
  ) {
    recommendedHumanChecks.push(
      'Audibly review each red-highlighted waveform segment alongside background room-tone continuity and original lossless recordings.',
    );
  }
  if (
    (scope === 'all' || scope === 'video') &&
    scopedEvidenceList.some((e) => e.videoResult?.frameAssessments.some((f) => f.verdict !== 'genuine'))
  ) {
    recommendedHumanChecks.push(
      'Step frame-by-frame around flagged video timestamps to inspect facial boundary blending, blink/lip sync, and shadow consistency.',
    );
  }
  if (
    (scope === 'all' || scope === 'image') &&
    scopedEvidenceList.some((e) => e.imageResult && (e.imageResult.suspiciousRegions.length > 0 || e.imageResult.manipulationSuspicionScore >= 45))
  ) {
    recommendedHumanChecks.push(
      'Inspect raw camera EXIF/C2PA signatures and compare flagged bounding-box regions against original uncompressed camera source files.',
    );
  }
  if (
    (scope === 'all' || scope === 'text') &&
    scopedEvidenceList.some((e) => e.textResult && (e.textResult.contradictions.length > 0 || e.textResult.plagiarismMatches.length > 0))
  ) {
    recommendedHumanChecks.push(
      'Cross-verify flagged NLI contradictions and passage matches directly against authoritative primary-source documents and timestamps.',
    );
  }
  if (recommendedHumanChecks.length === 0 && scopedEvidenceList.length > 0) {
    recommendedHumanChecks.push(
      'Verify SHA-256 hashes against original chain-of-custody intake records and confirm cross-modal alignment in TEIE before closing review.',
    );
  }

  const headlineVerdict =
    scope === 'teie'
      ? teieResult
        ? `TEIE Engine Calibrated Index: ${teieResult.preliminaryCalibratedIndex}/100 · ${teieResult.relationships.length} Cross-Modal Link(s)`
        : 'Awaiting TEIE Engine Correlation'
      : scope === 'all' && teieResult
        ? `TEIE Calibrated Index: ${teieResult.preliminaryCalibratedIndex}/100 · ${flaggedEvidence.length} Flagged Finding(s)`
        : flaggedEvidence.length > 0
          ? `${flaggedEvidence.length} Flagged Indicator(s) Across ${scopedEvidenceList.length} ${isSingleModalityScope ? `${scope.toUpperCase()} ` : ''}Evidence Item(s)`
          : scopedEvidenceList.length > 0
            ? `No High-Risk Anomalies Flagged Across ${scopedEvidenceList.length} ${isSingleModalityScope ? `${scope.toUpperCase()} ` : ''}Evidence Item(s)`
            : 'Awaiting Evidence Upload';

  return {
    investigationId,
    scope,
    generatedAt,
    flaggedEvidence,
    evidenceConfidences,
    crossModalContext,
    summary: {
      headlineVerdict,
      findings,
      caveats,
      recommendedHumanChecks: Array.from(new Set(recommendedHumanChecks)),
    },
    auditLogs: scopedAuditLogs,
    teieMapDataUrl: scope === 'all' || scope === 'teie' ? teieMapDataUrl : undefined,
  };
}
