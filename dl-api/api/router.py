import traceback
from fastapi import APIRouter, Request, BackgroundTasks, HTTPException, Depends

from core import globals as glb
from schemas import RegistrationJobPayload, SearchRequest
from services.registration_service import process_registration_safe
from services.search_service import search_cow_safe
from core.security import verify_token, limiter

router = APIRouter()

@router.post("/register", dependencies=[Depends(verify_token)])
async def async_register(payload: RegistrationJobPayload, background_tasks: BackgroundTasks):
    """Entrypoint for Node server to dispatch an async registration job."""
    background_tasks.add_task(process_registration_safe, payload.dict())
    return {"status": "Job accepted"}

@router.post("/search", dependencies=[Depends(verify_token)])
async def search_cow(req: SearchRequest, fastapi_req: Request):
    """Entrypoint for synchronous biometric cattle search."""
    return await search_cow_safe(req, fastapi_req)



@router.get("/health")
@limiter.limit("5/minute")
async def health_check(request: Request):
    """Liveness check for Load Balancers."""
    return {
        "status": "healthy", 
        "model_loaded": bool(glb.dl),
        "db_connected": bool(glb.db)
    }
