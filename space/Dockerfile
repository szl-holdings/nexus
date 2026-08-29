# NEXUS hologram — stdlib HTTP analog computer. No npm. No Gradio.
# GCR pin: HF builders fail public.ecr.aws and Docker Hub python: with exit 128.
# Flatten-compatible: Hub root is Dockerfile + server.py + index.html + README.
FROM mirror.gcr.io/library/python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=7860
COPY server.py ./server.py
COPY index.html ./index.html
EXPOSE 7860
CMD ["python", "-u", "server.py"]
