# 运行与日常维护

## 维护原则

实验室平台不是高可用架构，维护的第一原则是“先确认影响范围，再动手”。同一台 host50 上同时运行控制节点、GPU 虚拟机和 Cinder 存储；一条上联链路、一块磁盘、一个误操作，都可能同时影响多个用户。

维护时遵循以下顺序：

1. **先观察，后操作**：用只读命令确认现状，不要凭印象判断。
2. **先备份，后变更**：配置、数据库和卷都要有可恢复的副本。
3. **先小范围，后全量**：先在单台主机或单个实例上验证，再推广。
4. **先保留退路，后关闭入口**：改 SSH、网络、防火墙前，确认还有 BMC 或本地控制台可用。
5. **变更后验证**：不只看到命令返回成功，还要验证业务、网络和存储真的恢复。

## 维护周期

| 周期 | 工作 |
|---|---|
| 每日 | 看告警和日志，确认控制面、宿主机、交换机和路由器没有明显异常。 |
| 每周 | 系统更新评估、备份检查、只读健康检查、磁盘和 thin pool 容量检查。 |
| 每月 | 账号和权限检查、证书检查、日志归档、备份恢复抽查。 |
| 每季度 | 恢复演练、容量规划、固件和驱动评估、文档更新。 |
| 变更前 | 影响分析、维护窗口、备份、回滚方案、通知用户。 |
| 断电或长期停机前 | 完整备份、按顺序关机、确认存储和控制面安全。 |

周期不是固定教条。考试周、项目截止前、长时间实验运行期间，尽量减少变更；发现严重漏洞或硬件告警时，按风险优先处理。

## 机房环境与现场安全

服务器和网络设备对温度、供电和灰尘比较敏感。日常巡检除了看服务状态，也要看机房环境：

- **温度与空调**：机房空调是否正常运行，出风口是否有冷风，设备进风口是否被遮挡。温度过高会导致 CPU、GPU 降频，甚至触发保护关机。
- **供电与配电**：配电柜、PDU、插座和线缆是否正常，是否有跳闸、异味、异响或指示灯告警。实验室没有 UPS，市电中断会直接导致服务器和网络设备停机；不要私拉电线或接入大功率电器。
- **漏水与潮湿**：空调冷凝水、窗户、管道是否漏水，地面是否有积水。水进入配电或设备会直接造成短路。
- **消防与通道**：机房配置一瓶 C3HF7（七氟丙烷）灭火器，放置在服务器隔间外侧，位置应明显可见，不得被纸箱、杂物或设备遮挡。灭火器适用于电气火灾，应在有效期内；安全出口和通道必须畅通，设备周围不得堆放易燃物。
- **用电**：禁止插线板串联（一个插线板再接另一个插线板），不要在一个插线板上同时接入多个大功率设备。发现插头、插座、线缆发热、变色、焦味或跳闸，立即停用并检查。
- **灰尘与异物**：风扇、滤网、机柜缝隙是否积灰，是否有异物进入设备。清理前先断电，不要用湿布擦拭带电设备。
- **异常气味与声音**：焦糊味、塑料味、风扇异响、磁盘异响都可能是故障前兆。发现后先确认人员安全，再定位设备并安排停机检查。

所有进入机房的人员，第一次入场时由管理员指认安全出口、灭火器和电闸位置，之后也要熟记。C3HF7 是七氟丙烷灭火剂，喷射后不留残留物，适合电气火灾；但在密闭空间会排挤氧气，使用后应撤离并通风。灭火器的基本使用步骤是：拔掉保险销，握住喷管，对准火焰根部，压下压把。电气火灾应先切断电源（在确保自身安全的前提下），不要用水扑救。

现场安全的原则是“人员安全优先，设备安全其次”。发生火情、触电、漏水或设备冒烟时，先切断相关电源、疏散人员、报告管理员和学校相关部门，不要盲目用水灭火或徒手拔插设备。具体应急电话和集合点按实验室现场张贴的应急联络表执行。

安全责任按层级划分：实验室负责人对实验室安全负总责，管理员负责日常巡检、设备维护和隐患上报，用户对自己使用的账号、数据和操作负责。发现隐患不报、带故障运行或违规操作造成损失的，按实验室和学校的规定追究责任。

