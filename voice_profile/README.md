# Inworld Voice Profile 분석 재현 안내

이 폴더는 Inworld STT Voice Profile API를 사용해 음성 파일의 감정, 피치, 발화 스타일, 악센트 예측값을 JSON/CSV로 저장하는 작업 묶음이다.

API 키는 포함하지 않는다.

## 포함 파일

| 파일 | 설명 |
|---|---|
| `analyze_inworld_voice_profile.py` | Inworld API 호출 및 피처 CSV 생성 스크립트 |
| `inworld_voice_profile_v4_plan.md` | Voice Profile을 v4 모델 피처로 활용하는 계획서 |
| `inworld_results/inworld_voice_profile_raw.jsonl` | 기존 테스트 음성 5개에 대한 Inworld 원본 응답 예시 |
| `inworld_results/inworld_voice_profile_features.csv` | v4 학습 피처로 사용할 수 있게 펼친 CSV 예시 |

## 팀원이 새로 실행하려면

PowerShell에서 프로젝트 루트로 이동한다.

```powershell
cd "C:\Users\KDA 30\Documents\K7"
```

Inworld API 키를 현재 터미널에만 임시 등록한다.

```powershell
$env:INWORLD_API_KEY="본인_Inworld_API_KEY"
```

실행한다.

```powershell
.\.venv\Scripts\python.exe .\voice_profile\analyze_inworld_voice_profile.py .\voice --out-dir .\voice_profile\inworld_results --language ko --top-n 10
```

## 출력 파일

```text
voice_profile/inworld_results/inworld_voice_profile_raw.jsonl
voice_profile/inworld_results/inworld_voice_profile_features.csv
```

`raw.jsonl`은 API 원본 응답 보관용이고, `features.csv`는 모델 v4에 병합할 학습 피처용 파일이다.

## 주의

- Inworld 결과는 정답 라벨이 아니라 외부 모델의 예측값이다.
- API 키를 GitHub, Notion, 단체 채팅방에 올리지 않는다.
- 실제 고객 음성은 개인정보 및 외부 전송 이슈가 있으므로 공개/테스트 음성만 사용한다.
- 많은 파일을 한 번에 돌리면 API 비용이 발생할 수 있으므로 먼저 5~10개 샘플로 확인한다.
