# 工具注册表按模块拆成几个文件：tasks_tools.py / notes_tools.py / reminders_tools.py / websearch_tools.py，
# 每个文件是自己模块的 JSON Schema 定义加对应的处理函数。这里汇总成对外统一的
# TOOL_SCHEMAS / TOOL_HANDLERS，services/agent.py 的循环只需要认这两个名字，不关心工具具体分在哪个文件里。
from .tasks_tools import TOOLS as _TASKS_TOOLS
from .notes_tools import TOOLS as _NOTES_TOOLS
from .reminders_tools import TOOLS as _REMINDERS_TOOLS
from .websearch_tools import TOOLS as _WEBSEARCH_TOOLS

TOOLS = _TASKS_TOOLS + _NOTES_TOOLS + _REMINDERS_TOOLS + _WEBSEARCH_TOOLS
TOOL_SCHEMAS = [t["schema"] for t in TOOLS]
TOOL_HANDLERS = {t["schema"]["function"]["name"]: t["handler"] for t in TOOLS}
