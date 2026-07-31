"""Placeholder Supabase client, configured from environment variables.

No credentials are set yet; SUPABASE_URL and SUPABASE_KEY must be provided
via a .env file (see .env.example) before this client can connect.
"""

import os

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

_client: Client | None = None


def get_supabase_client() -> Client:
    global _client

    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_KEY must be set in the environment "
            "before the Supabase client can be used."
        )

    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)

    return _client
