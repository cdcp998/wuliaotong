# 采购计划单（设计页 18） —— 设计基准 vs 实机截图 视觉比对

The user wants me to compare two images of a "采购计划单" (Purchase Plan) page. Image 1 is the "design benchmark" (OpenPencil), Image 2 is the "actual implementation" screenshot at 1440 viewport. I need to check specific points and output in a specific format.

Let me carefully compare the two images.

**Checkpoint 1: Page Header**
- Title + subtitle: "计划 → 材料入库（送货单图片最多 10 张）闭环；状态：草稿/已提交/部分入库/已完成/作废"
- Right side "新建计划" primary button

In Image 1 (design):
- Title: "采购计划单"
- Subtitle: "计划 → 材料入库（送货单图片最多 10 张）闭环；状态：草稿/已提交/部分入库/已完成/作废"
- Right button: "新建计划" blue button

In Image 2 (implementation):
- Title: "采购计划单"
- Subtitle: "计划 → 材料入库（送货单图片最多 10 张）闭环；状态：草稿/已提交/部分入库/已完成/作废"
- Right button: "新建计划" blue button

So header seems mostly consistent. BUT in the implementation, there's also a top nav bar above with breadcrumbs "物料通 / 采购计划单" and a search bar. The design doesn't have this top nav? Actually looking at Image 1, there is no top nav bar. The design shows just the sidebar and the main content area directly. In Image 2, there's an additional top header bar with a hamburger menu, breadcrumb, search input, notification bell, and user avatar.

Wait, but the design might show the page content only, and the implementation has additional global navigation. Since the instruction says "同页面的实际实现截图", I should note this difference? But the checkpoints don't mention the top nav. However, checkpoint 1 is about the page header specifically. The page header (title+subtitle+button) seems to be in the correct position. But the implementation has an extra global header above it. Should I note this as a "多余元素"? The design doesn't have that top bar. But the design might be showing just the content area, not the whole page chrome. Hmm. Let me re-read the checkpoint: "页头：标题+副题... +右侧「新建计划」主按钮". This suggests checking the page header area. I'll note the extra global header as a difference if it's not in the design.

Let me look more carefully at Image 1. There is a sidebar on the left with logo "物料通", menu items grouped: "工作台", "基础资料", "库存与采购", "系统管理". The main content area starts with the title "采购计划单" and subtitle. There is NO top navigation bar (no breadcrumb, no search, no notification, no user avatar) in Image 1.

In Image 2, there IS a top bar with:
- Hamburger menu icon
- Breadcrumb: 物料通 / 采购计划单
- Search box: "搜索材料 / 单号 / 条码..."
- Bell icon
- User avatar "超级管理员 超级管理员"

This is an extra element not present in the design. The sidebar in Image 2 also differs: it has a "搜索导航..." input at the top, "全部收缩" toggle, and a different menu structure. The design's sidebar has "物料通" logo at top-left, top-level items "工作台", "基础资料", "库存与采购", "系统管理". The implementation's sidebar has a search box, "全部收缩", then menu items with expandable groups. This is a significant difference but the checkpoint doesn't specifically ask about the sidebar. Still, I should mention it as "多余元素" or layout difference if it affects the overall layout.

But wait, the instruction says "指出图2 与图1 的可见差异（布局位置/缺失元素/多余元素/样式明显不符）" and the checkpoints are specific. I think I should focus on the checkpoints but also mention obvious extra elements like the top global nav and sidebar differences if they are visible differences.

**Checkpoint 2: Filter bar**
- Search 300 (计划单号/材料)
- Status 170
- "共 N 张"

In Image 1:
- Search input: "计划单号 / 材料" with a search icon. Width appears to be about 300px.
- Status dropdown: "全部状态" with an up/down chevron icon. Width appears about 170px.
- Right side: "共 12 张" text.

In Image 2:
- Search input: "计划单号 / 材料" with search icon. Looks similar width.
- Status dropdown: "全部状态" with a down chevron. Looks similar width.
- Right side: "共 1 张" text.

The filter bar itself matches. The "共 N 张" in Image 2 is "共 1 张" while design is "共 12 张" - but that's data, not a style difference. The position seems consistent.

Actually wait, in Image 1, the search input placeholder is "计划单号 / 材料", and in Image 2 it's also "计划单号 / 材料". Good.

**Checkpoint 3: Table columns**
- 计划单 (brand blue bold)
- 编制人
- 材料
- 数量
- 已入库 (green)
- 申请日期 (MM-DD)
- 状态胶囊
- 操作 (入库·详情 links)

