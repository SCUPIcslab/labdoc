# 交换机

## 角色

实验室的核心交换机是一台 H3C S5120V3-54S-EI，运行 Comware 系统。它是实验室内网的中心：所有服务器、BMC、用户终端和出口路由器都接在它上面，VLAN 之间的三层转发也由它完成。

交换机的主要职责：

- 提供 VLAN 二层转发，把不同设备划分到不同的广播域。
- 提供 VLAN 接口（SVI），作为各网段的三层网关。
- 通过链路聚合连接五台服务器，提供冗余和带宽。
- 作为用户网的 IPv4 默认网关（172.16.34.1）
- 通过 ACL 和策略路由控制特定网段的访问路径。
- 通过 LLDP 记录邻居设备，辅助排障。

实验室还有一台 TP-LINK TL-SG2024D 边缘交换机，工作在标准交换模式。它不配置 VLAN、不做路由，只把用户有线设备扩展到更多端口。边缘交换机上联到 H3C 的用户接入端口，具体端口以现场标签为准。

## 硬件和系统

| 项目 | 值 |
|---|---|
| 型号 | H3C S5120V3-54S-EI |
| 系统 | Comware 7.1.070，Release 1128 |
| 端口 | 48 个千兆电口 + 6 个万兆 SFP+ 口 |
| 管理地址 | 172.16.23.1、172.16.24.1、172.16.30.1、172.16.31.1、172.16.33.1、172.16.34.1 |
| 主机名 | S5120 |
| SNMP | 未启用 |
| NTP | 已启用，使用外部时间源 |

六个管理地址对应六个 VLAN 接口，不是六台设备。常用入口是 172.16.23.1 或 172.16.33.1；其他 SVI 地址也可以作为管理入口，前提是路由可达。

::: tip
30、31、32 三个网段已废弃，不再纳入可 SSH 互通范围：路由器上的回程路由已删除，OpenStack 的 `net3711`、`net3712` 已删除。H3C 上的 VLAN 3710 / SVI 172.16.30.1 仍保留（活的、被 Trunk 放行），VLAN 3712 早不存在。管理地址表里仍列出这些 SVI 是因为它们可能还在设备上，但不要再把它们当作可用的业务网段。
:::

## VLAN 规划

交换机上存在的 VLAN:

| VLAN | 地址段 | 网关 | 用途 |
|---|---|---|---|
| 1 | 未使用 | 无 | 默认 VLAN，SFP+ 口默认属于此 VLAN。 |
| 3701 | 10.16.0.0/16 | 无 | OpenStack 内部通信，纯二层。 |
| 3702 | 11.16.0.0/16 | 无 | 内部保留，纯二层。 |
| 3703 | 12.16.0.0/16 | 无 | 内部保留，纯二层。 |
| 3704 | 172.16.23.0/24 | 172.16.23.1 | 服务器管理网。 |
| 3705 | 172.16.24.0/24 | 172.16.24.1 | BMC 和安装网。 |
| 3706–3709 | 未分配 | 无 | 保留，Trunk 放行。 |
| 3710 | 172.16.30.0/24 | 172.16.30.1 | 已废弃（无主机在用；SVI 仍保留）。 |
| 3711 | 172.16.31.0/24 | 172.16.31.1 | 已废弃（OpenStack `net3711` 已删除）。 |
| 3712 | 172.16.32.0/24 | — | 已废弃（OpenStack `net3712` 已删除）。 |
| 3713 | 172.16.33.0/24 | 172.16.33.1 | GPU / T3713 项目网络。 |
| 3714 | 172.16.34.0/24 | 172.16.34.1 | 用户终端接入网，仅做网关；IPv4 地址由路由器 DHCP 分配。 |

VLAN 3701 至 3703 没有三层接口，只在服务器和交换机之间二层透传。VLAN 3705 同时承载 BMC 的 172.16.24.0/24 和安装网的 192.168.23.0/24，两个子网共享同一个广播域。

如果新增 VLAN，需要同时修改：交换机上的 VLAN 定义、Trunk 允许列表、宿主机 netplan 的 VLAN 子接口、OpenStack 的网络定义。只改其中一处，虚拟机或服务器会拿不到地址。

## 端口分配

