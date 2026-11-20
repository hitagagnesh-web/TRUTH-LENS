export type NavSectionId = 'home' | 'verify' | 'teie' | 'report';

export type ForensicModuleId = 'audio' | 'video' | 'image' | 'text' | 'teie' | 'report';

export type MediaModuleId = 'audio' | 'video' | 'image' | 'text';

export interface AudioSegmentDsp {
  index: number;
  startTime: number;
  endTime: number;
  rms: number;
  spectralCentroidHz: number;
  highFreqRatio: number;
  spectralFlatness: number;
  zcr: number;
}

export interface AudioSegmentAssessment {
  index: number;
  startTime: number;
  endTime: number;
  verdict: 'suspicious' | 'inconclusive' | 'genuine';
  calibratedSuspicion: number;
  reason: string;
  detectedSignals: string[];
}

export interface AudioDspData {
  durationSec: number;
  sampleRate: number;
  channels: number;
  waveformPeaks: number[];
  melSpectrogram: number[][];
  segments: AudioSegmentDsp[];
  summary: {
    meanSpectralCentroidHz: number;
    meanHighFreqRatio: number;
    meanSpectralFlatness: number;
    dynamicRangeDb: number;
  };
}

export interface AudioAnalysisResult {
  calibratedGenuineScore: number;
  calibratedManipulatedScore: number;
  overallSuspicionScore: number;
  calibrationNote: string;
  summaryVerdict: string;
  transcript: string;
  modelIndicators: {
    aasistScore: number;
    rawnet2Score: number;
    wav2vec2Score: number;
    ecapaTdnnConsistency: number;
  };
  anomalyFindings: {
    unnaturalFrequencyPatterns: string;
    spectralInconsistencies: string;
    artificialSpeechCharacteristics: string;
    voiceCloningAssessment: string;
    speechPatternNotes: string;
  };
  explanation: string;
  limitations: string;
  segments: AudioSegmentAssessment[];
  searchSources?: Array<{ title: string; uri: string }>;
}

export interface ExtractedVideoFrame {
  index: number;
  timestamp: number;
  imageBase64: string;
  dataUrl: string;
  temporalDelta: number;
  sharpnessScore: number;
}

export interface VideoFrameAssessment {
  index: number;
  timestamp: number;
  verdict: 'suspicious' | 'inconclusive' | 'genuine';
  calibratedSuspicion: number;
  findings: string;
  detectedTags: string[];
}

export interface VideoAnalysisResult {
  calibratedGenuineScore: number;
  calibratedManipulatedScore: number;
  overallSuspicionScore: number;
  calibrationNote: string;
  architectureNotes: string;
  detectionFeatures: {
    aiGeneratedIndicators: string;
    faceManipulation: string;
    facialMovementConsistency: string;
    temporalInconsistencies: string;
    textureAndCompositing: string;
  };
  explanation: string;
  limitations: string;
  frameAssessments: VideoFrameAssessment[];
  searchSources?: Array<{ title: string; uri: string }>;
}

export interface ImageMetadataSummary {
  format: string;
  width: number;
  height: number;
  hasExif: boolean;
  cameraMakeModel?: string;
  softwareTag?: string;
  c2paDetected: boolean;
  aiGeneratorHint?: string;
  rawMarkers: string[];
  elaMeanResidual: number;
  noiseVariance: number;
  highFreqEnergyRatio: number;
  standardDiffusionDimensions: boolean;
}

export interface ImageSuspiciousRegion {
  id: string;
  label: string;
  severity: 'high' | 'medium' | 'low';
  confidence: number;
  box2d: [number, number, number, number];
  rationale: string;
}

export interface ImageAnalysisResult {
  calibratedAuthenticityScore: number;
  manipulationSuspicionScore: number;
  aiGenerationIndicatorScore: number;
  traditionalForgeryIndicatorScore: number;
  primaryClassification: string;
  sceneDescription: string;
  detectionExplanation: string;
  metadataObservations: string[];
  manipulationSignals: {
    aiGeneratedCharacteristics: string;
    faceManipulation: string;
    splicingAndCompositing: string;
    lightingAndShadows: string;
    textureAndPixelIrregularities: string;
  };
  suspiciousRegions: ImageSuspiciousRegion[];
  limitations: string;
  searchSources?: Array<{ title: string; uri: string }>;
}

export interface TextAnalysisResult {
  summary: string;
  overallSimilarityScore: number;
  contradictionRiskScore: number;
  preliminaryAiIndicatorScore: number;
  aiIndicatorDisclaimer: string;
  plagiarismMatches: Array<{
    docTitle: string;
    matchedPassage: string;
    sourceReference: string;
    similarityScore: number;
    explanation: string;
  }>;
  contradictions: Array<{
    docA: string;
    statementA: string;
    docB: string;
    statementB: string;
    nliLabel: string;
    severity: string;
    explanation: string;
  }>;
  suspiciousClaims: Array<{
    docTitle: string;
    passage: string;
    reason: string;
    verificationNeeded: string;
  }>;
  limitations: string;
  searchSources?: Array<{ title: string; uri: string }>;
}

