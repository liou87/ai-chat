"""add message_feedback and eval_candidates

Revision ID: a9c4e2f7b813
Revises: f7b1d4e8a2c3
Create Date: 2026-10-05 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a9c4e2f7b813'
down_revision: Union[str, Sequence[str], None] = 'f7b1d4e8a2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'message_feedback',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=False),
        sa.Column('turn_index', sa.Integer(), nullable=False),
        sa.Column('rating', sa.String(length=10), nullable=False),
        sa.Column('reason', sa.String(length=20), nullable=True),
        sa.Column('comment', sa.String(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('session_id', 'turn_index', name='uq_feedback_turn'),
    )
    op.create_index('ix_message_feedback_session_id', 'message_feedback', ['session_id'])
    op.create_table(
        'eval_candidates',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=False),
        sa.Column('turn_index', sa.Integer(), nullable=False),
        sa.Column('note', sa.String(length=500), nullable=True),
        sa.Column('exported', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('session_id', 'turn_index', name='uq_candidate_turn'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('eval_candidates')
    op.drop_index('ix_message_feedback_session_id', table_name='message_feedback')
    op.drop_table('message_feedback')
