import logging
from services.llm import get_client, MODEL_NAME

logger = logging.getLogger(__name__)

TITLE_MAX_LEN = 20


async def generate_title(first_message: str) -> str | None:
    """
    根据新会话的第一句话起一个简短标题，替代"截取前 20 个字"。
    只看第一句话、不等回复，这样可以跟 agent 回复并行跑，回复结束时标题基本已经好了。
    失败就返回 None，调用方保留原来截取的标题。
    """
    try:
        response = await get_client().chat.completions.create(
            model=MODEL_NAME,
            messages=[{
                "role": "user",
                "content": "用不超过 12 个字概括下面这句话想聊的主题，作为对话标题。"
                           "只输出标题本身，不要引号、不要标点结尾。\n\n" + first_message[:500],
            }],
            # deepseek-flash 会先推理再输出，max_tokens 算上推理部分，给小了正文会是空的
            max_tokens=600,
        )
        title = (response.choices[0].message.content or "").strip().strip("\"'「」《》").strip()
        return title[:TITLE_MAX_LEN] or None
    except Exception:
        logger.warning("生成会话标题失败，保留截取的标题", exc_info=True)
        return None
