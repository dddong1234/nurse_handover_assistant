"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  HandoverApiError,
  requestShiftReadinessComparison,
  type ShiftReadinessRequest,
  type ShiftReadinessResponse,
} from "@/lib/shift-readiness-api";
import type { ShiftWindow } from "@/lib/shift-readiness-contracts";

import {
  createCurrentRecordFingerprint,
  normalizeCurrentRecordFingerprint,
} from "./useReturnHandover";

export type ShiftReadinessKey = `sr:${string}`;

export type ShiftReadinessState = {
  status: "idle" | "loading" | "success" | "error";
  response: ShiftReadinessResponse | null;
  error: HandoverApiError | null;
};

export type ShiftReadinessHookInput = ShiftReadinessRequest & {
  patientId: string;
  currentRecordFingerprint: string;
  enabled: boolean;
};

export type ShiftReadinessRosterEntry = ShiftReadinessState & {
  key: ShiftReadinessKey;
};

const MAX_CACHE_ENTRIES = 24;
const responseCache = new Map<ShiftReadinessKey, ShiftReadinessResponse>();

type RequestSubscriber = {
  onSuccess: (response: ShiftReadinessResponse) => void;
  onError: (error: unknown) => void;
};

type SharedRequest = {
  controller: AbortController;
  promise: Promise<ShiftReadinessResponse>;
  subscribers: Map<symbol, RequestSubscriber>;
};

const inFlightRequests = new Map<ShiftReadinessKey, SharedRequest>();

function hasMatchingPatientRecords(input: ShiftReadinessHookInput): boolean {
  if (!Array.isArray(input.records) || input.records.length === 0) return false;
  return input.records.every((record) => {
    if (typeof record !== "object" || record === null || Array.isArray(record)) return false;
    return "patient_id" in record && record.patient_id === input.patientId;
  });
}

function cacheResponse(key: ShiftReadinessKey, response: ShiftReadinessResponse): void {
  responseCache.delete(key);
  responseCache.set(key, response);
  while (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value as ShiftReadinessKey | undefined;
    if (oldestKey === undefined) break;
    responseCache.delete(oldestKey);
  }
}

function cachedResponse(key: ShiftReadinessKey): ShiftReadinessResponse | null {
  const response = responseCache.get(key);
  if (!response) return null;

  // Treat a cache hit as recent so the bounded cache retains actively reviewed patients.
  responseCache.delete(key);
  responseCache.set(key, response);
  return response;
}

function asHandoverApiError(error: unknown): HandoverApiError {
  if (error instanceof HandoverApiError) return error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (
      code === "ABORTED" ||
      code === "NETWORK_ERROR" ||
      code === "REQUEST_SERIALIZATION" ||
      code === "HTTP_ERROR" ||
      code === "MALFORMED_RESPONSE" ||
      code === "INVALID_RESPONSE" ||
      code === "PATIENT_MISMATCH"
    ) {
      return new HandoverApiError(code);
    }
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  ) {
    return new HandoverApiError("ABORTED");
  }
  return new HandoverApiError("NETWORK_ERROR");
}

function isAbortedError(error: unknown): boolean {
  return (
    (error instanceof HandoverApiError && error.code === "ABORTED") ||
    (typeof error === "object" && error !== null && "code" in error && error.code === "ABORTED") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
  );
}

function requestPayload(input: ShiftReadinessHookInput): ShiftReadinessRequest {
  return {
    reviewStartAt: input.reviewStartAt,
    shift: input.shift,
    records: input.records,
    coverageGaps: input.coverageGaps,
  };
}

function settleSharedRequest(
  key: ShiftReadinessKey,
  request: SharedRequest,
  outcome: { response: ShiftReadinessResponse } | { error: unknown },
): void {
  if (inFlightRequests.get(key) !== request) return;
  inFlightRequests.delete(key);

  if (request.controller.signal.aborted) {
    request.subscribers.clear();
    return;
  }

  if ("response" in outcome) cacheResponse(key, outcome.response);
  const subscribers = [...request.subscribers.values()];
  request.subscribers.clear();
  for (const subscriber of subscribers) {
    if ("response" in outcome) subscriber.onSuccess(outcome.response);
    else subscriber.onError(outcome.error);
  }
}

