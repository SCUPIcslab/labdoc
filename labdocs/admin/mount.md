# 磁盘的挂载

本页说明在 Linux 服务器上新增数据盘的完整流程：判断现有布局、格式化、挂载、设置多用户权限，以及 LVM 扩容和 `/home` 迁移的操作与回退。

本页从虚拟机已经看到新块设备开始。Cinder 卷的创建、挂载和删除见[数据存储](storage.md)。

**设备名警告**：`/dev/sdb`、`/dev/vdb` 都是示例。`mkfs`、`pvcreate`、`wipefs` 会直接改写磁盘，执行前必须用 `lsblk` 核对容量、型号和挂载点。选错设备会破坏现有系统或数据。

**占位符**：文中所有 `<...>` 都需要替换为实际值，例如 `<vg>`、`<lv>`、`<username>`，不要原样执行。

## 选方案

先确认 `/home` 的位置和是否使用 LVM：

```bash
lsblk -f
df -hT / /home
sudo pvs
sudo vgs
sudo lvs
```

如果 `/data` 已存在，再执行：

```bash
findmnt /data
df -hT /data
```

| 现状 | 方案 |
|---|---|
| `/home` 是 LVM 逻辑卷 | 方案 A：扩容 `/home`，不迁移数据 |
| `/home` 在根分区或普通分区，可以停机 | 方案 B：新盘接管 `/home` |
| `/home` 在根分区，机器不能停 | 方案 C：新盘挂 `/data`，迁移大目录 |
| 只是新增数据盘 | 方案 C |

选择顺序：能在线扩容就不迁移；必须迁移时，优先只迁大目录。方案 B 影响所有用户，必须安排维护窗口。

如果 `/data` 已经挂载，不要再次格式化；先确认它是不是目标盘。

## 准备

### 核对设备

```bash
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL,SERIAL
sudo blkid /dev/sdb
sudo wipefs -n /dev/sdb
```

`wipefs -n` 只列出磁盘上的文件系统、分区表、LVM 等签名，不写入。确认：

- `SIZE` 与新盘容量一致。
- `MOUNTPOINT` 为空。
- 新盘没有仍需保留的数据。
- 如果 `wipefs -n` 显示旧签名，先确认这块盘可以清空，再执行 `sudo wipefs -a /dev/sdb`。`wipefs -a` 会删除签名，不可逆。

本页不建分区表，整块盘直接做文件系统或 PV。如果规范要求分区，先按组织的分区规范建 GPT 分区，再把下文的 `/dev/sdb` 换成 `/dev/sdb1`；分区操作不在本页展开。

### fstab 规则

修改前备份：

```bash
sudo cp -a /etc/fstab /etc/fstab.bak
```

每次修改前，先确认当前 `/etc/fstab` 能正常挂载，再重新备份。用 `sudoedit /etc/fstab` 编辑，一个挂载点只写一行：

```text
UUID=<UUID>  /data  xfs  defaults  0  0
```

- UUID 用 `sudo blkid -s UUID -o value /dev/sdb` 获取，不要写设备名；设备名可能随加盘、换槽位而变化。
- 文件系统类型必须与 `mkfs` 一致，示例是 `xfs`。
- `defaults` 适合大多数情况。非关键数据盘可以加 `nofail`，磁盘缺失时系统仍能开机；代价是服务可能在磁盘未挂载时写入根分区的同名目录。`/home` 不要加 `nofail`。
- 不要重复追加同一个挂载点。先删除旧条目，再写新条目。

验证前先创建挂载点目录，例如 `sudo mkdir -p /data`。挂载点不存在时，`mount -a` 会失败。

验证：

```bash
sudo findmnt --verify --verbose
sudo systemctl daemon-reload
sudo mount -a
```

`mount -a` 失败时先看报错；新条目有问题就用备份回退，不要带着错误重启：

```bash
sudo cp -a /etc/fstab.bak /etc/fstab
sudo systemctl daemon-reload
```

## 方案 A：LVM 扩容

### 适用条件

`/home` 是 LVM 逻辑卷，卷组还有剩余空间，或可以加一块新盘。扩容在线完成，不需要迁移数据。本页的 LVM 指虚拟机内的 LVM；host50/host51 上的 Cinder 卷组扩容见[数据存储](storage.md)。

