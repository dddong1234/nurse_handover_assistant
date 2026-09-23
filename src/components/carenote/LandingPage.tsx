"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";

import styles from "./LandingPage.module.css";

type PreviewTab = "readiness" | "evidence" | "charting";

type PreviewTabDefinition = {
  id: PreviewTab;
  label: string;
};

type ReadinessRow = {
  time: string;
  title: string;
  detail: string;
  source: string;
};

const previewTabs: PreviewTabDefinition[] = [
  { id: "readiness", label: "근무 준비" },
  { id: "evidence", label: "원본 근거" },
  { id: "charting", label: "간호기록" },
];

const readinessRows: ReadinessRow[] = [
  {
    time: "07:40",
    title: "회진 전 발열 경과 전달",
    detail: "10:30까지 전달 요청",
    source: "전달 요청 원본",
  },
  {
    time: "08:20",
    title: "CBC 결과 확인",
    detail: "WBC 12.1 ×10³/μL",
    source: "CBC 원본",
  },
  {
    time: "11:00",
    title: "Chest AP 일정 확인",
    detail: "검사 예정",
    source: "Chest AP 원본",
  },
];

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? styles.brandMarkCompact : styles.brandMark} aria-hidden="true">
      <svg viewBox="0 0 32 32" role="presentation">
        <path d="M8 5.5h10.5L24 11v15.5H8z" />
        <path d="M18.5 5.5V11H24" />
        <path d="M11.5 17.25h9M11.5 21h6" />
      </svg>
    </span>
  );
}

