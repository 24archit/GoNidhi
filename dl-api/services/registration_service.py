import time
import asyncio
import traceback
import gc
import requests
from fastapi import Request, HTTPException

from core import globals as glb
from core.config import EXPRESS_WEBHOOK_URL
from services.image_service import download_image, encode_crop, upload_crop_to_cloudinary, delete_image_from_cloudinary
from services.webhook_service import send_webhook
from services.fusion_service import compute_cosine_similarity, evaluate_biometric_match
from services.tournament_service import run_biometric_tournament, compute_traditional_metrics
from services.telemetry_builder import build_telemetry_payload


async def process_registration_safe(payload: dict):
    if glb.gpu_queue_size >= 5:
        try:
            requests.post(EXPRESS_WEBHOOK_URL, json={
                "cow_id": payload["cow_id"],
                "status": "failed",
                "error_message": "The AI servers are currently at maximum capacity. Please try again later."
            }, timeout=10)
        except Exception as e:
            print(f"Failed to send capacity error webhook: {e}")
        return

    glb.gpu_queue_size += 1
    try:
        await process_registration(payload, notify_webhook=True)
    except Exception as e:
        print(f"Error processing async registration: {e}")
    finally:
        glb.gpu_queue_size -= 1

async def process_registration(payload: dict, notify_webhook: bool = True, fastapi_req: Request = None) -> dict:
    cow_id = payload.get("cow_id", "unknown")
    upload_tasks = []
    
    try:
        result = await _process_registration_impl(payload, upload_tasks, notify_webhook, fastapi_req)
        return result
    except Exception as worker_err:
        traceback.print_exc()
        
        # CLEANUP: If the pipeline crashed, ensure we delete any Cloudinary crops we just uploaded.
        for task in upload_tasks:
            try:
                url = await task
                if url: delete_image_from_cloudinary(url)
            except:
                pass
                    
        # CRITICAL CLEANUP: Proactively wipe Qdrant to prevent ghost vectors if the pipeline crashed post-insertion
        try:
            glb.db.delete_embedding(cow_id)
            print(f"Proactively wiped Qdrant vectors for {cow_id} following pipeline crash.")
        except Exception as qdrant_err:
            print(f"Failed to wipe Qdrant during crash recovery for {cow_id}: {qdrant_err}")

        error_msg = "Our AI system encountered an unexpected error while processing your photos. Your photos were likely fine, but our servers hit a hiccup. Please try again shortly!"
        
        if notify_webhook:
            try:
                send_webhook({
                    "cow_id": cow_id,
                    "status": "failed",
                    "error_message": error_msg
                })
            except Exception as webhook_err:
                print(f"Failed to send registration failure webhook: {webhook_err}")
        raise worker_err

