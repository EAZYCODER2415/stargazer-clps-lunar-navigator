"""One error shape for the whole API: {"error": {"code": ..., "message": ..., ...details}}."""
from __future__ import annotations

from typing import Any, Optional


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str, details: Optional[dict[str, Any]] = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}

    def body(self) -> dict:
        return {"error": {"code": self.code, "message": self.message, **self.details}}
