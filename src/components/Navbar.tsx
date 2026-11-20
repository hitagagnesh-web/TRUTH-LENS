import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User,
  Camera,
  Video,
  Mic,
  FileText,
  Network,
  FileCheck2,
  ArrowUpRight,
} from 'lucide-react';
import type { MediaModuleId, NavSectionId } from '../types/forensics';

interface NavbarProps {
  activeSection: NavSectionId;
  onNavigate: (section: NavSectionId) => void;
  onSelectMediaModule: (mode: MediaModuleId) => void;
}

const NAV_ITEMS: { id: NavSectionId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'verify', label: 'Modules' },
  { id: 'teie', label: 'TEIE Engine' },
  { id: 'report', label: 'Report' },
];

const QUICK_MODULES: { id: MediaModuleId; label: string; Icon: typeof Mic }[] = [
  { id: 'audio', label: 'Audio Forensics', Icon: Mic },
  { id: 'video', label: 'Video Forensics', Icon: Video },
  { id: 'image', label: 'Image Forensics', Icon: Camera },
  { id: 'text', label: 'Text Forensics', Icon: FileText },
];

export function Navbar({ activeSection, onNavigate, onSelectMediaModule }: NavbarProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [profileOpen]);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 px-5 pt-5 sm:px-8 sm:pt-6">
      <div className="mx-auto flex max-w-[1380px] items-center justify-between gap-4 sm:gap-8">
        {/* Zone 1: Clean single-line TruthLens wordmark with magnifier icon */}
        <a
          href="#home"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('home');
          }}
          className="pointer-events-auto inline-flex items-center gap-2.5 rounded-md text-lg font-semibold tracking-[-0.02em] text-white transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 whitespace-nowrap shrink-0"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-5 w-5 shrink-0 text-white"
            aria-hidden="true"
          >
            <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6" />
            <line x1="15.5" y1="15.5" x2="20" y2="20" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            <circle cx="10.5" cy="10.5" r="1.5" fill="currentColor" />
          </svg>
          <span>TruthLens</span>
        </a>

        {/* Zone 2: Frosted glassmorphic pill navigation links */}
        <nav
          aria-label="Primary navigation"
          className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.06] p-1 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`relative rounded-full px-3.5 py-1.5 text-xs font-medium tracking-[0.01em] transition-colors duration-200 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 sm:px-5 sm:py-2 sm:text-sm ${
                  isActive ? 'text-[#0B0F19]' : 'text-slate-300 hover:text-white'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="activeNavPill"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-full bg-white shadow-[0_2px_10px_rgba(255,255,255,0.2)]"
                  />
                )}
                <span className="relative z-10">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Analyst Workspace Quick Switcher */}
        <div ref={menuRef} className="pointer-events-auto relative shrink-0">
          <button
            type="button"
            onClick={() => setProfileOpen((prev) => !prev)}
            aria-label="Analyst workspace menu"
            aria-expanded={profileOpen}
            className={`flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-200 backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${
              profileOpen
                ? 'border-white/30 bg-white/15 text-white'
                : 'border-white/10 bg-white/[0.06] text-slate-200 hover:border-white/25 hover:bg-white/[0.12] hover:text-white'
            }`}
          >
            <User className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>

          <AnimatePresence>
            {profileOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.97 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="absolute right-0 mt-2.5 w-60 overflow-hidden rounded-2xl border border-white/12 bg-[#101629]/95 p-2 shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-xl"
              >
                <div className="border-b border-white/[0.08] px-3 py-2.5">
                  <p className="text-sm font-medium text-white">Forensic Analyst</p>
                  <p className="mt-0.5 text-xs text-slate-400">Jump to module</p>
                </div>

                <div className="py-1.5">
                  {QUICK_MODULES.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        onSelectMediaModule(id);
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.08] hover:text-white"
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon className="h-3.5 w-3.5 text-slate-400" />
                        {label}
                      </span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-slate-500" />
                    </button>
                  ))}

                  <div className="my-1 border-t border-white/[0.07]" />

                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      onNavigate('teie');
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.08] hover:text-white"
                  >
                    <span className="flex items-center gap-2.5">
                      <Network className="h-3.5 w-3.5 text-slate-400" />
                      TEIE Engine
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-slate-500" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      onNavigate('report');
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.08] hover:text-white"
                  >
                    <span className="flex items-center gap-2.5">
                      <FileCheck2 className="h-3.5 w-3.5 text-slate-400" />
                      Forensic Report
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-slate-500" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
