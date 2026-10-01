"""add auth_sessions and login_attempts

Revision ID: f7b1d4e8a2c3
Revises: e5a2c9f1d736
Create Date: 2026-10-01 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7b1d4e8a2c3'
down_revision: Union[str, Sequence[str], None] = 'e5a2c9f1d736'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'auth_sessions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('user_agent', sa.String(length=300), nullable=True),
        sa.Column('ip', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('last_seen_at', sa.DateTime(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token_hash'),
    )
    op.create_table(
        'login_attempts',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('ip', sa.String(length=64), nullable=True),
        sa.Column('success', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_login_attempts_ip', 'login_attempts', ['ip'])
    op.create_index('ix_login_attempts_created_at', 'login_attempts', ['created_at'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_login_attempts_created_at', table_name='login_attempts')
    op.drop_index('ix_login_attempts_ip', table_name='login_attempts')
    op.drop_table('login_attempts')
    op.drop_table('auth_sessions')
