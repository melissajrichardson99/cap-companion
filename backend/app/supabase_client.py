"""Placeholder Supabase client, configured from environment variables.

No credentials are set yet; SUPABASE_URL and SUPABASE_KEY must be provided
via a .env file (see .env.example) before this client can connect.
"""

import os

import httpx
from dotenv import load_dotenv
from supabase import Client, ClientOptions, create_client

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

_client: Client | None = None


def _http2_disabled_httpx_client() -> httpx.Client:
    # supabase-py's postgrest/storage/auth sub-clients each build their own
    # httpx.Client internally with http2=True hardcoded (postgrest's is in
    # postgrest/_sync/client.py). On Windows, HTTP/2 + connection reuse across
    # several rapid sequential requests -- exactly what one map-node visit
    # does, since it completes multiple linked bingo tiles back to back --
    # intermittently raises httpx.RemoteProtocolError / "WinError 10035: A
    # non-blocking socket operation could not be completed immediately".
    # Reproduced under a Playwright run that fires several tile completions
    # in a row. ClientOptions.httpx_client is supabase-py's documented
    # override point: passing a client here makes every sub-client use it
    # as-is instead of building its own (see SyncPostgrestClient.__init__
    # and storage3's client, both `self.session = http_client or Client(...,
    # http2=True)`). Every request is still issued with a full absolute URL,
    # so one shared client with no base_url works fine across postgrest/
    # storage/auth/functions.
    return httpx.Client(follow_redirects=True, http2=False)


def get_supabase_client() -> Client:
    global _client

    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_KEY must be set in the environment "
            "before the Supabase client can be used."
        )

    if _client is None:
        options = ClientOptions(httpx_client=_http2_disabled_httpx_client())
        _client = create_client(SUPABASE_URL, SUPABASE_KEY, options=options)

    return _client
