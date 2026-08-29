# NEXUS hologram — stdlib HTTP analog computer. No npm. No Gradio.
# GCR pin: HF builders fail public.ecr.aws and Docker Hub python: with exit 128.
# Flatten-compatible: Hub root is Dockerfile + server.py + index.html + README.
# Publisher expand_sources resolves COPY against the checkout root, so
# server.py, index.html, and requirements.txt MUST live at repo root.
FROM mirror.gcr.io/library/python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=7860
ARG HF_CACHE_BUST=adex-5org-2brn-1
COPY server.py ./server.py
COPY index.html ./index.html
# Not pip-installed. Owns the leftover Lorenz-era file so flatten/prune is honest.
COPY requirements.txt ./requirements.txt
EXPOSE 7860
CMD ["python", "-u", "server.py"]
