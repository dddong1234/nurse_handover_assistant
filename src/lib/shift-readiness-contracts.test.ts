import { describe, expect, it } from "vitest";

import { createValidShiftReadinessResponse } from "@/test/shift-readiness-fixtures";

import {
  isShiftReadinessResponse,
  parseShiftReadinessResponse,
} from "./shift-readiness-contracts";

describe("Shift Readiness response contract", () => {
  it("accepts a complete response and rejects a dangling source or group ID", () => {
    const response = createValidShiftReadinessResponse();
    expect(parseShiftReadinessResponse(response)).toEqual(response);
    expect(isShiftReadinessResponse(response)).toBe(true);

    const danglingGroup = structuredClone(response);
    danglingGroup.groups.investigations = ["missing-item"];
    expect(() => parseShiftReadinessResponse(danglingGroup)).toThrow();

    const missingSource = structuredClone(response);
    missingSource.items[0]!.sourceRefs = [];
    expect(() => parseShiftReadinessResponse(missingSource)).toThrow();
  });

  it("rejects unknown keys at every owned response boundary", () => {
    const topLevel = structuredClone(createValidShiftReadinessResponse()) as Record<string, unknown>;
    topLevel.extra = true;
    expect(() => parseShiftReadinessResponse(topLevel)).toThrow();

    const item = structuredClone(createValidShiftReadinessResponse());
    (item.items[0] as Record<string, unknown>).extra = true;
    expect(() => parseShiftReadinessResponse(item)).toThrow();

    const source = structuredClone(createValidShiftReadinessResponse());
    (source.items[0]!.sourceRefs[0] as Record<string, unknown>).extra = true;
    expect(() => parseShiftReadinessResponse(source)).toThrow();

    const metrics = structuredClone(createValidShiftReadinessResponse());
    (metrics.metrics.domainCounts as Record<string, unknown>).extra = 0;
    expect(() => parseShiftReadinessResponse(metrics)).toThrow();
  });

  it("rejects unsupported enums and duplicate item IDs", () => {
    const badDomain = structuredClone(createValidShiftReadinessResponse());
    badDomain.items[0]!.domain = "unknown" as never;
    expect(() => parseShiftReadinessResponse(badDomain)).toThrow();

    const badStatus = structuredClone(createValidShiftReadinessResponse());
    badStatus.status = "unknown" as never;
    expect(() => parseShiftReadinessResponse(badStatus)).toThrow();

    const duplicateId = structuredClone(createValidShiftReadinessResponse());
    duplicateId.items[1]!.id = duplicateId.items[0]!.id;
    expect(() => parseShiftReadinessResponse(duplicateId)).toThrow();
  });

  it("requires each item to belong to exactly one matching domain group", () => {
    const noGroup = structuredClone(createValidShiftReadinessResponse());
    noGroup.groups.patientStatus = [];
    expect(() => parseShiftReadinessResponse(noGroup)).toThrow();

    const twoGroups = structuredClone(createValidShiftReadinessResponse());
    twoGroups.groups.investigations.push(twoGroups.groups.patientStatus[0]!);
    expect(() => parseShiftReadinessResponse(twoGroups)).toThrow();

    const wrongDomain = structuredClone(createValidShiftReadinessResponse());
    wrongDomain.groups.lineDevices = [wrongDomain.groups.patientStatus[0]!];
    expect(() => parseShiftReadinessResponse(wrongDomain)).toThrow();
  });

  it("rejects non-offset timestamps and invalid source selector encoding", () => {
    const timestamp = structuredClone(createValidShiftReadinessResponse());
    timestamp.items[0]!.relevantAt = "2026-07-02T09:00:00";
    expect(() => parseShiftReadinessResponse(timestamp)).toThrow();

    const noOffsetSource = structuredClone(createValidShiftReadinessResponse());
    noOffsetSource.items[1]!.sourceRefs[0]!.recordedAt = "2026-07-02T09:00:00";
    expect(() => parseShiftReadinessResponse(noOffsetSource)).toThrow();

    const malformedSelector = structuredClone(createValidShiftReadinessResponse());
    malformedSelector.items[1]!.sourceRefs[0]!.path = "investigations[id=INV-P001-CBC";
    expect(() => parseShiftReadinessResponse(malformedSelector)).toThrow();

    const lowerPercentHex = structuredClone(createValidShiftReadinessResponse());
    lowerPercentHex.items[5]!.sourceRefs[0]!.path =
      "medications[name=%ed%83%80%ec%84%b8%eb%86%80%ec%a0%95%20500mg]";
    expect(() => parseShiftReadinessResponse(lowerPercentHex)).toThrow();

    const unescapedSelectorCharacter = structuredClone(createValidShiftReadinessResponse());
    unescapedSelectorCharacter.items[1]!.sourceRefs[0]!.path = "investigations[id=INV!P001]";
    expect(() => parseShiftReadinessResponse(unescapedSelectorCharacter)).toThrow();
  });

  it("rejects malformed period references and direct/period mixtures", () => {
    const blankEvent = structuredClone(createValidShiftReadinessResponse());
    blankEvent.items[0]!.sourceRefs[0]!.periodEventId = "  ";
    expect(() => parseShiftReadinessResponse(blankEvent)).toThrow();

    const emptyEvent = structuredClone(createValidShiftReadinessResponse());
    emptyEvent.items[0]!.sourceRefs[0]!.periodEventId = "";
    expect(() => parseShiftReadinessResponse(emptyEvent)).toThrow();

    const mixed = structuredClone(createValidShiftReadinessResponse());
    mixed.items[0]!.sourceRefs[0]!.path = "investigations[id=INV-P001-CBC]";
    expect(() => parseShiftReadinessResponse(mixed)).toThrow();

    const malformedFieldPath = structuredClone(createValidShiftReadinessResponse());
    malformedFieldPath.items[0]!.sourceRefs[0]!.path = "vitals[body_temperature]";
    expect(() => parseShiftReadinessResponse(malformedFieldPath)).toThrow();
  });

  it("rejects metrics that do not describe the item and group sets", () => {
    const itemCount = structuredClone(createValidShiftReadinessResponse());
    itemCount.metrics.itemCount = 6;
    expect(() => parseShiftReadinessResponse(itemCount)).toThrow();

    const statusCount = structuredClone(createValidShiftReadinessResponse());
    statusCount.metrics.newResultCount = 0;
    expect(() => parseShiftReadinessResponse(statusCount)).toThrow();

    const domainCount = structuredClone(createValidShiftReadinessResponse());
    domainCount.metrics.domainCounts.investigation = 2;
    expect(() => parseShiftReadinessResponse(domainCount)).toThrow();

    const patientMismatch = structuredClone(createValidShiftReadinessResponse());
    patientMismatch.items[0]!.patientId = "P002";
    expect(() => parseShiftReadinessResponse(patientMismatch)).toThrow();
  });

  it("accepts a direct selector with RFC3986 encoding and a period field path", () => {
    const response = createValidShiftReadinessResponse();
    expect(response.items[5]!.sourceRefs[0]!.path).toContain("%ED");
    expect(parseShiftReadinessResponse(response).items[0]!.sourceRefs[0]!.periodEventId).toBe(
      "period-event-P001-vitals",
    );
  });
});
