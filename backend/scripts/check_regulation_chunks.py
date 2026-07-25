"""규정 청크 코퍼스가 적재 저장소(product)와 일치하는지 확인한다.

왜 두 벌인가 — ADR-0011의 역할 분담 때문이다.
  · `kda4-k7-product/database/rag/chunks.jsonl`  = **원본**(적재 공장의 산출물, 김동희)
  · `backend/app/services/rag_data/regulation_chunks.jsonl` = **런타임 사본**(검색 엔진용)

실행 엔진은 product 저장소를 클론하지 않고도 돌아야 하므로 사본을 들고 있다. 대신
원본이 갱신되면(예: CRD·EFN·SG 문서 채우기) 사본이 조용히 낡는다 — 이 스크립트가 그걸
드러낸다.

    ./.venv/Scripts/python.exe -m scripts.check_regulation_chunks
    ./.venv/Scripts/python.exe -m scripts.check_regulation_chunks --apply   # 사본 갱신

`--apply`로 갱신하면 FAISS 인덱스 지문이 어긋나므로 다음 검색에서 자동 재빌드된다
(1,153청크 재임베딩 — 수 분 소요). 별도 조치는 필요 없다.
"""

from __future__ import annotations

import argparse
import hashlib
import pathlib
import shutil
import sys

# Windows 기본 콘솔(cp949)은 em dash 같은 문자를 인코딩하지 못해 출력 중 죽는다.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BACKEND_ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNTIME_COPY = BACKEND_ROOT / "app" / "services" / "rag_data" / "regulation_chunks.jsonl"
# product 저장소는 backend와 나란히 클론돼 있다고 본다(Documents/금융콜센터AI/ 아래).
DEFAULT_SOURCE = BACKEND_ROOT.parent / "kda4-k7-product" / "database" / "rag" / "chunks.jsonl"


def _digest(path: pathlib.Path) -> tuple[str, int]:
    """(sha256 앞 16자, 줄 수). 줄 수 = 청크 수."""
    digest = hashlib.sha256()
    lines = 0
    with path.open("rb") as handle:
        for line in handle:
            digest.update(line)
            if line.strip():
                lines += 1
    return digest.hexdigest()[:16], lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=pathlib.Path, default=DEFAULT_SOURCE,
                        help=f"원본 chunks.jsonl 경로 (기본: {DEFAULT_SOURCE})")
    parser.add_argument("--apply", action="store_true", help="다르면 원본으로 사본을 덮어쓴다")
    args = parser.parse_args()

    if not RUNTIME_COPY.is_file():
        print(f"런타임 사본이 없습니다: {RUNTIME_COPY}")
        return 2
    if not args.source.is_file():
        print(f"원본을 찾지 못했습니다: {args.source}")
        print("product 저장소를 클론했는지 확인하거나 --source로 경로를 지정하세요.")
        return 2

    source_hash, source_lines = _digest(args.source)
    copy_hash, copy_lines = _digest(RUNTIME_COPY)

    print(f"원본     {args.source}")
    print(f"         청크 {source_lines}개 · {source_hash}")
    print(f"런타임   {RUNTIME_COPY}")
    print(f"         청크 {copy_lines}개 · {copy_hash}")

    if source_hash == copy_hash:
        print("\n일치합니다 — 조치 불필요.")
        return 0

    print(f"\n다릅니다 (청크 {copy_lines} → {source_lines}).")
    if not args.apply:
        print("사본을 갱신하려면 --apply 를 붙여 다시 실행하세요.")
        return 1

    shutil.copy(args.source, RUNTIME_COPY)
    print(f"사본을 갱신했습니다. 다음 검색에서 FAISS 인덱스가 자동 재빌드됩니다"
          f"(청크 {source_lines}개 재임베딩 — 수 분 소요).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
