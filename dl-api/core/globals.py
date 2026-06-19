import threading

# Global state variables populated during application startup
dl = None
db = None
xgb_model = None

# Thread lock to prevent concurrent GPU/Model inferences
gpu_lock = threading.Lock()


# Tracker for concurrent requests to fail fast if queue is too long
gpu_queue_size = 0