```bash
findmnt -no SOURCE,FSTYPE /home
sudo vgs
sudo lvs -o vg_name,lv_name,lv_size
```

`findmnt` 的 SOURCE 是 `/dev/mapper/<vg>-<lv>` 时，`/home` 在 LVM 上。`vgs` 的 `VFree` 不为 0 时，可以跳过下一步，直接扩展 LV。

### 操作

**1. 新盘加入卷组**

只有卷组没有剩余空间时才需要：

```bash
sudo pvcreate /dev/sdb
sudo pvs
sudo vgextend <vg> /dev/sdb
sudo vgs
```

`pvs` 中 `/dev/sdb` 的 VG 列应为空；`vgextend` 后 `VFree` 增加。`pvcreate` 报设备已有签名或被过滤时，先停止核对，不要直接加 `--force`。

**2. 扩展逻辑卷**

```bash
sudo lvextend -r -l +100%FREE /dev/<vg>/<lv>
```

`-r` 在扩展 LV 后调用 `fsadm` 扩展文件系统，ext4 和 XFS 都支持在线扩容。`+100%FREE` 会占用卷组全部剩余空间；如果还要留给其他 LV，改用 `-L +100G`。

如果 `-r` 失败，先确认 LV 是否已经扩展，再手动扩展文件系统：

```bash
# ext4
sudo resize2fs /dev/<vg>/<lv>
# XFS，参数是挂载点
sudo xfs_growfs /home
```

### 验证

```bash
df -hT /home
sudo lvs -o vg_name,lv_name,lv_size
sudo vgs
```

`df` 的容量应增加。如果 `lvs` 已变大而 `df` 没变，说明文件系统没有扩展，按上面的命令补做。

### 回退

LVM 在线扩容没有无损的“撤销”。`lvreduce` 可能损坏文件系统，XFS 不支持缩小。如果要把新盘撤出，先确认其他 PV 有足够空间，再用 `pvmove` 搬走数据：

```bash
sudo pvmove /dev/sdb
sudo vgreduce <vg> /dev/sdb
sudo pvremove /dev/sdb
```

`pvmove` 会实际搬运数据，耗时且产生大量 I/O，只在维护窗口执行。如果新盘已经被 LV 使用，且其他 PV 空间不足，`pvmove` 会失败。不要为了回退强行缩容。

## 方案 B：迁移 /home

### 适用条件

`/home` 不是 LVM，且可以安排维护窗口。目标是把 `/home` 整体搬到新盘。

先确认 `/home` 是不是独立挂载点：

```bash
findmnt /home
```

- 没有输出：`/home` 只是根分区上的目录。
- 有输出：`/home` 是独立分区，切换时先 `umount /home`，不要 `mv /home`，挂载点不能直接改名。

确认空间：

```bash
df -hT /home
sudo du -sh /home
```

新盘容量必须大于 `/home` 已用空间。`du` 可能较慢，大目录建议在维护窗口执行。

### 复制数据

**1. 创建文件系统并临时挂载**

```bash
sudo mkfs.xfs /dev/sdb
sudo mkdir -p /mnt/newhome
sudo mount /dev/sdb /mnt/newhome
```

`/mnt/newhome` 必须是空目录。已有数据时换一个临时挂载点，避免被新文件系统遮住。

**2. 第一次复制**

可以在线执行，先复制大部分数据：

```bash
sudo rsync -aHAX --numeric-ids --info=progress2 /home/ /mnt/newhome/
```

`-a` 保留权限、属主、时间戳和软链接；`-H` 保留硬链接；`-A` 保留 ACL；`-X` 保留扩展属性；`--numeric-ids` 按 UID/GID 复制。`/home/` 末尾的斜杠表示复制目录内容，而不是目录本身。

如果 `/home` 下有其他挂载点，先用 `findmnt -R /home` 确认是否要一起复制。不希望跨文件系统时加 `-x`。

**3. 停写并第二次同步**

通知用户退出登录，停止会写入 `/home` 的服务。先确认没有进程占用：

```bash
sudo lsof +D /home
```

`lsof +D /home` 还有输出时，先处理占用进程，不要继续。该命令在文件很多时可能较慢；可以用 `who` 和 `sudo fuser -vm /home` 辅助确认没有活动会话。

没有输出后，做第二次同步：

