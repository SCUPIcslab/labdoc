# 数据存储

## 存储的两条路径

实验室的存储有两条完全不同的路径，不要把两者混在一起：

1. **GPU 直通路径**：两张 RTX 4090 通过 PCI 直通完整交给虚拟机，显存和显卡计算不经过 Cinder，也不经过网络。
2. **Cinder 块存储路径**：虚拟机的系统盘和数据盘是 Cinder 卷，卷存放在 host50 或 host51 的本地磁盘上，通过 iSCSI 挂载给虚拟机。

GPU 任务的数据流通常是：数据集从 Cinder 卷读入内存，再拷贝到显存；训练过程中的检查点写回 Cinder 卷。显存不够是 GPU 问题，磁盘不够是 Cinder 问题，两者要分开排查。

## GPU 直通

每台 GPU 虚拟机绑定四个 VFIO PCI 功能：

- 两张 RTX 4090 的 VGA 功能。
- 两张 RTX 4090 对应的音频功能。

音频功能是显卡 HDMI/DisplayPort 输出的一部分。把 VGA 和音频一起直通，虚拟机才能完整识别显卡设备，避免设备树里出现缺失功能。

这是完整的 PCI Passthrough，不是软件 vGPU，也不是时间片共享。虚拟机看到的是物理显卡本身，宿主机不再把它当普通显卡使用。宿主机通过 VFIO（Linux 的 PCI 设备直通框架）和 IOMMU（设备直接访问内存时的地址转换与隔离机制）把设备交给虚拟机。因此：

- 宿主机上的 `nvidia-smi` 看不到已经绑定到 VFIO 的显卡，这是正常现象。
- 一台虚拟机占用显卡时，其他虚拟机不能同时使用同一张卡。
- 显存不能超分。每张卡 24 GiB 显存由当前虚拟机独占。
- 虚拟机迁移受 GPU 直通限制。带 GPU 的实例不能像普通实例那样随意热迁移。

GPU 直通的配置依赖 BIOS 中的 IOMMU、VT-d、Above 4G Decoding 等选项，以及宿主机内核的 VFIO 绑定。更换主板、升级 BIOS 或更换显卡后，要重新确认这些设置。

## Cinder 是什么

Cinder 是 OpenStack 的块存储服务。它管理的是**块设备**，不是共享文件系统。用户创建一块卷后，Cinder 把卷挂载给虚拟机，虚拟机看到的是 `/dev/vdb` 这样的磁盘，需要自己分区、格式化和挂载。

Cinder 的几个核心概念：

| 概念 | 含义 |
|---|---|
| 卷（Volume） | 一块虚拟磁盘，可以挂载给实例，也可以从实例上卸载。 |
| 卷类型（Volume Type） | 创建卷时选择的类型，用来指定后端和特性。平台使用 `IPSAN`。 |
| 快照（Snapshot） | 某个时间点卷状态的副本，通常保存在同一个后端，创建快得快，但不是独立备份。 |
| 备份（Backup） | 把卷的数据复制到另一个位置，用于灾难恢复。备份和快照不是一回事。 |
| 后端（Backend） | 实际存放卷的存储系统。平台有 host50 和 host51 两个后端。 |

卷可以“从镜像启动”（boot from volume），也可以作为数据盘挂载。平台的 GPU 实例都是 boot from volume，系统盘是一块 Cinder 卷。

## 本实验室的实现

平台有两套 Cinder 后端，分别位于 host50 和 host51：

| 后端 | 位置 | 卷组 | thin pool | iSCSI 入口 |
|---|---|---|---|---|
| `host50@ipsan` | host50 | `cinder-volumes`，约 3.64 TiB | 约 3.46 TiB | 10.16.23.50:3260 |
| `host51@ipsan` | host51 | `cinder-volumes`，约 3.64 TiB | 约 3.46 TiB | 10.16.23.51:3260 |

两台主机各有一块约 3.7 TB 的机械硬盘，通过 RAID 卡呈现给操作系统。Cinder 在磁盘上建立 LVM 卷组 `cinder-volumes`，再建立 thin pool，从 thin pool 中划分逻辑卷给虚拟机。

