import uuid
import numpy as np
from typing import List, Dict, Any, Optional, Union
from qdrant_client import QdrantClient
from qdrant_client.http.models import (
    Distance, VectorParams, PointStruct, Filter, FieldCondition,
    MatchValue, MatchAny, SearchParams, OptimizersConfigDiff, HnswConfigDiff,
    ScalarQuantization, ScalarQuantizationConfig, ScalarType
)
from collections import defaultdict

COHORT_PER_SPACE = 200
HNSW_EF = 256
RRF_K = 30
TOP_K_CANDIDATES = 25

class CattleVectorStore:
    def __init__(self, qdrant_url: str, qdrant_api_key: str, vector_size: int = 1536):
        self.client = QdrantClient(url=qdrant_url, api_key=qdrant_api_key)
        self.vector_size = vector_size
        self.collection_name = "cattle_vectors_spatial"
        self._init_collection()

    def _init_collection(self):
        try:
            if not self.client.collection_exists(self.collection_name):
                print(f"Collection '{self.collection_name}' not found. Creating...")
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config={
                        "megadescriptor": VectorParams(size=self.vector_size, distance=Distance.COSINE),
                        "spatial_muzzle": VectorParams(size=1280, distance=Distance.COSINE),
                        "spatial_face":   VectorParams(size=1280, distance=Distance.COSINE),
                    },
                    optimizers_config=OptimizersConfigDiff(indexing_threshold=10_000),
                    hnsw_config=HnswConfigDiff(m=32, ef_construct=200),
                    quantization_config=ScalarQuantization(
                        scalar=ScalarQuantizationConfig(
                            type=ScalarType.INT8,
                            quantile=0.99,
                            always_ram=True
                        )
                    ),
                    on_disk_payload=True,
                )
            else:
                print("Collection found and ready.")

            for field in ("part", "cow_id", "farmer_id"):
                self.client.create_payload_index(
                    collection_name=self.collection_name,
                    field_name=field,
                    field_schema="keyword",
                )
        except Exception as e:
            print(f"Warning during collection init: {e}")

    def add_embedding(
        self,
        embeddings: Dict[str, List[float]],
        cow_id: str,
        farmer_id: str,
        source: str,
        cow_name: str = None,
        image_url: str = None,
        crop_url: str = None,
        superpoint_cache: dict = None,
    ):
        vector_dict = {k: v for k, v in embeddings.items() if v is not None}
        vector_id = str(uuid.uuid5(uuid.NAMESPACE_OID, f"{cow_id}_{source}"))

        payload = {
            "cow_id":    cow_id,
            "farmer_id": farmer_id,
            "part":      source,
            "cow_name":  cow_name,
            "image_url": image_url,
        }
        if crop_url:
            payload["crop_url"] = crop_url
        if superpoint_cache:
            payload["superpoint_cache"] = superpoint_cache

        try:
            self._upsert(vector_id, vector_dict, payload)
        except Exception as e:
            if "Not found" in str(e) or (hasattr(e, "status_code") and e.status_code == 404):
                self._init_collection()
                self._upsert(vector_id, vector_dict, payload)
            else:
                raise

    def _upsert(self, vector_id, vector_dict, payload):
        self.client.upsert(
            collection_name=self.collection_name,
            points=[PointStruct(id=vector_id, vector=vector_dict, payload=payload)],
        )

    def search(
        self,
        query_mega:      List[float] = None,
        query_muzzle:    List[float] = None,
        query_face:      List[float] = None,
        query_mega_face: List[float] = None,
        user_id:   str = None,
        role:      str = "admin",
        part_type: Any = None,
        top_k:     int = TOP_K_CANDIDATES,
        cohort_limit: int = COHORT_PER_SPACE,
        fetch_vectors: bool = False,
    ) -> Any:
        """
        Returns top-k candidate cows for downstream XGBoost/Dempster-Shafer processing.
        No uniqueness gate — that decision belongs to your classifier, not here.

        Fusion:
          1. Each vector space searched independently (high ef, large cohort).
          2. Per-space Z-normalisation so spaces with different score distributions
             contribute equally regardless of dimensionality.
          3. RRF on top: rewards cows that rank high consistently across spaces,
             not just cows that score very high in one space only.
          4. Final fused = 0.6*RRF_norm + 0.4*tanh(Z_norm) — rank stability +
             magnitude of similarity.
        """
        base_filter = None
        if role == "farmer" and user_id:
            base_filter = Filter(
                must=[FieldCondition(key="farmer_id", match=MatchValue(value=user_id))]
            )

        search_specs = []
        if query_mega is not None:
            search_specs.append({
                "vec_name":    "megadescriptor",
                "vec_data":    query_mega,
                "weight":      1.0,
                "filter_part": ["muzzle", "face_muzzle"],
            })
        if query_muzzle is not None:
            search_specs.append({
                "vec_name":    "spatial_muzzle",
                "vec_data":    query_muzzle,
                "weight":      0.9,
                "filter_part": ["muzzle", "face_muzzle"],
            })
        if query_face is not None:
            search_specs.append({
                "vec_name":    "spatial_face",
                "vec_data":    query_face,
                "weight":      0.6,
                "filter_part": "face",
            })
        if query_mega_face is not None:
            search_specs.append({
                "vec_name":    "megadescriptor",
                "vec_data":    query_mega_face,
                "weight":      0.4,
                "filter_part": "face",
            })

        if part_type:
            for spec in search_specs:
                spec["filter_part"] = part_type

        if not search_specs:
            return [] if top_k > 1 else {"found": False, "message": "No query vectors provided."}

        cow_znorm_score = defaultdict(float)
        cow_rrf_score   = defaultdict(float)
        cow_space_count = defaultdict(int)

        cow_data       = {}
        cow_best_score = {}

        spaces_searched = 0

        for spec in search_specs:
            raw_hits = self._query_one_space(
                spec["vec_name"], spec["vec_data"],
                spec["filter_part"], base_filter, cohort_limit,
                fetch_vectors=fetch_vectors,
            )
            if not raw_hits:
                continue

            spaces_searched += 1
            weight = spec["weight"]

            scores = np.array([h.score for h in raw_hits], dtype=np.float32)
            mean_s = float(np.mean(scores))
            std_s  = float(np.std(scores))
            if std_s < 1e-6:
                std_s = 1e-6

            for rank, hit in enumerate(raw_hits, start=1):
                cow_id = hit.payload.get("cow_id")
                if not cow_id:
                    continue

                z = (hit.score - mean_s) / std_s
                cow_znorm_score[cow_id] += z * weight

                cow_rrf_score[cow_id] += weight / (RRF_K + rank)

                cow_space_count[cow_id] += 1

                part = hit.payload.get("part", "")
                is_muzzle_part = part in ("muzzle", "face_muzzle")
                prev_best = cow_data.get(cow_id)

                if prev_best is None:
                    cow_data[cow_id] = hit
                    cow_best_score[cow_id] = hit.score
                else:
                    prev_part = prev_best.payload.get("part", "")
                    prev_is_muzzle = prev_part in ("muzzle", "face_muzzle")

                    if (is_muzzle_part and not prev_is_muzzle) or \
                       (is_muzzle_part == prev_is_muzzle and hit.score > cow_best_score[cow_id]):
                        cow_data[cow_id] = hit
                        cow_best_score[cow_id] = hit.score

        if not cow_rrf_score:
            return [] if top_k > 1 else {"found": False, "message": "No matches found."}

        max_rrf_possible = sum(s["weight"] / (RRF_K + 1) for s in search_specs)
        if max_rrf_possible < 1e-9:
            max_rrf_possible = 1.0

        znorm_divisor = max(spaces_searched, 1)

        fused = {}
        for cow_id in cow_rrf_score:
            rrf_norm  = cow_rrf_score[cow_id] / max_rrf_possible
            znorm_val = cow_znorm_score.get(cow_id, 0.0)
            fused[cow_id] = 0.60 * rrf_norm + 0.40 * float(np.tanh(znorm_val / znorm_divisor))

        sorted_cows = sorted(fused.items(), key=lambda x: x[1], reverse=True)
        top_cow_ids = [cid for cid, _ in sorted_cows[:top_k] if cid in cow_data]

        results = []
        for cid in top_cow_ids:
            hit = cow_data[cid]
            entry = {
                "found":            True,
                "cow_id":           cid,
                "farmer_id":        hit.payload.get("farmer_id"),
                "cow_name":         hit.payload.get("cow_name"),
                "image_url":        hit.payload.get("image_url"),
                "crop_url":         hit.payload.get("crop_url"),
                "superpoint_cache": hit.payload.get("superpoint_cache"),
                "similarity":       float(cow_best_score[cid]),
                "z_norm_score":     float(cow_znorm_score[cid]),
                "rrf_score":        float(cow_rrf_score[cid]),
                "fused_score":      float(fused[cid]),
                "spaces_matched":   cow_space_count[cid],
            }
            if fetch_vectors:
                entry["vectors"] = hit.vector
            results.append(entry)

        if top_k == 1:
            return results[0] if results else {"found": False, "message": "No match."}

        return results

    def _query_one_space(
        self,
        vec_name: str,
        vec_data: List[float],
        filter_part: Union[str, list],
        base_filter: Optional[Filter],
        limit: int,
        fetch_vectors: bool = False,
    ):
        must_conds = list(base_filter.must) if (base_filter and base_filter.must) else []

        if isinstance(filter_part, list):
            must_conds.append(FieldCondition(key="part", match=MatchAny(any=filter_part)))
        else:
            must_conds.append(FieldCondition(key="part", match=MatchValue(value=filter_part)))

        q_filter      = Filter(must=must_conds)
        search_params = SearchParams(hnsw_ef=HNSW_EF)

        try:
            if hasattr(self.client, "query_points"):
                return self.client.query_points(
                    collection_name=self.collection_name,
                    query=vec_data,
                    using=vec_name,
                    query_filter=q_filter,
                    limit=limit,
                    with_payload=True,
                    with_vectors=fetch_vectors,
                    search_params=search_params,
                ).points
            else:
                return self.client.search(
                    collection_name=self.collection_name,
                    query_vector=(vec_name, vec_data),
                    query_filter=q_filter,
                    limit=limit,
                    with_payload=True,
                    with_vectors=fetch_vectors,
                    search_params=search_params,
                )
        except Exception as e:
            if "Not found" in str(e) or (hasattr(e, "status_code") and e.status_code == 404):
                self._init_collection()
            else:
                print(f"Vector search warning [{vec_name}]: {e}")
            return []

    def delete_embedding(self, cow_id: str):
        try:
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=Filter(
                    must=[FieldCondition(key="cow_id", match=MatchValue(value=cow_id))]
                ),
            )
            print(f"Deleted vectors for cow {cow_id}.")
        except Exception as e:
            print(f"Warning: Failed to delete vectors for cow {cow_id}: {e}")
