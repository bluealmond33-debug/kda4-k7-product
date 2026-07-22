import LiveDemo from "./components/LiveDemo";
import AdminDashboard from "./components/admin/AdminDashboard";

// 화면 역할은 URL 파라미터로 나눈다 (라우터 없이) — 시연 구도와 일치:
//   /            상담사 데모 (폰 + 직원 데스크톱)
//   /?role=admin 관리자 콘솔 (백엔드 프로세스 대시보드) — 별도 탭/모니터로 연다
// 추후 고객 폰/직원 화면 분리 시 role=customer/employee 케이스를 여기에 추가한다.
const role = new URLSearchParams(window.location.search).get("role");

export default function App() {
  if (role === "admin") return <AdminDashboard />;
  return <LiveDemo />;
}
