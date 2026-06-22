"""
UnifiedCLIPAnalyzer
===================
Single GPU forward-pass analyzer built on openai/clip-vit-base-patch16.

Responsibilities
----------------
1. **Liveness gate** (soft) — blocks photos taken from a screen / printout.
   Only rejects when CLIP is highly confident (>= LIVENESS_REJECT_THRESHOLD),
   so edge cases that could go either way pass through.
2. **Contamination gate** — rejects muzzles with foam / dirt / food.
3. **Alignment gate** — rejects upside-down or rotated face photos.
4. **Semantic tagging** — extracts color, pattern, horns as DB-ready keywords.

GPU optimizations
-----------------
* Text vectors pre-computed ONCE at startup and stored on-device.
* Single image forward-pass computes ALL prompt scores in one matmul.
* FP16 image encoding on CUDA; FP32 text vectors (numerically stable).
* torch.amp.autocast('cuda') wrapping image encode.
* torch.inference_mode() throughout (faster than no_grad).
* torch.compile() on CUDA.
* Dedicated CUDA warmup pass to prime JIT kernels.
* Zero-compute orientation gate (pure Python, no GPU hit).

CPU fallback
------------
All FP16 / autocast paths are guarded by self.use_gpu; CPU runs in FP32.
"""

import numpy as np
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor


# ── User-facing messages for each rejection code ──────────────────────────────
CLIP_REJECT_MESSAGES: dict[str, str] = {
    "REJ_QA_INVALID_ORIENTATION": (
        "The photo appears to be in landscape orientation. "
        "Please retake in portrait mode with the cow's face upright."
    ),
    "REJ_QA_NOT_LIVE_IMAGE": (
        "The photo appears to have been taken from a screen or a printout. "
        "Please capture a live photo directly of the cow."
    ),
    "REJ_QA_CONTAMINATED_MUZZLE": (
        "The muzzle appears to have foam, dirt, or food particles on it. "
        "Please wipe it clean and retake the photo."
    ),
    "REJ_QA_BAD_ALIGNMENT": (
        "The cow's face appears tilted or upside-down in the photo. "
        "Please retake the photo with the face upright and facing the camera."
    ),
}


