# 文档维护

本手册用 VitePress 构建，并部署到 GitHub Pages。这一页写给需要修改文档的人：怎样在本地预览、往哪里加页面、提交后怎样上线。只阅读文档的用户不需要看本页。

手册的源码和文档都放在 GitHub 仓库 <https://github.com/SCUPIcslab/labdoc>。

## 环境准备

需要 Node.js 18 或更高版本，以及 Git。仓库已经把 VitePress 声明为开发依赖，克隆后先在仓库根目录安装：

```bash
npm install
```

不要用 `npm install -g vitepress` 全局安装。全局版本可能和仓库锁定的版本不一致，构建结果会跟着变。所有命令都从仓库根目录执行，VitePress 会自动读取 `.vitepress/config.mts`。

## 本地预览

启动开发服务器，修改 Markdown 后浏览器会自动刷新：

```bash
npm run docs:dev
```

默认监听 `0.0.0.0:5173`，方便同一局域网内的其他设备一起检查。只想在本机预览时用：

```bash
npm run docs:dev:local
```

预览地址是 <http://127.0.0.1:5173/>。需要检查构建后的效果时，先 `npm run docs:build`，再执行 `npm run docs:preview`。

## 目录与写作约定

- 正文放在 `labdocs/`，这是配置里的 `srcDir`。
- 站点地址、导航和侧边栏在 `.vitepress/config.mts` 中维护。**新增页面后要在侧边栏登记**，否则页面可以直接访问，但不会出现在导航里。
- 页面之间用相对路径加 `.md` 链接，例如 `[使用规范](rules.md)`；不要写死完整网址。
- 图片和静态文件放在 `labdocs/public/`，引用时以 `/` 开头。
- 每篇文档保留一个一级标题，章节用二级、三级标题；站点会自动生成本页目录。

## 构建与部署

本地确认无误后提交并推送：

```bash
npm run docs:build
git add .
git commit -m "Update docs"
git push
```

推送到 `main` 分支后，GitHub Actions 会执行 `.github/workflows/` 中的工作流，构建站点并部署到 GitHub Pages。构建时根据仓库名自动设置 `base`，所以页面里的站内链接要用相对路径或站点根路径，不要写死仓库名。

GitHub的用户名和账号密码在实验室内部。

## 官方文档

VitePress 的配置项、主题和 Markdown 扩展见 <https://vitepress.dev/>。修改 `config.mts` 前先对照官方文档，避免使用已弃用的选项。

---

返回[管理员视角总目录](index.md) ｜ 返回[手册首页](../index.md)