```bash
sudo rsync -aHAX --numeric-ids --delete --info=progress2 /home/ /mnt/newhome/
```

`--delete` 删除目标中源已不存在的文件，让两边一致。第二次同步通常很快。

### 切换挂载

**1. 校验复制结果**

```bash
sudo rsync -aHAX --numeric-ids --delete --dry-run /home/ /mnt/newhome/
sudo du -sx /home /mnt/newhome
```

Dry-run 没有输出表示内容一致。`du` 可能因硬链接和稀疏文件有差异，以 dry-run 为准。

**2. 对齐根目录权限**

```bash
sudo chown --reference=/home /mnt/newhome
sudo chmod --reference=/home /mnt/newhome
```

`rsync` 复制的是 `/home` 的内容，不会自动复制 `/home` 目录本身的权限；新文件系统的根目录权限要单独对齐。

**3. 切换挂载点**

`/home` 是根分区上的目录：

```bash
sudo umount /mnt/newhome
sudo mv /home /home.bak
sudo mkdir /home
sudo chown --reference=/home.bak /home
sudo chmod --reference=/home.bak /home
```

`/home.bak` 已存在时换一个名字，避免把旧家目录移动到备份目录里面。

`/home` 是独立分区：

```bash
sudo umount /home
sudo umount /mnt/newhome
```

旧分区保持原样，不要删除。它现在没有挂载，数据仍在。

**4. 修改 fstab**

```bash
sudo blkid -s UUID -o value /dev/sdb
sudoedit /etc/fstab
```

写入或替换 `/home` 行：

```text
UUID=<新盘 UUID>  /home  xfs  defaults  0  0
```

示例用 XFS；新盘用 ext4 时把 `xfs` 改成 `ext4`。原来有 `/home` 的旧条目时，先删除或注释，只保留一条。然后：

```bash
sudo systemctl daemon-reload
sudo mount /home
findmnt /home
df -hT /home
```

### 验证

用普通用户测试家目录读写：

```bash
sudo -iu <testuser> pwd
sudo -iu <testuser> sh -c 'touch ~/.write-test && rm ~/.write-test'
```

在维护窗口内重启一次，确认 fstab 在开机时也能正确挂载：

```bash
sudo reboot
```

重启后：

```bash
findmnt /home
df -hT /home
```

`mount -a` 成功不代表开机一定成功；涉及 `/home` 的切换，必须做一次重启验证。

### 回退

`/home` 原来是根分区上的目录：

```bash
sudo umount /home
sudo rmdir /home
sudo mv /home.bak /home
sudo cp -a /etc/fstab.bak /etc/fstab
sudo systemctl daemon-reload
```

`/home` 原来是独立分区：

```bash
sudo umount /home
sudo cp -a /etc/fstab.bak /etc/fstab
sudo systemctl daemon-reload
sudo mount /home
```

回滚前先检查新 `/home` 上有没有用户新写入的数据。如果有，先复制回旧目录，否则回滚会丢变更。

`/home.bak` 和旧分区至少保留到所有用户验证正常。确认后再删除或回收；删除前先用 `ls` 核对内容。

## 方案 C：挂载 /data

### 创建文件系统

先检查 `/data` 是否已经是挂载点：

```bash
findmnt /data
ls -la /data
```

如果 `/data` 已经挂载，不要格式化，直接使用。如果只是临时挂载，按「fstab 规则」补一条持久化条目。如果 `/data` 只是根分区上的目录且里面已有数据，直接挂载新盘会把原数据遮住；先把旧目录改名：

```bash
sudo mv /data /data.bak
```

`/data.bak` 已存在时换一个名字，避免把旧目录移动到备份目录里面。

然后创建文件系统：

```bash
sudo mkfs.xfs /dev/sdb
sudo mkdir -p /data
sudo blkid -s UUID -o value /dev/sdb
```

如果磁盘已经有文件系统且数据要保留，跳过 `mkfs`，直接用 `blkid` 查 UUID。

按上文「fstab 规则」写入 `/data` 条目，然后：

```bash
sudo systemctl daemon-reload
sudo mount -a
findmnt /data
df -hT /data
```

如果之前把旧数据移到了 `/data.bak`，挂载后复制回来：

```bash
sudo rsync -aHAX /data.bak/ /data/
```

