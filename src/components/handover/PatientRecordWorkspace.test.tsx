import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { demoRecordPairs } from "@/lib/demo-records";

import { PatientRecordWorkspace, type PatientRecordWorkspaceProps } from "./PatientRecordWorkspace";

const pair = demoRecordPairs.P001;

if (!pair) {
  throw new Error("P001 데모 기록이 없습니다.");
}

function createBaseProps(overrides: Partial<PatientRecordWorkspaceProps> = {}): PatientRecordWorkspaceProps {
  return {
    pair,
    patientName: pair.current.name,
    busy: false,
    errorMessage: null,
    resetRequestId: 0,
    onCompare: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
}

function getRecordWorkspace() {
  return screen.getByRole("region", { name: /홍길동 원본 기록/ });
}

describe("PatientRecordWorkspace", () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
  });

  it("renders the previous chart read-only and the current chart as labelled structured inputs", async () => {
    const user = userEvent.setup();

    render(<PatientRecordWorkspace {...createBaseProps()} />);

    const workspace = getRecordWorkspace();
    expect(within(workspace).getByRole("tab", { name: /이전 기록/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(workspace).getByText("37.9", { exact: true })).toBeInTheDocument();
    expect(within(workspace).queryByRole("spinbutton", { name: "체온" })).not.toBeInTheDocument();

    await user.click(within(workspace).getByRole("tab", { name: /현재 기록/ }));

    expect(within(workspace).getByRole("spinbutton", { name: "체온" })).toHaveValue(38.2);
    expect(within(workspace).getByRole("spinbutton", { name: "수축기 혈압" })).toHaveValue(150);
    expect(within(workspace).getByRole("textbox", { name: "진단 1" })).toHaveValue("acute pharyngitis");
    expect(within(workspace).getByRole("textbox", { name: "투약 1 약명" })).toHaveValue("이부프로펜 400mg");
    expect(within(workspace).getByRole("textbox", { name: "간호기록 1" })).toHaveValue("인후통 호소");
    expect(within(workspace).getByLabelText("기록 시간")).toHaveValue("2026-07-02T09:00");
    expect(workspace).not.toHaveTextContent('{"patient_id"');
  });

  it("renders inline without dialog chrome or modal focus and scroll mechanics", async () => {
    const user = userEvent.setup();
    document.body.style.overflow = "scroll";

    render(
      <>
        <button type="button">현재 위치</button>
        <PatientRecordWorkspace {...createBaseProps()} />
      </>,
    );

    const workspace = getRecordWorkspace();
    const origin = screen.getByRole("button", { name: "현재 위치" });
    origin.focus();

    expect(workspace).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector(".record-drawer-backdrop")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "원본 기록 닫기" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("scroll");

    await user.keyboard("{Escape}");

    expect(origin).toHaveFocus();
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("submits a sanitized current record without exposing a JSON editor", async () => {
    const user = userEvent.setup();
    const onCompare = vi.fn().mockResolvedValue(undefined);

    render(<PatientRecordWorkspace {...createBaseProps({ onCompare })} />);

    const workspace = getRecordWorkspace();
    await user.click(within(workspace).getByRole("tab", { name: /현재 기록/ }));
    const temperature = within(workspace).getByRole("spinbutton", { name: "체온" });
    await user.clear(temperature);
    await user.type(temperature, "39.1");

    await user.click(within(workspace).getByRole("button", { name: "간호기록 추가" }));
    await user.type(within(workspace).getByRole("textbox", { name: "간호기록 3" }), "야간 관찰 필요");
    await user.click(within(workspace).getByRole("button", { name: "간호기록 추가" }));

    await user.click(within(workspace).getByRole("button", { name: "변경사항 비교" }));

    await waitFor(() => expect(onCompare).toHaveBeenCalledTimes(1));
    const [submitted] = onCompare.mock.calls[0] as [typeof pair.current];
    expect(submitted.patient_id).toBe("P001");
    expect(submitted.vitals.body_temperature).toBe(39.1);
    expect(submitted.notes).toEqual(["인후통 호소", "미열 지속", "야간 관찰 필요"]);
    expect(submitted.notes.every((note) => note.trim().length > 0)).toBe(true);
    expect(submitted.diagnosis.every((diagnosis) => diagnosis.trim().length > 0)).toBe(true);
    expect(submitted.medications.every((medication) =>
      medication.name.trim().length > 0 &&
      medication.route.trim().length > 0 &&
      medication.frequency.trim().length > 0,
    )).toBe(true);
  });

  it("resets an unsaved draft when the parent advances the reset request", async () => {
    const user = userEvent.setup();

    function WorkspaceHarness() {
      const [resetRequestId, setResetRequestId] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setResetRequestId((current) => current + 1)}>
            외부 초기화
          </button>
          <PatientRecordWorkspace {...createBaseProps({ resetRequestId })} />
        </>
      );
    }

    render(<WorkspaceHarness />);
    const workspace = getRecordWorkspace();
    await user.click(within(workspace).getByRole("tab", { name: /현재 기록/ }));
    const temperature = within(workspace).getByRole("spinbutton", { name: "체온" });
    await user.clear(temperature);
    await user.type(temperature, "39.1");
    expect(temperature).toHaveValue(39.1);

    await user.click(screen.getByRole("button", { name: "외부 초기화" }));

    await waitFor(() => expect(within(workspace).getByRole("spinbutton", { name: "체온" })).toHaveValue(38.2));
  });

  it("keeps each editable row's DOM identity when deleting a non-tail diagnosis, medication, or note", async () => {
    const user = userEvent.setup();

    render(<PatientRecordWorkspace {...createBaseProps()} />);

    const workspace = getRecordWorkspace();
    await user.click(within(workspace).getByRole("tab", { name: /현재 기록/ }));

    const secondDiagnosis = within(workspace).getByRole("textbox", { name: "진단 2" });
    await user.click(within(workspace).getByRole("button", { name: "진단 1 삭제" }));
    expect(within(workspace).getByRole("textbox", { name: "진단 1" })).toBe(secondDiagnosis);

    const secondMedication = within(workspace).getByRole("textbox", { name: "투약 2 약명" });
    await user.click(within(workspace).getByRole("button", { name: "투약 1 삭제" }));
    expect(within(workspace).getByRole("textbox", { name: "투약 1 약명" })).toBe(secondMedication);

    const secondNote = within(workspace).getByRole("textbox", { name: "간호기록 2" });
    await user.click(within(workspace).getByRole("button", { name: "간호기록 1 삭제" }));
    expect(within(workspace).getByRole("textbox", { name: "간호기록 1" })).toBe(secondNote);
  });

  it("preserves the source timezone suffix when editing the datetime-local wall time", async () => {
    const user = userEvent.setup();
    const onCompare = vi.fn();

    render(<PatientRecordWorkspace {...createBaseProps({ onCompare })} />);

    const workspace = getRecordWorkspace();
    await user.click(within(workspace).getByRole("tab", { name: /현재 기록/ }));
    const timestamp = within(workspace).getByLabelText("기록 시간");
    fireEvent.change(timestamp, { target: { value: "2026-07-02T09:15" } });
    expect(timestamp).toHaveValue("2026-07-02T09:15");

    await user.click(within(workspace).getByRole("button", { name: "변경사항 비교" }));

    await waitFor(() => expect(onCompare).toHaveBeenCalledTimes(1));
    const [submitted] = onCompare.mock.calls[0] as [typeof pair.current];
    expect(submitted.updated_at).toBe("2026-07-02T09:15:00+09:00");
  });

  it("disables record inputs and actions while a comparison is busy", async () => {
    const user = userEvent.setup();

    render(<PatientRecordWorkspace {...createBaseProps({ busy: true })} />);

    const workspace = getRecordWorkspace();
    await user.click(within(workspace).getByRole("tab", { name: /현재 기록/ }));

    expect(within(workspace).getByRole("spinbutton", { name: "체온" })).toBeDisabled();
    expect(within(workspace).getByRole("button", { name: "초기화" })).toBeDisabled();
    expect(within(workspace).getByRole("button", { name: "비교 중" })).toBeDisabled();
  });
});
