"""add tasks.priority and tasks.estimate_minutes

Revision ID: b3d9f2a41c07
Revises: a7c3e1f09b52
Create Date: 2026-09-28 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3d9f2a41c07'
down_revision: Union[str, Sequence[str], None] = 'a7c3e1f09b52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 已有任务一律算中优先级、没填预计时长
    op.add_column('tasks', sa.Column('priority', sa.String(length=10), server_default=sa.text("'medium'"), nullable=False))
    op.add_column('tasks', sa.Column('estimate_minutes', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('tasks', 'estimate_minutes')
    op.drop_column('tasks', 'priority')
