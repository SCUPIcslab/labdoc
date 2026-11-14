# OpenStack 架构

## 概述

OpenStack 是平台的管理层。它把五台物理服务器抽象成可分配的计算资源，把本地磁盘抽象成可挂载的卷，把 VLAN 和 VXLAN 抽象成虚拟网络，再用 Keystone 统一认证、用 Horizon 提供网页界面。

平台的控制面只有一台虚拟机，运行在 host50 上。它不是高可用控制面：这台虚拟机停止后，创建实例、挂载卷、修改网络等管理操作都会中断，已经运行的虚拟机通常还能继续跑，但无法通过 OpenStack 管理。理解这个边界，才能判断故障影响范围。

## 控制节点

控制节点是一台运行在 host50 上的 libvirt 虚拟机，主机名为 `openstack-controller`，配置为 16 vCPU、约 32 GiB 内存。它不是 OpenStack 管理的 Nova 实例，而是 host50 上由 libvirt 直接管理的虚拟机。它使用 Ubuntu 20.04，配置了五张 VirtIO 网卡，分别接在 br3701、br3702、br3703、br3704 和 br-install 上。客户机内实际启用的只有两张：

| 网卡 | 地址 | 接入网桥 | 作用 |
|---|---|---|---|
| ens3 | 10.16.23.41/16 | br3701 | OpenStack 内部 API、数据库、消息队列和 iSCSI 通信。 |
| ens4 | 未启用 | br3702 | 预留网卡。 |
| ens5 | 未启用 | br3703 | 预留网卡。 |
| ens6 | 172.16.23.41/24 | br3704 | 管理网入口，Horizon 和外部 API 访问。 |
| ens7 | 未启用 | br-install | 安装网预留。 |

控制节点的默认路由指向 172.16.23.1，也就是 H3C 的 VLAN 3704 网关。它通过 ens6 访问管理网，通过 ens3 访问 OpenStack 内部网络。

控制面使用 **Kolla** 部署。Kolla 是一套把 OpenStack 服务打包进容器运行的部署方案，每个服务（例如 Nova API、Neutron Server、Glance API）运行在独立容器中。节点上同时运行 Pacemaker 和 Corosync（集群资源管理器和集群通信层），用于管理这些容器化资源的启停。由于只有一台控制节点，Pacemaker/Corosync 不能在一台机器整体故障时接管服务，它的作用是本机资源编排，不是跨节点高可用。

## 核心服务

控制节点上运行以下核心服务：

| 服务 | 作用 |
|---|---|
| Keystone | 身份认证和服务目录。用户、服务账号先向它申请令牌，其他服务用令牌判断请求是否合法。 |
| Horizon | 网页控制台，基于 Apache 提供。用户通过浏览器访问 172.16.23.41。 |
| Nova API / Scheduler / Conductor | 接收创建实例请求、选择宿主机、协调虚拟机生命周期。 |
| Nova Metadata / NoVNC / Spice Proxy | 向实例提供元数据服务，向用户提供控制台代理。 |
| Neutron Server | 接收网络、子网、路由、安全组和浮动 IP 的 API 请求。 |
| Neutron Metadata Proxy | 把实例的元数据请求转发给 Nova。 |
| Glance API | 管理镜像，提供镜像上传、下载和查询。 |
| Placement | 记录每台宿主机可用的 vCPU、内存和 PCI 设备，供 Nova 调度。 |
| Cinder API / Scheduler / Backup | 接收卷操作请求、选择存储后端、执行备份。 |
| MariaDB | 保存 OpenStack 各服务的状态数据。 |
| RabbitMQ | 服务之间的消息队列，Nova、Neutron、Cinder 通过它传递异步任务。 |

计算节点上运行 `nova-compute` 和 `neutron-linuxbridge-agent`。Neutron 的 DHCP agent 和 Metadata agent 分布在五台计算节点上，L3 agent 只运行在 host50 和 host51 上，组成 HA 路由器的 active/standby 节点。控制节点不承载计算和网络代理；它主要承载 API、调度、数据库、消息队列，以及 Cinder 的备份和卷服务进程。实际的卷后端仍在 host50 和 host51 上。

## 扩展服务

服务目录中还注册了以下扩展服务：

