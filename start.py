import subprocess
import sys
import os
import signal

ROOT = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(ROOT, "frontend")
VENV_PYTHON = os.path.join(ROOT, "venv", "Scripts", "python.exe")

procs = []

def cleanup(*_):
    for p in procs:
        p.terminate()
    sys.exit(0)

signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)

print("Starting backend (FastAPI) on http://127.0.0.1:8000")
print("Starting frontend (React)  on http://localhost:5173")
print("Press Ctrl+C to stop both.\n")

procs.append(subprocess.Popen(
    [VENV_PYTHON, "-m", "uvicorn", "main:app", "--reload"],
    cwd=ROOT,
))

procs.append(subprocess.Popen(
    ["npm", "run", "dev"],
    cwd=FRONTEND,
    shell=True,
))

for p in procs:
    p.wait()
