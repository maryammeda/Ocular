import subprocess
import sys
import os
import signal
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(ROOT, "frontend")
VENV_PYTHON = os.path.join(ROOT, "venv", "Scripts", "python.exe")

# Validate dependencies
if not os.path.exists(VENV_PYTHON):
    print("Virtual environment not found. Run: python -m venv venv")
    sys.exit(1)

if not shutil.which("npm"):
    print("npm not found. Please install Node.js from https://nodejs.org")
    sys.exit(1)

procs = []

def cleanup(*_):
    for p in procs:
        try:
            p.terminate()
            p.wait(timeout=5)
        except Exception:
            p.kill()
    sys.exit(0)

signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)

print("Starting backend (FastAPI) on http://127.0.0.1:8000")
print("Starting frontend (React)  on http://localhost:5173")
print("Press Ctrl+C to stop both.\n")

try:
    procs.append(subprocess.Popen(
        [VENV_PYTHON, "-m", "uvicorn", "main:app", "--reload"],
        cwd=ROOT,
    ))

    procs.append(subprocess.Popen(
        [shutil.which("npm"), "run", "dev"],
        cwd=FRONTEND,
    ))

    for p in procs:
        p.wait()
except Exception as e:
    print(f"Failed to start servers: {e}")
    cleanup()
