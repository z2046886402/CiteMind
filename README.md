# CiteMind

**面向科研文献的 RAG 检索与问答工作台。**

CiteMind 将文献上传、结构化解析、文本分块、向量检索、重排和多轮问答串成完整流程。你可以批量导入论文，通过自然语言提问，并从回答中的引用回到来源摘录与 PDF 原文核对，也可以将问答导出为 Markdown 笔记。

当前版本以 **Windows 本机开发与学习** 为主，采用 React + FastAPI 前后端分离架构，使用 PostgreSQL 保存业务数据，使用 Elasticsearch 保存文献分块与向量索引。

## 界面预览

### 文献问答

![CiteMind 文献问答界面](docs/images/2.png)
![CiteMind 文献问答界面](docs/images/3.png)
![CiteMind 文献问答界面](docs/images/4.png)

### 文献知识库

![批量上传与自动处理](docs/images/1.png)

### 引用与原文核对

![引用来源与 PDF 原文预览](docs/images/5.png)

## 功能

### 文献知识库

- 支持 PDF、DOCX、TXT，单份文件不超过 **20 MiB**。
- 批量选择文件，依次上传并自动完成解析、分块、向量生成和索引建立。
- 分别展示上传状态和处理状态，单份失败后继续处理后续文件。
- 支持文献删除、解析预览、分块预览和手动建立索引。
- 展示最近索引任务、错误摘要、最近成功分块数与时间。

### 检索与文献问答

- 结合关键词与向量进行混合召回。
- 支持用户选择 **规则重排** 或 **模型重排**。
- 使用检索到的文献片段生成回答，并展示可点击的引用。
- 支持多轮会话、历史消息、会话重命名和删除。
- 使用 SSE 流式展示生成过程，保存完成后返回正式结果。
- 支持推荐追问、首次会话自动命名与首次提问自动创建会话。
- 区分资料不足、明确失败、结果待确认与主动停止等状态。

### 阅读与输入体验

- 研究工作区布局：会话侧栏、消息阅读区、底部输入区，以及按需显示的引用来源栏。
- 支持 Markdown 标题、列表、表格、代码和引用共同展示。
- 支持受登录保护的 PDF 原文预览与按页查看。
- 支持将当前完整回答或历史问答导出为 Markdown，包含问题、答案、引用与来源信息。
- 支持中文语音输入，识别后可编辑，再由用户确认发送。
- 支持 `Ctrl + Enter` / `⌘ + Enter` 发送问题，普通 Enter 换行。

## 技术栈

| 层次         | 技术                                                       |
| ------------ | ---------------------------------------------------------- |
| 前端         | React 18、TypeScript、Vite 6、Ant Design 5                 |
| 路由与状态   | React Router、Valtio                                       |
| 网络与展示   | Axios、Fetch / SSE、Marked                                 |
| 后端         | Python 3.11、FastAPI、Uvicorn、Pydantic                    |
| 数据与认证   | SQLAlchemy、PostgreSQL、JWT、bcrypt                        |
| 文献处理     | pdfplumber、python-docx、tiktoken                          |
| 中文文本处理 | Jieba、扩展词典、领域词权重                                |
| 搜索引擎     | Elasticsearch，关键词检索与 1024 维向量检索                |
| 模型接入     | OpenAI 兼容的对话与 Embedding 接口、兼容协议的 Rerank 接口 |
| 语音输入     | 浏览器 SpeechRecognition / webkitSpeechRecognition         |

## 系统架构

![CiteMind 系统架构：前端、后端、数据存储与模型服务](docs/images/architecture.svg)

前端负责导入队列、研究会话和阅读交互；后端负责权限校验与 RAG 流程。PostgreSQL 保存业务记录，Elasticsearch 保存可检索分块，本机文件目录保存原文；远程模型服务提供向量、回答和可选的模型重排。

## 工作流程

```mermaid
flowchart TD
    A[批量选择文献] --> B[逐份上传]
    B --> C[结构化解析]
    C --> D[按 Token 分块并补充来源信息]
    D --> E[生成向量并建立 Elasticsearch 索引]
    E --> F[用户输入问题]
    F --> G[结合会话历史理解问题]
    G --> H[关键词与向量混合召回]
    H --> I[规则重排或模型重排]
    I --> J[基于文献生成流式回答]
    J --> K[保存问答与引用快照]
    K --> L[展示回答与推荐追问]
    L --> M[查看来源与 PDF 原文]
    L --> N[导出 Markdown]
```

原始文献保存在后端本机文件目录；用户、文献元数据、会话和消息保存在 PostgreSQL；分块文本及向量保存在 Elasticsearch。

## 目录结构

