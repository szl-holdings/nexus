# NEXUS MK-II — Python CRT hologram. No space-dist. No npm ci.
# GCR pin — ECR Public is factory exit 128. Flatten-compatible COPY of Hub-root files.
FROM mirror.gcr.io/library/python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=7860
COPY server.py ./server.py
COPY index.html ./index.html
EXPOSE 7860
CMD ["python", "-u", "server.py"]