async def _process_registration_impl(payload: dict, upload_tasks: list, notify_webhook: bool = True, fastapi_req: Request = None) -> dict:
    start_time = time.time()
    farmer_id = payload["farmer_id"]
    cow_id = payload["cow_id"]
    cow_name = payload.get("cow_name")
    
    spoof_prob_muzzle = None
    spoof_prob_face = None
    muzzle_conf = None
    face_conf = None
    muzzle_crop_b64 = None
    face_crop_b64 = None
    is_spoof_muzzle = False
    
    muzzle_url = payload.get("muzzle_image_url")
    face_url = payload.get("face_image_url")
    
    muzzle_emb = None
    face_emb = None
    
    is_not_a_cow = False
    
    try:
        muzzle_img = download_image(muzzle_url)
        face_img = download_image(face_url)
        
        is_cow_muzzle, cow_prob_m, _ = glb.dl.is_image_a_cow(muzzle_img)
        is_cow_face, cow_prob_f, _ = glb.dl.is_image_a_cow(face_img)
        
        if not is_cow_muzzle or not is_cow_face:
            is_not_a_cow = True
            print(f"Cow verification failed for {cow_id}. Muzzle: {is_cow_muzzle} ({cow_prob_m:.2f}), Face: {is_cow_face} ({cow_prob_f:.2f})")
        else:
            is_spoof_res, spoof_prob_muzzle = glb.dl.is_spoof(muzzle_img)
            _, spoof_prob_face = glb.dl.is_spoof(face_img)
            if is_spoof_res:
                is_spoof_muzzle = True
                print(f"Spoof detected in muzzle image for cow {cow_id}.")
            
        if not is_spoof_muzzle:
            with glb.gpu_lock:
                muzzle_crop, muzzle_conf = glb.dl.extract_biometric(muzzle_img, part_type="muzzle")
                face_crop, face_conf = glb.dl.extract_biometric(face_img, part_type="face")
                face_muzzle_crop, face_muzzle_conf = glb.dl.extract_biometric(face_img, part_type="muzzle")
                
                muzzle_emb = glb.dl.get_embeddings_batch([muzzle_crop["clahe"]])[0] if muzzle_crop else None
                face_emb = glb.dl.get_embeddings_batch([face_crop["clahe"]])[0] if face_crop else None
                face_muzzle_emb = glb.dl.get_embeddings_batch([face_muzzle_crop["clahe"]])[0] if face_muzzle_crop else None
                
                spatial_muzzle_emb = glb.dl.get_spatial_embeddings(muzzle_crop["raw"], "muzzle") if muzzle_crop else None
                spatial_face_emb = glb.dl.get_spatial_embeddings(face_crop["raw"], "face") if face_crop else None
                spatial_face_muzzle_emb = glb.dl.get_spatial_embeddings(face_muzzle_crop["raw"], "muzzle") if face_muzzle_crop else None

            muzzle_upload_task = None
            face_upload_task = None
            face_muzzle_upload_task = None

            if muzzle_crop is not None:
                muzzle_upload_task = asyncio.create_task(asyncio.to_thread(upload_crop_to_cloudinary, muzzle_crop["clahe"]))
                upload_tasks.append(muzzle_upload_task)
                muzzle_superpoint_cache = glb.dl.extract_superpoint_base64(muzzle_crop["clahe"])
                
            if face_crop is not None:
                face_upload_task = asyncio.create_task(asyncio.to_thread(upload_crop_to_cloudinary, face_crop["clahe"]))
                upload_tasks.append(face_upload_task)
                
            face_muzzle_superpoint_cache = None
            if face_muzzle_crop is not None:
                face_muzzle_upload_task = asyncio.create_task(asyncio.to_thread(upload_crop_to_cloudinary, face_muzzle_crop["clahe"]))
                upload_tasks.append(face_muzzle_upload_task)
                face_muzzle_superpoint_cache = glb.dl.extract_superpoint_base64(face_muzzle_crop["clahe"])
                
    except Exception as e:
        print(f"Image processing error for {cow_id}: {e}")
        raise RuntimeError(f"Internal AI processing error: {str(e)}") from e
        
    matched_cow_id = None
    best_muzzle_sim = 0.0
    best_face_sim = 0.0
    best_xgb_score = None
    
    match_status = None
    final_confidence = 0.0
    verdict = {"reason": "N/A", "user_reason": "N/A", "developer_reason": "N/A", "muzzle_sim_post_lg": None}
    
    if is_not_a_cow:
        match_status = "NOT_A_COW"
        final_confidence = 0.0
        verdict["user_reason"] = "We couldn't detect a cow. Please ensure the cow is clearly visible and the photos are well-lit before trying again."
        verdict["developer_reason"] = "YOLO confidence < 0.20 for cow detection."
        
    elif is_spoof_muzzle:
        match_status = "SPOOF_DETECTED_MUZZLE"
        final_confidence = 0.0
        verdict["user_reason"] = "The muzzle photo appears to be a picture of a screen or paper. Please capture a live photo directly from the cow."
        verdict["developer_reason"] = "Anti-Spoofing model detected presentation attack."
        
    elif muzzle_emb is None and face_emb is None:
        match_status = "NO_BIOMETRICS_DETECTED"
        final_confidence = 0.0
        verdict["user_reason"] = "We couldn't detect the face or muzzle. Please retake the photos close-up, ensuring the cow's face is fully in the frame."
        verdict["developer_reason"] = "Both Face and Muzzle detections failed."
        print(f"Both Face and Muzzle detection failed for cow {cow_id}.")
        
    elif muzzle_emb is None:
        match_status = "NO_MUZZLE_DETECTED"
        final_confidence = 0.0
        verdict["user_reason"] = "The muzzle is not clearly visible. Please wipe the muzzle clean and retake a sharp, close-up photo."
        verdict["developer_reason"] = "Muzzle detection failed."
        print(f"Muzzle detection failed for cow {cow_id}.")

    elif face_emb is None:
        match_status = "NO_FACE_DETECTED"
        final_confidence = 0.0
        verdict["user_reason"] = "The face is not clearly visible. Please retake the face photo ensuring both eyes and horns (if any) are in the frame."
        verdict["developer_reason"] = "Face detection failed."
        print(f"Face detection failed for cow {cow_id}.")
        
    matched_cow_name = None
    matched_image_url = None

    best_lg_matches = -1

    if match_status not in ["NOT_A_COW", "SPOOF_DETECTED_MUZZLE", "NO_BIOMETRICS_DETECTED", "NO_MUZZLE_DETECTED", "NO_FACE_DETECTED"]:
        m_candidates_dict = {}
        query_mega = muzzle_emb or face_muzzle_emb
        query_muzzle = spatial_muzzle_emb or spatial_face_muzzle_emb
        
        if query_mega or query_muzzle or face_emb or spatial_face_emb:
            m_candidates = glb.db.search(
                query_mega=query_mega,
                query_muzzle=query_muzzle,
                query_face=spatial_face_emb,
                query_mega_face=face_emb,
                user_id=None, role="admin", part_type=None, top_k=25, cohort_limit=100, fetch_vectors=True
            )
            if m_candidates and isinstance(m_candidates, list):
                for c in m_candidates:
                    m_candidates_dict[c["cow_id"]] = c

        dynamic_candidates = list(m_candidates_dict.values())
        
        if dynamic_candidates:
            print(f"Deep Pool: Qdrant found {len(dynamic_candidates)}. Handing suspects to LightGlue.")
            
            sp_caches = []
            if muzzle_crop is not None: sp_caches.append(muzzle_superpoint_cache)
            if face_muzzle_crop is not None: sp_caches.append(face_muzzle_superpoint_cache)
            
            best_cow_id_overall, best_xgb_score, best_features = await run_biometric_tournament(
                query_mega, query_muzzle, spatial_face_emb, face_emb, muzzle_crop["clahe"] if muzzle_crop else None, dynamic_candidates, sp_caches, fastapi_req=fastapi_req
            )
            
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
                res_f = glb.db.search(query_mega=face_emb, query_muzzle=None, query_face=spatial_face_emb, user_id=None, role="admin", part_type="face", top_k=1, fetch_vectors=True)
                if res_f.get("found"): 
                    face_match = res_f if isinstance(res_f, dict) and "vectors" in res_f else None
                    if face_match:
                        best_face_sim = compute_cosine_similarity(spatial_face_emb, face_match.get("vectors", {}).get("spatial_face")) if spatial_face_emb else face_match["similarity"]
                        if 'best_features' in locals() and best_features is not None:
                            best_features["spatial_face_sim"] = best_face_sim
                    else:
                        best_face_sim = compute_cosine_similarity(spatial_face_emb, res_f.get("vectors", {}).get("spatial_face")) if spatial_face_emb else res_f["similarity"]
                        if 'best_features' in locals() and best_features is not None:
                            best_features["spatial_face_sim"] = best_face_sim
                    if not matched_cow_id: 
                        matched_cow_id = res_f["cow_id"]
                        matched_cow_name = res_f.get("cow_name")
                        matched_image_url = res_f.get("image_url")
        
        verdict = evaluate_biometric_match(best_muzzle_sim, best_face_sim, best_lg_matches, best_xgb_score)
        final_confidence = verdict["confidence"]
        
        print(f"Most similar match found during registration check: {matched_cow_id} with similarity face={best_face_sim}, muzzle={best_muzzle_sim}")
        if verdict["match"]:
            match_status = "DUPLICATE"
            print(f"Registration rejected. Is a duplicate of {matched_cow_id} ({verdict.get('developer_reason', verdict.get('reason'))})")
        else:
            match_status = "SUCCESS"
            
            # Wait for crop uploads to finish so we can store the crop_url in Qdrant
            muzzle_crop_url = await muzzle_upload_task if 'muzzle_upload_task' in locals() and muzzle_upload_task else None
            face_crop_url = await face_upload_task if 'face_upload_task' in locals() and face_upload_task else None
            face_muzzle_crop_url = await face_muzzle_upload_task if 'face_muzzle_upload_task' in locals() and face_muzzle_upload_task else None

            try:
                if muzzle_emb or spatial_muzzle_emb: 
                    glb.db.add_embedding({"megadescriptor": muzzle_emb, "spatial_muzzle": spatial_muzzle_emb}, cow_id, farmer_id, source="muzzle", cow_name=cow_name, image_url=muzzle_url, crop_url=muzzle_crop_url, superpoint_cache=muzzle_superpoint_cache)
                if face_muzzle_emb or spatial_face_muzzle_emb:
                    glb.db.add_embedding({"megadescriptor": face_muzzle_emb, "spatial_muzzle": spatial_face_muzzle_emb}, cow_id, farmer_id, source="face_muzzle", cow_name=cow_name, image_url=face_url, crop_url=face_muzzle_crop_url, superpoint_cache=face_muzzle_superpoint_cache)
                if face_emb or spatial_face_emb: 
                    glb.db.add_embedding({"megadescriptor": face_emb, "spatial_face": spatial_face_emb}, cow_id, farmer_id, source="face", cow_name=cow_name, image_url=face_url, crop_url=face_crop_url)
                print(f"Successfully registered new cow {cow_id}. Not a duplicate.")
            except Exception as insertion_error:
                print(f"Failed during vector insertion for cow {cow_id}. Rolling back: {insertion_error}")
                try:
                    glb.db.delete_embedding(cow_id)
                except Exception as rollback_err:
                    print(f"CRITICAL: Failed to rollback partial Qdrant insertion for cow {cow_id}: {rollback_err}")
                raise RuntimeError(f"Database insertion failed mid-process. System rollback complete. Error: {insertion_error}")

    inference_time = (time.time() - start_time) * 1000
    
    trad_metrics = compute_traditional_metrics(muzzle_crop, matched_image_url) if 'muzzle_crop' in locals() else {}
    
    # If match_status is DUPLICATE, the uploads are awaited here to ensure cleanup or telemetry gets the URLs.
    if match_status != "SUCCESS":
        muzzle_crop_url = await muzzle_upload_task if 'muzzle_upload_task' in locals() and muzzle_upload_task else None
        face_crop_url = await face_upload_task if 'face_upload_task' in locals() and face_upload_task else None
        face_muzzle_crop_url = await face_muzzle_upload_task if 'face_muzzle_upload_task' in locals() and face_muzzle_upload_task else None

    num_crops = sum(x is not None for x in [muzzle_crop_url, face_crop_url, face_muzzle_crop_url])
    
    face_sim_score = face_match.get("similarity") if 'face_match' in locals() and face_match else (res_f.get("similarity") if 'res_f' in locals() and isinstance(res_f, dict) else best_face_sim)
    muzzle_sim_score = best_features.get("muzzle_sim") if 'best_features' in locals() and best_features else (matched_candidate.get("similarity") if 'matched_candidate' in locals() and matched_candidate else best_muzzle_sim)

    telemetry_data = build_telemetry_payload(
        job_type="registration",
        cow_id=cow_id,
        farmer_id=farmer_id,
        match_status=match_status,
        inference_time=inference_time,
        final_confidence=final_confidence,
        matched_cow_id=matched_cow_id,
        num_crops=num_crops,
        muzzle_url=muzzle_url,
        face_url=face_url,
        muzzle_crop_b64=muzzle_crop_url,
        face_crop_b64=face_crop_url,
        muzzle_conf=muzzle_conf,
        face_conf=face_conf,
        spoof_prob_muzzle=spoof_prob_muzzle,
        spoof_prob_face=spoof_prob_face,
        cow_name=cow_name,
        face_similarity_score=face_sim_score,
        muzzle_similarity_score=muzzle_sim_score,
        verdict=verdict,
        matched_image_url=matched_image_url,
        matched_cow_name=matched_cow_name,
        best_lg_matches=best_lg_matches,
        trad_metrics=trad_metrics,
        best_features=best_features if 'best_features' in locals() else None,
        xgb_score=verdict.get("xgb_raw") if verdict else None
    )

    result = {
        "cow_id": cow_id,
        "farmer_id": farmer_id,
        "status": match_status,
        "matched_cow_id": matched_cow_id,
        "error_message": verdict.get("user_reason", "N/A"),
        "telemetry": telemetry_data
    }

    if notify_webhook:
        try:
            success = send_webhook({
                "cow_id": cow_id,
                "farmer_id": farmer_id,
                "status": match_status,
                "matched_cow_id": matched_cow_id,
                "error_message": verdict.get("user_reason", "N/A"),
                "telemetry": telemetry_data
            })
            if not success:
                print(f"Webhook returned False for cow {cow_id}. Proceeding since polling will catch it.")
        except Exception as webhook_err:
            print(f"Unexpected webhook error: {webhook_err}")

    print(f"Finished processing job for cow {cow_id}. Result: {match_status} (took {int(inference_time)}ms)")
    gc.collect()
    return result