确认数据完整后再清理 `/data.bak`。

### 权限模型

| 路径 | 属主:属组 | 权限 | 用途 |
|---|---|---|---|
| `/data` | root:root | 755 | 用户可进入，只有 root 能在顶层建目录 |
| `/data/<username>` | user:user | 755 | 个人目录，本人可写，他人只读 |
| `/data/<shared>` | root:group | 2775 | 组内共享 |

设置根目录：

```bash
sudo chown root:root /data
sudo chmod 755 /data
```

挂载后权限以文件系统根目录为准。如果挂载点之前被设成 700，普通用户没有 `x` 权限，访问会报 Permission denied；这不是磁盘故障。

创建个人目录：

```bash
sudo install -d -m 755 -o <username> -g "$(id -gn <username>)" /data/<username>
```

检查：

```bash
ls -ld /data /data/<username>
stat -c '%a %A %U:%G %n' /data /data/<username>
namei -l /data/<username>
```

`namei -l` 会逐级列出路径权限，父目录缺少 `x` 时，子目录权限再宽也进不去。

权限含义：

- `755`：属主可读写进入，组和其他人可读、可进入。适合“本人可写、他人可复用数据”的个人目录。
- `700`：只有属主可访问。适合需要保密的个人目录。
- `2775`：SGID，目录下新建的文件和子目录继承属组。适合共享目录。
- `777`：任何人都能写和删除。不要使用，会破坏共享数据。

`ls -ld` 的输出逐段对应：

```text
drwxr-xr-x 4 root root 4096 Nov 18 10:00 /data
```

- 首字符 `d` 是目录；`l` 是软链接，`-` 是普通文件。
- 第 1 组 `rwx` 是属主权限。
- 第 2 组 `r-x` 是属组权限。
- 第 3 组 `r-x` 是其他人权限。
- `root root` 是属主和属组。

`2775` 的首位 `2` 是 SGID 位，组权限位显示为 `rws`。

### 共享目录

多人写入的目录用用户组加 SGID。组已存在时跳过 `groupadd`：

```bash
sudo groupadd <group>
sudo usermod -aG <group> <username>
sudo chown -R root:<group> /data/<shared>
sudo find /data/<shared> -type d -exec chmod 2775 {} +
sudo find /data/<shared> -type f -exec chmod g+rw {} +
```

SGID 只保证新文件继承属组，不自动给组写权限。成员 umask 为 022 时，新文件是 644，组内其他成员仍然不能写。需要多人写入时，再加默认 ACL：

```bash
sudo setfacl -R -m g:<group>:rwX /data/<shared>
sudo find /data/<shared> -type d -exec setfacl -m d:g:<group>:rwX {} +
```

`setfacl -d` 设置默认 ACL，只影响之后新建的文件和目录。XFS 默认支持 ACL，ext4 通常也支持；`setfacl` 报 `Operation not supported` 时检查挂载选项。系统没有 `setfacl` 时，先安装 `acl` 包。

组成员需要重新登录后才会获得新组。`newgrp <group>` 只对当前 shell 生效。

对已有大量数据的目录执行递归 `chmod`、`setfacl` 会产生大量元数据 I/O，安排在没有任务运行时做。

### 迁移目录

把 `/home` 下的大目录搬到 `/data`，原位置留软链接，用户代码中的路径不用改。迁移前确认 `/data` 余量足够；Cinder 后端的 thin pool 容量见[数据存储](storage.md)。

**1. 找大目录**

```bash
sudo du -xhd1 /home | sort -h
sudo du -xhd1 /home/<username> | sort -h
```

`-x` 不跨文件系统，`-d1` 只统计一层。常见大目录是 `.cache`、`miniconda3`、数据集和检查点。

**2. 停任务并确认占用**

```bash
who
sudo lsof | grep -F '/home/<username>/<dir>'
```

让用户退出相关会话，停止训练、Jupyter、conda 安装等会写目录的进程。`lsof` 还有输出时不要迁移。

**3. 迁移并建立软链接**

`/data/<username>` 必须已经存在；没有时先按「权限模型」创建。

```bash
sudo mv /home/<username>/<dir> /data/<username>/
sudo ln -s /data/<username>/<dir> /home/<username>/<dir>
sudo chown -h <username>:"$(id -gn <username>)" /home/<username>/<dir>
```

