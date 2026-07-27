# K7 product — 폰트 정리 + 5-task cleanup (branch: mingikim-font-avenir-cleanup)
POLICY: bundle ONLY Avenir Next(Latin, self-host) + Pretendard(KR, self-host).
Material Symbols = self-host icon font. Mono = system stack ui-monospace (NO bundled mono).
REMOVE entirely: Geist Sans, Geist Mono, Space Grotesk, IBM Plex Mono.
Do NOT touch main. Commit to work branch only, no push.
Tasks: (1)Material Symbols single self-host (2)orphan html+03 Research 정리
(3)global.css hardcode→token (4)README map (5)Geist/SpaceGrotesk 제거.
