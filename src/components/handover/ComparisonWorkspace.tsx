import type { HandoverChange, HandoverComparison } from "@/lib/contracts";

import { ChangeCard } from "./ChangeCard";
import { formatTimestamp } from "./PatientContextHeader";

export type ComparisonWorkspaceProps = {
  comparison: HandoverComparison;
};

const PRIORITY_ORDER: HandoverChange["reviewPriority"][] = ["high", "medium", "low"];

function statusLabel(comparison: HandoverComparison) {
  if (comparison.status === "no_previous") return "비교 데이터 없음";
  if (comparison.status === "no_changes") return "변화 없음";
  if (comparison.status === "partial") return "데이터 부족";
  return "검토 필요";
}

export function orderChangesByPriority(changes: HandoverChange[]) {
  return PRIORITY_ORDER.flatMap((priority) =>
    changes.filter((change) => change.reviewPriority === priority),
  );
}

function priorityGroupTitle(priority: HandoverChange["reviewPriority"]) {
  return priority === "high" ? "중요 변화" : "일반 변화";
}

function priorityGroupHelper(priority: HandoverChange["reviewPriority"]) {
  return priority === "high" ? "먼저 확인할 항목" : "원본 근거와 함께 확인";
}

export function ComparisonWorkspace({ comparison }: ComparisonWorkspaceProps) {
  const orderedChanges = orderChangesByPriority(comparison.changes);
  const groupedChanges = PRIORITY_ORDER.map((priority) => ({
    priority,
    changes: orderedChanges.filter((change) => change.reviewPriority === priority),
  })).filter(({ changes }) => changes.length > 0);

  return (
    <section className="comparison-panel panel" aria-labelledby="comparison-title">
      <header className="section-header comparison-header">
        <div>
          <p className="eyebrow">EVIDENCE REVIEW / RECORD DELTA</p>
          <h2 id="comparison-title">변화 검토</h2>
        </div>
        <div className="comparison-status">
          <span className={`status-symbol status-${comparison.status}`} aria-hidden="true">
            {comparison.status === "ready" ? "!" : comparison.status === "no_changes" ? "✓" : "·"}
          </span>
          <span>{statusLabel(comparison)}</span>
          <strong className="mono">
            {comparison.status === "no_previous" ||
            (comparison.status === "partial" && comparison.changes.length === 0)
              ? "비교 불가"
              : `${comparison.changes.length.toString().padStart(2, "0")}건`}
          </strong>
        </div>
      </header>

      <div className="seam-legend" aria-label="Shift Seam 안내">
        <span className="legend-side">이전 기록</span>
        <span className="legend-seam"><i aria-hidden="true" /> SHIFT SEAM · 시간축</span>
        <span className="legend-side">현재 기록</span>
      </div>

      {comparison.dataWarnings.length > 0 ? (
        <div className="warning-banner" role="status">
          <strong>데이터 부족</strong>
          <span>확인할 수 없는 필드: {comparison.dataWarnings.join(", ")}</span>
        </div>
      ) : null}

      {comparison.status === "no_previous" ? (
        <div className="comparison-empty">
          <span className="empty-symbol empty-no-previous" aria-hidden="true">∅</span>
          <h3>비교 데이터 없음</h3>
          <p>
            <span>비교할 이전 기록이 없습니다.</span>{" "}
            <span>현재 기록 시각 <strong className="mono">{formatTimestamp(comparison.interval.currentRecordedAt)}</strong>을 확인하세요.</span>
          </p>
        </div>
      ) : comparison.status === "partial" && comparison.changes.length === 0 ? (
        <div className="comparison-empty">
          <span className="empty-symbol empty-partial" aria-hidden="true">!</span>
          <h3>데이터 부족으로 완전한 비교를 수행하지 못했습니다.</h3>
          <p>누락된 필드를 확인한 뒤 원본 기록을 다시 검토하세요.</p>
        </div>
      ) : comparison.status === "no_changes" ? (
        <div className="comparison-empty">
          <span className="empty-symbol empty-no-changes" aria-hidden="true">✓</span>
          <h3>두 기록 사이에서 검출된 변화가 없습니다.</h3>
          <p>비교 기준 시각과 원본 기록을 확인했습니다.</p>
        </div>
      ) : (
        <div className="change-groups">
          {groupedChanges.map(({ priority, changes }) => (
            <section
              className="change-group"
              aria-labelledby={`${priority}-changes-title`}
              key={priority}
            >
              <div className="group-heading">
                <span className={`group-rule ${priority === "high" ? "group-rule-watch" : "group-rule-muted"}`} />
                <h3 id={`${priority}-changes-title`}>{priorityGroupTitle(priority)}</h3>
                <span className="group-count mono">{changes.length}</span>
                <span className="group-helper">{priorityGroupHelper(priority)}</span>
              </div>
              <div className="change-list">
                {changes.map((change) => <ChangeCard change={change} key={change.id} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
