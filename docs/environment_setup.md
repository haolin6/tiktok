# 直播竞拍项目本地环境配置

本文记录实时竞拍大师的本地运行环境。

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

## 本地环境方案

### Homebrew 原生安装

当前 Mac 使用 Homebrew 运行 MySQL 和 Redis。

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

当前机器已完成 Homebrew 原生安装：

- MySQL：`mysql@8.0 8.0.46_1`
- Redis：`8.8.0`
- MySQL 服务：`homebrew.mxcl.mysql@8.0`
- Redis 服务：`homebrew.mxcl.redis`

### Docker Compose

安装 Docker Desktop 后也可以使用仓库内的 `docker-compose.yml` 启动 MySQL 和 Redis。

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

真实配置只放在 `.env`，`.env` 不进入仓库。

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

Doubao/火山方舟字段为预留配置，当前业务链路未调用模型服务：

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

当前版本使用本地素材模拟直播间，没有接入真实推拉流。

## 安全注意

仓库不提交真实 API Key、云服务账号、数据库密码或直播鉴权信息。
