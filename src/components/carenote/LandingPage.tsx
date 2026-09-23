"use client";

import { useState } from "react";
import Link from "next/link";

import styles from "./LandingPage.module.css";

type DemoTab = "handover" | "charting";

type DemoContent = {
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
  href: string;
  context: string;
  trace: Array<{
    time: string;
    source: string;
    detail: string;
    status: string;
  }>;
  soap: Array<{
    key: string;
    value: string;
  }>;
};

const demoContent: Record<DemoTab, DemoContent> = {
  handover: {
    label: "인수인계",
    eyebrow: "SHIFT READINESS",
    title: "이번 근무 확인 항목을 먼저 봅니다.",
    description:
      "이번 근무의 요청과 검사 상태를 먼저 모아 보여주고, 각 항목을 원본 기록과 대조합니다.",
    cta: "인수인계 화면 열기",
    href: "/workspace",
    context: "합성 환자 P001 · 홍길동 · 301호 · 09:00 기록 기준",
    trace: [
      { time: "07:40", source: "인수인계 요청", detail: "회진 전 발열 경과 전달", status: "요청" },
      { time: "08:20", source: "CBC 결과", detail: "WBC 12.1 ×10³/μL", status: "결과" },
      { time: "11:00", source: "Chest AP", detail: "검사 일정 예정", status: "일정" },
    ],
    soap: [
      { key: "S", value: "인후통 호소 · 미열 지속" },
      { key: "O", value: "체온 38.2°C · 혈압 150/95 mmHg" },
      { key: "A", value: "원본 기록과 함께 확인" },
      { key: "P", value: "회진 전 발열 경과 전달" },
    ],
  },
  charting: {
    label: "차팅",
    eyebrow: "CHARTING",
    title: "입력한 사실을 SOAP으로 이어갑니다.",
    description:
      "통증 3점 입력은 S에만 표시됩니다. O/A/P는 간호사가 직접 확인·작성한 뒤 명시적으로 추가합니다.",
    cta: "차팅 화면 열기",
    href: "/workspace?module=charting",
    context: "합성 환자 P001 · 홍길동 · 301호 · 09:01 기록 초안",
    trace: [
      { time: "09:01", source: "간호사 입력", detail: "통증 3점", status: "입력" },
      { time: "09:01", source: "규칙 기반 결과", detail: "S: 통증 3점", status: "표시" },
      { time: "09:01", source: "간호사 작성", detail: "O/A/P 직접 확인·작성 필요", status: "대기" },
    ],
    soap: [
      { key: "S", value: "통증 3점" },
      { key: "O", value: "[직접 확인·작성 필요]" },
      { key: "A", value: "[직접 확인·작성 필요]" },
      { key: "P", value: "[직접 확인·작성 필요]" },
    ],
  },
};

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

function HandoverPreview() {
  return (
    <div className={`${styles.featureVisual} ${styles.featureVisualHandover}`} aria-label="인수인계 예시 화면">
      <div className={styles.visualTopline}>
        <span className={styles.visualWindowTitle}>인수인계 준비</span>
        <span className={styles.exampleLabel}>예시 화면</span>
      </div>
      <div className={styles.visualPatientLine}>
        <span className={styles.visualPatientDot} />
        <strong>홍길동 · P001</strong>
        <span>301호 · 합성 환자</span>
        <span className={styles.visualTime}>09:00</span>
      </div>
      <div className={styles.visualSectionLabel}>
        <span>이번 근무 확인 항목</span>
        <span className={styles.seamLabel}>원본 대조</span>
        <span>기록 근거</span>
      </div>
      <div className={styles.miniChangeList}>
        <div className={styles.miniChangeRow}>
          <span className={styles.changeBar} />
          <div>
            <strong>회진 전 발열 경과</strong>
            <span>요청 07:40 · 10:30까지</span>
          </div>
          <span className={styles.changeArrow}>↗</span>
          <div className={styles.currentValue}>
            <strong>전달 요청</strong>
            <span>원본 확인</span>
          </div>
          <span className={styles.sourceChip}>REQ-P001-ROUND-1</span>
        </div>
        <div className={styles.miniChangeRow}>
          <span className={`${styles.changeBar} ${styles.changeBarWatch}`} />
          <div>
            <strong>CBC 결과</strong>
            <span>08:20 결과</span>
          </div>
          <span className={styles.changeArrow}>↗</span>
          <div className={styles.currentValue}>
            <strong>WBC 12.1</strong>
            <span>검사 결과</span>
          </div>
          <span className={styles.sourceChip}>INV-P001-CBC</span>
        </div>
      </div>
      <div className={styles.visualFooter}>
        <span><i className={styles.footerDot} /> 원본 기록 대조</span>
        <span>확인 항목 3</span>
      </div>
    </div>
  );
}

