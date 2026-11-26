# README 插图与截图

本目录保存项目文档使用的图片。`architecture.svg` 是现有系统的模块关系图，根目录 README 已引用。

## 1. 准备真实界面截图

使用 `Win + Shift + S` 截取应用页面，再在截图工具中保存为 PNG。建议保留完整的功能区域，裁掉浏览器标签栏、桌面和无关窗口。

优先准备下面三张；语音输入演示可作为补充：

| 文件名 | 截图内容 | 展示重点 |
| --- | --- | --- |
| `chat.png` | 有一条完整回答的聊天页面 | 会话、Markdown 回答、引用和输入区 |
| `repository.png` | 文献知识库或自动处理结果弹窗 | 批量导入、上传与处理状态、成功分块数 |
| `reference.png` | 展开 PDF 原文的预览窗口 | 从回答引用回到论文来源 |
| `voice.png` | 正在录音并出现识别预览的输入区 | 语音草稿、结束录音与编辑发送 |

请保存到这个目录，文件名大小写与引用保持一致。图片属于文档资源，不要放进被 Git 忽略的 `backend/storage/`。

建议使用浏览器 100% 缩放，在同一窗口宽度下截图。截图中的问题和示例资料尽量简洁；使用可公开展示的演示资料，裁掉个人信息和敏感配置。不要把模拟设计稿标注成实际运行截图。

## 2. 在根目录 README 显示图片

根目录 README 已预留一段带 `SCREENSHOTS` 标记的 HTML 注释。放好图片后，将对应图片段落移出注释即可。只启用已经存在的图片，避免破图。

例如，根目录的 `README.md` 可以写：

```markdown
## 界面预览

### 文献问答

![CiteMind 文献问答界面](docs/images/chat.png)

### 文献知识库

![批量上传与自动处理](docs/images/repository.png)

### 引用与原文核对

![引用来源与 PDF 原文预览](docs/images/reference.png)
```

这里的路径相对于**根目录 README**，因此写 `docs/images/chat.png`。不要写你电脑上的 `D:\...`，GitHub 无法访问这类本机绝对路径。

若要限制展示宽度，可以使用 GitHub 支持的 HTML 图片写法：

```html
<img src="docs/images/chat.png" alt="CiteMind 文献问答界面" width="1000" />
```

## 3. 保存和提交

在项目根目录执行：

```powershell
git add README.md docs/images
git diff --cached --stat
git commit -m "docs: add project screenshots"
```

配置好 GitHub 远程仓库后，再运行 `git push`。这会提交文档与图片，不会部署应用。

## 4. 其他图示

- **模块架构图：** 当前的 `architecture.svg`，直接随仓库保存，适合展示技术组成。
- **业务流程图：** 根目录 README 的 Mermaid 图，适合说明导入、检索和回答的先后顺序。
- **短操作演示：** 可补充体积适中的 GIF；视频更适合放演示链接，避免把大文件直接堆进 Git 历史。

参考：[GitHub 图片和相对路径](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)、[GitHub Mermaid 图表](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams)。