新成员使用服务器前，由管理员完成使用与安全说明；实验室每年至少组织一次消防或应急演练，记录参加人员和演练情况。

设备出现故障时，先挂上“故障/停用”标识，避免别人继续使用。不要带故障运行，也不要把故障设备借给他人。

## 系统更新与 CVE

### 更新前先评估

Ubuntu 的 `apt update` 只刷新软件包索引，`apt upgrade` 才会安装新版本。不要在生产时段直接执行 `apt upgrade`，先看有哪些包要升级：

```bash
sudo apt update
apt list --upgradable
```

重点关注：

- 内核、NVIDIA 驱动、CUDA、Open vSwitch、libvirt、QEMU 等与虚拟化和 GPU 相关的包。
- OpenStack 组件（nova、neutron、cinder、keystone、glance）和 Kolla 镜像。
- SSH、OpenSSL、glibc、systemd 等基础组件。
- 需要重启的服务和内核。

把升级分成三类：

1. **安全更新**：优先处理，尤其是远程可利用的漏洞。
2. **普通 bug 修复**：安排在维护窗口。
3. **大版本升级**：单独评估，不在例行维护中顺手做。

### 更新步骤

在维护窗口内，逐台执行，不要五台一起升级：

```bash
sudo apt update
sudo apt list --upgradable
sudo apt upgrade
```

如果需要处理依赖关系：

```bash
sudo apt full-upgrade
```

升级后检查是否需要重启：

```bash
test -f /var/run/reboot-required && cat /var/run/reboot-required
```

需要重启时，先确认该主机上的虚拟机和控制面服务。host50 重启会影响控制节点和 GPU 虚拟机 2，必须提前通知用户并安排窗口。

升级完成后验证：

```bash
systemctl --failed
systemctl is-active nova-compute cinder-volume neutron-linuxbridge-agent
virsh list --all
lspci -nnk | grep -A2 -i nvidia   # 仅 GPU 宿主机
```

如果升级了内核或驱动，重启后再验证 GPU 直通、网络和 Cinder。不要只看 `apt` 返回成功。

### CVE 处理

CVE（Common Vulnerabilities and Exposures）是公开披露的软件漏洞编号。每个 CVE 有编号、受影响版本、严重等级和修复版本。Ubuntu 的安全公告（USN）会把 CVE 和软件包更新对应起来。

处理流程：

1. 确认漏洞是否影响当前系统版本和组件。
2. 查看是否有官方修复包，不要从不明来源下载补丁。
3. 评估利用条件和影响范围：是否需要本地登录、是否需要网络访问、是否影响宿主机或控制面。
4. 在维护窗口内安装修复包，重启相关服务。
5. 验证服务正常，记录处理的 CVE 编号和日期。

Critical 等级的漏洞要优先处理，尤其是 SSH、OpenSSL、内核、虚拟化组件和 Web 管理界面。处理前仍然要备份和验证，不要因为“漏洞严重”就在没有回滚方案的情况下直接升级。

查看系统安全状态可以用：

```bash
ubuntu-security-status
```

如果系统没有这个命令，使用 `apt list --upgradable` 和 Ubuntu 安全公告交叉确认。不要依赖单一工具的输出。

## 备份与恢复

### 备份什么

平台需要备份的不只是虚拟机磁盘：

| 对象 | 内容 | 备份方式 |
|---|---|---|
| OpenStack 数据库 | Keystone、Nova、Neutron、Cinder、Glance 的状态数据 | MariaDB 逻辑备份或物理备份。 |
| OpenStack 配置 | `/etc/kolla`、各服务的配置、策略文件 | 文件备份，保留版本。 |
| Cinder 卷 | 虚拟机系统盘、数据盘 | Cinder 备份或存储层快照，必须做恢复演练。 |
| Glance 镜像 | 镜像文件和元数据 | 按 Glance 后端实际存储方式备份。 |
| 交换机配置 | `display current-configuration` 输出 | 文本文件，按日期归档。 |
| 路由器配置 | `/etc/config/` 下的 network、dhcp、firewall、wireless | 文件备份。 |
| 文档 | 手册、网络图、地址规划、变更记录 | 版本控制或受控目录。 |

数据库备份可以使用 `mysqldump`，具体账号信息从受控配置中读取，不要写进脚本：