In Image 1:
- Column headers: 计划单, 编制人, 材料, 数量, 已入库, 申请日期, 状态, 操作
- "计划单" header is blue and bold.
- "已入库" header is green.
- Data rows:
  - PL-2026-0012, 王经理, 光缆 GYTA-24B1.3, 100m, 52m, 07-15, 部分入库 (blue capsule), 入库 详情
  - PL-2026-0011, 李主任, 电力电缆 YJV22-4×95, 200m, 0, 07-14, 已提交 (orange capsule), 入库 详情
  - PL-2026-0010, 张老板, 网线 超六类, 40 箱, 40 箱, 07-10, 已完成 (green capsule), 入库 详情
  - PL-2026-0009, 陈师傅, 导电膏 25g, 120 支, 0, 07-08, 已作废 (gray capsule), 入库 详情

In Image 2:
- Column headers: 计划单, 编制人, 材料, 数量, 已入库, 申请日期, 状态, 操作
- "计划单" header is blue and bold? Let me look closely. It appears blue and bold in Image 2 as well.
- "已入库" header is green? It appears green in Image 2.
- Data row:
  - JH202608220001, 超级管理员, 光纤红光笔, 10件, 0件, 08-22, 已作废 (gray capsule), 入库 详情

Table layout seems consistent. But the data is different (only one row, different ID format). The ID format in Image 1 is "PL-2026-0012" while Image 2 is "JH202608220001". This is a data difference, not a UI difference, but it's worth noting if it's a discrepancy with the design. The design uses "PL-2026-XXXX" format. The implementation uses a different format. However, the design benchmark might not mandate specific data format; but the instruction says "样式明显不符", and data format might be considered content. I'll mention it as a minor observation.

Actually, let me re-read: "图1 是 OpenPencil 设计基准图，图2 是同页面的实际实现截图（1440 视口实机）". So the design is a mockup with sample data, the implementation has real data. The comparison is for UI, not data content. So data differences in cell values are expected and not necessarily "differences".

But there are some UI differences I need to identify:

1. **Top global bar**: Image 2 has an extra top navigation bar (breadcrumb, search, notification, user avatar) that is not in Image 1. This is a clear extra element.

2. **Sidebar differences**: 
   - Image 1 sidebar has no search input, no "全部收缩". It has logo "物料通" at top with subtitle "企业物资管理平台".
   - Image 2 sidebar has a search input "搜索导航...", "全部收缩" toggle, logo "物料通" with "MATERIAL FLOW" subtitle, and a different menu structure. The menu in Image 2 has expandable groups (基础资料 has sub-items like 物料数据管理, 单位管理, etc.). Actually, Image 1 also has sub-items: 物料数据管理 is under "基础资料"? Let me look at Image 1's sidebar:
     - 工作台
     - 基础资料
       - 物料数据管理
     - 库存与采购
       - 仓库与货架
       - 采购计划单
       - 材料入库
       - 领用审计
     - 系统管理
       - 用户管理
       - 系统设置
   
   Image 2's sidebar:
     - 搜索导航...
     - 全部收缩
     - 工作台
     - 基础资料 (expanded)
       - 物料数据管理
       - 单位管理
       - 供应商管理
       - 材料单位管理
       - 删除审核
     - 入库管理 (expanded)
       - 采购计划单
       - 材料入库
     - 库存管理 (expanded, partially visible)
       - 库存查询
       - 库存变动
   
   So the implementation has additional menu items and a different grouping. This is a big difference but not in the checkpoints. The instruction says "逐项对照下列检查点", so I should focus on the checkpoints. However, the overall task says "指出图2 与图1 的可见差异（布局位置/缺失元素/多余元素/样式明显不符）". I can mention the sidebar and top bar as "多余元素" because they affect the overall layout, but the checkpoints are the priority. I'll include them as additional observations or in the "不符合" section if they are visible differences.

3. **Table row height / spacing**: Looking at Image 1, the table has more vertical padding per row. Image 2's row seems to have less padding? Actually Image 2's table has a single row and seems more compact. But this could be because Image 1 shows 4 rows while Image 2 shows 1 row. The row height in Image 2 appears similar.

4. **Status capsule colors**: 
   - Image 1: 部分入库 (blue outline/filled?), 已提交 (orange), 已完成 (green), 已作废 (gray)
   - Image 2: 已作废 (gray)
   The colors seem consistent (gray for 已作废). But wait, in Image 1, "部分入库" is a blue capsule, "已提交" is orange, "已完成" is green, "已作废" is gray. In Image 2, "已作废" is gray. Looks consistent.

5. **操作 column**: Both have "入库" and "详情" as clickable links. Consistent.

6. **Font sizes and styles**: 
   - Image 1 title "采购计划单" appears larger and bolder than Image 2? Let me compare. Image 1 title is maybe 20px, Image 2 title looks similar. Actually Image 2's title might be slightly smaller? Hard to tell. The subtitle in Image 2 is smaller and less prominent than in Image 1? In Image 1, the subtitle is directly below the title, same font size as regular text. In Image 2, it's also below the title but appears slightly smaller and grayish. Actually in Image 1, the subtitle is dark gray, in Image 2 it's lighter gray. Minor.

