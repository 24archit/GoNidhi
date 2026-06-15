import os
from dotenv import load_dotenv

load_dotenv(override=True)

EXPRESS_WEBHOOK_URL = os.getenv(
    "EXPRESS_WEBHOOK_URL", 
    "http://localhost:2424/api/farmer/cattle/webhook/dl-api-complete"
)

LOCAL_UPLOAD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "server", "uploads"))

EMBEDDING_MODEL_PATH = os.getenv("EMBEDDING_MODEL_PATH", None)
EMBEDDING_VECTOR_SIZE = int(os.getenv("EMBEDDING_VECTOR_SIZE", "1536"))

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")
