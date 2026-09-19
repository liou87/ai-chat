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


def _embed_many_sync(texts: list) -> list:
    return [v.tolist() for v in _get_model().embed(texts)]


async def embed_texts(texts: list) -> list:
    """一次性给多段文本算向量（一条笔记的所有分块走这里），在线程池里跑，不阻塞事件循环。"""
    if not texts:
        return []
    return await asyncio.to_thread(_embed_many_sync, texts)


async def embed_text(text: str) -> list:
    """单段文本（比如检索的查询词）算向量。"""
    return (await embed_texts([text]))[0]