| 服务 | 作用 | 使用状态 |
|---|---|---|
| Heat | 用模板编排一组云资源，例如一次创建多台实例和网络。 | 已注册，按项目需要启用。 |
| Octavia | 负载均衡服务，管理负载均衡器和监听器。 | 已注册，配套 `lb-mgmt-net`。 |
| Manila | 共享文件系统服务，为实例提供共享目录。 | 已注册，配套 `manila_service_network`。 |
| Senlin | 集群管理服务，按策略扩缩容一组实例。 | 已注册，按项目需要启用。 |
| Masakari | 实例高可用服务，监测宿主机故障并恢复实例。 | 已注册，是否真正接管故障需单独验证。 |
| Cyborg | 加速器管理服务，管理 GPU、FPGA 等加速设备。 | 已注册，GPU 直通主要由 Nova 的 PCI 别名完成。 |

“已注册”只说明 Keystone 的服务目录里有这个服务，不代表它已经配置好、能直接给普通用户使用。启用某个扩展服务前，先确认它的数据库、消息队列、网络和配置文件都完整。

## 计算节点和可用区

五台物理服务器都是 Nova 计算节点，分成两个可用区（Availability Zone，AZ）。可用区是 Nova 调度时使用的逻辑分组，用户创建实例时可以选择把实例放到哪个 AZ。

| 可用区 | 节点 | 角色 |
|---|---|---|
| `host50_51_GPU` | host50、host51 | GPU 计算节点，同时提供 Cinder 本地存储。 |
| `host52_54` | host52、host53、host54 | CPU 计算节点，不提供本地 Cinder 存储。 |

所有计算节点使用 KVM 虚拟化，CPU 模式为 `host-model`。`host-model` 让虚拟机看到接近宿主机型号的 CPU 特性，便于运行需要特定指令集的计算库。宿主机 CPU 分配比例为 1.6，内存分配比例为 1.0，磁盘分配比例为 1.0。CPU 允许一定超分，内存和磁盘不超分。

## 规格

创建实例时选择的资源套餐称为规格（Flavor）。平台提供以下规格：

| 规格 | vCPU | 内存 | 显卡直通别名 | 适用场景 |
|---|---|---|---|---|
| `32c64gGPUx2` | 32 | 64 GiB | 2 张 VGA + 2 个音频功能 | 双卡 GPU 训练和大模型推理。 |
| `8c16gGPU4090x2` | 8 | 32 GiB | 2 张 VGA + 2 个音频功能 | 轻量双卡任务。 |
| `8c16gGPU4090x1` | 8 | 32 GiB | 1 张 VGA + 1 个音频功能 | 单卡 GPU 任务。 |
| `8c16` | 8 | 16 GiB | 无 | 普通 CPU 任务。 |
| `4c4g` | 4 | 4 GiB | 无 | 轻量测试和辅助任务。 |

GPU 规格中的 `pci_passthrough:alias` 是 Nova 的 PCI 直通别名。它告诉调度器：这个规格需要几张 RTX 4090 的 VGA 功能和对应的音频功能。音频功能是显卡 HDMI/DisplayPort 音频的一部分，单独直通可以减少虚拟机识别和设备兼容问题。

## 实例

平台预置的业务实例包括：

| 实例 | 地址 | 宿主机 | 规格 | 系统盘 |
|---|---|---|---|---|
| `gpu_server_2x4090_1` | 172.16.33.91 | host51 | `32c64gGPUx2` | 1 TiB，来自 host51 的 Cinder 后端。 |
| `gpu_server_2x4090_2` | 172.16.33.247 | host50 | `32c64gGPUx2` | 1 TiB 系统盘 + 1 TiB 数据盘，均来自 host50 的 Cinder 后端。 |
| `Test` | 172.16.33.11 | host54 | `8c16` | 64 GiB Cinder 卷，挂载在 host54。 |

三台实例都使用 “boot from volume”（从卷启动）方式。系统盘不是宿主机上的一个 qcow2 文件，而是一块 Cinder 卷。这样做的好处是实例可以迁移、卷可以单独备份；代价是实例启动依赖 Cinder 和 iSCSI 路径。

实例在 OpenStack 中显示 `ACTIVE`，只代表控制面认为它存在并且电源状态正常。要判断实例内部是否健康，需要登录实例检查操作系统、网络和显卡。

## 网络模型

OpenStack 网络建立在物理网络的 VLAN 之上。主要对象包括：

