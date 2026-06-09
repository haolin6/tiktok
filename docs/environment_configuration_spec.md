# 直播竞拍项目环境配置约束 Spec

来源依据：

- `/Users/haolin6/Downloads/AI全栈课题-常见问题指引.md`
- `/Users/haolin6/Desktop/🛍️抖音电商AI全栈课题-直播竞拍全栈系统（宣讲版）.pdf`
- 当前项目目录：`/Users/haolin6/Documents/tiktok`

## 1. 配置目标

为直播竞拍全栈系统建立可复现的本地开发环境，满足后续开发需要：

- Node.js / npm：前后端项目开发与脚本执行。
- MySQL 8.0：核心业务数据持久化。
- Redis 7.x：竞拍实时状态、房间在线状态、幂等与锁相关数据。
- 环境变量模板：隔离本地配置和真实密钥。
- 可验证脚本：明确判断环境是否配置成功。

本阶段只做本地开发环境，不做云端部署，不创建火山 ECS/RDS/Redis/视频直播服务。

## 2. 总约束

### 允许配置

- 当前项目目录内的配置文件、文档、脚本。
- 当前项目所需的 `.env.example` 和本地 `.env`。
- 本机已有工具的 PATH 识别与验证。
- 在用户授权后，通过 Homebrew 安装或启动 MySQL/Redis。
- 在用户授权后，修改当前用户 shell 配置中与 Homebrew/MySQL/Redis 直接相关的 PATH。

### 不允许改动

- 不提交、不写入真实 API Key、火山账号、数据库真实密码、云资源密钥。
- 不创建任何云端资源，不产生火山云、阿里云、腾讯云等费用。
- 不安装 Docker Desktop，除非用户明确要求。
- 不修改系统级防火墙、登录项、安全策略。
- 不删除或重装已有数据库。
- 不修改用户无关项目、桌面文件、下载目录文件。
- 不运行破坏性命令，例如 `rm -rf`、`git reset --hard`、卸载已有软件。

### 密钥约束

FAQ 和宣讲 PDF 中出现了共享模型资源信息，但项目仓库中只能保留占位字段：

```dotenv
ARK_MODEL=doubao-seed-2-0-lite
ARK_ENDPOINT_ID=
ARK_API_KEY=
```

真实密钥只能由用户手动写入本地 `.env`，且 `.env` 必须被 `.gitignore` 忽略。

## 3. 环境选择

### 首选方案：Homebrew 原生安装

适合当前机器：macOS + Apple Silicon。

目标版本：

- MySQL：优先 `mysql@8.0`，避免安装过高版本。
- Redis：Homebrew 当前稳定版即可。本机实际安装版本以验收结果为准。

预期命令：

```bash
/opt/homebrew/bin/brew install mysql@8.0 redis
/opt/homebrew/bin/brew services start mysql@8.0
/opt/homebrew/bin/brew services start redis
```

如果因为沙箱无法写入 Homebrew 缓存或服务目录，需要通过 Codex 授权机制请求用户允许。

### 备选方案：Docker Compose

当前机器未检测到 Docker。只有用户明确想用 Docker 时才走该方案。

项目已经预置 `docker-compose.yml`，包括：

- `mysql:8.0`
- `redis:7-alpine`

## 4. 分步配置计划

### Step 1：项目侧基线

配置内容：

- `.node-version`
- `package.json`
- `.gitignore`
- `.env.example`
- 本地 `.env`
- `docker-compose.yml`
- `infra/mysql/init/001_create_schema.sql`
- `scripts/check-env.mjs`
- `docs/environment_setup.md`

边界：

- 只改当前项目目录。
- `.env` 只能写占位值，不能写真实密钥。

成功标准：

```bash
npm run check:env
```

至少应显示：

- Node.js：OK
- npm：OK

MySQL、Redis、Docker 在未安装时可以显示 OPTIONAL。

### Step 2：Homebrew 可用性检查

