# dumper/Dockerfile.dev
FROM python:3.13
WORKDIR /app/dumper
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "main.py"]