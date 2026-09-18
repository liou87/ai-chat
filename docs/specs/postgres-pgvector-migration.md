# Spec：数据库迁移，SQLite → PostgreSQL + pgvector

状态：已完成并验证
背景：为了给 Notion 同步之后的 RAG 检索打好底子，把现在暴力算余弦相似度的检索方式换成 pgvector 原生的向量索引，顺带把数据库从 SQLite 换成更正式的 PostgreSQL，并且补上 Alembic 迁移工具。

## 1. 目标

用 PostgreSQL 替换 SQLite，作为唯一的数据库。笔记的 embedding 从 JSON 字符串塞进 Text 列，改成 pgvector 原生的向量列类型。语义检索从 Python 里手写余弦相似度循环，改成数据库端的向量索引查询。引入 Alembic，以后加字段、改表结构不用再手动写迁移或者删库重建。

## 2. 范围

这次做的事：换引擎（sqlite+aiosqlite 换成 postgresql+asyncpg）；notes 表的 embedding 列改成 512 维向量类型（512 维对应现在用的 BAAI/bge-small-zh-v1.5 模型），顺带把 Notion 同步 spec 里定好的三个字段（source、external_id、external_updated_at）也一起建了，不用再单独迁移一次；search_notes 重写成一条 SQL 查询，用 pgvector 的余弦距离操作符，不再是查全表加 Python 循环算相似度；给 embedding 列建 HNSW 向量索引；接入 Alembic，把 6 张表生成一版初始迁移。

这次不做的事：部署到 Railway 的具体配置，之后单独弄；其他表的字段类型优化，比如 agent_traces 表的 payload 字段现在是 Text 存 JSON，理论上可以换成 Postgres 原生的 JSONB 类型，但这次不顺带做，范围会滚雪球；旧数据迁移，已经确认不做。

## 3. 数据库托管方式：从本地 Docker 改成 Supabase

原计划是本地用 Docker Compose 起一个 pgvector/pgvector 镜像的 Postgres，但实施的时候本机 Docker Desktop 起不来（根因是 WSL2 没装发行版），临时改用 Supabase 的免费云端 Postgres，好处是不用折腾本机环境，坏处是本地开发需要联网。Supabase 默认已经支持 pgvector，本地只要执行一次 `CREATE EXTENSION IF NOT EXISTS vector` 就能用。

连接方式选的是 Supabase 的 Session pooler（不是 Transaction pooler）：项目是长期运行的 FastAPI 进程，用的是标准连接池，Session pooler 既兼容 IPv4，又支持 asyncpg 依赖的 prepared statement，Transaction pooler 在这块会有兼容问题。

## 4. 为什么选 HNSW 索引，不是 IVFFlat

pgvector 支持两种近似最近邻索引。IVFFlat 建索引前需要用现有数据训练聚类中心，数据量太少的时候效果差，后续数据分布变化大了还要重建索引才能保持效果。HNSW 不需要预先训练，边插入数据边建图，数据量从几十条到几百万条都能用，代价是索引本身占内存更多，建索引也比 IVFFlat 慢一点。

这个项目的数据会从个人规模慢慢涨，尤其加了 Notion 同步之后，用 HNSW 不用在"数据够不够训练"这件事上操心，是更省心的选择。

## 5. 技术改动清单

依赖方面，requirements.txt 去掉 aiosqlite，加上 asyncpg（Postgres 异步驱动）、pgvector（提供 SQLAlchemy 的向量类型）、alembic。

database.py 这边，engine 从读死的 sqlite 文件路径改成读 DATABASE_URL 环境变量；init_db() 现在只负责确保 pgvector 扩展存在，不再调用 create_all 建表——表结构完全交给 Alembic 管，避免两边各管一套互相打架；Note 模型的 embedding 字段类型从 Text 改成 pgvector 提供的 Vector(512)，另外声明了一个 HNSW 索引（用 cosine 距离）。

services/embeddings.py 这边，embed_text 逻辑不变，还是用 fastembed 算向量，但不再需要把结果序列化成字符串，直接是一个浮点数列表，SQLAlchemy 的向量类型能直接接住；手写的 cosine_similarity 函数删掉，改由数据库算。

services/notes.py 这边，create_note 里 embedding 直接存原始向量，不再做序列化；search_notes 改写成一条 SQL 查询，用 Note.embedding.cosine_distance(query_embedding) 排序取 top_k，返回的距离用 1 减去它换算成相似度分数，跟迁移前前端展示的分数含义保持一致，前端不用改。

Alembic 方面，env.py 接上了项目的 Base.metadata，用标准的异步引擎适配写法（run_sync）跑迁移；第一版迁移用 autogenerate 生成，覆盖全部 6 张表和 HNSW 索引；以后任何表结构改动都走"改 model，autogenerate，检查生成的迁移文件，upgrade"这条路。

有个坑记一下：autogenerate 生成的迁移文件里，涉及 Vector 类型的列会写成 pgvector.sqlalchemy.vector.VECTOR(dim=512)，但文件顶部不会自动加 import pgvector.sqlalchemy，直接跑会报 NameError。以后每次 autogenerate 涉及 notes 表的改动，生成完先检查一下这个 import 有没有漏，手动补上。

## 6. 对外接口有没有变化

没有变化。services/tools.py 里 save_note、search_notes 这些工具函数的签名不变，routers/notes.py 的 REST 接口和响应格式不变，前端一行代码都不用改。这次改动完全在存储层内部，是"服务层把存储细节封装住"这个设计第一次真正发挥作用的地方。

## 7. 验证结果

迁移已经跑通并且验证过：Alembic 初始迁移在 Supabase 上成功建出全部 6 张表和 HNSW 索引；通过 agent 建笔记，embedding 正常写入向量列；换一种完全不同的说法做语义搜索，能正确召回，agent 也没有编造笔记里没有的内容；用 EXPLAIN ANALYZE 确认查询走的是 Index Scan using ix_notes_embedding_hnsw，不是全表扫描；任务、提醒（包括后台定时任务）也都跑通，没有引入回归。测试过程中写入的数据已经清理，Supabase 上现在是干净的空表。

## 8. 已确认的决策

旧数据不迁移，直接在新数据库上从空的开始。DATABASE_URL 不做"没配置就退回 SQLite"的兼容模式，本地开发也统一用 Postgres（现在是统一用 Supabase）。
