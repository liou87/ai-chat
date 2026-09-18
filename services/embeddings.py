import asyncio
import logging
from fastembed import TextEmbedding

logger = logging.getLogger(__name__)

# 中文小模型，~90MB，个人笔记规模够用，首次调用时才会下载/加载（懒加载，不拖慢应用启动）
MODEL_NAME = "BAAI/bge-small-zh-v1.5"

_model = None


def _get_model() -> TextEmbedding:
    global _model
    if _model is None:
        logger.info(f"加载 embedding 模型：{MODEL_NAME}")
        _model = TextEmbedding(model_name=MODEL_NAME)
    return _model


def _embed_sync(text: str) -> list:
    vector = list(_get_model().embed([text]))[0]
    return vector.tolist()


async def embed_text(text: str) -> list:
    """在线程池里跑 CPU 密集的 embedding 推理，不阻塞事件循环。"""
    return await asyncio.to_thread(_embed_sync, text)
