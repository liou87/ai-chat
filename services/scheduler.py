import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from database import SessionLocal
from services import reminders as reminders_service

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def _check_due_reminders():
    async with SessionLocal() as db:
        due = await reminders_service.mark_due_as_fired(db)
        if due:
            logger.info(f"触发 {len(due)} 条到期提醒：{[r['message'] for r in due]}")


def start_scheduler():
    scheduler.add_job(_check_due_reminders, "interval", seconds=60, id="check_due_reminders")
    scheduler.start()
    logger.info("提醒调度器已启动，每 60 秒扫描一次")


def stop_scheduler():
    scheduler.shutdown(wait=False)
