import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Upload,
  Volume2,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useInvestigation } from '../../context/InvestigationContext';
import type { AudioAnalysisResult, AudioDspData, EvidenceRecord } from '../../types/forensics';
import {
  computeSha256,
  formatBytes,
  formatTimestamp,
  processAudioDsp,
} from '../../utils/forensicDsp';
import { generateModuleForensicPdfReport } from '../../utils/pdfReportGenerator';

// Helper to synthesize a genuine WAV file in-browser when user clicks "Load Test Recording"
// Contains a natural harmonic segment followed by a vocoder-bandlimited robotic splice so the real DSP + Gemini pipeline inspects real audio bytes.
function createDiagnosticSampleWav(): File {
  const sampleRate = 22050;
  const durationSec = 8;
  const numSamples = sampleRate * durationSec;
  const pcm = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    if (t >= 3.2 && t <= 5.6) {
      // Synthetic vocoder-like flat harmonic buzz with abrupt high-frequency cutoff & metallic phase lock
      const f0 = 148;
      pcm[i] =
        0.26 * Math.sin(2 * Math.PI * f0 * t) +
        0.18 * Math.sin(2 * Math.PI * f0 * 2 * t) +
        0.12 * Math.sin(2 * Math.PI * f0 * 3 * t) +
        0.04 * Math.sin(2 * Math.PI * 1950 * t);
    } else {
      // Natural-like modulated speech prosody envelope + warm breath noise
      const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.3 * t);
      const pitch = 132 + 18 * Math.sin(2 * Math.PI * 0.9 * t);
      const breath = (Math.random() * 2 - 1) * 0.035;
      pcm[i] =
        env *
          (0.28 * Math.sin(2 * Math.PI * pitch * t) +
            0.14 * Math.sin(2 * Math.PI * pitch * 2.02 * t) +
            0.06 * Math.sin(2 * Math.PI * pitch * 4.1 * t)) +
        breath;
    }
  }

  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new File([buffer], 'diagnostic_splice_sample.wav', { type: 'audio/wav' });
}

