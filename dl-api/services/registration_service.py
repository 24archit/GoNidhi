import time
import asyncio
import traceback
import gc
import cv2
import requests
import torch
from PIL import Image
from fastapi import Request, HTTPException

from core import globals as glb
from core.config import EXPRESS_WEBHOOK_URL
from core.logging_config import logger
from engine.clip_analyzer import CLIP_REJECT_MESSAGES
from services.image_service import download_image, encode_crop, upload_crop_to_cloudinary, delete_image_from_cloudinary, extract_crop_from_b64
from services.webhook_service import send_webhook
from services.fusion_service import compute_cosine_similarity, evaluate_biometric_match
from services.tournament_service import run_biometric_tournament, compute_traditional_metrics
from services.telemetry_builder import build_telemetry_payload


async def process_registration_safe(payload: dict):
    cow_id = payload.get("cow_id")
    if cow_id in glb.in_flight_registrations:
        logger.warning(f"TOCTOU Blocked: Registration for cow {cow_id} is already in flight. Ignoring duplicate request.")
        return
        
    glb.in_flight_registrations.add(cow_id)
    try:
        await process_registration(payload, notify_webhook=True)
    except Exception as e:
        logger.error(f"Error processing async registration: {e}")
    finally:
        glb.in_flight_registrations.discard(cow_id)

async def process_registration(payload: dict, notify_webhook: bool = True, fastapi_req: Request = None) -> dict:
    cow_id = payload.get("cow_id", "unknown")
    upload_tasks = []
    
    try:
        result = await _process_registration_impl(payload, upload_tasks, notify_webhook, fastapi_req)
        return result
    except Exception as worker_err:
        logger.error(f"Registration failed: {traceback.format_exc()}")
        
        # CLEANUP: Delete any Cloudinary crops uploaded in the background
        if upload_tasks:
            async def _cleanup_uploads(tasks):
                for task in tasks:
                    try:
                        url = await task
                        if url: await asyncio.to_thread(delete_image_from_cloudinary, url)
                    except:
                        pass
            asyncio.create_task(_cleanup_uploads(upload_tasks))
                    
        # CRITICAL CLEANUP: Proactively wipe Qdrant
        try:
            await asyncio.to_thread(glb.db.delete_embedding, cow_id)
            logger.info(f"Proactively wiped Qdrant vectors for {cow_id} following pipeline crash.")
        except Exception as qdrant_err:
            logger.error(f"Failed to wipe Qdrant during crash recovery for {cow_id}: {qdrant_err}")

        gc.collect()
        torch.cuda.empty_cache()

        error_msg = "Our AI system encountered an unexpected error while processing your photos. Your photos were likely fine, but our servers hit a hiccup. Please try again shortly!"
        
        if notify_webhook:
            try:
                await send_webhook({
                    "cow_id": cow_id,
                    "status": "failed",
                    "error_message": error_msg
                })
            except Exception as webhook_err:
                logger.error(f"Failed to send registration failure webhook: {webhook_err}")
        raise worker_err