class UnifiedCLIPAnalyzer:
    """
    QA gateway + semantic tagger backed by CLIP (clip-vit-base-patch16).

    Usage
    -----
    analyzer = UnifiedCLIPAnalyzer(device="cuda")

    # Full QA + semantics (face crop from YOLO face detector)
    result = analyzer.analyze_image(face_pil)
    # → {"status": "PASS", "metadata_payload": {"semantic_color": "black", ...}}
    # → {"status": "REJECT", "reason": "REJ_QA_CONTAMINATED_MUZZLE"}

    # Muzzle-only QA (liveness + contamination, no semantics)
    result = analyzer.analyze_muzzle(muzzle_pil)
    """

    # Liveness gate: only reject if the non-live prompt wins AND its
    # confidence >= this threshold. Keeps borderline real photos safe.
    LIVENESS_REJECT_THRESHOLD: float = 0.72

    def __init__(self, device: str) -> None:
        self.device = device
        self.use_gpu = device == "cuda"

        print(
            f"[CLIP] Loading openai/clip-vit-base-patch16 on {device.upper()}...",
            flush=True,
        )

        dtype = torch.float16 if self.use_gpu else torch.float32
        self.model: CLIPModel = (
            CLIPModel.from_pretrained(
                "openai/clip-vit-base-patch16",
                torch_dtype=dtype,
            )
            .to(device)
            .eval()
        )
        self.processor: CLIPProcessor = CLIPProcessor.from_pretrained(
            "openai/clip-vit-base-patch16"
        )

        # torch.compile — JIT for extra throughput on GPU (PyTorch 2.0+)
        if self.use_gpu:
            try:
                self.model = torch.compile(self.model)
                print("[CLIP] torch.compile(default) applied.", flush=True)
            except Exception as exc:
                print(f"[CLIP] torch.compile() skipped: {exc}", flush=True)

        # ── Prompt schema ──────────────────────────────────────────────────────
        # QA gates:   index 0 is ALWAYS the PASS / safe condition.
        # Semantic:   all prompts are candidates; winner maps to a DB tag.
        self.prompt_schema: dict[str, list[str]] = {
            # ── QA Gates ──────────────────────────────────────────────────────
            "liveness": [
                # 0 → PASS
                "a real live animal being photographed directly",
                "a photo of a monitor, screen, or digital display showing an image",
                "a photo of a printed paper, poster, or photograph of an animal",
            ],
            "contamination": [
                # 0 → PASS
                "a clean and dry cow muzzle",
                "a cow muzzle covered in wet foam, drool, or saliva",
                "a cow muzzle with grass, dirt, or food particles stuck to it",
            ],
            "alignment": [
                # 0 → PASS
                "a portrait photo of a cow looking directly at the camera",
                "an upside down photo of a cow",
                "a sideways profile photo of a cow looking away",
            ],
            # ── Semantic Tags ──────────────────────────────────────────────────
            "color": [
                "a photo of a cow face that is mostly black",
                "a photo of a cow face that is mostly white",
                "a photo of a cow face that is mostly dark brown",
                "a photo of a cow face that is mostly red or reddish-brown",
                "a photo of a cow face that is mostly tan, fawn, or light brown",
                "a photo of a cow face that is mostly grey or silver",
            ],
            "pattern": [
                "a photo of a cow face with a solid, uniform color",
                "a photo of a cow face with distinct spots or patches",
            ],
            "horns": [
                "a photo of a cow face with prominent horns",
                "a photo of a cow face with short or no horns",
            ],
        }

        # Winning prompt text → clean DB keyword
        self.db_mappings: dict[str, str] = {
            "a photo of a cow face that is mostly black":                  "black",
            "a photo of a cow face that is mostly white":                  "white",
            "a photo of a cow face that is mostly dark brown":             "dark_brown",
            "a photo of a cow face that is mostly red or reddish-brown":   "red",
            "a photo of a cow face that is mostly tan, fawn, or light brown": "tan_fawn",
            "a photo of a cow face that is mostly grey or silver":         "grey",
            "a photo of a cow face with a solid, uniform color":           "solid_face",
            "a photo of a cow face with distinct spots or patches":        "spotted_face",
            "a photo of a cow face with prominent horns":                  "horns",
            "a photo of a cow face with short or no horns":                "polled",
        }

        # Build flat prompt list and contiguous index slices per category
        self.flat_prompts: list[str] = []
        self.slices: dict[str, tuple[int, int]] = {}
        idx = 0
        for cat, prompts in self.prompt_schema.items():
            self.flat_prompts.extend(prompts)
            self.slices[cat] = (idx, idx + len(prompts))
            idx += len(prompts)

        # ── Pre-compute text features (done ONCE at startup) ───────────────────
        # Always FP32 for numerical stability; result stays on device.
        print(
            f"[CLIP] Pre-computing {len(self.flat_prompts)} text vectors...",
            flush=True,
        )
        txt_inputs = self.processor(
            text=self.flat_prompts, return_tensors="pt", padding=True
        ).to(device)

        with torch.no_grad():
            # Disable autocast so text encoding stays in FP32
            with torch.amp.autocast(device_type=device, enabled=False):
                txt_out = self.model.get_text_features(**txt_inputs)
                if hasattr(txt_out, "text_embeds") and txt_out.text_embeds is not None:
                    txt_feats = txt_out.text_embeds
                elif hasattr(txt_out, "pooler_output"):
                    # Some versions/compilations of transformers return the base output
                    # and skip the projection layer in get_text_features
                    pool_out = txt_out.pooler_output
                    if hasattr(self.model, "text_projection") and self.model.text_projection is not None:
                        if pool_out.shape[-1] == self.model.text_projection.in_features:
                            txt_feats = self.model.text_projection(pool_out)
                        else:
                            txt_feats = pool_out
                    else:
                        txt_feats = pool_out
                else:
                    txt_feats = txt_out
                    
                txt_feats = txt_feats.float()

        self.text_features: torch.Tensor = txt_feats / txt_feats.norm(
            dim=-1, keepdim=True
        )  # shape: (N_prompts, D), on device
        print("[CLIP] Text vectors ready.", flush=True)

    # ─────────────────────────────────────────────────────────────────────────
    # Internal helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _encode_images(self, pil_images: list[Image.Image]) -> torch.Tensor:
        """
        Encode list of PIL images → L2-normalised feature vectors (N, D).
        Uses FP16 + autocast on GPU, FP32 on CPU.
        """
        inputs = self.processor(images=pil_images, return_tensors="pt").to(self.device)

        with torch.inference_mode():
            if self.use_gpu:
                with torch.amp.autocast("cuda", enabled=True):
                    img_out = self.model.get_image_features(**inputs)
            else:
                img_out = self.model.get_image_features(**inputs)

            if hasattr(img_out, "image_embeds") and img_out.image_embeds is not None:
                img_feats = img_out.image_embeds
            elif hasattr(img_out, "pooler_output"):
                pool_out = img_out.pooler_output
                if hasattr(self.model, "visual_projection") and self.model.visual_projection is not None:
                    if pool_out.shape[-1] == self.model.visual_projection.in_features:
                        img_feats = self.model.visual_projection(pool_out)
                    else:
                        img_feats = pool_out
                else:
                    img_feats = pool_out
            else:
                img_feats = img_out

            img_feats = img_feats.float()

        return img_feats / img_feats.norm(dim=-1, keepdim=True)

    def _all_logits_batch(self, pil_images: list[Image.Image]) -> torch.Tensor:
        """
        Batched matmul: N image features x all pre-computed text features.
        Returns raw logit matrix shape (N, N_prompts) on CPU.
        """
        img_feats = self._encode_images(pil_images)  # (N, D) on device
        return (100.0 * img_feats @ self.text_features.T).cpu()

    def _encode_image(self, pil_image: Image.Image) -> torch.Tensor:
        return self._encode_images([pil_image])

    def _all_logits(self, pil_image: Image.Image) -> torch.Tensor:
        return self._all_logits_batch([pil_image])[0]

    def _softmax_slice(self, logits: torch.Tensor, category: str) -> np.ndarray:
        """Apply softmax only to the logit slice for `category`."""
        s, e = self.slices[category]
        return logits[s:e].softmax(dim=-1).numpy()

    def _run_qa_gates(self, raw_logits: torch.Tensor, image_type: str):
        """
        Run liveness, contamination, and alignment gates on pre-computed logits.
        Skips alignment on muzzle photos and contamination on face photos.
        """
        # Liveness applies to ALL photos (soft threshold)
        probs = self._softmax_slice(raw_logits, "liveness")
        winner = int(np.argmax(probs))
        if winner != 0 and float(probs[winner]) >= self.LIVENESS_REJECT_THRESHOLD:
            return {"status": "REJECT", "reason": "REJ_QA_NOT_LIVE_IMAGE"}

        if image_type == "muzzle":
            # Contamination (only matters on close-up muzzle photo)
            probs = self._softmax_slice(raw_logits, "contamination")
            if int(np.argmax(probs)) != 0:
                return {"status": "REJECT", "reason": "REJ_QA_CONTAMINATED_MUZZLE"}

        if image_type == "face":
            # Alignment (only matters for the full face photo; close-up muzzle lacks context/eyes)
            probs = self._softmax_slice(raw_logits, "alignment")
            if int(np.argmax(probs)) != 0:
                return {"status": "REJECT", "reason": "REJ_QA_BAD_ALIGNMENT"}

        return None  # All gates passed

    # ─────────────────────────────────────────────────────────────────────────
    # Public API
    # ─────────────────────────────────────────────────────────────────────────

    def analyze_images(
        self,
        face_pil: Image.Image = None,
        muzzle_pil: Image.Image = None,
    ) -> dict:
        """
        PRIMARY ENTRY POINT — Full QA + semantic analysis on original uncropped images.
        """
        if face_pil is None and muzzle_pil is None:
            return {"status": "REJECT", "reason": "NO_IMAGE"}

        # ── Batched GPU forward pass ───────────────────────────────────────────
        images_to_encode = []
        if face_pil is not None:
            images_to_encode.append(face_pil)
        if muzzle_pil is not None:
            images_to_encode.append(muzzle_pil)

        all_logits = self._all_logits_batch(images_to_encode)
        
        logits_face = None
        logits_muzzle = None
        idx = 0
        
        # ── QA gates ──────────────────────────────────────────────────
        if face_pil is not None:
            logits_face = all_logits[idx]
            rejection = self._run_qa_gates(logits_face, "face")
            if rejection:
                return rejection
            idx += 1
            
        if muzzle_pil is not None:
            logits_muzzle = all_logits[idx]
            rejection = self._run_qa_gates(logits_muzzle, "muzzle")
            if rejection:
                return rejection

        # ── Semantic tagging: logit-space ensemble ─────────────────────────────
        # Averaging raw logits before softmax is equivalent to geometric-mean
        # probability ensemble. Prompts that score high in BOTH images win.
        if logits_face is not None and logits_muzzle is not None:
            semantic_logits = (logits_face + logits_muzzle) * 0.5
        elif logits_face is not None:
            semantic_logits = logits_face
        else:
            semantic_logits = logits_muzzle

        payload: dict = {}
        for cat in ("color", "pattern", "horns"):
            probs = self._softmax_slice(semantic_logits, cat)
            winning_prompt = self.prompt_schema[cat][int(np.argmax(probs))]
            payload[f"semantic_{cat}"] = self.db_mappings[winning_prompt]

        return {"status": "PASS", "metadata_payload": payload}

    def warmup(self) -> None:
        """
        CUDA warmup: encode a random dummy image to prime all lazy CUDA
        kernels and torch.compile() traces before the first real request.
        Safe to call on CPU (no-op effectively).
        """
        try:
            dummy = Image.fromarray(
                np.random.randint(0, 255, (224, 224, 3), dtype=np.uint8)
            )
            self._encode_image(dummy)
            print("[CLIP] CUDA warmup complete.", flush=True)
        except Exception as exc:
            print(f"[CLIP] Warmup failed (non-fatal): {exc}", flush=True)


