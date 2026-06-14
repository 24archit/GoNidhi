import os
import asyncio
import xgboost as xgb
from fastapi import FastAPI
from contextlib import asynccontextmanager
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from core.security import limiter

# Core setup and configuration
from core.config import (
    EMBEDDING_MODEL_PATH, EMBEDDING_VECTOR_SIZE,
    QDRANT_URL, QDRANT_API_KEY
)
from core import globals as glb

# Services and Routers
from engine.dl_pipeline import DLPipeline
from engine.vector_store import CattleVectorStore
from api.router import router

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Loading models and initializing AI Engine...")
    base_dir = os.path.dirname(__file__)

    # Load XGBoost Ensembler
    glb.xgb_model = xgb.XGBClassifier()
    xgb_path = os.path.join(base_dir, "models", "xgb_biometric_model.json")
    if os.path.exists(xgb_path):
        glb.xgb_model.load_model(xgb_path)
        print(f"XGBoost Ensembler Loaded from {xgb_path}")
    else:
        print("WARNING: XGBoost model not found!")

    # Load Deep Learning Pipeline
    glb.dl = DLPipeline(
        yolo_face_path=os.path.join(base_dir, "models", "best_face.pt"),
        yolo_muzzle_path=os.path.join(base_dir, "models", "best.pt"),
        embedding_model_path=EMBEDDING_MODEL_PATH,
        spoof_path=os.path.join(base_dir, "models", "best_model.pth")
    )
    
    # Initialize Vector DB Connection
    print(f"Connecting to Qdrant at {QDRANT_URL}...")
    glb.db = CattleVectorStore(
        qdrant_url=QDRANT_URL,
        qdrant_api_key=QDRANT_API_KEY,
        vector_size=EMBEDDING_VECTOR_SIZE
    )
    
    print("System Ready.")
    
    yield  # Yield control to FastAPI app
    
    print("Shutting down...")

# Initialize FastAPI
app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Include all API routes
app.include_router(router)
