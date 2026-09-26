import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from database import SessionLocal
from services import clock
from services import reminders as reminders_service
from services import digest as digest_service
from services import hot_topics as hot_topics_service

logger = logging.getLogger(__name__)

# 定时任务按用户时区排（services/clock.py），不然部署在 UTC 服务器上"每天 8 点"不是用户那边的 8 点
scheduler = AsyncIOScheduler(timezone=clock.TZ)


async def _check_due_reminders():
    async with SessionLocal() as db:
        due = await reminders_service.mark_due_as_fired(db)
        if due:
            logger.info(f"触发 {len(due)} 条到期提醒：{[r['message'] for r in due]}")


async def _generate_daily_digest():
    async with SessionLocal() as db:
        result = await digest_service.get_or_create_today_digest(db)
        logger.info(f"生成每日简报：{result['content'][:50]}")


async def _generate_hot_topics():
    async with SessionLocal() as db:
        result = await hot_topics_service.get_or_create_today_topics(db)
        logger.info(f"生成今日 AI 热点：{len(result['items'])} 条")


def start_scheduler():
    scheduler.add_job(_check_due_reminders, "interval", seconds=60, id="check_due_reminders")
    # 每天早上 8 点主动生成一份简报和一份热点，不用等用户开口；用户当天第一次打开页面时如果
    # 这两条还没跑，接口自己也会现算一份，两边共用同一个函数，不会重复生成
    scheduler.add_job(_generate_daily_digest, "cron", hour=8, minute=0, id="generate_daily_digest")
    scheduler.add_job(_generate_hot_topics, "cron", hour=8, minute=5, id="generate_hot_topics")
    scheduler.start()
    logger.info("提醒调度器已启动，每 60 秒扫描一次；每日简报和 AI 热点调度器已启动，每天 8:00/8:05 生成")


def stop_scheduler():
    scheduler.shutdown(wait=False)
