# 实验室路由器

## 角色

实验室的出口路由器是一台 Netcore N60 Pro，运行 ImmortalWrt 系统。它位于校园网和实验室内部网络之间，负责四件事：

1. 从校园网获取 IPv4 地址和 IPv6 前缀，提供默认出网路径。
2. 对实验室内部地址做 NAT（IPv4）和 NAT66（IPv6），让私有地址和 ULA 可以访问校园网和互联网。
3. 作为用户终端的 DNS 服务器，转发内部和外部域名查询。
4. 提供无线网络，作为用户网的 DHCP 服务器分配 IPv4 地址，并作为 IPv6 的 RA/DHCPv6 服务器下发 ULA。

它**不是**实验室内部 VLAN 之间的主路由器。内部 VLAN 的三层网关在 H3C 交换机上，跨 VLAN 访问由 H3C 直接转发，不经过这台路由器。只有访问校园网或互联网时，流量才会经过它。

## 硬件和系统

| 项目 | 值 |
|---|---|
| 型号 | Netcore N60 Pro |
| 系统 | ImmortalWrt 21.02-SNAPSHOT |
| 内核 | Linux 5.4 |
| 平台 | MediaTek MT7986，ARMv8 Cortex-A53 |
| 管理地址 | 172.16.34.254、172.16.23.254 |
| SSH 入口 | `root@172.16.34.254` |
| 网页入口 | `http://172.16.34.254` |

ImmortalWrt 是 OpenWrt 的一个分支，使用 UCI（Unified Configuration Interface）管理配置。大部分配置保存在 `/etc/config/` 下，例如 `network`、`dhcp`、`firewall`、`wireless`、`system`。修改配置前先备份这些文件。

两个管理地址属于同一台设备，但用途不同：

- `172.16.23.254` 是路由器在服务器管理网侧的接口，只承载路由，不提供 SSH。
- `172.16.34.254` 是路由器在用户网侧的接口，SSH、DNS 和网页管理使用这个地址。

不要因为两个地址出现在同一台设备上就以为是两台设备。它们是同一台路由器的不同接口。

## 接口和地址

| 接口 | 地址 | 作用 |
|---|---|---|
| eth1 | WAN，DHCP/DHCPv6 | 连接校园网，获取 IPv4 地址和 IPv6 前缀，后者供 NAT66 使用。 |
| lan4 | 172.16.23.254/24 | 连接 H3C 的 GE1/0/47，服务器管理网侧接口。 |
| br-lan | 172.16.34.254/24、`fd45:d5fc:44f6::1/64` | 用户网桥，包含无线接口和 VLAN 3714 子接口。 |
| lan1、lan2、lan3 | 无独立地址 | 路由器上的物理 LAN 口，均已加入 br-lan，直连设备属于用户网。 |
| lan4.3714 | 无独立地址 | 802.1Q 子接口，桥接到 br-lan，承载 VLAN 3714。 |
| ra0 | 无独立地址 | 2.4 GHz 无线接口。 |
| rax0 | 无独立地址 | 5 GHz 无线接口。 |

路由器通过 GE1/0/47 与 H3C 相连。这个端口在交换机侧是 Trunk，PVID 为 3704，允许 VLAN 3704 和 3714。路由器侧把 `lan4` 作为不带标签的管理网接口，把 `lan4.3714` 桥接到 `br-lan`，所以：

- 管理网 172.16.23.0/24 的流量不带标签，进入 VLAN 3704。
- 用户网 172.16.34.0/24 的流量带 VLAN 3714 标签，进入 `br-lan`。

用户终端的默认网关仍是 H3C 的 172.16.34.1，不是路由器的 172.16.34.254。路由器在用户网中的角色是 DHCP 服务器（分配 IPv4 地址）、DNS 服务器和 IPv6 网关；H3C 只保留 172.16.34.1 做网关。排查用户上不了网时，看默认网关是不是 172.16.34.1、DHCP 服务器是不是 172.16.34.254。

