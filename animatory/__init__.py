from pathlib import Path

from dotenv import load_dotenv

# Load .env from the project root before any module reads os.environ.
# override=False means real environment variables still win over .env.
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)

__version__ = "0.1.0"
