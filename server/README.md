# 典籍账号接口

可选登录。不登录时，阅读、书签和进度都只在浏览器本地，和现在一样。登录之后，才会把书签和阅读进度同步到阿里云。

这个目录不会由网站的 GitHub Actions 部署。静态站点照常发布；账号接口要等下面的资源都建好，再由你在本机执行 `s deploy`。

本地测试不需要阿里云账号：

```bash
node --test server/test/*.test.js
```

## 你要创建的资源

地域：函数计算和表格存储都在 **cn-hongkong**。邮件推送没有香港地域，控制台开在 **华东1（杭州）**，函数通过公网调用 `https://dm.aliyuncs.com/`。不要迁移 lucca.top 的 DNS，只在现有解析里加记录。

建议单独建一个 RAM 用户（不要用主账号 AccessKey），勾选「OpenAPI 调用访问」。给它下面这一条自定义策略。实例名如果不用 `gwgz`，把策略里的名字改成你的实例名。

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ots:GetRow", "ots:PutRow", "ots:UpdateRow", "ots:DeleteRow"],
      "Resource": [
        "acs:ots:cn-hongkong:*:instance/gwgz",
        "acs:ots:cn-hongkong:*:instance/gwgz/table/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["dm:SingleSendMail"],
      "Resource": "*"
    }
  ]
}
```

建表还可以临时加上 `ots:CreateTable`，建完再去掉。记下这个用户的 AccessKey ID 和 Secret，只放在本机环境和函数环境变量里，不要写进仓库。

### 1. 表格存储

控制台：表格存储 → 香港 → 创建实例。

| 项 | 值 |
| --- | --- |
| 实例名 | `gwgz` |
| 实例类型 | 容量型，按量 |
| 访问节点 | `https://gwgz.cn-hongkong.ots.aliyuncs.com` |
| 网络 | 允许公网访问。函数不在 VPC 里，走公网即可 |

五张表，主键都是字符串，属性列最大版本数 **1**，数据生命周期 **-1**（不过期），预留读写容量 **0 / 0**。可以在控制台逐张建，也可以在 `server/` 里装好依赖后执行 `node scripts/create-tables.js`（用下面的环境变量）。

| 表名 | 主键 | 属性列 |
| --- | --- | --- |
| `users` | `email` STRING | `userId` STRING，`createdAt` INTEGER，`sessionHashes` STRING |
| `codes` | `email` STRING | `codeHash` STRING，`expiresAt` INTEGER，`attempts` INTEGER，`sentAt` INTEGER |
| `limits` | `id` STRING | `hourStart` INTEGER，`hourCount` INTEGER，`lastSent` INTEGER |
| `sessions` | `tokenHash` STRING | `userId` STRING，`email` STRING，`expiresAt` INTEGER |
| `sync` | `userId` STRING | `bookmarks` STRING，`state` STRING |

`id` 的内容是 `email:用户邮箱` 或 `ip:地址`。验证码和会话在表里只存哈希。

### 2. 邮件推送

控制台：邮件推送（华东1 杭州）。

1. 开通邮件推送。新账号要完成实名，触发类邮件有每日额度。
2. 发信域名新建 `mail.lucca.top`。
3. 域名验证页会列出必须添加的 DNS。到 **lucca.top 现在的 DNS 服务商**逐条原样添加，主机记录相对 `lucca.top`。不要抄别处过期文档里的记录值；页面上有的每一行都要加。通常是这几类：
   - 所有权 **TXT**。主机记录类似 `aliyundm.mail`，记录值是控制台给出的校验串。
   - SPF **TXT**。主机记录 `mail`，记录值一般是 `v=spf1 include:spf1.dm.aliyun.com -all`。以控制台那一行为准。
   - **MX**。主机记录 `mail`，优先级一般是 10，记录值以控制台为准。
   - 若还有 DKIM 的 TXT 或 CNAME，一并加上。
4. 等域名状态变成已验证。
5. 新建发信地址 `noreply@mail.lucca.top`，类型选 **触发邮件**（验证码不是批量邮件）。回信地址可以不填。等审核通过。
6. 不需要 SMTP 密码。函数调用的是 `SingleSendMail` API。

### 3. 函数计算

先在本机准备好工具，仍然先不要部署，除非上面两项已经可用：

```bash
npm install -g @serverless-devs/s
s config add
```

`s config add` 使用同一个 RAM 用户的 AccessKey。别名用 `default`，和 `s.yaml` 里的 `access: default` 对应。

在 `server/` 目录：

```bash
npm install --omit=dev
export AUTH_SECRET="$(openssl rand -hex 32)"
export TABLESTORE_ENDPOINT="https://gwgz.cn-hongkong.ots.aliyuncs.com"
export TABLESTORE_INSTANCE="gwgz"
export TABLESTORE_ACCESS_KEY_ID="上面的 AccessKey ID"
export TABLESTORE_ACCESS_KEY_SECRET="上面的 AccessKey Secret"
export ALIBABA_CLOUD_ACCESS_KEY_ID="$TABLESTORE_ACCESS_KEY_ID"
export ALIBABA_CLOUD_ACCESS_KEY_SECRET="$TABLESTORE_ACCESS_KEY_SECRET"
export DIRECTMAIL_ACCOUNT_NAME="noreply@mail.lucca.top"
s deploy
```

`s.yaml` 会创建：

