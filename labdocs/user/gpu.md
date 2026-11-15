# GPU 使用

## 机器基本配置

两台 GPU 虚拟机各配置两张 NVIDIA GeForce RTX 4090。每张卡有 24 GiB 显存，两张卡之间没有 NVLink，跨卡通信走 PCIe（Peripheral Component Interconnect Express，主板上的高速外设总线）。显卡通过 PCI 直通完整分配给虚拟机，因此虚拟机里的 `nvidia-smi` 能看到两张真实的 4090。

登录后先确认显卡：

```bash
nvidia-smi
```

输出中应能看到两张 `NVIDIA GeForce RTX 4090`，以及驱动版本、显存总量和当前进程。只看显卡列表可以用：

```bash
nvidia-smi -L
```

如果命令不存在，或者只看到一张卡，先确认自己登录的是 `172.16.33.91` 或 `172.16.33.247`，而不是普通 CPU 虚拟机。GPU 虚拟机才有显卡。

## 显式指定显卡

平台要求每个任务在启动前明确指定使用哪张显卡。原因是两张卡由多人共用，如果程序默认占用所有可见显卡，可能和别人正在运行的任务冲突。

### 单卡任务

在命令前设置 `CUDA_VISIBLE_DEVICES`：

```bash
CUDA_VISIBLE_DEVICES=0 python train.py
```

或者在 Python 脚本开头设置，但必须放在 `import torch` 之前：

```python
import os
os.environ["CUDA_VISIBLE_DEVICES"] = "0"

import torch
print(torch.cuda.is_available())
print(torch.cuda.device_count())
```

`CUDA_VISIBLE_DEVICES` 是 CUDA（NVIDIA 的 GPU 计算平台和编程接口）提供的环境变量，用来限制程序能看到哪些显卡。设置为 `0` 时，程序只看到 0 号卡；设置为 `1` 时只看到 1 号卡；设置为 `0,1` 时两张都可见。

### 双卡任务

需要两张卡时，明确写出两张卡的编号：

```bash
CUDA_VISIBLE_DEVICES=0,1 torchrun --standalone --nproc_per_node=2 train.py
```

`torchrun` 是 PyTorch 提供的分布式启动工具，`--nproc_per_node=2` 表示每个节点启动两个进程。每个进程通常负责一张卡，但脚本里仍要显式设置设备，例如用 `torch.cuda.set_device(local_rank)` 或 `device = f"cuda:{local_rank}"`，不能假设框架会自动把每个进程绑到不同的卡上。由于两张 4090 之间没有 NVLink，双卡训练的梯度同步会走 PCIe，扩展效率取决于模型大小和通信量。不要假设双卡一定比单卡快两倍。

查看两张卡之间的互联方式：

```bash
nvidia-smi topo -m
```

如果两张卡之间显示 `SYS` 或 `PHB`，说明通信经过 PCIe 或主板芯片组；没有 `NVLink` 字样是正常的。

## 一张卡只跑一个任务

同一张显卡同一时间只允许一个计算任务。不要两个人同时往一张卡上跑任务，也不要在自己的任务还没结束时再启动第二个任务抢同一张卡。

提交任务前先看当前占用：

```bash
nvidia-smi
```

输出中的 `Processes` 部分会列出每个进程的 PID、名称和占用显存。也可以只看计算进程：

```bash
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
```

如果两张卡都有进程在跑，等待或联系正在使用的同学，不要直接 `kill` 别人的进程。确认某张卡空闲后再启动自己的任务。

长时间盯着显存可以用：

```bash
watch -n 2 nvidia-smi
```

按 `Ctrl+C` 退出。`watch` 只是重复执行命令，不会影响其他人的任务。

## 及时释放资源

实验结束、程序报错或被中断后，必须确认进程已经退出、显存已经释放：

```bash
nvidia-smi
```

如果自己的进程还在，先正常结束：

```bash
kill <PID>
```

进程不响应时再用：

```bash
kill -9 <PID>
```

`kill` 是向进程发送终止信号，`-9` 是强制终止。只对自己启动的进程使用，不要对别人的 PID 操作。

长期空占显存、跑完不退出、用死循环脚本占资源，都属于违反使用规范的行为。管理员可以强制终止相关进程。

