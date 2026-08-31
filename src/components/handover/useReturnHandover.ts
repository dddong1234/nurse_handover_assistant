"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { HandoverApiError, requestHandoverPeriodComparison } from "@/lib/handover-period-api";
import type { HandoverRecord } from "@/lib/handover-api";
import type {
  HandoverPeriodApiResponse,
  HandoverPeriodCoverageGap,
} from "@/lib/handover-period-contracts";

export type ReturnHandoverKey = `${string}:${string}:${string}`;

export type ReturnHandoverInput = {
  patientId: string;
  reviewStartAt: string;
  records: HandoverRecord[];
  coverageGaps: ReadonlyArray<HandoverPeriodCoverageGap>;
  currentRecordFingerprint: string;
  enabled: boolean;
};

export type ReturnHandoverState = {
  status: "idle" | "loading" | "success" | "error";
  response: HandoverPeriodApiResponse | null;
  error: HandoverApiError | null;
};

const MAX_CACHE_ENTRIES = 24;
const responseCache = new Map<ReturnHandoverKey, HandoverPeriodApiResponse>();

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function digest(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Create a stable, non-reversible fingerprint for a current record. */
export function createCurrentRecordFingerprint(record: unknown): string {
  return digest(stableSerialize(record));
}

/** Normalize a supplied fingerprint before putting it into a cache key. */
export function normalizeCurrentRecordFingerprint(fingerprint: string): string {
  const trimmed = fingerprint.trim();
  if (!trimmed) return digest("");
  if (/^[0-9a-f]{8}$/i.test(trimmed)) return trimmed.toLowerCase();

  try {
    return digest(stableSerialize(JSON.parse(trimmed) as unknown));
  } catch {
    return trimmed;
  }
}

export function createReturnHandoverKey(
  patientId: string,
  reviewStartAt: string,
  currentRecordFingerprint: string,
): ReturnHandoverKey {
  // Coverage gaps are immutable per patient fixture, so patient/start/fingerprint remains the cache identity.
  return `${patientId}:${reviewStartAt}:${normalizeCurrentRecordFingerprint(currentRecordFingerprint)}`;
}

function cacheResponse(key: ReturnHandoverKey, response: HandoverPeriodApiResponse) {
  responseCache.delete(key);
  responseCache.set(key, response);
  while (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value as ReturnHandoverKey | undefined;
    if (!oldestKey) break;
    responseCache.delete(oldestKey);
  }
}

/** Clear the in-memory browser-session cache (primarily useful for isolated tests). */
export function clearReturnHandoverCache() {
  responseCache.clear();
}

function asHandoverApiError(error: unknown): HandoverApiError {
  if (error instanceof HandoverApiError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new HandoverApiError("ABORTED");
  }
  return new HandoverApiError("NETWORK_ERROR");
}

export function useReturnHandover(input: ReturnHandoverInput): ReturnHandoverState & { retry(): void } {
  const { patientId, reviewStartAt, currentRecordFingerprint, enabled } = input;
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, setState] = useState<ReturnHandoverState>({
    status: "idle",
    response: null,
    error: null,
  });
  const generationRef = useRef(0);
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const key = useMemo(
    () => createReturnHandoverKey(patientId, reviewStartAt, currentRecordFingerprint),
    [currentRecordFingerprint, patientId, reviewStartAt],
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const requestInput = inputRef.current;

    if (!requestInput.enabled) {
      setState((current) => {
        if (current.status === "idle" && current.response === null && current.error === null) {
          return current;
        }
        return { status: "idle", response: current.response, error: null };
      });
      return () => {
        if (generationRef.current === generation) generationRef.current += 1;
      };
    }

    const cached = responseCache.get(key);
    if (cached) {
      return () => {
        if (generationRef.current === generation) generationRef.current += 1;
      };
    }

    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setState((current) => ({ status: "loading", response: current.response, error: null }));
    });

    void requestHandoverPeriodComparison(
      {
        reviewStartAt: requestInput.reviewStartAt,
        records: requestInput.records,
        coverageGaps: requestInput.coverageGaps,
        summaryMode: "deterministic",
      },
      { signal: controller.signal },
    )
      .then((response) => {
        if (controller.signal.aborted || generationRef.current !== generation) return;
        cacheResponse(key, response);
        setState({ status: "success", response, error: null });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          generationRef.current !== generation ||
          (error instanceof HandoverApiError && error.code === "ABORTED")
        ) {
          return;
        }
        setState((current) => ({
          status: "error",
          response: current.response,
          error: asHandoverApiError(error),
        }));
      });

    return () => {
      controller.abort();
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [enabled, key, retryVersion]);

  const visibleState = !enabled
    ? { status: "idle" as const, response: state.response, error: null }
    : responseCache.get(key)
      ? { status: "success" as const, response: responseCache.get(key)!, error: null }
      : state;

  return {
    ...visibleState,
    retry: () => setRetryVersion((current) => current + 1),
  };
}
