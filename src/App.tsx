import { useEffect } from "react";
import LiveDemo from "./components/LiveDemo";
import AdminDashboard from "./components/admin/AdminDashboard";

// 화면 역할은 URL 파라미터로 나눈다 (라우터 없이) — 시연 구도 4화면:
//   /                시연화면: 폰 + 직원 데스크톱 합본 (라이브 시연용)
//   /?role=admin     관리자 콘솔 (백엔드 프로세스 대시보드) — 별도 탭/모니터
//   /?role=customer  고객 핸드폰 단독
//   /?role=employee  직원 데스크톱 단독
// customer/employee는 탭별 독립 인스턴스 — 탭 간 통화 동기화는 후속(demoBus 확장).
const role = new URLSearchParams(window.location.search).get("role");

const TITLES: Record<string, string> = {
  admin: "KARI-NA 관리자 콘솔",
  customer: "K7 고객 화면",
  employee: "K7 직원 콘솔",
};

export default function App() {
  useEffect(() => {
    document.title = TITLES[role ?? ""] ?? "K7 라이브 시연";
  }, []);
  if (role === "admin") return <AdminDashboard />;
  if (role === "customer") return <LiveDemo view="phone" />;
  if (role === "employee") return <LiveDemo view="desktop" />;
  return <LiveDemo />;
}
