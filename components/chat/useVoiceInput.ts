"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

function subscribeNoop() {
  return () => {};
}
function getSpeechRecognitionSupport() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}
function getServerSnapshot() {
  return false;
}

interface UseVoiceInputOptions {
  lang?: string;
  /** Called with the running transcript (prior draft + finalized speech + interim speech) as the user talks. */
  onTranscriptChange: (fullText: string) => void;
}

/**
 * Thin wrapper around the browser's Web Speech API (SpeechRecognition).
 * Not part of the TS DOM lib, and Anthropic's Messages API has no native
 * audio input — so this does live in-browser speech-to-text and feeds the
 * result into the same text draft the user would otherwise type into.
 * Chrome/Edge only in practice; callers should hide the mic button when
 * `isSupported` is false rather than showing an error.
 */
export function useVoiceInput({ lang = "he-IL", onTranscriptChange }: UseVoiceInputOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef("");
  const finalTranscriptRef = useRef("");

  // useSyncExternalStore (not a render-time check) so the server snapshot (false)
  // and the client snapshot don't disagree during hydration.
  const isSupported = useSyncExternalStore(subscribeNoop, getSpeechRecognitionSupport, getServerSnapshot);

  // Recognition runs with `continuous = true` and is only stopped by an explicit click. Without
  // this cleanup, navigating away mid-recording left it running — the browser's microphone
  // indicator stayed on and audio kept being captured for a component that no longer exists.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop?.();
      recognitionRef.current = null;
    };
  }, []);

  const start = useCallback(
    (currentDraftText: string) => {
      if (!isSupported || isRecording) return;
      setError(null);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = lang;
      recognition.continuous = true;
      recognition.interimResults = true;

      baseTextRef.current = currentDraftText.trim() ? currentDraftText.trim() + " " : "";
      finalTranscriptRef.current = "";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        let interim = "";
        let final = finalTranscriptRef.current;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += transcript + " ";
          } else {
            interim += transcript;
          }
        }
        finalTranscriptRef.current = final;
        onTranscriptChange(baseTextRef.current + final + interim);
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onerror = (event: any) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setError("הגישה למיקרופון נחסמה — יש לאשר הרשאת מיקרופון בהגדרות הדפדפן.");
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          setError("שגיאה בזיהוי הדיבור. נסו שוב.");
        }
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsRecording(true);
    },
    [isSupported, isRecording, lang, onTranscriptChange]
  );

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return { isSupported, isRecording, error, start, stop };
}
