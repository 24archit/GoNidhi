import cv2
import torch
import base64
import zlib
import requests
import numpy as np
from PIL import Image
import torchvision.transforms.functional as TF
from torchvision import transforms
from ultralytics import YOLO
from .megadescriptor_model import MegaDescriptorModel
from .spoof_model import MuzzleSpoofDetector
from lightglue import LightGlue, SuperPoint
from skimage.metrics import structural_similarity as ssim
from transformers import pipeline
import tensorflow as tf

# Configure TensorFlow to allocate memory dynamically
gpus = tf.config.list_physical_devices('GPU')
if gpus:
    try:
        for gpu in gpus:
            tf.config.experimental.set_memory_growth(gpu, True)
        # Enable TensorFlow mixed precision for faster GPU inference
        tf.keras.mixed_precision.set_global_policy('mixed_float16')
        print(f"Enabled dynamic memory growth + mixed_float16 on {len(gpus)} GPU(s).")
    except RuntimeError as e:
        print(e)

def extract_headless_model(model_path: str):
    full_model = tf.keras.models.load_model(model_path, safe_mode=False)
    layer_names = [l.name for l in full_model.layers]
    
    if "global_average_pooling2d" in layer_names:
        target_name = "global_average_pooling2d"
    elif "avg_pool" in layer_names:
        target_name = "avg_pool"
    else:
        # Fallback if neither standard name is found
        target_name = layer_names[-3] if "dropout" in layer_names[-2] else layer_names[-2]
        
    target_layer = full_model.get_layer(target_name) 
    headless_model = tf.keras.Model(
        inputs=full_model.input,
        outputs=target_layer.output
    )
    return headless_model
def serialize_tensor(tensor) -> dict:
    if tensor is None: return None
    if not isinstance(tensor, torch.Tensor):
        if isinstance(tensor, (list, tuple)): return {"is_list": True, "value": list(tensor)}
        return tensor
    np_arr = tensor.cpu().numpy()
    compressed = zlib.compress(np_arr.tobytes(), level=6)
    b64 = base64.b64encode(compressed).decode('utf-8')
    return {
        "shape": list(np_arr.shape),
        "dtype": str(np_arr.dtype),
        "data": b64,
        "z": True  # Flag indicating zlib-compressed data
    }

def deserialize_tensor(data: dict, device: str):
    if data is None: return None
    if not isinstance(data, dict): return data
    if "is_list" in data: return torch.tensor(data["value"], device=device)
    if "data" not in data: return data
    raw_bytes = zlib.decompress(base64.b64decode(data["data"]))
    shape = tuple(data["shape"])
    dtype = np.dtype(data["dtype"])
    np_arr = np.frombuffer(raw_bytes, dtype=dtype).reshape(shape)
    return torch.from_numpy(np_arr.copy()).to(device)

def apply_clahe(bgr_img: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    cl = clahe.apply(l)
    merged = cv2.merge((cl, a, b))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)

