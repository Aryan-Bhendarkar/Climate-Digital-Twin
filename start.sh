#!/bin/sh
# Start the model API on 8000 (internal) and the dashboard + API proxy on 7860 (public).
set -e
python serve.py --host 0.0.0.0 --port 8000 &
exec python dashboard/devserver.py --host 0.0.0.0 --port 7860 --model http://127.0.0.1:8000
