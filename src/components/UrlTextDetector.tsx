import { useState } from 'react';
import {
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  Loader2,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Search,
} from 'lucide-react';

export function UrlTextDetector() {
  const [inputVal, setInputVal] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    aiScore: number;
    genuinityScore: number;
    verdict: string;
    summary: string;
    keySignals: string[];
    searchSources?: Array<{ title: string; uri: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const isUrl = inputVal.trim().startsWith('http://') || inputVal.trim().startsWith('https://');
      const payload = isUrl ? { url: inputVal.trim() } : { text: inputVal.trim() };
      const res = await fetch('/api/forensics/url-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to analyze content.');
      }
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Error connecting to verification server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative z-20 mx-auto w-full max-w-3xl px-4">
      <div className="rounded-xl border border-indigo-500/30 bg-[#0C1329]/95 p-4 shadow-[0_0_30px_rgba(99,102,241,0.18)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 mb-3 pb-2 border-b border-indigo-500/20">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-indigo-400 animate-pulse" />
            <h2 className="text-sm font-bold tracking-tight text-white">
              AI & Genuinity Detector
            </h2>
          </div>
          <span className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-200 border border-indigo-500/30 shadow-[0_0_12px_rgba(99,102,241,0.25)]">
            Gemini AI Powered
          </span>
        </div>

        <form onSubmit={handleAnalyze} className="flex gap-2">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-indigo-400">
              <Search className="h-3.5 w-3.5" />
            </div>
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="Paste public URL or text content to verify AI / genuinity..."
              required
              className="w-full rounded-lg border border-indigo-500/30 bg-slate-950/80 py-2.5 pl-9 pr-3 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !inputVal.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer shrink-0"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Analyze
              </>
            )}
          </button>
        </form>

        {error && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-950/40 p-2.5 text-xs text-red-300 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="mt-3 rounded-lg border border-indigo-500/25 bg-slate-950/90 p-3 text-xs animate-fadeIn">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-indigo-500/15">
              <div className="flex items-center gap-2.5">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                    result.aiScore >= 60
                      ? 'border-red-500/40 bg-red-950/50 text-red-300'
                      : result.aiScore >= 35
                        ? 'border-amber-500/40 bg-amber-950/50 text-amber-300'
                        : 'border-emerald-500/40 bg-emerald-950/50 text-emerald-300'
                  }`}
                >
                  {result.aiScore >= 60 ? (
                    <ShieldAlert className="h-4 w-4" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                </div>
                <div>
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                      result.aiScore >= 60
                        ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                        : result.aiScore >= 35
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    }`}
                  >
                    {result.verdict}
                  </span>
                  <p className="mt-1 text-[11px] text-slate-300 leading-relaxed">
                    {result.summary}
                  </p>
                </div>
              </div>

              {/* Percentage Scoring */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="rounded-lg border border-red-500/25 bg-red-950/20 px-3 py-1.5 text-center">
                  <div className="font-mono text-base font-extrabold text-red-400">
                    {result.aiScore}%
                  </div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-400">AI</div>
                </div>
                <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/20 px-3 py-1.5 text-center">
                  <div className="font-mono text-base font-extrabold text-emerald-400">
                    {result.genuinityScore}%
                  </div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-400">Genuine</div>
                </div>
              </div>
            </div>

            {result.keySignals && result.keySignals.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1">
                {result.keySignals.map((signal, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 rounded bg-indigo-950/50 border border-indigo-500/20 px-2 py-0.5 text-[11px] text-indigo-200"
                  >
                    <CheckCircle2 className="h-3 w-3 text-indigo-400 shrink-0" />
                    {signal}
                  </span>
                ))}
              </div>
            )}

            {result.searchSources && result.searchSources.length > 0 && (
              <div className="mt-2.5 pt-2 border-t border-indigo-500/10 flex flex-wrap gap-1.5">
                {result.searchSources.map((src, idx) => (
                  <a
                    key={idx}
                    href={src.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-indigo-300 hover:text-indigo-200 bg-indigo-950/60 border border-indigo-500/25 px-2 py-0.5 rounded"
                  >
                    <span className="truncate max-w-[160px]">{src.title}</span>
                    <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
