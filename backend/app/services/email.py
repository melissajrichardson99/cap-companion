"""Transactional email via Resend (Guest Accounts Phase 0's only consumer so
far -- the password reset link). RESEND_API_KEY must be set in the
environment (see .env.example); Melissa provides it via Render's dashboard,
never pasted into chat, same pattern as every other credential in this
project.

RESEND_FROM_ADDRESS defaults to Resend's shared testing sender
(onboarding@resend.dev), which requires no domain verification -- fine for
development and classmates-scale use. A verified custom domain would be
needed before this goes anywhere near real guest volume.
"""

from __future__ import annotations

import os

import resend

RESEND_FROM_ADDRESS = os.environ.get("RESEND_FROM_ADDRESS", "onboarding@resend.dev")
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173")


def send_password_reset_email(to_email: str, token: str) -> None:
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        raise RuntimeError("RESEND_API_KEY must be set in the environment to send email.")
    resend.api_key = api_key

    reset_link = f"{FRONTEND_BASE_URL}/reset-password?token={token}"
    resend.Emails.send(
        {
            "from": RESEND_FROM_ADDRESS,
            "to": to_email,
            "subject": "Reset your Cobb's Adventure Park Companion password",
            "html": (
                "<p>Someone requested a password reset for your Cobb's Adventure Park "
                "Companion account.</p>"
                f'<p><a href="{reset_link}">Click here to reset your password</a>. '
                "This link expires in 1 hour.</p>"
                "<p>If you didn't request this, you can safely ignore this email.</p>"
            ),
        }
    )
