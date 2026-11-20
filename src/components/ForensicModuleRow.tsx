import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Camera, Download, FileText, Mic, Upload, Video } from 'lucide-react';
import { FORENSIC_MODULE_ROW, type MediaModuleId } from '../types/forensics';
import { useMagnifier } from '../context/MagnifierContext';
import { useInvestigation } from '../context/InvestigationContext';
import { generateModuleForensicPdfReport } from '../utils/pdfReportGenerator';

const MODULE_ICONS: Record<MediaModuleId, typeof Mic> = {
  audio: Mic,
  video: Video,
  image: Camera,
  text: FileText,
};

function ModuleFrontAnimation({ id, illuminated }: { id: MediaModuleId; illuminated: boolean }) {
  if (id === 'audio') {
    const heights = [36, 62, 48, 86, 54, 96, 72, 44, 88, 66, 94, 52, 78, 42, 68, 38];
    return (
      <div className="relative flex h-28 w-full items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-white/[0.06] bg-[#070B16] px-4">
        {heights.map((h, idx) => {
          const isRedPeak = idx >= 9 && idx <= 11;
          return (
            <span
              key={idx}
              style={{
                height: `${h}%`,
                animationDelay: `${idx * 90}ms`,
              }}
              className={`animate-wave-bar w-1.5 rounded-full transition-colors duration-300 ${
                isRedPeak
                  ? illuminated
                    ? 'bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.9)]'
                    : 'bg-red-500/80'
                  : illuminated
                    ? 'bg-indigo-300 shadow-[0_0_10px_rgba(165,180,252,0.7)]'
                    : 'bg-indigo-400/55'
              }`}
            />
          );
        })}
      </div>
    );
  }

  if (id === 'video') {
    return (
      <div className="relative flex h-28 w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-white/[0.06] bg-[#070B16] px-4">
        {[0, 1, 2].map((frame) => (
          <div
            key={frame}
            className={`relative flex h-16 flex-1 items-center justify-center rounded-lg border ${
              frame === 1
                ? 'border-red-400/45 bg-red-500/[0.08]'
                : 'border-white/10 bg-white/[0.03]'
            }`}
          >
            <div className="h-7 w-7 rounded-full border border-dashed border-indigo-300/45" />
            <span className="absolute bottom-1 right-1.5 font-mono text-[8px] text-slate-400">
              0{frame + 1}
            </span>
          </div>
        ))}
        {/* Scanning laser sweep */}
        <div
          className={`animate-scan-x pointer-events-none absolute inset-y-2 left-0 w-10 bg-gradient-to-r from-transparent via-indigo-400/35 to-transparent ${
            illuminated ? 'opacity-100' : 'opacity-65'
          }`}
        />
      </div>
    );
  }

  if (id === 'image') {
    return (
      <div className="relative flex h-28 w-full flex-col justify-center overflow-hidden rounded-xl border border-white/[0.06] bg-[#070B16] p-3">
        <div className="grid grid-cols-6 gap-1.5">
          {Array.from({ length: 18 }).map((_, idx) => {
            const hot = idx === 7 || idx === 8 || idx === 13;
            return (
              <div
                key={idx}
                style={{ animationDelay: `${idx * 70}ms` }}
                className={`animate-token-shimmer h-4 rounded-sm ${
                  hot
                    ? 'bg-red-500/55 ring-1 ring-red-400/50'
                    : illuminated
                      ? 'bg-indigo-400/25'
                      : 'bg-white/[0.06]'
                }`}
              />
            );
          })}
        </div>
        <div className="animate-scan-y pointer-events-none absolute inset-x-2 top-2 h-5 bg-gradient-to-b from-transparent via-indigo-300/30 to-transparent" />
      </div>
    );
  }

  // Text Forensics front animation
  return (
    <div className="relative flex h-28 w-full flex-col justify-center gap-2 overflow-hidden rounded-xl border border-white/[0.06] bg-[#070B16] px-4 py-3">
      {[
        { w: '88%', flag: false },
        { w: '72%', flag: true },
        { w: '94%', flag: false },
        { w: '64%', flag: true },
      ].map((line, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            style={{ width: line.w, animationDelay: `${i * 180}ms` }}
            className={`animate-token-shimmer h-2 rounded-full ${
              line.flag
                ? 'bg-amber-400/65'
                : illuminated
                  ? 'bg-indigo-300/55'
                  : 'bg-white/15'
            }`}
          />
        </div>
      ))}
    </div>
  );
}

