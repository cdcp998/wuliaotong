-- 0001：维修任务 目录改名「任务管理」（菜单数据，幂等；任务模块种子改名菜单项）
UPDATE sys_menu SET name = '任务管理'
WHERE name = '维修任务' AND module_code = 'task' AND path = '';