Cinder 的配置要点：

```ini
enabled_backends = ipsan

[ipsan]
volume_backend_name = ipsan
volume_driver = cinder.volume.drivers.lvm.LVMVolumeDriver
volume_group = cinder-volumes
target_helper = tgtadm
target_ip_address = 10.16.23.50
```

host51 的配置相同，只是 `target_ip_address` 改为 10.16.23.51。卷类型 `IPSAN` 的属性是 `volume_backend_name=ipsan`，因此创建卷时会选择这两个后端之一。

`IPSAN` 只是逻辑名称，不代表机房里有一台独立的高可用 SAN 阵列。实际实现是两台计算节点各自用本地磁盘做 LVM，再通过 iSCSI 导出。卷的可用性取决于它所在的那台宿主机。

## LVM 和 Thin Pool

LVM（Logical Volume Manager，逻辑卷管理器）在物理磁盘和文件系统之间加了一层抽象：

- **PV（Physical Volume）**：物理卷，通常是磁盘或分区。
- **VG（Volume Group）**：卷组，把多个 PV 合并成一个存储池。
- **LV（Logical Volume）**：逻辑卷，从 VG 中划分出来的虚拟磁盘。
- **Thin Pool**：精简池，一种特殊的 LV，按需分配空间，支持 thin provisioning。

Thin provisioning（精简置备）的意思是：创建卷时只记录逻辑大小，不立即占用同等物理空间。例如创建一个 1 TiB 的卷，实际可能只占用几 GiB，随着数据写入才逐渐分配。这提高了空间利用率，但也带来超分风险：如果所有卷同时写满，thin pool 会被耗尽，导致卷 I/O 错误，甚至无法删除或修复。

监控 thin pool 要看两个指标：

```bash
vgs
lvs -o vg_name,lv_name,lv_size,data_percent,metadata_percent
```

- `Data%` 是 thin pool 数据区的使用率，不是文件系统 `df` 的使用率。
- `Meta%` 是 thin pool 元数据的使用率。元数据记录逻辑卷的块映射，元数据满时池会进入只读或故障状态。
- `VFree` 是卷组中尚未分配给 LV 的空间，不等于 thin pool 的剩余空间。

不要只看虚拟机的 `df -h`。虚拟机内看到的是文件系统使用率，Cinder 看到的是 thin pool 分配率。两者可能差很多：文件系统里删了文件，thin pool 不一定立即回收；文件系统里还有很多空间，thin pool 可能已经接近上限。

## iSCSI

iSCSI 是把 SCSI 磁盘命令封装到 TCP/IP 中传输的协议。Cinder 的 LVM 后端把逻辑卷导出为 iSCSI LUN，计算节点作为 initiator 连接 target，把 LUN 识别为本地磁盘。

平台使用 `tgtadm` 作为 target helper。每台 Cinder 主机在 10.16.23.x 的 3260 端口监听 iSCSI，计算节点通过这个地址连接。

查看当前 iSCSI 会话：

```bash
iscsiadm -m session
```

查看 Cinder 卷和挂载关系：

```bash
openstack volume list --all-projects --long
openstack volume show <volume-id>
```

卷的 `Attached to` 字段会显示它挂载到哪台实例、哪台宿主机、哪个设备名。删除卷前先确认它没有挂载到任何实例。`in-use` 状态的卷不能直接删除。

iSCSI 的性能受网络和磁盘限制。host50 和 host51 的网卡是 10GbE，交换机端口是 1GbE，正常情况下链路应协商到 1Gbps；如果低于端口能力，先检查网线、模块和端口协商。LACP 聚合不会让单条 iSCSI 会话自动叠加带宽，单条会话仍然受一条成员链路限制。机械硬盘的随机 IO 也是瓶颈，不要把 Cinder 当成高性能数据库存储。

## 卷的生命周期

创建卷：

```bash
openstack volume create --size 100 --type IPSAN mydata
```

挂载到实例：

```bash
openstack server add volume <instance> <volume>
```

