# 账号绑定开放接口 · 第三方项目接入文档

> 版本：v1（2026-09-14） · 站点：`https://anticraft.top` · 接口实现：`backend/features/account_binding.py`

第三方项目可以用 **anticraft 账号登录 / 绑定**：用户在第三方站点点击「用 anticraft 登录」，
浏览器跳到 anticraft 的授权确认页，确认后第三方拿到一个一次性授权码，用服务端的密钥换成
访问令牌，再凭令牌读取该用户的基础资料。协议是 **OAuth 2.0 授权码模式（Authorization Code）** 的精简实现。

**接入前必须先登记白名单**（见第 2 节），否则授权入口会直接提示「该应用不在绑定白名单内」。

---

## 1. 一句话流程

```
用户                第三方项目服务端              第三方前端             anticraft
 │                        │                         │                     │
 │  点击「用 anticraft 登录」│                         │                     │
 │───────────────────────────────────────────────────────────────────────▶ 打开 /bind?client_id&redirect_uri&state
 │                        │                         │                     │ 用户登录 + 确认授权
 │◀──────────────────────────────────────────────────────────────────────── 浏览器回跳 redirect_uri?code=..&state=..
 │                        │◀────────────────────────┤                     │
 │                        │  POST /api/open/token（client_id+secret+code） │
 │                        │───────────────────────────────────────────────▶ 校验白名单/密钥/授权码
 │                        │◀─────────────────────────────────────────────── 返回 access_token + user
 │                        │  GET /api/open/userinfo（Bearer token）        │
 │                        │───────────────────────────────────────────────▶ 返回用户基础资料
 │                        │  建立本地登录态 / 保存绑定关系                  │
```

要点：`client_secret` 只在**服务端**使用，绝不能下发到浏览器；`code` 是一次性、5 分钟有效的。

---

## 2. 白名单机制（必读）

| 规则 | 说明 |
|---|---|
| 谁能发起绑定 | **只有**管理员在「管理后台 → 绑定应用」登记、且处于**启用**状态的应用 |
| 回调地址 | 逐个登记、**逐字符精确匹配**；不支持通配符（`*`）、前缀或子路径通配 |
| 密钥 | 登记时显示**一次**（服务端只存 sha256 哈希）；丢失在列表里点「重置密钥」重新生成 |
| 停用 | 停用后：授权入口报 404，已有令牌立即不可用（可随时重新启用） |
| 删除 | 删除应用会**作废它的全部绑定**，第三方需重新登记、用户需重新授权 |
| 修改回调地址 | 改完立即生效；旧地址立刻失效 |

**怎么进白名单**：把下面四项发给站点管理员，管理员在后台登记后把 `client_id` / `client_secret` 交给你。

- 应用名（展示在授权页，如「XX 图床」）
- 简介（一句话说明）
- 主页（可选）
- 回调地址（可多个；本地调试地址如 `http://localhost:5173/callback` 也可登记）

---

## 3. 接口一览

| 方法 | 路径 | 调用方 | 说明 |
|---|---|---|---|
| GET | `/bind` | 浏览器 | 授权入口页（把用户送到这里） |
| GET | `/api/open/apps/{client_id}` | 任一方 | 应用公开信息（展示用，无需鉴权） |
| POST | `/api/open/token` | 第三方**服务端** | 授权码换访问令牌 |
| GET | `/api/open/userinfo` | 第三方**服务端** | 读取已绑定用户的基础资料 |
| POST | `/api/open/revoke` | 第三方**服务端** | 用户在你的站点解绑时，通知 anticraft 撤销令牌（可选） |

用户侧自助入口：**我的 → 账号绑定**（查看已绑项目、随时解绑）。

---

## 4. 接口详情

### 4.1 授权入口（浏览器跳转，不是 XHR）

