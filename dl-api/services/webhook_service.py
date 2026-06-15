import requests
from core.config import EXPRESS_WEBHOOK_URL

def send_webhook(payload: dict, timeout: int = 60) -> bool:
    """
    Sends a webhook payload to the Express backend.
    Returns True if successful, logs and returns False otherwise.
    """
    try:
        resp = requests.post(EXPRESS_WEBHOOK_URL, json=payload, timeout=timeout)
        resp.raise_for_status()
        return True
    except Exception as webhook_err:
        print(f"Webhook delivery failed: {webhook_err}")
        return False