```text
CiteMind/
├─ backend/
│  ├─ app/
│  │  ├─ app_main.py              # FastAPI 入口
│  │  ├─ init_db.py               # 初始化业务表
│  │  ├─ init_search_index.py     # 初始化或检查搜索索引
│  │  ├─ migrate_*.py            # 已有数据库的显式迁移脚本
│  │  ├─ router/                 # HTTP 与 SSE 接口
│  │  ├─ service/                # 解析、检索、问答及保存等业务逻辑
│  │  ├─ models/                 # 数据库模型
│  │  ├─ schemas/                # 请求与响应结构
│  │  ├─ exceptions/             # 业务异常
│  │  ├─ utils/                  # 数据库、ES、密码等基础工具
│  │  └─ requirements.txt
│  ├─ resources/tokenizer/       # 词典和词项权重
│  └─ storage/file/              # 上传原文件，运行时创建，不提交 Git
├─ frontend/
│  ├─ src/
│  │  ├─ api/                    # 请求封装
│  │  ├─ components/             # 共用组件
│  │  ├─ layout/                 # 应用布局
│  │  ├─ pages/                  # 登录、知识库、检索与问答页面
│  │  ├─ router/                 # 路由与登录守卫
│  │  ├─ store/                  # 用户状态
│  │  └─ utils/                  # 导出、错误提示与语音适配
│  ├─ package.json
│  └─ vite.config.ts
├─ docs/images/                 # 架构图与项目界面截图
├─ README.md
└─ .gitignore
```

## 本机启动

以下命令以 **PowerShell** 为例，默认从项目根目录执行。本项目当前使用本机 PostgreSQL 和 Elasticsearch，不要求 Docker。

### 1. 准备环境

- Python **3.11**，可以使用 Conda 管理环境。
- Node.js **22 或更高版本**及 npm。
- 已启动且可连接的 PostgreSQL；现有开发环境使用 PostgreSQL 18。
- 已启动且可认证访问的 Elasticsearch；现有开发环境使用 Elasticsearch 9.5.6，Python 客户端固定为 9.0.2。
- 支持当前模型与请求格式的服务凭据。

### 2. 安装后端依赖

```powershell
conda create -n citemind python=3.11 -y
conda activate citemind
python -m pip install -r backend/app/requirements.txt
```

已经创建环境时，直接激活并安装依赖即可。

### 3. 创建数据库并配置后端

在 PostgreSQL 客户端中创建数据库，例如：

```sql
CREATE DATABASE citemind;
```

新建 `backend/.env`。下列值均为**占位示例，必须替换为自己的配置**：

```dotenv
# 数据库：账号必须具有访问和初始化业务表的权限
DATABASE_URL=postgresql+psycopg2://your_user:your_password@localhost:5432/citemind

# 使用随机生成的长密钥
JWT_SECRET_KEY=replace_with_a_random_secret

# 对话与 Embedding 共用的 OpenAI 兼容基础地址和凭据
DASHSCOPE_API_KEY=your_api_key
DASHSCOPE_BASE_URL=https://your-provider.example/v1
CHAT_MODEL=your_chat_model

# Elasticsearch：默认示例使用 HTTPS 与 CA 证书校验
ES_HOST=https://localhost:9200
ES_USERNAME=elastic
ES_PASSWORD=your_elasticsearch_password
ES_CA_CERT=D:/path/to/elasticsearch/config/certs/http_ca.crt
ES_INDEX=citemind_chunks_v1

# 可选：选择模型重排时需要配置
RERANK_API_URL=https://your-provider.example/rerank
RERANK_API_KEY=your_rerank_api_key
RERANK_MODEL=qwen3-rerank
```

配置说明：

- 当前 Embedding 模型在代码中固定为 **`text-embedding-v3`、1024 维**；服务必须支持这一模型和维度。修改模型或维度时，需要同步核对代码与索引映射。
- `DASHSCOPE_BASE_URL` 用于对话和 Embedding；`RERANK_API_URL` 是**完整的重排请求地址**，不是聊天基础地址。当前重排请求体使用 `model`、`query`、`documents`、`top_n` 等兼容协议字段，需要匹配服务文档。
- 未配置重排服务时，可以先选择规则重排；规则重排不调用重排模型，但向量生成和回答仍会使用远程模型。
- 若本机 Elasticsearch 已配置为 HTTP，可使用 `http://localhost:9200`，此时不使用 CA 证书；当前代码仅允许对本机地址使用 HTTP，用户名与密码仍需配置。HTTPS 必须填写实际存在的 CA 文件。
- 数据库密码若包含 URL 特殊字符，需要按连接字符串规则进行编码。
- 所有密钥保留在后端配置中，不应放入前端 `VITE_*` 变量或提交到仓库。