| 端口 | 模式 | VLAN / 用途 |
|---|---|---|
| GE1/0/1–2 | Trunk | BAGG1，连接 host50。 |
| GE1/0/3–4 | Trunk | BAGG2，连接 host51。 |
| GE1/0/5–6 | Trunk | BAGG3，连接 host52。 |
| GE1/0/7–8 | Trunk | BAGG4，连接 host53。 |
| GE1/0/9–10 | Trunk | BAGG5，连接 host54。 |
| GE1/0/11–12 | Trunk | BAGG6，预留。 |
| GE1/0/13–16 | Access | VLAN 3704，管理网预留。 |
| GE1/0/17–24 | Access | VLAN 3705，BMC 和安装网。 |
| GE1/0/25–46 | Access | VLAN 3714，用户有线接入。 |
| GE1/0/47-48 | Trunk | 上联出口路由器，PVID 3704，允许 VLAN 3704、3714。 |
| XGE1/0/49–54 | Access | 万兆 SFP+，预留。 |

面板上的端口编号上排为奇数、下排为偶数。现场标签和实际链路可能因为换线、临时接线而变化，排障时以 `display interface brief` 和 LLDP 邻居为准，不要只看面板标签。

### 面板标注

下表按交换机面板的物理排列整理：每个 12 口为一组，上排是奇数口，下排是偶数口；SFP+ 单独一组。表中只记录面板标注，不记录当前链路状态。

| 上排端口 | 上排标注 | 下排端口 | 下排标注 |
|---|---|---|---|
| 1 | 50-Right | 2 | 50-Left |
| 3 | 51-Left | 4 | 51-Right |
| 5 | 52-Mid | 6 | 52-Left |
| 7 | 53-Left | 8 | 53-Mid |
| 9 | 54-Left | 10 | 54-Mid |
| 11 | Reserved | 12 | Reserved |
|  |  |  |  |
| 13 | Reserved | 14 | Reserved |
| 15 | Reserved | 16 | Reserved |
| 17 | 54-Right | 18 | 52-Right |
| 19 | 51-Mgmt | 20 | 53-Right |
| 21 | 53-Mgmt | 22 | 54-Mgmt |
| 23 | 52-Mgmt | 24 | 50-Mgmt |
|  |  |  |  |
| 25 | Reserved | 26 | Reserved |
| 27 | Reserved | 28 | Reserved |
| 29 | Reserved | 30 | Reserved |
| 31 | Reserved | 32 | Reserved |
| 33 | Reserved | 34 | Reserved |
| 35 | Reserved | 36 | Reserved |
|  |  |  |  |
| 37 | Client | 38 | Client |
| 39 | Client | 40 | Client |
| 41 | Client | 42 | Client |
| 43 | Client | 44 | Client |
| 45 | Client | 46 | Client |
| 47 | Router | 48 | Client |
|  |  |  |  |
| 49 | SFP+ | 50 | SFP+ |
| 51 | SFP+ | 52 | SFP+ |
| 53 | SFP+ | 54 | SFP+ |

标注中的 `50-Right`、`51-Left` 等是机柜和服务器侧的接线标签，用于现场定位；`Reserved` 表示预留，`Client` 表示用户接入，`Router` 表示上联出口路由器，`SFP+` 表示万兆光口。实际配置和链路状态以交换机命令输出为准。

服务器端口都是 Trunk，放行 VLAN 3701 至 3711、3713、3714。这样新增 VLAN 时不需要逐台服务器改交换机配置，但也意味着 Trunk 上承载的广播域较多，排障时要确认目标 VLAN 确实在允许列表中。

## 链路聚合

交换机使用 IEEE 802.3ad 动态 LACP，把每台服务器与交换机之间的两条物理链路捆成一个聚合组。

| 聚合组 | 成员端口 | 对应服务器 | 说明 |
|---|---|---|---|
| BAGG1 | GE1/0/1、GE1/0/2 | host50 | 动态 LACP，layer2 负载分担。 |
| BAGG2 | GE1/0/3、GE1/0/4 | host51 | 动态 LACP。 |
| BAGG3 | GE1/0/5、GE1/0/6 | host52 | 动态 LACP。 |
| BAGG4 | GE1/0/7、GE1/0/8 | host53 | 动态 LACP。 |
| BAGG5 | GE1/0/9、GE1/0/10 | host54 | 动态 LACP。 |
| BAGG6 | GE1/0/11、GE1/0/12 | 预留 | 无对端，保持未使用。 |

交换机侧的聚合模式是 `dynamic`，LACP 速率为 fast，负载分担类型为 `Shar`（负载分担）。服务器侧的 bond0 使用 `802.3ad` 模式，LACP rate 为 fast，hash policy 为 layer2（按源和目的 MAC 地址计算走哪条成员链路）。两侧参数必须一致，否则成员口无法进入 Selected 状态。

查看聚合状态：

```text
display link-aggregation verbose
```

重点关注：

- `Status` 是否为 `S`（Selected）。
- `Flag` 是否包含 `ACDEF`，表示 LACP 活动、超时、聚合、同步、收集和分发都正常。
- 成员口的速率是否与端口能力匹配。

