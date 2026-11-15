#!/usr/bin/env python3
"""
export_openapi.py: writes the API contract to backend/openapi.json.

    python backend/scripts/export_openapi.py

Frontend and library authors can read that file without running the server. Re-run it after
changing an endpoint or a response model.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app  # noqa: E402


def main() -> int:
    out = BACKEND_DIR / "openapi.json"
    spec = create_app().openapi()
    out.write_text(json.dumps(spec, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {out.relative_to(BACKEND_DIR.parent)}: {len(spec['paths'])} paths")
    return 0


if __name__ == "__main__":
    sys.exit(main())