`mv` 跨文件系统时会先复制再删除，大目录需要时间；中断后源目录可能只复制了一部分，重试前先核对。数据量很大时，可以用 `rsync` 复制，校验后再删除源目录。

`chown -h` 修改软链接本身的属主；不加 `-h` 会作用到链接目标。

**4. 验证**

```bash
ls -ld /home/<username>/<dir>
readlink -f /home/<username>/<dir>
df -hT / /data
```

`ls -ld` 应显示 `lrwxrwxrwx ... -> /data/<username>/<dir>`，`readlink -f` 应解析到 `/data` 下的真实目录。

注意：

- 不要把整个 `/home/<username>` 软链到 `/data/<username>`。登录、配额和部分工具按真实家目录工作，移动子目录即可。
- 容器、systemd 服务或备份工具可能按真实路径工作。迁移后先测试；不兼容软链接时，让程序直接使用 `/data` 路径。
- `rsync -a` 默认保留软链接，不会跟随；会跟随软链接的工具可能重复复制数据。

## 自动建目录

目标：建号后自动创建 `/data/<username>`。两种机制二选一，同时部署也不会重复创建。

两个脚本都先检查 `/data` 是否已经挂载。磁盘未挂载时直接退出，避免把目录建到根分区，挂载后被遮住。

### adduser 钩子

Ubuntu/Debian 的 `adduser` 建号成功后，会调用 `/usr/local/sbin/adduser.local`。该文件已存在时，先备份并合并，不要覆盖其他建号逻辑：

```bash
sudo tee /usr/local/sbin/adduser.local > /dev/null <<'EOF'
#!/bin/sh
set -eu

user="${1:-}"
[ -n "$user" ] || exit 0
mountpoint -q /data || exit 0

uid="$(id -u "$user" 2>/dev/null || true)"
[ -n "$uid" ] || exit 0
[ "$uid" -ge 1000 ] || exit 0
[ "$uid" -lt 60000 ] || exit 0

dir="/data/$user"
if [ -d "$dir" ]; then
    exit 0
fi

install -d -m 755 -o "$user" -g "$(id -gn "$user")" "$dir"
EOF
sudo chmod 755 /usr/local/sbin/adduser.local
```

验证：

```bash
sudo adduser testuser
ls -ld /data/testuser
```

测试完成后删除测试账号和目录，不要留在系统里。

### PAM 钩子

适合 Ubuntu/Debian 上的 `useradd`、批量建号或统一认证。用户首次登录时创建目录。修改 PAM 前先备份，并保留一个已登录的 root 会话，确认新登录正常后再退出：

```bash
sudo cp -a /etc/pam.d/common-session /etc/pam.d/common-session.bak
sudo tee /usr/local/bin/create_data_dir.sh > /dev/null <<'EOF'
#!/bin/sh
set -eu

user="${PAM_USER:-}"
[ -n "$user" ] || exit 0
[ "${PAM_TYPE:-}" = "open_session" ] || exit 0
if [ "$user" = "root" ]; then
    exit 0
fi
mountpoint -q /data || exit 0

uid="$(id -u "$user" 2>/dev/null || true)"
[ -n "$uid" ] || exit 0
[ "$uid" -ge 1000 ] || exit 0
[ "$uid" -lt 60000 ] || exit 0

dir="/data/$user"
if [ -d "$dir" ]; then
    exit 0
fi

install -d -m 755 -o "$user" -g "$(id -gn "$user")" "$dir"
EOF
sudo chmod 755 /usr/local/bin/create_data_dir.sh
grep -q 'create_data_dir.sh' /etc/pam.d/common-session || \
    echo 'session optional pam_exec.so seteuid /usr/local/bin/create_data_dir.sh' | sudo tee -a /etc/pam.d/common-session
```

`seteuid` 让脚本以调用进程的有效 UID 运行，通常是 root。不加这个选项时，`su`、`sudo` 等场景可能以普通用户的 real UID 运行脚本，无法在 root 拥有的 `/data` 下创建目录。

`session optional` 表示脚本失败不会阻止登录。脚本用 `PAM_TYPE` 判断，只在会话建立时执行；`[ -d ]` 判断保证重复执行无副作用。

