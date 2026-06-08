// src/components/VoiceCommand.tsx
// ═══════════════════════════════════════════════════════════════════
//  VoiceCommand — free, deterministic tap-to-talk for owner/dispatch.
//
//  Web Speech API does the STT (desktop / Android Chrome). The transcript
//  is parsed by the deterministic parseVoiceCommand() (no AI, no network)
//  into a typed intent, then executed:
//    • navigate → setTab
//    • metric   → compute from live data + speak it back (SpeechSynthesis)
//    • newJob   → open the Add Job form
//  All v1 intents are read-only / navigation, so they run instantly.
//
//  Browsers without SpeechRecognition (notably iOS Safari/Chrome) render
//  NOTHING — no dead mic. Readback uses SpeechSynthesis (works on iOS too,
//  but the mic is the gate here).
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Job, Settings, TabId } from '@/types';
import { money, jobGrossProfit } from '@/lib/utils';
import { TODAY } from '@/lib/defaults';
import { parseVoiceCommand, type VoiceMetric } from '@/lib/voiceCommands';

// Minimal Web Speech typings (not in lib.dom across all targets).
interface SRResultList { 0: { 0: { transcript: string } }; length: number; }
interface SREvent { results: SRResultList; }
interface SRInstance {
  lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean;
  start(): void; stop(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SRInstance;

function getSR(): SRCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function speak(text: string): void {
  try {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    window.speechSynthesis.speak(u);
  } catch { /* TTS optional */ }
}

interface Props {
  onNavigate: (tab: TabId) => void;
  onNewJob: () => void;
  jobs: Job[];
  settings: Settings;
  canViewFinancials: boolean;
}

const EXAMPLES = "Try: “today's revenue”, “jobs today”, “open inventory”, or “new job”.";

export function VoiceCommand({ onNavigate, onNewJob, jobs, settings, canViewFinancials }: Props): JSX.Element | null {
  const SR = useRef<SRCtor | null>(getSR());
  const recRef = useRef<SRInstance | null>(null);
  const [listening, setListening] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Compute a spoken answer for a metric from live data.
  const answerMetric = useCallback((metric: VoiceMetric): string => {
    if ((metric === 'revenueToday' || metric === 'profitToday') && !canViewFinancials) {
      return 'Financials are available to owners and admins.';
    }
    const today = TODAY();
    const todayJobs = jobs.filter((j) => j.date === today);
    const completed = todayJobs.filter((j) => j.status === 'Completed');
    if (metric === 'revenueToday') {
      const rev = completed.reduce((s, j) => s + (Number(j.revenue) || 0), 0);
      return `Today's revenue is ${money(rev)} across ${completed.length} completed ${completed.length === 1 ? 'job' : 'jobs'}.`;
    }
    if (metric === 'profitToday') {
      const profit = completed.reduce((s, j) => s + jobGrossProfit(j, settings), 0);
      return `Today's profit is ${money(profit)}.`;
    }
    // jobsToday
    return `${completed.length} ${completed.length === 1 ? 'job' : 'jobs'} completed today, ${todayJobs.length} total.`;
  }, [jobs, settings, canViewFinancials]);

  const handleTranscript = useCallback((raw: string) => {
    const intent = parseVoiceCommand(raw);
    switch (intent.type) {
      case 'navigate':
        setFeedback(`Opening ${intent.label}…`);
        onNavigate(intent.tab);
        break;
      case 'newJob':
        setFeedback('Starting a new job…');
        onNewJob();
        break;
      case 'metric': {
        const answer = answerMetric(intent.metric);
        setFeedback(answer);
        speak(answer);
        break;
      }
      default:
        setFeedback(`Didn't catch that. ${EXAMPLES}`);
    }
  }, [onNavigate, onNewJob, answerMetric]);

  const start = useCallback(() => {
    const Ctor = SR.current;
    if (!Ctor || listening) return;
    try {
      const rec = new Ctor();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.continuous = false;
      rec.onresult = (e) => {
        const t = e.results?.[0]?.[0]?.transcript ?? '';
        if (t) handleTranscript(t);
      };
      rec.onerror = (e) => {
        setListening(false);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          setFeedback('Microphone permission is blocked — allow it in your browser to use voice.');
        }
      };
      rec.onend = () => setListening(false);
      recRef.current = rec;
      setFeedback(null);
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
      setFeedback('Voice could not start.');
    }
  }, [listening, handleTranscript]);

  // Auto-clear feedback after a few seconds.
  useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(null), 6000);
    return () => clearTimeout(id);
  }, [feedback]);

  // Cleanup on unmount.
  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* */ } }, []);

  // No SpeechRecognition (e.g. iOS) → render nothing. No dead mic.
  if (!SR.current) return null;

  return (
    <>
      {feedback && (
        <div style={feedbackCard} role="status" aria-live="polite">{feedback}</div>
      )}
      <button
        type="button"
        onClick={listening ? () => recRef.current?.stop() : start}
        aria-label={listening ? 'Stop listening' : 'Voice command'}
        aria-pressed={listening}
        style={{ ...micButton, ...(listening ? micListening : null) }}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
        </svg>
      </button>
    </>
  );
}

const micButton: CSSProperties = {
  position: 'fixed',
  right: 'calc(16px + var(--safe-r, 0px))',
  bottom: 'calc(72px + var(--safe-bot, 0px))',
  width: 52, height: 52, borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--brand-primary)', color: '#14110a', border: 'none',
  boxShadow: '0 6px 18px -4px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.2)',
  cursor: 'pointer', zIndex: 50,
  WebkitTapHighlightColor: 'transparent',
  transition: 'transform .12s ease, box-shadow .15s ease, background .15s ease',
};
const micListening: CSSProperties = {
  background: '#ef4444', color: '#fff',
  boxShadow: '0 0 0 6px rgba(239,68,68,.22), 0 6px 18px -4px rgba(0,0,0,.55)',
  transform: 'scale(1.05)',
};
const feedbackCard: CSSProperties = {
  position: 'fixed',
  right: 'calc(16px + var(--safe-r, 0px))',
  bottom: 'calc(134px + var(--safe-bot, 0px))',
  maxWidth: 'min(320px, 80vw)',
  background: 'var(--s2)', color: 'var(--t1)',
  border: '1px solid var(--border)', borderRadius: 12,
  padding: '10px 13px', fontSize: 13, lineHeight: 1.4,
  boxShadow: '0 10px 30px -8px rgba(0,0,0,.6)', zIndex: 50,
};
