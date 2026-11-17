# 文件传输

文件传输是实验室日常工作中最常用的操作之一。本节会介绍几种常用的数据传输方式，从命令行到图形化工具，帮助你在本地电脑和实验室服务器之间高效、安全地传输文件。

本文涉及的工具链均围绕 SSH 体系（Secure Shell）及其衍生生态展开。在实际运维与远程传输中，SSH/SFTP 提供了底层的安全加密通道与身份认证机制；部分工具（如 rsync、WinSCP）虽支持专有服务或传统 FTP，但最推荐且最普遍的实践依然是走 SSH 隧道

下文示例用 `<user_id>` 表示自己的 Linux 账号，`<server_ip>` 表示服务器的 IP 地址。执行时换成自己的账号和实际要连接的机器。

## 选择传输方式

| 场景 | 建议 |
|---|---|
| 临时传几个小文件 | `scp` |
| 传整个目录、数据集或模型权重 | `rsync` |
| 传输中断后不想从头再来 | `rsync --partial` 或 `rsync -P` |
| 想交互式地浏览和挑选文件 | `sftp` |
| 不想用命令行 | WinSCP 等图形化工具 |
| 一边写代码一边偶尔传文件 | VS Code Remote-SSH, Zed 等 IDE 内置或插件 |

`scp` 和 `sftp` 在服务器和 Windows 10/11 上都自带；`rsync` 在 Windows 上需要额外准备，见下文。

## 传输前准备

开始前先确认三件事：

1. 能 SSH 登录目标机器：`ssh <user_id>@<server_ip>`。
2. 目标路径存在，并且属于自己。
3. 目标磁盘还有剩余空间：执行 `df -h`，重点看 `/` 和 `/data` 两行。

:::: tip
**传输前准备**
1. **压缩或打包**。零散的小文件先再传，速度和稳定性都会好很多：

::: code-group
```bash
# Linux/macOS
tar -czf project.tar.gz project/
```
```powershell
# Windows PowerShell
Compress-Archive -Path project -DestinationPath project.zip
```
:::

2. **校验文件完整性**。传完后对比校验值，可以确认文件完整：

::: code-group

```bash
# Linux/macOS
sha256sum project.tar.gz
```

```powershell
# Windows PowerShell
Get-FileHash -Algorithm SHA256 project.zip
```
:::
本地和服务器两边输出的哈希一致，说明内容没有在传输中损坏。

3. **解压文件**。传完后需要解压文件：

::: code-group
```bash
# Linux/macOS
tar -xzf project.tar.gz
```

```powershell
# Windows PowerShell
Expand-Archive -Path project.zip -DestinationPath .
```
:::

可以参考：

