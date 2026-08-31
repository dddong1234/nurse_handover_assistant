import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { demoRecordPairs } from "@/lib/demo-records";

import { PatientRecordDrawer } from "./PatientRecordDrawer";

const pair = demoRecordPairs.P001;

if (!pair) {
  throw new Error("P001 데모 기록이 없습니다.");
}

describe("PatientRecordDrawer", () => {
  afterEach(() => cleanup());

  it("shows the previous chart read-only and the current chart as labelled structured inputs", async () => {
    const user = userEvent.setup();

    render(
      <PatientRecordDrawer
        open
        pair={pair}
        patientName={pair.current.name}
        busy={false}
        errorMessage={null}
        onClose={vi.fn()}
        onCompare={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: /홍길동/ });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("tab", { name: /이전 기록/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(dialog).getByText("37.9", { exact: true })).toBeInTheDocument();
    expect(within(dialog).queryByRole("spinbutton", { name: "체온" })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("tab", { name: /현재 기록/ }));

    expect(within(dialog).getByRole("spinbutton", { name: "체온" })).toHaveValue(38.2);
    expect(within(dialog).getByRole("spinbutton", { name: "수축기 혈압" })).toHaveValue(150);
    expect(within(dialog).getByRole("textbox", { name: "진단 1" })).toHaveValue("acute pharyngitis");
    expect(within(dialog).getByRole("textbox", { name: "투약 1 약명" })).toHaveValue("이부프로펜 400mg");
    expect(within(dialog).getByRole("textbox", { name: "간호기록 1" })).toHaveValue("인후통 호소");
    expect(within(dialog).getByLabelText("기록 시간")).toHaveValue("2026-07-02T09:00");
    expect(dialog).not.toHaveTextContent('{"patient_id"');
  });

  it("submits a sanitized current record without exposing a JSON editor", async () => {
    const user = userEvent.setup();
    const onCompare = vi.fn().mockResolvedValue(undefined);

    render(
      <PatientRecordDrawer
        open
        pair={pair}
        patientName={pair.current.name}
        busy={false}
        errorMessage={null}
        onClose={vi.fn()}
        onCompare={onCompare}
        onReset={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: /홍길동/ });
    await user.click(within(dialog).getByRole("tab", { name: /현재 기록/ }));
    const temperature = within(dialog).getByRole("spinbutton", { name: "체온" });
    await user.clear(temperature);
    await user.type(temperature, "39.1");

    await user.click(within(dialog).getByRole("button", { name: "간호기록 추가" }));
    await user.type(within(dialog).getByRole("textbox", { name: "간호기록 3" }), "야간 관찰 필요");
    await user.click(within(dialog).getByRole("button", { name: "간호기록 추가" }));

    await user.click(within(dialog).getByRole("button", { name: "변경사항 비교" }));

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

  it("closes with Escape and restores focus to the origin control", async () => {
    const user = userEvent.setup();

    function DrawerHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>원본 기록 열기</button>
          <PatientRecordDrawer
            open={open}
            pair={pair}
            patientName={pair.current.name}
            busy={false}
            errorMessage={null}
            onClose={() => setOpen(false)}
            onCompare={vi.fn()}
            onReset={vi.fn()}
          />
        </>
      );
    }

    render(<DrawerHarness />);
    const origin = screen.getByRole("button", { name: "원본 기록 열기" });
    await user.click(origin);
    const dialog = screen.getByRole("dialog", { name: /홍길동/ });
    expect(dialog).toBeInTheDocument();
    const closeButton = within(dialog).getByRole("button", { name: "원본 기록 닫기" });
    await waitFor(() => expect(closeButton).toHaveFocus());

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /홍길동/ })).not.toBeInTheDocument());
    expect(origin).toHaveFocus();
  });

  it("resets an unsaved base-pair draft when the parent advances the reset request", async () => {
    const user = userEvent.setup();

    function DrawerHarness() {
      const [resetRequestId, setResetRequestId] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setResetRequestId((current) => current + 1)}>
            외부 초기화
          </button>
          <PatientRecordDrawer
            open
            pair={pair}
            patientName={pair.current.name}
            busy={false}
            errorMessage={null}
            resetRequestId={resetRequestId}
            onClose={vi.fn()}
            onCompare={vi.fn()}
            onReset={vi.fn()}
          />
        </>
      );
    }

    render(<DrawerHarness />);
    const dialog = screen.getByRole("dialog", { name: /홍길동/ });
    await user.click(within(dialog).getByRole("tab", { name: /현재 기록/ }));
    const temperature = within(dialog).getByRole("spinbutton", { name: "체온" });
    await user.clear(temperature);
    await user.type(temperature, "39.1");
    expect(temperature).toHaveValue(39.1);

    await user.click(screen.getByRole("button", { name: "외부 초기화" }));

    await waitFor(() => expect(within(dialog).getByRole("spinbutton", { name: "체온" })).toHaveValue(38.2));
  });

  it("keeps each editable row's DOM identity when deleting a non-tail diagnosis, medication, or note", async () => {
    const user = userEvent.setup();

    render(
      <PatientRecordDrawer
        open
        pair={pair}
        patientName={pair.current.name}
        busy={false}
        errorMessage={null}
        onClose={vi.fn()}
        onCompare={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: /홍길동/ });
    await user.click(within(dialog).getByRole("tab", { name: /현재 기록/ }));

    const secondDiagnosis = within(dialog).getByRole("textbox", { name: "진단 2" });
    await user.click(within(dialog).getByRole("button", { name: "진단 1 삭제" }));
    expect(within(dialog).getByRole("textbox", { name: "진단 1" })).toBe(secondDiagnosis);

    const secondMedication = within(dialog).getByRole("textbox", { name: "투약 2 약명" });
    await user.click(within(dialog).getByRole("button", { name: "투약 1 삭제" }));
    expect(within(dialog).getByRole("textbox", { name: "투약 1 약명" })).toBe(secondMedication);

    const secondNote = within(dialog).getByRole("textbox", { name: "간호기록 2" });
    await user.click(within(dialog).getByRole("button", { name: "간호기록 1 삭제" }));
    expect(within(dialog).getByRole("textbox", { name: "간호기록 1" })).toBe(secondNote);
  });

  it("preserves the source timezone suffix when editing the datetime-local wall time", async () => {
    const user = userEvent.setup();
    const onCompare = vi.fn();

    render(
      <PatientRecordDrawer
        open
        pair={pair}
        patientName={pair.current.name}
        busy={false}
        errorMessage={null}
        onClose={vi.fn()}
        onCompare={onCompare}
        onReset={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: /홍길동/ });
    await user.click(within(dialog).getByRole("tab", { name: /현재 기록/ }));
    const timestamp = within(dialog).getByLabelText("기록 시간");
    fireEvent.change(timestamp, { target: { value: "2026-07-02T09:15" } });
    expect(timestamp).toHaveValue("2026-07-02T09:15");

    await user.click(within(dialog).getByRole("button", { name: "변경사항 비교" }));

    await waitFor(() => expect(onCompare).toHaveBeenCalledTimes(1));
    const [submitted] = onCompare.mock.calls[0] as [typeof pair.current];
    expect(submitted.updated_at).toBe("2026-07-02T09:15:00+09:00");
  });
});
