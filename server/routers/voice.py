"""Voice transcription router — accepts audio and returns text."""

import logging

from fastapi import APIRouter, File, Request, UploadFile

from auth.dependencies import get_current_user
from config import settings
from fastapi import Depends

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/transcribe")
async def transcribe_audio(
    request: Request,
    file: UploadFile = File(...),
    _user: str = Depends(get_current_user),
):
    """Transcribe audio to text.

    Uses configured provider: 'whisper_api' (OpenAI Whisper) or 'browser' (client-side).
    """
    if settings.voice_provider == "whisper_api" and settings.whisper_api_key:
        import httpx

        audio_bytes = await file.read()
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {settings.whisper_api_key}"},
                files={"file": (file.filename or "audio.webm", audio_bytes, file.content_type or "audio/webm")},
                data={"model": "whisper-1"},
            )
            if response.status_code == 200:
                return {"text": response.json().get("text", "")}
            logger.warning("Whisper API error: %d %s", response.status_code, response.text[:200])
            return {"error": "Transcription failed", "status": response.status_code}

    elif settings.voice_provider == "browser":
        return {"error": "Server-side transcription not configured. Use client-side Web Speech API."}

    else:
        return {"error": f"Unknown voice_provider: {settings.voice_provider}"}