- `net3711`：VLAN 网络，子网 172.16.31.0/24，供 T3711 项目使用。
- `net3713`：VLAN 网络，子网 172.16.33.0/24，GPU 实例和 T3713 项目使用。
- `public-exnet`：flat 外部网络，子网 172.16.23.0/24，提供浮动 IP 和 SNAT。
- `lb-mgmt-net`：VXLAN 网络，10.1.0.0/24，Octavia 使用。
- `HA network tenant ...`：VXLAN 网络，169.254.192.0/18，Neutron 路由器高可用使用。
- `manila_service_network`：VXLAN 网络，没有子网，作为 Manila 服务网络占位。

Neutron 路由器 `router` 是 HA 路由器，外部网关地址为 172.16.23.201，启用 SNAT。实例访问外网时，源地址被转换成 172.16.23.201；外部访问实例时，通过浮动 IP 做 DNAT。浮动 IP 从 `public-exnet` 的地址池分配，绑定到端口后才生效。

VXLAN 网络的 MTU 是 1450，物理网络是 1500。虚拟机如果走 VXLAN，网卡 MTU 不能超过 1450，否则大包会被分片或丢弃。详细的网络分层、VLAN 和路由见[网络架构](network.md)。

## 存储模型

Cinder 是 OpenStack 的块存储服务。它管理卷的创建、挂载、快照和备份，但不直接把文件系统暴露给用户；用户看到的是块设备，例如 `/dev/vdb`，需要自己在虚拟机内格式化和挂载。

平台的 Cinder 后端位于 host50 和 host51，各自使用本地磁盘建立 LVM 卷组，再通过 iSCSI 导出逻辑卷。卷类型 `IPSAN` 映射到后端名称 `ipsan`，两个后端都使用这个名称。实例的系统盘和数据盘都是 Cinder 卷。

详细的 LVM、iSCSI、thin pool 和备份说明见[数据存储](storage.md)。

## 项目和账号

平台有六个 OpenStack 项目：

| 项目 | 用途 |
|---|---|
| `T3711` | 项目 T3711 的资源空间。（保留，暂不使用） |
| `T3712` | 项目 T3712 的资源空间。（保留，暂不使用）|
| `T3713` | GPU 实例和普通用户主要使用的项目空间。 |
| `service` | OpenStack 服务账号和共享服务资源。 |
| `admin` | 平台管理员项目，保存管理镜像和系统资源。 |

普通用户使用项目账号登录 Horizon，例如 `<项目账号>`。项目账号不是 Linux 账号，不能用来 SSH 登录虚拟机。虚拟机内的个人账号由管理员单独创建，和 OpenStack 账号是两套体系。

## API 入口和版本

Horizon 的网页入口是：

```text
http://172.16.23.41
```

OpenStack API 的内部入口是：

```text
http://10.16.23.41:5000/v3      Keystone
http://10.16.23.41:8774/v2.1    Nova
http://10.16.23.41:9696         Neutron
http://10.16.23.41:8776/v3      Cinder
http://10.16.23.41:9292         Glance
http://10.16.23.41:8780         Placement
```

所有服务注册在 `RegionOne` 区域。RegionOne 是 Keystone 服务目录中的区域名称，单区域部署时通常固定使用这个名字。控制节点上的组件版本包括 Nova 23.2.2、Cinder 18.2.0、Keystone 19.0.0，OpenStack 命令行客户端版本为 5.5.0。版本信息用于判断兼容性，升级前要确认各组件和 Kolla 镜像的对应关系。

## 维护注意

- 控制节点是单点。重启控制节点前，先确认没有正在进行的创建、删除、挂载、迁移操作。
- 修改 Nova、Neutron、Cinder 配置后，按 Kolla 的方式重新生成配置并重启对应容器，不要直接改容器内的临时文件。
- 时间同步对 Cinder 和 Nova 很重要。宿主机时间偏差过大会导致心跳误判，把正常的服务标记为 down。
- 删除实例前确认它的卷是否还需要保留。删除实例不会自动删除卷，卷可能仍然占用存储。
- 修改网络或安全组后，用实例内的 `ping`、`curl`、`ss` 验证，不要只看 Horizon 的状态。


---

返回[管理员视角总目录](index.md) ｜ 返回[手册首页](../index.md)