[GNU tar](https://www.gnu.org/software/tar/manual/tar.html)

[PowerShell Expand-Archive](https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.archive/expand-archive)

[PowerShell Compress-Archive](https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.archive/compress-archive)

::::

## `scp`

`scp`（secure copy）建立在 SSH 之上，语法和 `cp` 类似，适合一次性上传或下载少量文件。

基本格式：

```bash
# 1. 本地 → 远程（上传）
scp [选项] <本地源路径> <user_id>@<server_ip>:<远程目标路径>

# 2. 远程 → 本地（下载）
scp [选项] <user_id>@<server_ip>:<远程源路径> <本地目标路径>
```

示例：

```bash
# 上传单个文件到家目录
scp ./dataset.zip <user_id>@<server_ip>:~/

# 上传整个目录，-r 表示递归
scp -r ./project <user_id>@<server_ip>:~/projects/

# 从服务器下载文件
scp <user_id>@<server_ip>:/data/<user_id>/result.csv ./

# SSH 端口不是 22 时用 -P（大写）
scp -P 2222 ./dataset.zip <user_id>@<server_ip>:~/

# 文件名或路径中有空格时用引号
scp "./my folder/dataset.zip" <user_id>@<server_ip>:~/

# 指定私钥文件登录
scp -i ~/.ssh/id_rsa ./dataset.zip <user_id>@<server_ip>:~/
```

常用选项：

| 选项 | 作用 |
|---|---|
| `-r` | 递归复制整个目录。 |
| `-P 端口` | 指定 SSH 端口；注意是大写 `P`。 |
| `-p` | 保留文件的修改时间、访问时间和权限。 |
| `-C` | 传输时压缩；对文本有效，对已压缩文件帮助不大。 |
| `-i 私钥` | 指定登录用的私钥文件。 |

::: warning 覆盖、父目录和增量
- `scp` 会直接覆盖目标位置的同名文件，执行前确认路径没有写错。
- 目标父目录必须存在。上传到 `~/projects/` 前，先在服务器上执行 `mkdir -p ~/projects`。
- `scp` 不做增量传输。大文件传到一半断开后通常要从头再传，这类场景改用 `rsync`。
:::

::: warning Windows 路径注意事项
- Windows 10/11 自带 OpenSSH 客户端，可以用 `Get-Command scp` 确认。
- 不要把 `C:\...` 直接当作源路径，冒号可能被当成远程主机的分隔符，先 `cd` 到文件所在目录，再用 `./文件名` 最稳妥。
:::

## `rsync`

`rsync`（remote sync）只传输源和目标之间有差异的部分。第一次同步仍然是全量，之后只传修改过的文件，适合代码目录、数据集和模型权重的反复同步。

基本格式：

```bash
rsync -avz --progress <本地路径> <user_id>@<server_ip>:<远程路径>
```

示例：

```bash
# 上传目录内容；注意源路径末尾的 /
rsync -avz --progress ./project/ <user_id>@<server_ip>:~/projects/project/

# 从服务器下载结果目录到本地
rsync -avz --progress <user_id>@<server_ip>:/data/<user_id>/results/ ./results/

# 先演练，不实际传输
rsync -avz --dry-run --progress ./project/ <user_id>@<server_ip>:~/projects/project/

# 排除 .git 和 Python 缓存
rsync -avz --progress --exclude '.git/' --exclude '__pycache__/' \
  ./project/ <user_id>@<server_ip>:~/projects/project/

# SSH 端口不是 22
rsync -avz -e "ssh -p 2222" ./dataset.zip <user_id>@<server_ip>:~/
```

常用选项：

| 选项 | 作用 |
|---|---|
| `-a` | 归档模式，递归并保留权限、时间、符号链接等。 |
| `-v` | 显示传输过程。 |
| `-z` | 传输时压缩。 |
| `--progress` | 显示每个文件的进度。 |
| `-h` | 以易读单位显示文件大小。 |
| `-n` / `--dry-run` | 只显示会做什么，不实际传输。 |
| `--partial` | 中断后保留已传部分，下次可以续传。 |
| `--delete` | 删除目标中源没有的文件；危险，先演练。 |
| `-e "ssh -p 端口"` | 指定 SSH 端口或其他 SSH 参数。 |

### 源路径末尾的 `/` 很关键

| 写法 | 结果 |
|---|---|
| `rsync -av ./project/ user@host:~/projects/project/` | 只复制 `project` 里面的内容。 |
| `rsync -av ./project user@host:~/projects/` | 连同 `project` 目录本身一起复制。 |

不确定时先加 `--dry-run`，看输出里的路径是否符合预期。目标父目录也要存在；`rsync` 可以创建最后一级目录，但不会自动补齐整条路径，必要时先 `mkdir -p`。

### 断点续传与限速

大文件传输中断后，重新执行同一条命令并加上 `--partial`（或直接用 `-P`，等价于 `--partial --progress`），`rsync` 会复用已经传完的部分：

```bash
rsync -avz -P ./checkpoints/ <user_id>@<server_ip>:~/models/checkpoints/
```

实验室网络由多人共享，传输大文件时可以限制带宽：

```bash
rsync -avz --progress --bwlimit=10000 ./dataset/ <user_id>@<server_ip>:~/datasets/
```

`--bwlimit=10000` 约等于每秒 10 MB。需要更快或更慢时调整这个数值，不要长时间占满出口带宽。

::: warning 实验室I/O有限
受实验室网络和服务器磁盘的限制，传输大文件时请尽量避开高峰时段，避免占满带宽或 I/O。传输中断后不要反复从头 `scp`，改用 `rsync -P` 续传。
:::

### 使用 `--delete` 前先演练

`--delete` 会让目标目录和源目录完全一致：目标中多出来的文件会被删除。只在确认目标目录是自己管理的目录时使用，并且先加 `--dry-run`：

```bash
rsync -avz --dry-run --delete ./project/ <user_id>@<server_ip>:~/projects/project/
```

确认输出中没有要保留的文件被列入删除列表，再去掉 `--dry-run` 正式执行。

## `sftp`：交互式传输

如果不想记 `scp` 的参数，可以用 `sftp` 进入交互式会话：

```bash
sftp <user_id>@<server_ip>
```

进入后常用命令：

```text
pwd                 查看服务器当前目录
ls                  列出服务器文件
lcd C:/Users/me     切换本地目录
put dataset.zip     上传文件
put -r project      上传目录
get result.csv      下载文件
bye                 退出
```

`sftp` 同样基于 SSH，适合偶尔传几个文件；大量文件或整个数据集仍然建议用 `rsync`。

## 在 Windows 上传输

Windows 自带的 `scp`、`sftp` 可以直接使用。`rsync` 需要额外安装，最方便的方式是通过 WSL。

### 用 WSL 运行 `rsync`

安装 WSL：

```powershell
wsl --install
```

安装完成后进入 WSL，安装 rsync：

```bash
sudo apt update
sudo apt install -y rsync
```

WSL 中访问 Windows 文件用 `/mnt/c/Users/<你的用户名>/...`，例如：

```bash
rsync -avz --progress /mnt/c/Users/me/Downloads/project/ \
  <user_id>@<server_ip>:~/projects/project/
```

也可以在 MSYS2 或 Cygwin 中安装 `rsync`，但 WSL 更接近服务器上的 Linux 环境，路径和权限问题更少。

### WinSCP

WinSCP 是 Windows 上常用的免费 SFTP/SCP 客户端，适合拖拽上传、下载和目录同步。它本质上仍然通过 SSH/SFTP 登录，账号、密码、密钥和网络限制与命令行相同。

使用步骤：

1. 从官网 <https://winscp.net/> 下载安装，不要用来路不明的安装包。
2. 新建站点，文件协议选择 **SFTP**，主机填 `<server_ip>`，端口 `22`，填写自己的用户名和密码。
3. 第一次连接会提示确认服务器主机密钥，确认地址无误后接受。
4. 左侧是本地目录，右侧是服务器目录；可以直接拖拽文件，也可以右键上传或下载。
5. 需要同步目录时使用“同步”功能，先看清同步方向和预览结果，避免把服务器上的文件删掉。

::: warning 注意事项
- 优先使用 SFTP；SCP 是较老的协议，功能少。
- 支持 SSH 密钥；如果密钥格式不被识别，可以用 PuTTYgen 转换。
- 不要在共用电脑上保存密码；使用密钥或每次手动输入。
- 大文件传输不如 `rsync` 稳，断线后可能需要重传；几十 GB 的数据集优先用 `rsync`。
:::

### 其他常用工具

| 工具 | 平台 | 特点 |
|---|---|---|
| WinSCP | Windows | 免费的 SFTP/SCP 客户端，支持拖拽、同步和远程编辑。 |
| FileZilla | Windows/macOS/Linux | 跨平台双栏文件管理器，站点管理方便；连接时选 SFTP，不要用明文 FTP。 |
| MobaXterm | Windows | 终端和 SFTP 文件面板放在同一窗口，适合同时敲命令和传文件。 |
| VS Code Remote-SSH | 跨平台 | 直接在远程资源管理器里拖拽少量文件；大数据集仍建议用 `rsync`。 |
| Cyberduck | macOS/Windows | macOS 上常用的图形化 SFTP 客户端。 |

## 传输失败

| 现象 | 先检查 |
|---|---|
| `Permission denied` | 账号和密码是否正确；目标目录是否有写权限，是不是写到了别人的目录或 root 拥有的路径。 |
| `No space left on device` | `df -h` 看是哪块盘满，按[数据与存储](storage.md)清理自己的文件。 |
| 目标目录不存在 | 先在服务器上 `mkdir -p`；`/data` 下没有分配目录时联系管理员。 |
| `scp: command not found` | Windows 上确认 OpenSSH 客户端已安装；Linux 上确认 `openssh-client` 存在。 |
| 传到一半断开 | 改用 `rsync -P` 重新执行，不要反复从头 `scp`。 |
| 传输速度很慢 | 小文件过多时先打包；大文件用 `--bwlimit` 控制带宽；确认没有同时占满共享网络。 |
| `Connection timed out` | 是否在实验室局域网、IP 是否正确，排查方法见[常见疑难解答](faq.md)。 |

## 传输规范

- 只往自己的家目录或管理员分配的数据目录写入，不要写 root 拥有的路径。
- 不覆盖、不移动、不删除他人的文件；同步前确认目标路径。
- 不把与实验无关的大文件传到服务器，不用大量文件占满系统盘。
- 不把服务器当作网盘、中转站或跳板机；需要使用代理时先获许可，见[网络与代理](proxy.md)。
- 不通过传输工具搬运违法违规内容。

完整规则见[使用规范](rules.md)。

---

返回[用户视角总目录](index.md) ｜ 返回[手册首页](../index.md)
