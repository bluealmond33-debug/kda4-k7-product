# syntax=docker/dockerfile:1

# ============ cpu 타깃 (팀원 랩탑, 스텁 모드) ============
FROM python:3.12-slim AS cpu
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    KMP_DUPLICATE_LIB_OK=TRUE
# libgomp1: lightgbm/faiss OpenMP · ffmpeg: 오디오 디코드(gpu 실모델용, cpu엔 무해)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
