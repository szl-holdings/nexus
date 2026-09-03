# NEXUS hologram — stdlib HTTP analog computer. No npm. No Gradio.
# GCR pin: HF builders fail public.ecr.aws and Docker Hub python: with exit 128.
# Flatten-compatible: Hub root is Dockerfile + runtime sources + README.
# Publisher expand_sources resolves COPY against the checkout root.
FROM mirror.gcr.io/library/python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=7860
ARG HF_CACHE_BUST=adex-hyb-source-bound-1
COPY server.py ./server.py
COPY source_bound_server.py ./source_bound_server.py
COPY SOURCE_GITHUB_SHA ./SOURCE_GITHUB_SHA
COPY index.html ./index.html
# Not pip-installed. Owns the leftover Lorenz-era file so flatten/prune is honest.
COPY requirements.txt ./requirements.txt
EXPOSE 7860
CMD ["python", "-u", "source_bound_server.py"]
