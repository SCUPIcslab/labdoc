# SCUPI CSLAB 手册（公开版）

SCUPI CSLAB（N209ABC）实验室手册的 VitePress 静态站点。公开版只包含可以放在互联网上的文档，不含管理员凭据页、访问口令、`server.mts` 或任何站点侧鉴权逻辑。

- 公开站点：<https://scupicslab.github.io/labdoc/>
- 公开仓库：<https://github.com/SCUPIcslab/labdoc>

## 仓库定位

本仓库只维护公开版。完整内网版由实验室内网单独维护，仓库地址和部署方式不对外公开。

公开版与内网版独立维护，不再使用分支区分：

- 内网内容不要合并或复制到本仓库。
- 本仓库的删除操作不要反向合并回内网版本。
- 凭据、口令、密钥和内部账号只保留在受控渠道中。

## 目录结构

```text
.
├── .github/workflows/deploy-pages.yml   # GitHub Actions：构建并部署到 GitHub Pages
├── .vitepress/
│   ├── config.mts                      # VitePress 配置（自动计算 GitHub Pages base）
│   └── theme/                          # 主题与字体
├── labdocs/
│   ├── index.md
│   ├── command.md
│   ├── admin/                          # 管理员视角
│   ├── user/                           # 用户视角
│   ├── safety/                         # 安全：挖矿手法、防护、排查、处置
│   └── public/                         # 原样复制到站点根目录的静态文件
├── print/                              # 离线打印材料，不参与站点构建
├── package.json
└── package-lock.json
```

`labdocs/` 下没有 `password/`。公开搜索索引也不包含任何凭据页内容。

`print/` 不在 VitePress 的 `srcDir` 内，不会出现在站点中，页面也不链接到它。打印稿单独编译成 PDF。

## 本地开发

```bash
npm ci
npm run docs:dev
```

`docs:dev` 默认监听 `0.0.0.0:5173`，内网其他机器可以通过 `http://<本机内网IP>:5173/` 访问。只想在本机访问时用 `npm run docs:dev:local`。Windows 首次运行时如果弹出防火墙提示，允许“专用网络”即可。

构建静态文件：

```bash
npm run docs:build
```

构建结果在 `.vitepress/dist/`。本地预览：

```bash
npm run docs:preview
```

要求 Node.js 18 或更高版本，推荐 Node.js 22。

### 关于 `base`

GitHub Pages 项目站点地址是 `https://scupicslab.github.io/labdoc/`，所以构建时必须使用 `base: '/labdoc/'`。`.vitepress/config.mts` 会在 GitHub Actions 中根据 `GITHUB_REPOSITORY` 自动计算：

- 仓库名为 `labdoc` → base 为 `/labdoc/`
- 仓库名为 `SCUPIcslab.github.io` → base 为 `/`
- 本地开发 → base 为 `/`

本地想模拟 GitHub Pages 的路径构建时：

```powershell
$env:GITHUB_ACTIONS = 'true'
$env:GITHUB_REPOSITORY = 'SCUPIcslab/labdoc'
npm run docs:build
```

```bash
GITHUB_ACTIONS=true GITHUB_REPOSITORY=SCUPIcslab/labdoc npm run docs:build
```

## 部署到 GitHub Pages

### 首次配置

1. 打开仓库 **Settings → Pages**。
2. 在 **Build and deployment → Source** 中选择 **GitHub Actions**。
3. 推送到 `main`，或到 **Actions → Deploy to GitHub Pages** 手动运行一次。

workflow 会执行：

1. 检查仓库中没有 `labdocs/password/`、`server.mts`、`.vitepress/auth.mts`、`.vitepress/auth.secret`。
2. `npm ci`
3. `npm run docs:build`
4. 上传 `.vitepress/dist/` 并部署到 GitHub Pages。

部署完成后，站点地址为：

```text
https://scupicslab.github.io/labdoc/
```

第一次部署后，在 **Settings → Pages** 可以看到实际地址。需要自定义域名时，在同一页面配置 **Custom domain**，并在仓库中添加 `CNAME` 文件或按 GitHub 提示配置 DNS。

### 日常更新

```bash
git add .
git commit -m "Update handbook"
git push
```

推送到 `main` 后自动重新构建并发布。

## 维护注意

- 本仓库是公开仓库，提交前确认没有真实口令、API Token、私钥、个人信息或内部账号。
- 管理员文档中的内部地址、设备型号和拓扑图属于公开版的一部分；如果以后需要收紧，先把对应段落移到内网版本，再从本仓库删除。
- 不要在公开版中恢复 `/password/`、`server.mts` 或鉴权中间件。
- 如果 GitHub Pages 对无扩展名 URL 返回 404，检查 **Settings → Pages** 的部署状态；VitePress 的 `cleanUrls` 在 GitHub Pages 上由 `.html` 回退处理，通常不需要额外配置。
