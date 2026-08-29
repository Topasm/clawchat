"""Push notification service — sends FCM messages to registered devices."""

import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Guard firebase_admin import — only available when configured
_firebase_app = None
_messaging = None


class PushService:
    """Sends push notifications via Firebase Cloud Messaging (FCM).

    If firebase_credentials_path is empty, the service is disabled and
    all send methods are no-ops.
    """

    def __init__(self, credentials_path: str = ""):
        self._enabled = False
        if not credentials_path:
            logger.info("Push notifications disabled (no firebase_credentials_path)")
            return

        try:
            import firebase_admin
            from firebase_admin import credentials, messaging

            global _firebase_app, _messaging
            if _firebase_app is None:
                cred = credentials.Certificate(credentials_path)
                _firebase_app = firebase_admin.initialize_app(cred)
            _messaging = messaging
            self._enabled = True
            logger.info("Push notifications enabled via FCM")
        except ImportError:
            logger.warning(
                "firebase-admin not installed — push notifications disabled. "
                "Install with: pip install firebase-admin"
            )
        except Exception:
            logger.exception("Failed to initialize Firebase Admin SDK")

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def send_push(
        self,
        token: str,
        title: str,
        body: str,
        data: dict[str, str] | None = None,
    ) -> bool:
        """Send a push notification to a single device token.

        Returns True on success, False on failure.
        """
        if not self._enabled or _messaging is None:
            return False

        message = _messaging.Message(
            notification=_messaging.Notification(title=title, body=body),
            token=token,
            data=data or {},
        )

        try:
            # firebase_admin SDK is synchronous — run in thread pool
            await asyncio.to_thread(_messaging.send, message)
            return True
        except Exception:
            logger.warning("Failed to send push to token %s...", token[:20])
            return False

    async def send_to_all_devices(
        self,
        db: AsyncSession,
        title: str,
        body: str,
        data: dict[str, str] | None = None,
    ) -> int:
        """Send a push notification to all registered device tokens.

        Returns count of successful sends.
        """
        if not self._enabled:
            return 0

        # Import here to avoid circular imports
        from models.paired_device import PairedDevice

        q = select(PairedDevice.push_token).where(
            PairedDevice.push_token != None,  # noqa: E711
            PairedDevice.push_token != "",
        )
        try:
            tokens = list((await db.execute(q)).scalars().all())
        except Exception:
            logger.debug("PairedDevice table not available, skipping push")
            return 0

        if not tokens:
            return 0

        sent = 0
        for token in tokens:
            if await self.send_push(token, title, body, data):
                sent += 1

        logger.info("Sent push to %d/%d devices", sent, len(tokens))
        return sent
