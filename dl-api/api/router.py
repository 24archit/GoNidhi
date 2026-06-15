import requests
import traceback
from fastapi import APIRouter, Request, BackgroundTasks, HTTPException, Depends

from core import globals as glb
from core.config import EXPRESS_WEBHOOK_URL
from schemas import RegistrationJobPayload, SearchRequest
from services.registration_service import process_registration
from services.search_service import _search_cow_impl
from core.security import verify_token, limiter

router = APIRouter()

async def process_registration_safe(payload: dict):
    try:
        await process_registration(payload, notify_webhook=True)
    except Exception as e:
        print(f"Error processing async registration: {e}")
        if payload and payload.get("cow_id"):
            try:
                import os
                requests.post(EXPRESS_WEBHOOK_URL, json={
                    "cow_id": payload.get("cow_id"),
                    "farmer_id": payload.get("farmer_id"),
                    "status": "FAILED",
                    "error_message": "Registration failed due to an unexpected AI service error."
                }, headers={"Authorization": f"Bearer {os.getenv('API_SECRET')}"}, timeout=15)
            except Exception as webhook_err:
                print(f"Failed to send async registration failure webhook: {webhook_err}")

@router.post("/register", dependencies=[Depends(verify_token)])
async def async_register(payload: RegistrationJobPayload, background_tasks: BackgroundTasks):
    """Entrypoint for Node server to dispatch an async registration job."""
    background_tasks.add_task(process_registration_safe, payload.dict())
    return {"status": "Job accepted"}

@router.post("/search", dependencies=[Depends(verify_token)])
async def search_cow(req: SearchRequest, fastapi_req: Request):
    try:
        return await _search_cow_impl(req, fastapi_req)
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Internal Server Error: An unexpected error occurred during the search process.")

@router.delete("/cow/{cow_id}", dependencies=[Depends(verify_token)])
async def delete_cow_embeddings(cow_id: str):
    """Deletes the Qdrant vector embeddings for a specific cow."""
    try:
        glb.db.delete_embedding(cow_id)
        return {"status": "success", "message": f"Vectors for cow {cow_id} deleted successfully."}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Internal Server Error: An unexpected error occurred while deleting vectors.")

@router.get("/status/{cow_id}", dependencies=[Depends(verify_token)])
async def get_status(cow_id: str):
    if cow_id in glb.active_jobs:
        job = glb.active_jobs[cow_id]
        if job["status"] == "COMPLETED":
            return {"status": "COMPLETED", "result": job.get("result", {})}
        return {"status": job["status"]}
    raise HTTPException(status_code=404, detail="Job not found or already finished")

@router.get("/health")
@limiter.limit("5/minute")
async def health_check(request: Request):
    """Liveness check for Load Balancers."""
    return {
        "status": "healthy", 
        "model_loaded": bool(glb.dl),
        "db_connected": bool(glb.db)
    }