直插路由器 LAN1/LAN2/LAN3 的设备，和插在交换机 VLAN 3714 接入口（GE1/0/25–46）的设备，进的是同一个 br-lan 二层域，同网段、同 DHCP 池、同网关，彼此能互相发现和通信。LAN4 已被 `h3clan` 用作管理网接口，不在用户网内。

## 路由

路由器的路由表包含三类条目：

**默认路由**：通过 WAN 口指向校园网上级网关，负责所有出网流量。

**直连路由**：172.16.23.0/24、172.16.34.0/24 等接口所在网段。

**静态回程路由**：把实验室各业务网段的流量指回 H3C：

```text
172.16.24.0/24  →  172.16.23.1
172.16.33.0/24  →  172.16.23.1
```

这些静态路由保证从校园网返回实验室的流量走 H3C，而不是被路由器直接丢弃。新增一个实验室网段时，除了在 H3C 上配置网关，还要在路由器上补一条回程路由。

### IPv6

IPv6 的默认路由通过 WAN 口的链路本地网关指向校园网。WAN 口通过 DHCPv6 获取校园网分配的 IPv6 前缀，LAN 侧不使用这个前缀，终端使用 ULA 地址。

LAN 侧使用固定的 ULA 前缀 `fd45:d5fc:44f6::/64`：

- 路由器在 `br-lan` 上的地址是 `fd45:d5fc:44f6::1/64`。
- RA 向终端通告该 ULA 前缀，默认网关是路由器的链路本地地址。
- DHCPv6 向终端分配 ULA 地址，RDNSS 为 `fd45:d5fc:44f6::1`。
- 终端访问校园网或互联网时，源地址在 WAN 侧由 NAT66 masquerade 转换为 WAN 口的 IPv6 地址。

终端从路由器获得的是 ULA 地址，校园网全局地址只出现在 WAN 侧以及 NAT66 转换后的报文中。IPv6 出网和 IPv4 一样经过地址转换，校园网侧无法直接路由到实验室终端。

NAT66 是有状态的地址转换，校园网侧不能主动发起连接到实验室终端。需要从外部访问内部 IPv6 服务时，通过端口映射或 VPN 单独配置。

## NAT 和防火墙

路由器使用 Linux 防火墙和 NAT。设计如下：

- `lan` 区域包含 `lan` 和 `h3clan` 两个接口，入站、出站和转发默认放行。
- `wan` 区域入站默认拒绝，出站允许，转发默认拒绝。
- `wan` 区域启用 masquerade（IPv4 地址伪装），把内部私有地址转换成 WAN 地址。
- `wan` 区域同时启用 NAT66 masquerade，把 LAN 侧的 ULA 源地址转换成 WAN 口获取的校园网 IPv6 地址。
- 启用 MTU fix，避免 PPPoE 或隧道场景下的分片问题。
- 允许从 `lan` 转发到 `wan`，不允许从 `wan` 主动进入 `lan`。

IPv4 和 IPv6 都做地址伪装，但 NAT66 只改写地址，不替代防火墙。`wan` 区域入站保持默认拒绝，NAT66 的回程流量由连接跟踪状态放行。

这台路由器的防火墙主要防外网入站，不承担实验室内部 VLAN 之间的访问控制。内部 VLAN 之间的访问由 H3C 的 ACL、OpenStack 安全组和主机防火墙负责。不要把“内网能通”当成“内网安全”。

如果需要在外部访问实验室内部的某个服务，优先使用 OpenStack 浮动 IP 或 VPN，不要在路由器上随意加端口转发。端口转发会把内部服务直接暴露到校园网，增加被扫描和攻击的风险。

## DHCP 和 DNS

### DHCP

路由器的 DHCPv4 在 LAN 侧是开启的，由 dnsmasq 向用户终端分配 172.16.34.0/24 地址。H3C 侧的地址池和全局 DHCP 服务已彻底关闭，只保留 `Vlan-interface3714` 的 172.16.34.1 作为网关。IPv6 的 DHCPv6 和 RA 由路由器负责，向终端下发 ULA 地址、IPv6 默认网关和 RDNSS。


