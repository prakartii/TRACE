# TRACE backend — FastAPI perception + reasoning + Safe Action Planner API.
#
# Multi-stage: a builder installs the (heavy: torch / opencv / ultralytics)
# Python dependency tree into an isolated venv and pre-fetches the stock
# YOLOv8n weights; the runtime stage carries only the venv, the weights,
# and the application code.
#
# The frontend (frontend/, a Vite SPA) has its own image — see
# frontend/Dockerfile. docker-compose.yml wires the two together; that is
# the intended way to run the full stack.

# ----------------------------------------------------------------------------
# Stage 1 — builder
# ----------------------------------------------------------------------------
FROM python:3.12-slim AS builder

# build-essential covers any sdist that lacks a wheel on this platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN python -m venv "$VIRTUAL_ENV"

# CPU-only torch/torchvision FIRST, from PyTorch's CPU index. Installing
# these up front means the ultralytics dependency resolver finds them
# already satisfied and never pulls the multi-GB CUDA build from PyPI.
RUN pip install --index-url https://download.pytorch.org/whl/cpu \
        torch torchvision

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

# Pre-fetch the auto-downloadable YOLOv8n weights that
# backend/perception/config.py expects under models/ (models/* is gitignored,
# so it is never in the build context on a clean checkout):
#   - yolov8n.pt       stock detection, the default pipeline
#   - yolov8n-pose.pt  optional pose layer (off by default; enabled on the
#                      pilot config, degrades cleanly when the file is absent)
# The project-specific fine-tunes (models/trace_pilot_v1.pt, trace_pilot_v2.pt)
# are opt-in and cannot be fetched here — mount them at runtime if you have them.
RUN mkdir -p /opt/models \
    && cd /opt/models \
    && python -c "from ultralytics import YOLO; YOLO('yolov8n.pt'); YOLO('yolov8n-pose.pt')"

# ----------------------------------------------------------------------------
# Stage 2 — runtime
# ----------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

# libgl1 + libglib2.0-0: shared libs that the full opencv-python wheel
# (ultralytics depends on it unconditionally — see backend/requirements.txt)
# dlopens at import time. curl: container HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        curl \
    && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

# Weights (baked in stage 1), then application code. Backend modules import
# each other as `backend.<pkg>` (see README), so the package root must sit
# directly under the working directory.
COPY --from=builder /opt/models /app/models
COPY backend/ /app/backend/
COPY data/ /app/data/

# Run as non-root. The SQLite ledger is created at startup under
# backend/db/trace.db and the app writes clip/cache artefacts under data/,
# so those trees must be writable by the runtime user.
RUN useradd --create-home --uid 1000 trace \
    && chown -R trace:trace /app
USER trace

EXPOSE 8000

# Persist the event ledger and any ingested videos / derived clips across
# container restarts.
VOLUME ["/app/backend/db", "/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
