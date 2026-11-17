# SCUPI CSLAB（N209ABC）手册

版本：1.0  
日期：2026年11月11日

## 这套手册是什么

SCUPI CSLAB 是四川大学匹兹堡学院计算机科学与技术实验室的英文名称。它拥有一套自建的私有云计算平台，把五台物理服务器、一台核心交换机、一台出口路由器和若干存储设备组织在一起，向上提供两类资源：带 NVIDIA RTX 4090 显卡的 GPU 虚拟机，以及面向普通计算任务的 CPU 虚拟机。实验室平台用 OpenStack 管理这些资源，用 Horizon 提供网页操作界面。

这套手册分三部分编写：

- **管理员视角**：面向负责机房、网络、服务器和 OpenStack 的维护人员，说明平台的结构、设备配置、日常巡检、故障处理和变更边界。
- **用户视角**：面向使用 GPU 虚拟机和 Horizon 的实验人员，说明如何登录、如何检查显卡、数据放在哪里、遇到问题怎样排查和上报。
- **安全**：面向管理员和普通用户，说明挖矿入侵的常见手法、防护基线、只读排查命令和失陷后的处置顺序。

[管理员视角](admin/index.md)说明平台结构、设备管理入口和权限边界，普通用户一般只需要阅读[用户视角](user/index.md)。两类读者都可以先看[安全总览](safety/index.md)，了解账号、SSH、隧道和异常进程的基本边界。

站内搜索覆盖全部公开页面。

需要按场景查命令时，直接看[命令速查与讲解](command.md)。它把登录、GPU、存储、网络、OpenStack、交换机和路由器的常用命令集中在一页，并说明输出怎么看、哪些命令不能随手执行。

## 阅读须知和部分记法约定

- 命令中方括号或尖括号包围的内容是占位符，例如 `<实例IP>`，输入时要替换成实际值。
- 文中出现的 `172.16.x.x`、`10.16.x.x`、`192.168.x.x` 都是实验室内部地址，离开实验室网络后不能直接访问。
- 文中给出的 CPU 核数、内存容量、显卡型号、显存大小、磁盘容量、端口数量属于硬件规格，短期内不会变化。
- 使用率、剩余空间、当前显存占用、链路协商速率、服务在线状态这类数据会随运行变化。需要查看时按“运行与日常维护”或“常见疑难解答”中的命令现场查看。
- 专业名词第一次出现时会给出解释，后文直接使用简称。

## 常用术语

| 术语 | 含义 |
|---|---|
| OpenStack | 一套开源的云计算管理平台，负责创建虚拟机、分配网络和存储、管理账号。可以把它理解成实验室自建的“云操作系统”。 |
| 虚拟机 / 实例 | 运行在物理服务器上的独立计算机。实例是 OpenStack 对虚拟机的称呼。 |
| 宿主机 / Hypervisor | 实际运行虚拟机的物理服务器。Hypervisor 是宿主机上负责模拟 CPU、内存和设备的软件层，本项目使用 KVM。 |
| 镜像 | 安装虚拟机时使用的系统模板，包含操作系统和预装软件。 |
| 规格 / Flavor | 创建虚拟机时选择的资源套餐，例如 8 核 CPU、16 GiB 内存、是否带显卡。 |
| 卷 / Volume | 可以挂载给虚拟机的虚拟磁盘。虚拟机删除后，卷可以保留。 |
| 项目 / Project | OpenStack 中的资源隔离单位。不同项目的实例、网络和卷默认互不可见。 |
| 安全组 | 作用于虚拟机网卡的防火墙规则集合，控制哪些地址和端口可以访问实例。 |
| 浮动 IP | 可以从实验室管理网访问虚拟机的公网样式地址，由 Neutron 路由器转发到实例的固定 IP。 |
| VLAN | Virtual Local Area Network，虚拟局域网。它把一台物理交换机从逻辑上划分成多个互不相通的二层网络。 |
| VXLAN | Virtual Extensible LAN，虚拟可扩展局域网。它把二层帧封装进 UDP 报文，在三层网络之上构建虚拟二层网络。 |
| LACP | Link Aggregation Control Protocol，链路聚合控制协议。它把多条物理链路捆成一条逻辑链路，提高带宽和冗余。 |
| iSCSI | Internet Small Computer Systems Interface，一种把 SCSI 磁盘命令封装到 TCP/IP 中传输的协议。Cinder 用它把宿主机的磁盘卷提供给其他主机。 |
| LVM | Logical Volume Manager，Linux 逻辑卷管理器。它在物理磁盘之上建立卷组和逻辑卷，便于动态划分空间。 |
| PCI Passthrough | PCI 直通。它把一张真实的 PCI 设备（例如显卡）完整交给虚拟机使用，虚拟机看到的是物理设备本身。 |
| BMC | Baseboard Management Controller，服务器带外管理控制器。它独立于操作系统，用于远程查看硬件状态、开关机和打开远程控制台。 |
| Horizon | OpenStack 的网页控制台。用户通过浏览器创建实例、查看网络和挂载卷。 |
| SSH | Secure Shell，加密远程登录协议。用户在本地终端输入命令，通过加密连接在服务器上执行。 |
| CUDA | NVIDIA 的 GPU 计算平台和编程接口。深度学习框架通过 CUDA 调用显卡。 |
| Conda | Python 环境和包管理器。它可以在同一台机器上创建多个相互隔离的 Python 环境。 |
| PyTorch | 一个常用的深度学习框架，用 Python 编写模型和训练程序。 |
| API | Application Programming Interface，应用程序接口。服务之间通过 API 交换请求和结果。 |
| MTU | Maximum Transmission Unit，最大传输单元。网络接口一次能传输的最大数据包大小。 |
| ACL | Access Control List，访问控制列表。交换机或路由器用来匹配流量并决定放行或拒绝的规则集合。 |
| SNMP | Simple Network Management Protocol，简单网络管理协议。监控系统用它读取交换机、服务器等设备的运行指标。 |
| NTP | Network Time Protocol，网络时间协议。主机通过它把系统时钟同步到统一时间源。 |
| NUMA | Non-Uniform Memory Access，非统一内存访问。CPU 访问本地内存比访问另一颗 CPU 的内存更快。 |
| RAID | Redundant Array of Independent Disks，独立磁盘冗余阵列。它把多块磁盘组合成逻辑设备，提供冗余或性能。 |
| Kolla | 一套把 OpenStack 服务打包进容器运行的部署方案。 |
| Pacemaker / Corosync | Pacemaker 是集群资源管理器，Corosync 是集群通信层。两者配合管理服务启停和节点状态。 |
| SNAT / DNAT | Source NAT / Destination NAT，源地址转换 / 目的地址转换。SNAT 改写出站源地址，DNAT 改写入站目的地址。 |
| VTEP | VXLAN Tunnel Endpoint，VXLAN 隧道端点。它负责把二层帧封装进 UDP 报文并在物理网络上传送。 |
| VFIO / IOMMU | VFIO 是 Linux 的 PCI 设备直通框架，IOMMU 负责设备直接访问内存时的地址转换和隔离。 |
| Trunk / Access / PVID / SVI | Trunk 是承载多个 VLAN 的端口，Access 是只属于一个 VLAN 的端口，PVID 是 Trunk 收到无标签帧时归属的 VLAN，SVI 是交换机的 VLAN 三层接口。 |

