import { defineConfig } from 'vitepress'

// GitHub Pages 项目站点挂在 https://<org>.github.io/<repo>/ 下，构建时必须带 base。
// 在 GitHub Actions 中自动取仓库名；本地开发和 org 根站点保持 `/`。
// 如果仓库改名为 <org>.github.io，这里会自动回到根路径。
const repository = process.env.GITHUB_REPOSITORY?.split('/')[1]
const isRootPagesSite = repository?.toLowerCase().endsWith('.github.io') ?? false
const base =
  process.env.GITHUB_ACTIONS === 'true' && repository && !isRootPagesSite
    ? `/${repository}/`
    : '/'

export default defineConfig({
  srcDir: './labdocs',
  lang: 'zh-CN',
  base,
  title: 'SCUPI CSLAB 手册',
  description: 'SCUPI CSLAB（N209ABC）实验室手册：管理员视角与用户视角',
  cleanUrls: true,
  lastUpdated: false,
  head: [['meta', { name: 'theme-color', content: '#3451b2' }]],

  vite: {
    server: {
      fs: {
        // 打印稿放在 print/，不进入 VitePress 页面和站点构建。
        deny: ['**/print/**']
      }
    }
  },

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '命令速查', link: '/command' },
      { text: '安全', link: '/safety/' },
      { text: '管理员视角', link: '/admin/' },
      { text: '用户视角', link: '/user/' }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/SCUPIcslab/labdoc' }
    ],

    sidebar: [
      {
        text: '总览',
        items: [
          { text: '手册首页', link: '/' },
          { text: '命令速查与讲解', link: '/command' }
        ]
      },
      {
        text: '安全',
        collapsed: false,
        items: [
          { text: '安全总览', link: '/safety/' },
          { text: '挖矿入侵手法', link: '/safety/mining' },
          { text: '防护基线', link: '/safety/hardening' },
          { text: '入侵排查与命令', link: '/safety/inspect' },
          { text: '应急处置与上报', link: '/safety/response' }
        ]
      },
      {
        text: '管理员视角',
        collapsed: false,
        items: [
          { text: '概述', link: '/admin/' },
          {
            text: '总体架构',
            collapsed: false,
            items: [
              { text: '网络架构', link: '/admin/network' },
              { text: '网络架构图', link: '/admin/topo' },
              { text: 'OpenStack 架构', link: '/admin/openstack' },
              { text: '物理计算资源', link: '/admin/compute' }
            ]
          },
          {
            text: '关键设备',
            collapsed: false,
            items: [
              { text: '实验室路由器', link: '/admin/router' },
              { text: '交换机', link: '/admin/switch' },
              { text: '数据存储', link: '/admin/storage' },
              { text: '磁盘的挂载', link: '/admin/mount' }
            ]
          },
          { text: '运行与日常维护', link: '/admin/maintenance' },
          { text: '一键巡检与时间节点检查', link: '/admin/check' },
          { text: '风险评估与问题上报', link: '/admin/report' },
          { text: '文档维护', link: '/admin/vitepress' }
        ]
      },
      {
        text: '用户视角',
        collapsed: false,
        items: [
          { text: '概述', link: '/user/' },
          { text: '账号与权限', link: '/user/account' },
          { text: 'GPU 使用', link: '/user/gpu' },
          { text: '数据与存储', link: '/user/storage' },
          { text: '文件传输', link: '/user/transfer' },
          { text: '网络与代理', link: '/user/proxy' },
          { text: '服务器瓶颈', link: '/user/bottleneck' },
          { text: '常见疑难解答', link: '/user/faq' },
          { text: '使用规范', link: '/user/rules' },
          { text: '问题上报', link: '/user/report' }
        ]
      }
    ],

    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    returnToTopLabel: '回到顶部',
    skipToContentLabel: '跳到主要内容',
    sidebarMenuLabel: '目录',
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '未找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭'
            }
          }
        }
      }
    },

    footer: {
      message: 'SCUPI CSLAB（N209ABC）· 实验室文档',
      copyright: '公开文档'
    }
  }
})
