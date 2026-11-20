import { useEffect, useRef } from 'react';
import {
  Activity,
  AudioWaveform,
  Binary,
  Cpu,
  EyeOff,
  FileSearch,
  Fingerprint,
  KeyRound,
  Lock,
  QrCode,
  ScanLine,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useMagnifier } from '../context/MagnifierContext';
import { UrlTextDetector } from './UrlTextDetector';

interface HeroSectionProps {
  onScrollToVerify: () => void;
}

interface ForensicArtifact {
  id: string;
  Icon: LucideIcon;
  xPercent: number;
  yPercent: number;
  size: number;
  rotate: number;
  code: string;
  compact?: boolean;
}

const SCATTERED_ARTIFACTS: ForensicArtifact[] = [
  // Outer stage forensic artifacts
  { id: 'fingerprint', Icon: Fingerprint, xPercent: 18, yPercent: 25, size: 42, rotate: -14, code: 'BIO-7F' },
  { id: 'lock', Icon: Lock, xPercent: 34, yPercent: 21, size: 34, rotate: 9, code: 'SHA-256' },
  { id: 'shield', Icon: ShieldCheck, xPercent: 67, yPercent: 22, size: 40, rotate: 12, code: 'C2PA' },
  { id: 'binary', Icon: Binary, xPercent: 82, yPercent: 29, size: 36, rotate: -11, code: '0x9A4E' },
  { id: 'waveform', Icon: AudioWaveform, xPercent: 12, yPercent: 52, size: 42, rotate: -7, code: 'AASIST' },
  { id: 'scan', Icon: ScanSearch, xPercent: 88, yPercent: 53, size: 40, rotate: 8, code: 'ELA-MAP' },
  { id: 'cpu', Icon: Cpu, xPercent: 25, yPercent: 74, size: 38, rotate: 15, code: 'TEIE' },
  { id: 'qrcode', Icon: QrCode, xPercent: 65, yPercent: 76, size: 36, rotate: -13, code: 'REPORT' },
  { id: 'key', Icon: KeyRound, xPercent: 77, yPercent: 71, size: 32, rotate: 17, code: 'NLI-08' },
  { id: 'filesearch', Icon: FileSearch, xPercent: 44, yPercent: 77, size: 34, rotate: -9, code: 'EXIF' },

  // Forensic artifacts positioned directly across & in between the letters of TRUTHLENS
  { id: 'between-tr', Icon: ScanLine, xPercent: 21, yPercent: 48, size: 28, rotate: -8, code: 'HZ-48K', compact: true },
  { id: 'between-ru', Icon: Activity, xPercent: 31, yPercent: 54, size: 28, rotate: 6, code: 'MEL-64', compact: true },
  { id: 'between-ut', Icon: ShieldAlert, xPercent: 41, yPercent: 45, size: 28, rotate: -10, code: 'GAN-CHK', compact: true },
  { id: 'between-th', Icon: Sparkles, xPercent: 50, yPercent: 52, size: 30, rotate: 8, code: 'DIFF-01', compact: true },
  { id: 'between-hl', Icon: Binary, xPercent: 59, yPercent: 46, size: 28, rotate: -6, code: 'VIT-B4', compact: true },
  { id: 'between-le', Icon: EyeOff, xPercent: 68, yPercent: 54, size: 28, rotate: 10, code: 'NO-EXIF', compact: true },
  { id: 'between-en', Icon: Fingerprint, xPercent: 77, yPercent: 47, size: 28, rotate: -9, code: 'SPLICE', compact: true },
  { id: 'between-ns', Icon: Cpu, xPercent: 84, yPercent: 53, size: 26, rotate: 7, code: 'NLI-94', compact: true },
];

export function HeroSection({ onScrollToVerify: _onScrollToVerify }: HeroSectionProps) {
  const heroRef = useRef<HTMLElement>(null);
  const { registerHeroElement } = useMagnifier();

  useEffect(() => {
    registerHeroElement(heroRef.current);
    return () => registerHeroElement(null);
  }, [registerHeroElement]);

  return (
    <section
      id="home"
      ref={heroRef}
      className="truthlens-hero-bg relative flex min-h-screen w-full flex-col justify-between overflow-hidden pt-24 pb-10"
    >
      {/* Subtle soft ambient indigo luminescence behind typography */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[540px] w-[540px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(99,122,245,0.2)_0%,rgba(55,68,140,0.12)_42%,transparent_72%)] blur-3xl sm:h-[680px] sm:w-[680px]"
      />

      <div className="h-4 shrink-0" aria-hidden="true" />

      {/* Centerpiece: Unobstructed edge-to-edge condensed TRUTHLENS typography (T H fully visible) */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-2">
        <div className="relative flex w-full items-center justify-center">
          <h1 className="font-condensed pointer-events-none w-full select-none bg-gradient-to-b from-white via-white/95 to-slate-300/80 bg-clip-text text-center text-[21.5vw] font-extrabold uppercase leading-[0.86] tracking-[-0.025em] text-transparent sm:text-[20.8vw] lg:text-[19.8vw]">
            TRUTHLENS
          </h1>
        </div>
      </div>

      {/* HIDDEN FORENSIC LAYER — Revealed inside the magnifier everywhere, including between letters of TRUTHLENS */}
      <div
        aria-hidden="true"
        className="forensic-lens-mask pointer-events-none absolute inset-0 z-20"
      >
        <div className="absolute inset-0 bg-[radial-gradient(rgba(165,190,255,0.18)_1px,transparent_1px)] [background-size:24px_24px] opacity-55" />
        {/* Horizontal optical calibration axis running across the TRUTHLENS letter line */}
        <div className="absolute inset-x-8 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-indigo-300/40 to-transparent" />
        <div className="absolute left-1/2 top-1/2 h-[340px] w-[340px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-indigo-300/25 sm:h-[460px] sm:w-[460px]" />
        <div className="absolute left-1/2 top-1/2 h-[540px] w-[540px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-indigo-200/18 sm:h-[680px] sm:w-[680px]" />

        {SCATTERED_ARTIFACTS.map(({ id, Icon, xPercent, yPercent, size, rotate, code, compact }) => (
          <div
            key={id}
            style={{
              left: `${xPercent}%`,
              top: `${yPercent}%`,
              transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
            }}
            className="absolute flex flex-col items-center gap-1"
          >
            <div
              className={`relative flex items-center justify-center border border-indigo-200/45 bg-[#0C1329]/80 shadow-[0_0_24px_rgba(129,140,248,0.55),inset_0_0_12px_rgba(255,255,255,0.16)] backdrop-blur-sm ${
                compact ? 'rounded-xl p-2.5' : 'rounded-2xl p-3.5'
              }`}
            >
              <Icon
                size={size}
                strokeWidth={1.5}
                className="text-indigo-100 drop-shadow-[0_0_12px_rgba(191,219,254,0.9)]"
              />
            </div>
            <span className="rounded bg-[#0B0F19]/80 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.12em] text-indigo-100 drop-shadow-[0_0_8px_rgba(165,195,255,0.75)]">
              {code}
            </span>
          </div>
        ))}
      </div>

      {/* Bottom URL & Text AI Content Detector Section (replaces old bottom scroll banner) */}
      <UrlTextDetector />
    </section>
  );
}
