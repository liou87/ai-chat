import asyncio
import logging
import os
import httpx

logger = logging.getLogger(__name__)

# 向量走 Voyage AI 的在线接口，不再在后端本地跑模型：部署到 Vercel 这类无服务器环境时，
# 本地模型每次冷启动都要重新加载（约 100MB），依赖也大，改成在线接口函数更轻、冷启动更快。
# voyage-4-lite 支持多语言，输出维度可选 256/512/1024/2048，这里固定 512，
# 跟 note_chunks.embedding 列（Vector(512)）一致，换模型不用改表结构。
# 注意：换了模型之后，旧向量和新向量不在同一个空间里，已有笔记要用 scripts/reembed_notes.py 重算一遍。
API_URL = "https://api.voyageai.com/v1/embeddings"
MODEL_NAME = "voyage-4-lite"
DIMENSION = 512
BATCH_SIZE = 128          # 单次请求最多带多少段文本，一条笔记的分块一般远小于这个数
MAX_RETRIES = 4           # 撞到限流（429）或服务端错误时的重试次数，免费额度的限流比较紧
TIMEOUT_SECONDS = 30


class EmbeddingError(Exception):
    """向量服务调用失败（没配 key、限流重试后仍失败、返回格式不对等）。"""


async def _request(texts: list, input_type: str) -> list:
    api_key = os.getenv("VOYAGE_API_KEY")
    if not api_key:
        raise EmbeddingError("没有配置 VOYAGE_API_KEY")

    payload = {"input": texts, "model": MODEL_NAME, "input_type": input_type, "output_dimension": DIMENSION}
    headers = {"Authorization": f"Bearer {api_key}"}
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
        for attempt in range(MAX_RETRIES + 1):
            resp = await client.post(API_URL, json=payload, headers=headers)
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt == MAX_RETRIES:
                    break
                # 优先听服务端的 Retry-After，没有就指数退避：1s、2s、4s、8s
                wait = float(resp.headers.get("retry-after") or 2 ** attempt)
                logger.warning(f"向量接口返回 {resp.status_code}，{wait:.0f}s 后重试（第 {attempt + 1} 次）")
                await asyncio.sleep(wait)
                continue
            if resp.status_code >= 400:
                raise EmbeddingError(f"向量接口返回 {resp.status_code}：{resp.text[:200]}")
            data = resp.json()["data"]
            # 按 index 排回请求顺序，不假设服务端一定按顺序返回
            return [item["embedding"] for item in sorted(data, key=lambda d: d["index"])]
    raise EmbeddingError(f"向量接口多次重试后仍失败（{resp.status_code}）")


async def embed_texts(texts: list) -> list:
    """给笔记的分块算向量（input_type=document），超过 BATCH_SIZE 的分批请求。"""
    if not texts:
        return []
    vectors = []
    for i in range(0, len(texts), BATCH_SIZE):
        vectors.extend(await _request(texts[i:i + BATCH_SIZE], input_type="document"))
    return vectors


async def embed_text(text: str) -> list:
    """给检索的查询词算向量（input_type=query）：Voyage 对查询和文档用不同的前缀处理，检索效果更好。"""
    return (await _request([text], input_type="query"))[0]
