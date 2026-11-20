import type {
  AudioDspData,
  AudioSegmentDsp,
  ExtractedVideoFrame,
  ImageMetadataSummary,
} from '../types/forensics';

export async function computeSha256(input: ArrayBuffer | string): Promise<string> {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input).buffer : input;
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatTimestamp(sec: number): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(2).padStart(5, '0')}`;
}

const B64_CODES = new Uint8Array(64);
{
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < 64; i++) B64_CODES[i] = alphabet.charCodeAt(i);
}
const utf8AsciiDecoder = new TextDecoder();

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const len = bytes.length;
  if (len === 0) return '';
  const fullLen = len - (len % 3);
  const rem = len - fullLen;
  const out = new Uint8Array(Math.floor((len + 2) / 3) * 4);
  let j = 0;
  for (let i = 0; i < fullLen; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[j++] = B64_CODES[(n >> 18) & 63];
    out[j++] = B64_CODES[(n >> 12) & 63];
    out[j++] = B64_CODES[(n >> 6) & 63];
    out[j++] = B64_CODES[n & 63];
  }
  if (rem === 1) {
    const n = bytes[fullLen];
    out[j++] = B64_CODES[n >> 2];
    out[j++] = B64_CODES[(n & 3) << 4];
    out[j++] = 61;
    out[j++] = 61;
  } else if (rem === 2) {
    const n = (bytes[fullLen] << 8) | bytes[fullLen + 1];
    out[j++] = B64_CODES[n >> 10];
    out[j++] = B64_CODES[(n >> 4) & 63];
    out[j++] = B64_CODES[(n & 15) << 2];
    out[j++] = 61;
  }
  return utf8AsciiDecoder.decode(out);
}

// ---------------------------------------------------------------------------
// REAL FFT + MEL SPECTROGRAM + SEGMENT ACOUSTIC FEATURE EXTRACTION
// ---------------------------------------------------------------------------
const FFT_SIZE_1024 = 1024;
const BIT_REV_1024 = new Uint16Array(FFT_SIZE_1024);
const HANN_1024 = new Float32Array(FFT_SIZE_1024);
const TWIDDLE_COS_1024 = new Float64Array(FFT_SIZE_1024 - 1);
const TWIDDLE_SIN_1024 = new Float64Array(FFT_SIZE_1024 - 1);

{
  let j = 0;
  for (let i = 0; i < FFT_SIZE_1024; i++) {
    BIT_REV_1024[i] = j;
    let m = FFT_SIZE_1024 >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
    HANN_1024[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE_1024 - 1)));
  }
  let twIdx = 0;
  for (let size = 2; size <= FFT_SIZE_1024; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let k = 0; k < half; k++) {
      const angle = step * k;
      TWIDDLE_COS_1024[twIdx] = Math.cos(angle);
      TWIDDLE_SIN_1024[twIdx] = Math.sin(angle);
      twIdx++;
    }
  }
}

const fftRealScratch1024 = new Float32Array(FFT_SIZE_1024);
const fftImagScratch1024 = new Float32Array(FFT_SIZE_1024);

function fftMagnitude1024Into(realInput: Float32Array, outMag: Float32Array): void {
  const n = FFT_SIZE_1024;
  const real = fftRealScratch1024;
  const imag = fftImagScratch1024;

  for (let i = 0; i < n; i++) {
    real[i] = realInput[BIT_REV_1024[i]];
    imag[i] = 0;
  }

  let twBase = 0;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const wr = TWIDDLE_COS_1024[twBase + k];
        const wi = TWIDDLE_SIN_1024[twBase + k];
        const idx1 = i + k;
        const idx2 = idx1 + half;
        const tr = wr * real[idx2] - wi * imag[idx2];
        const ti = wr * imag[idx2] + wi * real[idx2];
        real[idx2] = real[idx1] - tr;
        imag[idx2] = imag[idx1] - ti;
        real[idx1] += tr;
        imag[idx1] += ti;
      }
    }
    twBase += half;
  }

  const bins = n >> 1;
  for (let i = 0; i < bins; i++) {
    outMag[i] = Math.hypot(real[i], imag[i]) / n;
  }
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

interface SparseMelBand {
  startBin: number;
  endBin: number;
  weights: Float32Array;
}

const melFilterbankCache = new Map<string, SparseMelBand[]>();

function buildSparseMelFilterbank(
  numBands: number,
  fftSize: number,
  sampleRate: number,
): SparseMelBand[] {
  const cacheKey = `${numBands}:${fftSize}:${sampleRate}`;
  const cached = melFilterbankCache.get(cacheKey);
  if (cached) return cached;

  const numBins = fftSize >> 1;
  const minMel = hzToMel(40);
  const maxMel = hzToMel(Math.min(sampleRate / 2, 16000));
  const melPoints: number[] = [];
  for (let i = 0; i <= numBands + 1; i++) {
    melPoints.push(minMel + ((maxMel - minMel) * i) / (numBands + 1));
  }
  const binIndices = melPoints.map((m) =>
    Math.min(numBins - 1, Math.floor(((fftSize + 1) * melToHz(m)) / sampleRate)),
  );

  const filters: SparseMelBand[] = [];
  for (let band = 1; band <= numBands; band++) {
    const left = binIndices[band - 1];
    const center = binIndices[band];
    const right = binIndices[band + 1];
    const weights = new Float32Array(Math.max(1, right - left + 1));
    for (let k = left; k < center; k++) {
      weights[k - left] = center === left ? 1 : (k - left) / (center - left);
    }
    for (let k = center; k <= right; k++) {
      weights[k - left] = right === center ? 1 : (right - k) / (right - center);
    }
    filters.push({ startBin: left, endBin: right, weights });
  }
  if (melFilterbankCache.size > 16) {
    melFilterbankCache.clear();
  }
  melFilterbankCache.set(cacheKey, filters);
  return filters;
}

function encodeMonoWavBase64(mono: Float32Array, sourceSampleRate: number): string {
  const maxRate = 22050;
  const stride = sourceSampleRate > maxRate ? Math.max(1, Math.round(sourceSampleRate / maxRate)) : 1;
  const targetRate = Math.round(sourceSampleRate / stride);
  const sampleCount = Math.floor(mono.length / stride);

  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, sampleCount * 2, true);

  let offset = 44;
  for (let i = 0; i < sampleCount; i++) {
    const s = Math.max(-1, Math.min(1, mono[i * stride]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return arrayBufferToBase64(buffer);
}

export async function processAudioDsp(
  file: File,
  existingBuffer?: ArrayBuffer,
): Promise<{
  dsp: AudioDspData;
  audioBase64: string;
  mimeType: string;
}> {
  const arrayBuffer = existingBuffer ?? (await file.arrayBuffer());

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await ctx.close();
  }

  const sampleRate = decoded.sampleRate;
  const channels = decoded.numberOfChannels;
  const durationSec = decoded.duration;
  const length = decoded.length;

  // Mix down to mono
  const mono = new Float32Array(length);
  for (let ch = 0; ch < channels; ch++) {
    const chData = decoded.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += chData[i] / channels;
    }
  }

  // Waveform envelope (220 bars)
  const numBars = 220;
  const blockSize = Math.max(1, Math.floor(length / numBars));
  const waveformPeaks: number[] = [];
  for (let b = 0; b < numBars; b++) {
    const start = b * blockSize;
    const end = Math.min(length, start + blockSize);
    let peak = 0;
    for (let i = start; i < end; i++) {
      const abs = Math.abs(mono[i]);
      if (abs > peak) peak = abs;
    }
    waveformPeaks.push(Number(peak.toFixed(4)));
  }

  // Mel Spectrogram (up to 96 time columns x 48 mel bands)
  const fftSize = FFT_SIZE_1024;
  const numBins = fftSize >> 1;
  const numMelBands = 48;
  const melFramesCount = Math.min(96, Math.max(24, Math.floor(durationSec * 8)));
  const hopSamples = Math.max(fftSize, Math.floor((length - fftSize) / Math.max(1, melFramesCount)));
  const melFilters = buildSparseMelFilterbank(numMelBands, fftSize, sampleRate);
  const melSpectrogram: number[][] = [];
  const winScratch = new Float32Array(fftSize);
  const magScratch = new Float32Array(numBins);
  const magSqScratch = new Float32Array(numBins);

  for (let frameIdx = 0; frameIdx < melFramesCount; frameIdx++) {
    const offset = Math.min(Math.max(0, length - fftSize), frameIdx * hopSamples);
    for (let i = 0; i < fftSize; i++) {
      winScratch[i] = (mono[offset + i] ?? 0) * HANN_1024[i];
    }
    fftMagnitude1024Into(winScratch, magScratch);
    for (let k = 0; k < numBins; k++) {
      const mk = magScratch[k];
      magSqScratch[k] = mk * mk;
    }
    const bandValues = new Array<number>(numMelBands);
    for (let m = 0; m < numMelBands; m++) {
      const filter = melFilters[m];
      let energy = 1e-9;
      for (let k = filter.startBin; k <= filter.endBin; k++) {
        const w = filter.weights[k - filter.startBin];
        if (w > 0) energy += magSqScratch[k] * w;
      }
      // Log-mel normalized roughly to 0..1
      const db = 10 * Math.log10(energy);
      bandValues[m] = Math.max(0, Math.min(1, (db + 95) / 75));
    }
    melSpectrogram.push(bandValues);
  }

  // Overlapping segments (min 4, max 12 segments)
  const targetSegCount = Math.min(12, Math.max(4, Math.ceil(durationSec / 2.2)));
  const winDur = durationSec / Math.max(1, targetSegCount * 0.78);
  const stepDur = (durationSec - Math.min(durationSec, winDur)) / Math.max(1, targetSegCount - 1);
  const segments: AudioSegmentDsp[] = [];

  let sumCentroid = 0;
  let sumHf = 0;
  let sumFlatness = 0;
  let maxRms = 1e-6;
  let minRms = 1;

  for (let s = 0; s < targetSegCount; s++) {
    const startTime = Number(Math.max(0, s * (targetSegCount === 1 ? 0 : stepDur)).toFixed(2));
    const endTime = Number(Math.min(durationSec, startTime + winDur).toFixed(2));
    const startIdx = Math.floor(startTime * sampleRate);
    const endIdx = Math.min(length, Math.max(startIdx + fftSize, Math.floor(endTime * sampleRate)));

    let sqSum = 0;
    let zc = 0;
    for (let i = startIdx; i < endIdx; i++) {
      const v = mono[i];
      sqSum += v * v;
      if (i > startIdx && ((mono[i - 1] >= 0 && v < 0) || (mono[i - 1] < 0 && v >= 0))) {
        zc++;
      }
    }
    const segLen = Math.max(1, endIdx - startIdx);
    const rms = Math.sqrt(sqSum / segLen);
    if (rms > maxRms) maxRms = rms;
    if (rms > 1e-5 && rms < minRms) minRms = rms;
    const zcr = zc / segLen;

    // Average FFT magnitude across 3 slices inside segment
    const avgMag = new Float32Array(numBins);
    const slices = 3;
    for (let sl = 0; sl < slices; sl++) {
      const pos = Math.min(
        Math.max(0, length - fftSize),
        startIdx + Math.floor(((segLen - fftSize) * sl) / Math.max(1, slices - 1)),
      );
      for (let i = 0; i < fftSize; i++) {
        winScratch[i] = (mono[pos + i] ?? 0) * HANN_1024[i];
      }
      fftMagnitude1024Into(winScratch, magScratch);
      for (let k = 0; k < numBins; k++) {
        avgMag[k] += magScratch[k] / slices;
      }
    }

    let magSum = 1e-9;
    let weightedFreq = 0;
    let hfEnergy = 0;
    let totalEnergy = 1e-9;
    let logGeoSum = 0;
    const binHz = sampleRate / fftSize;

    for (let k = 1; k < avgMag.length; k++) {
      const freq = k * binHz;
      const mVal = avgMag[k] + 1e-9;
      const pwr = mVal * mVal;
      magSum += mVal;
      weightedFreq += freq * mVal;
      totalEnergy += pwr;
      if (freq >= 6000) hfEnergy += pwr;
      logGeoSum += Math.log(mVal);
    }

    const spectralCentroidHz = weightedFreq / magSum;
    const highFreqRatio = hfEnergy / totalEnergy;
    const geoMean = Math.exp(logGeoSum / Math.max(1, avgMag.length - 1));
    const arithMean = magSum / Math.max(1, avgMag.length - 1);
    const spectralFlatness = Math.min(1, geoMean / Math.max(1e-9, arithMean));

    sumCentroid += spectralCentroidHz;
    sumHf += highFreqRatio;
    sumFlatness += spectralFlatness;

    segments.push({
      index: s,
      startTime,
      endTime: endTime <= startTime ? Number(durationSec.toFixed(2)) : endTime,
      rms: Number(rms.toFixed(5)),
      spectralCentroidHz: Number(spectralCentroidHz.toFixed(1)),
      highFreqRatio: Number(highFreqRatio.toFixed(5)),
      spectralFlatness: Number(spectralFlatness.toFixed(4)),
      zcr: Number(zcr.toFixed(4)),
    });
  }

  const lowerName = file.name.toLowerCase();
  const isContainerWithVideoOrLarge =
    lowerName.endsWith('.mp4') ||
    file.type.startsWith('video/') ||
    arrayBuffer.byteLength > 14 * 1024 * 1024;

  const audioBase64 = isContainerWithVideoOrLarge
    ? encodeMonoWavBase64(mono, sampleRate)
    : arrayBufferToBase64(arrayBuffer);

  const mimeType = isContainerWithVideoOrLarge
    ? 'audio/wav'
    : lowerName.endsWith('.wav')
      ? 'audio/wav'
      : lowerName.endsWith('.m4a')
        ? 'audio/mp4'
        : lowerName.endsWith('.mpeg') ||
            lowerName.endsWith('.mpg') ||
            lowerName.endsWith('.mpga') ||
            lowerName.endsWith('.mpeq') ||
            lowerName.endsWith('.mp3') ||
            file.type.includes('mpeg')
          ? 'audio/mpeg'
          : file.type || 'audio/mpeg';

  return {
    dsp: {
      durationSec,
      sampleRate,
      channels,
      waveformPeaks,
      melSpectrogram,
      segments,
      summary: {
        meanSpectralCentroidHz: Number((sumCentroid / segments.length).toFixed(1)),
        meanHighFreqRatio: Number((sumHf / segments.length).toFixed(5)),
        meanSpectralFlatness: Number((sumFlatness / segments.length).toFixed(4)),
        dynamicRangeDb: Number((20 * Math.log10(maxRms / Math.max(1e-5, minRms))).toFixed(2)),
      },
    },
    audioBase64,
    mimeType,
  };
}

// ---------------------------------------------------------------------------
// REAL IMAGE METADATA PARSING + ERROR LEVEL ANALYSIS (ELA)
// ---------------------------------------------------------------------------
function extractAsciiStrings(bytes: Uint8Array, maxLen = 65536): string {
  const limit = Math.min(bytes.length, maxLen);
  const out = new Uint8Array(limit);
  for (let i = 0; i < limit; i++) {
    const c = bytes[i];
    out[i] = c >= 32 && c <= 126 ? c : 32;
  }
  return utf8AsciiDecoder.decode(out);
}

export async function processImageForensicPrep(
  file: File,
  existingBuffer?: ArrayBuffer,
): Promise<{
  imageBase64: string;
  mimeType: string;
  elaDataUrl: string;
  elaBase64: string;
  spatialAnomalyGrid: number[][];
  metadata: ImageMetadataSummary;
}> {
  const buffer = existingBuffer ?? (await file.arrayBuffer());
  const bytes = new Uint8Array(buffer);
  const headerAscii = extractAsciiStrings(bytes, 90000);
  const tailAscii =
    bytes.length > 90000 ? extractAsciiStrings(bytes.subarray(Math.max(0, bytes.length - 40000))) : '';
  const combinedText = `${headerAscii} ${tailAscii}`;
  const lowerCombinedText = combinedText.toLowerCase();

  const hasExif = combinedText.includes('Exif') || combinedText.includes('TIFF');
  const c2paDetected =
    combinedText.includes('c2pa') ||
    combinedText.includes('C2PA') ||
    combinedText.includes('jumbf') ||
    combinedText.includes('ContentCredentials') ||
    combinedText.includes('SynthID');

  const knownTools = [
    'Adobe Photoshop',
    'Lightroom',
    'GIMP',
    'Midjourney',
    'DALL-E',
    'OpenAI',
    'Stable Diffusion',
    'Automatic1111',
    'ComfyUI',
    'Flux',
    'Imagen',
    'Gemini',
    'Google AI',
    'SynthID',
    'Firefly',
    'Ideogram',
    'Leonardo',
    'Recraft',
    'Negative prompt',
    'Canva',
    'Snapseed',
    'Apple',
    'Canon',
    'Nikon',
    'Sony',
    'SAMSUNG',
    'Google',
  ];
  const matchedMarkers = knownTools.filter((tool) =>
    lowerCombinedText.includes(tool.toLowerCase()),
  );

  const aiGeneratorHint = matchedMarkers.find((m) =>
    [
      'Midjourney',
      'DALL-E',
      'OpenAI',
      'Stable Diffusion',
      'Automatic1111',
      'ComfyUI',
      'Flux',
      'Imagen',
      'Gemini',
      'Google AI',
      'SynthID',
      'Firefly',
      'Ideogram',
      'Leonardo',
      'Recraft',
      'Negative prompt',
    ].includes(m),
  );
  const cameraMakeModel = matchedMarkers.find((m) =>
    ['Apple', 'Canon', 'Nikon', 'Sony', 'SAMSUNG', 'Google'].includes(m),
  );
  const softwareTag = matchedMarkers.find((m) =>
    ['Adobe Photoshop', 'Lightroom', 'GIMP', 'Canva', 'Snapseed'].includes(m),
  );

  const objectUrl = URL.createObjectURL(file);
  let img: HTMLImageElement;
  let origCanvas: HTMLCanvasElement;
  let elaCanvas: HTMLCanvasElement;
  let totalDiff = 0;
  let pixelCount = 0;
  let spatialAnomalyGrid: number[][] = [];
  let noiseVariance = 0;
  let highFreqEnergyRatio = 0;

  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode uploaded image.'));
      el.src = objectUrl;
    });

    const maxDim = 960;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    origCanvas = document.createElement('canvas');
    origCanvas.width = w;
    origCanvas.height = h;
    const origCtx = origCanvas.getContext('2d')!;
    origCtx.drawImage(img, 0, 0, w, h);
    const origData = origCtx.getImageData(0, 0, w, h);

    // Re-encode at 90% JPEG quality for ELA
    const recompUrl = origCanvas.toDataURL('image/jpeg', 0.9);
    const recompImg = await new Promise<HTMLImageElement>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.src = recompUrl;
    });

    elaCanvas = document.createElement('canvas');
    elaCanvas.width = w;
    elaCanvas.height = h;
    const elaCtx = elaCanvas.getContext('2d')!;
    elaCtx.drawImage(recompImg, 0, 0, w, h);
    const recompData = elaCtx.getImageData(0, 0, w, h);

    const outData = elaCtx.createImageData(w, h);
    pixelCount = w * h;
    const amplification = 16;

    // Luminance buffer for high-frequency Laplacian noise residual
    const luma = new Float32Array(pixelCount);
    const elaMag = new Float32Array(pixelCount);

    for (let p = 0; p < pixelCount; p++) {
      const i = p * 4;
      const r = origData.data[i];
      const g = origData.data[i + 1];
      const b = origData.data[i + 2];
      luma[p] = 0.299 * r + 0.587 * g + 0.114 * b;

      const dr = Math.abs(r - recompData.data[i]);
      const dg = Math.abs(g - recompData.data[i + 1]);
      const db = Math.abs(b - recompData.data[i + 2]);
      const diff = (dr + dg + db) / 3;
      elaMag[p] = diff;
      totalDiff += diff;

      outData.data[i] = Math.min(255, dr * amplification);
      outData.data[i + 1] = Math.min(255, dg * amplification);
      outData.data[i + 2] = Math.min(255, db * amplification);
      outData.data[i + 3] = 255;
    }
    elaCtx.putImageData(outData, 0, 0);

    // Compute global high-frequency noise variance + 32x32 spatial anomaly grid
    const gridSize = 32;
    const gridEnergyFlat = new Float64Array(gridSize * gridSize);
    const gridCountsFlat = new Uint32Array(gridSize * gridSize);

    let hfSum = 0;
    let hfSqSum = 0;
    let hfCount = 0;

    for (let y = 1; y < h - 1; y++) {
      const gyOffset = Math.min(gridSize - 1, Math.floor((y / h) * gridSize)) * gridSize;
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const lap = Math.abs(
          luma[idx - w] + luma[idx + w] + luma[idx - 1] + luma[idx + 1] - 4 * luma[idx],
        );
        hfSum += lap;
        hfSqSum += lap * lap;
        hfCount++;

        const gx = Math.min(gridSize - 1, Math.floor((x / w) * gridSize));
        const cellIdx = gyOffset + gx;
        // Combine local ELA residual and local Laplacian texture energy
        gridEnergyFlat[cellIdx] += elaMag[idx] * 1.4 + lap * 0.25;
        gridCountsFlat[cellIdx] += 1;
      }
    }

    let maxCell = 1e-5;
    let minCell = Infinity;
    for (let idx = 0; idx < gridSize * gridSize; idx++) {
      const c = Math.max(1, gridCountsFlat[idx]);
      const avg = gridEnergyFlat[idx] / c;
      gridEnergyFlat[idx] = avg;
      if (avg > maxCell) maxCell = avg;
      if (avg < minCell) minCell = avg;
    }

    // Normalize spatial grid cleanly to 0..1
    const span = Math.max(1e-4, maxCell - minCell);
    spatialAnomalyGrid = Array.from({ length: gridSize }, (_, gy) => {
      const row = new Array<number>(gridSize);
      const rowBase = gy * gridSize;
      for (let gx = 0; gx < gridSize; gx++) {
        const val = gridEnergyFlat[rowBase + gx];
        row[gx] = Number(Math.max(0, Math.min(1, (val - minCell) / span)).toFixed(3));
      }
      return row;
    });

    const hfMean = hfSum / Math.max(1, hfCount);
    noiseVariance = Math.sqrt(Math.max(0, hfSqSum / Math.max(1, hfCount) - hfMean * hfMean));
    highFreqEnergyRatio = hfMean / 255;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  // Check common diffusion/AI canvas pixel dimensions
  const isMultipleOf64 = img.width % 64 === 0 && img.height % 64 === 0;
  const commonAiSizes = new Set([512, 768, 832, 896, 1024, 1152, 1216, 1280, 1344, 1408, 1536, 1792, 2048]);
  const standardDiffusionDimensions =
    isMultipleOf64 && (commonAiSizes.has(img.width) || commonAiSizes.has(img.height));

  const elaDataUrl = elaCanvas.toDataURL('image/jpeg', 0.88);
  const elaBase64 = elaDataUrl.split(',')[1] ?? '';

  const useResized = buffer.byteLength > 8 * 1024 * 1024;
  const imageBase64 = useResized
    ? (origCanvas.toDataURL('image/jpeg', 0.92).split(',')[1] ?? '')
    : arrayBufferToBase64(buffer);
  const mimeType = useResized ? 'image/jpeg' : file.type || 'image/jpeg';

  return {
    imageBase64,
    mimeType,
    elaDataUrl,
    elaBase64,
    spatialAnomalyGrid,
    metadata: {
      format: file.name.split('.').pop()?.toUpperCase() || 'IMAGE',
      width: img.width,
      height: img.height,
      hasExif,
      cameraMakeModel,
      softwareTag,
      c2paDetected,
      aiGeneratorHint,
      rawMarkers: matchedMarkers,
      elaMeanResidual: Number((totalDiff / Math.max(1, pixelCount)).toFixed(3)),
      noiseVariance: Number(noiseVariance.toFixed(3)),
      highFreqEnergyRatio: Number(highFreqEnergyRatio.toFixed(4)),
      standardDiffusionDimensions,
    },
  };
}

// ---------------------------------------------------------------------------
// REAL VIDEO FRAME EXTRACTION + TEMPORAL DELTA + SHARPNESS
// ---------------------------------------------------------------------------
export async function processVideoFrames(
  file: File,
  targetFrames = 8,
): Promise<{
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  frames: ExtractedVideoFrame[];
}> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('error', onErr);
        if (err) reject(err);
        else resolve();
      };
      const onReady = () => finish();
      const onMeta = () => {
        if (video.readyState >= 2) finish();
      };
      const onErr = () =>
        finish(new Error('Browser could not decode this video format or codec.'));
      const timer = window.setTimeout(() => {
        if (video.readyState >= 1 && video.videoWidth > 0) {
          finish();
        } else {
          finish(new Error('Timed out while loading video metadata in browser.'));
        }
      }, 10000);

      video.addEventListener('loadeddata', onReady);
      video.addEventListener('canplay', onReady);
      video.addEventListener('loadedmetadata', onMeta);
      video.addEventListener('error', onErr);
      video.load();
    });

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error('No decodable video track found in this container.');
    }

    const durationSec =
      Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0.5, video.duration) : 5;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 360;

    const anyVideo = video as HTMLVideoElement & {
      mozHasAudio?: boolean;
      webkitAudioDecodedByteCount?: number;
      audioTracks?: { length: number };
    };
    const hasAudio = Boolean(
      anyVideo.mozHasAudio || (anyVideo.audioTracks && anyVideo.audioTracks.length > 0),
    );

    const canvas = document.createElement('canvas');
    const cw = Math.min(384, width);
    const ch = Math.max(1, Math.round((height / Math.max(1, width)) * cw));
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable for frame extraction.');
    }

    const count = Math.min(targetFrames, Math.max(4, Math.ceil(durationSec * 1.2)));
    const frames: ExtractedVideoFrame[] = [];
    const framePixels = cw * ch;
    let prevGrayBuf = new Float32Array(framePixels);
    let currGrayBuf = new Float32Array(framePixels);
    let hasPrevGray = false;

    for (let i = 0; i < count; i++) {
      const rawTs = ((i + 0.5) / count) * durationSec;
      const ts = Number(Math.min(Math.max(0.05, durationSec - 0.05), rawTs).toFixed(2));

      await new Promise<void>((resolve) => {
        if (Math.abs(video.currentTime - ts) < 0.02) {
          window.setTimeout(resolve, 0);
          return;
        }
        let done = false;
        const finishSeek = () => {
          if (done) return;
          done = true;
          clearTimeout(seekTimer);
          video.removeEventListener('seeked', finishSeek);
          video.removeEventListener('error', finishSeek);
          resolve();
        };
        const seekTimer = window.setTimeout(finishSeek, 2500);
        video.addEventListener('seeked', finishSeek);
        video.addEventListener('error', finishSeek);
        try {
          video.currentTime = ts;
        } catch {
          finishSeek();
        }
      });

      ctx.drawImage(video, 0, 0, cw, ch);
      const imgData = ctx.getImageData(0, 0, cw, ch).data;

      const gray = currGrayBuf;
      for (let p = 0; p < framePixels; p++) {
        const idx = p * 4;
        gray[p] = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
      }

      // Inter-frame temporal pixel delta
      let temporalDelta = 0;
      if (hasPrevGray) {
        let diffSum = 0;
        for (let p = 0; p < framePixels; p++) {
          diffSum += Math.abs(gray[p] - prevGrayBuf[p]);
        }
        temporalDelta = diffSum / framePixels;
      }
      // Swap ping-pong buffers without allocating per frame
      currGrayBuf = prevGrayBuf;
      prevGrayBuf = gray;
      hasPrevGray = true;

      // Laplacian edge sharpness variance
      let lapSum = 0;
      let lapSqSum = 0;
      let lapCount = 0;
      for (let y = 1; y < ch - 1; y += 2) {
        for (let x = 1; x < cw - 1; x += 2) {
          const idx = y * cw + x;
          const lap =
            gray[idx - cw] +
            gray[idx + cw] +
            gray[idx - 1] +
            gray[idx + 1] -
            4 * gray[idx];
          lapSum += lap;
          lapSqSum += lap * lap;
          lapCount++;
        }
      }
      const lapMean = lapSum / Math.max(1, lapCount);
      const sharpnessScore = Math.sqrt(
        Math.max(0, lapSqSum / Math.max(1, lapCount) - lapMean * lapMean),
      );

      const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
      frames.push({
        index: i,
        timestamp: ts,
        dataUrl,
        imageBase64: dataUrl.split(',')[1] ?? '',
        temporalDelta: Number(temporalDelta.toFixed(2)),
        sharpnessScore: Number(sharpnessScore.toFixed(2)),
      });
    }

    return { durationSec, width, height, hasAudio, frames };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// ---------------------------------------------------------------------------
// REAL SHINGLED JACCARD / MINHASH + BM25 LEXICAL OVERLAP FOR TEXT FORENSICS
// ---------------------------------------------------------------------------
export function computeLexicalOverlap(
  documents: Array<{ id: string; title: string; content: string }>,
  references: Array<{ id: string; sourceTitle: string; content: string }>,
): {
  pairwisePairs: Array<{
    docTitle: string;
    refTitle: string;
    shingleJaccard: number;
    bm25Normalized: number;
  }>;
} {
  const tokenize = (text: string): string[] =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);

  const buildShingles = (tokens: string[], k = 4): Set<string> => {
    const s = new Set<string>();
    if (tokens.length < k) {
      if (tokens.length > 0) s.add(tokens.join(' '));
      return s;
    }
    for (let i = 0; i <= tokens.length - k; i++) {
      s.add(tokens.slice(i, i + k).join(' '));
    }
    return s;
  };

  const pairwisePairs: Array<{
    docTitle: string;
    refTitle: string;
    shingleJaccard: number;
    bm25Normalized: number;
  }> = [];

  const preppedDocs = documents.map((doc) => {
    const tokens = tokenize(doc.content);
    const shingles = buildShingles(tokens);
    const freq = new Map<string, number>();
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
    return { doc, tokens, shingles, freq };
  });

  const preppedRefs = references.map((ref) => {
    const tokens = tokenize(ref.content);
    const shingles = buildShingles(tokens);
    const tokenSet = new Set(tokens);
    return { ref, shingles, tokenSet };
  });

  for (const { doc, tokens: docTokens, shingles: docShingles, freq: docFreq } of preppedDocs) {
    const docNormDenom = Math.max(8, Math.sqrt(docTokens.length * 4));
    for (const { ref, shingles: refShingles, tokenSet: refSet } of preppedRefs) {
      let intersection = 0;
      docShingles.forEach((sh) => {
        if (refShingles.has(sh)) intersection++;
      });
      const union = docShingles.size + refShingles.size - intersection;
      const jaccard = union > 0 ? intersection / union : 0;

      // Lightweight BM25-like token overlap
      let sharedWeighted = 0;
      docFreq.forEach((tf, term) => {
        if (refSet.has(term)) {
          sharedWeighted += (tf * 2.2) / (tf + 1.2);
        }
      });
      const bm25Normalized = Math.min(1, sharedWeighted / docNormDenom);

      pairwisePairs.push({
        docTitle: doc.title,
        refTitle: ref.sourceTitle,
        shingleJaccard: Number((jaccard * 100).toFixed(2)),
        bm25Normalized: Number((bm25Normalized * 100).toFixed(2)),
      });
    }
  }

  return { pairwisePairs };
}