### 4. 配置前端

新建 `frontend/.env`：

```dotenv
VITE_API_BASE=http://127.0.0.1:8000
```

### 5. 初始化业务表和搜索索引

确认 PostgreSQL、Elasticsearch 和配置就绪后：

```powershell
cd backend/app
python init_db.py
python init_search_index.py
```

`init_db.py` 创建尚不存在的业务表，**不会自动修改已有表结构**。从旧版本升级时，请根据缺少的字段检查对应 `migrate_*.py` 脚本；不要将所有迁移脚本作为每次启动的固定步骤。

`init_search_index.py` 创建或检查 Elasticsearch 分块索引。已有索引映射不兼容时应先处理映射问题，不要直接删除仍有文献数据的索引。

### 6. 启动后端

在 `backend/app` 目录、已激活的 Python 环境中：

```powershell
python app_main.py
```

- API：<http://127.0.0.1:8000>
- 接口文档：<http://127.0.0.1:8000/docs>
- 服务检查：<http://127.0.0.1:8000/health>
- 数据库检查：<http://127.0.0.1:8000/health/db>

根路径 `/` 没有配置业务页面，访问它返回 404 不代表后端启动失败。

### 7. 启动前端

另开一个终端，进入项目根目录下的 `frontend`：

```powershell
cd frontend
npm ci
npm run dev
```

浏览器访问 **<http://localhost:5181>**。当前后端允许的开发跨域来源为这个地址；如果改变域名或端口，需要同步调整 `backend/app/app_main.py` 的 CORS 配置。

首次初始化 Token 编码器时，可能需要联网下载词表。运行缓存保存在 `backend/.cache/`。

## 使用方式

1. 注册账号并登录。
2. 在知识库点击“批量上传”，选择一份或多份文献。
3. 保持页面打开，等待各文件的上传与自动处理结果。
4. 处理完成后，在“文献检索”中检索，或进入“文献问答”提问。
5. 可直接发送首问自动创建会话，也可以先手动新建并命名会话。
6. 根据需求选择规则重排或模型重排。
7. 点击回答中的引用编号查看摘录，需要时展开 PDF 原文。
8. 使用推荐追问继续探索，或将完整问答导出为 Markdown。

欢迎页“研究方法 / 实验结论 / 文献对比”仅填入示例草稿，需确认发送；回答下面的推荐追问会进入新一轮提交流程。

语音输入需要支持相应 API 的浏览器、安全上下文和麦克风权限。点击“语音输入”开始，说完点击“结束录音”，核对识别文字后手动发送。

## 当前范围与限制

- **导入队列位于当前页面。** 刷新或离开会停止提交后续文件，没有后台持久化队列或断点恢复。已经提交的服务端任务可能继续执行。
- **上传成功与处理成功分别记录。** 自动处理失败时，原文件可能已经保存；先核对索引状态，再按需手动建立索引，无需直接重新上传。
- **单次同步索引最多处理 200 个分块。** 自动处理当前使用 `512` Token 分块、`64` Token 重叠参数。
- **当前不提供 OCR。** 扫描版 PDF、复杂排版和复杂表格的提取质量可能有限；有页码信息不代表已精确定位每一句话的原始版面位置。
- **语音使用浏览器识别服务。** 没有接入参考实现的火山引擎语音链路，不保证离线或所有浏览器可用。
- **停止接收不等于撤销后端任务。** 问答、上传或索引超时与断网时，应先核对历史或知识库状态，再决定是否重试。
- **引用用于辅助核对。** 模型生成完成和存在引用，不代表结论已经自动完成事实核验。
- 当前以本机开发为目标，尚未提供完整的生产部署、后台任务与监控方案。

## 开发检查

前端类型与生产构建：

```powershell
cd frontend
npm run build
```

前端代码规范检查：

```powershell
npm run lint
```

后端提供若干按功能组织的 `check_*.py` 脚本。例如在 `backend/app` 下运行：

```powershell
python check_rule_rerank.py
```

其他检查脚本可能访问数据库、Elasticsearch 或真实模型服务。运行前查看各脚本说明；例如 `check_chat_stream.py` 会发起真实模型请求。当前这些检查不等同于完整的自动化测试套件。

## 配置与运行数据

请将 `.env`、模型凭据、数据库密码、上传文献、依赖目录和运行缓存保留在本机。现有忽略规则包含 `.env`、`node_modules/`、`backend/storage/` 和 `backend/.cache/` 等。

Git 忽略规则不影响已经被跟踪的文件，也不会清除提交历史中的敏感信息；发布前仍需检查实际提交内容。