function ArrowIcon({ direction = "right" }: { direction?: "right" | "down" }) {
  return (
    <svg
      className={direction === "down" ? styles.arrowDown : styles.arrow}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      {direction === "down" ? <path d="M3 5.5 8 10l5-4.5" /> : <path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" />}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className={styles.checkIcon} viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3.2 8.3 3.1 3 6.5-6.6" />
    </svg>
  );
}

function PreviewContext() {
  return (
    <div className={styles.previewContext}>
      <div className={styles.patientIdentity}>
        <span className={styles.patientDot} aria-hidden="true" />
        <div>
          <strong>P001 · 홍길동</strong>
          <span>301호 · 합성 환자</span>
        </div>
      </div>
      <div className={styles.previewContextMeta}>
        <span>09:00 기록 기준</span>
        <span className={styles.reviewStatus}><i aria-hidden="true" /> 간호사 검토</span>
      </div>
    </div>
  );
}

function ReadinessPanel() {
  return (
    <div className={styles.panelContent}>
      <div className={styles.panelHeading}>
        <div>
          <span className={styles.panelLabel}>이번 근무 확인 항목</span>
          <h3>확인할 일부터 먼저 봅니다.</h3>
          <p className={styles.panelSubline}>비교 기준 · 직전 교대·휴무 기간 중 보유 기록 기준 선택</p>
        </div>
        <span className={styles.panelCount}>3건</span>
      </div>
      <div className={styles.readinessList} aria-label="이번 근무 확인 항목">
        {readinessRows.map((row) => (
          <div className={styles.readinessRow} key={row.time}>
            <time>{row.time}</time>
            <div className={styles.rowMain}>
              <strong>{row.title}</strong>
              <span>{row.detail}</span>
            </div>
            <div className={styles.rowSource}>
              <span>{row.source}</span>
              <small>원본 대조</small>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.panelNote}>
        <CheckIcon />
        <span>확인 항목은 원본 기록의 시간과 출처로 이어집니다.</span>
      </div>
    </div>
  );
}

function EvidencePanel() {
  return (
    <div className={styles.panelContent}>
      <div className={styles.panelHeading}>
        <div>
          <span className={styles.panelLabel}>원본 기록 대조</span>
          <h3>한 줄의 근거를 원본 가까이에서 봅니다.</h3>
        </div>
        <span className={styles.panelCount}>CBC</span>
      </div>
      <div className={styles.evidenceFocus}>
        <div className={styles.evidenceFocusHeader}>
          <span className={styles.evidenceSignal}>현재 기록</span>
          <span>08:20 기록</span>
        </div>
        <strong>WBC 12.1 ×10³/μL</strong>
        <span className={styles.evidencePath}>원본 · INV-P001-CBC</span>
      </div>
      <div className={styles.evidenceList} aria-label="연결된 원본 기록">
        <div className={styles.evidenceRow}>
          <span>07:40</span>
          <div><strong>회진 전 발열 경과 전달</strong><small>전달 요청 원본</small></div>
        </div>
        <div className={styles.evidenceRow}>
          <span>11:00 예정</span>
          <div><strong>Chest AP 일정 확인</strong><small>Chest AP 원본</small></div>
        </div>
      </div>
      <div className={styles.panelNote}>
        <CheckIcon />
        <span>원본을 확인한 뒤 간호사가 다음 기록을 결정합니다.</span>
      </div>
    </div>
  );
}

function ChartingPanel() {
  return (
    <div className={styles.panelContent}>
      <div className={styles.panelHeading}>
        <div>
          <span className={styles.panelLabel}>간호기록 초안</span>
          <h3>입력한 사실을 문장으로 정리합니다.</h3>
        </div>
        <span className={styles.panelCount}>SOAP</span>
      </div>
      <div className={styles.chartingSource}>
        <span>입력한 사실</span>
        <strong>통증 3점</strong>
        <small>원본 입력</small>
      </div>
      <div className={styles.soapList} aria-label="통증 3점 입력의 기록 문장화">
        <div className={styles.soapRow}><span>S:</span><strong>통증 정도 3점.</strong></div>
      </div>
      <div className={styles.chartingFooter}>
        <span>검토 후 필요한 내용만 기록 추가합니다.</span>
        <a href="/workspace?module=charting">차팅 화면 열기 <ArrowIcon /></a>
      </div>
    </div>
  );
}

function PreviewPanel({ activeTab }: { activeTab: PreviewTab }) {
  if (activeTab === "evidence") return <EvidencePanel />;
  if (activeTab === "charting") return <ChartingPanel />;
  return <ReadinessPanel />;
}

function ProductPreview() {
  const [activeTab, setActiveTab] = useState<PreviewTab>("readiness");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = previewTabs.findIndex((tab) => tab.id === activeTab);

  const focusTab = (index: number) => {
    const nextIndex = (index + previewTabs.length) % previewTabs.length;
    setActiveTab(previewTabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusTab(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusTab(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusTab(previewTabs.length - 1);
    }
  };

  const activeTabLabel = previewTabs[activeIndex].label;

  return (
      <div className={styles.previewStage} id="product">
      <div className={styles.previewStageLabel}>
        <span className={styles.stageRule} aria-hidden="true" />
        <span>제품 미리보기</span>
      </div>
      <div className={styles.previewShell}>
        <div className={styles.previewTopbar}>
          <div className={styles.previewBrand}><BrandMark compact /><strong>CareNote</strong></div>
          <span className={styles.previewTopbarTitle}>간호 업무공간</span>
          <span className={styles.previewTopbarTime}>09:00</span>
        </div>
        <PreviewContext />
        <div className={styles.previewTabs} role="tablist" aria-label="제품 미리보기">
          {previewTabs.map((tab, index) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                aria-controls="preview-panel"
                aria-selected={isActive}
                className={isActive ? styles.previewTabActive : styles.previewTab}
                id={`preview-tab-${tab.id}`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                ref={(element) => { tabRefs.current[index] = element; }}
                role="tab"
                tabIndex={isActive ? 0 : -1}
                type="button"
              >
                <span>{tab.label}</span>
                {isActive && <span className={styles.tabIndicator} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        <div
          aria-labelledby={`preview-tab-${activeTab}`}
          className={styles.previewPanel}
          id="preview-panel"
          role="tabpanel"
          aria-live="polite"
        >
          <PreviewPanel activeTab={activeTab} />
        </div>
        <div className={styles.previewBottomline}>
          <span><i aria-hidden="true" /> {activeTabLabel} · 간호사 검토 전</span>
          <span>합성 환자 P001</span>
        </div>
      </div>
    </div>
  );
}

function BenefitStrip() {
  return (
    <section className={styles.benefitStrip} aria-label="CareNote가 연결하는 업무">
      <div className={styles.container}>
        <div className={styles.benefitItem}>
          <span className={styles.benefitIcon}><CheckIcon /></span>
          <div><strong>근무 준비</strong><span>확인할 항목을 먼저 봅니다.</span></div>
        </div>
        <div className={styles.benefitItem}>
          <span className={styles.benefitIcon}><CheckIcon /></span>
          <div><strong>원본 대조</strong><span>시간과 출처를 가까이 확인합니다.</span></div>
        </div>
        <div className={styles.benefitItem}>
          <span className={styles.benefitIcon}><CheckIcon /></span>
          <div><strong>간호기록</strong><span>입력한 사실에서 직접 이어갑니다.</span></div>
        </div>
      </div>
    </section>
  );
}

function HandoverDiagram() {
  return (
    <div className={styles.editorialDiagram} aria-label="이번 근무 확인 항목과 원본 기록 예시">
      <div className={styles.diagramTopline}><span>이번 근무</span><strong>3건</strong></div>
      <div className={styles.diagramTimeline}>
        {readinessRows.map((row) => (
          <div className={styles.diagramTimelineRow} key={row.time}>
            <time>{row.time}</time>
            <span className={styles.timelineDot} aria-hidden="true" />
            <div><strong>{row.title}</strong><span>{row.detail}</span></div>
          </div>
        ))}
      </div>
      <div className={styles.diagramCaption}><span>원본 기록으로 연결</span><ArrowIcon /></div>
    </div>
  );
}

function ChartingDiagram() {
  return (
    <div className={`${styles.editorialDiagram} ${styles.chartingDiagram}`} aria-label="통증 3점 입력을 S 문장으로 정리한 예시">
      <div className={styles.diagramTopline}><span>간호기록 초안</span><strong>검토 후 기록 추가</strong></div>
      <div className={styles.soapDiagram}>
        <div><span>S:</span><strong>통증 정도 3점.</strong><small>입력 → 문장화</small></div>
      </div>
      <div className={styles.diagramCaption}><span>검토 후 필요한 내용만 기록 추가</span><CheckIcon /></div>
    </div>
  );
}

function WorkflowSteps() {
  return (
    <section className={styles.workflowSteps} id="workflow" aria-labelledby="workflow-heading">
      <div className={styles.container}>
        <div className={styles.sectionHeadingCompact}>
          <span className={styles.sectionRule} aria-hidden="true" />
          <h2 id="workflow-heading">확인하고, 대조하고, 기록합니다.</h2>
          <p>같은 환자 맥락을 따라 다음 업무로 자연스럽게 이어집니다.</p>
        </div>
        <div className={styles.stepList}>
          <div className={styles.stepItem}><strong>확인</strong><span>이번 근무 항목을 먼저 봅니다.</span></div>
          <ArrowIcon />
          <div className={styles.stepItem}><strong>대조</strong><span>원본 기록의 시간과 출처를 확인합니다.</span></div>
          <ArrowIcon />
          <div className={styles.stepItem}><strong>기록</strong><span>확인한 사실을 직접 완성합니다.</span></div>
        </div>
      </div>
    </section>
  );
}

export function LandingPage() {
  return (
    <div className={styles.landing}>
      <a className={styles.skipLink} href="#main-content">본문으로 바로가기</a>
      <header className={styles.siteHeader}>
        <div className={styles.container}>
          <Link className={styles.brandLockup} href="/" aria-label="CareNote 홈">
            <BrandMark />
            <span className={styles.brandName}>CareNote</span>
          </Link>
          <nav className={styles.primaryNav} aria-label="주요 메뉴">
            <a href="#product">제품</a>
            <a href="#workflow">업무 흐름</a>
            <a href="#faq">자주 묻는 질문</a>
          </nav>
          <a className={styles.headerCta} href="/workspace">데모 체험하기 <ArrowIcon /></a>
        </div>
      </header>

      <main id="main-content">
        <section className={styles.hero} aria-labelledby="hero-heading">
          <div className={styles.container}>
            <div className={styles.heroCopy}>
              <h1 id="hero-heading">인수인계와 간호기록,<br /><span>이제 한 곳에서.</span></h1>
              <p className={styles.heroLead}>
                근무 중 확인할 변화부터 원본 기록, 간호기록 작성까지.<br className={styles.desktopBreak} />
                {" "}같은 환자 맥락으로 이어집니다.
              </p>
              <div className={styles.heroActions}>
                <a className={styles.primaryButton} href="/workspace">데모 체험하기 <ArrowIcon /></a>
                <a className={styles.secondaryButton} href="#product">제품 둘러보기 <ArrowIcon direction="down" /></a>
              </div>
            </div>
            <ProductPreview />
          </div>
        </section>

        <BenefitStrip />

        <section className={styles.editorialSection} aria-labelledby="handover-heading">
          <div className={`${styles.container} ${styles.editorialGrid}`}>
            <div className={styles.editorialCopy}>
              <span className={styles.sectionRule} aria-hidden="true" />
              <h2 id="handover-heading">확인할 일부터,<br /><span>원본으로.</span></h2>
              <p>이번 근무의 요청과 검사 상태를 먼저 확인하고, 기록 시각과 출처를 원본에서 다시 대조합니다.</p>
              <a className={styles.textLink} href="/workspace">근무 준비 화면 열기 <ArrowIcon /></a>
            </div>
            <HandoverDiagram />
          </div>
        </section>

        <section className={`${styles.editorialSection} ${styles.editorialSectionTint}`} aria-labelledby="charting-heading">
          <div className={`${styles.container} ${styles.editorialGrid} ${styles.editorialGridReverse}`}>
            <div className={styles.editorialCopy}>
              <span className={styles.sectionRule} aria-hidden="true" />
              <h2 id="charting-heading">입력한 사실로,<br /><span>기록을 시작합니다.</span></h2>
              <p>입력한 통증 3점은 S 문장으로 정리되고, 사용자가 확인한 내용만 필요에 따라 직접 추가합니다.</p>
              <a className={styles.textLink} href="/workspace?module=charting">간호기록 화면 열기 <ArrowIcon /></a>
            </div>
            <ChartingDiagram />
          </div>
        </section>

        <WorkflowSteps />

        <section className={styles.faqSection} id="faq" aria-labelledby="faq-heading">
          <div className={`${styles.container} ${styles.faqGrid}`}>
            <div className={styles.faqIntro}>
              <span className={styles.sectionRule} aria-hidden="true" />
              <h2 id="faq-heading">CareNote에 대해<br /><span>자주 묻는 질문.</span></h2>
            </div>
            <div className={styles.faqList}>
              <details open>
                <summary><span>CareNote는 실제 병원에서 사용할 수 있나요?</span><span className={styles.summaryIcon} aria-hidden="true" /></summary>
                <p>현재 CareNote는 합성 환자 데이터로 기능을 살펴보는 공개 제품 데모입니다. 실제 병원 시스템이나 운영 EMR에 연결되지 않으며, 실제 환자정보를 다루지 않습니다.</p>
              </details>
              <details>
                <summary><span>요약이나 차팅을 AI가 자동으로 결정하나요?</span><span className={styles.summaryIcon} aria-hidden="true" /></summary>
                <p>아니요. 현재 데모의 확인 항목과 차팅 초안은 결정론적 규칙으로 동작합니다. 선택형 AI 연결은 활성화되어 있지 않으며, 원본 입력과 문장화를 확인한 뒤 필요한 내용을 직접 작성해 명시적으로 추가할 수 있습니다.</p>
              </details>
              <details>
                <summary><span>인수인계와 차팅은 어떻게 연결되나요?</span><span className={styles.summaryIcon} aria-hidden="true" /></summary>
                <p>두 기능은 같은 환자 맥락을 공유합니다. 인수인계에서 확인한 항목과 원본 근거를 바탕으로 차팅 화면에서 SOAP 초안을 정리할 수 있습니다.</p>
              </details>
              <details>
                <summary><span>저장되는 환자 데이터가 있나요?</span><span className={styles.summaryIcon} aria-hidden="true" /></summary>
                <p>작성 상태는 브라우저 메모리에만 유지됩니다. 근무 준비 계산은 서버 API에서 처리하며 영구 저장하지 않습니다. 페이지를 새로고침하면 상태가 초기화되며, 공식 저장이나 병원 기록 반영은 지원하지 않습니다. 실제 환자정보와 운영 계정도 사용하지 않습니다.</p>
              </details>
            </div>
          </div>
        </section>

        <section className={styles.finalCta} aria-labelledby="final-heading">
          <div className={`${styles.container} ${styles.finalCtaInner}`}>
            <div>
              <span className={styles.sectionRule} aria-hidden="true" />
              <h2 id="final-heading">다음 근무를 위한 기록의 흐름,<br /><span>직접 확인해보세요.</span></h2>
            </div>
            <a className={styles.primaryButton} href="/workspace">데모 체험하기 <ArrowIcon /></a>
          </div>
        </section>
      </main>

      <footer className={styles.siteFooter}>
        <div className={`${styles.container} ${styles.footerInner}`}>
          <div className={styles.footerBrand}><BrandMark compact /><span>CareNote</span></div>
          <p>합성 환자 데이터로 제공되는 제품 데모입니다.</p>
          <div className={styles.footerLinks}><a href="/handover">기존 인수인계 비교 화면</a><span>© 2026 CareNote</span></div>
        </div>
      </footer>
    </div>
  );
}
