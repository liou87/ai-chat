"""
统一的"现在几点"：按用户所在时区算，不依赖服务器本地时区。

Railway 这类部署平台默认是 UTC，直接用 datetime.now() 的话，提醒会晚好几个小时触发，
每天 8 点的简报/热点也不是用户那边的 8 点，"今天到期"的判断也会错位。
时区用环境变量 APP_TIMEZONE 配置（IANA 名字，比如 Australia/Sydney、Asia/Shanghai），
默认悉尼；zoneinfo 会自动处理夏令时。人换了地方改这个变量就行，前端 datetime-local
控件给的时间是浏览器本地时间，两边要一致。
数据库里存的仍然是不带时区的 datetime（按这个时区解释），这是个人单用户工具，够用；
Notion 同步用的 external_updated_at 是来源系统的 UTC 时间，不走这里。
"""
import os
from datetime import datetime, date
from zoneinfo import ZoneInfo

TZ = ZoneInfo(os.getenv("APP_TIMEZONE", "Australia/Sydney"))


def now() -> datetime:
    """用户时区的当前时间，不带 tzinfo，跟库里存的 naive datetime 可以直接比较。"""
    return datetime.now(TZ).replace(tzinfo=None)


def today() -> date:
    return now().date()


def to_local(dt):
    """
    把外部传进来的时间统一成不带时区的用户本地时间：带时区的（比如 agent 给的 ...+10:00 或 ...Z）先换算，
    不带时区的（前端 datetime-local 控件给的）本来就是本地时间，原样返回。None 也原样返回。
    """
    if dt is None or dt.tzinfo is None:
        return dt
    return dt.astimezone(TZ).replace(tzinfo=None)
