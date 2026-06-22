import traceback
from fastapi import APIRouter, Request, BackgroundTasks, HTTPException, Depends, Form, File, UploadFile

from core import globals as glb
from schemas import RegistrationJobPayload, SearchRequest
from services.registration_service import process_registration_safe
from services.search_service import search_cow_safe
from core.security import verify_token, limiter

router = APIRouter()

@router.post("/register", dependencies=[Depends(verify_token)])
@limiter.limit("20/minute")
async def async_register(
    request: Request,
    background_tasks: BackgroundTasks,
    farmer_id: str = Form(...),
    cow_id: str = Form(...),
    cow_name: str = Form(None),
    face_image_url: str = Form(None),
    muzzle_image_url: str = Form(None),
    face_image: UploadFile = File(None),
    muzzle_image: UploadFile = File(None)
):
    """Entrypoint for Node server to dispatch an async registration job."""
    f_bytes = await face_image.read() if face_image else None
    m_bytes = await muzzle_image.read() if muzzle_image else None
    
    payload = RegistrationJobPayload(
        farmer_id=farmer_id, cow_id=cow_id, cow_name=cow_name,
        face_image_url=face_image_url, muzzle_image_url=muzzle_image_url,
        face_image_bytes=f_bytes, muzzle_image_bytes=m_bytes
    )
    background_tasks.add_task(process_registration_safe, payload.model_dump())
    return {"status": "Job accepted"}

@router.post("/search", dependencies=[Depends(verify_token)])
@limiter.limit("30/minute")
async def search_cow(
    request: Request,
    user_id: str = Form(...),
    role: str = Form(...),
    face_image_url: str = Form(None),
    muzzle_image_url: str = Form(None),
    face_image: UploadFile = File(None),
    muzzle_image: UploadFile = File(None)
):
    """Entrypoint for synchronous biometric cattle search."""
    f_bytes = await face_image.read() if face_image else None
    m_bytes = await muzzle_image.read() if muzzle_image else None
    
    req = SearchRequest(
        user_id=user_id, role=role,
        face_image_url=face_image_url, muzzle_image_url=muzzle_image_url,
        face_image_bytes=f_bytes, muzzle_image_bytes=m_bytes
    )
    return await search_cow_safe(req, request)



@router.get("/health")
@limiter.limit("5/minute")
async def health_check(request: Request):
    """Liveness check for Load Balancers."""
    return {
        "status": "healthy", 
        "model_loaded": bool(glb.dl),
        "db_connected": bool(glb.db)
    }