async def _process_registration_impl(payload: dict, upload_tasks: list, notify_webhook: bool = True, fastapi_req: Request = None) -> dict:
    start_time = time.time()
    farmer_id = payload["farmer_id"]
    cow_id = payload["cow_id"]
    cow_name = payload.get("cow_name")
    
    # Initialize variables 
    spoof_prob_muzzle = None
    spoof_prob_face = None
    muzzle_conf = 0.0
    face_conf = 0.0
    muzzle_crop = None
    face_crop = None
    face_muzzle_crop = None
    effective_face_crop = None
    
    muzzle_crop_b64 = None
    face_crop_b64 = None
    is_spoof_muzzle = False
    
    muzzle_url = payload.get("muzzle_image_url")
    face_url = payload.get("face_image_url")
    
    muzzle_emb = None
    face_emb = None
    face_muzzle_emb = None
    spatial_muzzle_emb = None
    spatial_face_emb = None
    spatial_face_muzzle_emb = None
    
    clip_semantic_tags = None
    clip_reject_reason = None
    matched_cow_name = None
    matched_image_url = None
    matched_crop_b64 = None
    matched_cow_id = None
    best_muzzle_sim = 0.0
    best_face_sim = 0.0
    best_xgb_score = None
    best_features = None
    best_lg_matches = -1
    face_match = None
    res_f = None
    matched_candidate = None
    
    muzzle_superpoint_cache = None
    face_muzzle_superpoint_cache = None

    muzzle_upload_task = None
    face_upload_task = None
    face_muzzle_upload_task = None
    
    is_not_a_cow = False
    
    try:
        # Fetch Images
        async def fetch_muzzle():
            if payload.get("muzzle_image_bytes"):
                from services.image_service import extract_crop_from_bytes
                return await asyncio.to_thread(extract_crop_from_bytes, payload.get("muzzle_image_bytes"))
            return await asyncio.to_thread(download_image, muzzle_url) if muzzle_url else None
            
        async def fetch_face():
            if payload.get("face_image_bytes"):
                from services.image_service import extract_crop_from_bytes
                return await asyncio.to_thread(extract_crop_from_bytes, payload.get("face_image_bytes"))
            return await asyncio.to_thread(download_image, face_url) if face_url else None

        muzzle_img, face_img = await asyncio.gather(fetch_muzzle(), fetch_face())
        
        # GPU Inference Wrapper
        def _sync_gpu_pipeline():
            res = {
                "is_not_a_cow": False, "is_spoof_muzzle": False,
                "spoof_prob_muzzle": 0.0, "spoof_prob_face": 0.0,
                "muzzle_crop": None, "face_crop": None, "face_muzzle_crop": None, "face_from_muzzle_crop": None,
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
                    cow_res = glb.dl.are_images_cows([muzzle_img, face_img])
                    _is_cow_muzzle, _cow_prob_m, _ = cow_res[0]
                    _is_cow_face, _cow_prob_f, _ = cow_res[1]
                    
                    _is_not_a_cow = not _is_cow_muzzle or not _is_cow_face
                    _is_spoof_res, _spoof_prob_m, _spoof_prob_f = False, 0.0, 0.0
                    
                    if not _is_not_a_cow:
                        spoof_res = glb.dl.are_images_spoofs([muzzle_img, face_img])
                        _is_spoof_res, _spoof_prob_m = spoof_res[0]
                        _, _spoof_prob_f = spoof_res[1]
                    
                res.update({
                    "is_not_a_cow": _is_not_a_cow,
                    "is_spoof_muzzle": _is_spoof_res,
                    "spoof_prob_muzzle": _spoof_prob_m,
                    "spoof_prob_face": _spoof_prob_f
                })

                if not _is_not_a_cow and not _is_spoof_res:
                    muzzle_crops_and_confs = glb.dl.extract_biometric_batch([muzzle_img, face_img], part_type="muzzle")
                    face_crops_and_confs = glb.dl.extract_biometric_batch([face_img, muzzle_img], part_type="face")
                    
                    _m_crop, _m_conf = muzzle_crops_and_confs[0]
                    _fm_crop, _fm_conf = muzzle_crops_and_confs[1]
                    
                    _f_crop, _f_conf = face_crops_and_confs[0]
                    _ffm_crop, _ffm_conf = face_crops_and_confs[1]

                    res.update({"muzzle_crop": _m_crop, "face_crop": _f_crop, "face_muzzle_crop": _fm_crop, "face_from_muzzle_crop": _ffm_crop, "muzzle_conf": _m_conf, "face_conf": _f_conf, "face_muzzle_conf": _fm_conf})
                    
                    if _f_crop and _ffm_crop:
                        _eff_f_crop = _f_crop if _f_conf >= _ffm_conf else _ffm_crop
                    else:
                        _eff_f_crop = _f_crop or _ffm_crop
                    res["effective_face_crop"] = _eff_f_crop

                    clip_primary = Image.fromarray(cv2.cvtColor(_eff_f_crop["raw"], cv2.COLOR_BGR2RGB)) if _eff_f_crop else None
                    clip_secondary = Image.fromarray(cv2.cvtColor(_m_crop["raw"], cv2.COLOR_BGR2RGB)) if _m_crop else None

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

                    res["spatial_muzzle_emb"] = glb.dl.get_spatial_embeddings(_m_crop["raw"], "muzzle") if _m_crop else None
                    res["spatial_face_emb"] = glb.dl.get_spatial_embeddings(_eff_f_crop["raw"], "face") if _eff_f_crop else None
                    res["spatial_face_muzzle_emb"] = glb.dl.get_spatial_embeddings(_fm_crop["raw"], "muzzle") if _fm_crop else None
                    
                    if _m_crop: res["muzzle_superpoint_cache"] = glb.dl.extract_superpoint_base64(_m_crop["clahe"])
                    if _fm_crop: res["face_muzzle_superpoint_cache"] = glb.dl.extract_superpoint_base64(_fm_crop["clahe"])

            return res

        # Execute GPU inference
        async with glb.gpu_semaphore:
            gpu_res = await asyncio.to_thread(_sync_gpu_pipeline)
        
        is_not_a_cow = gpu_res["is_not_a_cow"]
        is_spoof_muzzle = gpu_res["is_spoof_muzzle"]
        spoof_prob_muzzle = gpu_res["spoof_prob_muzzle"]
        spoof_prob_face = gpu_res["spoof_prob_face"]
        
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

        if is_not_a_cow:
            logger.warning(f"Cow verification failed for {cow_id}.")
        if is_spoof_muzzle:
            logger.warning(f"Spoof detected in muzzle image for cow {cow_id}.")
        if clip_reject_reason:
            logger.warning(f"[CLIP] Registration blocked for {cow_id}: {clip_reject_reason}")
            
        # Dispatch Uploads
        if muzzle_crop is not None:
            muzzle_upload_task = asyncio.create_task(asyncio.to_thread(upload_crop_to_cloudinary, muzzle_crop["clahe"]))
            upload_tasks.append(muzzle_upload_task)

        if effective_face_crop is not None:
            face_upload_task = asyncio.create_task(asyncio.to_thread(upload_crop_to_cloudinary, effective_face_crop["clahe"]))
            upload_tasks.append(face_upload_task)
            
        if face_muzzle_crop is not None:
            face_muzzle_upload_task = asyncio.create_task(asyncio.to_thread(upload_crop_to_cloudinary, face_muzzle_crop["clahe"]))
            upload_tasks.append(face_muzzle_upload_task)
                
    except Exception as e:
        logger.error(f"Image processing error for {cow_id}: {e}")
        raise RuntimeError(f"Internal AI processing error: {str(e)}") from e
        
    match_status = None
    final_confidence = 0.0
    verdict = {"reason": "N/A", "user_reason": "N/A", "developer_reason": "N/A", "muzzle_sim_post_lg": None}
    
    if is_not_a_cow:
        match_status = "NOT_A_COW"
        verdict["user_reason"] = "We couldn't detect a cow. Please ensure the cow is clearly visible and the photos are well-lit before trying again."
        verdict["developer_reason"] = "YOLO confidence < 0.20 for cow detection."
        
    elif is_spoof_muzzle:
        match_status = "SPOOF_DETECTED_MUZZLE"
        verdict["user_reason"] = "The muzzle photo appears to be a picture of a screen or paper. Please capture a live photo directly from the cow."
        verdict["developer_reason"] = "Anti-Spoofing model detected presentation attack."

    elif clip_reject_reason:
        match_status = clip_reject_reason
        verdict["user_reason"] = CLIP_REJECT_MESSAGES.get(clip_reject_reason, "Image quality check failed. Please retake the photo.")
        verdict["developer_reason"] = f"CLIP QA gate rejected: {clip_reject_reason}"
        
    elif muzzle_emb is None and face_emb is None:
        match_status = "NO_BIOMETRICS_DETECTED"
        verdict["user_reason"] = "We couldn't detect the face or muzzle. Please retake the photos close-up, ensuring the cow's face is fully in the frame."
        verdict["developer_reason"] = "Both Face and Muzzle detections failed."
        
    elif muzzle_emb is None:
        match_status = "NO_MUZZLE_DETECTED"
        verdict["user_reason"] = "The muzzle is not clearly visible. Please wipe the muzzle clean and retake a sharp, close-up photo."
        verdict["developer_reason"] = "Muzzle detection failed."

    elif face_emb is None:
        match_status = "NO_FACE_DETECTED"
        verdict["user_reason"] = "We couldn't detect the cow's face from either photo. Please retake both photos ensuring the cow's face is fully visible."
        verdict["developer_reason"] = "Face YOLO detection failed on both the face and muzzle source images; no face crop available for MegaDescriptor."

    if match_status is None:
        # Resolve network I/O before acquiring the global database lock to prevent resource starvation.
        muzzle_crop_url = await muzzle_upload_task if muzzle_upload_task else None
        face_crop_url = await face_upload_task if face_upload_task else None
        face_muzzle_crop_url = await face_muzzle_upload_task if face_muzzle_upload_task else None

        async with glb.db_registration_lock:
            m_candidates_dict = {}
            query_mega = muzzle_emb or face_muzzle_emb
            query_muzzle = spatial_muzzle_emb or spatial_face_muzzle_emb
            
            if query_mega or query_muzzle or face_emb or spatial_face_emb:
                # Sync db.search offloaded to thread
                def _sync_db_search():
                    return glb.db.search(
                        query_mega=query_mega, query_muzzle=query_muzzle,
                        query_face=spatial_face_emb, query_mega_face=face_emb,
                        user_id=None, role="admin", part_type=None,
                        top_k=30, cohort_limit=100, fetch_vectors=True,
                        semantic_filter=clip_semantic_tags,
                    )
                m_candidates = await asyncio.to_thread(_sync_db_search)
                
                if m_candidates and isinstance(m_candidates, list):
                    for c in m_candidates:
                        m_candidates_dict[c["cow_id"]] = c

            dynamic_candidates = list(m_candidates_dict.values())
            
            if dynamic_candidates:
                logger.info(f"Deep Pool: Qdrant found {len(dynamic_candidates)}. Handing suspects to LightGlue.")
                
                sp_caches = []
                if muzzle_crop is not None: sp_caches.append(muzzle_superpoint_cache)
                if face_muzzle_crop is not None: sp_caches.append(face_muzzle_superpoint_cache)
                
                async with glb.gpu_semaphore:
                    best_cow_id_overall, best_xgb_score, best_features = await run_biometric_tournament(
                        query_mega, query_muzzle, spatial_face_emb, face_emb, muzzle_crop["clahe"] if muzzle_crop else None, dynamic_candidates, sp_caches, fastapi_req=fastapi_req
                    )
                
                best_lg_matches = best_features.get("lg_matches") if best_features else -1
                
                if best_cow_id_overall:
                    matched_candidate = next((c for c in dynamic_candidates if c["cow_id"] == best_cow_id_overall), None)
                    if matched_candidate:
                        best_muzzle_sim = best_features.get("spatial_muzzle_sim", matched_candidate["similarity"]) if best_features else matched_candidate["similarity"]
                        matched_cow_id = matched_candidate["cow_id"]
                        matched_cow_name = matched_candidate.get("cow_name")
                        matched_image_url = matched_candidate.get("image_url")
                        matched_crop_b64 = matched_candidate.get("muzzle_crop_b64")
                    
            if face_emb or spatial_face_emb:
                if matched_cow_id and best_features and best_features.get("spatial_face_sim"):
                    best_face_sim = best_features.get("spatial_face_sim")
                else:
                    def _sync_face_search():
                        return glb.db.search(query_mega=face_emb, query_muzzle=None, query_face=spatial_face_emb, user_id=None, role="admin", part_type="face", top_k=1, fetch_vectors=True)
                    res_f = await asyncio.to_thread(_sync_face_search)
                    
                    if res_f and res_f.get("found"): 
                        face_match = res_f if isinstance(res_f, dict) and "vectors" in res_f else None
                        if face_match:
                            best_face_sim = compute_cosine_similarity(spatial_face_emb, face_match.get("vectors", {}).get("spatial_face")) if spatial_face_emb else face_match["similarity"]
                            if best_features is not None: best_features["spatial_face_sim"] = best_face_sim
                        else:
                            best_face_sim = compute_cosine_similarity(spatial_face_emb, res_f.get("vectors", {}).get("spatial_face")) if spatial_face_emb else res_f["similarity"]
                            if best_features is not None: best_features["spatial_face_sim"] = best_face_sim
                            
                        if not matched_cow_id: 
                            matched_cow_id = res_f["cow_id"]
                            matched_cow_name = res_f.get("cow_name")
                            matched_image_url = res_f.get("image_url")
                            matched_crop_b64 = res_f.get("muzzle_crop_b64")
            
            verdict = evaluate_biometric_match(best_muzzle_sim, best_face_sim, best_lg_matches, best_xgb_score)
            final_confidence = verdict["confidence"]
            
            logger.info(f"Most similar match found during registration check: {matched_cow_id} with similarity face={best_face_sim}, muzzle={best_muzzle_sim}")
            if verdict["match"]:
                match_status = "DUPLICATE"
                logger.info(f"Registration rejected. Is a duplicate of {matched_cow_id} ({verdict.get('developer_reason')})")
            else:
                match_status = "SUCCESS"

                try:
                    def _sync_insert():
                        import concurrent.futures
                        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
                            futures = []
                            if muzzle_emb or spatial_muzzle_emb:
                                muzzle_crop_b64_enc = encode_crop(muzzle_crop["clahe"]) if muzzle_crop else None
                                futures.append(executor.submit(
                                    glb.db.add_embedding,
                                    {"megadescriptor": muzzle_emb, "spatial_muzzle": spatial_muzzle_emb},
                                    cow_id, farmer_id, "muzzle",
                                    cow_name, muzzle_url,
                                    muzzle_crop_url, muzzle_crop_b64_enc,
                                    muzzle_superpoint_cache, clip_semantic_tags
                                ))
                            if face_muzzle_emb or spatial_face_muzzle_emb:
                                face_muzzle_crop_b64_enc = encode_crop(face_muzzle_crop["clahe"]) if face_muzzle_crop else None
                                futures.append(executor.submit(
                                    glb.db.add_embedding,
                                    {"megadescriptor": face_muzzle_emb, "spatial_muzzle": spatial_face_muzzle_emb},
                                    cow_id, farmer_id, "face_muzzle",
                                    cow_name, face_url,
                                    face_muzzle_crop_url, face_muzzle_crop_b64_enc,
                                    face_muzzle_superpoint_cache, clip_semantic_tags
                                ))
                            if face_emb or spatial_face_emb:
                                face_source_url = face_url if face_crop is not None else muzzle_url
                                futures.append(executor.submit(
                                    glb.db.add_embedding,
                                    {"megadescriptor": face_emb, "spatial_face": spatial_face_emb},
                                    cow_id, farmer_id, "face",
                                    cow_name, face_source_url,
                                    face_crop_url, None,
                                    None, clip_semantic_tags
                                ))
                            for f in concurrent.futures.as_completed(futures):
                                f.result()
                    await asyncio.to_thread(_sync_insert)
                    logger.info(f"Successfully registered new cow {cow_id}. Not a duplicate.")
                except Exception as insertion_error:
                    logger.error(f"Failed during vector insertion for cow {cow_id}. Rolling back: {insertion_error}")
                    try:
                        await asyncio.to_thread(glb.db.delete_embedding, cow_id)
                    except Exception as rollback_err:
                        logger.error(f"CRITICAL: Failed to rollback partial Qdrant insertion for cow {cow_id}: {rollback_err}")
                    raise RuntimeError(f"Database insertion failed mid-process. System rollback complete. Error: {insertion_error}")

    inference_time = (time.time() - start_time) * 1000
    
    def _sync_trad_metrics():
        return compute_traditional_metrics(muzzle_crop, matched_crop_b64)
            
    if muzzle_crop is not None:
        trad_metrics = await asyncio.to_thread(_sync_trad_metrics)
    else:
        trad_metrics = {}
    
    # If match_status is DUPLICATE, await uploads for telemetry
    if match_status != "SUCCESS":
        muzzle_crop_url = await muzzle_upload_task if muzzle_upload_task else None
        face_crop_url = await face_upload_task if face_upload_task else None
        face_muzzle_crop_url = await face_muzzle_upload_task if face_muzzle_upload_task else None

    num_crops = sum(x is not None for x in [muzzle_crop_url, face_crop_url, face_muzzle_crop_url])
    
    face_sim_score = face_match.get("similarity") if face_match else (res_f.get("similarity") if res_f and isinstance(res_f, dict) else best_face_sim)
    muzzle_sim_score = best_features.get("muzzle_sim") if best_features else (matched_candidate.get("similarity") if matched_candidate else best_muzzle_sim)

    telemetry_data = build_telemetry_payload(
        job_type="registration", cow_id=cow_id, farmer_id=farmer_id, match_status=match_status,
        inference_time=inference_time, final_confidence=final_confidence, matched_cow_id=matched_cow_id,
        num_crops=num_crops, muzzle_url=muzzle_url, face_url=face_url,
        muzzle_crop_b64=muzzle_crop_url, face_crop_b64=face_crop_url,
        muzzle_conf=muzzle_conf, face_conf=face_conf,
        spoof_prob_muzzle=spoof_prob_muzzle, spoof_prob_face=spoof_prob_face,
        cow_name=cow_name, face_similarity_score=face_sim_score, muzzle_similarity_score=muzzle_sim_score,
        verdict=verdict, matched_image_url=matched_image_url, matched_cow_name=matched_cow_name,
        best_lg_matches=best_lg_matches, trad_metrics=trad_metrics,
        best_features=best_features, xgb_score=verdict.get("xgb_raw") if verdict else None,
        semantic_tags=clip_semantic_tags
    )

    result = {
        "cow_id": cow_id, "farmer_id": farmer_id, "status": match_status,
        "matched_cow_id": matched_cow_id, "error_message": verdict.get("user_reason", "N/A"),
        "telemetry": telemetry_data
    }

    if notify_webhook:
        try:
            success = await send_webhook(result)
            if not success:
                logger.warning(f"Webhook returned False for cow {cow_id}. Proceeding since polling will catch it.")
        except Exception as webhook_err:
            logger.error(f"Unexpected webhook error: {webhook_err}")

    logger.info(f"Finished processing job for cow {cow_id}. Result: {match_status} (took {int(inference_time)}ms)")
    gc.collect()
    torch.cuda.empty_cache()
    return result
