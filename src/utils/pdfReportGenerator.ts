import { jsPDF } from 'jspdf';
import type {
  AuditLogEntry,
  EvidenceRecord,
  MediaModuleId,
  TeieAnalysisResult,
} from '../types/forensics';
import { formatTimestamp } from './forensicDsp';
import {
  buildStructuredForensicReport,
  type ForensicReportScope,
} from './forensicReportBuilder';

interface GenerateReportParams {
  investigationId: string;
  evidenceList: EvidenceRecord[];
  teieResult: TeieAnalysisResult | null;
  auditLogs: AuditLogEntry[];
  teieMapDataUrl?: string;
  scope?: ForensicReportScope;
}

export interface GenerateModuleReportParams {
  investigationId: string;
  modality: MediaModuleId;
  evidenceList: EvidenceRecord[];
  teieResult: TeieAnalysisResult | null;
  auditLogs: AuditLogEntry[];
  teieMapDataUrl?: string;
  targetEvidenceId?: string;
}

function detectImageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  return dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')
    ? 'JPEG'
    : 'PNG';
}

function renderReportToPdf(params: {
  bannerTitle: string;
  subtitleLine: string;
  fileName: string;
  reportParams: GenerateReportParams;
  scopedRecords?: EvidenceRecord[];
  modality?: MediaModuleId;
}): void {
  const { bannerTitle, subtitleLine, fileName, reportParams, scopedRecords, modality } = params;
  const report = buildStructuredForensicReport(reportParams);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const usableWidth = pageWidth - margin * 2;
  let y = 18;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > pageHeight - 18) {
      doc.addPage();
      y = 18;
    }
  };

  const addSectionTitle = (title: string) => {
    ensureSpace(14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(15, 23, 42);
    doc.text(title, margin, y);
    y += 2;
    doc.setDrawColor(99, 102, 241);
    doc.setLineWidth(0.4);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
  };

  const addParagraph = (
    text: string,
    fontSize = 9,
    color: [number, number, number] = [51, 65, 85],
    indent = 0,
    bold = false,
  ) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(text || 'N/A', usableWidth - indent) as string[];
    for (const line of lines) {
      ensureSpace(5);
      doc.text(line, margin + indent, y);
      y += 4.3;
    }
    y += 1.2;
  };

  // Header Banner
  doc.setFillColor(11, 15, 25);
  doc.rect(0, 0, pageWidth, 34, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(bannerTitle, margin, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(165, 180, 252);
  doc.text(
    `Investigation ID: ${report.investigationId}   |   Generated: ${report.generatedAt}   |   Report v2.0`,
    margin,
    22,
  );
  doc.setTextColor(203, 213, 225);
  doc.text(subtitleLine, margin, 28.5);

  y = 42;

  // ---------------------------------------------------------------------------
  // SECTION 1: SUMMARY (Findings, Caveats & Recommended Human Checks)
  // ---------------------------------------------------------------------------
  addSectionTitle('1. SUMMARY — Findings, Caveats & Recommended Human Checks');
  addParagraph(`Headline Assessment: ${report.summary.headlineVerdict}`, 9.5, [15, 23, 42], 0, true);

  addParagraph('Findings:', 9, [30, 41, 59], 0, true);
  if (report.summary.findings.length === 0) {
    addParagraph('No analyzed evidence findings recorded yet.', 8.5, [100, 116, 139], 3);
  } else {
    report.summary.findings.forEach((f) => addParagraph(`• ${f}`, 8.5, [51, 65, 85], 3));
  }

  addParagraph('Caveats & Analytical Uncertainty:', 9, [180, 83, 9], 0, true);
  report.summary.caveats.forEach((c) => addParagraph(`• ${c}`, 8.5, [100, 116, 139], 3));

  addParagraph('Recommended Human Verification Checks:', 9, [30, 41, 59], 0, true);
  report.summary.recommendedHumanChecks.forEach((chk, idx) =>
    addParagraph(`${idx + 1}. [ ] ${chk}`, 8.5, [30, 41, 59], 3),
  );

  // ---------------------------------------------------------------------------
  // SECTION 2: FLAGGED EVIDENCE & OBSERVED INDICATORS
  // ---------------------------------------------------------------------------
  addSectionTitle('2. FLAGGED EVIDENCE & INDICATORS (Regions, Frames, Timestamps & Segments)');
  if (report.flaggedEvidence.length === 0) {
    addParagraph(
      'No suspicious or inconclusive region, frame, timestamp, audio segment, or text contradiction was flagged across the analyzed evidence.',
      9,
      [71, 85, 105],
    );
  } else {
    report.flaggedEvidence.forEach((item, idx) => {
      ensureSpace(28);
      const sevColor: [number, number, number] =
        item.severity === 'high'
          ? [185, 28, 28]
          : item.severity === 'medium'
            ? [180, 83, 9]
            : [30, 64, 175];

      addParagraph(
        `${idx + 1}. [${item.kindLabel} · ${item.severity.toUpperCase()}] ${item.flaggedTarget}`,
        9.5,
        sevColor,
        0,
        true,
      );
      addParagraph(
        `Indicator Signal(s): ${item.signals.join(' | ')}`,
        8.5,
        [30, 41, 59],
        3,
        true,
      );
      addParagraph(`Why Flagged: ${item.whyFlagged}`, 8.5, [51, 65, 85], 3);
      addParagraph(
        `Calibrated Confidence: ${item.confidenceScore}/100 — Uncertainty / Limitation: ${item.uncertaintyNote}`,
        8.5,
        [71, 85, 105],
        3,
      );
      addParagraph(
        `Cross-Modal Context: ${item.crossModalContext.join(' | ')}`,
        8.5,
        [51, 65, 85],
        3,
      );
      addParagraph(
        `Source Trace: [${item.sourceTrace.evidenceId}] ${item.sourceTrace.fileName} (${item.sourceTrace.artifactCoordinate}) · SHA-256 ${item.sourceTrace.sha256}`,
        8,
        [100, 116, 139],
        3,
      );
      y += 2;
    });
  }

  // ---------------------------------------------------------------------------
  // SECTION 3: CROSS-MODAL CONTEXT & TEIE CORRELATION
  // ---------------------------------------------------------------------------
  addSectionTitle('3. CROSS-MODAL CONTEXT — Related Media & External Sources');
  if (report.crossModalContext.length === 0) {
    addParagraph(
      'No cross-modal relationships generated yet. Upload two or more modalities or run TEIE correlation to populate cross-media context.',
      9,
      [71, 85, 105],
    );
  } else {
    report.crossModalContext.forEach((cm) => {
      const confStr = cm.confidence !== null ? ` (${cm.confidence}/100)` : '';
      const color: [number, number, number] =
        cm.relationType === 'contradictory'
          ? [185, 28, 28]
          : cm.relationType === 'supporting'
            ? [21, 128, 61]
            : [51, 65, 85];
      addParagraph(
        `[${cm.relationType.toUpperCase()}${confStr}] ${cm.pairLabel}`,
        9,
        color,
        0,
        true,
      );
      addParagraph(`${cm.finding} (Ref: ${cm.references})`, 8.5, [51, 65, 85], 3);
    });
  }

  if (report.teieMapDataUrl) {
    ensureSpace(56);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text('TEIE Interactive Evidence Relationship Graph Snapshot:', margin, y);
    y += 2.5;
    doc.addImage(
      report.teieMapDataUrl,
      detectImageFormat(report.teieMapDataUrl),
      margin,
      y,
      usableWidth,
      48,
    );
    y += 52;
  }

  // ---------------------------------------------------------------------------
  // SECTION 4: CONFIDENCE, SOURCE TRACE & VISUAL EVIDENCE SNAPSHOTS
  // ---------------------------------------------------------------------------
  addSectionTitle('4. CONFIDENCE & SOURCE TRACE — Calibrated Scores, SHA-256 & Artifacts');
  if (report.evidenceConfidences.length === 0) {
    addParagraph('No evidence files uploaded during this session.');
  } else {
    report.evidenceConfidences.forEach((ec, idx) => {
      ensureSpace(22);
      const primaryStr =
        ec.primaryScoreValue !== null
          ? `${ec.primaryScoreLabel}: ${ec.primaryScoreValue}/100`
          : `${ec.primaryScoreLabel}: ${ec.status.toUpperCase()}`;

      addParagraph(
        `${idx + 1}. [${ec.sourceTrace.evidenceId}] ${ec.fileName} (${ec.modality.toUpperCase()} · ${ec.sourceTrace.format} · ${ec.sourceTrace.sizeLabel}) — ${primaryStr}`,
        9.5,
        [15, 23, 42],
        0,
        true,
      );
      if (ec.secondaryMetrics.length > 0) {
        addParagraph(
          `Calibrated Indicators: ${ec.secondaryMetrics.map((m) => `${m.label}: ${m.value}`).join(' | ')}`,
          8.5,
          [51, 65, 85],
          3,
        );
      }
      addParagraph(
        `Limitations & Uncertainty: ${ec.uncertaintyAndLimitations}`,
        8.5,
        [100, 116, 139],
        3,
      );
      addParagraph(
        `Source Trace: Uploaded ${ec.sourceTrace.uploadTimestamp} | SHA-256: ${ec.sourceTrace.sha256}`,
        8,
        [71, 85, 105],
        3,
      );

      if (ec.snapshots?.waveformDataUrl) {
        ensureSpace(38);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        doc.text('Waveform Snapshot (Red = Suspicious Segments):', margin + 3, y);
        y += 2;
        doc.addImage(
          ec.snapshots.waveformDataUrl,
          detectImageFormat(ec.snapshots.waveformDataUrl),
          margin + 3,
          y,
          usableWidth - 6,
          28,
        );
        y += 32;
      }
      if (ec.snapshots?.spectrogramDataUrl) {
        ensureSpace(36);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        doc.text('Log-Mel Spectrogram Snapshot:', margin + 3, y);
        y += 2;
        doc.addImage(
          ec.snapshots.spectrogramDataUrl,
          detectImageFormat(ec.snapshots.spectrogramDataUrl),
          margin + 3,
          y,
          usableWidth - 6,
          26,
        );
        y += 30;
      }
      if (ec.snapshots?.heatmapDataUrl) {
        ensureSpace(48);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        doc.text('Grad-CAM Localized Manipulation Heatmap Snapshot:', margin + 3, y);
        y += 2;
        doc.addImage(
          ec.snapshots.heatmapDataUrl,
          detectImageFormat(ec.snapshots.heatmapDataUrl),
          margin + 3,
          y,
          76,
          42,
        );
        y += 46;
      }
      if (ec.snapshots?.videoFrameDataUrl) {
        ensureSpace(44);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        doc.text('Key Inspected Video Frame Snapshot:', margin + 3, y);
        y += 2;
        doc.addImage(
          ec.snapshots.videoFrameDataUrl,
          detectImageFormat(ec.snapshots.videoFrameDataUrl),
          margin + 3,
          y,
          72,
          38,
        );
        y += 42;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // OPTIONAL MODALITY-SPECIFIC DEEP DIAGNOSTICS (when exporting per-module)
  // ---------------------------------------------------------------------------
  let nextSectionNumber = 5;
  if (modality && scopedRecords && scopedRecords.length > 0) {
    addSectionTitle(`${nextSectionNumber}. ${modality.toUpperCase()} FORENSICS DETAILED FINDINGS`);
    nextSectionNumber += 1;

    if (modality === 'audio') {
      scopedRecords.forEach((ev) => {
        if (!ev.audioResult) return;
        const ar = ev.audioResult;
        addParagraph(`[${ev.id}] ${ev.fileName} — ${ar.summaryVerdict}`, 9.5, [15, 23, 42], 0, true);
        addParagraph(`Explanation: ${ar.explanation}`, 8.5, [51, 65, 85], 3);
        if (ev.audioDsp) {
          addParagraph(
            `DSP Telemetry: Sample Rate ${ev.audioDsp.sampleRate} Hz · Duration ${formatTimestamp(ev.audioDsp.durationSec)} · Mean Centroid ${ev.audioDsp.summary.meanSpectralCentroidHz} Hz · Dynamic Range ${ev.audioDsp.summary.dynamicRangeDb} dB`,
            8.5,
            [71, 85, 105],
            3,
          );
        }
        addParagraph(
          `Frequency Patterns: ${ar.anomalyFindings.unnaturalFrequencyPatterns}`,
          8.5,
          [51, 65, 85],
          3,
        );
        addParagraph(
          `Spectral Consistency: ${ar.anomalyFindings.spectralInconsistencies}`,
          8.5,
          [51, 65, 85],
          3,
        );
        addParagraph(
          `Voice Cloning Assessment: ${ar.anomalyFindings.voiceCloningAssessment}`,
          8.5,
          [51, 65, 85],
          3,
        );
        if (ar.transcript) {
          addParagraph(`Transcribed Speech: "${ar.transcript}"`, 8.5, [30, 41, 59], 3);
        }
      });
    } else if (modality === 'video') {
      scopedRecords.forEach((ev) => {
        if (!ev.videoResult) return;
        const vr = ev.videoResult;
        addParagraph(`[${ev.id}] ${ev.fileName} — Temporal & Face Inspection`, 9.5, [15, 23, 42], 0, true);
        addParagraph(`Explanation: ${vr.explanation}`, 8.5, [51, 65, 85], 3);
        addParagraph(
          `AI-Generated Indicators: ${vr.detectionFeatures.aiGeneratedIndicators}`,
          8.5,
          [51, 65, 85],
          3,
        );
        addParagraph(
          `Face Manipulation: ${vr.detectionFeatures.faceManipulation}`,
          8.5,
          [51, 65, 85],
          3,
        );
        addParagraph(
          `Temporal Consistency: ${vr.detectionFeatures.temporalInconsistencies}`,
          8.5,
          [51, 65, 85],
          3,
        );
        addParagraph(
          `Textures & Compositing: ${vr.detectionFeatures.textureAndCompositing}`,
          8.5,
          [51, 65, 85],
          3,
        );
        if (vr.frameAssessments.length > 0) {
          addParagraph('Frame Checkpoints:', 8.5, [30, 41, 59], 3, true);
          vr.frameAssessments.forEach((fa) => {
            addParagraph(
              `• Frame #${fa.index + 1} (${formatTimestamp(fa.timestamp)}) — ${fa.verdict.toUpperCase()} (${fa.calibratedSuspicion}/100): ${fa.findings}`,
              8,
              [71, 85, 105],
              6,
            );
          });
        }
      });
    } else if (modality === 'image') {
      scopedRecords.forEach((ev) => {
        if (!ev.imageResult) return;
        const ir = ev.imageResult;
        addParagraph(
          `[${ev.id}] ${ev.fileName} — ${ir.primaryClassification}`,
          9.5,
          [15, 23, 42],
          0,
          true,
        );
        addParagraph(`Detection Explanation: ${ir.detectionExplanation}`, 8.5, [51, 65, 85], 3);
        addParagraph(
          `AI Synthesis Cues: ${ir.manipulationSignals.aiGeneratedCharacteristics}`,
          8.5,
          [51, 65, 85],
          3,
        );
        addParagraph(
          `Splicing & Compositing: ${ir.manipulationSignals.splicingAndCompositing}`,
          8.5,
          [51, 65, 85],
          3,
        );
        addParagraph(
          `Lighting & Shadows: ${ir.manipulationSignals.lightingAndShadows}`,
          8.5,
          [51, 65, 85],
          3,
        );
        addParagraph(
          `Texture & Pixels: ${ir.manipulationSignals.textureAndPixelIrregularities}`,
          8.5,
          [51, 65, 85],
          3,
        );
        if (ev.imageMetadata) {
          const m = ev.imageMetadata;
          addParagraph(
            `Metadata & Pixel Telemetry: ${m.width}×${m.height} · EXIF ${m.hasExif ? 'Present' : 'Absent'} · C2PA ${m.c2paDetected ? 'Present' : 'Absent'} · ELA Mean ${m.elaMeanResidual} · Noise Var ${m.noiseVariance} · High-Freq ${m.highFreqEnergyRatio}${m.aiGeneratorHint ? ` · Hint: ${m.aiGeneratorHint}` : ''}`,
            8.5,
            [71, 85, 105],
            3,
          );
        }
        if (ev.elaDataUrl) {
          ensureSpace(48);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(71, 85, 105);
          doc.text('Error Level Analysis (ELA) Residual Map:', margin + 3, y);
          y += 2;
          doc.addImage(
            ev.elaDataUrl,
            detectImageFormat(ev.elaDataUrl),
            margin + 3,
            y,
            76,
            42,
          );
          y += 46;
        }
      });
    } else if (modality === 'text') {
      const analyzedRecord = [...scopedRecords].reverse().find((r) => r.textResult);
      if (analyzedRecord?.textResult) {
        const tr = analyzedRecord.textResult;
        addParagraph('Text Analysis Summary:', 9.5, [15, 23, 42], 0, true);
        addParagraph(tr.summary, 8.5, [51, 65, 85], 3);
        addParagraph(`AI Indicator Disclaimer: ${tr.aiIndicatorDisclaimer}`, 8, [180, 83, 9], 3);
        addParagraph('Submitted Text Sources:', 9, [30, 41, 59], 0, true);
        scopedRecords.forEach((ev) => {
          addParagraph(
            `• [${ev.id}] ${ev.fileName} (${ev.format}, ${ev.textContent?.length ?? 0} chars) · SHA-256 ${ev.sha256.slice(0, 16)}...`,
            8.5,
            [71, 85, 105],
            3,
          );
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // SECTION 5/6: CHAIN-OF-CUSTODY AUDIT LOG
  // ---------------------------------------------------------------------------
  if (report.auditLogs.length > 0) {
    addSectionTitle(`${nextSectionNumber}. CHAIN-OF-CUSTODY AUDIT TRAIL`);
    report.auditLogs.slice(-20).forEach((entry) => {
      addParagraph(
        `${entry.timestamp} [${entry.module.toUpperCase()}] ${entry.action} — ${entry.detail}`,
        8,
        [71, 85, 105],
      );
    });
  }

  doc.save(fileName);
}

export function generateForensicPdfReport(params: GenerateReportParams): void {
  renderReportToPdf({
    bannerTitle: 'TRUTHLENS FORENSIC DOSSIER',
    subtitleLine:
      'Flagged Evidence · Observed Indicators · Cross-Modal Context · Calibrated Confidence · Source Trace · Summary',
    fileName: `${params.investigationId}_TruthLens_Forensic_Report.pdf`,
    reportParams: params,
  });
}

export function generateModuleForensicPdfReport(params: GenerateModuleReportParams): void {
  const {
    investigationId,
    modality,
    evidenceList,
    teieResult,
    auditLogs,
    teieMapDataUrl,
    targetEvidenceId,
  } = params;

  const modalityRecords = evidenceList.filter((ev) => ev.modality === modality);
  const analyzedModalityRecords = modalityRecords.filter((ev) => ev.status === 'analyzed');
  const baseRecords = analyzedModalityRecords.length > 0 ? analyzedModalityRecords : modalityRecords;

  const scopedRecords =
    targetEvidenceId && modality !== 'text'
      ? baseRecords.filter((ev) => ev.id === targetEvidenceId)
      : baseRecords;

  const finalRecords = scopedRecords.length > 0 ? scopedRecords : baseRecords;
  const scopedIds = new Set(finalRecords.map((ev) => ev.id.toUpperCase()));

  const scopedTeie: TeieAnalysisResult | null =
    teieResult &&
    teieResult.relationships.some(
      (r) => scopedIds.has(r.sourceId.toUpperCase()) || scopedIds.has(r.targetId.toUpperCase()),
    )
      ? {
          ...teieResult,
          relationships: teieResult.relationships.filter(
            (r) =>
              scopedIds.has(r.sourceId.toUpperCase()) || scopedIds.has(r.targetId.toUpperCase()),
          ),
        }
      : null;

  const scopedLogs = auditLogs.filter((log) => log.module === modality);
  const scopeTag =
    targetEvidenceId && modality !== 'text' ? `${targetEvidenceId}_` : '';
  const modalityLabel = modality.toUpperCase();

  renderReportToPdf({
    bannerTitle: `TRUTHLENS ${modalityLabel} FORENSICS REPORT`,
    subtitleLine: `${modalityLabel} Analysis · Observed Indicators · Calibrated Confidence · Source Trace · Recommended Checks`,
    fileName: `${investigationId}_${scopeTag}TruthLens_${modalityLabel}_Analysis_Report.pdf`,
    reportParams: {
      investigationId,
      evidenceList: finalRecords,
      teieResult: scopedTeie,
      auditLogs: scopedLogs,
      teieMapDataUrl: scopedTeie ? teieMapDataUrl : undefined,
    },
    scopedRecords: finalRecords,
    modality,
  });
}

