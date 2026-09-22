# NoyACG — Venera 漫画源

为 [Venera](https://github.com/venera-app/venera) 编写的 `noymanga.com` 图源插件。

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `noyacg.js` | **用户版**。仅保留正常功能，不含任何调试接口，日常使用请导入这个。 |
| `noyacg_test.js` | **测试版**。额外包含「诊断书籍章节」「诊断搜索接口」两个排查工具，用于反馈问题时抓取原始响应。源名为 `NoyACG 測試版`，可与用户版共存。 |

## 功能

- **登录 / 自动重登**：账号密码登录，会话过期自动重新登录
- **浏览**：最新上传（最新 / 最多浏览 / 最多收藏 / 最高评分）、完整标签筛选
- **榜单**：今日 / 週 / 月 阅读榜、今日 / 週 / 月 收藏榜、高質榜、收藏推荐
- **搜索**：关键词搜索、标签搜索
- **详情**：章节识别（主章 / 番外分别列出）、缩略图、标签
- **阅读**：按章节加载全部页面
- **评论**：查看评论与回复、发表评论与回复
- **自动签到**：启动时自动签到（每日一次），也可手动签到
- **内容类型**：顯示所有內容 / 僅成人內容 / 僅全年齡內容
- **标签屏蔽**：内置少量屏蔽词，并支持追加自定义屏蔽词

## 安装

### 方式一：网络导入（推荐）

Venera → 漫画源 → 右上角 `+` → 从网络导入，填入本仓库的 jsDelivr 地址：

```
https://cdn.jsdelivr.net/gh/<用户名>/<仓库名>@main/noyacg.js
```

把 `<用户名>` / `<仓库名>` 换成本仓库的实际路径即可。

> 国内网络若无法直连 `raw.githubusercontent.com`，优先使用上面的 jsDelivr 地址；也可在任意 GitHub 链接前加 `https://gh-proxy.com/` 前缀。

### 方式二：本地导入

下载 `noyacg.js` 到手机 → Venera → 漫画源 → `+` → 从本地文件导入。

## 设置项

| 设置 | 说明 |
| --- | --- |
| 站点域名 | 默认 `noymanga.com`，站点换域名时修改 |
| 图片域名 | 默认 `img.noy.asia` |
| 自动签到 | 开启后启动时自动签到（每天仅一次） |
| 立即签到 | 手动签到，显示连续天数 |
| 内容类型 | 对搜索、标签、榜单、列表统一生效 |
| 默认排序 | 搜索页未指定排序时使用 |
| 额外屏蔽标签 | 逗号分隔，**只增加**屏蔽词，不减少内置屏蔽 |
| 刷新标签列表 | 从站点重新拉取分类标签 |

## 版本更新

源文件中的 `url` 字段决定 App 的更新检查地址。发布自己的仓库后，请把它改成你的地址：

```js
url = "https://cdn.jsdelivr.net/gh/<用户名>/<仓库名>@main/noyacg.js"
```

改完后推送，之后 App 会据此提示更新。

> jsDelivr 对 `@main` 有约 12 小时缓存。急需立刻生效时，可用 tag 引用（如 `@1.4.0`），或在 jsDelivr 后台手动刷新缓存。

## 发布到 GitHub

```bash
# 1. 在 GitHub 网页端新建一个 public 仓库，例如 venera-noyacg

# 2. 本地初始化并推送
cd <放有 noyacg.js 与 README.md 的目录>
git init
git add noyacg.js noyacg_test.js README.md
git commit -m "NoyACG 源 v1.4.0"
git branch -M main
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin main

# 3. 修改 noyacg.js 里的 url 字段为你的 jsDelivr 地址后再次提交
git commit -am "chore: 指向自有仓库更新地址"
git push
```

要点：

- 仓库必须是 **public**，否则 raw / jsDelivr 无法匿名访问
- 只放 `.js` 文件即可，无需构建步骤
- 后续更新 = 改文件 → `git commit` → `git push`，App 端按 `version` 字段判断是否有新版本

## 免责声明

本插件仅为客户端接口适配，不托管、不存储任何内容。所有数据均来自第三方站点，请遵守所在地法律法规及站点服务条款。

## 致谢

- [Venera](https://github.com/venera-app/venera) — 漫画阅读器
- [venera-configs](https://github.com/venera-app/venera-configs) — 源开发参考
