// src/lib/useVoiceRecorder.ts
// ═══════════════════════════════════════════════════════════════════
//  Voice Logging — speech-to-text hook (roadmap feature #7).
//
//  Thin React wrapper around the browser's SpeechRecognition API.
//  No audio leaves the device through our proxy — STT runs locally
//  in the OS-level speech engine and we receive the final transcript.
//
//  Spec: docs/superpowers/specs/2026-05-22-ai-voice-logging-design.md
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';

export type VoiceErrorReason = 'no_speech' | 'denied' | 'unsupported' | 'other';

export interface UseVoiceRecorderOpts {
  /** BCP-47 language tag (default 'en-US'). */
  lang?: string;
  /** Fires once per session with the final transcript. */
  onResult?: (transcript: string) => void;
  /** Fires on STT failure (mapped to a small set of reasons). */
  onError?: (reason: VoiceErrorReason) => void;
}

export interface UseVoiceRecorder {
  /** True iff the browser exposes SpeechRecognition. */
  supported: boolean;
  /** True while a recogniser is active. */
  listening: boolean;
  /** Start a fresh single-utterance recogniser. */
  start: () => void;
  /** Stop the active recogniser (final onresult still fires). */
  stop: () => void;
}

// SpeechRecognition is not in TypeScript's standard lib; cast through any.
function getSR(): unknown {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useVoiceRecorder(opts: UseVoiceRecorderOpts = {}): UseVoiceRecorder {
  const SR = getSR() as (new () => SpeechRecognitionInstance) | null;
  const supported = !!SR;
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionInstance | null>(null);

  // Capture latest callbacks in refs so the handlers always see the
  // freshest version without re-creating the recogniser.
  const onResultRef = useRef(opts.onResult);
  const onErrorRef = useRef(opts.onError);
  onResultRef.current = opts.onResult;
  onErrorRef.current = opts.onError;

  useEffect(() => {
    return () => {
      try { recRef.current?.stop?.(); } catch { /* noop */ }
      recRef.current = null;
    };
  }, []);

  const start = (): void => {
    if (!supported || !SR || listening) return;
    let rec: SpeechRecognitionInstance;
    try {
      rec = new SR();
    } catch {
      onErrorRef.current?.('other');
      return;
    }
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = opts.lang || 'en-US';
    rec.onresult = (event: SpeechRecognitionEvent): void => {
      try {
        const last = event.results[event.results.length - 1];
        const transcript = (last?.[0]?.transcript || '').trim();
        if (transcript) onResultRef.current?.(transcript);
        else onErrorRef.current?.('no_speech');
      } catch {
        onErrorRef.current?.('other');
      }
    };
    rec.onerror = (event: { error?: string }): void => {
      const err = event?.error;
      const reason: VoiceErrorReason =
        err === 'not-allowed' || err === 'service-not-allowed' ? 'denied' :
          err === 'no-speech' ? 'no_speech' : 'other';
      onErrorRef.current?.(reason);
    };
    rec.onend = (): void => {
      setListening(false);
      recRef.current = null;
    };
    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch {
      onErrorRef.current?.('other');
      setListening(false);
    }
  };

  const stop = (): void => {
    try { recRef.current?.stop?.(); } catch { /* noop */ }
  };

  return { supported, listening, start, stop };
}

// Minimal local typing — the standard DOM lib does not ship a
// SpeechRecognition type, and we only touch a small surface.
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: { error?: string }) => void;
  onend: () => void;
  start(): void;
  stop(): void;
}
interface SpeechRecognitionEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
