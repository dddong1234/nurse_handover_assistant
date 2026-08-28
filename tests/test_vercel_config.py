from __future__ import annotations

import json
from pathlib import Path
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
VERCEL_CONFIG = REPOSITORY_ROOT / "vercel.json"


class VercelRoutingConfigTests(unittest.TestCase):
    def test_api_routes_rewrite_to_the_fastapi_entrypoint(self) -> None:
        self.assertTrue(
            VERCEL_CONFIG.exists(),
            "vercel.json must define the Next.js-to-FastAPI routing boundary",
        )
        config = json.loads(VERCEL_CONFIG.read_text(encoding="utf-8"))

        self.assertIn(
            {"source": "/api/:path*", "destination": "/api/index"},
            config.get("rewrites", []),
        )


if __name__ == "__main__":
    unittest.main()
