import time
import asyncio
import cv2
import torch
from PIL import Image
from fastapi import Request, HTTPException
import traceback
import gc

from core import globals as glb
from core.logging_config import logger
from engine.clip_analyzer import CLIP_REJECT_MESSAGES
from services.image_service import download_image, encode_crop, upload_crop_to_cloudinary, delete_image_from_cloudinary, extract_crop_from_b64
from schemas import SearchRequest
from services.fusion_service import compute_cosine_similarity, evaluate_biometric_match
from services.tournament_service import run_biometric_tournament, compute_traditional_metrics
from services.telemetry_builder import build_telemetry_payload

async def search_cow_safe(req: SearchRequest, fastapi_req: Request):
    try:
        return await _search_cow_impl(req, fastapi_req)
    except Exception as e:
        tasks = getattr(req, "_upload_tasks", [])
        if tasks:
            async def _cleanup(t_list):
                for t in t_list:
                    try:
                        url = await t
                        if url: await asyncio.to_thread(delete_image_from_cloudinary, url)
                    except Exception: pass
            asyncio.create_task(_cleanup(tasks))
            
        if isinstance(e, HTTPException):
            raise e
        logger.error(f"Search failed: {traceback.format_exc()}")
        gc.collect()
        torch.cuda.empty_cache()
        raise HTTPException(status_code=500, detail="Internal Server Error: An unexpected error occurred during the search process.")


def _raise_early_search_error(m_status: str, detail: str, req: SearchRequest, start_time: float, spoof_prob_muzzle=None, spoof_prob_face=None):
    inference_time = (time.time() - start_time) * 1000
    telemetry_data = build_telemetry_payload(
        job_type="search", cow_id=req.user_id, farmer_id=req.user_id, match_status=m_status,
        inference_time=inference_time, final_confidence=0.0, matched_cow_id=None,
        num_crops=0, muzzle_url=req.muzzle_image_url, face_url=req.face_image_url,
        muzzle_crop_b64=None, face_crop_b64=None, muzzle_conf=0.0, face_conf=0.0,
        spoof_prob_muzzle=spoof_prob_muzzle, spoof_prob_face=spoof_prob_face, cow_name=None,
        face_similarity_score=0.0, muzzle_similarity_score=0.0, verdict={"reason": detail},
        matched_image_url=None, matched_cow_name=None, best_lg_matches=-1,
        trad_metrics=None, best_features=None, xgb_score=None
    )
    gc.collect()
    torch.cuda.empty_cache()
    raise HTTPException(status_code=400, detail={"message": detail, "telemetry": telemetry_data})