function ChartingPreview() {
  return (
    <div className={`${styles.featureVisual} ${styles.featureVisualCharting}`} aria-label="차팅 예시 화면">
      <div className={styles.visualTopline}>
        <span className={styles.visualWindowTitle}>간호기록 · SOAP</span>
        <span className={styles.exampleLabel}>예시 화면</span>
      </div>
      <div className={styles.visualPatientLine}>
        <span className={styles.visualPatientDot} />
        <strong>홍길동 · P001</strong>
        <span>통증 관찰</span>
        <span className={styles.visualTime}>09:01</span>
      </div>
      <div className={styles.soapMiniList}>
        <div className={styles.soapMiniRow}>
          <span className={styles.soapKey}>S</span>
          <span>통증 3점</span>
          <span className={styles.soapTrace}>입력</span>
        </div>
        <div className={styles.soapMiniRowMuted}>
          <span className={styles.soapKey}>O</span>
          <span>[직접 확인·작성 필요]</span>
          <span className={styles.soapTrace}>직접 작성</span>
        </div>
        <div className={styles.soapMiniRowMuted}>
          <span className={styles.soapKey}>A</span>
          <span>[직접 확인·작성 필요]</span>
          <span className={styles.soapTrace}>직접 작성</span>
        </div>
        <div className={styles.soapMiniRowMuted}>
          <span className={styles.soapKey}>P</span>
          <span>[직접 확인·작성 필요]</span>
          <span className={styles.soapTrace}>직접 작성</span>
        </div>
      </div>
      <div className={styles.chartingReviewBar}>
        <span><i className={styles.reviewCheck} /> 규칙 기반 결과 · S만 표시 · O/A/P 직접 작성 후 추가</span>
        <span className={styles.reviewAction}>빈 항목 추가 불가</span>
      </div>
    </div>
  );
}

function ProductMockup() {
  return (
    <div className={styles.productStage}>
      <div className={styles.productStageNote}>
        <span className={styles.noteRule} />
        <span>예시 화면 · 실제 환자정보 아님</span>
      </div>
      <div className={styles.productWindow}>
        <div className={styles.windowTopbar}>
          <div className={styles.windowBrand}>
            <BrandMark compact />
            <span>CareNote</span>
          </div>
          <span className={styles.windowMode}>SHIFT READINESS</span>
          <span className={styles.windowTime}>09:00 KST</span>
        </div>
        <div className={styles.windowLayout}>
          <aside className={styles.windowRail} aria-label="예시 화면 탐색">
            <span className={`${styles.railIcon} ${styles.railIconActive}`} aria-hidden="true">⌁</span>
            <span className={styles.railIcon} aria-hidden="true">⌑</span>
            <span className={styles.railIcon} aria-hidden="true">＋</span>
            <span className={styles.railIcon} aria-hidden="true">⋮</span>
          </aside>
          <div className={styles.windowContent}>
            <div className={styles.windowContextHeader}>
              <div>
                <span className={styles.windowKicker}>PATIENT CONTEXT / SYNTHETIC</span>
                <h2>P001 · 홍길동 <span>301호 · 합성 환자</span></h2>
              </div>
              <span className={styles.contextStatus}><i /> 검토 중</span>
            </div>
            <div className={styles.windowTabs}>
              <span className={styles.windowTabActive}>인수인계</span>
              <span>기록 타임라인</span>
              <span>차팅</span>
            </div>
            <div className={styles.windowColumns}>
              <div className={styles.windowMainColumn}>
                <div className={styles.windowSectionHeader}>
                  <span>이번 근무 확인 항목</span>
                  <span className={styles.windowSectionCount}>03</span>
                </div>
                <div className={styles.windowDeltaRow}>
                  <div className={styles.deltaMeta}><span>회진 전 발열 경과</span><small>REQ-P001-ROUND-1</small></div>
                  <span className={styles.deltaFrom}>07:40 요청</span>
                  <span className={styles.deltaSeam}>↗</span>
                  <span className={styles.deltaTo}>10:30까지</span>
                </div>
                <div className={styles.windowDeltaRow}>
                  <div className={styles.deltaMeta}><span>CBC</span><small>INV-P001-CBC</small></div>
                  <span className={styles.deltaFrom}>검사 요청</span>
                  <span className={styles.deltaSeam}>↗</span>
                  <span className={styles.deltaTo}>WBC 12.1</span>
                </div>
                <div className={styles.windowDeltaRowMuted}>
                  <div className={styles.deltaMeta}><span>Chest AP</span><small>INV-P001-CXR</small></div>
                  <span className={styles.deltaFrom}>—</span>
                  <span className={styles.deltaSeam}>↗</span>
                  <span className={styles.deltaTo}>11:00 예정</span>
                </div>
              </div>
              <div className={styles.windowSideColumn}>
                <span className={styles.sideColumnLabel}>원본 기록 대조</span>
                <div className={styles.taskItem}><span className={styles.taskMarker}>01</span><span>회진 요청 확인</span></div>
                <div className={styles.taskItem}><span className={styles.taskMarker}>02</span><span>CBC 결과 확인</span></div>
                <div className={styles.taskItemMuted}><span className={styles.taskMarkerMuted}>03</span><span>Chest AP 일정 확인</span></div>
              </div>
            </div>
            <div className={styles.windowBottomRow}>
              <span><i className={styles.bottomDot} /> 모든 확인 항목은 원본 기록으로 돌아갈 수 있습니다.</span>
              <span>간호사 직접 검토</span>
            </div>
          </div>
        </div>
      </div>
      <div className={styles.productStageCallout}>
        <span className={styles.calloutLine} />
        <span>환자 맥락을 유지한 채<br />기록의 흐름을 읽습니다.</span>
      </div>
    </div>
  );
}

