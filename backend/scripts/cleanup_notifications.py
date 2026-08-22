"""清理历史通知残留（用户确认方案①）：
1. 删除测试数据「通知测试」（biz_type=测试）
2. 删除 7 天前的 低库存/高库存 预警（避免海量重复刷屏堆积；保留最近 7 天真实预警）
3. 删除历史误标为「预警」的「领用已完成工作待审计」（老数据无法与单据状态联动，新流程已改为
   biz_type=待办 + link 联动 + 审计完成自动已读，故历史残留直接清掉）

幂等：按条件删除，可重复执行。执行前打印将删数量。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text

from app.db import SessionLocal

db = SessionLocal()
try:
    def _count(where: str) -> int:
        return db.execute(text(f"SELECT COUNT(*) FROM sys_notification WHERE {where}")).scalar() or 0

    def _delete(where: str) -> int:
        n = _count(where)
        if n:
            db.execute(text(f"DELETE FROM sys_notification WHERE {where}"))
            db.commit()
        return n

    n1 = _delete("biz_type = '测试'")
    print(f"① 删除测试通知：{n1} 条")

    n2 = _delete("biz_type = '预警' AND title IN ('低库存','高库存') AND created_at < NOW() - INTERVAL 7 DAY")
    print(f"② 删除 7 天前的低/高库存预警：{n2} 条")

    n3 = _delete("title = '领用已完成工作待审计' AND biz_type = '预警'")
    print(f"③ 删除历史误标预警的待审计通知：{n3} 条")

    total = db.execute(text("SELECT COUNT(*) FROM sys_notification")).scalar()
    print(f"清理完成，剩余 {total} 条")
finally:
    db.close()
