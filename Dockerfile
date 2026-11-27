# Monsoon Multiverse: one container = model API (internal :8000) + dashboard/API proxy (public :7860).
# Targets Hugging Face Spaces (Docker SDK, app_port 7860) but runs anywhere Docker does.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MONSOON_THREADS=1

# CPU-only torch keeps the image small (no CUDA wheels; the grader has no GPU).
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.4.1 \
 && pip install --no-cache-dir numpy==1.26.4 fastapi==0.115.0 uvicorn==0.30.6

# Non-root user (uid 1000 is what Hugging Face Spaces expects).
RUN useradd -m -u 1000 app
WORKDIR /home/app/repo
COPY --chown=app:app . .
USER app

EXPOSE 7860
CMD ["sh", "start.sh"]