def nostril_leveler(bgr_crop: np.ndarray) -> np.ndarray:
    try:
        gray = cv2.cvtColor(bgr_crop, cv2.COLOR_BGR2GRAY)
        
        blurred = cv2.GaussianBlur(gray, (7, 7), 0)
        _, thresh = cv2.threshold(blurred, 60, 255, cv2.THRESH_BINARY_INV)
        
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if len(contours) < 2: return bgr_crop 
        
        h, w = bgr_crop.shape[:2]
        min_area = (h * w) * 0.01 
        valid_contours = [c for c in contours if cv2.contourArea(c) > min_area]
        
        if len(valid_contours) < 2: return bgr_crop
        
        valid_contours = sorted(valid_contours, key=cv2.contourArea, reverse=True)[:2]
        
        M1, M2 = cv2.moments(valid_contours[0]), cv2.moments(valid_contours[1])
        if M1["m00"] == 0 or M2["m00"] == 0: return bgr_crop
        
        cX1, cY1 = int(M1["m10"]/M1["m00"]), int(M1["m01"]/M1["m00"])
        cX2, cY2 = int(M2["m10"]/M2["m00"]), int(M2["m01"]/M2["m00"])
        
        if cX1 > cX2: cX1, cY1, cX2, cY2 = cX2, cY2, cX1, cY1
        
        angle_deg = np.degrees(np.arctan2(cY2 - cY1, cX2 - cX1))
        
        if abs(angle_deg) > 35:
            return bgr_crop
            
        if abs(cY1 - cY2) > (h * 0.35): # Y-difference cannot exceed 35% of image height
            return bgr_crop
            
        return cv2.warpAffine(bgr_crop, cv2.getRotationMatrix2D((w//2, h//2), angle_deg, 1.0), (w, h), borderMode=cv2.BORDER_REPLICATE)
        
    except Exception as e:
        return bgr_crop

class PadToSquare:
    def __call__(self, image):
        w, h = image.size
        max_wh = max(w, h)
        p_left = (max_wh - w) // 2
        p_top = (max_wh - h) // 2
        p_right = max_wh - w - p_left
        p_bottom = max_wh - h - p_top
        return TF.pad(image, (p_left, p_top, p_right, p_bottom), fill=0, padding_mode='constant')

class DLPipeline:
    # UPDATED: Now takes both face and muzzle yolo paths
    def __init__(self, yolo_face_path: str, yolo_muzzle_path: str, embedding_model_path: str, spoof_path: str = None):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.use_gpu = self.device == "cuda"
        print(f"Loading DL Models on {self.device.upper()}...", flush=True)
        
        # GPU-specific optimizations
        if self.use_gpu:
            torch.backends.cudnn.benchmark = True          # Auto-tune conv algorithms for this GPU
            torch.backends.cuda.matmul.allow_tf32 = True   # Allow TF32 for faster matrix multiplications
            torch.backends.cudnn.allow_tf32 = True          # Allow TF32 in cuDNN convolutions
            torch.set_float32_matmul_precision('high')      # Global PyTorch 2.0+ TF32 enablement
            print("Enabled: cuDNN benchmark, TF32 matmul (high precision), TF32 cuDNN", flush=True)
        
        self.yolo_face = YOLO(yolo_face_path)
        self.yolo_muzzle = YOLO(yolo_muzzle_path)
        
        self.embedding_model = MegaDescriptorModel(embedding_model_path).to(self.device)
        self.embedding_model.eval()
        if self.use_gpu:
            self.embedding_model.half()  # FP16 for ~2x throughput
        
        self.extractor = SuperPoint(max_num_keypoints=2048).eval().to(self.device)
        self.matcher = LightGlue(features='superpoint', depth_confidence=0.9, width_confidence=0.9).eval().to(self.device)

        self.spoof_model = None
        if spoof_path:
            self.spoof_model = MuzzleSpoofDetector().to(self.device)
            self.spoof_model.load_state_dict(torch.load(spoof_path, map_location=self.device))
            self.spoof_model.eval()
            if self.use_gpu:
                self.spoof_model.half()  # FP16 for spoof detection
        
        # torch.compile() — JIT-compile models for 20-50% faster inference (PyTorch 2.0+, Linux GPU only)
        if self.use_gpu:
            try:
                self.embedding_model = torch.compile(self.embedding_model, mode="max-autotune")
                self.extractor = torch.compile(self.extractor, mode="max-autotune")
                self.matcher = torch.compile(self.matcher, mode="max-autotune")
                if self.spoof_model is not None:
                    self.spoof_model = torch.compile(self.spoof_model, mode="max-autotune")
                print("torch.compile() applied to all PyTorch models (max-autotune mode).")
            except Exception as compile_err:
                print(f"torch.compile() not available, continuing without it: {compile_err}")

        # PadToSquare, 384x384, and BVRA [0.5] Normalization
        self.transform = transforms.Compose([
            PadToSquare(),
            transforms.Resize((384, 384)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])

        self.spoof_transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])

        print(f"Loading Cow Classifier Model...", flush=True)
        hf_device = 0 if self.use_gpu else -1
        hf_dtype = torch.float16 if self.use_gpu else torch.float32
        self.cow_classifier = pipeline("image-classification", model="google/vit-base-patch16-224", device=hf_device, torch_dtype=hf_dtype)

        print(f"Loading Spatial Attention Headless Models...", flush=True)
        import os
        try:
            self.headless_muzzle_model = extract_headless_model(os.path.join(os.path.dirname(__file__), "..", "models", "MuzzleCMPD568.keras"))
            self.headless_face_model = extract_headless_model(os.path.join(os.path.dirname(__file__), "..", "models", "FaceBasedIdentification.keras"))
        except Exception as e:
            print(f"Failed to load Spatial Attention models: {e}")
            self.headless_muzzle_model = None
            self.headless_face_model = None
        
        # CUDA Warmup — pre-allocate memory and compile lazy kernels so the first real request is fast
        if self.use_gpu:
            print("Running CUDA warmup pass...", flush=True)
            self._cuda_warmup()
            print(f"GPU Optimization Summary: FP16 models, cuDNN benchmark, TF32 matmul, TF mixed_float16, torch.compile, CUDA warmup", flush=True)
        print(f"All models loaded on {self.device.upper()}.", flush=True)

    def _cuda_warmup(self):
        """Run dummy inference through all models to pre-allocate CUDA memory and JIT-compile kernels."""
        try:
            # 1. MegaDescriptor warmup (384x384 FP16 input)
            dummy_embed = torch.randn(1, 3, 384, 384, device=self.device, dtype=torch.float16)
            with torch.inference_mode():
                self.embedding_model.forward_once(dummy_embed)
            
            # 2. Spoof model warmup (224x224 FP16 input)
            if self.spoof_model is not None:
                dummy_spoof = torch.randn(1, 3, 224, 224, device=self.device, dtype=torch.float16)
                with torch.inference_mode():
                    self.spoof_model(dummy_spoof)
            
            # 3. SuperPoint + LightGlue warmup (arbitrary image)
            dummy_img = torch.randn(1, 3, 480, 640, device=self.device, dtype=torch.float32)
            with torch.inference_mode(), torch.amp.autocast('cuda', enabled=True):
                feats = self.extractor.extract(dummy_img)
                self.matcher({'image0': feats, 'image1': feats})
            
            # 4. TensorFlow spatial model warmup
            dummy_tf = np.random.rand(1, 224, 224, 3).astype(np.float32)
            if self.headless_muzzle_model:
                self.headless_muzzle_model(dummy_tf, training=False)
            if self.headless_face_model:
                self.headless_face_model(dummy_tf, training=False)
            
            # 5. HuggingFace ViT warmup
            dummy_pil = Image.fromarray(np.random.randint(0, 255, (224, 224, 3), dtype=np.uint8))
            self.cow_classifier(dummy_pil)
            
            # Flush any leftover allocations
            torch.cuda.empty_cache()
            print("CUDA warmup complete — all models primed.")
        except Exception as e:
            print(f"CUDA warmup failed (non-fatal): {e}")
            torch.cuda.empty_cache()

    def prepare_spatial_input(self, crop: np.ndarray) -> np.ndarray:
        if crop is None:
            return None
        # 1. Ensure it is the RAW YOLO crop (NO CLAHE!) and convert to RGB
        rgb_img = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        
        # 2. Resize strictly to 224x224
        resized = cv2.resize(rgb_img, (224, 224))
        
        # 3. Cast to float32 (values remain 0.0 to 255.0)
        img_array = resized.astype(np.float32)
        
        # 4. Add batch dimension (1, 224, 224, 3)
        img_array = np.expand_dims(img_array, axis=0)
        
        return img_array

    def get_spatial_embeddings(self, crop: np.ndarray, model_type: str = "muzzle") -> list:
        if crop is None:
            return None
        img_array = self.prepare_spatial_input(crop)
        model = self.headless_muzzle_model if model_type == "muzzle" else self.headless_face_model
        if model is None:
            return None
        predictions = model(img_array, training=False).numpy()
        return predictions[0].tolist()

    def download_image(self, url: str) -> np.ndarray:
        # Fetches the image from the URL provided by Express
        response = requests.get(url)
        response.raise_for_status()
        np_arr = np.frombuffer(response.content, np.uint8)
        return cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    def is_image_a_cow(self, bgr_image: np.ndarray) -> tuple[bool, float, list]:
        if bgr_image is None or self.cow_classifier is None:
            return False, 0.0, []
        
        try:
            # Convert OpenCV BGR to PIL RGB image
            rgb_image = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2RGB)
            pil_image = Image.fromarray(rgb_image)
            
            predictions = self.cow_classifier(pil_image)
            
            is_cow = False
            cow_probability = 0.0
            cow_keywords = ['cow', 'ox', 'cattle', 'water buffalo', 'bison', 'bull']
            MIN_CONFIDENCE = 0.20
            
            for pred in predictions:
                if any(keyword in pred['label'].lower() for keyword in cow_keywords):
                    if pred['score'] >= MIN_CONFIDENCE:
                        is_cow = True
                        cow_probability = pred['score']
                        break
                        
            return is_cow, cow_probability, predictions
            
        except Exception as e:
            print(f"Error checking if image is a cow: {e}")
            return False, 0.0, []

    def extract_biometric(self, image: np.ndarray, part_type: str = "muzzle", min_conf: float = 0.39):
        if image is None: return None, 0.0
        
        model = self.yolo_face if part_type == "face" else self.yolo_muzzle
        results = model.predict(source=image, imgsz=640, conf=min_conf, device=self.device, half=self.use_gpu, verbose=False)
        r = results[0]
        
        if r.boxes is None or len(r.boxes.xyxy) == 0:
            return None, 0.0
            
        # Get the highest confidence crop
        best_idx = torch.argmax(r.boxes.conf).item()
        conf = float(r.boxes.conf[best_idx])
        box = r.boxes.xyxy[best_idx].cpu().numpy().astype(int)
        
        h, w = image.shape[:2]
        x1, y1 = max(0, box[0]), max(0, box[1])
        x2, y2 = min(w, box[2]), min(h, box[3])
        
        crop = image[y1:y2, x1:x2]
        pure_raw = crop.copy()
        
        if part_type == "muzzle":
           crop = nostril_leveler(crop)
        
        # APPLY CLAHE FIX
        crop_clahe = apply_clahe(crop)
        
        return {"raw": pure_raw, "clahe": crop_clahe, "leveled": crop}, conf

    def get_embeddings_batch(self, cropped_images: list[np.ndarray]) -> list[list[float]]:
        if not cropped_images:
            return []
            
        tensors = []
        for img in cropped_images:
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            img_pil = Image.fromarray(img_rgb)
            tensors.append(self.transform(img_pil))
            
        # Batch inference: Stack all images into a single Tensor [N, C, H, W]
        batch_tensor = torch.stack(tensors).to(self.device)
        if self.use_gpu:
            batch_tensor = batch_tensor.half()  # Match FP16 model weights
        
        with torch.inference_mode():
            embeddings = self.embedding_model.forward_once(batch_tensor)
            
        return embeddings.float().cpu().numpy().tolist()
        
    def is_spoof(self, image: np.ndarray) -> tuple[bool, float]:
        if self.spoof_model is None or image is None:
            return False, 0.0 # Assume live if no model available
            
        img_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        img_pil = Image.fromarray(img_rgb)
        
        tensor_img = self.spoof_transform(img_pil).unsqueeze(0).to(self.device)
        if self.use_gpu:
            tensor_img = tensor_img.half()  # Match FP16 model weights
        
        with torch.inference_mode():
            output = self.spoof_model(tensor_img)
            probs = torch.nn.functional.softmax(output.float(), dim=1)  # Softmax in FP32 for numerical stability
            spoof_prob = probs[0][1].item()
            print(f"Spoof probability: {spoof_prob}")
            
        return spoof_prob > 2.0, spoof_prob
            
    def _prepare_tensor_for_lightglue(self, img: np.ndarray) -> torch.Tensor:
        if img is None: return None
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).float() / 255.0
        return tensor.unsqueeze(0).to(self.device)

    def get_lightglue_metrics_from_cache(self, live_feats_list: list, cand_cache: dict, crop1: np.ndarray, crop2: np.ndarray) -> dict:
        result = {"lg_matches": -1, "inlier_ratio": 0.0, "aligned_ssim": 0.0}
        if not cand_cache or not live_feats_list: return result
        
        try:
            cand_feats = {k: deserialize_tensor(v, self.device) for k, v in cand_cache.items()}
            best_m = None
            best_kpts0, best_kpts1 = None, None
            
            with torch.inference_mode(), torch.amp.autocast('cuda', enabled=self.use_gpu):
                for live_feats in live_feats_list:
                    matches = self.matcher({'image0': live_feats, 'image1': cand_feats})
                    m = matches['matches'][0]
                    if len(m) > result["lg_matches"]:
                        result["lg_matches"] = len(m)
                        best_m = m
                        best_kpts0 = live_feats['keypoints'][0]
                        best_kpts1 = cand_feats['keypoints'][0]
            
            # Now compute Homography/SSIM using the BEST match without re-extracting!
            if best_m is not None and len(best_m) >= 4 and crop1 is not None and crop2 is not None:
                src_pts = best_kpts0[best_m[:, 0]].cpu().numpy().astype(np.float32)
                dst_pts = best_kpts1[best_m[:, 1]].cpu().numpy().astype(np.float32)
                
                H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
                inliers = int(np.sum(mask)) if mask is not None else 0
                result["inlier_ratio"] = float(inliers / len(best_m)) if len(best_m) > 0 else 0.0
                
                if H is not None and inliers >= 4:
                    h, w = crop2.shape[:2]
                    aligned_crop1 = cv2.warpPerspective(crop1, H, (w, h))
                    gray_aligned = cv2.cvtColor(aligned_crop1, cv2.COLOR_BGR2GRAY)
                    gray_crop2 = cv2.cvtColor(crop2, cv2.COLOR_BGR2GRAY)
                    result["aligned_ssim"] = float(ssim(gray_crop2, gray_aligned, data_range=255))
                    
        except Exception as e:
            print(f"[LightGlue] Error running cached metrics: {e}")
        return result

    def get_lightglue_geometric_features(self, crop1: np.ndarray, crop2: np.ndarray) -> dict:
        result = {"lg_matches": 0, "inlier_ratio": 0.0, "aligned_ssim": 0.0}
        if crop1 is None or crop2 is None: return result
        
        try:
            feats1_b64 = self.extract_superpoint_base64(crop1)
            feats2_b64 = self.extract_superpoint_base64(crop2)
            if not feats1_b64 or not feats2_b64: return result
            
            live_feats_list = self.parse_live_feats([feats1_b64])
            return self.get_lightglue_metrics_from_cache(live_feats_list, feats2_b64, crop1, crop2)
        except Exception as e:
            print(f"[LightGlue] Error in get_lightglue_geometric_features: {e}")
            return result

    def extract_superpoint_base64(self, crop: np.ndarray) -> dict:
        tensor = self._prepare_tensor_for_lightglue(crop)
        if tensor is None: return None
        
        with torch.inference_mode(), torch.amp.autocast('cuda', enabled=self.use_gpu):
            feats = self.extractor.extract(tensor)
            
        return {
            k: serialize_tensor(v) if isinstance(v, torch.Tensor) else v
            for k, v in feats.items()
        }


    def parse_live_feats(self, live_feats_b64) -> list:
        if not isinstance(live_feats_b64, list):
            live_feats_b64_list = [live_feats_b64] if live_feats_b64 else []
        else:
            live_feats_b64_list = live_feats_b64
            
        live_feats_list = []
        for feats_b64 in live_feats_b64_list:
            if feats_b64:
                live_feats_list.append({
                    k: deserialize_tensor(v, self.device)
                    for k, v in feats_b64.items()
                })
        return live_feats_list
