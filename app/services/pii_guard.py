"""개인정보 보호 가드 — PII 범위 정의 + 정규식/문맥 탐지 + 마스킹.

발표 "C. 개인정보·보안" 파트의 실제 배선. 한 모듈이 5개 주제를 관통한다:
  - PII_SCOPE            (주제 10) 무엇을 개인정보로 볼지 명시
  - detect_pii()         (주제 12) 정규식+문맥으로 주민/전화/계좌/카드/생년월일/
                                    인증정보/여권/면허/사업자/이메일/이름 탐지 (+애매 처리)
  - mask_transcript()    (주제 11·12) 전사문에서 PII를 마스킹 — AI가 보는·저장하는 건 마스킹본
  - mask_field()류       (주제 7)  고객 필드(이름·전화·계좌 등) 마스킹 함수

설계 원칙:
  - **원본 최소·마스킹 우선(fail-safe)**: 애매하면 마스킹한다(주제 12). 개인정보를 흘리는 것보다
    과마스킹이 안전하다. 단, 금액·개수 같은 짧은 숫자는 PII 모양(자릿수·문맥)일 때만 건드린다.
  - **AI는 원본 PII를 보지 않는다**: 실시간 전사는 상담사에게 팬아웃되기 전 마스킹된다.
  - **휘발**(주제 11): 원본 음성은 메모리에서만 쓰고 폐기, 저장하는 전사는 마스킹본만.
  - **격리 유지**: 이 모듈은 pii-service를 읽지 않는다. '아는 고객명 대조'가 필요하면 호출자가
    known_names로 넘긴다(예: 본인인증을 마친 상담사 클라이언트). pii_guard가 PII 저장소를
    직접 참조하지 않아 AI 백엔드-개인정보 분리가 유지된다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# ── 주제 10: PII 범위 — 무엇을 개인정보로 볼까 ─────────────────────────
PII_SCOPE: dict[str, str] = {
    "rrn": "주민등록번호",
    "card": "카드번호",
    "account": "계좌번호",
    "phone": "전화번호",
    "birth": "생년월일",
    "auth": "인증정보(OTP·비밀번호·보안카드)",
    "passport": "여권번호",
    "driver": "운전면허번호",
    "biz": "사업자등록번호",
    "email": "이메일",
    "name": "이름",
}

# 성씨 gazetteer — 이름 문맥 탐지의 오탐을 줄이려고 실제 성씨로 시작할 때만 후보로 본다.
_SURNAME = (
    "김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구"
    "민진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어편"
)

# ── 주제 12: 탐지 패턴 (구체 → 일반 순 = 우선순위). 겹치면 앞선 패턴이 이긴다(애매 처리). ──
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # 주민등록번호: 6자리 + [1-4]로 시작하는 7자리
    ("rrn", re.compile(r"(?<!\d)(\d{6})[-\s]?([1-4]\d{6})(?!\d)")),
    # 운전면허: 2-2-6-2 (구분자 필요 — 12자리 연속과 구분)
    ("driver", re.compile(r"(?<!\d)\d{2}[-\s]\d{2}[-\s]\d{6}[-\s]\d{2}(?!\d)")),
    # 카드번호: 4-4-4-4 (구분자 유무 무관), 총 15~16자리
    ("card", re.compile(r"(?<!\d)(\d{4})[-\s,]?(\d{4})[-\s,]?(\d{4})[-\s,]?(\d{3,4})(?!\d)")),
    # 사업자등록번호: 3-2-5 (구분자 필요)
    ("biz", re.compile(r"(?<!\d)\d{3}[-\s]\d{2}[-\s]\d{5}(?!\d)")),
    # 휴대폰: 010/011… - 3~4 - 4 (계좌보다 먼저 — 01X 접두라 더 구체적)
    ("phone", re.compile(r"(?<!\d)(01[016789])[-\s]?(\d{3,4})[-\s]?(\d{4})(?!\d)")),
    # 여권번호: 영문 1자 + 숫자 8 (구여권) 또는 영문 2자 + 숫자 7 (신여권)
    ("passport", re.compile(r"(?<![A-Za-z0-9])([A-Za-z]\d{8}|[A-Za-z]{2}\d{7})(?![A-Za-z0-9])")),
    # 계좌번호: ① 구분자 있는 3그룹(은행별 상이) ② 구분자 없는 10~14자리
    #          ③ '계좌번호' 문맥어 뒤의 9자리 이상 숫자열
    # 구분자에 쉼표를 포함한다 — STT가 숫자를 "111,222,334"처럼 끊어 적기 때문.
    # ③이 필요한 이유: 쉼표 3자리 묶음("111,222,334")은 금액("10,000,000")과 구조가
    # 완전히 같아 모양만으로 구분할 수 없다. 그래서 auth와 동일하게 문맥어에 기댄다.
    # '계좌' 단독이 아니라 '계좌번호'를 요구해 "계좌 잔액 1,000,000원" 오탐을 피한다.
    ("account", re.compile(
        r"(?<!\d)(\d{2,4})[-\s,](\d{2,6})[-\s,](\d{4,7})(?!\d)"
        r"|(?<!\d)\d{10,14}(?!\d)"
        r"|계좌\s*번호[^\d\n]{0,12}(?:\d[-\s,]?){8,}\d"
    )),
    # 생년월일: 'YYYY년 M월 D일' / 'YY(YY)년생' / 'YYYY.MM.DD' (4자리 연도일 때만 — 거래일 오탐 억제)
    ("birth", re.compile(
        r"(?:19|20)\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일"
        r"|(?:19|20)?\d{2}\s*년\s*생"
        r"|(?<!\d)(?:19|20)\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}(?!\d)"
    )),
    # 인증정보: 문맥어(인증번호/OTP/비밀번호/보안카드/승인번호) 근처의 숫자만 — 절대 노출 금지
    ("auth", re.compile(
        r"(?:인증\s*번호|인증\s*코드|인증\s*값|OTP|일회용\s*비밀번호|비밀\s*번호|비번"
        r"|보안\s*카드|보안\s*코드|승인\s*번호|카드\s*비밀번호)[^\d\n]{0,4}\d{2,8}",
        re.IGNORECASE,
    )),
    # 이메일
    ("email", re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")),
]

# 이름(비구조) — 정규식으론 한계라 '성씨 gazetteer + 문맥어'로 좁혀 잡는다(주제 12의 NER 자리).
_NAME_BEFORE = re.compile(rf"(?:이름|성함)[은는이가]?\s*[:]?\s*([{_SURNAME}][가-힣]{{1,2}})")
_NAME_AFTER_TITLE = re.compile(
    rf"(?<![가-힣])([{_SURNAME}][가-힣]{{1,2}})\s*(?:고객님|님이세요|님입니다|라고\s*합니다|이라고\s*합니다|입니다만)"
)
# 자기소개 'XXX입니다/이에요'는 3글자(성+이름2)일 때만 — '최고입니다' 같은 2글자 오탐 차단
_NAME_INTRO = re.compile(rf"(?<![가-힣])([{_SURNAME}][가-힣]{{2}})\s*(?:입니다|이에요|예요)")


@dataclass
class PiiHit:
    type: str          # rrn|card|account|phone|birth|auth|passport|driver|biz|email|name
    label: str         # 한국어 라벨(주제 10 스코프)
    start: int
    end: int
    original: str
    masked: str


def _mask_digits(s: str, keep_last: int = 4, keep_first: int = 0) -> str:
    """숫자만 마스킹하고 구분자·문자는 유지. 앞 keep_first / 뒤 keep_last 자리만 남긴다."""
    n = sum(c.isdigit() for c in s)
    keep_from = max(keep_first, n - keep_last)
    out, di = [], 0
    for c in s:
        if c.isdigit():
            out.append(c if (di < keep_first or di >= keep_from) else "*")
            di += 1
        else:
            out.append(c)
    return "".join(out)


def _mask_hit(kind: str, text: str) -> str:
    if kind == "rrn":
        # 생년월일 6 + 성별 1자리만, 뒤 6자리 마스킹: 880214-1******
        m = re.search(r"(\d{6})[-\s]?([1-4])", text)
        return f"{m.group(1)}-{m.group(2)}******" if m else "******-*******"
    if kind == "email":
        name, _, dom = text.partition("@")
        head = name[:1] if name else ""
        return f"{head}{'*' * max(2, len(name) - 1)}@{dom}"
    if kind == "phone":
        return _mask_digits(text, keep_first=3, keep_last=4)   # 010-****-4821
    if kind in ("card", "account"):
        return _mask_digits(text, keep_last=4)                  # ****-****-****-2231 / ***-**-4821
    if kind == "biz":
        return _mask_digits(text, keep_first=3, keep_last=0)    # 123-**-***** (앞 3자리 유형만)
    if kind in ("driver", "passport", "birth", "auth"):
        return _mask_digits(text, keep_last=0)                  # 숫자 전부 가림(문자·구분자·연/월/일 유지)
    if kind == "name":
        return mask_name(text)
    return "*" * len(text)


def _find_name_hits(text: str, known_names: list[str] | None) -> list[PiiHit]:
    """이름 탐지: ① 호출자가 넘긴 아는 고객명 정확 대조 ② 성씨+문맥어 기반(주제 12)."""
    hits: list[PiiHit] = []
    for nm in known_names or []:
        nm = (nm or "").strip()
        if len(nm) < 2:
            continue
        for m in re.finditer(re.escape(nm), text):
            hits.append(PiiHit("name", PII_SCOPE["name"], m.start(), m.end(), m.group(0), mask_name(m.group(0))))
    for pat in (_NAME_BEFORE, _NAME_AFTER_TITLE, _NAME_INTRO):
        for m in pat.finditer(text):
            seg = m.group(1)
            hits.append(PiiHit("name", PII_SCOPE["name"], m.start(1), m.end(1), seg, mask_name(seg)))
    return hits


def detect_pii(text: str, known_names: list[str] | None = None) -> list[PiiHit]:
    """전사문에서 개인정보를 탐지한다(주제 12). 겹치는 후보는 우선순위로 해소한다."""
    if not text:
        return []
    raw: list[PiiHit] = []
    for kind, pat in _PATTERNS:
        for m in pat.finditer(text):
            seg = m.group(0)
            raw.append(PiiHit(kind, PII_SCOPE.get(kind, kind), m.start(), m.end(), seg, _mask_hit(kind, seg)))
    raw.extend(_find_name_hits(text, known_names))

    # 겹침 해소: 시작 위치 → 우선순위(_PATTERNS 순, 이름은 최하위) → 더 넓은 매치 우선.
    prio = {k: i for i, (k, _) in enumerate(_PATTERNS)}
    prio["name"] = len(_PATTERNS)
    raw.sort(key=lambda h: (h.start, prio.get(h.type, 99), -(h.end - h.start)))
    chosen: list[PiiHit] = []
    occupied: list[tuple[int, int]] = []
    for h in raw:
        if any(h.start < e and s < h.end for s, e in occupied):
            continue  # 이미 더 우선인 매치가 이 구간을 차지 → 애매 회피
        chosen.append(h)
        occupied.append((h.start, h.end))
    chosen.sort(key=lambda h: h.start)
    return chosen


def mask_transcript(text: str, known_names: list[str] | None = None) -> tuple[str, list[PiiHit]]:
    """전사문의 PII를 마스킹한 문자열과 탐지 목록을 반환(주제 11·12).

    AI가 처리하거나 저장하는 전사는 이 함수를 통과한 마스킹본만 쓴다.
    known_names: 본인인증을 마친 상담사 측이 아는 고객명을 넘기면 정확 대조로 함께 가린다(선택).
    """
    hits = detect_pii(text, known_names)
    if not hits:
        return text, []
    out, last = [], 0
    for h in hits:
        out.append(text[last:h.start])
        out.append(h.masked)
        last = h.end
    out.append(text[last:])
    return "".join(out), hits


# ── 주제 7: 고객 필드 마스킹 함수 (pii-service가 하드코딩 대신 이걸 쓴다) ──
def mask_name(name: str) -> str:
    name = name.strip()
    if len(name) <= 1:
        return name
    if len(name) == 2:
        return name[0] + "*"
    return name[0] + "*" * (len(name) - 2) + name[-1]


def mask_phone(phone: str) -> str:
    return _mask_digits(phone, keep_first=3, keep_last=4)


def mask_account(acc: str) -> str:
    return _mask_digits(acc, keep_last=4)