## 文档结构

### 命令速查

[命令速查与讲解](command.md)：按“环境确认 → SSH 与文件 → 磁盘与进程 → GPU 与 Conda → 网络与日志 → OpenStack → 宿主机与网络设备”的顺序整理命令。普通用户看前半部分即可；带【管理员】标记的段落只适用于基础设施维护人员。

### 安全

从[安全总览](safety/index.md)进入，按“看懂手法 → 关小入口 → 发现异常 → 处置 → 复盘”的顺序组织：

1. [挖矿入侵手法](safety/mining.md)：入口、提权、持久化、隐藏、外联和横向。
2. [防护基线](safety/hardening.md)：SSH、账号、权限、隧道、持久化、日志、出网和月度检查表。
3. [入侵排查与命令](safety/inspect.md)：五分钟快查、进程/网络/持久化/账号/日志排查和输出判读。
4. [应急处置与上报](safety/response.md)：隔离、取证、切断重生链、清除、恢复、验证和上报模板。

### 管理员视角

从[管理员视角总目录](admin/index.md)进入，建议按下面的顺序阅读：

1. [网络架构](admin/network.md)：地址规划、VLAN、路由、DHCP/DNS、链路聚合和覆盖网络（overlay）。
2. [OpenStack 架构](admin/openstack.md)：控制节点、计算节点、核心服务、项目、规格和网络模型。
3. [物理计算资源](admin/compute.md)：五台服务器的 CPU、内存、磁盘、网卡、显卡和角色划分。
4. [出口路由器](admin/router.md)、[核心交换机](admin/switch.md)、[数据存储](admin/storage.md)：三类关键设备的具体配置和维护要点。
5. [运行与日常维护](admin/maintenance.md)：巡检、升级、备份、健康检查和变更流程。
6. [一键巡检与时间节点检查](admin/check.md)：整合现有脚本，运行一次生成带时间戳的 Markdown 检查报告。
7. [风险评估与问题上报](admin/report.md)：发现问题后如何复现、保留现场信息、定级和上报。
8. [文档维护](admin/vitepress.md)：本地预览、新增页面的侧边栏登记、构建和 GitHub Pages 发布约定。

### 用户视角

从[用户视角总目录](user/index.md)进入，正文分为：

1. [账号与权限](user/account.md)：账号申请、登录、个人账号与项目账号的区别、权限边界。
2. [GPU 使用](user/gpu.md)：显卡检查、显式指定设备、Conda 环境、多卡任务和资源释放。
3. [数据与存储](user/storage.md)：磁盘布局、数据放在哪里、空间清理和备份。
4. [文件传输](user/transfer.md)：`scp`、`rsync`、`sftp`、Windows 工具和传输失败的排查。
5. [网络与代理](user/proxy.md)：镜像源、离线下载，以及获得许可后通过 SSH 反向代理访问外部服务。
6. [常见疑难解答](user/faq.md)：SSH、显卡、显存、磁盘、Conda 和网络问题的排查。
7. [使用规范](user/rules.md)：账号、软件、GPU、网络、AI 工具、现场行为、文件和数据安全的红线。
8. [问题上报](user/report.md)：上报前检查、诊断命令、模板和定级参考。

## 维护约定

- 设备配置、地址规划、服务组件发生变化时，同步修改对应章节，不要只改一处。
- 安全基线、排查命令、IOC 和事件复盘统一维护在 `safety/`，其他页面只保留入口和简短说明，避免同一规则在多处不一致。
- 手册描述的是“应该怎样”和“怎样检查”，不是实时监控面板。需要判断平台当前是否正常时，按维护章节的命令采集现场输出。
- 管理凭据不写入公开文档；需要维护入口时由管理员通过内部渠道交接。
- 普通用户文档中不要出现网络设备、宿主机和 BMC 的管理账号。

