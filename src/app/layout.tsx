import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "교대 인수인계 작업공간 | Nurse Handover Assistant",
  description: "가상 환자 기록의 이전·현재 변화를 근거와 함께 검토하는 작업공간",
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
