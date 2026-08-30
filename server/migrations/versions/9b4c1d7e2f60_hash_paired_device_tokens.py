"""replace stored paired-device bearer tokens with SHA-256 digests

Revision ID: 9b4c1d7e2f60
Revises: d1e94a7c3f28
Create Date: 2026-08-30 00:00:00.000000
"""

import hashlib
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9b4c1d7e2f60"
down_revision: Union[str, Sequence[str], None] = "d1e94a7c3f28"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT id, device_token FROM paired_devices")
    ).mappings()
    for row in rows:
        token = row["device_token"]
        # Digests written by a prior run are already 64 lowercase hex bytes.
        if len(token) == 64 and all(character in "0123456789abcdef" for character in token):
            continue
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        connection.execute(
            sa.text(
                "UPDATE paired_devices SET device_token = :digest WHERE id = :device_id"
            ),
            {"digest": digest, "device_id": row["id"]},
        )


def downgrade() -> None:
    # Bearer tokens cannot and should not be reconstructed from their hashes.
    pass
