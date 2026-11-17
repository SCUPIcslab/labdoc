# SCUPI CSLAB 手册

SCUPI CSLAB（N209ABC）实验室手册的 VitePress 静态站点。站点内容只包含可以放在互联网上的文档，管理员凭据和访问口令不写入站点。

- 站点：<https://scupicslab.github.io/labdoc/>
- 仓库：<https://github.com/SCUPIcslab/labdoc>

## 仓库定位

本仓库维护手册的唯一版本：站点内容在 `labdocs/`，配置在 `.vitepress/`，推送到 `main` 后由 GitHub Actions 自动构建并发布。

凭据、口令、密钥和内部账号不写入文档，只通过受控渠道交接。

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
├── package.json
└── package-lock.json
```

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

1. `npm ci`
2. `npm run docs:build`
3. 上传 `.vitepress/dist/` 并部署到 GitHub Pages。

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

- 仓库会发布到互联网，提交前确认没有真实口令、API Token、私钥、个人信息或内部账号。
- 管理员文档中的内部地址、设备型号和拓扑图直接写在本仓库中；需要收紧时，删除对应段落再发布。
- 如果 GitHub Pages 对无扩展名 URL 返回 404，检查 **Settings → Pages** 的部署状态；VitePress 的 `cleanUrls` 在 GitHub Pages 上由 `.html` 回退处理，通常不需要额外配置。
