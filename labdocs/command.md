# 命令速查与讲解

本页面把手册中散落的命令按使用场景集中起来。每条命令不只给出写法，也说明它查什么、输出怎么看、什么时候不该用。日常使用时可以把它当速查表；排查故障时，先看[按现象查命令](#按现象查命令)，再回到对应章节。

如果需要查看 Linux 日常使用相关的命令，可以参考：
- [TLDR Pages](https://tldr.sh/)：开源的命令速查，收录 Linux、macOS、Windows 和常用工具的命令。
- [Linux 教程 | 菜鸟教程](https://www.runoob.com/linux/linux-tutorial.html)：中文的 Linux 命令速查，收录了常用命令和示例。
- [Cheat-Sheets.org](http://cheat-sheets.org/)：英文的命令速查。

::: tip 怎么用这页
- 只查一条命令：用浏览器搜索本页，或看右侧“本页目录”。
- 排查问题：先确认自己登录的是哪台机器，再按“网络 → 磁盘 → 进程 → GPU → 日志”的顺序收集信息。
- 带【管理员】标记的段落面向宿主机、交换机、路由器和控制节点。普通用户不要执行其中的写操作。
:::

::: info 如何学习
[TLDR Pages](https://tldr.sh/) 是一个开源项目，收集了 Linux、macOS、Windows 和常用工具的命令速查。在 TLDR 中，每条命令只给出最常用的写法和示例，去掉了 man 页里大量不常用的选项。
:::

## 阅读约定

命令里的尖括号是占位符，输入时要替换成实际值：

| 写法 | 含义 |
|---|---|
| `<user_id>` | 自己的 Linux 账号名。 |
| `<host>`、`<ip>` | 目标主机名或地址。 |
| `<PID>` | 进程号，从 `ps`、`top` 或 `nvidia-smi` 的输出里找。 |
| `<volume>`、`<server>` | OpenStack 卷或实例的名称、ID。 |
| `$` | 普通用户提示符。 |
| `#` | root 提示符。看到它说明当前命令会以管理员权限执行。 |

几条通用规则：

- **先只读，后写入。** `ls`、`df`、`ps`、`nvidia-smi`、`display` 这类命令不会改配置，适合先收集现场信息。
- **先确认路径，再删除。** 执行 `rm`、`mv`、`chmod` 前，先用 `pwd` 和 `ls` 看清当前目录和目标。
- **不要把网上或 AI 生成的命令直接粘贴到终端。** 尤其不要直接执行带 `sudo`、`rm -rf`、`chmod -R`、`curl | bash` 的命令。
- **不要用 `sudo` 绕过权限。** 普通用户没有 `sudo` 权限，需要系统级操作时联系管理员。

总而言之，必须在确认自己在正确的机器、正确的目录、正确的账号、正确的命令后，并已经完全理解命令的作用，明白预期的结果和知晓风险后，才能执行写操作。每一条命令在后台都有所记录。

命令的基本结构是“命令 + 选项 + 参数”，例如：

```bash
ls -lah /data/<user_id>
```

`ls` 是命令，`-lah` 是选项，`/data/<user_id>` 是参数。管道 `|` 把前一条命令的输出交给后一条命令，例如 `ps -ef | grep python`；重定向 `>` 会覆盖文件，`>>` 会追加内容。覆盖前先确认目标文件不是重要文件。

## 先确认环境和身份

登录后不要急着跑程序，先确认“我在哪台机器、用什么身份、机器是否正常”。这四条命令只需要几秒钟，却能避免很多“连错机器”和“看错数据”的问题。

```bash
hostname
whoami
id
pwd
date -Is
uptime
```

- `hostname`：主机名。GPU 虚拟机应显示 `gpu_server_2x4090_1` 或 `gpu_server_2x4090_2`。
- `whoami` 和 `id`：当前账号和所属组。确认不是误用了别人的账号，也不是 root。
- `pwd`：当前目录。删除或覆盖文件前必须看。
- `date -Is`：带时区的当前时间。上报问题时附上它，方便对照日志。
- `uptime`：开机时长和平均负载。三个数字分别是 1、5、15 分钟的平均负载，持续高于 CPU 核心数说明机器比较忙。

查看系统版本和硬件概况：

```bash
cat /etc/os-release
uname -a
lscpu | head -30
free -h
lsblk
```

`free -h` 看内存，`lsblk` 看块设备和挂载点。`buff/cache` 是缓存，不是被程序吃掉的可用内存；判断内存是否紧张，重点看 `available` 一列。

## SSH 与远程访问

SSH 是登录 GPU 虚拟机和宿主机的入口。普通用户只登录 GPU 虚拟机，宿主机和控制节点由管理员维护。

### 登录

```bash
ssh <user_id>@172.16.33.91
ssh <user_id>@172.16.33.247
```

第一次连接会提示确认主机指纹，确认地址正确后输入 `yes`。输入密码时屏幕不显示字符，这是正常的。

排查连接问题时加 `-v` 选项：

```bash
ssh -v <user_id>@172.16.33.91
ssh -o ConnectTimeout=5 <user_id>@172.16.33.91
```

`ssh -v` 会打印握手过程。卡在 `Connecting to ...` 通常是网络或防火墙问题；出现 `Permission denied` 是账号或密码问题；出现 `Connection refused` 说明目标机器的 SSH 服务没有监听。

### 公钥登录

```bash
ssh-keygen -t ed25519 -C "<user_id>@cslab"
ssh-copy-id <user_id>@172.16.33.91
```

`ssh-keygen` 在本机生成密钥对，`ssh-copy-id` 把公钥追加到服务器的 `~/.ssh/authorized_keys`。私钥只留在自己的电脑上，不要上传到服务器、代码仓库或聊天工具。

可以把常用主机写进本机的 `~/.ssh/config`，以后直接 `ssh gpu1`：

```text
Host gpu1
    HostName 172.16.33.91
    User <user_id>

Host gpu2
    HostName 172.16.33.247
    User <user_id>
```

### 常见 SSH 错误

| 提示 | 含义 | 先做什么 |
|---|---|---|
| `Connection timed out` | 地址不可达、端口被挡或不在实验室网络。 | `ping <ip>`，确认连接的是实验室无线或有线网。 |
| `Permission denied (publickey,password)` | 用户名、密码或公钥不对，账号可能未开通。 | 检查用户名大小写和密码输入法，不要连续试错。 |
| `Connection refused` | 对方没有监听 SSH 端口。 | 确认 IP 是否正确，联系管理员检查服务。 |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | 主机密钥和本地记录不一致，可能是重装，也可能是中间人攻击。 | 先联系管理员确认，不要直接删 `known_hosts`。 |
| `no matching host key type found` | 交换机只支持旧式 RSA 主机密钥。 | 只对本次连接加 `-o HostKeyAlgorithms=+ssh-rsa`。 |

主机密钥变化的完整说明见[常见疑难解答](user/faq.md)。

## 文件与目录

```bash
pwd
ls -lah
ls -lah /data/<user_id>
cd /data/<user_id>
mkdir -p ~/projects/demo
cp -a old_dir new_dir
mv old_name new_name
```

- `ls -lah` 同时显示隐藏文件、权限、所有者和人类可读的大小。
- `mkdir -p` 会连同缺失的父目录一起创建，可重复执行。
- `cp -a` 保留权限、时间和符号链接，适合复制整个项目。
- `mv` 在同盘内是重命名，跨盘是复制后删除。

查找文件：

```bash
find ~/projects -maxdepth 2 -type f -name "*.py"
find /data/<user_id> -type f -size +1G
find ~/projects -type f -mtime -7
```

`-maxdepth` 限制递归深度，`-type f` 只要普通文件，`-size +1G` 找大于 1 GiB 的文件，`-mtime -7` 找最近 7 天修改过的文件。先在较小的目录里试，避免直接扫描整个 `/`。

压缩和解压：

```bash
tar -czf results.tar.gz results/
tar -xzf results.tar.gz
tar -tzf results.tar.gz | head
```

`-c` 创建、`-x` 解压、`-t` 只列出内容、`-z` 走 gzip、`-f` 指定文件名。解压前先用 `-t` 看一眼内容，避免压缩包把文件散落到当前目录。

删除文件要格外小心：

```bash
ls -lah <target>
rm <file>
rm -r <dir>
```

`rm -rf` 会递归删除且不进入回收站。执行前先 `pwd` 和 `ls` 确认路径，只删除自己的文件。不要对 `/`、`~`、`/data` 或不确定的变量执行 `rm -rf`。

修改权限只改自己创建的文件：

```bash
chmod u+x script.sh
chmod 600 ~/.ssh/id_ed25519
```

不要执行 `chmod -R 777`。它会把目录和文件开放给所有人，既不安全，也可能破坏别人的访问。

## 磁盘与空间

磁盘问题先分清是系统盘 `/` 还是数据盘 `/data`。系统盘写满会导致登录失败、程序崩溃、日志写不进去；数据盘写满只影响数据写入。

```bash
df -h
df -i
du -sh ~/projects/demo
du -h --max-depth=1 /data/<user_id> | sort -h
```

- `df -h` 看文件系统总容量、已用、可用和使用率。重点看 `/` 和 `/data` 两行。
- `df -i` 看 inode。大量小文件可能把 inode 用完，此时 `df -h` 还有空间但无法创建新文件。
- `du -sh` 统计目录总大小，大目录会慢，不要直接对 `/` 执行。
- `du --max-depth=1` 只看下一层，适合快速找出哪个子目录最大。

查看块设备和挂载关系：

```bash
lsblk
lsblk -f
```

`lsblk` 显示磁盘、分区和挂载点。GPU 虚拟机里 `vda` 通常是系统盘，`vdb` 是数据盘（仅 `172.16.33.247` 有）。不要对不认识的设备执行分区或格式化命令。

找出大文件和已删除但仍被进程占用的文件：

```bash
find /data/<user_id> -type f -size +1G -printf '%s %p\n' | sort -nr | head
lsof +L1 2>/dev/null | head
```

`lsof +L1` 列出已删除但仍被进程打开的文件。这类文件会继续占用磁盘，直到进程退出。看不清来源时不要直接 kill，先确认进程属于谁。

常用缓存位置：

```bash
du -sh ~/.cache
du -sh ~/.conda/pkgs
du -sh ~/.cache/pip
du -sh ~/.cache/huggingface
```

Conda、pip 和 Hugging Face 的缓存都可以清理，但先确认没有正在运行的任务依赖它们。清理命令见[Conda 与 Python](#conda-与-python)。

添加磁盘或扩容：

```bash
sudo fdisk -l
sudo fdisk /dev/<new_vdisk>
sudo mkfs.ext4 /dev/<new_vdisk_num>
sudo mount /dev/<new_vdisk_num> /<new_disk_name>
```

获得访问磁盘的权限：

```bash
sudo chown -R <user_id>:<user_id> /<new_disk_name>/<user_id>
```

## 进程与资源

```bash
ps -ef
ps aux --sort=-%mem | head
top
htop
free -h
uptime
```

- `ps -ef` 列出所有进程，适合配合 `grep` 查找。
- `ps aux --sort=-%mem` 按内存占用排序。
- `top` 和 `htop` 实时查看 CPU、内存和进程；`htop` 需要管理员预装，没有就用 `top`。
- `free -h` 看内存和交换分区。
- `uptime` 的负载要结合 CPU 核心数看。8 核机器负载 8 左右表示基本跑满，长期高于核心数说明有排队。

查找和结束自己的进程：

```bash
pgrep -af python
ps -ef | grep <keyword>
kill <PID>
kill -9 <PID>
```

先 `kill <PID>` 发正常终止信号，给程序保存和清理的机会；进程不响应时再用 `kill -9` 强制终止。只对自己启动的进程使用，不要 kill 别人的 PID，也不要在不确定进程用途时强制结束。

长时间任务放到后台：

```bash
nohup python train.py > train.log 2>&1 &
tail -f train.log
```

`nohup` 让进程在退出 SSH 后继续运行，`> train.log 2>&1` 把标准输出和错误都写入日志，`&` 放到后台。更推荐用 `tmux`，可以随时重新 attach：

```bash
tmux new -s train
# 在会话里运行任务，按 Ctrl+B 再按 D 退出
tmux ls
tmux attach -t train
```

任务结束后确认进程真的退出，不要只关掉终端窗口。

## GPU 使用

只有 `172.16.33.91` 和 `172.16.33.247` 两台 GPU 虚拟机有显卡。普通 CPU 虚拟机上执行 `nvidia-smi` 报错是正常的。

### 看显卡和进程

```bash
nvidia-smi
nvidia-smi -L
nvidia-smi --query-gpu=index,name,memory.total,memory.used,utilization.gpu,temperature.gpu --format=csv
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
```

- `nvidia-smi` 看整机概况：两张卡、驱动版本、显存、温度、功耗和进程。
- `nvidia-smi -L` 只列显卡，输出应有两张 `NVIDIA GeForce RTX 4090`。
- `--query-gpu` 适合脚本采集，字段顺序和 `--format=csv` 对应。
- `--query-compute-apps` 只看计算进程的 PID、名称和显存占用。

持续观察：

```bash
watch -n 2 nvidia-smi
```

每 2 秒刷新一次，按 `Ctrl+C` 退出。它只是重复查看，不会影响别人的任务。

查看两张卡之间的互联：

```bash
nvidia-smi topo -m
```

两张 4090 之间没有 NVLink。显示 `SYS` 或 `PHB` 说明通信经过 PCIe 或主板芯片组，这是正常现象。多卡训练是否加速，取决于计算量和通信量的比例，不要假设双卡一定比单卡快两倍。

### 显式指定显卡

```bash
CUDA_VISIBLE_DEVICES=0 python train.py
CUDA_VISIBLE_DEVICES=1 python train.py
CUDA_VISIBLE_DEVICES=0,1 torchrun --standalone --nproc_per_node=2 train.py
```

`CUDA_VISIBLE_DEVICES` 限制程序能看到哪些卡。设置为 `0` 时只看到 0 号卡，设置为 `0,1` 时两张都可见。启动任务前先看 `nvidia-smi`，确认目标卡空闲；一张卡同一时间只跑一个任务，不要和别人抢同一张卡。

在 Python 里检查：

```bash
python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.device_count())"
```

也可以查看驱动和 CUDA 运行时：

```bash
nvidia-smi
nvcc --version
python -c "import torch; print(torch.__version__, torch.version.cuda)"
```

`nvidia-smi` 右上角显示的是驱动支持的 CUDA 版本，`nvcc --version` 是系统 CUDA Toolkit 版本，PyTorch 自带的 CUDA 运行时又是另一套。三者不要求完全一致，但主版本差异过大时可能出现兼容问题。不要在虚拟机内自行重装驱动或覆盖系统 CUDA。

### 释放显存

```bash
nvidia-smi
kill <PID>
kill -9 <PID>
```

实验结束、程序报错或被中断后，确认自己的进程已经退出、显存已经释放。只结束自己的进程。占用者是别人时，等待或联系对方，不要直接 kill。

GPU 的红线和更多排查方法见[GPU 使用](user/gpu.md)。

## Conda 与 Python

服务器统一安装了 Miniconda，位置是 `/opt/miniconda3`。不要在服务器上再装一套个人 Conda。

### 接入 Conda

```bash
source /opt/miniconda3/etc/profile.d/conda.sh
conda --version
```

希望每次登录自动生效：

```bash
/opt/miniconda3/bin/conda init bash
source ~/.bashrc
```

`conda init` 会修改自己的 `~/.bashrc`，只影响当前账号。不要修改 `/opt/miniconda3` 下的全局配置。

### 环境管理

```bash
conda create -n <env> python=3.10 -y
conda activate <env>
conda deactivate
conda env list
conda list
```

- `create -n` 创建个人环境，环境名用自己的项目名。
- `activate` 进入环境，提示符前会出现环境名。
- `env list` 列出所有环境，当前环境带 `*`。
- `list` 查看当前环境已安装的包。

导出、重建和删除环境：

```bash
conda env export -n <env> > environment.yml
conda env create -f environment.yml
conda env remove -n <env>
```

导出文件里包含环境名和依赖版本，换机器时可以重建。删除前确认环境名，不要删除别人的环境。

清理缓存：

```bash
conda clean -a
pip cache purge
```

`conda clean -a` 清理包缓存和索引缓存，`pip cache purge` 清理 pip 缓存。清理不会影响已安装的包，但正在安装的任务应先停止。

### 安装 Python 包

```bash
conda activate <env>
which python
which pip
pip install <package>
```

`which python` 和 `which pip` 应指向自己的环境，例如 `/opt/miniconda3/envs/<env>/bin/python` 或 `~/.conda/envs/<env>/bin/python`。如果指向 `/usr/bin/python`，说明环境没有激活，此时 `pip install` 可能写到系统目录或报权限错误。

不要执行 `sudo pip install`，也不要在 `base` 环境里执行 `conda update`、`conda install`、`pip install`。`base` 是所有用户共用的默认环境，改动它会影响别人。

需要国内镜像时可以临时指定索引：

```bash
pip install -i https://pypi.tuna.tsinghua.edu.cn/simple <package>
```

PyTorch、TensorFlow 等框架建议从官网选择与驱动匹配的版本，不要直接运行来源不明的安装脚本。

## 网络诊断

网络排查按“本机网卡 → 地址 → 网关 → 路由 → DNS → 服务端口”的顺序，不要一上来就改配置。

```bash
ip -br link
ip -br addr
ip route
ip -6 route
```

- `ip -br link` 看网卡是否 up。
- `ip -br addr` 看接口地址。
- `ip route` 看默认路由和静态路由。
- `ip -6 route` 看 IPv6 路由。

测试连通性：

```bash
ping -c 4 172.16.33.1
ping -c 4 <target-ip>
traceroute <target-ip>
```

`172.16.33.1` 是 GPU 网段的网关。能 ping 通网关说明本机网络和二层基本正常；ping 不通网关，先检查 IP、网卡和接入端口。`traceroute` 没安装时可以跳过，不要为了排障自行 `apt install`。

查看本机监听端口和连接：

```bash
ss -tulpn
ss -tnp
```

`-t` TCP、`-u` UDP、`-l` 监听、`-n` 不解析名称、`-p` 显示进程。普通用户只能看到自己有权查看的进程信息。

测试 HTTP 和 DNS：

```bash
curl -I https://mirrors.tuna.tsinghua.edu.cn/
curl -v http://172.16.23.41/
dig <domain>
getent hosts <domain>
```

`curl -I` 只取响应头，适合判断服务是否可达；`-v` 打印请求过程。`dig` 查 DNS 解析，`getent hosts` 走系统解析器。能 ping 通 IP 但域名打不开，通常是 DNS 问题。

常见判断：

| 现象 | 可能原因 | 先查 |
|---|---|---|
| `ping` 网关不通 | IP、网卡、VLAN 或接入端口异常。 | `ip -br addr`、`ip route`。 |
| 网关通，外网 IP 不通 | 路由或出口问题。 | `ip route`、`traceroute`。 |
| IP 通，域名不通 | DNS 配置或上游 DNS 异常。 | `cat /etc/resolv.conf`、`dig`。 |
| 端口拒绝连接 | 服务没有监听或被防火墙拒绝。 | `ss -tulpn`、`nc -vz <host> <port>`。 |
| 能连但很慢 | 带宽被占满、丢包或链路降速。 | `ping`、`ss`、查看大流量任务。 |

不要修改网络配置、代理、防火墙或 DNS。需要变更时联系管理员。

## 日志与服务状态

日志是排查问题的证据，不是垃圾。不要为了“清理现场”删除日志目录。

```bash
systemctl --failed
systemctl status <service>
systemctl is-active <service>
```

`systemctl --failed` 列出启动失败的服务；`status` 看服务状态和最近日志；`is-active` 只返回 `active` 或 `inactive`，适合脚本判断。普通用户只能查看，不能 restart。

查看日志：

```bash
journalctl -u <service> -n 100 --no-pager
journalctl -u <service> --since "2026-11-11 09:00" --until "2026-11-11 12:00"
journalctl -k -n 100 --no-pager
dmesg -T | tail -50
```

- `-u` 指定服务，`-n` 只看最后若干行，`--no-pager` 不进入分页器。
- `--since` 和 `--until` 限定时间范围，上报问题时很有用。
- `-k` 看内核日志，`dmesg -T` 带人类可读时间。
- `dmesg` 在部分系统上需要 root，普通用户看不到时不要强行提权。

查看文件日志：

```bash
tail -n 100 <logfile>
tail -f <logfile>
grep -iE "error|fail|timeout" <logfile>
```

`tail -f` 会持续跟踪文件，按 `Ctrl+C` 退出。日志中的 `ERROR`、`Traceback`、`Timeout`、`Connection refused`、`No space left` 要连同前后几行一起保存，不要只截最后一行。

## 文件传输与大文件

从本地传到服务器：

```bash
scp -r local_dir <user_id>@172.16.33.247:/data/<user_id>/
scp local_file.tar.gz <user_id>@172.16.33.91:~/
```

从服务器下载：

```bash
scp <user_id>@172.16.33.91:~/results.tar.gz .
```

大文件或需要断点续传时用 `rsync`：

```bash
rsync -av --partial --progress local_dir/ <user_id>@172.16.33.247:/data/<user_id>/
rsync -av --partial --progress <user_id>@172.16.33.91:~/results/ ./results/
```

- `-a` 归档模式，保留权限、时间和符号链接。
- `-v` 显示详细过程。
- `--partial` 保留中断的部分文件，重新执行时可以续传。
- `--progress` 显示进度。

源路径末尾的 `/` 会影响结果：`local_dir/` 表示复制目录内容，`local_dir` 表示连目录本身一起复制。传输前确认目标目录存在并且自己有写权限。

校验文件完整性：

```bash
sha256sum <file>
sha256sum -c checksums.txt
```

把校验值一起保存，传输后对比。大文件传输中断时，先重新 `rsync`，不要反复从头 `scp`。完整的命令、续传、限速和 Windows 工具见[文件传输](user/transfer.md)。

## OpenStack CLI

OpenStack 命令行适合批量查看和精确操作。Horizon 能做的事，CLI 通常也能做；CLI 能看到更多字段，但误操作的后果也更直接。

### 加载认证环境

在控制节点或已配置 CLI 的管理环境执行：

```bash
export OS_AUTH_URL=http://10.16.23.41:5000/v3
export OS_USER_DOMAIN_NAME=Default
export OS_PROJECT_DOMAIN_ID=default
export OS_IDENTITY_API_VERSION=3
export OS_USERNAME=<username>
export OS_PROJECT_NAME=<project>
export OS_INTERFACE=internal
openstack token issue
```

`openstack token issue` 成功会返回令牌和过期时间，说明认证配置正确。口令应交互输入或从受控环境读取，不要写进 shell 历史、脚本或公开的 `openrc` 文件。内部 API 地址是 `10.16.23.41`，不是 `172.16.23.41`；`OS_INTERFACE=internal` 表示走内部端点。

### 查看项目资源

```bash
openstack server list
openstack server show <server>
openstack image list
openstack flavor list
openstack network list
openstack subnet list
openstack port list
openstack volume list
openstack volume show <volume>
openstack floating ip list
openstack security group list
openstack keypair list
openstack limits show --absolute
```

- `server list` 看实例名称、状态、地址和镜像。状态 `ACTIVE` 只代表控制面认为实例存在，不能代替实例内部检查。
- `server show` 看宿主机、可用区、电源状态、挂载的卷和网络。常用字段有 `OS-EXT-SRV-ATTR:host`、`OS-EXT-AZ:availability_zone`、`addresses`、`volumes_attached`。
- `volume list` 看卷状态和挂载对象。`in-use` 表示已挂载，`available` 表示可挂载，`error` 需要先排查，不要直接删除。
- `limits show --absolute` 看项目配额，例如实例数、vCPU、内存和卷容量。

### 卷和实例操作

```bash
openstack volume create --size 100 --type IPSAN <volume-name>
openstack server add volume <server> <volume>
openstack server remove volume <server> <volume>
openstack volume snapshot create --volume <volume> <snapshot-name>
openstack volume backup create --volume <volume> <backup-name>
```

创建卷时 `--size` 单位是 GiB，`--type IPSAN` 选择实验室的卷类型。挂载前确认卷和实例在同一个项目、同一个可用区，卷状态是 `available`。卸载前先在实例内停止对该磁盘的读写并卸载文件系统。

删除是不可逆操作：

```bash
openstack volume delete <volume>
openstack server delete <server>
```

删除卷前确认它没有挂载到实例、不是系统盘、数据已经备份；删除实例前确认它的卷是否还需要保留。删除实例不会自动删除卷，残留的卷会继续占用存储。

### 管理员视角

【管理员】以下命令需要管理员项目或对应权限：

```bash
openstack compute service list
openstack network agent list
openstack volume service list
openstack hypervisor list --long
openstack server list --all-projects --long
openstack volume list --all-projects --long
openstack volume backup list --all-projects
openstack project list
openstack user list
openstack service list
openstack endpoint list
```

`compute service list` 看 `nova-compute`、`nova-scheduler`、`nova-conductor` 是否 enabled/up；`network agent list` 看 Neutron 的 DHCP、L3、Metadata、Linux Bridge agent 是否 alive；`volume service list` 看 Cinder 的 scheduler、volume、backup。`hypervisor list --long` 看宿主机状态和资源。API 显示 up 不等于实例内部健康，还要登录宿主机和实例验证。

更多架构说明见[OpenStack 架构](admin/openstack.md)和[数据存储](admin/storage.md)。

## 宿主机与虚拟化

【管理员】以下命令在 host50 至 host54 上执行。先只读检查，确认影响范围后再重启服务或修改配置。

### 基础状态

```bash
hostname
date -Is
uptime
systemctl is-active nova-compute cinder-volume neutron-linuxbridge-agent
systemctl --failed
```

host52 至 host54 没有本地 Cinder 后端，`cinder-volume` 显示 inactive 是正常设计；这三台只需确认 `nova-compute` 和 Neutron agent。host50 和 host51 还要检查 `cinder-volume`。

### 虚拟机

```bash
virsh list --all
virsh dominfo <domain>
virsh dumpxml <domain> | grep -E "hostdev|source address|alias"
```

`virsh list --all` 看 libvirt 层面的虚拟机和电源状态，应与 OpenStack API 一致。`dumpxml` 用来确认 GPU 直通的 `hostdev` 条目和网络接口。不要直接 `virsh destroy` 或 `virsh undefine` 正在使用的虚拟机，先通过 OpenStack 确认归属。

### 网络和链路聚合

```bash
ip -br link
ip -br addr
ip route
cat /proc/net/bonding/bond0
```

关注 bond0 成员是否 up、LACP 是否正常、VLAN 子接口是否存在、默认路由是否指向 `172.16.23.1`。链路聚合提高的是多条并发流的总带宽，单条 iSCSI 或 `scp` 仍然只走一条成员链路。

### 时间同步

```bash
chronyc tracking
chronyc sources -v
```

`Leap status` 应为 `Normal`，`System time` 偏差应在可接受范围。时间偏差过大会让 Nova、Neutron、Cinder 的心跳误判。不要用 `date -s` 手动改时间，使用 chrony 逐步校正。

### 存储

```bash
df -h
vgs
lvs -o vg_name,lv_name,lv_size,data_percent,metadata_percent
iscsiadm -m session
```

- `vgs` 看卷组剩余空间 `VFree`。
- `lvs` 看 thin pool 的 `Data%` 和 `Meta%`。`Data%` 超过 80% 要开始清理或规划扩容，`Meta%` 超过 70% 要尽快处理。
- `iscsiadm -m session` 看 iSCSI 会话是否存在、目标地址是否正确。

thin pool 的使用率和虚拟机内 `df -h` 不是一回事。文件系统里删了文件，thin pool 不一定立即回收。

### GPU 直通

```bash
lspci -nnk | grep -A3 -i nvidia
dmesg -T | grep -iE "xid|vfio|iommu|pcie"
```

宿主机上 `nvidia-smi` 看不到已绑定到 `vfio-pci` 的显卡是正常的。`lspci -nnk` 中驱动应显示 `vfio-pci`，虚拟机 XML 里应有对应的 `hostdev`。发现 Xid、IOMMU 或 PCIe 错误时保留完整输出，不要自行重装驱动。

### Kolla 和集群服务

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
docker logs --tail 100 <container>
pcs status
```

Kolla 把 OpenStack 服务跑在容器里，`docker ps` 看容器状态，`docker logs` 看日志。`pcs status` 看 Pacemaker/Corosync 的资源状态。控制面只有一台，Pacemaker 不能在一台机器整体故障时接管服务。修改配置后按 Kolla 方式重启对应容器，不要直接改容器内的临时文件。

## H3C 交换机

【管理员】交换机运行 Comware，命令以 `display` 开头的大多是只读查看。登录时如果新版 OpenSSH 报 `no matching host key type found`，只对本次连接临时放开 RSA：

```bash
ssh -o HostKeyAlgorithms=+ssh-rsa admin@<switch-ip>
```

登录后提示符通常是 `<S5120>`。先确认设备身份，再执行查看命令。

### 日常查看

```text
display clock
display version
display interface brief
display ip interface brief
display vlan brief
display link-aggregation verbose
display ip routing-table
display lldp neighbor-information list
display ntp-service status
display logbuffer
```

- `display interface brief`：端口是否 up、速率和双工。
- `display vlan brief`：VLAN 是否存在、哪些端口属于它。
- `display link-aggregation verbose`：聚合成员是否 `Selected`，`Flag` 是否包含 `ACDEF`。`U` 表示未选中，先查两侧 LACP 参数、网线和光模块。
- `display ip routing-table`：默认路由和直连网段。
- `display lldp neighbor-information list`：端口对端设备，比面板标签可靠。
- `display ntp-service status`：时间是否同步。
- `display logbuffer`：端口 up/down、环路、ACL 拒绝和电源告警。

DHCP 和 ACL：

```text
display dhcp server pool
display dhcp server ip-in-use
display acl all
display ip policy-based-route
display stp brief
```

`display dhcp server ip-in-use` 看 VLAN 3714 的租约，地址池耗尽时用户拿不到 IP。`display acl all` 和 `display ip policy-based-route` 用于确认 ACL 和策略路由的匹配范围，修改前先确认设计意图。

### 备份配置

```text
display current-configuration
```

把完整输出保存到本地文件，按日期归档。修改前先备份，修改后确认无误再执行 `save` 写入启动配置。不要执行 `reset saved-configuration`，也不要在不了解影响时删除 VLAN。

### 配置模板

以下只是结构示例，端口、VLAN、地址必须按现场规划替换。执行前阅读[核心交换机](admin/switch.md)，并在维护窗口内操作。

```text
system-view
vlan <vlan-id>
quit

interface Vlan-interface<vlan-id>
 ip address <gateway-ip> <mask>
quit

interface Bridge-Aggregation <group>
 link-aggregation mode dynamic
quit

interface GigabitEthernet1/0/<port>
 port link-aggregation group <group>
quit

interface GigabitEthernet1/0/<port>
 port link-type trunk
 port trunk permit vlan <vlan-list>
 port trunk pvid vlan <pvid>
quit

ip route-static 0.0.0.0 0 <next-hop>
save
```

修改 GE1/0/47 时必须保留 VLAN 3704；修改聚合组成员时服务器和交换机两侧一起改。任何涉及上联、聚合口、默认路由的操作，都要先准备回滚命令。

## 出口路由器

【管理员】路由器运行 ImmortalWrt，使用 UCI 管理配置。SSH 只在用户网侧地址上监听，另一个地址是管理网接口，不提供 SSH。

```bash
ssh root@<router-user-ip>
```

登录后先看接口、路由和日志：

```bash
ip -br addr
ip route
ip -6 route
uci show network
uci show dhcp
uci show firewall
uci show wireless
logread | tail -100
```

- `ip route` 看默认路由和到实验室各网段的静态回程路由。
- `uci show network` 看接口和 VLAN 子接口配置。
- `uci show dhcp` 确认 DHCPv4 在 LAN 侧关闭，DHCPv6 和 RA 开启。
- `uci show firewall` 看 lan/wan 区域、masquerade 和转发规则。
- `logread` 看链路、认证和 dnsmasq 日志。

修改前备份：

```bash
cp /etc/config/network /etc/config/network.bak
cp /etc/config/dhcp /etc/config/dhcp.bak
cp /etc/config/firewall /etc/config/firewall.bak
```

修改后提交并只重载对应服务：

```bash
uci commit network
/etc/init.d/network reload
/etc/init.d/dnsmasq reload
```

不要用“重启整台路由器”来让配置生效。重启会中断所有用户，配置有误时还可能失去管理入口。DNS 别名修改后重载 dnsmasq 即可，不要编辑运行时生成的 `/tmp/resolv.conf.d/resolv.conf.auto`。

## BMC 带外管理

BMC 通过浏览器访问，不走 SSH：

```text
https://<bmc-ip>
```

BMC 使用自签名证书时浏览器会提示证书不受信任，确认地址正确后继续。登录后可以查看硬件状态、温度、风扇、电源、磁盘告警，打开远程控制台，远程开关机和挂载 ISO。

BMC 权限等同于物理接触服务器。关机前确认该物理机上运行的虚拟机：host50 关机同时影响控制节点、GPU 虚拟机 2 和 Cinder 后端；host51 关机影响 GPU 虚拟机 1 和另一套 Cinder 后端。不要用脚本对 BMC 批量尝试密码，失败次数过多可能锁定账号。

## 按现象查命令

先按现象定位层次，再执行对应命令。不要一次把所有命令都跑一遍，输出太多反而掩盖线索。

| 现象 | 先执行 | 下一步 |
|---|---|---|
| SSH 连接超时 | `ping <ip>`、`ssh -v <user>@<ip>`、`ip route` | 确认在实验室网络、IP 正确、网关可达。 |
| SSH `Permission denied` | `whoami`、`ssh -v <user>@<ip>` | 检查用户名、密码、账号是否开通，不要连续试错。 |
| SSH 主机密钥变化 | `ssh-keygen -F <ip>` | 联系管理员确认是否重装，不要直接删记录。 |
| `nvidia-smi` 找不到命令 | `hostname`、`nvidia-smi -L` | 确认登录的是 GPU 虚拟机，不是 CPU 虚拟机。 |
| 只看到一张显卡 | `nvidia-smi -L`、`lspci -nn \| grep -i nvidia` | 保留输出联系管理员，不要重装驱动。 |
| 显卡被占用 | `nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv` | 等待或联系占用者，不要 kill 别人的进程。 |
| `CUDA out of memory` | `nvidia-smi`、`nvidia-smi --query-compute-apps=...` | 减小 batch、清理自己的残留进程或换卡。 |
| 多卡比单卡慢 | `nvidia-smi topo -m` | 确认没有 NVLink，调整 batch、梯度累积或改单卡。 |
| 磁盘写满 | `df -h`、`df -i`、`du -sh <dir>` | 清理自己的缓存和旧数据，别删别人的文件。 |
| `conda: command not found` | `source /opt/miniconda3/etc/profile.d/conda.sh`、`conda --version` | 执行 `conda init bash` 后重新登录。 |
| `pip install` 权限不足 | `which python`、`which pip`、`conda env list` | 激活自己的环境，不要 `sudo pip`。 |
| 能 ping 通但不能解析域名 | `cat /etc/resolv.conf`、`dig <domain>`、`getent hosts <domain>` | 检查 DNS 配置，不要自行改网络。 |
| 端口连不上 | `ss -tulpn`、`nc -vz <host> <port>` | 确认服务是否监听、是否被防火墙挡住。 |
| Horizon 显示 ACTIVE 但连不上 | `ping <ip>`、`ssh -v <user>@<ip>` | 打开 Horizon 控制台看系统状态，不要直接重启。 |
| 宿主机服务异常 | `systemctl --failed`、`systemctl is-active ...`、`virsh list --all` | 记录影响范围，联系管理员处理。 |
| Cinder 卷异常 | `openstack volume show <volume>`、`vgs`、`lvs`、`iscsiadm -m session` | 先确认后端和挂载关系，不要删除 error 卷。 |
| 交换机端口不通 | `display interface brief`、`display link-aggregation verbose`、`display vlan brief` | 检查成员口、VLAN 允许列表和对端 bond0。 |
| 用户拿不到 IP | `display dhcp server ip-in-use`、`display vlan brief` | 检查 VLAN 3714、地址池和接入端口。 |
| 时间不同步 | `chronyc tracking`、`display ntp-service status` | 检查 NTP 源和 UDP 123，不要手动改时间。 |

更完整的故障处理流程见[运行与日常维护](admin/maintenance.md)、[常见疑难解答](user/faq.md)和[问题上报](user/report.md)。

## 危险命令与替代做法

下面这些命令不是不能用，而是必须先确认影响范围。没有把握时不要执行。

| 命令 | 风险 | 更安全的做法 |
|---|---|---|
| `rm -rf <path>` | 递归删除且不进回收站，路径写错会删掉整个目录。 | 先 `pwd`、`ls`，只删自己的文件；必要时先备份。 |
| `chmod -R 777 <dir>` | 把权限开放给所有人，破坏共享目录安全。 | 只改自己创建的文件，使用最小权限。 |
| `chown -R <user> <dir>` | 改变所有者，可能让别人无法访问。 | 联系管理员，不要批量改共享目录。 |
| `dd`、`mkfs`、`fdisk`、`parted` | 直接写块设备，可能破坏分区和文件系统。 | 确认设备名，先在测试环境验证；生产操作找管理员。 |
| `pvcreate`、`vgextend`、`lvremove` | 改 LVM 元数据，错误设备名会破坏 Cinder 卷。 | 先 `vgs`、`lvs`、`lsblk` 确认，维护窗口内操作。 |
| `systemctl restart <service>` | 中断服务，可能影响正在运行的任务。 | 先看 `status` 和日志，确认影响范围后再重启。 |
| `virsh destroy`、`virsh undefine` | 强制关机或删除虚拟机定义。 | 先通过 OpenStack 确认归属，优先正常关机。 |
| `openstack volume delete` | 删除卷不可逆。 | 确认没有挂载、不是系统盘、数据已备份。 |
| `iptables -F`、`nft flush ruleset` | 清空防火墙规则，可能暴露服务或断网。 | 不要在生产环境直接清空，先备份规则。 |
| `kill -9 <PID>` | 强制终止，进程来不及保存和清理。 | 先 `kill <PID>`，确认是自己的进程。 |
| `curl ... \| bash` | 执行来源不明的脚本。 | 先下载阅读，确认来源和内容再执行。 |
| `conda update`、`pip install`（在 base） | 改动所有用户共用的默认环境。 | 创建自己的环境，在环境内安装。 |

执行任何有写操作倾向的命令前，先问三个问题：

1. 路径对吗？用 `pwd`、`ls`、`echo` 再确认一次。
2. 有备份吗？重要数据先复制到另一个位置。
3. 只影响自己吗？会影响别人或共享资源时，先通知管理员。

## 命令与文档对照

| 想做的事 | 先看 |
|---|---|
| 登录 GPU 虚拟机、传文件、配 SSH | [账号与权限](user/account.md)、[数据与存储](user/storage.md) |
| 查显卡、指定 GPU、跑双卡任务 | [GPU 使用](user/gpu.md) |
| 清理磁盘、管理 Conda 环境 | [数据与存储](user/storage.md)、[常见疑难解答](user/faq.md) |
| 排查 SSH、显卡、磁盘、网络问题 | [常见疑难解答](user/faq.md) |
| 了解 VLAN、路由、DHCP、VXLAN | [网络架构](admin/network.md) |
| 查 OpenStack 服务、实例、卷 | [OpenStack 架构](admin/openstack.md)、[数据存储](admin/storage.md) |
| 查宿主机硬件和服务 | [物理计算资源](admin/compute.md)、[运行与日常维护](admin/maintenance.md) |
| 查交换机端口、聚合、VLAN | [核心交换机](admin/switch.md) |
| 查路由器接口、NAT、DNS | [实验室路由器](admin/router.md) |
| 做巡检、备份和变更 | [运行与日常维护](admin/maintenance.md) |
| 上报故障或安全事件 | [问题上报](user/report.md)、[风险评估与问题上报](admin/report.md) |

---

返回[手册首页](index.md)