| 项 | 值 |
| --- | --- |
| 地域 | `cn-hongkong` |
| 函数名 | `gwgz-api` |
| 运行时 | Node.js 20 |
| 入口 | `index.handler` |
| 内存 / 超时 | 256 MB / 30 秒 |
| 公网访问 | 开。要访问表格存储公网和 `dm.aliyuncs.com` |
| HTTP 触发器 | 匿名，方法 GET、POST、PUT、DELETE、OPTIONS |

触发器必须是匿名。登录态由函数自己检查 `Authorization: Bearer`。不要再给触发器加阿里云签名，否则浏览器打不开。

函数环境变量（`s.yaml` 会从上面的 shell 环境写入，不要把值提交到 git）：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `AUTH_SECRET` | 是 | 至少 16 位随机串。用来给验证码和会话做哈希。换掉它会使所有人退出 |
| `TABLESTORE_ENDPOINT` | 是 | `https://gwgz.cn-hongkong.ots.aliyuncs.com` |
| `TABLESTORE_INSTANCE` | 是 | `gwgz` |
| `TABLESTORE_ACCESS_KEY_ID` | 是 | RAM 用户 AccessKey |
| `TABLESTORE_ACCESS_KEY_SECRET` | 是 | 对应 Secret |
| `ALIBABA_CLOUD_ACCESS_KEY_ID` | 是 | 发信用。可以和表格存储是同一个用户 |
| `ALIBABA_CLOUD_ACCESS_KEY_SECRET` | 是 | 对应 Secret |
| `DIRECTMAIL_ACCOUNT_NAME` | 是 | `noreply@mail.lucca.top` |
| `DIRECTMAIL_FROM_ALIAS` | 否 | 默认 `典籍` |
| `APP_ORIGINS` | 否 | 默认已是 `https://guwen.lucca.top,https://lucca.top,https://www.lucca.top,https://maruiduan.github.io` |

部署完成后，先用函数自己的公网地址试：

```bash
curl -sS "https://<函数公网域名>/health"
```

应返回 `{"ok":true}`。不要带 `Origin` 头。带了不在名单里的 Origin 会得到 403。

### 4. 自定义域名 api.lucca.top

函数计算 → 香港 → 域名管理 → 添加自定义域名。

| 项 | 值 |
| --- | --- |
| 域名 | `api.lucca.top` |
| 协议 | HTTPS |
| 证书 | 使用控制台提供的免费证书。签发时如果还要加一条 TXT 或 CNAME，按页面加 |
| 路由 | 路径 `/*`，方法全部，函数 `gwgz-api`，版本 LATEST |
| 鉴权 | 匿名，和触发器一致 |
| CORS | **不要在域名上再配 CORS**。函数会按来源返回。配两套时浏览器会拒掉重复的头 |

DNS：在 lucca.top 现有解析里加一条 **CNAME**，主机记录 `api`，记录值是控制台给出的函数计算域名（形如 `xxxxxx.cn-hongkong.fc.aliyuncs.com`）。不要改成 A 记录，也不要动现有的 `lucca.top`、`www`、`guwen` 记录。

证书和 CNAME 都生效后：

```bash
curl -sS "https://api.lucca.top/health"
```

## 打开网站上的登录

默认是关的。`index.html` 里是：

```html
<script>
  window.API_BASE = "";
</script>
```

空字符串时，页面不请求接口，不出现「登录」，也不写账号相关的本地数据。

接口确认可用之后，改成：

```html
<script>
  window.API_BASE = "https://api.lucca.top";
</script>
```

然后照常发布静态站点。页面会先请求 `GET /health`。失败或被拦住时，仍然不显示登录。成功以后，页眉右侧才出现「登录」（阅读篇目时让位给拼音和字体按钮）。

## 接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/health` | `{ok:true}`，不需要登录 |
| POST | `/auth/request-code` | `{email}`。6 位验证码，10 分钟有效 |
| POST | `/auth/verify` | `{email,code}`，返回 `{token,email,userId}` |
| POST | `/auth/logout` | 作废当前令牌 |
| DELETE | `/account` | 删除用户、会话、验证码和同步数据 |
| GET | `/me` | 邮箱、书签、进度 |
| PUT | `/sync` | 合并后写回。客户端登录时和之后的变更都走这一条 |

限流：同一邮箱 60 秒内最多 1 封，每小时最多 5 封；同一 IP 每小时最多 20 次发信。验证码最多错 5 次。会话大约 180 天。令牌是随机串，服务端只存哈希，浏览器放在 `localStorage` 的 `gwgz-session-v1`。

允许的网页来源只有：

- `https://guwen.lucca.top`
- `https://lucca.top`
- `https://www.lucca.top`
- `https://maruiduan.github.io`

没有 `Origin` 的请求（例如 curl）可以访问，方便你检查 `/health`。

## 同步规则

登录成功后，浏览器把本地书签和进度 `PUT /sync`。服务端和已有数据合并，再把结果存回去，浏览器改用这份结果。之后本地有变化，等待约 1.5 秒再推一次。回到这个标签页时也会再合并一次。

- 书签按 id 取并集。同一条以较新的时间为准。取消书签会留下一条较新的删除标记，避免另一台设备又把它合并回来。
- 进度里字体、拼音、逐句、上次阅读位置和诗集筛选，用较新的 `updatedAt`。
- 已读篇目取并集，同一篇保留较晚的时间，避免一台设备把另一台的已读盖掉。
- 进度时间只在登录功能已经连上接口之后才写入本机。功能关闭时不写。

书签 id：篇目是 `piece:v01-01` 或 `piece:tang:t010`；逐句是 `sent:v01-01:0`（按阅读顺序从 0 计）。诗词行宽是按整行排的，句级书签只加在散文的逐句模式上。
