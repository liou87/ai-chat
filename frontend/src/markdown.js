import remarkGfm from "remark-gfm"
import remarkCjkFriendly from "remark-cjk-friendly"

// ReactMarkdown 共用的插件：笔记/日记正文和聊天里知行的回复都用这一套。
// remark-gfm：表格、删除线、任务列表（知行的周复盘经常输出表格）；
// remark-cjk-friendly：修中文标点旁边的加粗失效，比如「**完成了「修改项目」**就够了」这种写法
export const remarkPlugins = [remarkGfm, remarkCjkFriendly]
