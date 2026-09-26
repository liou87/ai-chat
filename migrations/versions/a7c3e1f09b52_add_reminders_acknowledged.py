"""add reminders.acknowledged

Revision ID: a7c3e1f09b52
Revises: e195c2c9d4d3
Create Date: 2026-09-27 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c3e1f09b52'
down_revision: Union[str, Sequence[str], None] = 'e195c2c9d4d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 已有的提醒一律当作未读（false），跟以前"到期就弹"的行为一致
    op.add_column('reminders', sa.Column('acknowledged', sa.Boolean(), server_default=sa.text('false'), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('reminders', 'acknowledged')
