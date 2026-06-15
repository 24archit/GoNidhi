import os
import uuid
import numpy as np
from typing import List, Dict, Any
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue, MatchAny, SearchRequest
from collections import defaultdict

class CattleVectorStore:
    def __init__(self, qdrant_url: str, qdrant_api_key: str, vector_size: int = 1536):
        self.client = QdrantClient(url=qdrant_url, api_key=qdrant_api_key)
        self.vector_size = vector_size
        self.collection_name = "cattle_vectors_spatial"
        self._init_collection()
        

    def _init_collection(self):
        try:
            if not self.client.collection_exists(self.collection_name):
                print(f"Collection '{self.collection_name}' not found. Initializing new collection...")
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config={
                        "megadescriptor": VectorParams(size=self.vector_size, distance=Distance.COSINE),
                        "spatial_muzzle": VectorParams(size=1280, distance=Distance.COSINE),
                        "spatial_face": VectorParams(size=1280, distance=Distance.COSINE)
                    }
                )
            else:
                print("Vector database collection found and ready.")
            
            # Qdrant strictly requires payload indexes for fields used in query_filter
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="part",
                field_schema="keyword",
            )
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="cow_id",
                field_schema="keyword",
            )
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="farmer_id",
                field_schema="keyword",
            )
        except Exception as e:
            print(f"Warning: Error initializing collection or indexes: {e}")

    def add_embedding(self, embeddings: Dict[str, List[float]], cow_id: str, farmer_id: str, source: str, cow_name: str = None, image_url: str = None, superpoint_cache: dict = None, muzzle_crop_b64: str = None):
        vector_dict = {}
        for k, v in embeddings.items():
            if v is not None:
                vector_dict[k] = v
                
        vector_id = str(uuid.uuid5(uuid.NAMESPACE_OID, f"{cow_id}_{source}"))
        
        payload_data = {
            "cow_id": cow_id, 
            "farmer_id": farmer_id, 
            "part": source, 
            "cow_name": cow_name, 
            "image_url": image_url
        }
        if superpoint_cache:
            payload_data["superpoint_cache"] = superpoint_cache
        if muzzle_crop_b64:
            payload_data["muzzle_crop_b64"] = muzzle_crop_b64
            
        try:
            self.client.upsert(
                collection_name=self.collection_name,
                points=[
                    PointStruct(
                        id=vector_id,
                        vector=vector_dict,
                        payload=payload_data
                    )
                ]
            )
        except Exception as e:
            if "Not found" in str(e) or (hasattr(e, 'status_code') and e.status_code == 404):
                self._init_collection()
                self.client.upsert(
                    collection_name=self.collection_name,
                    points=[
                        PointStruct(
                            id=vector_id,
                            vector=vector_dict,
                            payload=payload_data
                        )
                    ]
                )
            else:
                raise e

    def search(self, query_mega: List[float] = None, query_muzzle: List[float] = None, query_face: List[float] = None, query_mega_face: List[float] = None, user_id: str = None, role: str = "admin", part_type: Any = None, top_k: int = 1, cohort_limit: int = 100) -> Any:
        base_filter = None
        if role == "farmer" and user_id:
            base_filter = Filter(must=[FieldCondition(key="farmer_id", match=MatchValue(value=user_id))])
            
        vectors_to_search = []
        
        # We explicitly map queries to their corresponding DB parts to avoid cross-part pollution
        # e.g., We don't want query_mega (Muzzle) to search against part='face' megadescriptors.
        if query_mega:
            vectors_to_search.append({
                "vec_name": "megadescriptor", "vec_data": query_mega, "weight": 1.0, "filter_part": ["muzzle", "face_muzzle"]
            })
        if query_muzzle:
            vectors_to_search.append({
                "vec_name": "spatial_muzzle", "vec_data": query_muzzle, "weight": 0.9, "filter_part": ["muzzle", "face_muzzle"]
            })
        if query_face:
            vectors_to_search.append({
                "vec_name": "spatial_face", "vec_data": query_face, "weight": 0.6, "filter_part": "face"
            })
        if query_mega_face:
            vectors_to_search.append({
                "vec_name": "megadescriptor", "vec_data": query_mega_face, "weight": 0.4, "filter_part": "face"
            })
            
        # If user explicitly passed a part_type (e.g. from an old caller), we override the mapping
        # but in the new pipeline, part_type should be None to allow full multi-modal search.
        if part_type:
            for v in vectors_to_search:
                v["filter_part"] = part_type
                
        if not vectors_to_search:
            return []
            
        try:
            db_count_res = self.client.count(collection_name=self.collection_name, exact=False)
            # Scale cohort dynamically: 5% of database, max 1000 to prevent memory blowouts
            dynamic_limit = max(100, int(db_count_res.count * 0.05))
            cohort_limit = min(max(cohort_limit, dynamic_limit), 1000)
        except Exception as e:
            pass
            
        cow_z_scores = defaultdict(float)
        cow_data = {} # store the best candidate data per cow
        
        for search_spec in vectors_to_search:
            vec_name = search_spec["vec_name"]
            vec_data = search_spec["vec_data"]
            weight = search_spec["weight"]
            f_part = search_spec["filter_part"]
            
            # Build filter for this specific vector space
            must_conds = []
            if base_filter and base_filter.must:
                must_conds.extend(base_filter.must)
                
            if isinstance(f_part, list):
                must_conds.append(FieldCondition(key="part", match=MatchAny(any=f_part)))
            else:
                must_conds.append(FieldCondition(key="part", match=MatchValue(value=f_part)))
                
            q_filter = Filter(must=must_conds)
            
            try:
                if hasattr(self.client, 'query_points'):
                    res = self.client.query_points(
                        collection_name=self.collection_name,
                        query=vec_data,
                        using=vec_name,
                        query_filter=q_filter,
                        limit=cohort_limit,
                        with_payload=True,
                        with_vectors=True
                    ).points
                else:
                    res = self.client.search(
                        collection_name=self.collection_name,
                        query_vector=(vec_name, vec_data),
                        query_filter=q_filter,
                        limit=cohort_limit,
                        with_payload=True,
                        with_vectors=True
                    )
                
                if not res:
                    continue
                    
                # Cohort Normalization (Z-Norm)
                scores = [hit.score for hit in res]
                mean_score = np.mean(scores)
                std_score = np.std(scores)
                if std_score == 0:
                    std_score = 1e-6 # prevent division by zero
                    
                for hit in res:
                    cow_id = hit.payload.get("cow_id")
                    if not cow_id: continue
                    
                    z_score = (hit.score - mean_score) / std_score
                    cow_z_scores[cow_id] += (z_score * weight)
                    
                    # Store the candidate data. We prefer muzzle/face_muzzle data as the base.
                    if cow_id not in cow_data or hit.payload.get("part") in ["muzzle", "face_muzzle"]:
                        cow_data[cow_id] = hit
                        
            except Exception as e:
                if "Not found" in str(e) or (hasattr(e, 'status_code') and e.status_code == 404):
                    self._init_collection()
                else:
                    print(f"Vector search warning for {vec_name}: {e}")
                    
        # Sort cows by aggregated Z-score
        sorted_cows = sorted(cow_z_scores.items(), key=lambda item: item[1], reverse=True)
        final_top_k_cows = [cid for cid, _ in sorted_cows[:top_k]]
        
        results = [cow_data[cid] for cid in final_top_k_cows if cid in cow_data]
        
        if not results:
            if top_k == 1:
                return {"found": False, "message": "No matching cattle found in the database."}
            return []
            
        formatted_results = []
        for m in results:
            cid = m.payload["cow_id"]
            formatted_results.append({
                "found": True,
                "cow_id": cid,
                "farmer_id": m.payload.get("farmer_id"),
                "cow_name": m.payload.get("cow_name"),
                "image_url": m.payload.get("image_url"),
                "superpoint_cache": m.payload.get("superpoint_cache"),
                "muzzle_crop_b64": m.payload.get("muzzle_crop_b64"),
                "similarity": float(m.score), # This is just one of the raw scores, preserved for legacy compatibility
                "z_norm_score": float(cow_z_scores[cid]),
                "vectors": m.vector 
            })
            
        if top_k == 1:
            return formatted_results[0]
            
        return formatted_results

    def delete_embedding(self, cow_id: str):
        try:
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=Filter(
                    must=[
                        FieldCondition(
                            key="cow_id",
                            match=MatchValue(value=cow_id)
                        )
                    ]
                )
            )
            print(f"Deleted vectors for cow {cow_id} from Qdrant.")
        except Exception as e:
            print(f"Warning: Failed to delete vectors for cow {cow_id}: {e}")
