import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Maximize2, Minimize2, Minus, X } from 'lucide-react';
import { useInvestigation } from '../context/InvestigationContext';
import { FORENSIC_MODULE_ROW, type MediaModuleId } from '../types/forensics';
import { ForensicModuleRow } from './ForensicModuleRow';
import { AudioForensicsModule } from './modules/AudioForensicsModule';
import { VideoForensicsModule } from './modules/VideoForensicsModule';
import { ImageForensicsModule } from './modules/ImageForensicsModule';
import { TextForensicsModule } from './modules/TextForensicsModule';

export function VerificationWorkspace() {
  const {
    activeModule,
    setActiveModule,
    isWorkbenchOpen,
    setWorkbenchOpen,
    openModuleWorkbench,
    investigationId,
    evidenceList,
  } = useInvestigation();

  const [isExpanded, setIsExpanded] = useState(false);

  const handleSelectModule = (id: MediaModuleId) => {
    openModuleWorkbench(id);
  };

  useEffect(() => {
    if (!isWorkbenchOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWorkbenchOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isWorkbenchOpen, setWorkbenchOpen]);

  const activeMeta = FORENSIC_MODULE_ROW.find((m) => m.id === activeModule);

  const popupModal = (
    <AnimatePresence>
      {isWorkbenchOpen && (
        <motion.div
          key="macos-workbench-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          onClick={() => setWorkbenchOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`${activeMeta?.title ?? 'Forensic'} Workbench Window`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#040712]/55 p-3 backdrop-blur-2xl sm:p-6 md:p-8"
        >
          <motion.div
            key="macos-workbench-window"
            initial={{ opacity: 0, scale: 0.92, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 14 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className={`relative flex w-full flex-col overflow-hidden rounded-[26px] border border-white/[0.16] bg-[#0D1324]/84 shadow-[0_36px_110px_rgba(0,0,0,0.82),inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-3xl transition-[max-width,max-height] duration-300 ease-out ${
              isExpanded ? 'max-h-[94vh] max-w-[96vw]' : 'max-h-[88vh] max-w-[1280px]'
            }`}
          >
            {/* macOS Frosted Window Title Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.09] bg-white/[0.035] px-4 py-3 sm:px-6">
              {/* Left: macOS Traffic Light Window Controls */}
              <div className="group flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWorkbenchOpen(false)}
                  aria-label="Close window"
                  title="Close"
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#FF5F57] text-[#4D0000] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.25)] transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                >
                  <X className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2.6} />
                </button>
                <button
                  type="button"
                  onClick={() => setWorkbenchOpen(false)}
                  aria-label="Minimize window"
                  title="Minimize"
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#FEBC2E] text-[#5C3D00] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.25)] transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                >
                  <Minus className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2.6} />
                </button>
                <button
                  type="button"
                  onClick={() => setIsExpanded((prev) => !prev)}
                  aria-label={isExpanded ? 'Restore window size' : 'Expand window'}
                  title={isExpanded ? 'Restore size' : 'Expand'}
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#28C840] text-[#004D0F] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.25)] transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                >
                  {isExpanded ? (
                    <Minimize2 className="h-2 w-2 opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2.6} />
                  ) : (
                    <Maximize2 className="h-2 w-2 opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2.6} />
                  )}
                </button>
              </div>

              {/* Center: Active Window Title & Pipeline Metadata */}
              <div className="flex min-w-0 items-center gap-2.5 text-center">
                <span className="truncate text-sm font-semibold tracking-[-0.01em] text-white">
                  {activeMeta?.title}
                </span>
                <span className="hidden text-slate-600 md:inline">·</span>
                <span className="hidden truncate font-mono text-[11px] text-indigo-300/85 md:inline">
                  {activeMeta?.pipelineTag}
                </span>
              </div>

              {/* Right: Quick Module Switcher & Close Button */}
              <div className="flex items-center gap-2">
                <div className="hidden items-center gap-0.5 rounded-xl border border-white/[0.08] bg-white/[0.04] p-0.5 sm:flex">
                  {FORENSIC_MODULE_ROW.map((mod) => {
                    const selected = mod.id === activeModule;
                    return (
                      <button
                        key={mod.id}
                        type="button"
                        onClick={() => setActiveModule(mod.id)}
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          selected
                            ? 'bg-white/15 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {mod.shortLabel}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setWorkbenchOpen(false)}
                  aria-label="Close inspection window"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-300 transition-colors hover:bg-white/[0.12] hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Scrollable Forensic Module Content */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-7">
              {activeModule === 'audio' && <AudioForensicsModule />}
              {activeModule === 'video' && <VideoForensicsModule />}
              {activeModule === 'image' && <ImageForensicsModule />}
              {activeModule === 'text' && <TextForensicsModule />}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <section
      id="verify"
      className="relative mx-auto flex w-full max-w-[1400px] flex-col px-5 pt-20 pb-14 sm:px-8"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-24 h-[380px] w-[760px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(79,98,196,0.13)_0%,rgba(22,27,51,0.18)_48%,transparent_75%)] blur-3xl"
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"
      >
        <div>
          <p className="text-xs font-medium tracking-[0.14em] text-indigo-300/85 uppercase">
            Verification Modules
          </p>
          <h2 className="mt-2 text-balance text-2xl font-semibold tracking-[-0.02em] text-white sm:text-3xl">
            Media Inspection Workbench
          </h2>
        </div>
      </motion.div>

      {/* 4-Card Horizontal Flip Row (Audio, Video, Image, Text) */}
      <div className="relative z-10">
        <ForensicModuleRow onSelectModule={handleSelectModule} />
      </div>

      {/* macOS-style Popped-Up Forensic Workbench Window */}
      {typeof document !== 'undefined' ? createPortal(popupModal, document.body) : popupModal}
    </section>
  );
}