这种分工的理由：网关（数据面，每包都要过）留在 H3C 交换芯片转发，跨网段不绕路、不给路由器 CPU 增加负担；DHCP 和 DNS 是控制面，流量极小，集中在路由器便于维护（静态租约、别名一处配）。有线和无线互相发现是二层广播，与网关位置无关，不受此分工影响。


::: warning
两个 DHCP 服务器绝不能同时发地址，否则终端会拿到错误的网关或 DNS，表现为“有时能上网、有时不能”。这台 H3C（Comware）上关闭 DHCP 必须同时做两步：`undo dhcp server ip-pool vlan3714`（删池）**和** `undo dhcp enable`（关全局服务）。只撤接口的 `dhcp server apply ip-pool` 无效，只要全局 `dhcp enable` 和地址池还在，H3C 会按“池网段匹配 SVI 网段”自动继续发地址。
:::

### DNS

路由器上的 dnsmasq 提供 DNS 转发和内部域名解析：

- 内部域名后缀是 `internal`。
- 常用设备有别名，例如 `router.internal`、`h3c.internal`、`openstack.internal`、`host50.internal`。
- 静态别名来自 `/etc/cslab-alias.hosts`，新增设备时可以在这里补记录。
- 上游 DNS 包括 223.5.5.5、223.6.6.6、61.139.2.69、202.115.39.9、202.115.39.6。

用户终端通过 DHCP 获取的首选 DNS 是 172.16.34.254。服务器在 netplan 中直接配置 61.139.2.69，不经过路由器的 dnsmasq。这是两类不同的客户端，排障时要分别检查。

修改 `/etc/cslab-alias.hosts` 后，重启 dnsmasq 或执行 `/etc/init.d/dnsmasq reload` 让配置生效。不要直接编辑 `/tmp/resolv.conf.d/resolv.conf.auto`，那是运行时生成的文件。

## 无线网络

路由器提供两个 SSID：

| SSID | 频段 | 加密 | 用途 |
|---|---|---|---|
| `ImmortalWrt-2.4G` | 2.4 GHz | WPA2-PSK | 覆盖范围广，适合手机、笔记本和低速设备。 |
| `ImmortalWrt-5G` | 5 GHz | WPA2-PSK | 速率高，适合近距离使用。 |

无线接口桥接到 `br-lan`，和有线用户网处于同一个二层网络，地址由路由器的 DHCP 分配。无线客户端、有线客户端、直插路由器 LAN 口的设备都在同一个广播域中，彼此能互相发现、直接通信；访问管理网等其他网段要经过 H3C 路由。

::: tip
实验室的路由器位于实验室一隅，服务器附近。基于2.4G和5G的无线覆盖范围，建议在实验室内使用有线网络或靠近路由器的地方使用5G无线网络，而距离路由器较远的地方使用2.4G无线网络。
:::

### 5G 大响应下载卡顿

**遇到的情况**

- 部分手机连接 `ImmortalWrt-5G` 后，访问 B 站等返回较大响应体的 IPv4 接口时频繁卡住或超时。
- 同一请求改用 `ImmortalWrt-2.4G`、有线网络或 IPv6 时正常；普通小请求也正常。
- 关闭 HNAT 硬件加速后，5G 手机复测恢复正常，2.4G 和有线不受影响。

**解决方法**

临时关闭 HNAT 硬件加速，立即生效，重启路由器后失效：

```bash
echo 0 > /sys/kernel/debug/hnat/hook_toggle
cat /sys/kernel/debug/hnat/hook_toggle
```

第二条命令应显示 `disabled`。

需要持久关闭时，在维护窗口内执行：

```bash
uci set turboacc.config.fastpath='none'
uci commit turboacc
/etc/init.d/turboacc restart
```

`turboacc restart` 会重启防火墙，所有用户会短暂断网，执行前要通知用户并准备回退。

恢复硬件加速：

```bash
echo 1 > /sys/kernel/debug/hnat/hook_toggle
```

持久恢复：

```bash
uci set turboacc.config.fastpath='mediatek_hnat'
uci commit turboacc
/etc/init.d/turboacc restart
```

