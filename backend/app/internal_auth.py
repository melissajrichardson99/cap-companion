"""Shared-secret auth for machine-to-machine internal endpoints (currently
just POST /internal/session-cleanup) -- distinct from app/staff_auth.py's
signed session tokens, since there's no human login step here: a scheduled
GitHub Actions workflow calls this endpoint directly with a static secret
header. INTERNAL_CLEANUP_SECRET must be set in the environment (see
.env.example) before this dependency will accept any request.
"""

import hmac
import os

from fastapi import Header, HTTPException

INTERNAL_CLEANUP_SECRET = os.environ.get("INTERNAL_CLEANUP_SECRET")


def require_internal_secret(x_internal_secret: str | None = Header(default=None, alias="X-Internal-Secret")) -> None:
    if not INTERNAL_CLEANUP_SECRET:
        raise RuntimeError("INTERNAL_CLEANUP_SECRET must be set in the environment for internal endpoints to work.")
    if not x_internal_secret or not hmac.compare_digest(x_internal_secret, INTERNAL_CLEANUP_SECRET):
        raise HTTPException(status_code=401, detail="Missing or invalid internal secret")