```
GET https://anticraft.top/bind?client_id=<client_id>&redirect_uri=<回调地址>&state=<随机串>
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `client_id` | 是 | 登记后获得的应用标识，形如 `ac_xxxxxxxxxxxx` |
| `redirect_uri` | 是 | 必须与登记值**完全一致**（含协议、端口、路径、查询串） |
| `state` | 建议 | 随机串（建议 ≥16 字符），防 CSRF 用；原样回传，请在回调里比对 |

跳转结果（都以 302 形式回跳到 `redirect_uri`）：

- 用户**同意**：`redirect_uri?code=acb_xxx&state=<原样>`
- 用户**拒绝**：`redirect_uri?error=access_denied&state=<原样>`
- 页面上的错误（不会回跳，直接展示）：应用不在白名单 / 已停用 / 回调地址与登记值不一致 / 用户未登录（提示先登录）

建议第三方这样发起：

```js
// 前端：生成 state 存在会话里，再跳转
const state = crypto.randomUUID()
sessionStorage.setItem('anticraft_state', state)
location.href = 'https://anticraft.top/bind?' + new URLSearchParams({
  client_id: 'ac_xxxxxxxxxxxx',
  redirect_uri: 'https://your-app.example.com/oauth/anticraft/callback',
  state,
})
```

### 4.2 应用公开信息（可选）

```
GET /api/open/apps/{client_id}
```

```json
{
  "client_id": "ac_xxxxxxxxxxxx",
  "name": "XX 图床",
  "description": "一句话简介",
  "homepage": "https://your-app.example.com",
  "scope": "profile"
}
```

未登记或已停用返回 `404 {"detail": "应用不存在或已停用（不在白名单内）"}`。

### 4.3 授权码换访问令牌

```
POST /api/open/token
Content-Type: application/json

{ "client_id": "ac_xxxxxxxxxxxx", "client_secret": "acs_xxxxxxxxxxxx", "code": "acb_xxx" }
```

```json
{
  "access_token": "act_xxxxxxxxxxxxxxxxxxxx",
  "token_type": "Bearer",
  "expires_in": 2592000,
  "scope": "profile",
  "user": {
    "id": 42,
    "username": "someone",
    "nickname": "某人",
    "avatar_url": "https://.../avatar.png",
    "created_at": "2025-11-02T13:20:31"
  }
}
```

- `code` **一次性**、**5 分钟**有效；重复使用或过期返回 400。
- 换令牌时顺带返回用户资料，多数场景无需再调 `userinfo`。
- `expires_in` 单位秒（30 天）。

### 4.4 读取用户资料

```
GET /api/open/userinfo
Authorization: Bearer act_xxxxxxxxxxxxxxxxxxxx
```

```json
{
  "app": { "client_id": "ac_xxxxxxxxxxxx", "name": "XX 图床" },
  "scope": "profile",
  "user": { "id": 42, "username": "someone", "nickname": "某人", "avatar_url": null, "created_at": "2025-11-02T13:20:31" }
}
```

`user` 字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | int | anticraft 用户唯一 ID（**建议用它作为外部账号主键**，用户名可改） |
| `username` | string | 登录名 |
| `nickname` | string \| null | 昵称，未设置为 null |
| `avatar_url` | string \| null | 头像地址，未设置为 null |
| `created_at` | string | 注册时间（站点本地时间，`YYYY-MM-DDTHH:MM:SS`） |

### 4.5 主动解绑（可选）

用户在第三方站点断开连接时调用，幂等：

```
POST /api/open/revoke
{ "client_id": "ac_xxxxxxxxxxxx", "client_secret": "acs_...", "token": "act_..." }
```

```json
{ "revoked": true }
```

---

## 5. 错误码

| 场景 | HTTP | 响应 `detail` |
|---|---|---|
| `client_id` 未登记 / 已停用（授权入口、应用信息） | 404 | 应用不存在或已停用（不在白名单内） |
| 回调地址与登记值不一致 | 400 | 回调地址与登记值不一致 |
| `client_id` 或 `client_secret` 错误 | 400 | client_id 或 client_secret 无效 |
| 授权码无效 / 已用过 / 已过期 | 400 | 授权码无效或已过期 |
| 未带令牌或令牌无效 / 已过期 / 用户已解绑 / 应用被停用 | 401 | 访问令牌无效或已过期 |
| 授权入口未登录 | 401 | Not authenticated |
| 调用过于频繁（令牌接口同 IP 每分钟 30 次） | 429 | 请求过于频繁，请稍后再试 |

---

## 6. 安全说明与限制

1. **令牌不是 JWT**：`act_` 开头的不透明随机串，服务端只存 sha256，**只能**用于 `/api/open/userinfo`，不能拿来访问博客、评论等站内接口。
2. **只读、最小范围**：当前只有 `profile` 一种范围（用户名、昵称、头像、注册时间）。读不到邮箱、密码，也拿不到任何写权限。
3. **有效期 30 天**：到期需用户重新授权；用户重新授权会**轮换令牌**（旧令牌立即失效，请覆盖本地保存值）。
4. **用户随时可解绑**：「我的 → 账号绑定 → 解除绑定」立即撤销令牌；第三方调 `userinfo` 会收到 401，请把它当作「用户已断开」处理。
5. **密钥只显示一次**：`client_secret` 只在登记/重置时明文出现；请存入服务端环境变量或配置中心，不要进代码仓库、不要下发前端。
6. **回调地址必须精确匹配**：这是防开放重定向的关键。请不要把用户可控参数拼进 `redirect_uri`。
7. **务必校验 `state`**：回调里比对发起时保存的值，不一致就中止（防 CSRF / 会话固定）。
8. **授权码只能换一次**：收到 code 立刻在服务端兑换，不要把 code 回传前端或落日志。
9. **限流**：令牌接口同 IP 每分钟 30 次（含失败），请勿在循环里重试。

---

## 7. 代码示例

### 7.1 服务端（Python / FastAPI）

```python
import os, secrets, urllib.parse
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse

