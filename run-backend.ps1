# run-backend.ps1 — start the Animatory backend.
#
# Configuration (QWEN_ENDPOINT, QWEN_MODEL, etc.) is read from the .env file at the
# repo root, loaded automatically at startup via python-dotenv. Edit .env to change it.
#
# Usage:  .\run-backend.ps1

# Use the project venv's uvicorn so this works whether or not the venv is activated.
$uvicorn = Join-Path $PSScriptRoot ".venv\Scripts\uvicorn.exe"
if (-not (Test-Path $uvicorn)) { $uvicorn = "uvicorn" }  # fall back to PATH

& $uvicorn animatory.server:app --reload --port 8000
