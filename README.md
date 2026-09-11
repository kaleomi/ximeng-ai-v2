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

## 节点工作流画布

从主站顶部「画布」进入 `/canvas/`。画布支持：

- 点击节点库或拖入节点；右键空白处快速添加。
- 从右侧输出端口拖到左侧输入端口；提示词、图片、视频按颜色区分。一个输出可连接多个节点，每个输入只接受一条连线。选中连线后按 Delete 断开。
- 图片节点可点击上传，或把图片拖到画布 / 图片节点。复制图片后在画布空白处按 Ctrl+V 会创建图片节点。支持 PNG、JPG、WebP、GIF、BMP，单张最大 20 MB。
- 滚轮缩放、空白处平移、缩略图导航、适应画布、自动整理、撤销 / 重做。
- 本机草稿自动保存到 IndexedDB；工作流菜单可导入 / 导出 JSON、加载示例、保存到云端或加载云端工作流。导入支持旧版画布节点及无端口编号的连线，不支持 ComfyUI 原生工作流格式。
- 主站和画布在相同域名、端口下共享登录与 API 设置。上传会调用现有 `/api/upload`；生成调用现有服务，需要有效的服务配置或主站 API 设置。
- 运行前检查必填输入，按依赖顺序执行；上游失败时跳过依赖节点。停止按钮中止当前客户端请求及后续执行，已提交的任务可能仍在服务端继续。

开发与构建（在项目根目录执行）：

```powershell
npm run check:canvas
npm run test:canvas
npm run build:canvas
npm run dev:node
```

构建成功会自动把 `canvas/dist` 同步到 `public/canvas`。本地服务通常使用 3000 端口，若被占用会在终端显示实际端口。也可在 `canvas` 内运行 `npm run dev`，开发页面使用 3002 端口，API 默认代理到 3000；可用环境变量 `CANVAS_API_TARGET` 调整代理地址。直接从主站的 `/canvas/` 使用可共享主站登录。

测试使用模拟 API，覆盖端口校验、旧格式兼容、图生图参数、上传、视频轮询、失败传播、取消与导出。不会调用付费生成服务。

### 单独运行节点与结果接力

每个节点内的「单独运行」只执行当前节点，直接读取已连接的上游结果。先单独运行图片生成 A，再把 A 右侧「图片输出」圆点连到图片生成 B 左侧「图片」入口，在 B 中填写新的描述并单独运行即可；也可连接视频生成或预览节点。上游尚未生成图片时会提示先运行上游，不会自动重跑它。提示词和已上传图片可以直接作为输入使用。

一次生成多张图片时，点击某张图下方的「设为输出图片」决定下游使用哪一张。单独运行不会清空其他节点的结果；重试失败也会保留当前节点上一次成功的图片。保存后重新打开，仍可使用保留的结果继续运行下一个节点。顶部「运行工作流」仍会重新执行整个工作流。

### 从 RunningHub 应用导入节点

画布左侧「导入 RunningHub」接受应用 ID、应用详情链接和 API 文档链接。例如输入 `2092254629307723778`，点击「读取参数并添加节点」，会读取 RunningHub 公开应用参数，并生成「MiniMax H3三图参考加音频」节点：3 个图片入口、2 个音频入口、提示词、比例、像素和时长参数。文档链接自动对应到该应用的 `api-detail/<ID>?apiType=4`。

每个入口以 RunningHub 的节点编号和字段名独立识别。连线优先于表单值；未修改的字段沿用应用默认值。图片、视频、音频字段可在节点内上传，也可填写链接或文件编号。上传和执行复用主站 API 设置中的 RunningHub Key（或服务端配置），公开参数导入不发送密钥。公开参数接口不可用或应用不公开时会显示错误，不会创建空壳节点。

点击「单独运行」只执行当前节点；图片、视频、音频和文字结果分别通过对应输出端口传递。未产生的输出类型不提供数据，运行下游时会提示。图片结果可继续连到现有「图片生成」节点的图片入口；多个图片结果可选择当前输出图片。导出 JSON 和本机自动保存会保留导入的参数定义、字段值、连线和结果。

本地 Node 服务和 Cloudflare Worker 均支持 `/api/runninghub/schema/:appId`，执行仍通过已有 RunningHub 提交与查询接口。测试使用公开参数样本与模拟执行响应，不提交付费任务。
