import cv2
import numpy as np
import base64
import requests
import cloudinary
import cloudinary.uploader

def download_image(file_url: str) -> np.ndarray:
    """Helper to download image from a URL (e.g. Cloudinary) into OpenCV format"""
    if not file_url:
        raise ValueError("Image URL is empty.")
    try:
        resp = requests.get(file_url, timeout=15)
        resp.raise_for_status()
        image_bytes = resp.content
        np_arr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError(f"Decoded image is None for URL: {file_url}")
        return img
    except Exception as e:
        raise ValueError(f"Could not download or decode image from URL {file_url}: {e}")

def encode_crop(crop: np.ndarray) -> str:
    if crop is None or crop.size == 0:
        return None
    _, buffer = cv2.imencode('.webp', crop)
    b64 = base64.b64encode(buffer).decode('utf-8')
    return f"data:image/webp;base64,{b64}"

def extract_crop_from_b64(crop_b64: str) -> np.ndarray:
    if not crop_b64:
        return None
    try:
        if crop_b64.startswith("data:image"):
            crop_b64 = crop_b64.split(",")[1]
        np_arr = np.frombuffer(base64.b64decode(crop_b64), np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        print(f"Error decoding b64 crop: {e}")
        return None

def upload_crop_to_cloudinary(crop: np.ndarray, folder: str = "gonidhi-telemetry", quality: int = 70) -> str:
    """Compresses the crop as a low-quality JPEG and uploads it to Cloudinary asynchronously."""
    if crop is None or crop.size == 0:
        return None
    try:
        # Compress image to lower quality WebP for logging
        success, buffer = cv2.imencode('.webp', crop, [int(cv2.IMWRITE_WEBP_QUALITY), quality])
        if not success:
            print("Failed to encode crop to WebP.")
            return None
            
        byte_buffer = buffer.tobytes()
        
        # Upload using the Cloudinary python SDK (requires CLOUDINARY_URL in .env)
        response = cloudinary.uploader.upload(
            byte_buffer,
            folder=folder,
            resource_type="image"
        )
        return response.get("secure_url")
    except Exception as e:
        print(f"Cloudinary upload failed: {e}")
        return None

def delete_image_from_cloudinary(url: str):
    """Deletes an image from Cloudinary using its secure URL."""
    if not url:
        return
    try:
        parts = url.split('/')
        if 'upload' in parts:
            upload_idx = parts.index('upload')
            public_id_with_ext = '/'.join(parts[upload_idx + 2:])
            public_id = public_id_with_ext.rsplit('.', 1)[0]
            cloudinary.uploader.destroy(public_id)
            print(f"Cleaned up orphaned Cloudinary image: {public_id}")
    except Exception as e:
        print(f"Failed to delete orphaned Cloudinary image {url}: {e}")
