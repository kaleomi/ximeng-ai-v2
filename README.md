# 熙梦AI — Cloudflare 部署指南

图像 / 视频生成聚合工具（comfly + RunningHub），前端 + API 代理，适配 **Cloudflare Workers + Assets**。带**登录系统 + 积分系统**（与夏洛熙工具箱共用 Supabase 数据库，账号金币互通）。

## 架构

```
public/          静态前端 (Workers Assets 自动托管)
worker/
  index.js       Workers 入口: /api/* 路由 + CORS + 认证 + 积分扣费
  config.js      配置: API key 从环境变量读取
  auth.js        注册/登录/JWT (与夏洛熙共用 users 表 + JWT_SECRET)
  coins.js       积分: 原子扣费/退款/卡密 (coin_logs / recharge_keys 表)
  supabase.js    Supabase REST 封装 (零依赖)
  image.js       图像生成代理 (doubao / gpt-image-2 / gemini)
  video.js       视频生成代理 (Seedance ark / comfly)
  runninghub.js  RunningHub 工作流 (独立 Key)
server/          (可选) 本地 Node 版: node server/index.js
```

## 前置条件

1. 注册 Cloudflare 账号
2. 安装 Node.js >= 18
3. 准备 API Key：
   - comfly API Key（必填）
   - RunningHub Key（可选，视频工作流用）
   - Supabase URL + Key（与夏洛熙共用，已内置默认值）
   - JWT_SECRET（必须与夏洛熙一致：`running-hub-secret-key-2024`，否则两边 token 不互通）

## 本地开发（Workers 版）

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入真实 Key
npm run dev                      # http://localhost:8787
```

## 本地开发（Node 版）

```bash
cd server && npm install
node server/index.js             # http://localhost:3000
```

## 部署到 Cloudflare

```bash
npx wrangler login
npx wrangler secret put API_KEY
npx wrangler secret put BASE_URL
npx wrangler secret put RH_API_KEY
npx wrangler secret put JWT_SECRET        # running-hub-secret-key-2024 (与夏洛熙一致!)
npx wrangler secret put VITE_SUPABASE_URL
npx wrangler secret put VITE_SUPABASE_ANON_KEY
# 可选: npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm run deploy
```

## 认证与积分说明

- **登录注册**：用户名 + 密码 + 邮箱验证码（QQ SMTP）。JWT 7 天有效，**与夏洛熙共用同一 JWT_SECRET，两边登录态互通**
- **积分**：生成图像/视频按模型扣积分（config 里 `coins` 可调）。每日登录奖励 +0~3、邀请注册 +5、卡密兑换（recharge_keys 表）、失败自动退款
- **数据库**：users / coin_logs / recharge_keys 表均为夏洛熙已有，**无需新建表**
- Worker 版邮箱验证码内存存储（多副本建议改 KV）；Node 版用 nodemailer 发真实邮件

## API 端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/auth/send-code` | POST | 发送邮箱验证码 |
| `/api/auth/register` | POST | 注册（邮箱验证码 + 邀请码） |
| `/api/auth/login` | POST | 登录（含每日奖励） |
| `/api/auth/me` | GET | 当前用户信息（需 Bearer token） |
| `/api/coins/logs` | GET | 金币流水（需登录） |
| `/api/coins/redeem` | POST | 卡密兑换（需登录） |
| `/api/config` | GET | 模型/参数 schema |
| `/api/generate-image` | POST | 图像生成（登录用户自动扣积分） |
| `/api/generate-video` | POST | 视频提交（flavor: ark / comfly / runninghub） |
| `/api/video-status/:taskId` | GET | 视频状态查询 |
| `/api/upload` / `/api/rh-upload` | POST | 图片上传 |

## 安全提醒

- **API Key / Secret 必须放在环境变量里**，绝不能写进前端或仓库
- **JWT_SECRET 泄漏 = 能冒充任何用户**，务必用 `wrangler secret put` 设置
- `SUPABASE_SERVICE_ROLE_KEY` 是最高权限 key，只放服务端，建议生产填（可绕过 RLS）
- 部署公网后仍建议加**访问密码**或 Cloudflare Access 限制
- 生成结果 URL 有效期有限（RunningHub 24 小时），长期保存请自行下载
