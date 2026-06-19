import time
import asyncio
from fastapi import Request, HTTPException

from core import globals as glb
from services.image_service import download_image, encode_crop, upload_crop_to_cloudinary, delete_image_from_cloudinary
from schemas import SearchRequest
from services.fusion_service import compute_cosine_similarity, evaluate_biometric_match
from services.tournament_service import run_biometric_tournament, compute_traditional_metrics
from services.telemetry_builder import build_telemetry_payload
import traceback

async def search_cow_safe(req: SearchRequest, fastapi_req: Request):
    if glb.gpu_queue_size >= 5:
        raise HTTPException(status_code=503, detail="The AI servers are currently at maximum capacity. Please try again in 1-2 minutes.")
        
    glb.gpu_queue_size += 1
    try:
        return await _search_cow_impl(req, fastapi_req)
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        
        # Clean up any successfully uploaded crops if the AI pipeline crashed
        for task in getattr(req, "_upload_tasks", []):
            try:
                url = await task
                if url: delete_image_from_cloudinary(url)
            except: pass
            
        raise HTTPException(status_code=500, detail="Internal Server Error: An unexpected error occurred during the search process.")
    finally:
        glb.gpu_queue_size -= 1



def _raise_early_search_error(m_status: str, detail: str, req: SearchRequest, start_time: float, spoof_prob_muzzle=None, spoof_prob_face=None):
    inference_time = (time.time() - start_time) * 1000
    telemetry_data = build_telemetry_payload(
        job_type="search",
        cow_id=req.user_id,
        farmer_id=req.user_id,
        match_status=m_status,
        inference_time=inference_time,
        final_confidence=0.0,
        matched_cow_id=None,
        num_crops=0,
        muzzle_url=req.muzzle_image_url,
        face_url=req.face_image_url,
        muzzle_crop_b64=None,
        face_crop_b64=None,
        muzzle_conf=0.0,
        face_conf=0.0,
        spoof_prob_muzzle=spoof_prob_muzzle,
        spoof_prob_face=spoof_prob_face,
        cow_name=None,
        face_similarity_score=0.0,
        muzzle_similarity_score=0.0,
        verdict={"reason": detail},
        matched_image_url=None,
        matched_cow_name=None,
        best_lg_matches=-1,
        trad_metrics=None,
        best_features=None,
        xgb_score=None
    )
    raise HTTPException(status_code=400, detail={"message": detail, "telemetry": telemetry_data})