验证：新建用户后，用 SSH 或 `su - <username>` 登录一次，再执行 `ls -ld /data/<username>`。

### 存量用户

对已经存在的普通用户补一次：

```bash
mountpoint -q /data || { echo "/data 未挂载"; exit 1; }
for u in $(awk -F: '$3 >= 1000 && $3 < 60000 {print $1}' /etc/passwd); do
    dir="/data/$u"
    [ -d "$dir" ] && continue
    echo "create $dir"
    sudo install -d -m 755 -o "$u" -g "$(id -gn "$u")" "$dir"
done
```

验证：

```bash
ls -ld /data/*
```

个人目录的属主应与目录名对应，权限为 755；共享目录为 2775；ext4 的 `lost+found` 是 root:root 700，属于正常。

可选：在用户家目录建立指向个人数据目录的软链接，方便直接访问：

```bash
sudo ln -s /data/<username> /home/<username>/data
sudo chown -h <username>:"$(id -gn <username>)" /home/<username>/data
```

用户已有同名 `~/data` 时先确认内容，不要覆盖。

## 缓存重定向

HuggingFace、PyTorch、pip 默认把权重和包缓存在 `~/.cache`，不重定向会再次占满根分区：

```bash
sudo tee /etc/profile.d/dl_cache.sh > /dev/null <<'EOF'
if [ -d "/data/$USER" ]; then
    export HF_HOME="/data/$USER/.cache/huggingface"
    export TORCH_HOME="/data/$USER/.cache/torch"
    export PIP_CACHE_DIR="/data/$USER/.cache/pip"
    export CONDA_PKGS_DIRS="/data/$USER/.conda/pkgs"
fi
EOF
```

验证：

```bash
source /etc/profile.d/dl_cache.sh
echo "$HF_HOME"
```

脚本只对读取 `/etc/profile.d` 的登录 shell 生效。`ssh host 'python train.py'` 这类非登录、非交互命令不会读取它，需要在提交脚本或 systemd 服务中显式设置这些变量。

已有的缓存不会自动搬走。先确认没有训练或下载进程在使用，再把 `~/.cache/huggingface`、`~/.cache/torch`、`~/.cache/pip` 移到 `/data/$USER/.cache/`。目标已存在时先合并，不要直接覆盖。

## GPU 任务

### 影响机制

权限检查发生在 `open()` 和路径解析时。已经打开的文件描述符在关闭前不受后续 `chmod`、`chown` 影响；但进程重新打开文件、DataLoader 新建 worker、写入新 checkpoint 时会重新检查权限。因此不能认为“改权限绝对不影响任务”。

递归 `chmod`、`chown` 还会遍历大量 inode，产生元数据 I/O。`chown` 还可能清除普通文件上的 setuid/setgid 位。在百万小文件的数据集上，可能拖慢训练甚至导致超时。

### 操作前检查

```bash
nvidia-smi
sudo fuser -vm /data
sudo lsof | grep -F '/data/' | head -n 50
sudo find /data -maxdepth 1 -type f -printf '%u %s %p\n'
```

- `nvidia-smi` 看谁在占用 GPU。
- `fuser -vm /data` 看挂载点上的进程。
- `lsof` 看具体打开的文件。
- `find` 看 `/data` 根目录下有没有散落文件。如果有，说明有人把路径硬编码成 `/data/xxx.pth`，收紧根目录权限会影响它。

### 风险分级

| 操作 | 风险 | 做法 |
|---|---|---|
| 新建空目录、安装钩子 | 无 | 可以直接做 |
| 收紧 `/data` 根目录权限 | 低 | 确认根目录没有散落文件 |
| 单目录 `chmod`、`chown` | 中 | 停掉该目录相关任务 |
| 递归 `chmod -R`、`chown -R` | 高 | 维护窗口，停任务 |
| 跨文件系统 `mv` 大目录 | 高 | 维护窗口，先 `lsof` |
| `groupdel` | 高 | 所有任务结束，确认不是用户主组 |

已打开的文件描述符不受影响，不代表可以随便递归改。新开的文件句柄会失败，元数据 I/O 也可能拖垮训练。

`groupdel` 不会杀死正在运行的进程，已登录进程仍持有数值 GID；但新会话不再拥有该组，后续任务会失去权限。如果该组是某个用户的主组，`groupdel` 会拒绝。删除前用 `getent group <group>` 和 `find /data -gid <gid>` 确认影响范围。