function getOrStartSharedRequest(
  key: ShiftReadinessKey,
  input: ShiftReadinessHookInput,
): SharedRequest {
  const existing = inFlightRequests.get(key);
  if (existing) return existing;

  const controller = new AbortController();
  const request = {
    controller,
    promise: Promise.resolve<ShiftReadinessResponse>(undefined as never),
    subscribers: new Map<symbol, RequestSubscriber>(),
  } satisfies SharedRequest;
  inFlightRequests.set(key, request);

  try {
    request.promise = Promise.resolve(
      requestShiftReadinessComparison(requestPayload(input), { signal: controller.signal }),
    );
  } catch (error) {
    request.promise = Promise.reject(error);
  }

  void request.promise.then(
    (response) => settleSharedRequest(key, request, { response }),
    (error: unknown) => settleSharedRequest(key, request, { error }),
  );
  return request;
}

function subscribeToSharedRequest(
  key: ShiftReadinessKey,
  input: ShiftReadinessHookInput,
  subscriber: RequestSubscriber,
): () => void {
  const request = getOrStartSharedRequest(key, input);
  const token = Symbol(key);
  request.subscribers.set(token, subscriber);
  let released = false;

  return () => {
    if (released) return;
    released = true;
    request.subscribers.delete(token);
    if (request.subscribers.size === 0 && inFlightRequests.get(key) === request) {
      inFlightRequests.delete(key);
      request.controller.abort();
    }
  };
}

function initialState(key: ShiftReadinessKey): { key: ShiftReadinessKey; state: ShiftReadinessState } {
  return {
    key,
    state: { status: "idle", response: null, error: null },
  };
}

/**
 * Build a privacy-preserving identity for one Shift Readiness request.
 * The digest is deliberately derived from a fixed-key object and contains no raw request values.
 */
export function createShiftReadinessKey(
  patientId: string,
  reviewStartAt: string,
  shift: ShiftWindow,
  currentRecordFingerprint: string,
): ShiftReadinessKey {
  const canonical = {
    patientId,
    reviewStartAt,
    shiftStartsAt: shift.startsAt,
    shiftEndsAt: shift.endsAt,
    currentRecordFingerprint: normalizeCurrentRecordFingerprint(currentRecordFingerprint),
  };
  return `sr:${createCurrentRecordFingerprint(canonical)}`;
}

export function useShiftReadiness(
  input: ShiftReadinessHookInput,
): ShiftReadinessState & { key: ShiftReadinessKey; retry(): void } {
  const { enabled, patientId, reviewStartAt, shift, currentRecordFingerprint } = input;
  const key = useMemo(
    () => createShiftReadinessKey(patientId, reviewStartAt, shift, currentRecordFingerprint),
    [currentRecordFingerprint, patientId, reviewStartAt, shift],
  );
  const [internal, setInternal] = useState(() => initialState(key));
  const inputRef = useRef(input);
  const internalRef = useRef(internal);
  const generationRef = useRef(0);
  const [retryRequest, setRetryRequest] = useState<{
    key: ShiftReadinessKey;
    version: number;
  } | null>(null);
  const handledRetryVersionRef = useRef(0);
  const requestIdentityValid = hasMatchingPatientRecords(input);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    internalRef.current = internal;
  }, [internal]);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const requestInput = inputRef.current;
    const forceRefresh =
      retryRequest !== null &&
      retryRequest.version > handledRetryVersionRef.current &&
      retryRequest.key === key;
    if (retryRequest !== null && retryRequest.version > handledRetryVersionRef.current) {
      handledRetryVersionRef.current = retryRequest.version;
    }

    if (!requestInput.enabled) {
      setInternal({ key, state: { status: "idle", response: null, error: null } });
      return () => {
        if (generationRef.current === generation) generationRef.current += 1;
      };
    }

    if (!requestIdentityValid || !hasMatchingPatientRecords(requestInput)) {
      setInternal({
        key,
        state: {
          status: "error",
          response: null,
          error: new HandoverApiError("PATIENT_MISMATCH"),
        },
      });
      return () => {
        if (generationRef.current === generation) generationRef.current += 1;
      };
    }

    const previousResponse =
      cachedResponse(key) ??
      (internalRef.current.key === key ? internalRef.current.state.response : null);
    if (previousResponse && !forceRefresh && !inFlightRequests.has(key)) {
      setInternal({ key, state: { status: "success", response: previousResponse, error: null } });
      return () => {
        if (generationRef.current === generation) generationRef.current += 1;
      };
    }

    setInternal({
      key,
      state: { status: "loading", response: previousResponse, error: null },
    });
    const release = subscribeToSharedRequest(key, requestInput, {
      onSuccess: (response) => {
        if (generationRef.current !== generation) return;
        setInternal({ key, state: { status: "success", response, error: null } });
      },
      onError: (error: unknown) => {
        if (generationRef.current !== generation || isAbortedError(error)) return;
        setInternal({
          key,
          state: {
            status: "error",
            response: previousResponse,
            error: asHandoverApiError(error),
          },
        });
      },
    });

    return () => {
      release();
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [enabled, key, requestIdentityValid, retryRequest]);

  const retry = useCallback(() => {
    if (!enabled) return;
    setRetryRequest((current) => ({
      key,
      version: (current?.version ?? 0) + 1,
    }));
  }, [enabled, key]);

  let visibleState: ShiftReadinessState;
  if (!enabled) {
    visibleState = { status: "idle", response: null, error: null };
  } else if (!hasMatchingPatientRecords(input)) {
    visibleState = {
      status: "error",
      response: null,
      error: new HandoverApiError("PATIENT_MISMATCH"),
    };
  } else if (internal.key !== key) {
    const response = responseCache.get(key) ?? null;
    visibleState = response
      ? { status: "success", response, error: null }
      : { status: "loading", response: null, error: null };
  } else {
    visibleState = internal.state;
  }

  return { ...visibleState, key, retry };
}

