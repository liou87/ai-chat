"""add notes.url and memory_chunks

Revision ID: d1f6b3c8e274
Revises: c8e4a7d2b519
Create Date: 2026-09-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision: str = 'd1f6b3c8e274'
down_revision: Union[str, Sequence[str], None] = 'c8e4a7d2b519'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 资料库条目的原文链接
    op.add_column('notes', sa.Column('url', sa.String(length=1000), nullable=True))
    # 对话记忆：每轮一问一答一条，带向量，HNSW 索引跟 note_chunks 一样用余弦距离
    op.create_table(
        'memory_chunks',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('embedding', Vector(512), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_memory_chunks_session_id'), 'memory_chunks', ['session_id'], unique=False)
    op.create_index(
        'ix_memory_chunks_embedding_hnsw', 'memory_chunks', ['embedding'], unique=False,
        postgresql_using='hnsw', postgresql_ops={'embedding': 'vector_cosine_ops'},
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_memory_chunks_embedding_hnsw', table_name='memory_chunks', postgresql_using='hnsw')
    op.drop_index(op.f('ix_memory_chunks_session_id'), table_name='memory_chunks')
    op.drop_table('memory_chunks')
    op.drop_column('notes', 'url')