7. **Pagination/Footer**: Image 2 has a pagination bar at the bottom right: "共 1 条 < 1 > 20 条/页". Image 1 does not show pagination (probably because it's cut off or design doesn't include it). This is an extra element in Image 2. Actually, Image 1 shows the table with 4 rows and the page seems to end there; no pagination visible. Image 2 has a pagination bar. This is an extra element.

8. **Search input in filter bar**: In Image 1, the search input has a search icon on the left. In Image 2, it also has a search icon. But in Image 2, the search input is inside a container that appears to be a rounded rectangle with the search icon. Looks consistent.

9. **"共 N 张" position**: In Image 1, it's at the far right of the filter bar. In Image 2, it's also at the far right. Consistent.

10. **Button "新建计划"**: Both are blue buttons with a plus icon and text. In Image 2, the button is in the top right of the page header area. Consistent.

Now, let me think about what to report. The user specifically asked to check the 3 checkpoints. I should report:

【符合】- things that match
【不符合】- differences with screen area
【建议】- prioritized fix suggestions

Let me be strict about the checkpoints:

**Checkpoint 1: Page header**
- The title, subtitle, and button exist and are positioned correctly in both. However, in Image 2, there is an additional global top bar above the page header. The subtitle in Image 2 might have slightly different styling (smaller, lighter). But overall, the checkpoint is mostly met.

Wait, let me re-examine the subtitle in Image 2 vs Image 1.
Image 1 subtitle: "计划 → 材料入库（送货单图片最多 10 张）闭环；状态：草稿/已提交/部分入库/已完成/作废"
Image 2 subtitle: "计划 → 材料入库（送货单图片最多 10 张）闭环；状态：草稿/已提交/部分入库/已完成/作废"
Text is identical. Style looks similar (gray text below title). Good.

**Checkpoint 2: Filter bar**
- Search 300, status 170, "共 N 张"
- In Image 2, the search input placeholder is "计划单号 / 材料" which matches. The status dropdown shows "全部状态". The "共 N 张" shows "共 1 张" instead of "共 12 张" (data difference).
- The widths: In Image 1, search input appears to be about 300px wide, status about 170px. In Image 2, they look similar in proportion. Good.

**Checkpoint 3: Table columns**
- "计划单" in Image 2 is blue and bold? Let me zoom in mentally. In Image 2, "计划单" header is blue and bold. "已入库" is green. Yes, matches.
- The table has all 8 columns in the correct order.
- Status capsule style: The "已作废" capsule in Image 2 has a gray background with gray text. In Image 1, the "已作废" capsule is also gray. Consistent.
- Operation links: "入库" and "详情" are present and styled as links (blue). In Image 1, they are blue, in Image 2 they are also blue.

Wait, but there's a subtle difference in the table header. In Image 1, the "计划单" header text is blue and bold. In Image 2, it's also blue and bold. Let me confirm by looking at the image. Yes, both appear blue and bold.

Now, what are the actual differences?

**Differences I can identify:**

1. **Global top bar (多余元素)**: Image 2 has a top navigation bar with breadcrumb (物料通 / 采购计划单), a global search input ("搜索材料 / 单号 / 条码..."), a notification bell, and a user avatar. Image 1 does not have this top bar.

2. **Sidebar (多余元素/布局差异)**: 
   - Image 2 sidebar has a search input ("搜索导航..."), "全部收缩" toggle, and a different menu structure with additional items and collapsible groups.
   - Image 1 sidebar is simpler, with logo "物料通" at top, and menu items without search/expand controls.
   - The logo in Image 2 includes "MATERIAL FLOW" subtitle, Image 1 has "企业物资管理平台" subtitle.
   - Image 2 sidebar has a scrollbar on the right, Image 1 does not.

3. **Pagination bar (多余元素)**: Image 2 has a pagination bar at the bottom right: "共 1 条 < 1 > 20 条/页". Image 1 does not show this.

4. **表头样式**: Let me look again. In Image 1, the "已入库" header is green with a specific shade. In Image 2, "已入库" is also green. However, in Image 2, there seems to be a "已入库" cell value "0件" in green text. In Image 1, "已入库" values are "52m", "0", "40箱", "0" - not all green. Wait, in Image 1, the "已入库" column values are black/dark text, not green. Only the header "已入库" is green. In Image 2, the value "0件" appears to be green text as well? Let me look at Image 2's table: under "已入库" column, the value "0件" is in green color. Actually, looking closely at Image 2, "0件" is green. In Image 1, the values under 已入库 are black. This might be a styling difference: in the implementation, the 已入库 value is green, but in the design it's black. Or maybe it's intentionally green