ANTICRAFT = "https://anticraft.top"
CLIENT_ID = os.environ["ANTICRAFT_CLIENT_ID"]
CLIENT_SECRET = os.environ["ANTICRAFT_CLIENT_SECRET"]
REDIRECT_URI = "https://your-app.example.com/oauth/anticraft/callback"

app = FastAPI()

@app.get("/login/anticraft")
def start():
    state = secrets.token_urlsafe(16)
    # 生产环境请把 state 写进用户会话（cookie/session），回调时比对
    q = urllib.parse.urlencode({
        "client_id": CLIENT_ID, "redirect_uri": REDIRECT_URI, "state": state,
    })
    return RedirectResponse(f"{ANTICRAFT}/bind?{q}")

@app.get("/oauth/anticraft/callback")
async def callback(request: Request, code: str = "", state: str = "", error: str = ""):
    if error:
        return {"ok": False, "reason": error}          # 用户在授权页点了「取消」
    # if state != session["anticraft_state"]: abort()  # 防 CSRF，务必实现

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{ANTICRAFT}/api/open/token", json={
            "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "code": code,
        })
        r.raise_for_status()
        data = r.json()

    user = data["user"]            # {"id", "username", "nickname", "avatar_url", "created_at"}
    token = data["access_token"]   # 存服务端（加密），不要返回浏览器
    # TODO: 用 user["id"] 关联本地账号，建立登录态
    return {"ok": True, "user": user, "expires_in": data["expires_in"]}
```

### 7.2 服务端（Node / Express）

```js
import express from 'express'

const ANTICRAFT = 'https://anticraft.top'
const CLIENT_ID = process.env.ANTICRAFT_CLIENT_ID
const CLIENT_SECRET = process.env.ANTICRAFT_CLIENT_SECRET
const REDIRECT_URI = 'https://your-app.example.com/oauth/anticraft/callback'

const app = express()