如果某个成员口是 `U`（Unselected），说明它没有被聚合组选中。常见原因是两侧 LACP 参数不一致、对端没有启用 LACP、网线或光模块故障。不要只改一侧的配置，服务器和交换机要一起检查。

链路聚合不会让单条 TCP 流自动叠加带宽。一条 iSCSI 会话、一次 `scp` 传输通常只走一条成员链路。判断性能时，要看单条流的实际路径，不能只看聚合口的标称总带宽。

## 三层接口和路由

交换机为需要路由的 VLAN 配置了 SVI：

| 接口 | 地址 |
|---|---|
| Vlan-interface3704 | 172.16.23.1/24 |
| Vlan-interface3705 | 172.16.24.1/24 |
| Vlan-interface3710 | 172.16.30.1/24 | 已废弃网段，SVI 仍保留。 |
| Vlan-interface3713 | 172.16.33.1/24 | GPU / T3713。 |
| Vlan-interface3714 | 172.16.34.1/24 | 用户网网关；不再提供 DHCP。 |

Vlan-interface1 未配置地址，不作为管理接口。VLAN 3701 至 3703 没有 SVI。原先的 Vlan-interface3711（172.16.31.1）随 31 网段废弃已不再使用；VLAN 3712 的 SVI 本就不存在。30、31、32 的回程路由已从路由器删除，见[路由器文档](router.md)。

默认路由：

```text
0.0.0.0/0  →  172.16.23.254  （Vlan-interface3704）
```

所有直连网段通过 SVI 直接路由，不需要静态路由。出口路由器上配置了到各业务网段的回程静态路由，下一跳都是 172.16.23.1。这样去程和回程都经过 H3C，路径对称。

查看路由表：

```text
display ip routing-table
```

新增网段时，先在交换机上创建 VLAN 和 SVI，再在路由器上补回程路由。只配一侧会导致跨网段访问单向不通。

## DHCP 和 DNS


**交换机侧已彻底关闭 DHCP**，只保留 `Vlan-interface3714` 的 172.16.34.1 作为网关。IPv4 地址、DNS、租期现在都由出口路由器的 dnsmasq 统一下发（池 172.16.34.2–.253、网关 172.16.34.1、DNS 首选 172.16.34.254。详见[路由器文档](router.md)的 DHCP 章节。

:::: info 关闭交换机 DHCP 的完整操作

```text
system-view
undo dhcp server ip-pool vlan3714     # 删除地址池
undo dhcp enable                       # 关闭全局 DHCP 服务
reset dhcp server ip-in-use            # 清残留租约
save force
```

::: warning
两个 DHCP 服务器绝不能同时发地址。这台 Comware 上，**只撤销接口的 `dhcp server apply ip-pool` 是无效的**——只要全局 `dhcp enable` 和地址池还在，交换机会按“池网段匹配 SVI 网段”自动继续响应 DHCP。必须同时删池 + 关全局 `dhcp enable`。
:::

确认交换机确实没在发地址：

```text
display dhcp server ip-in-use              # 租约表应为空
display dhcp server statistics             # DISCOVER/OFFER/ACK 计数应不再增长
display current-configuration | include dhcp
```

确认用户终端拿到的是路由器的地址：`ipconfig /all` 里 DHCP 服务器应为 172.16.34.254，默认网关 172.16.34.1，DNS 首选 172.16.34.254。交换机上不再有用户地址池，`display dhcp server pool` 应为空（Pool number 0）。

排查用户拿不到地址时，重点看路由器侧（`dhcp.lan.ignore`、`dhcp.lan.dhcpv4`、dnsmasq 的 67 端口），而不是交换机地址池。
::::

## ACL 和策略路由

交换机上配置了一个高级 IPv4 ACL（Access Control List，访问控制列表）：

```text
ACL 3000: permit ip source 172.16.33.0/24
```

这条 ACL 匹配源地址在 172.16.33.0/24 的流量，也就是 GPU / T3713 网段。它被策略路由 `VLAN3713-OUTBOUND` 引用，绑定在 Vlan-interface3713 上。

策略路由（PBR，Policy-Based Routing）的作用是按源地址、目的地址、端口等条件选择下一跳，而不是只看目的地址查路由表。策略节点只看到匹配条件，没有看到显式的下一跳动作。修改前先确认它的设计意图：如果业务不需要按源地址分流，建议在维护窗口清理；如果需要，补全 `apply` 动作并测试。

查看 ACL 和策略路由：

```text
display acl all
display ip policy-based-route
display current-configuration | include policy-based-route
```

ACL 和策略路由会影响整个网段的流量，修改前先在测试地址上验证，不要在实验进行中直接改生产网段。

## STP、LLDP 和 NTP