不要用 `chmod -R 777` 解决权限问题。它不会修复所有权，还会让任何用户删除或覆盖共享数据。

## 故障排查

### 开机挂载失败

现象是启动进入 emergency mode，或 `mount -a` 报错。

```bash
sudo findmnt --verify --verbose
sudo journalctl -xb | grep -i -E 'mount|fstab'
sudo dmesg | tail -n 30
```

常见原因：UUID 写错、文件系统类型与 `mkfs` 不一致、挂载点不存在、同一挂载点写了多条、磁盘没有挂载到虚拟机。

已经进入 emergency mode 时：

```bash
mount -o remount,rw /
cp /etc/fstab.bak /etc/fstab
reboot
```

恢复后先 `mount -a` 验证，再重启一次确认。

### 权限拒绝

```bash
namei -l /data/<username>
findmnt -T /data -o TARGET,SOURCE,FSTYPE,OPTIONS
getfacl -p /data/<username>
ls -ldZ /data /data/<username>
```

- `namei -l` 逐级显示权限，任何一级缺少 `x` 都会拒绝。
- `findmnt` 看是否只读，或是否缺少 `acl` 选项。
- `getfacl` 看 ACL。
- `ls -Z` 看 SELinux 上下文；Ubuntu 默认不启用 SELinux，通常不是这个原因。

不要用 `chmod 777` 绕过，先找出是哪一级、哪条规则拒绝。

### 扩容无效

`lvs` 显示 LV 已变大，但 `df` 没变，说明文件系统没有扩展：

```bash
# ext4
sudo resize2fs /dev/<vg>/<lv>
# XFS
sudo xfs_growfs /home
```

`lvextend -r` 报错时，先看输出和 `journalctl`，确认 LV 状态后再补做文件系统扩容，不要重复执行 `lvextend`。

### 设备不可见

```bash
lsblk
dmesg | tail -n 50
```

虚拟机新挂载的 Cinder 卷通常直接出现为 `/dev/vdb`、`/dev/vdc`。没有出现时，先在管理员环境确认：

```bash
openstack volume list --long
openstack server show <instance> --long
```

卷应为 `in-use`，并挂载到正确的实例。SCSI 盘可以尝试重新扫描：

```bash
echo 1 | sudo tee /sys/class/scsi_host/host*/scan
```

`virtio` 盘重新扫描通常无效，需要在维护窗口内卸载再挂载，或重启实例。

### 迁移后异常

用户登录后家目录为空、权限不对，或服务找不到文件：

```bash
findmnt /home
ls -ld /home /home/<username>
namei -l /home/<username>
getent passwd <username>
```

- `findmnt /home` 确认挂载的是新盘。
- `ls -ld` 确认家目录属主和权限。
- `getent passwd` 确认家目录路径没有变。
- 用软链接迁移的，用 `readlink -f` 确认指向 `/data`。

SELinux 系统迁移后可能需要 `restorecon -Rv /home`；Ubuntu 默认不启用 SELinux，先不要照搬。

## 维护注意

- fstab 改动前备份，改完用 `findmnt --verify` 和 `mount -a` 验证；涉及 `/home` 的切换要重启验证。
- fstab 使用 UUID，不使用设备名。
- `mkfs`、`pvcreate`、`wipefs` 不可逆，执行前用 `lsblk` 核对设备。
- LVM 扩容容易，缩容困难；XFS 不能缩小。
- `/home.bak`、旧分区、迁移源目录要确认无误后再删除；删除前先 `ls` 核对。
- `/data` 权限按最小必要设置，不要用 `777`，不要递归修改正在使用的数据。
- 共享目录用组、SGID 和默认 ACL，成员重新登录后生效。
- 有 GPU 任务时先看 `nvidia-smi`、`fuser`、`lsof`，再决定能不能动。
- 平台侧加盘分两步：先在 OpenStack 创建并挂载 Cinder 卷（见[数据存储](storage.md)），再进入虚拟机执行本页流程。
- 变更后记录设备、UUID、挂载点、文件系统类型和容量，便于下次扩容和故障排查。

---

返回[管理员视角总目录](index.md) ｜ 返回[手册首页](../index.md)
