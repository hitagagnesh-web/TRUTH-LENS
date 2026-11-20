import { useCallback, useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { VerificationWorkspace } from './components/VerificationWorkspace';
import { TeieModule } from './components/modules/TeieModule';
import { ForensicReportModule } from './components/modules/ForensicReportModule';
import { InvestigationProvider, useInvestigation } from './context/InvestigationContext';
import { MagnifierProvider } from './context/MagnifierContext';
import type { MediaModuleId, NavSectionId } from './types/forensics';

const SECTION_IDS: NavSectionId[] = ['home', 'verify', 'teie', 'report'];

function TruthLensShell() {
  const [activeSection, setActiveSection] = useState<NavSectionId>('home');
  const { openModuleWorkbench } = useInvestigation();

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    const ratios = new Map<NavSectionId, number>();

    SECTION_IDS.forEach((id) => {
      const element = document.getElementById(id);
      if (!element) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            ratios.set(id, entry.intersectionRatio);
          });

          let bestSection: NavSectionId = 'home';
          let bestRatio = -1;
          SECTION_IDS.forEach((secId) => {
            const ratio = ratios.get(secId) ?? 0;
            if (ratio > bestRatio) {
              bestRatio = ratio;
              bestSection = secId;
            }
          });

          if (bestRatio > 0) {
            setActiveSection(bestSection);
          }
        },
        {
          threshold: [0, 0.15, 0.35, 0.55, 0.75],
          rootMargin: '-12% 0px -30% 0px',
        },
      );

      observer.observe(element);
      observers.push(observer);
    });

    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, []);

  const handleNavigate = useCallback((section: NavSectionId) => {
    setActiveSection(section);
    const target = document.getElementById(section);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleSelectMediaModule = useCallback(
    (mode: MediaModuleId) => {
      openModuleWorkbench(mode);
      setActiveSection('verify');
      const target = document.getElementById('verify');
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [openModuleWorkbench],
  );

  return (
    <div className="min-h-screen bg-[#0B0F19] text-slate-100">
      <Navbar
        activeSection={activeSection}
        onNavigate={handleNavigate}
        onSelectMediaModule={handleSelectMediaModule}
      />

      <main>
        <HeroSection onScrollToVerify={() => handleNavigate('verify')} />
        <VerificationWorkspace />
        <TeieModule />
        <ForensicReportModule />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <InvestigationProvider>
      <MagnifierProvider>
        <TruthLensShell />
      </MagnifierProvider>
    </InvestigationProvider>
  );
}
