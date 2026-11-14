# 网络架构图


本页给出实验室网络的彩色总图。它把出口、核心交换、五台服务器、BMC、无线接入和 OpenStack 虚拟网络画在同一张图上，适合在排查前先建立整体位置感，或向他人讲解平台结构。


## 总图

<a href="/admin/topology.svg" target="_blank" rel="noopener"><img src="/admin/topology.svg" alt="实验室网络架构总图：校园网出口、出口路由器、核心交换机、五台服务器、BMC、无线 AP 与 OpenStack 虚拟网络" style="cursor: zoom-in"></a>

点击图片可以在新标签页打开原尺寸版本。

## 图例

| 颜色 | 含义 | 展开阅读 |
|---|---|---|
| 蓝色 | 手绘图已有的设备与连线 | [网络架构](network.md)、[交换机](switch.md) |
| 橙色 | 无线 AP | [无线网络](router.md#无线网络) |
| 粉色 | BMC | [BMC 带外管理](compute.md#bmc-带外管理) |
| 紫色 | 控制节点与 GPU / Compute 虚拟机 | [OpenStack 架构](openstack.md)、[实例](openstack.md#实例) |
| 青色 | 客户端、用户有线接入与边缘交换机 | [地址与 VLAN 规划](network.md#地址与-vlan-规划) |
| 灰色 | 预留端口 | [端口分配](network.md#端口分配) |

## 按图找章节

图上每一块都能在手册里找到对应的正文。按你关心的部分继续读：

| 图上的部分 | 对应章节 |
|---|---|
| 校园网 / Internet、WAN、出口路由器 | [实验室路由器](router.md)、[NAT 和出网](network.md#nat-和出网) |
| 无线 AP、2.4G / 5G SSID | [无线网络](router.md#无线网络) |
| 核心交换机、汇聚链路、上联端口 | [交换机](switch.md)、[端口分配](network.md#端口分配)、[链路聚合](network.md#链路聚合) |
| VLAN 3701–3714 与各网段网关 | [地址与 VLAN 规划](network.md#地址与-vlan-规划)、[三层设计](network.md#三层设计) |
| host50–host54、CPU 与内存 | [物理计算资源](compute.md#五台服务器的分工)、[硬件清单](compute.md#硬件清单) |
| 控制节点、OpenStack 服务 | [OpenStack 架构](openstack.md#控制节点)、[核心服务](openstack.md#核心服务) |
| GPU 虚拟机与直通显卡 | [GPU 直通](storage.md#gpu-直通)、[GPU 使用](../user/gpu.md) |
| Cinder、LVM、iSCSI 存储 | [数据存储](storage.md#本实验室的实现)、[iSCSI](storage.md#iscsi) |
| BMC、安装网、边缘交换机 | [BMC 带外管理](compute.md#bmc-带外管理)、[管理网和带外网](network.md#管理网和带外网) |
| 浮动 IP、Provider 网络、VXLAN | [OpenStack 网络模型](network.md#openstack-网络模型)、[Flat 外部网络](network.md#flat-外部网络)、[VXLAN 覆盖网络](network.md#vxlan-覆盖网络) |

## 看图顺序

第一次看这张图，建议按“从上到下、从外到内”的顺序：

1. **出口**：最上方是校园网和出口路由器。它负责 NAT、IPv6 接入、DNS 转发和无线网络，实验室内部 VLAN 之间不经过它。
2. **核心交换**：中间是 H3C 交换机。VLAN 网关、默认路由和 ACL 都在这里，是内网的中心。
3. **服务器**：下方五台宿主机按聚合组接入。host50、host51 是 GPU 节点并各自带一套 Cinder 存储，host52–host54 是 CPU 计算节点。
4. **带外与接入**：右下是 BMC 与安装网、用户有线接入和边缘交换机。带外管理不依赖操作系统。
5. **虚拟网络**：最下层是 OpenStack 的实例网络。控制节点是 host50 上的一台虚拟机，不是独立物理机。

## 相关页面

- [网络架构](network.md)：VLAN 规划、端口分配、路由和 OpenStack 网络模型的完整说明。
- [核心交换机](switch.md) ｜ [出口路由器](router.md) ｜ [物理计算资源](compute.md) ｜ [数据存储](storage.md)
- [一键巡检](check.md)：按图核对设备在线状态和链路速率。
- [管理员视角总目录](index.md)

---

返回[网络架构](network.md) ｜ 返回[管理员视角总目录](index.md)