```bash
mysqldump --single-transaction --routines --triggers \
  --databases keystone nova nova_api nova_cell0 neutron cinder glance placement \
  > openstack-db-$(date +%F).sql
```

执行前确认数据库名称和版本，备份后检查文件大小和末尾是否完整。逻辑备份不是热备的替代品，数据量大时要评估锁和性能影响。

### 备份策略

建议采用 3-2-1 原则：

- 至少 **3** 份数据：生产数据、主备份、副本。
- 至少 **2** 种介质或位置：例如本地磁盘和另一台服务器，或本地和离线存储。
- 至少 **1** 份离线或异地：防止勒索软件、误删和整机故障。

保留周期按数据重要性设置：

- 每日备份保留 7 至 14 天。
- 每周备份保留 4 至 8 周。
- 每月备份保留 6 至 12 个月。
- 重要节点在重大变更前做一次额外备份。

备份文件要设置权限，避免普通用户读取。包含数据库和配置的备份不能放在公开目录。

### 恢复演练

备份的价值在于恢复，不在于文件存在。每季度至少做一次恢复演练：

1. 选一个非关键卷或测试数据库。
2. 从备份恢复到一个临时位置。
3. 检查文件、权限、数据库表和业务数据。
4. 记录恢复耗时、失败步骤和需要修正的配置。
5. 把演练结果写进维护记录。

不要在生产环境直接演练恢复。恢复操作可能覆盖现有数据，必须先确认目标位置和回滚方案。

### 断电前

收到断电通知或计划停机时：

1. 通知用户，停止提交新任务，保存工作。
2. 备份数据库、配置和关键卷。
3. 按顺序关闭虚拟机、宿主机、存储和网络设备。具体顺序按现场供电和启动策略执行。
4. 确认 BMC 和交换机配置已保存。
5. 实验室没有 UPS，断电后 BMC 和网络设备也会停机；提前记录现场处置方案和恢复顺序，不要依赖远程带外。
6. 恢复供电后，先检查存储和网络，再启动控制节点，最后启动实例。

不要在没有备份的情况下直接切断 host50 的电源。控制节点和 Cinder 元数据可能损坏。

## 只读健康检查

健康检查以只读命令为主，不修改配置、不重启服务。建议按“控制面 → 宿主机 → 存储 → 网络 → GPU → 备份”的顺序。

如果希望一次生成完整报告，可以使用[一键巡检与时间节点检查](check.md)中的脚本；下面保留手工检查步骤，便于单点排查。

### 控制面

在控制节点或管理员环境执行：

```bash
openstack compute service list
openstack network agent list
openstack volume service list
openstack hypervisor list --long
openstack server list --all-projects --long
```

关注：

- `nova-compute`、`nova-scheduler`、`nova-conductor` 是否 enabled/up。
- Neutron 的 DHCP、L3、Metadata、Linux Bridge agent 是否 alive。
- Cinder 的 scheduler、volume、backup 是否 up。
- Hypervisor 是否为 up，vCPU 和内存是否与物理机一致。
- 实例状态是否 ACTIVE，是否有 error、shutoff 或 stuck 的实例。

API 状态是控制面的视角，不能代替宿主机和实例内部检查。

### 宿主机

逐台登录 host50 至 host54：

```bash
hostname
date -Is
uptime
systemctl is-active nova-compute cinder-volume neutron-linuxbridge-agent
systemctl --failed
virsh list --all
ip -br link
ip -br addr
ip route
cat /proc/net/bonding/bond0
chronyc tracking
df -h
vgs
lvs -o vg_name,lv_name,lv_size,data_percent,metadata_percent
iscsiadm -m session
```

关注：

- 关键服务是否 active。host52 至 host54 没有本地 Cinder 后端，`cinder-volume` 不运行是正常设计，只检查 `nova-compute` 和 Neutron agent。
- `virsh list` 中的实例是否与 OpenStack API 一致。
- bond0 的成员是否 up，LACP 是否正常。
- VLAN 子接口和 Linux Bridge 是否存在。
- 默认路由是否指向 172.16.23.1。
- chrony 是否 synchronized。时间偏差会导致 Cinder 心跳误判。
- 系统盘和 Cinder 数据盘是否有空间。
- thin pool 的 `Data%` 和 `Meta%` 是否接近上限。
- iSCSI 会话是否存在，目标地址是否正确。

### 交换机

