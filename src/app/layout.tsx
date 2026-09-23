import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "CareNote | 근무 준비부터 간호기록까지",
  description: "환자의 변화 확인, 원본 기록 대조, 간호기록 작성을 하나의 흐름으로 연결하는 CareNote 제품 데모",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