app.get('/login/anticraft', (req, res) => {
  const state = crypto.randomUUID()
  req.session.anticraftState = state
  res.redirect(`${ANTICRAFT}/bind?` + new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state,
  }))
})

app.get('/oauth/anticraft/callback', async (req, res) => {
  const { code, state, error } = req.query
  if (error) return res.status(400).send('用户取消了授权')
  if (state !== req.session.anticraftState) return res.status(400).send('state 校验失败')

  const tokenRes = await fetch(`${ANTICRAFT}/api/open/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
  })
  if (!tokenRes.ok) return res.status(400).send('换取令牌失败：' + await tokenRes.text())
  const { access_token, user } = await tokenRes.json()

  // 需要最新资料时再查：
  const infoRes = await fetch(`${ANTICRAFT}/api/open/userinfo`, {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  const info = infoRes.ok ? (await infoRes.json()).user : user

  // TODO: 用 info.id 关联本地账号、保存 access_token（服务端）
  res.send(`欢迎，${info.nickname || info.username}`)
})
```

### 7.3 curl 手动联调

```bash
# 1) 浏览器打开授权页（换成自己的 client_id / 回调地址）
#    https://anticraft.top/bind?client_id=ac_xxx&redirect_uri=http%3A%2F%2Flocalhost%3A8899%2Fcallback&state=t1
#    同意后浏览器会跳到 http://localhost:8899/callback?code=acb_xxx&state=t1

# 2) 用授权码换令牌
curl -s -X POST https://anticraft.top/api/open/token \
  -H "Content-Type: application/json" \
  -d '{"client_id":"ac_xxx","client_secret":"acs_xxx","code":"acb_xxx"}'

# 3) 读用户资料
curl -s https://anticraft.top/api/open/userinfo -H "Authorization: Bearer act_xxx"
```

---

## 8. 常见问题

**Q：为什么回调地址不支持通配符？**
A：开放重定向是这类接口最典型的漏洞。逐个精确登记，才能保证授权码只会被送到你自己的地址。

**Q：`client_secret` 丢了？**
A：后台列表点「重置密钥」重新生成（旧密钥立即失效，**已建立的绑定不受影响**，用户无需重新授权）。

**Q：换令牌报 400「授权码无效或已过期」？**
A：三种可能——code 已用过（只能换一次）、超过 5 分钟、`client_id` 与签发该 code 的应用不一致。请立即兑换，不要缓存。

**Q：`userinfo` 返回 401？**
A：令牌过期（30 天）、用户已在「我的 → 账号绑定」解绑、或应用被管理员停用。三者都按「需要用户重新授权」处理。

**Q：同一用户重复授权会怎样？**
A：每用户每应用只保留一条绑定，重复授权 = **轮换令牌**，旧令牌立即失效（请用新令牌覆盖保存值）。

**Q：能读到邮箱、博客内容吗？**
A：不能。当前范围只有 `profile`：用户名、昵称、头像、注册时间。后续若增加范围会在此文档更新并需要用户在授权页再次确认。

**Q：本地开发怎么联调？**
A：登记时把 `http://localhost:5173/callback` 这类地址加进回调地址列表即可（http 与 localhost 都允许）。

---

## 9. 管理端操作对照（给站点管理员）

| 操作 | 位置 | 效果 |
|---|---|---|
| 登记新应用 | 管理后台 → 绑定应用 → 填表 → 登记应用 | 生成 `client_id` / `client_secret`（密钥仅显示一次） |
| 编辑 | 列表行「编辑」 | 改名/简介/主页/回调地址，立即生效 |
| 启用 / 停用 | 列表行「停用 / 启用」 | 停用后授权入口 404、令牌全部失效 |
| 重置密钥 | 列表行「重置密钥」 | 生成新密钥（旧密钥立即失效，绑定保留） |
| 删除 | 列表行「删除」 | 应用及其全部绑定一并作废 |

用户侧：**我的 → 账号绑定** 可查看绑定时间、最近调用时间、到期时间，并随时解除绑定。