登录 H3C：

```text
display clock
display version
display interface brief
display ip interface brief
display vlan brief
display link-aggregation verbose
display ip routing-table
display ntp-service status
display logbuffer
```

关注：

- 管理 VLAN 和业务 VLAN 是否存在。
- SVI 是否 up，地址是否正确。
- 聚合组成员是否 Selected，速率是否正常。
- 默认路由是否指向 172.16.23.254。
- NTP 是否同步。
- 日志中是否有端口频繁 up/down、环路、ACL 拒绝或电源告警。

### 路由器

登录 172.16.34.254：

```bash
ip -br addr
ip route
ip -6 route
logread | tail -100
```

关注：

- WAN 是否获取到地址，默认路由是否存在。
- 到 172.16.24/30/31/32/33 的静态回程路由是否存在。
- LAN 和 VLAN 3714 接口是否 up。
- DNS 和 DHCPv6 是否正常。
- 日志中是否有链路抖动、认证失败或磁盘错误。

### GPU

登录两台 GPU 虚拟机：

```bash
nvidia-smi
nvidia-smi -L
nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu --format=csv
```

关注：

- 是否能看到两张 RTX 4090。
- 是否有进程异常占用显存。
- 温度、功耗和降频状态是否正常。
- 驱动是否报错，`dmesg` 是否有 Xid、PCIe 或 VFIO 错误。

不要在健康检查时运行 GPU 压力测试，除非在维护窗口内并得到用户同意。

### 备份

```bash
openstack volume backup list --all-projects
openstack volume service list
```

关注：

- 最近一次备份是否成功。
- 备份大小和卷大小是否匹配。
- 备份服务是否正常。
- 是否有恢复演练记录。

服务显示 up 不等于备份可用。定期抽查恢复，才能真正确认。

## 时间同步

时间同步对 OpenStack 很重要。Nova、Neutron、Cinder 通过心跳判断服务是否在线，心跳时间来自各主机时钟。如果某台主机时间偏差过大，控制面可能把正常的服务标记为 down，或者把过期的心跳当成新心跳。

检查：

```bash
chronyc tracking
chronyc sources -v
```

关注 `Leap status` 是否为 `Normal`，`System time` 偏差是否在可接受范围。如果显示 `Not synchronised`：

1. 确认 `chronyd` 服务在运行。
2. 确认 UDP 123 没有被防火墙阻断。
3. 确认配置的 NTP 服务器可达。
4. 检查主机是否长时间休眠或时钟漂移。
5. 修复后等待同步，再重启相关 OpenStack 服务。

不要用 `date -s` 手动改时间。手动改时间会造成时间跳变，可能让证书、日志和心跳出现更严重的问题。使用 chrony 逐步校正。

## 日志与告警

常见日志位置：

| 组件 | 位置 |
|---|---|
| 系统日志 | `journalctl`、`/var/log/syslog` |
| Nova | `/var/log/nova/` |
| Neutron | `/var/log/neutron/` |
| Cinder | `/var/log/cinder/` |
| Glance | `/var/log/glance/` |
| Keystone | `/var/log/keystone/` |
| Kolla 容器 | `docker logs <container>` |
| 交换机 | `display logbuffer` |
| 路由器 | `logread` |

排查时先看时间范围，再看错误级别。不要只看最后一行，很多错误在前面几行有上下文。日志中如果出现 `ERROR`、`Traceback`、`Timeout`、`Connection refused`、`No space left`，要记录完整堆栈和时间。

日志会占用磁盘空间。配置 logrotate 或定期归档，避免日志把系统盘写满。清理日志前确认不是正在排查的证据，不要直接删除整个日志目录。

## 安全检查

每月至少做一次安全检查：

- **账号**：谁有宿主机 root、OpenStack admin、交换机 admin、BMC 账号。是否有离职人员未清理。
- **SSH**：是否允许 root 密码登录，是否有不必要的公钥，是否有弱口令。
- **防火墙**：主机防火墙是否启用，开放了哪些端口，是否有不必要的服务监听在 0.0.0.0。
- **BMC**：是否只在管理网可达，是否使用强口令，是否暴露到校园网。
- **Web 管理**：Horizon 是否只在实验室内网访问，是否需要 TLS。
- **访问控制**：用户文档中是否混入管理员账号或口令，内部交接记录是否完整。
- **证书**：HTTPS 证书是否过期，SSH 主机密钥是否更换。
- **网络**：交换机上是否有未知设备、未知 MAC、异常广播，未使用端口是否关闭。
- **日志**：是否有异常登录、扫描、提权、批量删除。

