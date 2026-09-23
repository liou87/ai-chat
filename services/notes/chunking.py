import re

MAX_CHARS = 400
OVERLAP = 50

# Markdown 风格的标题行（"# 标题"、"## 小节"），Notion 的标题块会被提取成这种形式
HEADING = re.compile(r"^#{1,6}\s")


def chunk_text(text: str, max_chars: int = MAX_CHARS, overlap: int = OVERLAP) -> list:
    """
    把正文切成适合算 embedding 的分块：
    按换行拆成段落，顺序合并到不超过 max_chars；遇到标题行就另起一个分块，
    不同小节不会被合并到一起，否则一个分块里混了两个话题，向量会被稀释。
    连续的标题（大标题紧跟小标题）合在一起，不单独成块。
    单个段落本身超长的，按 max_chars 硬切，相邻两段重叠 overlap 个字，避免句子被切断后前后都丢上下文。
    段落合并出来的分块之间不做重叠，段落边界本身就是语义边界。
    正文为空时返回空列表，由调用方决定怎么处理。
    """
    paragraphs = [p.strip() for p in (text or "").split("\n") if p.strip()]

    chunks = []
    current = ""
    current_has_body = False  # current 里是否已经有标题之外的内容
    for para in paragraphs:
        is_heading = bool(HEADING.match(para))

        if len(para) > max_chars:
            if current:
                chunks.append(current)
                current = ""
                current_has_body = False
            step = max_chars - overlap
            for start in range(0, len(para), step):
                chunks.append(para[start:start + max_chars])
                if start + max_chars >= len(para):
                    break
            continue

        if not current:
            current = para
            current_has_body = not is_heading
        elif is_heading and current_has_body:
            # 新小节开始，前面已经有正文的分块到此为止
            chunks.append(current)
            current = para
            current_has_body = False
        elif len(current) + 1 + len(para) <= max_chars:
            current += "\n" + para
            current_has_body = current_has_body or not is_heading
        else:
            chunks.append(current)
            current = para
            current_has_body = not is_heading

    if current:
        chunks.append(current)
    return chunks