注：有关kill命令，可以参见 [Linux kill命令详解](https://www.runoob.com/linux/linux-comm-kill.html)。

## Python 和 Conda 环境

服务器已经统一安装 Miniconda，位置是 `/opt/miniconda3`。Conda 是 Python 环境和包管理器，可以在同一台机器上创建多个相互隔离的 Python 环境。不需要自己再装一套 Conda。

第一次使用前，把 Conda 接入当前 shell：

```bash
/opt/miniconda3/bin/conda init bash
source ~/.bashrc
```

之后可以用 `conda --version` 检查是否生效。创建个人环境：

```bash
conda create -n myenv python=3.10 -y
conda activate myenv
```

普通用户的环境默认创建在自己的 `~/.conda/envs` 下，不会写入 `/opt/miniconda3/envs`，也不会改变全局 `base`。`myenv` 是环境名称，可以换成自己的项目名。环境创建后，用 `pip` 或 `conda` 安装依赖。PyTorch、TensorFlow 等深度学习框架的安装命令建议从官网选择与驱动匹配的版本，不要直接复制来源不明的安装脚本。

### 不要修改 base 环境

`base` 是 Conda 的默认环境，所有用户共用。禁止在 `base` 下执行：

```bash
conda update
conda install
pip install
```

也不要在 `base` 下升级 Python、CUDA 或系统库。需要新包时创建自己的环境，在环境内安装。把包装进 `base` 会改变所有用户看到的环境，可能导致别人的代码无法运行。

### 从个人 Conda 迁移到全局 Conda

如果之前在家目录装过个人 Conda，建议迁移到 `/opt/miniconda3`，减少重复占用。顺序是：先导出环境，再删除个人 Conda，最后接入全局 Conda。

```bash
# 1. 导出个人环境（把 myenv 换成实际环境名）
conda env export -n myenv > myenv.yml

# 2. 取消个人 Conda 的自动加载
~/miniconda3/bin/conda init --reverse

# 3. 删除个人 Conda 和残留配置
rm -rf ~/miniconda3
rm -rf ~/.condarc ~/.conda ~/.continuum

# 4. 接入全局 Conda
/opt/miniconda3/bin/conda init bash
source ~/.bashrc

# 5. 重建环境
conda env create -f myenv.yml
```

如果你的个人 Conda 不在 `~/miniconda3`，把路径换成 `which conda` 显示的实际路径。删除前确认 `myenv.yml` 已经生成，并且里面包含需要的依赖。不要直接删除自己没有备份的环境。

### 包管理边界

可以在自己的 Conda 环境或家目录中安装 Python 包、R 包、Node.js 包。不能使用 `sudo apt install`、`sudo apt upgrade` 修改系统级软件，也不能替换系统自带的 CUDA、驱动或底层库。

如果某个软件只能通过 `apt` 安装，联系管理员说明用途，由管理员评估后处理。不要自己编译内核模块、替换驱动或修改 `/usr/lib` 下的系统库。

## 高负载任务先报备

以下情况需要提前联系管理员或在实验室负载表中报备：

- 预计连续运行超过数小时的高 GPU 占用任务。
- 使用两张卡的多卡训练。
- 高 CPU 或高内存负载任务，可能影响同机其他用户。
- 大规模数据读写、批量下载或批量文件生成。
- 需要长期驻留的服务、Web 服务或数据库。

报备不是形式。管理员需要知道谁在用什么资源，避免多个高负载任务同时启动把机器拖慢，也方便在故障时判断影响范围。

实验室提供在线负载表用于查看当前使用情况：[服务器在线使用](https://ecnw9f4vkfa6.feishu.cn/wiki/V66jwDwT3iEQBMk4zQ3ci5LmnGd?from=from_copylink)。如果链接无法访问，直接联系管理员。

## 显卡和驱动由管理员维护

不要在虚拟机内更新、卸载或替换 NVIDIA 驱动，也不要安装新的 CUDA Toolkit 覆盖系统版本。驱动和 CUDA 是宿主机直通环境的一部分，用户自行修改可能导致整台虚拟机的显卡不可用。

如果代码需要特定 CUDA 版本，优先在 Conda 环境中安装对应的运行时包，例如 PyTorch 自带的 CUDA 运行时，而不是替换系统驱动。需要系统级升级时联系管理员。

注：如果你在虚拟机里执行 `nvidia-smi` 时看到的驱动版本和宿主机不一致，或者是看不到显卡，可能是宿主机驱动有所改动。请联系管理员。机器可能需要重启或重新分配显卡，才能恢复正常。
## GPU 使用红线

- 禁止多人同时抢占同一张 GPU。
- 禁止不指定 GPU 设备直接提交任务。
- 禁止长期空占 GPU 显存。
- 禁止实验结束后不清理残留进程。
- 禁止在未报备的情况下运行高 GPU、高 CPU 或高内存负载任务。
- 禁止通过异常脚本、死循环程序等方式长期占用服务器资源。
- 禁止修改驱动环境，包括 `nvidia-driver`、`CUDA Toolkit` 等底层运行环境。
- 禁止在服务器内安装 Claude Code、OpenCode 等 AI 代理工具。

完整规则见[使用规范](rules.md)。


---

返回[用户视角总目录](index.md) ｜ 返回[手册首页](../index.md)