export function AudioForensicsModule() {
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

  const audioEvidence = evidenceList.filter((e) => e.modality === 'audio');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeRecord =
    audioEvidence.find((e) => e.id === selectedId) ?? audioEvidence[audioEvidence.length - 1] ?? null;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playingSegmentIdx, setPlayingSegmentIdx] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const specCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const segmentWindowRef = useRef<{ index: number; start: number; end: number } | null>(null);
  const seekPendingRef = useRef(false);
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  // Fallback Web Audio player if browser <audio> cannot decode a container directly
  const fallbackCtxRef = useRef<AudioContext | null>(null);
  const fallbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);

  const stopFallbackAudio = useCallback(() => {
    if (fallbackSourceRef.current) {
      try {
        fallbackSourceRef.current.onended = null;
        fallbackSourceRef.current.stop();
      } catch {
        // already stopped
      }
      fallbackSourceRef.current = null;
    }
    if (fallbackTimerRef.current !== null) {
      window.clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const playViaWebAudioFallback = useCallback(
    async (startSec: number, endSec: number | null, segIndex: number | null) => {
      if (!activeRecord?.objectUrl) return;
      stopFallbackAudio();

      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!fallbackCtxRef.current || fallbackCtxRef.current.state === 'closed') {
        fallbackCtxRef.current = new Ctx();
      }
      const ctx = fallbackCtxRef.current;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const resp = await fetch(activeRecord.objectUrl);
      const arr = await resp.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arr);

      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(ctx.destination);

      const safeStart = Math.max(0, Math.min(decoded.duration - 0.05, startSec));
      const playDuration =
        endSec !== null ? Math.max(0.05, Math.min(decoded.duration - safeStart, endSec - safeStart)) : undefined;

      const startedAtCtx = ctx.currentTime;
      setCurrentTime(safeStart);
      setIsPlaying(true);
      setPlayingSegmentIdx(segIndex);

      fallbackTimerRef.current = window.setInterval(() => {
        const elapsed = ctx.currentTime - startedAtCtx;
        setCurrentTime(Math.min(decoded.duration, safeStart + elapsed));
      }, 50);

      source.onended = () => {
        if (fallbackTimerRef.current !== null) {
          window.clearInterval(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }
        fallbackSourceRef.current = null;
        setIsPlaying(false);
        setPlayingSegmentIdx(null);
      };

      fallbackSourceRef.current = source;
      if (playDuration !== undefined) {
        source.start(0, safeStart, playDuration);
      } else {
        source.start(0, safeStart);
      }
    },
    [activeRecord?.objectUrl, stopFallbackAudio],
  );

  const handleAnalyzeAudio = useCallback(
    async (file: File) => {
      const id = generateEvidenceId('audio');
      const objectUrl = URL.createObjectURL(file);
      const ext = file.name.split('.').pop()?.toUpperCase() || 'AUDIO';
      const uploadTimestamp = new Date().toISOString();
      const buffer = await file.arrayBuffer();
      const dspPromise = processAudioDsp(file, buffer);
      dspPromise.catch(() => undefined);
      const sha256 = await computeSha256(buffer);

      const initialRecord: EvidenceRecord = {
        id,
        modality: 'audio',
        fileName: file.name,
        format: ext,
        mimeType: file.type || 'audio/mpeg',
        sizeBytes: file.size,
        uploadTimestamp,
        sha256,
        objectUrl,
        status: 'processing',
      };
      upsertEvidence(initialRecord);
      setSelectedId(id);
      addAuditLog('audio', 'UPLOAD', `Uploaded ${file.name} (${formatBytes(file.size)}) · SHA-256 ${sha256.slice(0, 12)}...`);

      try {
        const { dsp, audioBase64, mimeType } = await dspPromise;
        updateEvidence(id, {
          durationSec: dsp.durationSec,
          audioDsp: dsp,
        });

        const response = await fetch('/api/forensics/audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64,
            mimeType,
            fileName: file.name,
            durationSec: dsp.durationSec,
            dspSummary: dsp.summary,
            segments: dsp.segments,
          }),
        });

        const rawText = await response.text();
        let payload: (AudioAnalysisResult & { error?: string }) | null = null;
        try {
          payload = JSON.parse(rawText) as AudioAnalysisResult & { error?: string };
        } catch {
          throw new Error(
            rawText.trim().slice(0, 220) || `Server returned HTTP ${response.status}`,
          );
        }
        if (!response.ok || payload?.error) {
          throw new Error(payload?.error || `Audio forensic inference failed (HTTP ${response.status}).`);
        }

        updateEvidence(id, {
          status: 'analyzed',
          audioResult: payload,
        });
        addAuditLog(
          'audio',
          'ANALYZED',
          `AASIST suspicion ${payload.overallSuspicionScore}/100 · ${payload.segments.filter((s) => s.verdict === 'suspicious').length} suspicious segments`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Audio processing error.';
        updateEvidence(id, { status: 'error', errorMessage: msg });
        addAuditLog('audio', 'ERROR', msg);
      }
    },
    [addAuditLog, generateEvidenceId, updateEvidence, upsertEvidence],
  );

  // Pick up files dragged directly onto the Audio card in the row
  useEffect(() => {
    if (pendingDrop && pendingDrop.moduleId === 'audio') {
      const f = pendingDrop.file;
      clearPendingDrop();
      void handleAnalyzeAudio(f);
    }
  }, [pendingDrop, clearPendingDrop, handleAnalyzeAudio]);

  // Reset playback state when switching between audio evidence records
  useEffect(() => {
    stopFallbackAudio();
    segmentWindowRef.current = null;
    seekPendingRef.current = false;
    setIsPlaying(false);
    setPlayingSegmentIdx(null);
    setCurrentTime(0);
  }, [activeRecord?.id, stopFallbackAudio]);

  const togglePlay = () => {
    const el = audioElRef.current;
    if (!el) return;

    if (isPlaying) {
      stopFallbackAudio();
      el.pause();
      segmentWindowRef.current = null;
      setPlayingSegmentIdx(null);
      setIsPlaying(false);
      return;
    }

    stopFallbackAudio();
    segmentWindowRef.current = null;
    setPlayingSegmentIdx(null);
    el.muted = false;
    el.volume = 1;
    el.play()
      .then(() => {
        setIsPlaying(true);
      })
      .catch(() => {
        void playViaWebAudioFallback(currentTime, null, null);
      });
  };

  const playSegment = (startTime: number, endTime: number, segIndex?: number) => {
    const idx = segIndex ?? null;
    if (idx !== null && playingSegmentIdx === idx && isPlaying) {
      stopFallbackAudio();
      audioElRef.current?.pause();
      segmentWindowRef.current = null;
      setPlayingSegmentIdx(null);
      setIsPlaying(false);
      return;
    }

    const el = audioElRef.current;
    stopFallbackAudio();

    if (!el) {
      void playViaWebAudioFallback(startTime, endTime, idx);
      return;
    }

    const safeStart = Math.max(0, startTime);
    const safeEnd = Math.max(safeStart + 0.1, endTime);

    segmentWindowRef.current = { index: idx ?? -1, start: safeStart, end: safeEnd };
    setPlayingSegmentIdx(idx);
    setCurrentTime(safeStart);

    el.muted = false;
    el.volume = 1;

    const startElementPlayback = () => {
      if (Math.abs(el.currentTime - safeStart) > 0.03) {
        seekPendingRef.current = true;
        el.currentTime = safeStart;
        window.setTimeout(() => {
          seekPendingRef.current = false;
        }, 160);
      } else {
        seekPendingRef.current = false;
      }

      el.play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch(() => {
          void playViaWebAudioFallback(safeStart, safeEnd, idx);
        });
    };

    if (el.readyState >= 1) {
      startElementPlayback();
    } else {
      const onLoaded = () => {
        el.removeEventListener('loadedmetadata', onLoaded);
        startElementPlayback();
      };
      el.addEventListener('loadedmetadata', onLoaded);
      el.load();
    }
  };

  // Sync audio playback progress & segment stop without premature seek-race pauses
  useEffect(() => {
    const el = audioElRef.current;
    if (!el) return;
    const onSeeked = () => {
      seekPendingRef.current = false;
    };
    const onTimeUpdate = () => {
      if (seekPendingRef.current || el.seeking) return;
      const t = el.currentTime;
      setCurrentTime(t);
      const win = segmentWindowRef.current;
      if (win && t >= win.end && t >= win.start) {
        el.pause();
        segmentWindowRef.current = null;
        setPlayingSegmentIdx(null);
        setIsPlaying(false);
      }
    };
    const onEnded = () => {
      segmentWindowRef.current = null;
      seekPendingRef.current = false;
      setPlayingSegmentIdx(null);
      setIsPlaying(false);
    };
    el.addEventListener('seeked', onSeeked);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('seeked', onSeeked);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('ended', onEnded);
    };
  }, [activeRecord?.id]);

  const barSegmentVerdicts = useMemo(() => {
    const dsp = activeRecord?.audioDsp;
    if (!dsp) return [];
    const segments = activeRecord?.audioResult?.segments ?? [];
    const barCount = dsp.waveformPeaks.length;
    const duration = Math.max(0.1, dsp.durationSec);
    const verdicts = new Array<'genuine' | 'inconclusive' | 'suspicious'>(barCount);

    for (let i = 0; i < barCount; i++) {
      const barTime = (i / barCount) * duration;
      let bestSusp = -1;
      let bestVerdict: 'genuine' | 'inconclusive' | 'suspicious' = 'genuine';
      for (let sIdx = 0; sIdx < segments.length; sIdx++) {
        const seg = segments[sIdx];
        if (barTime >= seg.startTime && barTime <= seg.endTime && seg.calibratedSuspicion > bestSusp) {
          bestSusp = seg.calibratedSuspicion;
          bestVerdict = seg.verdict;
        }
      }
      verdicts[i] = bestVerdict;
    }
    return verdicts;
  }, [activeRecord?.audioDsp, activeRecord?.audioResult?.segments]);

  // ---------------------------------------------------------------------------
  // ANIMATIC SOUNDWAVE CANVAS (Red Highlights for Fake / Suspicious Segments!)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = waveCanvasRef.current;
    const dsp = activeRecord?.audioDsp;
    if (!canvas || !dsp) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let snapshotSaved = false;

    const render = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width < 10 || height < 10) {
        animId = requestAnimationFrame(render);
        return;
      }
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Subtle background grid
      ctx.fillStyle = '#090E1B';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      const segments = activeRecord.audioResult?.segments ?? [];
      const duration = Math.max(0.1, dsp.durationSec);
      const curTime = currentTimeRef.current;
      const playingNow = isPlayingRef.current;

      // Draw shaded RED zones for detected fake/suspicious segments
      segments.forEach((seg) => {
        const x1 = (seg.startTime / duration) * width;
        const x2 = (seg.endTime / duration) * width;
        if (seg.verdict === 'suspicious') {
          const pulse = 0.14 + 0.06 * Math.sin(now * 0.005);
          ctx.fillStyle = `rgba(239, 68, 68, ${pulse.toFixed(3)})`;
          ctx.fillRect(x1, 0, Math.max(2, x2 - x1), height);

          ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(x1, 0);
          ctx.lineTo(x1, height);
          ctx.moveTo(x2, 0);
          ctx.lineTo(x2, height);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#FCA5A5';
          ctx.font = '600 10px "JetBrains Mono", monospace';
          ctx.fillText('FAKE / ANOMALY', Math.max(4, Math.min(width - 96, x1 + 6)), 14);
        } else if (seg.verdict === 'inconclusive') {
          ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
          ctx.fillRect(x1, 0, Math.max(2, x2 - x1), height);
        }
      });

      const peaks = dsp.waveformPeaks;
      const barCount = peaks.length;
      const stepX = width / barCount;
      const barWidth = Math.max(1.8, stepX * 0.62);
      const midY = height / 2;
      const melCols = dsp.melSpectrogram;
      const activeMelCol =
        playingNow && melCols.length > 0
          ? melCols[Math.min(melCols.length - 1, Math.floor((curTime / duration) * melCols.length))]
          : null;

      for (let i = 0; i < barCount; i++) {
        const barTime = (i / barCount) * duration;
        const verdict = barSegmentVerdicts[i];
        const isFake = verdict === 'suspicious';
        const isInconclusive = verdict === 'inconclusive';

        // Animatic harmonic oscillation + real Mel-band energy boost during playback
        const phase = now * 0.0045 + i * 0.24;
        const liveBoost = activeMelCol ? activeMelCol[i % activeMelCol.length] * 0.28 : 0;
        const idleWave = 0.88 + 0.14 * Math.sin(phase);
        const amp = Math.min(0.96, Math.max(0.06, peaks[i] * idleWave + liveBoost));
        const barH = amp * (height * 0.78);

        const x = i * stepX;
        const played = barTime <= curTime;

        if (isFake) {
          ctx.fillStyle = played ? '#EF4444' : '#DC2626';
          ctx.shadowColor = 'rgba(239, 68, 68, 0.55)';
          ctx.shadowBlur = 8;
        } else if (isInconclusive) {
          ctx.fillStyle = played ? '#FBBF24' : 'rgba(245, 158, 11, 0.7)';
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = played ? '#A5B4FC' : 'rgba(129, 140, 248, 0.58)';
          ctx.shadowBlur = 0;
        }

        ctx.beginPath();
        ctx.roundRect(x, midY - barH / 2, barWidth, barH, 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Flowing harmonic soundwave ribbon overlay
      ctx.beginPath();
      for (let x = 0; x <= width; x += 4) {
        const ratio = x / width;
        const idx = Math.min(barCount - 1, Math.floor(ratio * barCount));
        const env = peaks[idx] || 0.08;
        const y =
          midY +
          Math.sin(x * 0.045 - now * 0.006) * (env * height * 0.32) +
          Math.cos(x * 0.09 + now * 0.004) * (env * height * 0.1);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
      ctx.lineWidth = 1.25;
      ctx.stroke();

      // Playhead cursor line
      const playX = (curTime / duration) * width;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, height);
      ctx.stroke();

      // Save clean snapshot once analysis finishes and canvas has valid layout dimensions
      if (
        width > 50 &&
        height > 20 &&
        activeRecord.status === 'analyzed' &&
        !snapshotSaved &&
        !activeRecord.snapshots?.waveformDataUrl
      ) {
        snapshotSaved = true;
        try {
          const dataUrl = canvas.toDataURL('image/png');
          updateEvidence(activeRecord.id, {
            snapshots: {
              ...activeRecord.snapshots,
              waveformDataUrl: dataUrl,
            },
          });
        } catch {
          // ignore
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [activeRecord, barSegmentVerdicts, updateEvidence]);

  // ---------------------------------------------------------------------------
  // MEL SPECTROGRAM CANVAS RENDERER
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = specCanvasRef.current;
    const mel = activeRecord?.audioDsp?.melSpectrogram;
    if (!canvas || !mel || mel.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawSpectrogram = () => {
      const w = canvas.clientWidth || 640;
      const h = canvas.clientHeight || 160;
      if (w < 10 || h < 10) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cols = mel.length;
      const rows = mel[0].length;
      const cellW = w / cols;
      const cellH = h / rows;

      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const val = mel[c][r];
          // Scientific inferno-indigo palette
          const red = Math.round(Math.min(255, val * 340));
          const green = Math.round(Math.pow(val, 1.8) * 190);
          const blue = Math.round(60 + (1 - Math.abs(val - 0.45)) * 155);
          ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
          ctx.fillRect(c * cellW, h - (r + 1) * cellH, Math.ceil(cellW), Math.ceil(cellH));
        }
      }

      if (activeRecord.status === 'analyzed' && !activeRecord.snapshots?.spectrogramDataUrl) {
        try {
          const specUrl = canvas.toDataURL('image/png');
          updateEvidence(activeRecord.id, {
            snapshots: {
              ...activeRecord.snapshots,
              spectrogramDataUrl: specUrl,
            },
          });
        } catch {
          // ignore
        }
      }
    };

    drawSpectrogram();
    const observer = new ResizeObserver(() => {
      drawSpectrogram();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [activeRecord, updateEvidence]);

  const handleWaveformClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = waveCanvasRef.current;
    const el = audioElRef.current;
    const dsp = activeRecord?.audioDsp;
    if (!canvas || !dsp) return;

    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const clickedTime = ratio * dsp.durationSec;

    // Prefer highest-suspicion matching segment when windows overlap
    const matchingSegs =
      activeRecord.audioResult?.segments.filter(
        (s) => clickedTime >= s.startTime && clickedTime <= s.endTime,
      ) ?? [];
    const clickedSeg = matchingSegs.sort(
      (a, b) => b.calibratedSuspicion - a.calibratedSuspicion,
    )[0];

    if (clickedSeg) {
      playSegment(clickedSeg.startTime, clickedSeg.endTime, clickedSeg.index);
    } else if (el) {
      el.currentTime = clickedTime;
      setCurrentTime(clickedTime);
    } else {
      void playViaWebAudioFallback(clickedTime, null, null);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleAnalyzeAudio(file);
  };

  const result = activeRecord?.audioResult;
  const dsp = activeRecord?.audioDsp;
  const suspiciousCount = result?.segments.filter((s) => s.verdict === 'suspicious').length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header + Drag-and-Drop Upload Bar */}
      <div className="flex flex-col justify-between gap-4 border-b border-white/[0.08] pb-5 lg:flex-row lg:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <Mic className="h-5 w-5 text-indigo-300" />
            <h3 className="text-lg font-semibold text-white">
              Audio Forensics — AASIST &amp; Animated Soundwave Inspector
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Supports MP3, WAV, M4A, MPEG, MP4 · Extracts Mel spectrograms &amp; overlapping segments · Highlights synthetic or manipulated speech in red
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-[#0B0F19] transition-opacity hover:opacity-90 whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload Audio File
          </button>
          <button
            type="button"
            onClick={() => void handleAnalyzeAudio(createDiagnosticSampleWav())}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.09] whitespace-nowrap"
          >
            <Volume2 className="h-3.5 w-3.5 text-indigo-300" />
            Analyze Diagnostic Spliced WAV
          </button>
          <button
            type="button"
            disabled={!activeRecord || activeRecord.status !== 'analyzed'}
            onClick={() => {
              if (!activeRecord || activeRecord.status !== 'analyzed') return;
              generateModuleForensicPdfReport({
                investigationId,
                modality: 'audio',
                evidenceList,
                teieResult,
                auditLogs,
                teieMapDataUrl: teieMapSnapshot,
                targetEvidenceId: activeRecord.id,
              });
              addAuditLog(
                'audio',
                'EXPORT_PDF',
                `Downloaded Audio Forensics PDF report for ${activeRecord.id} (${activeRecord.fileName})`,
              );
            }}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-3.5 py-2 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-slate-500 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            Download Report
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.wav,.m4a,.mpeg,.mpga,.mpeq,.mp4,audio/mpeg,audio/wav,audio/mp4,video/mp4,audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleAnalyzeAudio(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {/* Drop Zone when empty or adding new */}
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
          <Mic className="h-8 w-8 text-indigo-300" strokeWidth={1.5} />
          <p className="mt-3 text-sm font-medium text-white">
            Drag &amp; drop MP3, WAV, M4A, MPEG, or MP4 audio here
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Original audio is preserved with SHA-256 hash, Mel spectrogram, and segment-level AASIST inspection
          </p>
        </div>
      )}

      {/* Evidence Selector Strip if multiple audio files */}
      {audioEvidence.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">Audio Evidence:</span>
          {audioEvidence.map((ev) => (
            <button
              key={ev.id}
              type="button"
              onClick={() => setSelectedId(ev.id)}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors ${
                ev.id === activeRecord?.id
                  ? 'border-indigo-400/60 bg-indigo-500/20 text-white'
                  : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-white'
              }`}
            >
              {ev.id} · {ev.fileName}
            </button>
          ))}
        </div>
      )}

      {activeRecord && (
        <div className="space-y-6">
          {/* File Metadata & Provenance Strip */}
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:grid-cols-5">
            <div>
              <p className="text-[11px] text-slate-400">File Name</p>
              <p className="mt-0.5 truncate text-xs font-medium text-white">{activeRecord.fileName}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Duration</p>
              <p className="mt-0.5 font-mono text-xs text-white tabular-nums">
                {dsp ? formatTimestamp(dsp.durationSec) : 'Decoding...'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Format &amp; Rate</p>
              <p className="mt-0.5 font-mono text-xs text-white tabular-nums">
                {activeRecord.format} {dsp ? `· ${dsp.sampleRate} Hz` : ''}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">File Size</p>
              <p className="mt-0.5 font-mono text-xs text-white tabular-nums">
                {formatBytes(activeRecord.sizeBytes)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">SHA-256 Digest</p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-indigo-300">
                {activeRecord.sha256}
              </p>
            </div>
          </div>

          {/* Preserved Hidden Audio Element */}
          {activeRecord.objectUrl && (
            <audio key={activeRecord.id} ref={audioElRef} src={activeRecord.objectUrl} preload="auto" />
          )}

          {/* ANIMATIC SOUNDWAVE PLAYER + RED FAKE DETECTION */}
          <div className="rounded-2xl border border-white/[0.09] bg-[#090E1B] p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={togglePlay}
                  disabled={!dsp}
                  className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white text-[#0B0F19] transition-transform hover:scale-105 disabled:opacity-40"
                  aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stopFallbackAudio();
                    segmentWindowRef.current = null;
                    setPlayingSegmentIdx(null);
                    if (audioElRef.current) {
                      audioElRef.current.pause();
                      audioElRef.current.currentTime = 0;
                    }
                    setIsPlaying(false);
                    setCurrentTime(0);
                  }}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/15 text-slate-300 hover:text-white"
                  aria-label="Reset playback"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <div className="font-mono text-xs text-slate-200 tabular-nums">
                  {formatTimestamp(currentTime)} / {dsp ? formatTimestamp(dsp.durationSec) : '00:00.00'}
                </div>
              </div>

              <div className="flex items-center gap-4 text-[11px]">
                <span className="inline-flex items-center gap-1.5 text-indigo-300">
                  <span className="h-2.5 w-2.5 rounded-sm bg-indigo-400" />
                  Genuine / Nominal Wave
                </span>
                <span className="inline-flex items-center gap-1.5 text-red-400">
                  <span className="h-2.5 w-2.5 rounded-sm bg-red-500" />
                  Detected Fake / Suspicious Region ({suspiciousCount})
                </span>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-xl border border-white/[0.07]">
              <canvas
                ref={waveCanvasRef}
                onClick={handleWaveformClick}
                data-lens-compact="true"
                className="h-44 w-full cursor-pointer block"
              />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Click any red highlighted region on the soundwave to isolate and play that suspicious segment.
            </p>
          </div>

          {/* Processing / Error Banner */}
          {activeRecord.status === 'processing' && (
            <div className="flex items-center gap-3 rounded-xl border border-indigo-400/30 bg-indigo-500/10 p-4 text-xs text-indigo-100">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-300" />
              Running Mel spectrogram DSP extraction, AASIST spectro-temporal analysis, and segment transcription...
            </div>
          )}

          {activeRecord.status === 'error' && (
            <div className="flex items-center gap-3 rounded-xl border border-red-500/35 bg-red-500/10 p-4 text-xs text-red-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{activeRecord.errorMessage}</span>
            </div>
          )}

          {/* MEL SPECTROGRAM + CALIBRATED RESULTS DASHBOARD */}
          {dsp && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="rounded-2xl border border-white/[0.08] bg-[#0B1020] p-4 lg:col-span-7">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-medium text-white">Log-Mel Spectrogram (48 Bands)</span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    Centroid {dsp.summary.meanSpectralCentroidHz} Hz · Dynamic Range {dsp.summary.dynamicRangeDb} dB
                  </span>
                </div>
                <canvas ref={specCanvasRef} className="h-40 w-full rounded-lg border border-white/[0.06]" />
                <div className="mt-2 flex justify-between font-mono text-[10px] text-slate-500">
                  <span>00:00.00</span>
                  <span>Frequency (40 Hz – {Math.min(16000, Math.round(dsp.sampleRate / 2))} Hz)</span>
                  <span>{formatTimestamp(dsp.durationSec)}</span>
                </div>
              </div>

              {result && (
                <div className="rounded-2xl border border-white/[0.08] bg-[#0B1020] p-4 lg:col-span-5">
                  <p className="text-xs font-medium text-slate-300">
                    Calibrated Forensic Indicator Scores
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <p className="text-[11px] text-slate-400">Genuine</p>
                      <p className="mt-1 font-mono text-xl font-semibold text-emerald-400 tabular-nums">
                        {result.calibratedGenuineScore}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <p className="text-[11px] text-slate-400">Manipulated</p>
                      <p className="mt-1 font-mono text-xl font-semibold text-red-400 tabular-nums">
                        {result.calibratedManipulatedScore}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <p className="text-[11px] text-slate-400">Suspicion</p>
                      <p className="mt-1 font-mono text-xl font-semibold text-amber-300 tabular-nums">
                        {result.overallSuspicionScore}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                    {result.calibrationNote}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-white/[0.07] pt-3 font-mono text-[11px] tabular-nums">
                    <div className="flex justify-between text-slate-300">
                      <span>AASIST</span>
                      <span>{result.modelIndicators.aasistScore}/100</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>RawNet2</span>
                      <span>{result.modelIndicators.rawnet2Score}/100</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Wav2Vec2</span>
                      <span>{result.modelIndicators.wav2vec2Score}/100</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>ECAPA-TDNN</span>
                      <span>{result.modelIndicators.ecapaTdnnConsistency}/100</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SEGMENT-LEVEL DETECTION TABLE + CHART + EXPLANATION */}
          {result && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="min-w-0 space-y-4 rounded-2xl border border-white/[0.08] bg-[#0B1020] p-5 lg:col-span-7">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-white">
                    Segment-Level Detection ({result.segments.length} Overlapping Windows)
                  </h4>
                  <span className="font-mono text-[11px] text-red-400 tabular-nums">
                    {suspiciousCount} flagged red
                  </span>
                </div>

                {/* Recharts Segment Suspicion Bar Chart */}
                <div className="min-w-0">
                  <div className="h-44 w-full min-w-0">
                    <ResponsiveContainer width="100%" height={176} minWidth={0}>
                      <BarChart
                        data={result.segments.map((s) => ({
                          name: `${s.startTime.toFixed(1)}s`,
                          range: `${formatTimestamp(s.startTime)} – ${formatTimestamp(s.endTime)}`,
                          suspicion: s.calibratedSuspicion,
                          verdict: s.verdict,
                        }))}
                        margin={{ top: 8, right: 10, left: -16, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" vertical={false} />
                        <XAxis dataKey="name" stroke="#94A3B8" fontSize={10} tickLine={false} />
                        <YAxis domain={[0, 100]} stroke="#94A3B8" fontSize={10} tickLine={false} />
                        <ReferenceLine
                          y={60}
                          stroke="#EF4444"
                          strokeDasharray="4 3"
                          strokeOpacity={0.75}
                        />
                        <Tooltip
                          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                          contentStyle={{
                            backgroundColor: '#0F172A',
                            border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: '8px',
                            fontSize: '12px',
                            color: '#F8FAFC',
                          }}
                          labelStyle={{ color: '#CBD5E1', fontFamily: 'JetBrains Mono, monospace' }}
                          itemStyle={{ color: '#F8FAFC' }}
                          labelFormatter={(_label, items) => {
                            const p = items?.[0]?.payload as { range?: string } | undefined;
                            return p?.range || String(_label);
                          }}
                          formatter={(value, _name, item) => {
                            const v = (item?.payload as { verdict?: string } | undefined)?.verdict ?? 'genuine';
                            return [`${value}/100 (${v.toUpperCase()})`, 'Suspicion'];
                          }}
                        />
                        <Bar dataKey="suspicion" radius={[4, 4, 0, 0]} maxBarSize={44}>
                          {result.segments.map((seg) => (
                            <Cell
                              key={seg.index}
                              fill={
                                seg.verdict === 'suspicious'
                                  ? '#EF4444'
                                  : seg.verdict === 'inconclusive'
                                    ? '#F59E0B'
                                    : '#6366F1'
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-sm bg-indigo-500" />
                      Genuine
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-sm bg-amber-500" />
                      Inconclusive
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-sm bg-red-500" />
                      Suspicious (&ge;60 threshold)
                    </span>
                  </div>
                </div>

                {/* Interactive Segment Rows */}
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {result.segments.map((seg) => {
                    const isFake = seg.verdict === 'suspicious';
                    return (
                      <div
                        key={seg.index}
                        className={`flex flex-col justify-between gap-3 rounded-xl border p-3 sm:flex-row sm:items-center ${
                          isFake
                            ? 'border-red-500/40 bg-red-500/[0.08]'
                            : 'border-white/[0.07] bg-white/[0.02]'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums">
                            <span className={isFake ? 'font-semibold text-red-300' : 'text-slate-200'}>
                              {formatTimestamp(seg.startTime)} – {formatTimestamp(seg.endTime)}
                            </span>
                            <span className="text-slate-500">·</span>
                            <span
                              className={
                                isFake
                                  ? 'font-semibold text-red-400'
                                  : seg.verdict === 'inconclusive'
                                    ? 'text-amber-300'
                                    : 'text-emerald-400'
                              }
                            >
                              {seg.verdict.toUpperCase()} ({seg.calibratedSuspicion}/100)
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-slate-300">{seg.reason}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => playSegment(seg.startTime, seg.endTime, seg.index)}
                          className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                            playingSegmentIdx === seg.index && isPlaying
                              ? 'border-white bg-white text-[#0B0F19]'
                              : isFake
                                ? 'border-red-400/40 bg-red-500/20 text-red-100 hover:bg-red-500/35'
                                : 'border-white/15 bg-white/[0.05] text-slate-200 hover:bg-white/[0.1]'
                          }`}
                        >
                          {playingSegmentIdx === seg.index && isPlaying ? (
                            <>
                              <Pause className="h-3 w-3" />
                              Pause Segment
                            </>
                          ) : (
                            <>
                              <Play className="h-3 w-3" />
                              Play Segment
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Explainable Anomaly Summary & Transcript */}
              <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-[#0B1020] p-5 lg:col-span-5">
                <div className="flex items-start gap-2.5">
                  {suspiciousCount > 0 ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  )}
                  <div>
                    <h4 className="text-sm font-semibold text-white">{result.summaryVerdict}</h4>
                    <p className="mt-1 text-xs leading-relaxed text-slate-300">{result.explanation}</p>
                  </div>
                </div>

                <div className="space-y-2.5 border-t border-white/[0.07] pt-3 text-xs">
                  <div>
                    <span className="font-medium text-indigo-200">Frequency Patterns: </span>
                    <span className="text-slate-400">{result.anomalyFindings.unnaturalFrequencyPatterns}</span>
                  </div>
                  <div>
                    <span className="font-medium text-indigo-200">Spectral Consistency: </span>
                    <span className="text-slate-400">{result.anomalyFindings.spectralInconsistencies}</span>
                  </div>
                  <div>
                    <span className="font-medium text-indigo-200">Voice Cloning Assessment: </span>
                    <span className="text-slate-400">{result.anomalyFindings.voiceCloningAssessment}</span>
                  </div>
                </div>

                {result.transcript && (
                  <div className="border-t border-white/[0.07] pt-3">
                    <p className="text-[11px] font-medium text-slate-400">
                      Transcribed Speech (Shared with TEIE &amp; Text Forensics)
                    </p>
                    <p className="mt-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-xs leading-relaxed text-slate-200">
                      {result.transcript}
                    </p>
                  </div>
                )}

                <p className="border-t border-white/[0.07] pt-3 text-[11px] leading-relaxed text-slate-500">
                  Limitations: {result.limitations}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