async def _search_cow_impl(req: SearchRequest, fastapi_req: Request):
    try:
        muzzle_img = download_image(req.muzzle_image_url)
        face_img = download_image(req.face_image_url) if req.face_image_url else None
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch images from Cloudinary storage: {e}")
    
    if await fastapi_req.is_disconnected():
        print("Client disconnected, aborting search pipeline.")
        raise HTTPException(status_code=499, detail="Client Disconnected")
        
    start_time = time.time()
    
    is_cow_muzzle = True
    spoof_prob_muzzle = None
    if muzzle_img is not None:
        is_cow_muzzle, _, _ = glb.dl.is_image_a_cow(muzzle_img)
        _, spoof_prob_muzzle = glb.dl.is_spoof(muzzle_img)
        
    is_cow_face = True
    spoof_prob_face = None
    if face_img is not None:
        is_cow_face, _, _ = glb.dl.is_image_a_cow(face_img)
        _, spoof_prob_face = glb.dl.is_spoof(face_img)
        
    if not is_cow_muzzle or not is_cow_face:
         m_status = "NOT_A_COW"
         detail = "We couldn't detect a cow. Please ensure the cow is clearly visible and the photos are well-lit before trying again."
         _raise_early_search_error(m_status, detail, req, start_time, spoof_prob_muzzle, spoof_prob_face)
         
    if await fastapi_req.is_disconnected():
        print("Client disconnected after YOLO Cow Detection.")
        raise HTTPException(status_code=499, detail="Client Disconnected")

    with glb.gpu_lock:
        muzzle_crop, muzzle_conf = glb.dl.extract_biometric(muzzle_img, part_type="muzzle")
        face_crop, face_conf = (glb.dl.extract_biometric(face_img, part_type="face") if face_img is not None else (None, 0.0))
        face_muzzle_crop, face_muzzle_conf = (glb.dl.extract_biometric(face_img, part_type="muzzle") if face_img is not None else (None, 0.0))
        
    muzzle_upload_task = None
    face_upload_task = None
    face_muzzle_upload_task = None

    req._upload_tasks = []
    if muzzle_crop is not None:
        muzzle_upload_task = asyncio.create_task(asyncio.to_thread(upload_crop_to_cloudinary, muzzle_crop["clahe"]))
        req._upload_tasks.append(muzzle_upload_task)
    if face_crop is not None:
        face_upload_task = asyncio.create_task(asyncio.to_thread(upload_crop_to_cloudinary, face_crop["clahe"]))
        req._upload_tasks.append(face_upload_task)
    if face_muzzle_crop is not None:
        face_muzzle_upload_task = asyncio.create_task(asyncio.to_thread(upload_crop_to_cloudinary, face_muzzle_crop["clahe"]))
        req._upload_tasks.append(face_muzzle_upload_task)

    if muzzle_crop is None and face_crop is None and face_muzzle_crop is None:
         m_status = "NO_BIOMETRICS_DETECTED"
         detail = "We couldn't detect the face or muzzle. Please retake the photos close-up, ensuring the cow's face is fully in the frame."
         _raise_early_search_error(m_status, detail, req, start_time, spoof_prob_muzzle, spoof_prob_face)
         
    if await fastapi_req.is_disconnected():
        print("Client disconnected after Biometric Extraction.")
        raise HTTPException(status_code=499, detail="Client Disconnected")

    with glb.gpu_lock:
        muzzle_emb = glb.dl.get_embeddings_batch([muzzle_crop["clahe"]])[0] if muzzle_crop else None
        face_emb = glb.dl.get_embeddings_batch([face_crop["clahe"]])[0] if face_crop else None
        face_muzzle_emb = glb.dl.get_embeddings_batch([face_muzzle_crop["clahe"]])[0] if face_muzzle_crop else None
        
        spatial_muzzle_emb = glb.dl.get_spatial_embeddings(muzzle_crop["raw"], "muzzle") if muzzle_crop else None
        spatial_face_emb = glb.dl.get_spatial_embeddings(face_crop["raw"], "face") if face_crop else None
        spatial_face_muzzle_emb = glb.dl.get_spatial_embeddings(face_muzzle_crop["raw"], "muzzle") if face_muzzle_crop else None
    
    if await fastapi_req.is_disconnected():
        print("Client disconnected after Embedding Generation.")
        raise HTTPException(status_code=499, detail="Client Disconnected")

    dynamic_candidates_dict = {}
    best_muzzle_sim = 0.0
    best_face_sim = 0.0
    matched_cow_id = None
    best_lg_matches = -1
    best_xgb_score = None
    matched_cow_name = None
    matched_image_url = None
    
    query_mega = muzzle_emb or face_muzzle_emb
    query_muzzle = spatial_muzzle_emb or spatial_face_muzzle_emb
    
    if query_mega or query_muzzle:
        m_candidates = glb.db.search(
            query_mega=query_mega,
            query_muzzle=query_muzzle,
            query_face=None,
            user_id=req.user_id, role=req.role, part_type=["muzzle", "face_muzzle"], top_k=25, fetch_vectors=True
        )
        if m_candidates and isinstance(m_candidates, list):
            for c in m_candidates: dynamic_candidates_dict[c["cow_id"]] = c

    dynamic_candidates = list(dynamic_candidates_dict.values())
    
    if await fastapi_req.is_disconnected():
        print("Client disconnected after Qdrant Search.")
        raise HTTPException(status_code=499, detail="Client Disconnected")
                
    sp_caches = []
    if muzzle_crop is not None:
        sp_caches.append(glb.dl.extract_superpoint_base64(muzzle_crop["clahe"]))
    if face_muzzle_crop is not None:
        sp_caches.append(glb.dl.extract_superpoint_base64(face_muzzle_crop["clahe"]))
    
    if dynamic_candidates and sp_caches:
        print(f"Deep Pool: Qdrant found {len(dynamic_candidates)}. Handing to Feature Extraction and XGBoost loop.")
        
        best_cow_id_overall, best_xgb_score, best_features = await run_biometric_tournament(
            query_mega, query_muzzle, spatial_face_emb, face_emb, muzzle_crop["clahe"] if muzzle_crop else None, dynamic_candidates, sp_caches, fastapi_req=fastapi_req
        )
        
        if await fastapi_req.is_disconnected():
            print("Client disconnected after XGBoost Tournament.")
            raise HTTPException(status_code=499, detail="Client Disconnected")
        
        best_lg_matches = best_features.get("lg_matches") if best_features else -1
            
        if best_cow_id_overall:
            matched_candidate = next((c for c in dynamic_candidates if c["cow_id"] == best_cow_id_overall), None)
            if matched_candidate:
                if best_features:
                    best_muzzle_sim = best_features.get("spatial_muzzle_sim") or best_features.get("muzzle_sim") or matched_candidate["similarity"]
                else:
                    best_muzzle_sim = matched_candidate["similarity"]
                matched_cow_id = matched_candidate["cow_id"]
                matched_cow_name = matched_candidate.get("cow_name")
                matched_image_url = matched_candidate.get("image_url")
                
    if face_emb or spatial_face_emb:
        if matched_cow_id and 'best_features' in locals() and best_features and best_features.get("spatial_face_sim"):
            best_face_sim = best_features.get("spatial_face_sim")
        else:
            f_candidates = glb.db.search(query_mega=face_emb, query_muzzle=None, query_face=spatial_face_emb, user_id=req.user_id, role=req.role, part_type="face", top_k=25, fetch_vectors=True)
            if f_candidates:
                if not isinstance(f_candidates, list):
                    f_candidates = [f_candidates]
                
                if matched_cow_id:
                    face_match = next((c for c in f_candidates if c["cow_id"] == matched_cow_id), None)
                    if face_match:
                        best_face_sim = compute_cosine_similarity(spatial_face_emb, face_match.get("vectors", {}).get("spatial_face")) if spatial_face_emb else face_match["similarity"]
                        if 'best_features' in locals() and best_features is not None:
                            best_features["spatial_face_sim"] = best_face_sim
                else:
                    best_face_sim = compute_cosine_similarity(spatial_face_emb, f_candidates[0].get("vectors", {}).get("spatial_face")) if spatial_face_emb else f_candidates[0]["similarity"]
                    matched_cow_id = f_candidates[0]["cow_id"]
                    matched_cow_name = f_candidates[0].get("cow_name")
                    matched_image_url = f_candidates[0].get("image_url")
                    if 'best_features' in locals() and best_features is not None:
                        best_features["spatial_face_sim"] = best_face_sim

    verdict = evaluate_biometric_match(best_muzzle_sim, best_face_sim, best_lg_matches, best_xgb_score)
    final_confidence = verdict["confidence"]
    
    inference_time = (time.time() - start_time) * 1000
    
    trad_metrics = compute_traditional_metrics(muzzle_crop, matched_image_url) if muzzle_crop is not None else {}
    
    muzzle_crop_url = await muzzle_upload_task if 'muzzle_upload_task' in locals() and muzzle_upload_task else None
    face_crop_url = await face_upload_task if 'face_upload_task' in locals() and face_upload_task else None
    face_muzzle_crop_url = await face_muzzle_upload_task if 'face_muzzle_upload_task' in locals() and face_muzzle_upload_task else None
    
    face_sim_score = face_match.get("similarity") if 'face_match' in locals() and face_match else (f_candidates[0].get("similarity") if 'f_candidates' in locals() and f_candidates else best_face_sim)
    muzzle_sim_score = best_features.get("muzzle_sim") if 'best_features' in locals() and best_features else (matched_candidate.get("similarity") if 'matched_candidate' in locals() and matched_candidate else best_muzzle_sim)

    telemetry_data = build_telemetry_payload(
        job_type="search",
        cow_id=matched_cow_id if matched_cow_id else "Unknown",
        farmer_id=req.user_id,
        match_status="FOUND" if verdict["match"] else "NOT_FOUND",
        inference_time=inference_time,
        final_confidence=final_confidence,
        matched_cow_id=matched_cow_id,
        num_crops=sum(x is not None for x in [muzzle_crop_url, face_crop_url, face_muzzle_crop_url]),
        muzzle_url=req.muzzle_image_url,
        face_url=req.face_image_url,
        muzzle_crop_b64=muzzle_crop_url,
        face_crop_b64=face_crop_url,
        muzzle_conf=muzzle_conf,
        face_conf=face_conf,
        spoof_prob_muzzle=spoof_prob_muzzle,
        spoof_prob_face=spoof_prob_face,
        cow_name=matched_cow_name,
        face_similarity_score=face_sim_score,
        muzzle_similarity_score=muzzle_sim_score,
        verdict=verdict,
        matched_image_url=matched_image_url,
        matched_cow_name=matched_cow_name,
        best_lg_matches=best_lg_matches,
        trad_metrics=trad_metrics,
        best_features=best_features if 'best_features' in locals() else None,
        xgb_score=best_xgb_score
    )
    
    print(f"[Search Fast Fetch] Completed in {int(inference_time)}ms. Verdict: {verdict['match']}")
            
    if verdict["match"]:
        return {
            "match": True,
            "cow_id": matched_cow_id,
            "distance": 1.0 - final_confidence,
            "telemetry": telemetry_data
        }
    else:
        return {
            "match": False,
            "cow_id": None,
            "reason": verdict.get("user_reason", verdict.get("reason", "N/A")),
            "developer_reason": verdict.get("developer_reason", "N/A"),
            "telemetry": telemetry_data
        }