**STP**：交换机全局启用了生成树协议，用于防止二层环路。正常拓扑下，聚合口和接入口应处于 Forwarding 状态。新增交换机、临时接线或把两根网线插到同一台设备时，先确认 STP 状态，避免形成环路。

**LLDP**：交换机启用了 LLDP（Link Layer Discovery Protocol，链路层发现协议），可以记录邻居的设备名、端口和 MAC 地址。排查“这根线连到哪台机器”时，LLDP 比面板标签可靠。

```text
display lldp neighbor-information list
```

**NTP**：交换机从外部时间源同步时间，源接口是 Vlan-interface3704。NTP（Network Time Protocol，网络时间协议）让日志、证书和监控时间保持一致。查看状态：

```text
display ntp-service status
```

**SNMP**：未启用。SNMP（Simple Network Management Protocol，简单网络管理协议）用于监控系统采集设备指标。如果需要，再单独规划版本、团体名和访问控制，不要直接开放公有团体名。

## 管理入口

交换机的管理入口如下，具体账号和口令由管理员通过内部渠道保管，不在公开文档中记录。

| IP 地址 | Host | 访问方式 |
|---|---|---|
| 172.16.33.1 | h3c.internal | SSH（可能仅支持 RSA）、Web |
| 172.16.23.1 | switch.internal | SSH（可能仅支持 RSA）、Web |
| 172.16.34.1 | gateway.internal | SSH（可能仅支持 RSA）、Web |

三个地址是同一台交换机的不同 VLAN 接口，不是三台设备。

SSH 登录示例（账号由管理员提供）：

```bash
ssh <管理员账号>@172.16.23.1
```

新版 OpenSSH 可能因为交换机只支持旧式 RSA 主机密钥而报错：

```text
no matching host key type found
```

可以只对本次连接临时放开：

```bash
ssh -o HostKeyAlgorithms=+ssh-rsa <管理员账号>@172.16.23.1
```

不要为了省事全局修改 SSH 客户端配置，降低所有主机的安全性。

登录后常用查看命令：

```text
display version
display clock
display interface brief
display ip interface brief
display vlan brief
display link-aggregation verbose
display ip routing-table
display lldp neighbor-information list
display logbuffer
```

修改配置前，先保存当前配置的文本备份：

```text
display current-configuration
```

把输出保存到本地文件，不要只依赖交换机的启动配置。修改后确认无误，再执行 `save` 写入启动配置。不要在不了解影响的情况下执行 `reset saved-configuration` 或删除 VLAN。

## 常见故障

| 现象 | 先检查 |
|---|---|
| 某台服务器网络不通 | 对应 BAGG 的成员口是否 Selected，服务器 bond0 是否 up，VLAN 子接口是否存在。 |
| 某个 VLAN 不通 | `display vlan brief` 是否有该 VLAN，SVI 是否 up，Trunk 是否允许该 VLAN。 |
| 用户拿不到 IP | IPv4 地址由路由器发，先查路由器 DHCP（见[路由器文档](router.md)）；交换机侧确认 VLAN 3714 的 SVI 172.16.34.1 是否 up。 |
| 部分用户拿到 172.16.34.1 作为 DHCP 服务器 | H3C 又被误开了 DHCP，检查 `display dhcp server statistics` 计数是否增长，按上文彻底关闭。 |
| 用户能拿 IP 但上不了网 | 网关是否为 172.16.34.1，DNS 是否为 172.16.34.254，默认路由是否指向 172.16.23.254。 |
| 链路聚合带宽低 | 成员口速率是否协商到 1Gbps，网线、光模块和端口是否正常。 |
| 广播风暴或环路 | `display stp brief` 是否有异常阻塞，检查是否误接了两根上联线。 |
| 交换机管理地址不通 | 对应 SVI 是否 up，Trunk 是否允许管理 VLAN，管理主机路由是否正确。 |

## 变更注意

- 修改 GE1/0/47 的 Trunk 配置时，保留 VLAN 3704 和 3714。3704 是服务器管理网，3714 是用户网。
- 修改聚合组成员口时，服务器和交换机两侧一起改，避免聚合组中断。
- 新增 VLAN 时，同步修改 Trunk 允许列表、宿主机 netplan 和 OpenStack 网络。
- 修改 ACL 或策略路由前，先确认匹配范围和下一跳，避免把整个网段的流量导错。
- 不要在实验进行中升级 Comware 或重启交换机。升级前备份配置，确认新版本与硬件匹配。
- 交换机的配置备份按内部资料保管，不要把包含管理口令的配置文件上传到公开仓库。


---

返回[管理员视角总目录](index.md) ｜ 返回[手册首页](../index.md)