配置内容：

- 检查 `/opt/homebrew/bin/brew` 是否存在。
- 检查当前 shell 是否能直接找到 `brew`。

边界：

- 不修改 shell 配置，只读取。
- 如果要修改 PATH，必须只追加 Homebrew 官方 shellenv 行，并先说明。

成功标准：

```bash
/opt/homebrew/bin/brew --version
```

返回 Homebrew 版本。

### Step 3：MySQL 安装或确认

配置内容：

- 检查是否已有 MySQL。
- 若没有，经用户授权后安装 `mysql@8.0`。
- 启动 MySQL 服务。
- 创建或确认项目数据库 `live_auction`。
- 创建或确认项目用户 `auction_app`。

边界：

- 不卸载已有 MySQL。
- 不重置 root 密码。
- 不删除已有数据库。
- 不暴力覆盖已有用户权限。

成功标准：

```bash
/opt/homebrew/opt/mysql@8.0/bin/mysql --version
/opt/homebrew/opt/mysql@8.0/bin/mysqladmin ping -h 127.0.0.1 -P 3306 -u root
/opt/homebrew/opt/mysql@8.0/bin/mysql -h 127.0.0.1 -P 3306 -u auction_app -p live_auction -e "SELECT 1;"
```

如果 root 密码未知，需要用户输入或自行完成初始化；Codex 不猜测、不破解。

### Step 4：Redis 安装或确认

配置内容：

- 检查是否已有 Redis。
- 若没有，经用户授权后安装 `redis`。
- 启动 Redis 服务。

边界：

- 不改 Redis 全局配置文件，除非后续项目明确需要。
- 不设置公网访问。
- 不写 Redis 密码到仓库。

成功标准：

```bash
/opt/homebrew/bin/redis-cli -h 127.0.0.1 -p 6379 ping
```

返回：

```text
PONG
```

### Step 5：最终验收

配置内容：

- 再跑项目环境检查脚本。
- 检查 `.env` 是否被 git 忽略。
- 检查可提交文件中不含真实密钥。

成功标准：

```bash
npm run check:env
git status --short
git check-ignore .env
rg -n "ark-[[:alnum:]-]{20,}" .
```

预期结果：

- `npm run check:env` 中 Node/npm OK。
- MySQL/Redis 在安装后 OK。
- `.env` 被 git 忽略。
- 仓库可提交文件中没有真实 `ark-...` 形态的 API Key。

## 5. 当前已知状态

截至 2026-05-26：

- Node.js 可用：`v22.17.0`。
- npm 可用：`10.9.2`。
- `/opt/homebrew/bin/brew` 可用，但当前 shell 中 `brew` 可能不稳定。
- MySQL 已安装：`mysql@8.0 8.0.46_1`，可通过 `/opt/homebrew/opt/mysql@8.0/bin/mysql` 使用。
- Redis 已安装：`8.8.0`，可通过 `/opt/homebrew/bin/redis-cli` 使用。
- MySQL 服务已启动：`homebrew.mxcl.mysql@8.0`。
- Redis 服务已启动：`homebrew.mxcl.redis`。
- 项目数据库已创建或确认：`live_auction`。
- 项目本地用户已创建或确认：`auction_app`。
- `docker` 未在 PATH 中发现。
- Homebrew 在沙箱内尝试搜索包时遇到 `Operation not permitted @ dir_s_mkdir - /Users/haolin6/Library/Caches/Homebrew`，后续安装或搜索需要授权运行。

## 6. 执行顺序

1. 完成并确认本 spec。
2. 检查项目侧文件是否符合 spec。
3. 请求授权使用 Homebrew 检查/安装 MySQL 与 Redis。
4. 启动 MySQL/Redis 服务。
5. 配置本地数据库与用户。
6. 运行验收测试。
7. 更新 `docs/environment_setup.md`，记录最终状态和下一步开发启动方式。