function DemoStory({ activeTab }: { activeTab: DemoTab }) {
  const content = demoContent[activeTab];

  return (
    <div className={styles.demoPanel}>
      <div className={styles.demoPanelHeader}>
        <div>
          <span className={styles.demoEyebrow}>{content.eyebrow}</span>
          <h3>{content.title}</h3>
          <p>{content.description}</p>
        </div>
        <span className={styles.demoStatus}><i /> 검토 가능한 예시</span>
      </div>
      <div className={styles.demoContextBar}>
        <span className={styles.demoContextDot} />
        <span>{content.context}</span>
        <span className={styles.demoContextTag}>합성 데이터</span>
      </div>
      <div className={styles.demoBody}>
        <div className={styles.traceColumn}>
          <div className={styles.demoSubhead}>
            <span>기록 근거</span>
            <span className={styles.demoSubheadNote}>SOURCE TRACE</span>
          </div>
          <div className={styles.traceList}>
            {content.trace.map((row, index) => (
              <div className={styles.traceRow} key={`${activeTab}-${row.time}-${row.source}-${index}`}>
                <time>{row.time}</time>
                <div className={styles.traceDetail}>
                  <strong>{row.detail}</strong>
                  <span>{row.source}</span>
                </div>
                <span className={styles.traceStatus}>{row.status}</span>
              </div>
            ))}
          </div>
          <p className={styles.traceHelper}>정적 예시입니다. 실제 원본 대조는 작업공간에서 진행합니다.</p>
        </div>
        <div className={styles.soapColumn}>
          <div className={styles.demoSubhead}>
            <span>{activeTab === "handover" ? "간호사가 이어받을 맥락" : "SOAP 기록 초안"}</span>
            <span className={styles.demoSubheadNote}>NURSE REVIEW</span>
          </div>
          <div className={styles.soapList}>
            {content.soap.map((item) => (
              <div className={styles.soapRow} key={`${activeTab}-${item.key}`}>
                <span className={styles.soapRowKey}>{item.key}</span>
                <span>{item.value}</span>
              </div>
            ))}
          </div>
          <div className={styles.reviewNote}><i className={styles.reviewCheck} /> 규칙 기반 결과 · S만 표시 · O/A/P 직접 작성 · 빈 항목 추가 불가</div>
        </div>
      </div>
      <div className={styles.demoPanelFooter}>
        <span>예시 화면은 기능 이해를 위한 합성 데이터입니다.</span>
        <a href={content.href}>{content.cta}<ArrowIcon /></a>
      </div>
    </div>
  );
}