安全检查的目的是发现风险，不是立刻大规模改配置。发现高危项先记录、评估影响、安排窗口，避免在检查过程中把系统改坏。

## 变更管理

任何会影响用户或业务的变更，都按下面的流程：

1. **提出变更**：说明改什么、为什么改、影响哪些主机和实例。
2. **影响分析**：列出受影响的网络、存储、控制面和用户，确认最坏情况。
3. **准备回滚**：备份配置和数据，写清楚回滚命令和验证方法。
4. **安排窗口**：避开实验高峰，提前通知用户。
5. **执行变更**：一次只改一个变量，改完立即验证。
6. **验证业务**：不只 ping，还要登录实例、读写卷、检查 GPU。
7. **记录**：更新手册、网络图和变更记录。

高风险变更包括：

- 改 GE1/0/47 上联、默认路由、VLAN 或 LACP。
- 改 host50 的网络、存储或关机。
- 改 Cinder 后端、thin pool、iSCSI 配置。
- 改 Keystone、数据库、RabbitMQ 或 Kolla 配置。
- 升级内核、驱动、OpenStack 组件。
- 批量删除卷、快照或实例。

这些变更至少要有两人确认，一人操作，一人观察。操作前确认 BMC 或本地控制台可用，避免远程入口全部失效。

## 常见故障处置

### 控制节点无法访问

已经运行的虚拟机会继续运行，但创建、删除、挂载、迁移和 Horizon 操作会中断。

处理顺序：

1. 从 host50 用 `virsh list` 确认控制节点虚拟机是否 running。
2. 通过 BMC 或 host50 控制台查看控制节点屏幕和日志。
3. 检查 host50 的存储、内存和网络。
4. 如果是控制节点系统故障，尝试从快照或备份恢复，不要直接重建一台新控制节点覆盖数据库。
5. 恢复后验证 Keystone、Nova、Neutron、Cinder 和 Horizon。

### 宿主机故障

1. 确认故障主机上的实例和卷。
2. 通过 BMC 查看硬件告警、电源和磁盘状态。
3. 不要急着重装系统或重建 RAID，先保留现场。
4. 如果只是网络或服务故障，尝试恢复服务；如果是硬件故障，按备份和迁移方案处理。
5. 恢复后核对 `virsh list`、Cinder 卷和 OpenStack 服务。

### Cinder 后端故障

1. 停止对该后端的写操作，通知用户。
2. 检查 iSCSI 会话、LVM、thin pool 和磁盘健康。
3. 不要直接删除卷或重建卷组，先确认数据可恢复。
4. 从备份恢复或迁移卷到另一后端。
5. 恢复后做读写测试，再恢复服务。

### 网络中断

1. 确认是单台主机、单个 VLAN 还是整个实验室。
2. 检查交换机端口、聚合组、VLAN 和默认路由。
3. 检查路由器的 WAN、NAT 和回程路由。
4. 如果是环路，先断开可疑链路，再检查 STP。
5. 变更网络后，用多台主机和实例验证，不要只看一台机器。

### GPU 异常

1. 在虚拟机内执行 `nvidia-smi`，确认是否还能看到两张卡。
2. 查看 `dmesg` 是否有 Xid、PCIe、VFIO 错误。
3. 在宿主机确认 GPU 是否绑定到 `vfio-pci`，虚拟机 XML 是否有四个 hostdev。
4. 不要自行重装驱动或重启宿主机，先记录错误并通知管理员。
5. 如果确认是硬件故障，按停机检修流程处理。

## 维护记录

每次维护至少记录：

- 日期、时间、操作人。
- 变更内容和原因。
- 影响的主机、实例、网络和用户。
- 备份位置和回滚方法。
- 验证结果和遗留问题。

维护记录不需要写成长篇报告，但要能让下一个人看懂“改了什么、为什么改、怎么回滚”。手册更新和维护记录分开保存，手册写长期有效的配置和方法，记录写本次变更的细节。


---

返回[管理员视角总目录](index.md) ｜ 返回[手册首页](../index.md)
