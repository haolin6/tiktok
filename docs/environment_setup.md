# 直播竞拍项目本地环境配置

本文根据 `/Users/haolin6/Downloads/AI全栈课题-常见问题指引.md` 和当前项目需要整理。

## 当前机器检查结果

- 系统：macOS Apple Silicon。
- Node.js：已安装，当前可用版本为 `v22.17.0`。
- npm：已安装，当前可用版本为 `10.9.2`。
- Homebrew：已安装。
- pnpm：未安装。当前项目先使用 npm，避免额外依赖。
- MySQL CLI：已通过 Homebrew 安装，当前 shell 未直接暴露 `mysql`，可使用 `/opt/homebrew/opt/mysql@8.0/bin/mysql`。
- Redis CLI：已通过 Homebrew 安装，当前 shell 未直接暴露 `redis-cli`，可使用 `/opt/homebrew/bin/redis-cli`。
- Docker：未在 PATH 中发现。

## 项目侧已配置内容

- `.node-version`：固定 Node.js 版本为 `22.17.0`。
- `package.json`：提供环境检查脚本。
- `.env.example`：提供本地环境变量模板，不包含真实密钥。
- `.gitignore`：避免提交 `.env`、依赖和构建产物。
- `docker-compose.yml`：预置 MySQL 8.0 与 Redis 7 的可选 Docker 本地服务配置。
- `infra/mysql/init/001_create_schema.sql`：初始化 `live_auction` 数据库和环境探针表。
- `scripts/check-env.mjs`：检查 Node/npm/MySQL/Redis/Docker 是否可用。

## 推荐本地环境方案

### 方案 A：Homebrew 原生安装

适合当前 Mac 直接开发。

```bash
/opt/homebrew/bin/brew install mysql@8.0 redis
/opt/homebrew/bin/brew services start mysql@8.0
/opt/homebrew/bin/brew services start redis
```

安装后验证：

```bash
/opt/homebrew/opt/mysql@8.0/bin/mysql --version
/opt/homebrew/bin/redis-cli ping
```

如果 `mysql@8.0` 未自动加入 PATH，可根据 Homebrew 提示把 MySQL bin 目录加入 shell 配置。

当前机器已完成 Homebrew 原生安装：

- MySQL：`mysql@8.0 8.0.46_1`
- Redis：`8.8.0`
- MySQL 服务：`homebrew.mxcl.mysql@8.0`
- Redis 服务：`homebrew.mxcl.redis`

### 方案 B：Docker Compose

适合不想污染本机数据库环境，或后续团队统一环境。

前提：安装 Docker Desktop。

```bash
cp .env.example .env
docker compose up -d mysql redis
docker compose ps
```

验证：

```bash
docker exec live-auction-redis redis-cli ping
docker exec live-auction-mysql mysqladmin ping -h 127.0.0.1 -uroot -pchange_root_password
```

## 本地环境变量

不要把真实密钥写进仓库。真实配置只放在 `.env`。

最少需要：

```bash
cp .env.example .env
```

然后按本机数据库密码修改：

```dotenv
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=live_auction
MYSQL_USER=auction_app
MYSQL_PASSWORD=change_me
MYSQL_ROOT_PASSWORD=change_root_password

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

Doubao/火山方舟相关字段只在需要接 AI 能力时填写：

```dotenv
ARK_MODEL=doubao-seed-2-0-lite
ARK_ENDPOINT_ID=
ARK_API_KEY=
```

## 环境检查

```bash
npm run check:env
```

当前验收结果：

- `npm run check:env`：Node.js、npm、MySQL CLI、Redis CLI 均 OK；Docker 为 OPTIONAL。
- `npm run db:mysql:ping`：返回 `mysqld is alive`。
- `npm run redis:ping`：返回 `PONG`。
- 项目数据库用户 `auction_app` 可连接 `live_auction`。
- `.env` 已被 `.gitignore` 忽略。
- 仓库中未发现真实 `ark-...` 形态的 API Key。

项目数据库连接：

```dotenv
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=live_auction
MYSQL_USER=auction_app
MYSQL_PASSWORD=change_me
```

## 直播流环境

FAQ 明确说明直播部分可以用固定视频模拟，不是必须搭建真实推拉流。为了 15 天比赛节奏，建议第一阶段用固定视频或 HLS 示例源模拟直播画面，把主要精力放在竞拍状态机、WebSocket 同步和高并发出价链路。

如果后续要做真实推流，再从以下方案中二选一：

- 火山视频直播：需要可用域名，配置成本较高。
- 自建开源流媒体：SRS、ZLMediaKit 或 MediaMTX，适合云服务器演示。

## 安全注意

FAQ 和宣讲 PDF 中都出现了共享模型资源信息。项目仓库中不要提交真实 API Key、云服务账号、数据库密码或直播鉴权信息。