export interface TeieRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  relationshipType: 'supporting' | 'contradictory' | 'suspicious' | 'inconclusive';
  label: string;
  confidence: number;
  detailedFinding: string;
  referencedTimestampsOrRegions: string;
}

export interface TeieAnalysisResult {
  fusionMethodologyNote: string;
  preliminaryCalibratedIndex: number;
  overallInvestigationAssessment: string;
  crossModalFindings: {
    audioVideo: string;
    audioText: string;
    videoText: string;
    imageText: string;
    imageVideo: string;
    collectiveTimeline: string;
  };
  relationships: TeieRelationship[];
  supportingEvidence: string[];
  contradictoryEvidence: string[];
  humanReviewRecommendations: string[];
  modelLimitations: string;
  searchSources?: Array<{ title: string; uri: string }>;
}

export interface AuditLogEntry {
  timestamp: string;
  module: ForensicModuleId;
  action: string;
  detail: string;
}

export interface EvidenceRecord {
  id: string;
  modality: MediaModuleId;
  fileName: string;
  format: string;
  mimeType: string;
  sizeBytes: number;
  uploadTimestamp: string;
  sha256: string;
  objectUrl?: string;
  durationSec?: number;
  dimensions?: { width: number; height: number };
  status: 'uploaded' | 'processing' | 'analyzed' | 'error';
  errorMessage?: string;
  audioDsp?: AudioDspData;
  audioResult?: AudioAnalysisResult;
  videoFrames?: ExtractedVideoFrame[];
  videoResult?: VideoAnalysisResult;
  imageBase64?: string;
  elaDataUrl?: string;
  spatialAnomalyGrid?: number[][];
  imageMetadata?: ImageMetadataSummary;
  imageResult?: ImageAnalysisResult;
  textContent?: string;
  textResult?: TextAnalysisResult;
  snapshots?: {
    waveformDataUrl?: string;
    spectrogramDataUrl?: string;
    heatmapDataUrl?: string;
    videoFrameDataUrl?: string;
  };
}

export interface ModuleRowMeta {
  id: MediaModuleId;
  title: string;
  shortLabel: string;
  subtitle: string;
  acceptedFormats: string;
  acceptAttr: string;
  pipelineTag: string;
  hoverPrompt: string;
  capabilities: string[];
}

export const FORENSIC_MODULE_ROW: ModuleRowMeta[] = [
  {
    id: 'audio',
    title: 'Audio Forensics',
    shortLabel: 'Audio',
    subtitle: 'AASIST & Animated Soundwaves',
    acceptedFormats: 'MP3 · WAV · M4A · MPEG · MP4',
    acceptAttr:
      '.mp3,.wav,.m4a,.mpeg,.mpga,.mpeq,.mp4,audio/mpeg,audio/wav,audio/mp4,video/mp4,audio/x-m4a,audio/*',
    pipelineTag: 'AASIST · RawNet2 · Mel Spectrogram',
    hoverPrompt:
      'Upload MP3, WAV, M4A, MPEG, or MP4 to animate soundwaves and highlight manipulated speech in red.',
    capabilities: [
      '48-band Log-Mel Spectrogram DSP',
      'Red segment highlighting & playback',
      'Voice clone & vocoder cutoff check',
    ],
  },
  {
    id: 'video',
    title: 'Video Forensics',
    shortLabel: 'Video',
    subtitle: 'Temporal & Face Frame Audit',
    acceptedFormats: 'MP4 · MOV · AVI',
    acceptAttr: '.mp4,.mov,.avi,video/mp4,video/quicktime,video/x-msvideo',
    pipelineTag: 'XceptionNet · VideoMAE · TimeSformer',
    hoverPrompt: 'Upload MP4, MOV, or AVI to extract keyframes, compute pixel delta, and flag deepfake timestamps.',
    capabilities: [
      'Interval frame extraction & delta',
      'Facial movement & texture check',
      'Clickable flagged timeline scrubber',
    ],
  },
  {
    id: 'image',
    title: 'Image Forensics',
    shortLabel: 'Image',
    subtitle: 'Grad-CAM Heatmap & ELA',
    acceptedFormats: 'JPG · JPEG · PNG · WEBP',
    acceptAttr: '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp',
    pipelineTag: 'ViT · EfficientNet-B4 · ELA Residual',
    hoverPrompt: 'Upload one or multiple images to inspect EXIF/C2PA provenance and localized manipulation heatmaps.',
    capabilities: [
      'AI synthesis vs. splicing distinction',
      'Side-by-side Grad-CAM & ELA views',
      'Localized bounding-box rationale',
    ],
  },
  {
    id: 'text',
    title: 'Text Forensics',
    shortLabel: 'Text',
    subtitle: 'Plagiarism & NLI Contradiction',
    acceptedFormats: 'TXT · PDF · DOCX',
    acceptAttr:
      '.txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pipelineTag: 'DeBERTa · BM25 · MinHash · NLI',
    hoverPrompt: 'Upload TXT, PDF, DOCX or paste claims to detect contradictions and cross-check audio transcripts.',
    capabilities: [
      'PyMuPDF/DOCX-grade text extraction',
      'NLI contradiction & claim detection',
      'Reference-backed BM25 matching',
    ],
  },
];
