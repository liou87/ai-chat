# Spec：笔记库接入 Notion（只读导入，方案 A）

状态：技术细节已确认，实施前依赖数据库迁移先完成
关联需求：笔记模块能检索到 Notion 里已有的内容，本地仍是唯一的写入入口
依赖：docs/specs/postgres-pgvector-migration.md，这份 spec 里的建表方式问题已经被数据库迁移取代——新表结构会直接在 Postgres 上通过 Alembic 建出来，不再有删库重建还是手写 ALTER TABLE 的选择

## 1. 背景与目标

用户在 Notion 里已经有笔记习惯，希望这些内容也能被 agent 的语义检索找到，不用把东西重新抄一遍进这个项目。目标是把指定 Notion 数据库里的页面拉进本地 notes 表，走一遍和本地笔记一样的 embedding 流程，检索的时候本地笔记和 Notion 笔记一视同仁。

不做双向：本地新建、编辑、删除的笔记不会推回 Notion；Notion 那边新增、编辑的内容需要手动触发一次同步才会体现到本地。

## 2. 范围

这次做的事：从一个指定的 Notion 数据库拉取页面，导入或更新到本地 notes 表；页面正文里的纯文本类内容（段落、标题、列表、引用、待办）会被抓取，图片、表格、嵌套子页面等暂不处理；增量同步，Notion 页面没改过就跳过，不重复算 embedding；触发方式是手动的，聊天里让 agent 同步，或者笔记面板里点一个按钮。

这次不做的事：Notion 到本地的删除同步，Notion 页面删了本地对应笔记不会自动跟着删；本地到 Notion 的任何写入；定时自动同步，不做轮询也不做 webhook；多个 Notion 数据库或页面源，先只支持一个。

## 3. 前置条件

以下是用户需要自己完成的部分，不是代码里能自动化的：去 notion.so/my-integrations 建一个内部集成，拿到 secret token；准备一个 Notion 数据库放笔记，这个数据库要有一个 title 类型的属性，Notion 数据库默认都有；把这个数据库分享给上面建的集成，没分享的内容 API 读不到，这是 Notion 的权限模型；拿到数据库的 ID，也就是数据库页面网址里那 32 位的一段。

对应的环境变量：

| 变量 | 说明 |
|---|---|
| NOTION_API_KEY | 集成的 secret token |
| NOTION_DATABASE_ID | 要同步的数据库 ID |

## 4. 数据模型

notes 表新增三个字段，跟着数据库迁移的 Alembic 初始迁移一起建出来，不需要单独处理已有表结构：

| 字段 | 类型 | 说明 |
|---|---|---|
| source | 字符串，默认 local | local 或 notion，标记这条笔记是哪来的 |
| external_id | 字符串，可空，建索引 | Notion 页面 id，本地笔记这个字段是空的 |
| external_updated_at | 时间，可空 | Notion 页面的 last_edited_time，原样存 UTC，不转本地时区，用来判断要不要重新导入 |

## 5. Notion API 调用流程

用 httpx 直连 REST API，跟 services/websearch.py 一个写法，不引入 notion-client 这个官方 SDK，固定带 Notion-Version: 2025-09-03 请求头（Notion 今年把数据库查询迁移到了新的 data_sources 端点，用旧的按 database id 查询的接口会走废弃路径）。

第一步，拿 data_source_id：请求 GET /v1/databases/{数据库 ID}，响应里 data_sources 数组第一项的 id 就是。这一步结果在同步开始时缓存在内存里，一次同步只需要查一次。

第二步，分页拉页面列表：请求 POST /v1/data_sources/{data_source_id}/query，body 带 page_size 和 start_cursor（第一页不传 cursor），响应里的 results 是页面对象数组，还有 has_more 和 next_cursor 用于翻页。每个页面对象里，id 是页面 id，last_edited_time 是最后编辑时间，properties 里要找 type 为 title 的那个属性取标题文本——按类型找而不是按属性名字找，因为默认叫 Name 的这个属性经常被用户改名，但类型为 title 的属性在每个数据库里有且只有一个，这个规则是 Notion 自己保证的。

第三步，拉每个页面的正文：请求 GET /v1/blocks/{页面 id}/children，同样要分页。只处理这几种 block 类型：段落、一二三级标题、无序列表项、有序列表项、引用、待办事项。每种类型下面有个 rich_text 数组，取里面每一项的纯文本拼起来，各个 block 之间用换行分隔。其他类型的 block，比如图片、表格、子页面、代码块，先跳过，不报错。

## 6. 同步算法

大致逻辑，落在 services/notion.py 的 sync_notion_notes(db) 函数里：先拿一次 data_source_id；然后分页遍历所有页面，对每个页面，先按 external_id 查本地有没有对应记录——没有就拉正文、新建一条本地笔记（category 是 note，source 是 notion），计入新增；有的话再比较 Notion 的 last_edited_time 和本地存的 external_updated_at，如果 Notion 那边更新过，就重新拉正文、更新这条本地记录，计入更新；如果没更新过，跳过，计入跳过。翻完所有页之后，返回一个汇总，新增了多少条、更新了多少条、跳过了多少条。

services/notes.py 里新增一个 upsert_note_from_external 函数，接收 external_id、title、content、external_updated_at，内部逻辑和现有的 create_note 基本一致，都要算 embedding、写库，区别是这个函数会先按 external_id 查一遍，存在就更新对应行而不是插入新行。

## 7. 对外接口

agent 工具方面，services/tools.py 新增 sync_notion_notes，不需要参数，返回同步结果的汇总，方便在聊天里说一句"同步一下 Notion 笔记"就能触发，agent 拿到结果后用自然语言回复。

REST 接口方面，routers/notes.py 新增 POST /api/notes/sync-notion，内部直接调用 sync_notion_notes，返回同样的汇总 JSON，给前端按钮用。

前端方面，笔记面板（卡片视图和全页视图）加一个"同步 Notion"按钮，点击后调用上面这个接口，同步完成后刷新笔记列表，按钮旁边可以显示一下这次导入、更新了多少条。

## 8. 错误处理

没配置 NOTION_API_KEY 或 NOTION_DATABASE_ID 的时候，sync_notion_notes 直接返回一个"未配置 Notion 集成"的错误提示，不抛异常，跟 web_search 处理缺 key 的方式一致。Notion API 请求失败，比如网络错误、权限不够、数据库 id 不对，捕获异常后返回具体的失败原因，同步到目前为止已经成功导入的部分不回滚，部分成功也算成功。单个页面拉正文失败的话，跳过这一页，计入一个新的失败计数，不影响其它页面继续同步。

## 9. 验证计划

用一个真实的 Notion 数据库，放两三个测试页面，混合不同的 block 类型，跑一次同步，检查数量和内容是否正确。改其中一个页面的内容，再跑一次同步，确认只有改过的那条被更新，其余的走跳过、不重新算 embedding，可以在日志里确认没有重复调用 embedding 服务。做一次语义搜索，搜一个只在 Notion 那条笔记里出现的关键词，确认能搜到。最后在不配置 NOTION_API_KEY 的情况下调用同步，确认返回的是明确的未配置提示，而不是服务器错误。
