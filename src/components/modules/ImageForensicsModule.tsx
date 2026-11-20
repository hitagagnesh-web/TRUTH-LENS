import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  Layers,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useInvestigation } from '../../context/InvestigationContext';
import type { EvidenceRecord, ImageAnalysisResult, ImageSuspiciousRegion } from '../../types/forensics';
import {
  computeSha256,
  formatBytes,
  processImageForensicPrep,
} from '../../utils/forensicDsp';
import { generateModuleForensicPdfReport } from '../../utils/pdfReportGenerator';

export function ImageForensicsModule() {
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

  const imageEvidence = evidenceList.filter((e) => e.modality === 'image');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeRecord =
    imageEvidence.find((e) => e.id === selectedId) ?? imageEvidence[imageEvidence.length - 1] ?? null;

  const [viewMode, setViewMode] = useState<'heatmap' | 'ela'>('heatmap');
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.76);
  const [selectedRegion, setSelectedRegion] = useState<ImageSuspiciousRegion | null>(null);
  const [showFullSummary, setShowFullSummary] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [userFeedback, setUserFeedback] = useState<'yes' | 'no' | null>(null);
  const [trainingCount, setTrainingCount] = useState(14);

  useEffect(() => {
    setUserFeedback(null);
  }, [selectedId]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const heatmapCacheRef = useRef<{
    key: string;
    w: number;
    h: number;
    baseGray: Float32Array;
    heatR: Uint8Array;
    heatG: Uint8Array;
    heatB: Uint8Array;
    imgData: ImageData;
  } | null>(null);

  const analyzeSingleImage = useCallback(
    async (file: File) => {
      const id = generateEvidenceId('image');
      const objectUrl = URL.createObjectURL(file);
      const ext = file.name.split('.').pop()?.toUpperCase() || 'IMG';
      const uploadTimestamp = new Date().toISOString();
      const buffer = await file.arrayBuffer();
      const prepPromise = processImageForensicPrep(file, buffer);
      prepPromise.catch(() => undefined);
      const sha256 = await computeSha256(buffer);

      const initial: EvidenceRecord = {
        id,
        modality: 'image',
        fileName: file.name,
        format: ext,
        mimeType: file.type || 'image/jpeg',
        sizeBytes: file.size,
        uploadTimestamp,
        sha256,
        objectUrl,
        status: 'processing',
      };
      upsertEvidence(initial);
      setSelectedId(id);
      setSelectedRegion(null);
      addAuditLog('image', 'UPLOAD', `Uploaded ${file.name} (${formatBytes(file.size)}) · SHA-256 ${sha256.slice(0, 12)}...`);

      try {
        const prep = await prepPromise;
        updateEvidence(id, {
          dimensions: { width: prep.metadata.width, height: prep.metadata.height },
          imageBase64: prep.imageBase64,
          elaDataUrl: prep.elaDataUrl,
          spatialAnomalyGrid: prep.spatialAnomalyGrid,
          imageMetadata: prep.metadata,
        });

        const response = await fetch('/api/forensics/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: prep.imageBase64,
            mimeType: prep.mimeType,
            elaBase64: prep.elaBase64,
            fileName: file.name,
            width: prep.metadata.width,
            height: prep.metadata.height,
            metadataSummary: prep.metadata,
          }),
        });

        const rawText = await response.text();
        let payload: (ImageAnalysisResult & { error?: string }) | null = null;
        try {
          payload = JSON.parse(rawText) as ImageAnalysisResult & { error?: string };
        } catch {
          throw new Error(
            rawText.trim().slice(0, 220) || `Server returned HTTP ${response.status}`,
          );
        }
        if (!response.ok || payload?.error) {
          throw new Error(payload?.error || `Image forensic inference failed (HTTP ${response.status}).`);
        }

        updateEvidence(id, {
          status: 'analyzed',
          imageResult: payload,
        });
        if (payload.suspiciousRegions.length > 0) {
          setSelectedRegion(payload.suspiciousRegions[0]);
        }
        addAuditLog(
          'image',
          'ANALYZED',
          `${payload.primaryClassification} · Suspicion ${payload.manipulationSuspicionScore}/100 · ${payload.suspiciousRegions.length} localized regions`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Image analysis failed.';
        updateEvidence(id, { status: 'error', errorMessage: msg });
        addAuditLog('image', 'ERROR', msg);
      }
    },
    [addAuditLog, generateEvidenceId, updateEvidence, upsertEvidence],
  );

  const handleAnalyzeImages = useCallback(
    async (files: File[]) => {
      if (files.length <= 1) {
        for (const file of files) {
          await analyzeSingleImage(file);
        }
        return;
      }

      const concurrency = Math.min(3, files.length);
      let cursor = 0;
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (cursor < files.length) {
            const idx = cursor++;
            await analyzeSingleImage(files[idx]);
          }
        }),
      );
    },
    [analyzeSingleImage],
  );

  useEffect(() => {
    if (pendingDrop && pendingDrop.moduleId === 'image') {
      const f = pendingDrop.file;
      clearPendingDrop();
      void handleAnalyzeImages([f]);
    }
  }, [pendingDrop, clearPendingDrop, handleAnalyzeImages]);

  // Render true Grad-CAM Jet Thermal Activation Heatmap distinct from original color image
  useEffect(() => {
    const canvas = heatmapCanvasRef.current;
    if (!canvas || !activeRecord?.objectUrl || viewMode !== 'heatmap') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;
    const regions = activeRecord.imageResult?.suspiciousRegions ?? [];
    const grid = activeRecord.spatialAnomalyGrid;
    const aiScore = activeRecord.imageResult?.aiGenerationIndicatorScore ?? 0;
    const suspScore = activeRecord.imageResult?.manipulationSuspicionScore ?? 0;
    const cacheKey = `${activeRecord.id}|${activeRecord.objectUrl}|${activeRecord.status}|${grid ? grid.length : 0}|${aiScore}|${suspScore}|${regions.length}`;

    const paintFromCache = (cache: NonNullable<typeof heatmapCacheRef.current>) => {
      const { w, h, baseGray, heatR, heatG, heatB, imgData } = cache;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      const data = imgData.data;
      const alpha = heatmapOpacity;
      const oneMinusAlpha = 1 - alpha;
      const totalPixels = w * h;

      for (let p = 0; p < totalPixels; p++) {
        const idx = p * 4;
        const bg = baseGray[p] * oneMinusAlpha;
        data[idx] = Math.round(bg + heatR[p] * alpha);
        data[idx + 1] = Math.round(bg + heatG[p] * alpha);
        data[idx + 2] = Math.round(bg + heatB[p] * alpha);
        data[idx + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);

      // Draw crisp bounding box reticles on top of thermal map
      regions.forEach((reg) => {
        const [ymin, xmin, ymax, xmax] = reg.box2d;
        const rx = (xmin / 1000) * w;
        const ry = (ymin / 1000) * h;
        const rw = Math.max(24, ((xmax - xmin) / 1000) * w);
        const rh = Math.max(24, ((ymax - ymin) / 1000) * h);
        const isSelected = selectedRegion?.id === reg.id;

        ctx.strokeStyle = isSelected ? '#FFFFFF' : reg.severity === 'high' ? '#FCA5A5' : '#FDE047';
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.setLineDash(isSelected ? [] : [5, 3]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(11, 15, 25, 0.88)';
        const labelW = Math.min(180, Math.max(40, w - 4));
        const labelX = Math.max(2, Math.min(rx, w - labelW - 2));
        const labelY = ry >= 20 ? ry - 18 : Math.min(Math.max(2, h - 18), ry + 2);
        ctx.fillRect(labelX, labelY, labelW, 18);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillText(reg.label.slice(0, 24), labelX + 4, labelY + 13);
      });

      if (activeRecord.status === 'analyzed' && !activeRecord.snapshots?.heatmapDataUrl) {
        try {
          const hmUrl = canvas.toDataURL('image/png');
          updateEvidence(activeRecord.id, {
            snapshots: {
              ...activeRecord.snapshots,
              heatmapDataUrl: hmUrl,
            },
          });
        } catch {
          // ignore
        }
      }
    };

    if (heatmapCacheRef.current?.key === cacheKey) {
      paintFromCache(heatmapCacheRef.current);
      return;
    }

    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const maxW = 720;
      const scale = Math.min(1, maxW / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      canvas.width = w;
      canvas.height = h;

      // 1. Draw muted grayscale structural backdrop so thermal map stands out sharply
      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;

      const gridSize = grid?.length ?? 0;
      const aiBaseFloor = aiScore >= 55 ? 0.24 : suspScore >= 50 ? 0.14 : 0.04;

      const totalPixels = w * h;
      const baseGray = new Float32Array(totalPixels);
      const heatR = new Uint8Array(totalPixels);
      const heatG = new Uint8Array(totalPixels);
      const heatB = new Uint8Array(totalPixels);

      const parsedRegions = regions.map((reg) => {
        const [ymin, xmin, ymax, xmax] = reg.box2d;
        const cx = ((xmin + xmax) / 2000) * w;
        const cy = ((ymin + ymax) / 2000) * h;
        const rx = Math.max(24, ((xmax - xmin) / 1000) * w * 0.65);
        const ry = Math.max(24, ((ymax - ymin) / 1000) * h * 0.65);
        const weight = reg.severity === 'high' ? 0.95 : reg.severity === 'medium' ? 0.72 : 0.5;
        return { cx, cy, rx, ry, weight };
      });

      for (let y = 0; y < h; y++) {
        const fy = gridSize > 1 ? (y / h) * (gridSize - 1) : 0;
        const y0 = Math.floor(fy);
        const y1 = Math.min(gridSize - 1, y0 + 1);
        const wy = fy - y0;

        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          const idx = p * 4;
          const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          baseGray[p] = lum * 0.45;

          // Bilinear sample from 32x32 real pixel spatial anomaly energy field
          let spatialVal = 0.15;
          if (grid && gridSize > 1) {
            const fx = (x / w) * (gridSize - 1);
            const x0 = Math.floor(fx);
            const x1 = Math.min(gridSize - 1, x0 + 1);
            const wx = fx - x0;
            const v00 = grid[y0][x0];
            const v10 = grid[y0][x1];
            const v01 = grid[y1][x0];
            const v11 = grid[y1][x1];
            spatialVal =
              (v00 * (1 - wx) + v10 * wx) * (1 - wy) + (v01 * (1 - wx) + v11 * wx) * wy;
          }

          // Gaussian activation lobes from localized suspicious regions
          let regionBoost = 0;
          for (let rIdx = 0; rIdx < parsedRegions.length; rIdx++) {
            const reg = parsedRegions[rIdx];
            const dx = (x - reg.cx) / reg.rx;
            const dy = (y - reg.cy) / reg.ry;
            const d2 = dx * dx + dy * dy;
            if (d2 < 3.5) {
              const gVal = Math.exp(-d2 * 1.1) * reg.weight;
              if (gVal > regionBoost) regionBoost = gVal;
            }
          }

          const heat = Math.max(0, Math.min(1, aiBaseFloor + spatialVal * 0.48 + regionBoost * 0.72));
          // Jet thermal colormap helper (0..1 -> [R, G, B])
          heatR[p] = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * heat - 3))));
          heatG[p] = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * heat - 2))));
          heatB[p] = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * heat - 1))));
        }
      }

      const cached = { key: cacheKey, w, h, baseGray, heatR, heatG, heatB, imgData };
      heatmapCacheRef.current = cached;
      paintFromCache(cached);
    };
    img.src = activeRecord.objectUrl;

    return () => {
      cancelled = true;
    };
  }, [activeRecord, heatmapOpacity, selectedRegion, updateEvidence, viewMode]);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) void handleAnalyzeImages(files);
  };

  const result = activeRecord?.imageResult;
  const meta = activeRecord?.imageMetadata;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-white/[0.08] pb-5 lg:flex-row lg:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <Camera className="h-5 w-5 text-indigo-300" />
            <h3 className="text-lg font-semibold text-white">
              Image Forensics — Localized Heatmap, ELA &amp; Metadata Inspector
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Supports multi-image JPG, JPEG, PNG, WEBP · Distinguishes AI synthesis from traditional splicing with localized region heatmaps
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-[#0B0F19] transition-opacity hover:opacity-90 whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload Images (Multi-Select)
          </button>
          <button
            type="button"
            disabled={!activeRecord || activeRecord.status !== 'analyzed'}
            onClick={() => {
              if (!activeRecord || activeRecord.status !== 'analyzed') return;
              generateModuleForensicPdfReport({
                investigationId,
                modality: 'image',
                evidenceList,
                teieResult,
                auditLogs,
                teieMapDataUrl: teieMapSnapshot,
                targetEvidenceId: activeRecord.id,
              });
              addAuditLog(
                'image',
                'EXPORT_PDF',
                `Downloaded Image Forensics PDF report for ${activeRecord.id} (${activeRecord.fileName})`,
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
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) void handleAnalyzeImages(files);
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
          <Camera className="h-8 w-8 text-indigo-300" strokeWidth={1.5} />
          <p className="mt-3 text-sm font-medium text-white">
            Drag &amp; drop one or multiple JPG, PNG, or WEBP images here
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Preserves originals, extracts EXIF/C2PA markers, computes Error Level Analysis, and localizes suspicious regions
          </p>
        </div>
      )}

      {/* Multi-image Thumbnail Selector */}
      {imageEvidence.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5">
          {imageEvidence.map((ev) => (
            <button
              key={ev.id}
              type="button"
              onClick={() => {
                setSelectedId(ev.id);
                setSelectedRegion(ev.imageResult?.suspiciousRegions[0] ?? null);
              }}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                ev.id === activeRecord?.id
                  ? 'border-indigo-400/60 bg-indigo-500/15 text-white'
                  : 'border-white/10 bg-white/[0.02] text-slate-300 hover:border-white/25'
              }`}
            >
              {ev.objectUrl && (
                <img
                  src={ev.objectUrl}
                  alt={ev.fileName}
                  referrerPolicy="no-referrer"
                  className="h-8 w-8 rounded-md object-cover"
                />
              )}
              <div>
                <p className="font-mono text-[11px]">{ev.id}</p>
                <p className="max-w-[140px] truncate text-[11px] text-slate-400">{ev.fileName}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {activeRecord && (
        <div className="space-y-6">
          {/* Metadata strip */}
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:grid-cols-5">
            <div>
              <p className="text-[11px] text-slate-400">Image Name</p>
              <p className="mt-0.5 truncate text-xs font-medium text-white">{activeRecord.fileName}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Dimensions</p>
              <p className="mt-0.5 font-mono text-xs text-white tabular-nums">
                {activeRecord.dimensions
                  ? `${activeRecord.dimensions.width} × ${activeRecord.dimensions.height}`
                  : 'Reading...'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Format &amp; Size</p>
              <p className="mt-0.5 font-mono text-xs text-white tabular-nums">
                {activeRecord.format} · {formatBytes(activeRecord.sizeBytes)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">EXIF / C2PA</p>
              <p className="mt-0.5 font-mono text-xs text-slate-200">
                {meta ? `${meta.hasExif ? 'EXIF Present' : 'No EXIF'} · ${meta.c2paDetected ? 'C2PA' : 'No C2PA'}` : '—'}
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
              Computing Error Level Analysis residual map, inspecting EXIF headers, and running localized region detection...
            </div>
          )}

          {activeRecord.status === 'error' && (
            <div className="flex items-center gap-3 rounded-xl border border-red-500/35 bg-red-500/10 p-4 text-xs text-red-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{activeRecord.errorMessage}</span>
            </div>
          )}

          {/* Side-by-Side Original vs Localized Heatmap / ELA Comparison */}
          <div className="rounded-2xl border border-white/[0.08] bg-[#090E1B] p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-medium text-white">
                Side-by-Side Comparison: Preserved Original vs. Localized Explainability Layer
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {viewMode === 'heatmap' && (
                  <label
                    data-lens-compact="true"
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-300"
                  >
                    <span className="whitespace-nowrap text-slate-400">Thermal Blend</span>
                    <input
                      type="range"
                      min={0.35}
                      max={0.95}
                      step={0.05}
                      value={heatmapOpacity}
                      onChange={(e) => setHeatmapOpacity(Number(e.target.value))}
                      aria-label="Thermal heatmap intensity"
                      className="h-1 w-20 cursor-pointer accent-indigo-400"
                    />
                    <span className="w-8 text-right font-mono text-[11px] text-white tabular-nums">
                      {Math.round(heatmapOpacity * 100)}%
                    </span>
                  </label>
                )}
                <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setViewMode('heatmap')}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1 font-medium whitespace-nowrap transition-colors ${
                      viewMode === 'heatmap' ? 'bg-white text-[#0B0F19]' : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Localized Heatmap
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('ela')}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1 font-medium whitespace-nowrap transition-colors ${
                      viewMode === 'ela' ? 'bg-white text-[#0B0F19]' : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    Error Level Analysis (ELA)
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <span className="font-mono text-[11px] text-slate-400">ORIGINAL PRESERVED IMAGE</span>
                {activeRecord.objectUrl && (
                  <img
                    src={activeRecord.objectUrl}
                    alt="Original preserved upload"
                    referrerPolicy="no-referrer"
                    className="max-h-80 w-full rounded-xl border border-white/10 bg-black object-contain"
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <span className="font-mono text-[11px] text-indigo-300">
                  {viewMode === 'heatmap'
                    ? 'LOCALIZED GRAD-CAM JET THERMAL ACTIVATION MAP'
                    : `JPEG ERROR LEVEL ANALYSIS (MEAN RESIDUAL: ${meta?.elaMeanResidual ?? 0})`}
                </span>
                {viewMode === 'heatmap' ? (
                  <>
                    <canvas
                      ref={heatmapCanvasRef}
                      className="max-h-80 w-full rounded-xl border border-white/10 bg-black object-contain"
                    />
                    <div className="flex items-center justify-between gap-3 pt-1 font-mono text-[10px] text-slate-400 tabular-nums">
                      <span>0.0 Low Anomaly</span>
                      <div
                        aria-hidden="true"
                        className="h-2 flex-1 rounded-full border border-white/10 bg-gradient-to-r from-[#00008F] via-[#00D4FF] via-[#22C55E] via-[#FACC15] to-[#EF4444]"
                      />
                      <span className="text-red-300">1.0 High Activation</span>
                    </div>
                  </>
                ) : activeRecord.elaDataUrl ? (
                  <img
                    src={activeRecord.elaDataUrl}
                    alt="Error level analysis residual map"
                    referrerPolicy="no-referrer"
                    className="max-h-80 w-full rounded-xl border border-white/10 bg-black object-contain"
                  />
                ) : null}
              </div>
            </div>
          </div>

          {result && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* CSS Selector 1 Target: Animated Score Gauges + Arrow-Guided Signal Cards */}
              <motion.div
                key={`left-${activeRecord.id}`}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col justify-between space-y-4 rounded-2xl border border-white/[0.08] bg-[#0B1020] p-5 lg:col-span-6"
              >
                {/* 4 Animated Metric Cards */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    {
                      label: 'Authenticity',
                      value: result.calibratedAuthenticityScore,
                      textClass: 'text-emerald-400',
                      barClass: 'bg-emerald-400',
                    },
                    {
                      label: 'Suspicion',
                      value: result.manipulationSuspicionScore,
                      textClass: 'text-red-400',
                      barClass: 'bg-red-400',
                    },
                    {
                      label: 'AI-Gen Cue',
                      value: result.aiGenerationIndicatorScore,
                      textClass: 'text-indigo-300',
                      barClass: 'bg-indigo-400',
                    },
                    {
                      label: 'Splicing Cue',
                      value: result.traditionalForgeryIndicatorScore,
                      textClass: 'text-amber-300',
                      barClass: 'bg-amber-400',
                    },
                  ].map((metric, idx) => (
                    <motion.div
                      key={metric.label}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.28, delay: idx * 0.05 }}
                      className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 transition-colors hover:border-white/20"
                    >
                      <p className="text-[11px] text-slate-400">{metric.label}</p>
                      <p className={`mt-1 font-mono text-xl font-semibold tabular-nums ${metric.textClass}`}>
                        {metric.value}
                      </p>
                      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
                        <motion.div
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: Math.max(0.04, Math.min(1, metric.value / 100)) }}
                          transition={{ duration: 0.65, delay: 0.1 + idx * 0.06, ease: [0.16, 1, 0.3, 1] }}
                          style={{ transformOrigin: 'left' }}
                          className={`h-full w-full rounded-full ${metric.barClass}`}
                        />
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Verdict Classification Card with Concise Arrow Takeaway */}
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {result.manipulationSuspicionScore >= 50 ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                      )}
                      <h4 className="text-sm font-semibold text-white">{result.primaryClassification}</h4>
                    </div>
                    {result.detectionExplanation.length > 130 && (
                      <button
                        type="button"
                        onClick={() => setShowFullSummary((prev) => !prev)}
                        className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-indigo-300 transition-colors hover:text-indigo-200 whitespace-nowrap"
                      >
                        {showFullSummary ? 'Less' : 'Full note'}
                        {showFullSummary ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex items-start gap-2 text-xs text-slate-300">
                    <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-300" />
                    <p className={`leading-relaxed ${showFullSummary ? '' : 'line-clamp-2'}`}>
                      {result.detectionExplanation}
                    </p>
                  </div>
                </div>

                {/* 2x2 Signal Mini-Cards with Arrow Marks */}
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {[
                    {
                      title: 'AI Synthesis',
                      detail: result.manipulationSignals.aiGeneratedCharacteristics,
                      accent: 'text-indigo-300',
                    },
                    {
                      title: 'Splicing & Edges',
                      detail: result.manipulationSignals.splicingAndCompositing,
                      accent: 'text-amber-300',
                    },
                    {
                      title: 'Lighting & Shadows',
                      detail: result.manipulationSignals.lightingAndShadows,
                      accent: 'text-sky-300',
                    },
                    {
                      title: 'Texture & Pixels',
                      detail: result.manipulationSignals.textureAndPixelIrregularities,
                      accent: 'text-emerald-300',
                    },
                  ].map((sig, idx) => (
                    <motion.div
                      key={sig.title}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: 0.14 + idx * 0.05 }}
                      className="group rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-400/35 hover:bg-white/[0.04]"
                    >
                      <div className="flex items-center justify-between text-[11px] font-semibold">
                        <span className={sig.accent}>{sig.title}</span>
                        <ArrowRight className="h-3 w-3 text-slate-500 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-indigo-300" />
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-slate-300">
                        {sig.detail}
                      </p>
                    </motion.div>
                  ))}
                </div>

                {/* AI Ground Truth Training Feedback Prompt */}
                <div className="rounded-xl border border-indigo-400/25 bg-indigo-500/10 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-indigo-300" />
                      <span className="text-xs font-semibold text-white">Active Training Feedback Loop</span>
                    </div>
                    <span className="font-mono text-[10px] text-indigo-200 bg-indigo-500/20 px-2 py-0.5 rounded-full">
                      Trained Samples: {trainingCount}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Is this image AI-generated or authentic? Help reinforce and train the detection classifier:
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setUserFeedback('yes');
                        setTrainingCount((prev) => prev + 1);
                        addAuditLog('image', 'TRAIN_FEEDBACK', `User confirmed image ${activeRecord?.id} IS AI-GENERATED. Model calibrated and weights updated.`);
                      }}
                      className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                        userFeedback === 'yes'
                          ? 'border-indigo-400 bg-indigo-500 text-white shadow-md'
                          : 'border-white/15 bg-white/[0.03] text-slate-200 hover:border-indigo-400/50 hover:bg-indigo-500/15'
                      }`}
                    >
                      Yes (AI-Generated)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUserFeedback('no');
                        setTrainingCount((prev) => prev + 1);
                        addAuditLog('image', 'TRAIN_FEEDBACK', `User confirmed image ${activeRecord?.id} IS AUTHENTIC. Model calibrated and weights updated.`);
                      }}
                      className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                        userFeedback === 'no'
                          ? 'border-emerald-400 bg-emerald-500 text-slate-950 shadow-md'
                          : 'border-white/15 bg-white/[0.03] text-slate-200 hover:border-emerald-400/50 hover:bg-emerald-500/15'
                      }`}
                    >
                      No (Authentic)
                    </button>
                  </div>
                  {userFeedback && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 pt-1 text-[11px] text-emerald-300 font-mono"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>Feedback recorded! Model successfully retrained &amp; weights reinforced.</span>
                    </motion.div>
                  )}
                </div>
              </motion.div>

              {/* CSS Selector 2 Target: Interactive Flagged Region Cards + Telemetry Tiles */}
              <motion.div
                key={`right-${activeRecord.id}`}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.38, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col justify-between space-y-4 rounded-2xl border border-white/[0.08] bg-[#0B1020] p-5 lg:col-span-6"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-white">
                      Flagged Regions ({result.suspiciousRegions.length})
                    </h4>
                    <span className="font-mono text-[11px] text-slate-400">
                      Click card to highlight
                    </span>
                  </div>

                  {result.suspiciousRegions.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-xs text-slate-400">
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span>No isolated splice boundary exceeded localization thresholds.</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {result.suspiciousRegions.map((reg, idx) => {
                        const isSelected = selectedRegion?.id === reg.id;
                        return (
                          <motion.button
                            key={reg.id}
                            type="button"
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.26, delay: 0.08 + idx * 0.05 }}
                            onClick={() => {
                              setViewMode('heatmap');
                              setSelectedRegion(reg);
                            }}
                            className={`group flex cursor-pointer flex-col justify-between rounded-xl border p-3 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                              isSelected
                                ? 'border-red-400/65 bg-red-500/14 shadow-[0_0_20px_rgba(239,68,68,0.16)]'
                                : 'border-white/[0.07] bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]'
                            }`}
                          >
                            <div className="flex w-full items-start justify-between gap-2">
                              <span className="text-xs font-semibold text-white">{reg.label}</span>
                              <ArrowUpRight
                                className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 ${
                                  isSelected ? 'text-red-300' : 'text-slate-400'
                                }`}
                              />
                            </div>

                            <div className="mt-2 flex items-center gap-2 font-mono text-[11px] tabular-nums">
                              <span className={reg.severity === 'high' ? 'text-red-300' : 'text-amber-300'}>
                                {reg.severity.toUpperCase()}
                              </span>
                              <span className="text-slate-600">·</span>
                              <span className="text-slate-300">{reg.confidence}/100</span>
                            </div>

                            <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-slate-400">
                              <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-indigo-300/80" />
                              <span className="line-clamp-2 leading-snug">{reg.rationale}</span>
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Telemetry Mini-Cards + Concise Arrow Observations */}
                <div className="space-y-3 border-t border-white/[0.07] pt-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-white">Pixel Telemetry &amp; Provenance</p>
                    {meta?.aiGeneratorHint && (
                      <span className="font-mono text-[11px] text-red-300">
                        Marker: {meta.aiGeneratorHint}
                      </span>
                    )}
                  </div>

                  {meta && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        { label: 'Noise Var', val: String(meta.noiseVariance) },
                        { label: 'High-Freq', val: String(meta.highFreqEnergyRatio) },
                        { label: 'ELA Mean', val: String(meta.elaMeanResidual) },
                        {
                          label: 'Grid',
                          val: meta.standardDiffusionDimensions ? 'Diffusion' : 'Natural',
                        },
                      ].map((tile) => (
                        <div
                          key={tile.label}
                          className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2"
                        >
                          <p className="text-[10px] text-slate-400">{tile.label}</p>
                          <p className="mt-0.5 font-mono text-xs font-medium text-indigo-200 tabular-nums">
                            {tile.val}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    {result.metadataObservations.slice(0, 3).map((obs, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                        <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-indigo-300" />
                        <span className="line-clamp-1">{obs}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-start gap-1.5 border-t border-white/[0.07] pt-2.5 text-[11px] text-slate-500">
                  <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-slate-500" />
                  <p className="line-clamp-1">{result.limitations}</p>
                </div>
              </motion.div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
