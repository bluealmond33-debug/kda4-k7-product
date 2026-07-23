import { useEffect } from "react";
import LiveDemo from "./components/LiveDemo";
import AdminDashboard from "./components/admin/AdminDashboard";

// 화면 역할은 URL로 나눈다 (라우터 없이) — 시연 구도 4화면:
//   /            시연화면: 폰 + 직원 데스크톱 합본 (라이브 시연용)
//   /admin       관제 대시보드 (백엔드 프로세스) — 별도 탭/모니터
//   /customer    고객 핸드폰 단독
//   /employee    직원 데스크톱 단독
// 팀 공유용 경로가 기본(k7product.vercel.app/admin — vercel.json SPA rewrite 필요),
// 구 방식 ?role= 도 계속 동작한다. customer/employee는 탭별 독립 인스턴스.
// call_id가 명시되면 고객·직원·관리자 화면은 중앙 WS 릴레이로 같은 통화 세션을 공유한다.
// call_id가 없는 기본 경로는 기존 한 브라우저 합본/탭 데모를 유지한다.
const path = window.location.pathname.replace(/\/+$/, "").split("/").pop() ?? "";
const role = ["admin", "customer", "employee"].includes(path)
  ? path
  : new URLSearchParams(window.location.search).get("role");

const TITLES: Record<string, string> = {
  admin: "KARI-NA 관제 대시보드",
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
