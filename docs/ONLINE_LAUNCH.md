# Music Downloader 上线清单

这套仓库现在可以分成两部分上线：

- 桌面软件：Electron 应用，用户下载并安装。
- 官网和会员服务：`web/` 目录里的静态页面与 Cloudflare Worker 接口。

## 1. 准备安装包

当前仓库已有 `npm run build`，但还没有生成 `.exe`、`.dmg` 或 `.AppImage` 的安装器配置。正式上线前建议补充 Electron Builder 或 Electron Forge，然后把安装包上传到：

- GitHub Releases
- Cloudflare R2 / 阿里云 OSS / 腾讯云 COS
- 中国大陆访问更稳定的镜像源

上传后，把 `web/index.html` 里的下载链接替换成真实安装包地址。

## 2. 部署官网

`web/index.html` 是官网首页，包含：

- 搜索引擎标题和描述
- 软件介绍
- 网页下载入口
- 会员注册表单
- `robots.txt` 和 `sitemap.xml`

上线后需要把这些占位域名改掉：

- `https://example.com/`
- `https://example.com/downloads/musicdownloader-windows.exe`

部署方式可以选 Cloudflare Pages、Vercel、Netlify、阿里云 OSS 静态网站或腾讯云 COS 静态网站。

## 3. 部署会员接口

`web/worker.js` 提供两个接口：

- `POST /api/register`：网页注册会员，生成会员密钥。
- `POST /api/validate`：桌面软件验证会员密钥。

桌面软件的设置页里，`Validation URL` 应填写：

```text
https://你的域名/api/validate
```

Cloudflare Worker 部署步骤：

1. 创建 KV namespace，例如 `MEMBERSHIPS`。
2. 复制 `web/wrangler.toml.example` 为 `web/wrangler.toml`。
3. 把 `replace-with-your-kv-namespace-id` 换成真实 KV ID。
4. 在 `web/` 目录部署 Worker。

如果使用其他服务器，也只要保证验证接口返回桌面端需要的字段即可：

```json
{
  "active": true,
  "planName": "月度会员",
  "expiresAt": "2026-07-04T00:00:00.000Z",
  "memberId": "member-id",
  "message": "Membership verified."
}
```

## 4. 搜索收录

网站上线后：

- 提交 `sitemap.xml` 到 Google Search Console。
- 如果面向中文用户，提交到百度搜索资源平台。
- 页面标题、描述和正文要包含用户会搜索的关键词，例如“歌单下载工具”、“Spotify 歌单匹配”、“音乐下载管理器”。
- 给官网绑定 HTTPS 域名，保持安装包链接稳定。

## 5. 支付与合规

当前注册接口会直接生成会员密钥，适合内测和手动运营。正式收费前建议接入支付回调：

- Stripe、Paddle 或 Lemon Squeezy，适合海外收款。
- 支付宝、微信支付或国内聚合支付，适合中国大陆用户。

支付成功后再创建会员密钥。还需要准备隐私政策、服务条款、退款规则，并确认软件的下载行为符合目标市场的平台规则和版权要求。