export function LandingPage() {
  const [activeTab, setActiveTab] = useState<DemoTab>("handover");

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
          <a className={styles.headerCta} href="/workspace">
            체험하기 <ArrowIcon />
          </a>
        </div>
      </header>

      <main id="main-content">
        <section className={styles.hero} id="product" aria-labelledby="hero-heading">
          <div className={`${styles.container} ${styles.heroGrid}`}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}><span className={styles.eyebrowMark} /> 간호업무를 위한 기록의 연결</p>
              <h1 id="hero-heading">기록을 잇고,<br /><span>간호에 집중하다.</span></h1>
              <p className={styles.heroLead}>
                CareNote는 인수인계 준비와 간호기록을<br className={styles.desktopBreak} />
                같은 환자 맥락 안에서 이어주는 작업공간입니다.
              </p>
              <div className={styles.heroActions}>
                <a className={styles.primaryButton} href="/workspace">
                  작업공간 열기 <ArrowIcon />
                </a>
                <a className={styles.secondaryButton} href="#workflow">
                  업무 흐름 보기 <ArrowIcon direction="down" />
                </a>
              </div>
              <p className={styles.heroScope}><span className={styles.scopeDot} /> 합성 환자 데이터로 동작하는 공개 제품 데모</p>
            </div>
            <div className={styles.heroVisual}>
              <ProductMockup />
            </div>
          </div>
          <div className={`${styles.container} ${styles.heroRule}`} aria-hidden="true">
            <span>CARENOTE / RECORD THREAD</span>
            <span>SCROLL TO EXPLORE</span>
          </div>
        </section>

        <section className={styles.statementSection} aria-label="제품 원칙">
          <div className={`${styles.container} ${styles.statementGrid}`}>
            <p className={styles.statementKicker}>기록의 경계를 선명하게</p>
            <p className={styles.statementCopy}>
              필요한 맥락은 한 화면에 모으고,<br />
              <span>판단의 자리는 간호사에게 남깁니다.</span>
            </p>
            <p className={styles.statementAside}>01 / CONTEXT FIRST</p>
          </div>
        </section>

        <section className={styles.workflowSection} id="workflow" aria-labelledby="workflow-heading">
          <div className={styles.container}>
            <div className={styles.sectionIntro}>
              <p className={styles.eyebrow}><span className={styles.eyebrowMark} /> 하나의 환자, 이어지는 두 장면</p>
              <h2 id="workflow-heading">준비에서 기록까지,<br /><span>맥락이 끊기지 않도록.</span></h2>
              <p>인수인계에서 확인한 항목이 차팅의 출발점이 됩니다. 서로 다른 화면을 오갈 필요 없이, 한 환자의 흐름을 따라갑니다.</p>
            </div>
            <div className={styles.featureGrid}>
              <article className={styles.featureCard}>
                <div className={styles.featureCardTop}>
                  <span className={styles.featureNumber}>01</span>
                  <span className={styles.featureTag}>SHIFT READINESS</span>
                </div>
                <HandoverPreview />
                <div className={styles.featureCopy}>
                  <h3>이번 근무 확인 항목부터<br />원본으로 대조</h3>
                  <p>이번 근무의 요청과 검사 상태를 먼저 보고, 각 항목을 원본 기록으로 다시 대조합니다.</p>
                  <a href="/workspace">인수인계 살펴보기 <ArrowIcon /></a>
                </div>
              </article>
              <article className={`${styles.featureCard} ${styles.featureCardCharting}`}>
                <div className={styles.featureCardTop}>
                  <span className={styles.featureNumber}>02</span>
                  <span className={styles.featureTag}>CHARTING</span>
                </div>
                <ChartingPreview />
                <div className={styles.featureCopy}>
                  <h3>관찰 사실을<br />직접 완성하는 차팅</h3>
                  <p>입력된 사실은 규칙 결과로 구분하고, SOAP의 나머지 항목은 간호사가 직접 확인·작성한 뒤 명시적으로 추가합니다.</p>
                  <a href="/workspace?module=charting">차팅 살펴보기 <ArrowIcon /></a>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.demoSection} aria-labelledby="demo-heading">
          <div className={styles.container}>
            <div className={styles.demoIntro}>
              <div>
                <p className={styles.eyebrow}><span className={styles.eyebrowMark} /> 짧은 업무 이야기</p>
                <h2 id="demo-heading">화면을 눌러,<br /><span>기록이 이어지는 방식을 보세요.</span></h2>
              </div>
              <p>CareNote의 핵심은 자동 판단이 아니라, 근거를 따라가며 사람이 검토할 수 있는 흐름입니다.</p>
            </div>
            <div className={styles.demoShell}>
              <div className={styles.demoRail} role="tablist" aria-label="업무 장면 선택">
                {(Object.keys(demoContent) as DemoTab[]).map((tab) => {
                  const isActive = tab === activeTab;
                  return (
                    <button
                      className={isActive ? styles.demoTabActive : styles.demoTab}
                      key={tab}
                      id={`demo-tab-${tab}`}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls="demo-panel"
                      onClick={() => setActiveTab(tab)}
                    >
                      <span className={styles.demoTabIndex}>{tab === "handover" ? "01" : "02"}</span>
                      <span>{demoContent[tab].label}</span>
                      <ArrowIcon />
                    </button>
                  );
                })}
                <div className={styles.demoRailNote}>
                  <span className={styles.noteRule} />
                  <p>같은 환자 맥락<br />안에서 이어집니다.</p>
                </div>
              </div>
              <div id="demo-panel" role="tabpanel" aria-labelledby={`demo-tab-${activeTab}`} aria-live="polite">
                <DemoStory activeTab={activeTab} />
              </div>
            </div>
          </div>
        </section>

        <section className={styles.traceSection} aria-labelledby="trace-heading">
          <div className={`${styles.container} ${styles.traceGrid}`}>
            <div className={styles.traceCopy}>
              <p className={styles.eyebrow}><span className={styles.eyebrowMark} /> 근거를 남기는 설계</p>
              <h2 id="trace-heading">확인 항목은 짧게,<br /><span>출처는 가까이.</span></h2>
              <p>화면에 보이는 한 줄의 확인 항목은 원본 기록과 연결되어 있습니다. 요청과 검사 상태를 먼저 보고, 언제 어디에서 기록되었는지 다시 대조합니다.</p>
              <div className={styles.tracePrinciples}>
                <div><span>01</span><strong>확인 항목에서 원본으로</strong><p>요청과 검사 상태에서 해당 기록의 시간과 출처를 확인합니다.</p></div>
                <div><span>02</span><strong>간호사 검토를 중심에</strong><p>제안은 초안으로 남고, 최종 판단과 저장은 사용자가 합니다.</p></div>
              </div>
            </div>
            <div className={styles.traceDiagram} aria-label="기록 근거 연결 예시">
              <div className={styles.diagramHeader}><span>TRACE / P001</span><span>정적 예시</span></div>
              <div className={styles.diagramPath}>
                <div className={styles.diagramSource}><span className={styles.diagramNode}>01</span><div><strong>07:40 · 인수인계 요청</strong><span>회진 전 발열 경과 전달</span></div></div>
                <div className={styles.diagramConnector}><i /><span>원본 대조</span><i /></div>
                <div className={styles.diagramSummary}><span className={styles.diagramNodeActive}>→</span><div><strong>이번 근무 확인</strong><span>요청·검사 상태를 확인</span></div></div>
                <div className={styles.diagramConnector}><i /><span>직접 검토</span><i /></div>
                <div className={styles.diagramSource}><span className={styles.diagramNode}>02</span><div><strong>09:01 · 차팅 초안</strong><span>통증 3점 SOAP 정리</span></div></div>
              </div>
              <div className={styles.diagramFooter}><span><i className={styles.footerDot} /> 연결된 사실만 표시</span><span>판단은 사용자에게</span></div>
            </div>
          </div>
        </section>

        <section className={styles.faqSection} id="faq" aria-labelledby="faq-heading">
          <div className={`${styles.container} ${styles.faqGrid}`}>
            <div className={styles.faqIntro}>
              <p className={styles.eyebrow}><span className={styles.eyebrowMark} /> 먼저 알려드립니다</p>
              <h2 id="faq-heading"><span className={styles.faqTitleLine}>CareNote에 대해</span><br /><span>자주 묻는 질문.</span></h2>
            </div>
            <div className={styles.faqList}>
              <details open>
                <summary><span>CareNote는 실제 병원에서 사용할 수 있나요?</span><span className={styles.summaryIcon} aria-hidden="true" /></summary>
                <p>현재 CareNote는 합성 환자 데이터로 기능을 살펴보는 공개 제품 데모입니다. 실제 병원 시스템이나 운영 EMR에 연결되지 않으며, 실제 환자정보를 다루지 않습니다.</p>
              </details>
              <details>
                <summary><span>요약이나 차팅을 AI가 자동으로 결정하나요?</span><span className={styles.summaryIcon} aria-hidden="true" /></summary>
                <p>아니요. 현재 데모의 확인 항목과 차팅 초안은 결정론적 규칙으로 동작합니다. 선택형 AI 연결은 활성화되어 있지 않으며, 차팅 초안은 간호사가 직접 검토한 뒤에만 저장할 수 있습니다.</p>
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
              <p className={styles.eyebrow}><span className={styles.eyebrowMark} /> 다음 교대를 준비하는 시간</p>
              <h2 id="final-heading">기록의 흐름을<br /><span>직접 확인해보세요.</span></h2>
            </div>
            <div className={styles.finalCtaAction}>
              <p>합성 환자 데이터로 구성된 공개 데모에서<br />CareNote의 업무 흐름을 살펴볼 수 있습니다.</p>
              <a className={styles.primaryButton} href="/workspace">작업공간 열기 <ArrowIcon /></a>
            </div>
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
