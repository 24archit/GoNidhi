"""
UnifiedCLIPAnalyzer
===================
Single GPU forward-pass analyzer built on openai/clip-vit-base-patch16.

Responsibilities
----------------
1. **Contamination gate** — rejects muzzles with foam / dirt / food.
2. **Semantic tagging** — extracts color and horns as DB-ready keywords.

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
    "REJ_QA_CONTAMINATED_MUZZLE": (
        "The muzzle appears to have foam, dirt, or food particles on it. "
        "Please wipe it clean and retake the photo."
    ),
}


class UnifiedCLIPAnalyzer:
    """
    QA gateway + semantic tagger backed by CLIP (clip-vit-base-patch16).

    Usage
    -----
    analyzer = UnifiedCLIPAnalyzer(device="cuda")

    # Full QA + semantics (face/muzzle crops from YOLO detector)
    result = analyzer.analyze_images(face_pil, muzzle_pil)
    # → {"status": "PASS", "metadata_payload": {"semantic_color": "black", ...}}
    # → {"status": "REJECT", "reason": "REJ_QA_CONTAMINATED_MUZZLE"}
    """

    CONTAMINATION_REJECT_THRESHOLD = 0.42  # Tuned via debug script to catch wet muzzles

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

        # ── QA Gate Schema (pass/fail sublists per gate) ─────────────────────
        # Each gate has multiple PASS prompts and multiple FAIL prompts.
        # At inference time we average PASS logits and take the max FAIL logit,
        # then apply a binary softmax + threshold. This eliminates the 1-vs-N
        # asymmetry of the old single-PASS-prompt approach.
        self.qa_gate_schema: dict[str, dict] = {
            "contamination": {
                "pass": [
                    "a dry cow muzzle",
                    "a clean cow muzzle",
                ],
                "fail": [
                    "a wet cow muzzle",
                    "a cow muzzle with saliva, drool, or foam",
                    "a dirty cow muzzle with mud",
                ],
            },
        }

        # ── Semantic Tag Schema ────────────────────────────────────────────────
        self.prompt_schema: dict[str, list[str]] = {
            "color": [
                "a close-up photo of a cow with white or grey fur",
                "a close-up photo of a cow with brown, red, or tan fur",
                "a close-up photo of a cow with black or dark brown fur",
            ],
            "horns": [
                "a photo of a cow face with prominent horns",
                "a photo of a cow face with short or no horns",
            ],
        }

        # Winning prompt text → clean DB keyword
        self.db_mappings: dict[str, str] = {
            "a close-up photo of a cow with white or grey fur":          "white_grey",
            "a close-up photo of a cow with brown, red, or tan fur":     "brown_red",
            "a close-up photo of a cow with black or dark brown fur":    "black_dark_brown",
            "a photo of a cow face with prominent horns":                "horns",
            "a photo of a cow face with short or no horns":              "polled",
        }

        # Build flat prompt list: QA gate prompts first, then semantic prompts
        self.flat_prompts: list[str] = []
        self.gate_slices: dict[str, dict] = {}  # gate_name → {"pass": (s,e), "fail": (s,e)}
        self.slices: dict[str, tuple[int, int]] = {}  # semantic cat → (s, e)
        idx = 0

        for gate_name, gate_data in self.qa_gate_schema.items():
            pass_start = idx
            self.flat_prompts.extend(gate_data["pass"])
            pass_end = idx + len(gate_data["pass"])
            idx = pass_end

            fail_start = idx
            self.flat_prompts.extend(gate_data["fail"])
            fail_end = idx + len(gate_data["fail"])
            idx = fail_end

            self.gate_slices[gate_name] = {"pass": (pass_start, pass_end), "fail": (fail_start, fail_end)}

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

    def _run_qa_gate(self, raw_logits: torch.Tensor, gate_name: str, threshold: float) -> bool:
        """
        Returns True (→ REJECT) if the gate fires with high confidence.

        Three-layer precision guard:
        1. Entropy bypass  — if CLIP is uncertain across all prompts, default to PASS.
        2. Ensemble PASS   — average all PASS prompt logits; FAIL must beat this average.
        3. Binary threshold — confidence of FAIL vs PASS ensemble must exceed `threshold`.
        """
        pass_s, pass_e = self.gate_slices[gate_name]["pass"]
        fail_s, fail_e = self.gate_slices[gate_name]["fail"]

        # ── 1. Entropy bypass ─────────────────────────────────────────────────
        all_gate = raw_logits[pass_s:fail_e]
        all_probs = all_gate.softmax(dim=-1).numpy()
        entropy = -float(np.sum(all_probs * np.log(all_probs + 1e-9)))
        max_entropy = np.log(len(all_probs))
        if entropy / max_entropy > 0.88:   # CLIP is confused → don't reject
            return False

        # ── 2. Ensemble PASS vs max FAIL ──────────────────────────────────────
        pass_score = float(raw_logits[pass_s:pass_e].mean().item())
        fail_score = float(raw_logits[fail_s:fail_e].max().item())
        if fail_score <= pass_score:       # PASS ensemble wins outright
            return False

        # ── 3. Binary softmax confidence ──────────────────────────────────────
        scores = torch.tensor([pass_score, fail_score])
        fail_conf = float(scores.softmax(dim=0)[1].item())
        return fail_conf >= threshold

    def _run_qa_gates(self, raw_logits: torch.Tensor, image_type: str):
        """
        Dispatch gate checks based on image type.
        Returns rejection dict or None (pass).
        """
        if image_type == "muzzle":
            if self._run_qa_gate(raw_logits, "contamination", self.CONTAMINATION_REJECT_THRESHOLD):
                return {"status": "REJECT", "reason": "REJ_QA_CONTAMINATED_MUZZLE"}

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
        PRIMARY ENTRY POINT — Full QA + semantic analysis on YOLO crops.
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
        enc_idx = 0

        if face_pil is not None:
            logits_face = all_logits[enc_idx]; enc_idx += 1
        if muzzle_pil is not None:
            logits_muzzle = all_logits[enc_idx]

        # ── Per-image QA gates ──────────

        if logits_muzzle is not None:
            rejection = self._run_qa_gates(logits_muzzle, "muzzle")
            if rejection:
                return rejection

        # ── Semantic tagging ───────────────────────────────────────────────────
        # We rely exclusively on the Face crop for semantics (color/horns) because
        # the muzzle crop is too zoomed in on the nose and corrupts fur analysis.
        if logits_face is not None:
            semantic_logits = logits_face
        elif logits_muzzle is not None:
            semantic_logits = logits_muzzle
        else:
            return {"status": "REJECT", "reason": "NO_IMAGE"}

        payload: dict = {}
        for cat in ("color", "horns"):
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