卸载：

```bash
openstack server remove volume <instance> <volume>
```

删除：

```bash
openstack volume delete <volume>
```

删除卷是不可逆操作。删除前确认：

- 卷没有挂载到任何实例。
- 卷里的数据已经备份或不再需要。
- 卷不是某个实例的系统盘。
- 卷没有依赖的快照或备份链。

如果卷状态是 `error`，不要直接删除。先查看 `openstack volume show` 的 `status` 和 `os-vol-host-attr:host`，确认它属于哪个后端，再检查该后端的 `cinder-volume` 日志和 LVM 状态。错误卷可能仍占用 thin pool 空间，直接删除可能留下孤立 LV。

## 快照和备份

### 快照

Cinder 快照保存某个时间点卷的状态。创建快照：

```bash
openstack volume snapshot create --volume <volume> mysnap
```

快照通常保存在同一个 Cinder 后端，创建速度快，占用空间小。但快照不是独立备份：如果后端磁盘损坏，快照和卷可能一起丢失。快照适合在升级、改配置、批量操作前做短期回滚点，不适合作为长期归档。

### 备份

Cinder 备份把卷的数据复制到另一个位置，用于灾难恢复。备份服务在控制节点上运行，具体备份目标由 `cinder.conf` 的备份驱动决定。

创建备份：

```bash
openstack volume backup create --volume <volume> mybackup
```

恢复备份：

```bash
openstack volume backup restore <backup> <volume>
```

备份的关键不是“服务显示 up”，而是“能不能恢复”。建议定期做恢复演练：

1. 选一个非关键卷，创建备份。
2. 把备份恢复到一个新卷。
3. 挂载新卷，检查文件和数据是否完整。
4. 记录恢复耗时和问题。

只创建备份、从不恢复，无法发现备份驱动配置错误、目标空间不足、权限错误或备份链断裂。备份服务显示正常，不代表备份文件可用。

## 容量管理

扩容 Cinder 后端的一般步骤：

1. 确认新磁盘已经被 RAID 卡识别，操作系统能看到块设备。
2. 在维护窗口内停止该后端的卷操作，确认没有正在进行的创建、删除、挂载。
3. 创建 PV，扩展 VG，扩展 thin pool。
4. 确认 `vgs`、`lvs` 的容量和 `Data%`、`Meta%` 正常。
5. 恢复 Cinder 服务，创建测试卷验证。

LVM 扩容涉及写操作，必须在维护窗口内执行，并先备份卷数据。不要在没有确认设备名的情况下执行 `pvcreate` 或 `vgextend`，错误的设备名可能破坏其他磁盘。

容量告警的优先级：

- `Data%` 超过 80%：开始清理过期卷和快照，规划扩容。
- `Meta%` 超过 70%：尽快处理，元数据满会导致池不可写。
- `VFree` 接近 0：无法再创建新 LV，需要扩容或删除卷。
- 虚拟机内 `df` 超过 90%：清理文件或迁移数据，避免系统盘写满。

这些阈值是运维经验值，不是硬性规定。具体阈值根据业务增长速度和扩容周期调整。

## 维护注意

- host50 同时承载控制节点、GPU 虚拟机 2 和一套 Cinder 后端。host50 的磁盘或 iSCSI 故障会影响控制面和两台 GPU 虚拟机中的至少一台。
- 不要在没有确认卷位置的情况下重启 Cinder 服务。重启会短暂中断卷操作，正在写入的实例可能报 I/O 错误。
- 删除卷、快照、备份前，先确认没有被实例或备份链引用。
- 修改 `cinder.conf` 后，按 Kolla 的方式重启对应容器，不要直接改容器内的临时文件。
- 机械硬盘的随机 IO 有限，避免在 Cinder 上运行高并发数据库。需要高 IOPS 时，考虑把数据放在实例内存或独立的 SSD 存储。
- 备份目标、备份驱动和恢复流程要单独记录，不要只依赖 Cinder 服务列表的状态。


---

返回[管理员视角总目录](index.md) ｜ 返回[手册首页](../index.md)
