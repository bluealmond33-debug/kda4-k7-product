"""opensmile 한글 경로 우회 — venv가 비ASCII 경로(예: '...금융콜센터AI\\backend\\.venv')
아래 있으면 opensmile C 백엔드가 설정 파일 경로를 ASCII로 인코딩하다 UnicodeEncodeError로
죽는다. opensmile은 `Smile.default_config_root`(패키지 __file__ 기준) 하나로 메인 .conf와
shared/*.conf.inc include를 모두 찾으므로, 설정 트리를 ASCII 캐시 경로로 한 번 복사하고 그
property만 그쪽으로 돌리면 전부 우회된다. 입력 WAV는 어차피 ASCII 임시경로에 쓰므로 무관.

ASCII 경로에 이미 설치돼 있으면(문제 없음) 아무 것도 하지 않는다.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

_PATCHED = False


def _is_ascii(text: str) -> bool:
    try:
        text.encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


def _ascii_cache_root() -> Path:
    """설정 트리를 복사할 ASCII 캐시 디렉토리를 고른다."""
    for candidate in (
        os.environ.get("LOCALAPPDATA"),
        os.environ.get("PROGRAMDATA"),
        r"C:\k7_opensmile",
    ):
        if candidate and _is_ascii(candidate):
            return Path(candidate) / "k7_opensmile"
    # 최후: 현재 드라이브 루트
    return Path(r"C:\k7_opensmile")


def ensure_ascii_opensmile_config() -> None:
    """opensmile.Smile.default_config_root를 ASCII 경로로 고정한다(필요할 때만)."""
    global _PATCHED
    if _PATCHED:
        return

    import opensmile
    import opensmile.core.smile as smile_module
    from opensmile.core.config import config as smile_config

    src_root = (
        Path(os.path.dirname(os.path.realpath(smile_module.__file__)))
        / smile_config.CONFIG_ROOT
    )
    if _is_ascii(str(src_root)):
        _PATCHED = True  # 경로가 이미 ASCII면 손댈 것 없음
        return

    dst_root = _ascii_cache_root() / "config"
    sentinel = dst_root / smile_config.EXTERNAL_INPUT_CONFIG  # 복사 완료 표식 겸용
    if not sentinel.exists():
        if dst_root.exists():
            shutil.rmtree(dst_root, ignore_errors=True)
        shutil.copytree(src_root, dst_root)

    dst_str = str(dst_root)

    # property를 ASCII 경로 상수로 교체 — 메인 .conf와 shared include 모두 이걸 쓴다.
    smile_module.Smile.default_config_root = property(lambda self: dst_str)
    _PATCHED = True
