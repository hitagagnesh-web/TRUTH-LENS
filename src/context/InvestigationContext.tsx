import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type {
  AuditLogEntry,
  EvidenceRecord,
  MediaModuleId,
  TeieAnalysisResult,
} from '../types/forensics';

interface PendingDrop {
  moduleId: MediaModuleId;
  file: File;
  timestamp: number;
}

interface InvestigationContextValue {
  investigationId: string;
  activeModule: MediaModuleId;
  setActiveModule: (module: MediaModuleId) => void;
  isWorkbenchOpen: boolean;
  setWorkbenchOpen: (open: boolean) => void;
  openModuleWorkbench: (module: MediaModuleId) => void;
  evidenceList: EvidenceRecord[];
  upsertEvidence: (record: EvidenceRecord) => void;
  updateEvidence: (id: string, patch: Partial<EvidenceRecord>) => void;
  removeEvidence: (id: string) => void;
  auditLogs: AuditLogEntry[];
  addAuditLog: (module: EvidenceRecord['modality'] | 'teie' | 'report', action: string, detail: string) => void;
  teieResult: TeieAnalysisResult | null;
  setTeieResult: (result: TeieAnalysisResult | null) => void;
  teieMapSnapshot: string | undefined;
  setTeieMapSnapshot: (dataUrl: string | undefined) => void;
  pendingDrop: PendingDrop | null;
  dispatchDroppedFile: (moduleId: MediaModuleId, file: File) => void;
  clearPendingDrop: () => void;
  generateEvidenceId: (modality: MediaModuleId) => string;
}

const InvestigationContext = createContext<InvestigationContextValue | null>(null);

function makeInvestigationId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TL-INV-${y}${m}${d}-${rand}`;
}

export function InvestigationProvider({ children }: { children: ReactNode }) {
  const [investigationId] = useState<string>(() => makeInvestigationId());
  const [activeModule, setActiveModule] = useState<MediaModuleId>('audio');
  const [isWorkbenchOpen, setWorkbenchOpen] = useState<boolean>(false);
  const [evidenceList, setEvidenceList] = useState<EvidenceRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [teieResult, setTeieResult] = useState<TeieAnalysisResult | null>(null);
  const [teieMapSnapshot, setTeieMapSnapshot] = useState<string | undefined>(undefined);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const evidenceCounterRef = useRef<Record<MediaModuleId, number>>({
    audio: 0,
    video: 0,
    image: 0,
    text: 0,
  });

  const openModuleWorkbench = useCallback((module: MediaModuleId) => {
    setActiveModule(module);
    setWorkbenchOpen(true);
  }, []);

  const addAuditLog = useCallback(
    (module: EvidenceRecord['modality'] | 'teie' | 'report', action: string, detail: string) => {
      setAuditLogs((prev) => [
        ...prev,
        {
          timestamp: new Date().toISOString(),
          module,
          action,
          detail,
        },
      ]);
    },
    [],
  );

  const generateEvidenceId = useCallback((modality: MediaModuleId) => {
    const prefixMap: Record<MediaModuleId, string> = {
      audio: 'AUD',
      video: 'VID',
      image: 'IMG',
      text: 'TXT',
    };
    evidenceCounterRef.current[modality] += 1;
    return `EV-${prefixMap[modality]}-${String(evidenceCounterRef.current[modality]).padStart(2, '0')}`;
  }, []);

  const upsertEvidence = useCallback((record: EvidenceRecord) => {
    setEvidenceList((prev) => {
      const idx = prev.findIndex((item) => item.id === record.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = record;
        return next;
      }
      return [...prev, record];
    });
  }, []);

  const updateEvidence = useCallback((id: string, patch: Partial<EvidenceRecord>) => {
    setEvidenceList((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const removeEvidence = useCallback((id: string) => {
    setEvidenceList((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const dispatchDroppedFile = useCallback((moduleId: MediaModuleId, file: File) => {
    setActiveModule(moduleId);
    setWorkbenchOpen(true);
    setPendingDrop({ moduleId, file, timestamp: Date.now() });
  }, []);

  const clearPendingDrop = useCallback(() => {
    setPendingDrop(null);
  }, []);

  return (
    <InvestigationContext.Provider
      value={{
        investigationId,
        activeModule,
        setActiveModule,
        isWorkbenchOpen,
        setWorkbenchOpen,
        openModuleWorkbench,
        evidenceList,
        upsertEvidence,
        updateEvidence,
        removeEvidence,
        auditLogs,
        addAuditLog,
        teieResult,
        setTeieResult,
        teieMapSnapshot,
        setTeieMapSnapshot,
        pendingDrop,
        dispatchDroppedFile,
        clearPendingDrop,
        generateEvidenceId,
      }}
    >
      {children}
    </InvestigationContext.Provider>
  );
}

export function useInvestigation() {
  const ctx = useContext(InvestigationContext);
  if (!ctx) {
    throw new Error('useInvestigation must be used inside InvestigationProvider');
  }
  return ctx;
}