::: warning
WPA3 sae-mixed + PMF 的 PMKID 驱动存在问题，导致部分手机连接 5G 后访问大响应体的 IPv4 接口时频繁卡住或超时。目前仍然使用 WPA2-PSK。
:::

## 管理入口

SSH 登录：

```bash
ssh root@172.16.34.254
```

网页管理使用：

```text
http://172.16.34.254
```

登录后可以查看接口、路由、DHCP 租约和防火墙状态：

```bash
ip -br addr
ip route
ip -6 route
uci show network
uci show dhcp
uci show firewall
logread | tail -50
```

修改配置前先备份：

```bash
cp /etc/config/network /etc/config/network.bak
cp /etc/config/dhcp /etc/config/dhcp.bak
cp /etc/config/firewall /etc/config/firewall.bak
```

修改后先检查语法，再重启对应服务：

```bash
uci commit network
/etc/init.d/network reload
```

不要直接重启整台路由器来“让配置生效”。重启会中断所有用户的网络，而且如果配置有误，可能连管理入口都进不去。如果确需重启，需要向所有用户提前通知，并在维护窗口内操作， 保留好备份文件，以便恢复。

## 常见故障

| 现象 | 先检查 |
|---|---|
| 所有用户无法上网 | WAN 口是否获取到地址、默认路由是否存在、上游网关是否可达。 |
| 部分用户无法上网 | 终端是否拿到 172.16.34.x 地址、默认网关是否为 172.16.34.1、DNS 是否为 172.16.34.254、DHCP 服务器是否为 172.16.34.254（不是 H3C 的 .1）。 |
| 全用户拿不到 IPv4 地址 | 路由器 `dhcp.lan.ignore` 是否被误设、`dhcp.lan.dhcpv4` 是否为 `server`、dnsmasq 是否监听 67 端口、H3C 是否又误开了 DHCP（`display dhcp server statistics` 计数是否还在涨）。 |
| 能 ping 通 IP，不能解析域名 | dnsmasq 是否运行、上游 DNS 是否可达、`/etc/resolv.conf` 是否被改。 |
| 无线连不上 | SSID 是否广播、密码是否正确、无线接口是否 up。 |
| 5G 下载大响应或 API 卡住，2.4G 和有线正常 | 按“无线网络 → 5G 大响应下载卡顿”临时关闭 HNAT 后复测。 |
| 管理网访问不了路由器 | 检查 GE1/0/47 的 Trunk 是否允许 VLAN 3704，路由器 `lan4` 是否有 172.16.23.254。 |
| IPv6 不通 | WAN 是否获取到 IPv6 前缀和默认路由、RA/DHCPv6 是否开启、终端是否拿到 `fd45:d5fc:44f6::/64` 的 ULA 地址、NAT66 masquerade 是否生效。 |

## 变更注意

- 修改 GE1/0/47 相关配置时，保留 VLAN 3704 和 3714。去掉 3704 会失去管理网，去掉 3714 会影响用户网（交换机 client 口那一路）。
- 不要在 H3C 上重启用户网 DHCP：IPv4 地址现在只由路由器发，H3C 的池和全局 DHCP 都已关闭。要让 H3C 重新发地址需重建池 + `dhcp enable` + 接口 apply，且必须先停路由器的 DHCPv4，避免双服务器冲突。
- 调整 DHCP 地址池范围时，注意 172.16.34.1（网关，H3C）和 172.16.34.254（路由器/首选 DNS）不能被分配出去。
- 修改 WAN 口配置会导致所有出网流量中断，安排在维护窗口内。
- 修改 DHCPv6、RA 或 NAT66 会影响所有 IPv6 客户端，先确认没有依赖 IPv6 的服务。
- 不要在路由器上安装来源不明的插件。路由器是出口设备，插件可能带来后门或稳定性问题。
- 路由器的配置备份按内部资料保管，不要上传到公开仓库。


---

返回[管理员视角总目录](index.md) ｜ 返回[手册首页](../index.md)

