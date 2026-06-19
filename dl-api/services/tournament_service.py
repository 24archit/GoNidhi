import asyncio
import numpy as np
import pandas as pd
from fastapi import Request

from core import globals as glb
from services.image_service import extract_crop_from_b64
from engine.traditional_features import get_texture_features, get_morphology_features
from services.fusion_service import compute_cosine_similarity

async def run_biometric_tournament(query_mega, query_muzzle, query_face, query_mega_face, query_crop: np.ndarray, candidates: list, live_sp_caches: list, fastapi_req: Request = None):
    if not candidates:
        print("⚠️ Tournament aborted: Zero database candidates provided.")
        return None, 0.0, {}

    if glb.xgb_model is None:
        print("XGBoost model is None, skipping candidate scoring.")
        return None, None, None
        
    live_feats_list = glb.dl.parse_live_feats(live_sp_caches) if live_sp_caches else []
    
    q_lbp, q_hog = None, None
    if query_crop is not None:
        try:
            q_lbp, q_hog = get_texture_features(query_crop)
        except Exception:
            pass

    best_xgb_score = -1.0
    best_candidate_id = None
    best_features = None

    tournament_features = []

    print(f"\n--- 🏆 STARTING BIOMETRIC TOURNAMENT ({len(candidates)} Candidates) ---")
    for cand in candidates:
        if fastapi_req and await fastapi_req.is_disconnected():
            print("⚠️ Client disconnected mid-tournament! Aborting loop.")
            return None, None, None
            
        await asyncio.sleep(0) # yield to event loop
        cow_id = cand["cow_id"]
        c_vectors = cand.get("vectors", {})
        c_part = cand.get("part", "muzzle")
        c_mega = c_vectors.get("megadescriptor") if c_part in ["muzzle", "face_muzzle"] else c_vectors.get("megadescriptor")
        c_muzzle = c_vectors.get("spatial_muzzle")
        c_face = c_vectors.get("spatial_face")
        c_mega_face = c_vectors.get("megadescriptor") if c_part == "face" else None
        
        mega_sim = compute_cosine_similarity(query_mega, c_mega)
        spatial_muzzle_sim = compute_cosine_similarity(query_muzzle, c_muzzle)
        spatial_face_sim = compute_cosine_similarity(query_face, c_face)
        mega_face_sim = compute_cosine_similarity(query_mega_face, c_mega_face)

        cand_crop_b64 = cand.get("muzzle_crop_b64")
        cand_crop = extract_crop_from_b64(cand_crop_b64)

        lg_metrics = glb.dl.get_lightglue_metrics_from_cache(live_feats_list, cand.get("superpoint_cache"), query_crop, cand_crop)
        lg_matches = lg_metrics.get("lg_matches", -1)
        trad_inlier_ratio = lg_metrics.get("inlier_ratio", 0.0)
        trad_aligned_ssim = lg_metrics.get("aligned_ssim", 0.0)

        print(f"  [Candidate: {cow_id}] LightGlue Ridges: {lg_matches} (Muzzle Sim: {mega_sim*100:.1f}%)")

        trad_lbp_dist = 1.0
        trad_hog_dist = 1.0
        
        if cand_crop is not None and query_crop is not None:
            try:
                if q_lbp is not None and q_hog is not None:
                    m_lbp, m_hog = get_texture_features(cand_crop)
                    trad_lbp_dist = float(np.linalg.norm(q_lbp - m_lbp))
                    trad_hog_dist = float(np.linalg.norm(q_hog - m_hog))
            except Exception as e:
                print(f"Error getting candidate texture feats: {e}")
                
        feature_row = {
            "cow_id": cow_id,
            "muzzle_sim": mega_sim,
            "lg_matches": lg_matches,
            "trad_lbp_dist": trad_lbp_dist,
            "trad_hog_dist": trad_hog_dist,
            "trad_aligned_ssim": trad_aligned_ssim,
            "trad_inlier_ratio": trad_inlier_ratio,
            "spatial_muzzle_sim": spatial_muzzle_sim,
            "spatial_face_sim": spatial_face_sim,
            "mega_face_sim": mega_face_sim
        }
        
        print(f"      Features Extracted -> LBP: {trad_lbp_dist:.4f}, HOG: {trad_hog_dist:.4f}, Inlier: {trad_inlier_ratio:.4f}, SSIM: {trad_aligned_ssim:.4f}")
        tournament_features.append(feature_row)

    if not tournament_features:
        return None, None, None

    df_batch = pd.DataFrame(tournament_features)
    if hasattr(glb.xgb_model, 'feature_names_in_'):
        feature_cols = glb.xgb_model.feature_names_in_
    else:
        feature_cols = ['muzzle_sim', 'lg_matches', 'trad_lbp_dist', 'trad_hog_dist', 'trad_aligned_ssim', 'trad_inlier_ratio']
        
    for col in feature_cols:
        if col not in df_batch.columns:
            df_batch[col] = 0.0
            
    X_batch = df_batch[list(feature_cols)]
    
    try:
        y_probs = glb.xgb_model.predict_proba(X_batch)[:, 1]
    except Exception as e:
        y_probs = np.zeros(len(tournament_features))
        
    best_idx = int(np.argmax(y_probs))
    best_xgb_score = float(y_probs[best_idx])
    best_candidate_id = tournament_features[best_idx]["cow_id"]
    best_features = tournament_features[best_idx]

    print(f"--- 🏁 TOURNAMENT END: Winner {best_candidate_id} with XGBoost {best_xgb_score:.5f} ---\n")
    return best_candidate_id, best_xgb_score, best_features


def compute_traditional_metrics(query_crop_dict, matched_crop_b64):
    results = {
        "trad_morphology": None,
        "trad_lbp_dist": None,
        "trad_hog_dist": None,
        "trad_inlier_ratio": None,
        "trad_aligned_ssim": None
    }
    if not query_crop_dict or "clahe" not in query_crop_dict:
        return results

    query_crop = query_crop_dict["clahe"]
    
    try:
        results["trad_morphology"] = get_morphology_features(query_crop)
    except Exception as e:
        print(f"Morphology error: {e}")

    if not matched_crop_b64:
        return results
        
    try:
        matched_crop = extract_crop_from_b64(matched_crop_b64)
        if matched_crop is not None:
            q_lbp, q_hog = get_texture_features(query_crop)
            m_lbp, m_hog = get_texture_features(matched_crop)
            
            results["trad_lbp_dist"] = float(np.linalg.norm(q_lbp - m_lbp))
            results["trad_hog_dist"] = float(np.linalg.norm(q_hog - m_hog))
            
            lg_geom_feats = glb.dl.get_lightglue_geometric_features(query_crop, matched_crop)
            results["trad_inlier_ratio"] = lg_geom_feats.get("inlier_ratio")
            results["trad_aligned_ssim"] = lg_geom_feats.get("aligned_ssim")
            
    except Exception as e:
        print(f"Error computing traditional metrics against matched candidate: {e}")
        
    return results
