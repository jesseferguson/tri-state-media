import os


timeout = int(os.environ.get("GUNICORN_TIMEOUT", "120"))
graceful_timeout = int(os.environ.get("GUNICORN_GRACEFUL_TIMEOUT", "30"))
workers = int(os.environ.get("WEB_CONCURRENCY", "2"))
threads = int(os.environ.get("GUNICORN_THREADS", "2"))
worker_tmp_dir = os.environ.get("GUNICORN_WORKER_TMP_DIR") or ("/tmp" if os.path.isdir("/tmp") else None)