interface FlipCardProps {
  mod: (typeof FORENSIC_MODULE_ROW)[number];
  isActive: boolean;
  isMagnified: boolean;
  evidenceCount: number;
  analyzedCount: number;
  onSelect: () => void;
  onFileDrop: (file: File) => void;
  onDownloadReport: () => void;
}

function FlipModuleCard({
  mod,
  isActive,
  isMagnified,
  evidenceCount,
  analyzedCount,
  onSelect,
  onFileDrop,
  onDownloadReport,
}: FlipCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const { registerModuleAnchor } = useMagnifier();

  useEffect(() => {
    registerModuleAnchor(mod.id, cardRef.current);
    return () => registerModuleAnchor(mod.id, null);
  }, [mod.id, registerModuleAnchor]);

  // Brief optical lock on the front animation when the magnifier arrives, then flip 180° to reveal details
  useEffect(() => {
    if (dragOver) {
      setIsFlipped(true);
      return;
    }
    if (isMagnified) {
      const timer = window.setTimeout(() => setIsFlipped(true), 260);
      return () => window.clearTimeout(timer);
    }
    const resetTimer = window.setTimeout(() => setIsFlipped(false), 180);
    return () => window.clearTimeout(resetTimer);
  }, [isMagnified, dragOver]);

  const Icon = MODULE_ICONS[mod.id];

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileDrop(file);
    }
  };

  return (
    <div
      ref={cardRef}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className="flip-perspective h-[272px] w-full"
    >
      <div
        className={`flip-inner relative h-full w-full ${isFlipped ? 'is-flipped' : ''}`}
      >
        {/* FRONT FACE: Visually appealing modality animation */}
        <div
          role="button"
          tabIndex={0}
          onClick={onSelect}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect();
            }
          }}
          className={`flip-face absolute inset-0 flex cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border p-5 transition-colors duration-200 ${
            isActive
              ? 'border-indigo-300/60 bg-[#121931] shadow-[0_14px_40px_rgba(0,0,0,0.5)]'
              : isMagnified
                ? 'border-indigo-300/45 bg-[#10172C] shadow-[0_14px_36px_rgba(99,102,241,0.2)]'
                : 'border-white/[0.09] bg-[#0D1323]/95'
          }`}
        >
          <div
            aria-hidden="true"
            className={`module-lens-glow pointer-events-none absolute inset-0 transition-opacity duration-200 ${
              isMagnified ? 'opacity-100' : 'opacity-0'
            }`}
          />

          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-indigo-200">
                <Icon className="h-4 w-4" strokeWidth={1.7} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white whitespace-nowrap">
                  {mod.title}
                </h3>
                <p className="text-[11px] text-slate-400">{mod.shortLabel} Signal</p>
              </div>
            </div>
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
              {evidenceCount > 0 ? `${analyzedCount}/${evidenceCount}` : 'Ready'}
            </span>
          </div>

          <div className="relative z-10 my-auto">
            <ModuleFrontAnimation id={mod.id} illuminated={isMagnified || isActive} />
          </div>

          <div className="relative z-10 flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-[11px] text-slate-400">
            <span className="font-mono">{mod.acceptedFormats}</span>
            <span className="text-indigo-300/80">
              {isMagnified ? 'Revealing...' : 'Hover lens'}
            </span>
          </div>
        </div>

        {/* BACK FACE: Flips open when magnifier comes upon the card */}
        <div
          role="button"
          tabIndex={0}
          onClick={onSelect}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect();
            }
          }}
          className={`flip-face flip-face-back absolute inset-0 flex cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border p-5 ${
            dragOver
              ? 'border-indigo-400 bg-indigo-500/20'
              : isActive
                ? 'border-indigo-300/65 bg-[#131C36] shadow-[0_18px_46px_rgba(0,0,0,0.58)]'
                : 'border-indigo-300/40 bg-[#111932] shadow-[0_18px_46px_rgba(0,0,0,0.52)]'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-white">{mod.title}</h3>
            </div>
            <span className="font-mono text-[11px] text-slate-300 tabular-nums">
              {mod.acceptedFormats}
            </span>
          </div>

          <div className="flex items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="inline-flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 rounded-xl bg-white px-2.5 py-2 text-[11px] font-semibold text-[#0B0F19] transition-opacity hover:opacity-90 whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5 shrink-0" />
              <span>Upload</span>
              <span className="hidden xl:inline">{mod.shortLabel}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
              }}
              className="cursor-pointer rounded-xl border border-white/15 bg-white/[0.06] px-2.5 py-2 text-[11px] font-medium text-white transition-colors hover:bg-white/[0.14] whitespace-nowrap"
            >
              Inspect
            </button>
            <button
              type="button"
              disabled={analyzedCount === 0}
              onClick={(e) => {
                e.stopPropagation();
                onDownloadReport();
              }}
              title={
                analyzedCount > 0
                  ? `Download ${mod.title} PDF report (${analyzedCount} analyzed)`
                  : `Analyze ${mod.shortLabel.toLowerCase()} evidence first to download report`
              }
              aria-label={`Download ${mod.title} analysis report`}
              className="inline-flex cursor-pointer items-center justify-center gap-1 rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-2.5 py-2 text-[11px] font-medium text-emerald-200 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-slate-500 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline lg:hidden xl:inline">Download</span>
              <span className="sm:hidden lg:inline xl:hidden">PDF</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={mod.acceptAttr}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFileDrop(file);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface ForensicModuleRowProps {
  onSelectModule: (id: MediaModuleId) => void;
}

export function ForensicModuleRow({ onSelectModule }: ForensicModuleRowProps) {
  const { hoveredModule } = useMagnifier();
  const {
    investigationId,
    activeModule,
    isWorkbenchOpen,
    evidenceList,
    teieResult,
    teieMapSnapshot,
    auditLogs,
    addAuditLog,
    dispatchDroppedFile,
  } = useInvestigation();

  return (
    <div className="w-full">
      {/* 4 Core Forensic Modules in One Horizontal Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FORENSIC_MODULE_ROW.map((mod) => {
          const matching = evidenceList.filter((e) => e.modality === mod.id);
          const analyzedCount = matching.filter((e) => e.status === 'analyzed').length;
          return (
            <FlipModuleCard
              key={mod.id}
              mod={mod}
              isActive={isWorkbenchOpen && activeModule === mod.id}
              isMagnified={hoveredModule === mod.id}
              evidenceCount={matching.length}
              analyzedCount={analyzedCount}
              onSelect={() => onSelectModule(mod.id)}
              onFileDrop={(file) => {
                onSelectModule(mod.id);
                dispatchDroppedFile(mod.id, file);
              }}
              onDownloadReport={() => {
                if (analyzedCount === 0) return;
                generateModuleForensicPdfReport({
                  investigationId,
                  modality: mod.id,
                  evidenceList,
                  teieResult,
                  auditLogs,
                  teieMapDataUrl: teieMapSnapshot,
                });
                addAuditLog(
                  mod.id,
                  'EXPORT_PDF',
                  `Downloaded ${mod.title} PDF report (${analyzedCount} analyzed item(s))`,
                );
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
