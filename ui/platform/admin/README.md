# PilotDeck 管理后台

独立中文 React 管理端。源码、构建产物、测试和 Vite 缓存均位于本目录。仓库内开发可复用现有 `ui/node_modules`；独立部署的依赖和锁文件位于上级 `ui/platform`，不修改根目录或 `ui/package.json`。

## 启动与构建

以下命令在仓库根目录执行，使用项目支持的 Node 22：

```powershell
node ui/node_modules/vite/bin/vite.js --config ui/platform/admin/vite.config.js
node ui/node_modules/vite/bin/vite.js build --config ui/platform/admin/vite.config.js
```

本机已有专用运行时也可直接使用：

```powershell
& .cache/runtime/node-v22.23.1-win-x64/node.exe ui/node_modules/vite/bin/vite.js --config ui/platform/admin/vite.config.js
& .cache/runtime/node-v22.23.1-win-x64/node.exe ui/node_modules/vite/bin/vite.js build --config ui/platform/admin/vite.config.js
```

- 开发入口：`http://127.0.0.1:3101`。
- 开发代理：`/api/platform` → `http://127.0.0.1:3100`。
- 默认端口启用 `strictPort`；若占用，可添加 `--port 3102`。
- 构建目录：`ui/platform/admin/dist`，资源基础路径为 `/`。
- 生产环境由独立服务提供 `dist` 静态文件，并在同源提供 `/api/platform`。不能将构建目录挂载在 `/admin/` 子路径。
- 后台不创建管理员、不提供默认账号或启动指引；管理员初始化由独立后端部署流程负责。

## 功能与接口

登录提交 `{email,password,deviceId,deviceName}`，接收 `{token,user}`，要求 `user.role === 'admin'`。令牌仅存于 `sessionStorage`；浏览器设备标识存于 `localStorage`。刷新通过 `GET /me` 验证会话，401 清理令牌并返回登录。普通用户登录后立即尝试撤销服务端会话。最终权限仍由后端验证。

| 页面 | 操作与数据 |
| --- | --- |
| 用户 | 邮箱查询、分页、新建、状态及权限编辑、密码重置 |
| 用户详情 | 分类余额、登录设备、指定/全部设备下线、资金流水、人工调整 |
| 模型 | 服务商、协议、地址、上游模型、密钥维护、能力、限额、输入及输出售价 |
| 应用 | 全局启停、允许的模型、默认模型 |
| 兑换码 | 批次生成、批次查询、状态筛选、作废、当前列表与新批次 CSV 导出 |
| 注册设置 | 注册开关、设备与并发默认值、新用户权限、赠送金额与有效期 |
| 账务 | 用户流水查询、导出、异常请求核查、释放预留或按核实 Token 结算 |
| 版本 | 发布版本、校验值及包大小、更新说明、安装包下载 |

金额输入使用十进制字符串及 BigInt 校验，再发送安全整数 micros。模型售价为「元 / 百万 Token」，乘以 1,000,000 转换为 API 的「微元 / 百万 Token」。钱包直接读取余额对象的 `availableMicros/rechargeMicros/giftMicros/heldMicros/adjustmentMicros/expiredMicros`。消费显示保留最多 12 位人民币小数，避免将微量实际消费显示为零。

人工调整、兑换码生成和异常核查均提供 `requestId`；不明确的网络/5xx 错误重试保留原始请求与编号。4xx 校验失败后允许修改重试。密钥编辑留空时不发送 `apiKey`，不读取或回显原密钥。兑换码列表通过显式的 `GET /admin/codes?export=true` 获取导出明码。CSV 转义引号及公式前缀。

## 验证

启动开发服务后执行：

```powershell
node --test ui/platform/admin/tests/money.test.js
node ui/node_modules/@playwright/test/cli.js test --config ui/platform/admin/playwright.config.js
```

测试其他本地端口时设置 `ADMIN_TEST_URL`。测试报告和截图输出到本目录 `test-results`，不提交运行产物。

若没有 Playwright 的 Chromium 缓存，可复用已安装的 Chrome，无需下载浏览器：

```powershell
$env:ADMIN_BROWSER_CHANNEL = 'chrome'
node ui/node_modules/@playwright/test/cli.js test --config ui/platform/admin/playwright.config.js
```

`tests/admin.spec.js` 的所有 API 都由 Playwright 拦截；`.test` 邮箱、密钥和账目仅为隔离 fixture，不连接真实后端、不生成真实账号或资金记录。覆盖登录及角色拒绝、会话验证/过期、空态/服务错误、价格精度、用户创建/设备撤销、调整幂等重试、应用权限、兑换码导出/作废、注册赠送、异常用量结算、版本发布以及桌面/手机布局。

## 边界

- 资金流水和兑换码界面显示最近 500 条，异常请求显示最早 500 条；界面明确标示范围。服务端列表支持偏移查询。兑换码可按批次查询，新生成的完整批次可立即导出（最多 1000 个）。当前列表导出不冒充全量历史导出。
- 模型连接测试调用 `POST /admin/models/:id/test`，会消耗运营者的供应商用量，不扣客户余额；实际功能兼容性仍需要供应商联调。
- 发布版本管理仅提交元数据，不上传安装包、不执行签名、不验证远程包内容或客户端安装流程。
- 浏览器 fixture 测试不能替代实际后端联调。线上模型、邮件、域名/TLS 和真实凭据不属于本目录的验证范围。

## 本次验证记录（2026-10-29）

- Vite 生产构建成功，产物位于 `dist`。
- Node 金额测试 2 项通过。
- Chrome / Playwright 最新完整运行 12 个场景通过。
- 已查看桌面用户列表及 390px 手机模型表单截图，布局检查通过。
- 已读取实际 `server/auth.js`、`server/billing.js`、`server/schema.js` 对齐账号、设备、钱包、兑换码和核查字段。
- 独立服务现已运行，隔离数据库和模拟服务商的完整接口/浏览器集成通过。配置接口使用 `{settings}`、`{models}`、`{apps}`、`{releases}` 包装，模型密钥标记使用 `hasApiKey`；版本字段使用 `version,notes,downloadUrl,sha256,sizeBytes,platform`，平台值为 `win32-x64`。这不等同于真实外部模型和邮件验证。