type RosterTarget = {
  patientId: string;
  input: ShiftReadinessHookInput;
  key: ShiftReadinessKey;
};

type RosterSubscription = {
  key: ShiftReadinessKey;
  generation: number;
  release: () => void;
};

function uniqueRosterTargets(
  inputs: readonly ShiftReadinessHookInput[],
  enabled: boolean,
): RosterTarget[] {
  if (!enabled) return [];
  const targets: RosterTarget[] = [];
  const patients = new Set<string>();
  for (const input of inputs) {
    if (patients.has(input.patientId)) continue;
    patients.add(input.patientId);
    targets.push({
      patientId: input.patientId,
      input,
      key: createShiftReadinessKey(
        input.patientId,
        input.reviewStartAt,
        input.shift,
        input.currentRecordFingerprint,
      ),
    });
    if (targets.length === 5) break;
  }
  return targets;
}

function rosterState(
  status: ShiftReadinessState["status"],
  response: ShiftReadinessResponse | null,
  error: HandoverApiError | null,
): ShiftReadinessState {
  return { status, response, error };
}

export function useShiftReadinessRoster(
  inputs: readonly ShiftReadinessHookInput[],
  enabled: boolean,
): {
  entriesByPatient: ReadonlyMap<string, ShiftReadinessRosterEntry>;
  retry(patientId: string): void;
} {
  const targets = useMemo(() => uniqueRosterTargets(inputs, enabled), [enabled, inputs]);
  const targetSignature = useMemo(
    () =>
      JSON.stringify(
        targets.map((target) => [target.patientId, target.key, hasMatchingPatientRecords(target.input)]),
      ),
    [targets],
  );
  const targetsRef = useRef(targets);
  const [entries, setEntries] = useState<Map<string, ShiftReadinessRosterEntry>>(
    () => new Map(),
  );
  const entriesRef = useRef(entries);
  const subscriptionsRef = useRef(new Map<string, RosterSubscription>());
  const generationsRef = useRef(new Map<string, number>());
  const forceRefreshPatientsRef = useRef(new Set<string>());
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const nextGeneration = (patientId: string): number => {
    const generation = (generationsRef.current.get(patientId) ?? 0) + 1;
    generationsRef.current.set(patientId, generation);
    return generation;
  };

  const setRosterEntry = (
    patientId: string,
    key: ShiftReadinessKey,
    generation: number,
    state: ShiftReadinessState,
  ): void => {
    if (generationsRef.current.get(patientId) !== generation) return;
    const subscription = subscriptionsRef.current.get(patientId);
    if (subscription && (subscription.key !== key || subscription.generation !== generation)) return;
    setEntries((current) => {
      const next = new Map(current);
      next.set(patientId, { key, ...state });
      return next;
    });
  };

  useEffect(() => {
    const activeTargets = targetsRef.current;
    const targetsByPatient = new Map(activeTargets.map((target) => [target.patientId, target]));

    for (const [patientId, subscription] of subscriptionsRef.current) {
      const target = targetsByPatient.get(patientId);
      const forceRefresh = forceRefreshPatientsRef.current.has(patientId);
      if (!target || target.key !== subscription.key || forceRefresh) {
        subscription.release();
        subscriptionsRef.current.delete(patientId);
        nextGeneration(patientId);
      }
    }

    if (!enabled) {
      forceRefreshPatientsRef.current.clear();
      return;
    }

    for (const target of activeTargets) {
      const forceRefresh = forceRefreshPatientsRef.current.has(target.patientId);
      if (forceRefresh) forceRefreshPatientsRef.current.delete(target.patientId);

      const existingSubscription = subscriptionsRef.current.get(target.patientId);
      if (!hasMatchingPatientRecords(target.input)) {
        if (existingSubscription) {
          existingSubscription.release();
          subscriptionsRef.current.delete(target.patientId);
        }
        const generation = nextGeneration(target.patientId);
        setRosterEntry(
          target.patientId,
          target.key,
          generation,
          rosterState("error", null, new HandoverApiError("PATIENT_MISMATCH")),
        );
        continue;
      }
      if (existingSubscription && existingSubscription.key === target.key && !forceRefresh) continue;

      const existingEntry = entriesRef.current.get(target.patientId);
      if (
        !forceRefresh &&
        !existingSubscription &&
        existingEntry?.key === target.key &&
        (existingEntry.status === "success" || existingEntry.status === "error")
      ) {
        continue;
      }

      const generation = nextGeneration(target.patientId);
      const previousResponse =
        cachedResponse(target.key) ??
        (existingEntry?.key === target.key ? existingEntry.response : null);
      if (previousResponse && !forceRefresh) {
        setRosterEntry(
          target.patientId,
          target.key,
          generation,
          rosterState("success", previousResponse, null),
        );
        continue;
      }

      setRosterEntry(
        target.patientId,
        target.key,
        generation,
        rosterState("loading", previousResponse, null),
      );
      const release = subscribeToSharedRequest(target.key, target.input, {
        onSuccess: (response) => {
          setRosterEntry(
            target.patientId,
            target.key,
            generation,
            rosterState("success", response, null),
          );
        },
        onError: (error: unknown) => {
          if (isAbortedError(error)) return;
          setRosterEntry(
            target.patientId,
            target.key,
            generation,
            rosterState("error", previousResponse, asHandoverApiError(error)),
          );
        },
      });
      subscriptionsRef.current.set(target.patientId, {
        key: target.key,
        generation,
        release,
      });
    }
  }, [enabled, retryVersion, targetSignature]);

  useEffect(
    () => () => {
      for (const subscription of subscriptionsRef.current.values()) subscription.release();
      subscriptionsRef.current.clear();
      for (const patientId of generationsRef.current.keys()) nextGeneration(patientId);
    },
    [],
  );

  const visibleEntries = useMemo(() => {
    if (!enabled) return new Map<string, ShiftReadinessRosterEntry>();

    const visible = new Map<string, ShiftReadinessRosterEntry>();
    for (const target of targets) {
      if (!hasMatchingPatientRecords(target.input)) {
        visible.set(target.patientId, {
          key: target.key,
          ...rosterState("error", null, new HandoverApiError("PATIENT_MISMATCH")),
        });
        continue;
      }
      const entry = entries.get(target.patientId);
      if (entry?.key === target.key) {
        visible.set(target.patientId, entry);
        continue;
      }
      const response = responseCache.get(target.key) ?? null;
      visible.set(
        target.patientId,
        {
          key: target.key,
          ...rosterState(response ? "success" : "loading", response, null),
        },
      );
    }
    return visible;
  }, [enabled, entries, targets]);

  const retry = useCallback(
    (patientId: string) => {
      if (!enabled || !targets.some((target) => target.patientId === patientId)) return;
      forceRefreshPatientsRef.current.add(patientId);
      setRetryVersion((version) => version + 1);
    },
    [enabled, targets],
  );

  return { entriesByPatient: visibleEntries, retry };
}