async def _search_cow_impl(req: SearchRequest, fastapi_req: Request):
    from services.image_service import extract_crop_from_bytes, download_image, upload_crop_to_cloudinary, delete_image_from_cloudinary
    from services.tournament_service import get_texture_features

    try:
        start_time = time.time()
        
        async def fetch_face():
            if req.face_image_bytes: return await asyncio.to_thread(extract_crop_from_bytes, req.face_image_bytes)
            return await asyncio.to_thread(download_image, req.face_image_url) if req.face_image_url else None

        async def fetch_muzzle():
            if req.muzzle_image_bytes: return await asyncio.to_thread(extract_crop_from_bytes, req.muzzle_image_bytes)
            return await asyncio.to_thread(download_image, req.muzzle_image_url) if req.muzzle_image_url else None

        face_img, muzzle_img = await asyncio.gather(fetch_face(), fetch_muzzle())
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch or decode images: {e}")
    
    if await fastapi_req.is_disconnected():
        logger.warning("Client disconnected, aborting search pipeline.")
        raise HTTPException(status_code=499, detail="Client Disconnected")
        
    start_time = time.time()
    
    def _sync_gpu_pipeline():
        res = {
            "is_not_a_cow": False,
            "spoof_prob_muzzle": 0.0, "spoof_prob_face": 0.0,
            "muzzle_crop": None, "face_crop": None, "face_muzzle_crop": None,
            "muzzle_conf": 0.0, "face_conf": 0.0, "face_muzzle_conf": 0.0,
            "clip_semantic_tags": None, "clip_reject_reason": None,
            "muzzle_emb": None, "face_emb": None, "face_muzzle_emb": None,
            "spatial_muzzle_emb": None, "spatial_face_emb": None, "spatial_face_muzzle_emb": None,
            "effective_face_crop": None, "muzzle_superpoint_cache": None, "face_muzzle_superpoint_cache": None
        }

        # Enforce strictly Portrait mode photos for original uploads
        for img in [muzzle_img, face_img]:
            if img is not None:
                h, w = img.shape[:2]
                if w > h:
                    res["clip_reject_reason"] = "REJ_QA_INVALID_ORIENTATION"
                    return res

        with glb.gpu_lock:
            with torch.inference_mode(), torch.amp.autocast('cuda'):
                # 1. QA - Is it a cow?
                cow_res = glb.dl.are_images_cows([muzzle_img, face_img])
                _is_cow_muzzle, _cow_prob_m, _ = cow_res[0]
                _is_cow_face, _cow_prob_f, _ = cow_res[1]

                # For QA, require both to pass if both are given, else just the given one.
                _is_not_a_cow = False
                if req.muzzle_image_bytes or req.muzzle_image_url:
                    if not _is_cow_muzzle: _is_not_a_cow = True
                if req.face_image_bytes or req.face_image_url:
                    if not _is_cow_face: _is_not_a_cow = True
                    
                if _is_not_a_cow:
                    res["error"] = "Image does not appear to be a cow."
                    return res

                # 2. Extract crops
                muzzle_crops_and_confs = glb.dl.extract_biometric_batch([muzzle_img, face_img], part_type="muzzle")
                face_crops_and_confs = glb.dl.extract_biometric_batch([face_img, muzzle_img], part_type="face")
                
                _m_crop, _m_conf = muzzle_crops_and_confs[0]
                _fm_crop, _fm_conf = muzzle_crops_and_confs[1]
                
                _f_crop, _f_conf = face_crops_and_confs[0]
                _ffm_crop, _ = face_crops_and_confs[1]
                
                spoof_res = glb.dl.are_images_spoofs([muzzle_img, face_img])
                _, _spoof_prob_m = spoof_res[0]
                _, _spoof_prob_f = spoof_res[1]
                
            res.update({
                "is_not_a_cow": _is_not_a_cow,
                "spoof_prob_muzzle": _spoof_prob_m, 
                "spoof_prob_face": _spoof_prob_f
            })

            if not _is_not_a_cow:
                res.update({"muzzle_crop": _m_crop, "face_crop": _f_crop, "face_muzzle_crop": _fm_crop, "muzzle_conf": _m_conf, "face_conf": _f_conf, "face_muzzle_conf": _fm_conf})

                _eff_f_crop = _f_crop or _ffm_crop
                res["effective_face_crop"] = _eff_f_crop

                clip_primary = Image.fromarray(cv2.cvtColor(face_img, cv2.COLOR_BGR2RGB)) if face_img is not None else None
                clip_secondary = Image.fromarray(cv2.cvtColor(muzzle_img, cv2.COLOR_BGR2RGB)) if muzzle_img is not None else None

                if clip_primary is not None or clip_secondary is not None:
                    clip_result = glb.dl.clip_analyzer.analyze_images(face_pil=clip_primary, muzzle_pil=clip_secondary)
                    if clip_result["status"] == "PASS":
                        res["clip_semantic_tags"] = clip_result["metadata_payload"]
                    else:
                        res["clip_reject_reason"] = clip_result["reason"]

                # Unified GPU Batching for MegaDescriptor
                crops_to_embed = []
                if _m_crop: crops_to_embed.append(_m_crop["clahe"])
                if _eff_f_crop: crops_to_embed.append(_eff_f_crop["clahe"])
                if _fm_crop: crops_to_embed.append(_fm_crop["clahe"])

                if crops_to_embed:
                    batch_embs = glb.dl.get_embeddings_batch(crops_to_embed)
                    idx = 0
                    if _m_crop:
                        res["muzzle_emb"] = batch_embs[idx]
                        idx += 1
                    if _eff_f_crop:
                        res["face_emb"] = batch_embs[idx]
                        idx += 1
                    if _fm_crop:
                        res["face_muzzle_emb"] = batch_embs[idx]
                        idx += 1

                if _m_crop:
                    res["spatial_muzzle_emb"] = glb.dl.get_spatial_embeddings(_m_crop["raw"], "muzzle")
                    res["muzzle_superpoint_cache"] = glb.dl.extract_superpoint_base64(_m_crop["clahe"])
                
                if _eff_f_crop:
                    res["spatial_face_emb"] = glb.dl.get_spatial_embeddings(_eff_f_crop["raw"], "face")
                    
                if _fm_crop:
                    res["spatial_face_muzzle_emb"] = glb.dl.get_spatial_embeddings(_fm_crop["raw"], "muzzle")
                    res["face_muzzle_superpoint_cache"] = glb.dl.extract_superpoint_base64(_fm_crop["clahe"])

        return res

    async with glb.gpu_semaphore:
        gpu_res = await asyncio.to_thread(_sync_gpu_pipeline)
    
    if gpu_res["is_not_a_cow"]:
        _raise_early_search_error("NOT_A_COW", "We couldn't detect a cow. Please ensure the cow is clearly visible.", req, start_time, gpu_res["spoof_prob_muzzle"], gpu_res["spoof_prob_face"])

    muzzle_crop = gpu_res["muzzle_crop"]
    face_crop = gpu_res["face_crop"]
    face_muzzle_crop = gpu_res["face_muzzle_crop"]
    effective_face_crop = gpu_res["effective_face_crop"]
    muzzle_conf = gpu_res["muzzle_conf"]
    face_conf = gpu_res["face_conf"]
    
    clip_semantic_tags = gpu_res["clip_semantic_tags"]
    clip_reject_reason = gpu_res["clip_reject_reason"]
    
    muzzle_emb = gpu_res["muzzle_emb"]
    face_emb = gpu_res["face_emb"]
    face_muzzle_emb = gpu_res["face_muzzle_emb"]
    spatial_muzzle_emb = gpu_res["spatial_muzzle_emb"]
    spatial_face_emb = gpu_res["spatial_face_emb"]
    spatial_face_muzzle_emb = gpu_res["spatial_face_muzzle_emb"]
    
    muzzle_superpoint_cache = gpu_res["muzzle_superpoint_cache"]
    face_muzzle_superpoint_cache = gpu_res["face_muzzle_superpoint_cache"]
    spoof_prob_muzzle = gpu_res["spoof_prob_muzzle"]
    spoof_prob_face = gpu_res["spoof_prob_face"]
    
    req._upload_tasks = []
    muzzle_upload_task = None
    face_upload_task = None
    face_muzzle_upload_task = None

    if muzzle_crop is not None:
        muzzle_upload_task = asyncio.create_task(asyncio.to_thread(upload_crop_to_cloudinary, muzzle_crop["clahe"]))
        req._upload_tasks.append(muzzle_upload_task)
    if face_crop is not None:
        face_upload_task = asyncio.create_task(asyncio.to_thread(upload_crop_to_cloudinary, face_crop["clahe"]))
        req._upload_tasks.append(face_upload_task)
    if face_muzzle_crop is not None:
        face_muzzle_upload_task = asyncio.create_task(asyncio.to_thread(upload_crop_to_cloudinary, face_muzzle_crop["clahe"]))
        req._upload_tasks.append(face_muzzle_upload_task)

    if effective_face_crop is None:
        detail = "We couldn't detect the cow's face from either photo. Please retake both photos ensuring the cow's face is fully visible."
        logger.warning("[Search] No face crop from either source image.")
        _raise_early_search_error("NO_FACE_DETECTED", detail, req, start_time, spoof_prob_muzzle, spoof_prob_face)

    if muzzle_crop is None and face_muzzle_crop is None:
        detail = "The muzzle is not clearly visible. Please wipe the muzzle clean and retake a sharp, close-up photo."
        _raise_early_search_error("NO_MUZZLE_DETECTED", detail, req, start_time, spoof_prob_muzzle, spoof_prob_face)

    if clip_reject_reason:
        user_msg = CLIP_REJECT_MESSAGES.get(clip_reject_reason, "Image quality check failed. Please retake the photo.")
        logger.warning(f"[CLIP Search] Blocked: {clip_reject_reason}")
        _raise_early_search_error(clip_reject_reason, user_msg, req, start_time, spoof_prob_muzzle, spoof_prob_face)

    if await fastapi_req.is_disconnected():
        logger.warning("Client disconnected after Feature Extraction.")
        raise HTTPException(status_code=499, detail="Client Disconnected")

    dynamic_candidates_dict = {}
    query_mega = muzzle_emb or face_muzzle_emb
    query_muzzle = spatial_muzzle_emb or spatial_face_muzzle_emb
    
    if query_mega or query_muzzle:
        def _sync_db_search_m():
            return glb.db.search(
                query_mega=query_mega, query_muzzle=query_muzzle, query_face=None,
                user_id=req.user_id, role=req.role, part_type=["muzzle", "face_muzzle"], 
                top_k=30, fetch_vectors=True, semantic_filter=clip_semantic_tags,
            )
        m_candidates = await asyncio.to_thread(_sync_db_search_m)
        if m_candidates and isinstance(m_candidates, list):
            for c in m_candidates: dynamic_candidates_dict[c["cow_id"]] = c

    dynamic_candidates = list(dynamic_candidates_dict.values())
    
    if await fastapi_req.is_disconnected():
        logger.warning("Client disconnected after Qdrant Search.")
        raise HTTPException(status_code=499, detail="Client Disconnected")
                
    sp_caches = []
    if muzzle_crop is not None: sp_caches.append(muzzle_superpoint_cache)
    if face_muzzle_crop is not None: sp_caches.append(face_muzzle_superpoint_cache)
    
    best_cow_id_overall = None
    best_xgb_score = None
    best_features = None
    best_lg_matches = -1
    best_muzzle_sim = 0.0
    matched_cow_id = None
    matched_cow_name = None
    matched_image_url = None
    matched_crop_b64 = None
    matched_candidate = None
    
    if dynamic_candidates and sp_caches:
        logger.info(f"Deep Pool: Qdrant found {len(dynamic_candidates)}. Handing to Feature Extraction and XGBoost loop.")
        async with glb.gpu_semaphore:
            best_cow_id_overall, best_xgb_score, best_features = await run_biometric_tournament(
                query_mega, query_muzzle, spatial_face_emb, face_emb, muzzle_crop["clahe"] if muzzle_crop else None, dynamic_candidates, sp_caches, fastapi_req=fastapi_req
            )
        
        if await fastapi_req.is_disconnected():
            raise HTTPException(status_code=499, detail="Client Disconnected")
        
        best_lg_matches = best_features.get("lg_matches") if best_features else -1
            
        if best_cow_id_overall:
            matched_candidate = next((c for c in dynamic_candidates if c["cow_id"] == best_cow_id_overall), None)
            if matched_candidate:
                best_muzzle_sim = best_features.get("spatial_muzzle_sim", matched_candidate["similarity"]) if best_features else matched_candidate["similarity"]
                matched_cow_id = matched_candidate["cow_id"]
                matched_cow_name = matched_candidate.get("cow_name")
                matched_image_url = matched_candidate.get("image_url")
                matched_crop_b64 = matched_candidate.get("muzzle_crop_b64")
                
    best_face_sim = 0.0
    f_candidates = []
    face_match = None
    
    if face_emb or spatial_face_emb:
        if matched_cow_id and best_features and best_features.get("spatial_face_sim"):
            best_face_sim = best_features.get("spatial_face_sim")
        else:
            def _sync_db_search_f():
                return glb.db.search(
                    query_mega=face_emb, query_muzzle=None, query_face=spatial_face_emb,
                    user_id=req.user_id, role=req.role, part_type="face",
                    top_k=30, fetch_vectors=True, semantic_filter=clip_semantic_tags,
                )
            f_candidates = await asyncio.to_thread(_sync_db_search_f)
            
            if f_candidates:
                if not isinstance(f_candidates, list): f_candidates = [f_candidates]
                
                if matched_cow_id:
                    face_match = next((c for c in f_candidates if c["cow_id"] == matched_cow_id), None)
                    if face_match:
                        best_face_sim = compute_cosine_similarity(spatial_face_emb, face_match.get("vectors", {}).get("spatial_face")) if spatial_face_emb else face_match["similarity"]
                        if best_features is not None: best_features["spatial_face_sim"] = best_face_sim
                else:
                    best_face_sim = compute_cosine_similarity(spatial_face_emb, f_candidates[0].get("vectors", {}).get("spatial_face")) if spatial_face_emb else f_candidates[0]["similarity"]
                    matched_cow_id = f_candidates[0]["cow_id"]
                    matched_cow_name = f_candidates[0].get("cow_name")
                    matched_image_url = f_candidates[0].get("image_url")
                    matched_crop_b64 = f_candidates[0].get("muzzle_crop_b64")
                    if best_features is not None: best_features["spatial_face_sim"] = best_face_sim

    verdict = evaluate_biometric_match(best_muzzle_sim, best_face_sim, best_lg_matches, best_xgb_score)
    final_confidence = verdict["confidence"]
    def _sync_trad_metrics():
        return compute_traditional_metrics(muzzle_crop, matched_crop_b64)
            
    if muzzle_crop is not None:
        trad_metrics = await asyncio.to_thread(_sync_trad_metrics)
    else:
        trad_metrics = {}
    
    inference_time = (time.time() - start_time) * 1000
    
    muzzle_crop_url = await muzzle_upload_task if muzzle_upload_task else None
    face_crop_url = await face_upload_task if face_upload_task else None
    face_muzzle_crop_url = await face_muzzle_upload_task if face_muzzle_upload_task else None
    
    face_sim_score = face_match.get("similarity") if face_match else (f_candidates[0].get("similarity") if f_candidates else best_face_sim)
    muzzle_sim_score = best_features.get("muzzle_sim") if best_features else (matched_candidate.get("similarity") if matched_candidate else best_muzzle_sim)

    telemetry_data = build_telemetry_payload(
        job_type="search", cow_id=matched_cow_id if matched_cow_id else "Unknown",
        farmer_id=req.user_id, match_status="FOUND" if verdict["match"] else "NOT_FOUND",
        inference_time=inference_time, final_confidence=final_confidence, matched_cow_id=matched_cow_id,
        num_crops=sum(x is not None for x in [muzzle_crop_url, face_crop_url, face_muzzle_crop_url]),
        muzzle_url=req.muzzle_image_url, face_url=req.face_image_url,
        muzzle_crop_b64=muzzle_crop_url, face_crop_b64=face_crop_url,
        muzzle_conf=muzzle_conf, face_conf=face_conf,
        spoof_prob_muzzle=spoof_prob_muzzle, spoof_prob_face=spoof_prob_face, cow_name=matched_cow_name,
        face_similarity_score=face_sim_score, muzzle_similarity_score=muzzle_sim_score,
        verdict=verdict, matched_image_url=matched_image_url, matched_cow_name=matched_cow_name,
        best_lg_matches=best_lg_matches, trad_metrics=trad_metrics,
        best_features=best_features, xgb_score=best_xgb_score
    )
    
    logger.info(f"[Search Fast Fetch] Completed in {int(inference_time)}ms. Verdict: {verdict['match']}")
            
    gc.collect()
    torch.cuda.empty_cache()

    if verdict["match"]:
        return {
            "match": True, "cow_id": matched_cow_id, "distance": 1.0 - final_confidence, "telemetry": telemetry_data
        }
    else:
        return {
            "match": False, "cow_id": None, "reason": verdict.get("user_reason", verdict.get("reason", "N/A")),
            "developer_reason": verdict.get("developer_reason", "N/A"), "telemetry": telemetry_data
        }
