"""add trace metrics and profile_facts

Revision ID: e5a2c9f1d736
Revises: d1f6b3c8e274
Create Date: 2026-10-01 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5a2c9f1d736'
down_revision: Union[str, Sequence[str], None] = 'd1f6b3c8e274'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('agent_traces', sa.Column('duration_ms', sa.Integer(), nullable=True))
    op.add_column('agent_traces', sa.Column('prompt_tokens', sa.Integer(), nullable=True))
    op.add_column('agent_traces', sa.Column('completion_tokens', sa.Integer(), nullable=True))
    op.create_table(
        'profile_facts',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('category', sa.String(length=20), nullable=False),
        sa.Column('content', sa.String(length=300), nullable=False),
        sa.Column('source', sa.String(length=10), server_default='agent', nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('profile_facts')
    op.drop_column('agent_traces', 'completion_tokens')
    op.drop_column('agent_traces', 'prompt_tokens')
    op.drop_column('agent_traces', 'duration_ms')
