# 通过 SSH 反向代理使用网络服务

::: warning 使用须知
[使用规范](rules.md)目前禁止**私自配置代理**、**翻墙**以及**把服务器当作跳板**。没有获得许可时，不要按本页操作。

也就是说，禁止在**服务器**上面使用：

1. 任何代理软件（如 Shadowsocks、V2Ray、Clash、Tor、Mihomo 等）；
2. 任何 VPN 软件（如 OpenVPN、WireGuard 等）；
3. 使用 `ssh -J` 或 `ProxyJump` 连接其他服务器；
:::

服务器位于实验室内网，无法直接访问某些私有资源，或者是受到限制的境外网站。为了在服务器上运行需要访问这些资源的程序，通常有两种方式：

1. 使用国内的镜像源和/或相似的替代服务，尽量避免访问境外资源。
2. 通过 `scp` 或 `rsync` 把本地下载的资源上传到服务器，再在服务器上使用。

通常上述两种情况能够覆盖绝大部分的使用场景。当确有需要（如需要访问特定的境外数据库或 API）时，可以使用 SSH 反向代理。

访问的路径如下：

服务器程序 → 服务器 `127.0.0.1:portS` → SSH 隧道 → 本地 `127.0.0.1:portC` → 外部服务。

在介绍 SSH 反向代理之前，先了解上述的前两种方式。

## 国内镜像源介绍

国内常用的镜像源包括：

- **清华大学开源软件镜像站**：https://mirrors.tuna.tsinghua.edu.cn/
- **阿里云开源镜像站**：https://developer.aliyun.com/mirror/
- **华为云开源镜像站**：https://mirrors.huaweicloud.com/
- **中科大开源软件镜像站**：https://mirrors.ustc.edu.cn/

这些镜像站提供了大量的开源软件和包的镜像，可以有效提高下载速度和稳定性。

[LinuxMirrors](https://linuxmirrors.cn/) 是GNU/Linux 更换系统软件源脚本及 Docker 安装与换源脚本。（仅限root）

## `scp` 和 `rsync`

参见[文件传输](transfer.md)。

## SSH反向代理

下面介绍如何使用 SSH 反向代理在服务器上访问外部网络服务。通过在本地电脑上建立 SSH 隧道，将服务器的请求转发到本地代理，再由本地代理访问外部服务。

## 使用前确认

开始前确认以下条件：

- 本地电脑能通过 SSH 连接服务器，并且本地代理已经开启。
- 在代理软件设置中确认 HTTP 或 Mixed 监听端口。Mixed 表示同一个端口同时接受 HTTP 和 SOCKS 两种代理协议；只支持 SOCKS 的端口不能当作 HTTP 代理使用。
- 服务器允许 SSH 远程端口转发。

::: warning 尽量做临时设置
不要把临时代理写入 `~/.bashrc`、`~/.profile` 或 Conda 自动激活脚本。只在需要访问外网的当前终端中设置，使用结束后立即取消。否则，如果本地未打开相应服务，则服务器上的程序会报连接失败，甚至可能误以为外网服务不可用。下面的表格展示了不同配置方式的作用范围和结束后的状态：
| 配置方式 | 影响范围 | 结束后的状态 |
|---|---|---|
| Bash 中临时 `export` | 当前 Bash 及其后启动的子进程。 | 新的独立会话不继承；现有子进程需单独处理。 |
| Python 客户端参数 | 通过该客户端发出的请求。 | 不改变父 Bash 的代理配置。 |
| Python 中 `os.environ` | 当前 Python 及其后启动的子进程。 | 普通脚本结束后不影响父 Bash；Notebook 内核会保留。 |
| 写入 `~/.bashrc` | 以后读取该文件的交互式 Bash。 | 会重复启用，不适合依赖本机隧道的临时代理。 |
:::


下文均为通用示例，请按实际情况替换账号、地址和端口。

`portS` 表示**服务器**（SSH server）上的映射端口，`portC` 表示**本地电脑**（SSH client）上的代理端口。两者都是占位符，实际使用时换成具体数字。

| 参数 | 占位符 | 含义 |
|---|---|---|
| SSH 账号与地址 | `<user_id>@<server_ip>` | 替换为自己的账号和服务器内网地址。 |
| 本地代理端口 | `portC` | 本地电脑上 HTTP 或 Mixed 的监听端口。 |
| 服务器映射端口 | `portS` | 服务器上由 SSH 临时创建的环回监听端口。 |

::: tip S 和 C 指的是谁
这里的 S/C 按 **SSH 角色**命名：运行 `ssh` 命令的本地电脑是 SSH client，接收连接的 GPU 服务器是 SSH server。

注意：不要和 HTTP 代理的角色混淆：本地代理软件才是 proxy server，服务器上发起请求的程序是 proxy client，方向正好相反。
:::

## 调查服务器端口

同一台虚拟机上的 `127.0.0.1` 由所有用户共用，不能假设某个端口一定是空闲的。建立隧道前，先在服务器上确认候选端口没有被别人监听。`ss` 用来查看套接字，`-l` 只看监听状态，`-t` 只看 TCP，`-n` 直接显示端口数字。

查看当前所有 TCP 监听端口：

```bash
ss -ltn
```

加 `-p` 可以显示进程，但普通用户通常只能看到自己的进程。其他用户的监听仍会出现在列表里，只是进程列为空；进程列为空不代表端口没有主人。

检查准备使用的端口：

```bash
ss -H -ltn 'sport = :portS'
```

`-H` 去掉表头。没有输出表示当前没有程序监听这个端口；只要出现一行，就换一个端口，不必判断它绑定在哪个地址。

::: warning 不要用 curl 或 nc 探测
`curl`、`nc` 连接候选端口时，如果该端口属于别人的隧道，请求会真的经过对方的电脑。用 `ss` 被动查看即可，不要主动发起连接。
:::

选端口时避开两类：

- `1024` 以下的知名端口需要 root 才能绑定。
- 系统的临时端口范围。Linux 会把这段端口临时分配给对外连接的客户端，监听端口落在里面可能出现偶发冲突。查看范围：

```bash
cat /proc/sys/net/ipv4/ip_local_port_range
```

输出通常是 `32768 60999`。给 `portS` 选值时让它落在这个范围之外，例如 `20000`–`30000`；同时避开 `8080`、`8888` 等常见 Web 端口。

需要自动挑一个当前空闲的端口，可以执行：

```bash
for p in $(shuf -i 20000-30000 -n 20); do
  if [ -z "$(ss -H -ltn "sport = :$p")" ]; then
    echo "候选端口：$p"
    break
  fi
done
```

把选定的端口记下来，后面的 `-R`、环境变量和 Python 配置都要使用同一个值。

::: tip 检查通过不等于一定能绑定
`ss` 只反映检查那一刻的状态。其他人可能在你建立隧道前占用同一个端口，最终的判断标准是 `ssh -R` 是否绑定成功。提示 `remote port forwarding failed` 时换一个端口重试，不要终止别人的进程。
:::

::: info TCP/UDP 端口的唯一性
通常，在同一台主机、同一个网络协议（TCP 对 TCP / UDP 对 UDP）下，同一本地 IP 地址的同一端口只能被一个 Socket 绑定监听（Bind），防止内核在分发报文时产生二义性。
:::

## 在本地建立反向 SSH 隧道

在本地 PowerShell、CMD 或 macOS／Linux 终端执行以下单行命令：

```bash
ssh -N -T -R 127.0.0.1:portS:127.0.0.1:portC <user_id>@<server_ip>
```

参数含义：

- `-R` （Remote）表示远程端口转发：在**服务器**上监听一个端口，再把连接转回**本地电脑**。习惯上也把这种方式叫作反向隧道或反向代理。第一个 `127.0.0.1:portS` 属于服务器，第二个 `127.0.0.1:portC` 属于本地电脑。
- `-N -T` 只建立隧道，不打开远程 Bash，也不分配终端。其中，`-N` 表示不执行远程命令，`-T` 表示不分配伪终端。两者组合可以避免在服务器上打开一个交互式 shell。
- 认证成功后窗口保持等待、没有命令提示符，是正常现象。

保留这个 SSH 窗口，并保持本地代理运行。另开一个 SSH 会话进行后续操作。注意：服务器 SSH 端口不是 22 时，额外添加 `-p 实际端口`。

映射端口默认只绑定在服务器的 `127.0.0.1` 上，因此只有服务器本机可以使用，局域网内其他机器访问不到。不要为了“方便”把它改成 `0.0.0.0` 或删除地址前的 `127.0.0.1`，否则同网段的其他设备也能借用你的代理。

::: tip 端口冲突
服务器是多人共用的，同一个 `127.0.0.1:portS` 同一时间只能被一个隧道占用。如果提示 `remote port forwarding failed`，说明端口已被其他连接占用。换一个端口重试，不要终止不属于自己的进程。
:::

### 多用户环境会不会影响别人

服务器上的 `127.0.0.1` 属于整台机器，不是每个用户各自一份。需要区分两件事：

- **不会自动接管别人的流量。** 代理不是透明网关，Linux 不会因为某个端口正在监听，就把其他程序的请求转过去。只有显式把代理地址写成 `127.0.0.1:portS` 的程序才会使用这条隧道，例如设置了 `http_proxy` 环境变量、执行了 `curl --proxy`，或在 Python 客户端里配置了 `proxy`。你的 `export` 只影响当前 shell 及其子进程，其他用户的 shell、已经运行的程序和 systemd 服务都不会继承。
- **端口本身没有用户隔离。** 默认情况下，同一台服务器上的任何用户都能连接 `127.0.0.1:portS`。如果别人也把代理指向这个端口，他的请求就会经过你的 SSH 隧道，从你的本地网络出口访问外部服务，并占用你的带宽。反过来，如果你连接的是别人建立的同端口隧道，你的流量也会经过对方的电脑。这是真实存在的隐私和合规风险。

不过，端口冲突时，后建立的隧道会绑定失败，不会出现两个隧道同时抢一个端口、流量随机分流的情况。但如果对方没有建立隧道，只是把代理指向了这个端口，就不会报错，而是直接使用你的隧道。

隧道建立成功后，再确认监听地址和归属：

```bash
ss -ltnp 'sport = :portS'
```

输出应为 `127.0.0.1:portS`，并在进程列显示自己的 `sshd`。如果地址是 `0.0.0.0`、`*`，说明绑定范围超出预期，立即关闭隧道并检查命令。**如果进程列不是自己的 `sshd`，说明端口实际属于别人，也应立即关闭**。

查看当前有哪些连接正在使用这条隧道：

```bash
ss -tnp state established '( sport = :portS )'
```

正常情况下只应看到自己的测试连接。发现陌生连接时，立即关闭隧道、更换端口，并报告管理员；不要终止别人的进程。

`portS` 只是占位符，每次使用前都要按[调查服务器端口](#调查服务器端口)确认。实际使用时选一个不常见的高位端口，并且只在需要时开启隧道。本地代理如果支持认证，也应开启认证，不要因为连接来自 `127.0.0.1` 就默认可信。

## 启用临时代理

在真正要启动下载、Python 或实验任务的那个服务器 Bash 中执行。其他已经打开的终端不会自动获得这些变量。

```bash
export http_proxy=http://127.0.0.1:portS
export https_proxy="$http_proxy"
export HTTP_PROXY="$http_proxy"
export HTTPS_PROXY="$http_proxy"
export no_proxy=localhost,127.0.0.1,::1
export NO_PROXY="$no_proxy"
```

同时设置大小写形式，是为了兼容读取不同变量名的工具。`NO_PROXY` 让访问本机服务时直连；如果需要访问其他内网服务，把对应的主机名或地址补进列表。

`HTTPS_PROXY` 使用 `http://`，是因为连接的是本地 HTTP 代理，目标网站本身仍然可以是 HTTPS。代理只负责建立连接，不改变目标站点的加密方式。

### 验证连接

这里使用 OpenAI 的模型列表接口作为示例。如果是其他服务，请自行使用其他命令。

```bash
curl -I --connect-timeout 10 --max-time 20 \
  https://api.openai.com/v1/models
```

其中，未携带 API Key 时，典型响应如下；HTTP 版本可能不同。

```text
HTTP/1.1 200 Connection established

HTTP/1.1 401 Unauthorized
```

第二个状态码 `401` 表示请求已经到达需要鉴权的接口。它能验证网络链路，但不代表 API Key、模型权限或额度已经可用。只有 `200 Connection established` 还不够，它只说明 HTTP 代理接受了 `CONNECT` 请求，不能证明目标网站真的可达。

连通性确认后，在同一个 Bash 中启动任务。由此启动的程序会继承代理变量；已经运行的程序不会因为后来执行 `export` 而自动更新，需要重启后才会读取新配置。

## 取消临时代理

不要把上面的 `export` 命令追加到 `~/.bashrc`。否则每次新开终端都会自动指向这个代理；本地代理或 SSH 隧道没开时，依赖它的联网命令就可能报连接失败。

如果下列变量都是本次临时设置的，可以在当前 Bash 中清除：

```bash
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
unset all_proxy ALL_PROXY no_proxy NO_PROXY
```

也可以直接退出当前 Bash，之后重新建立一个独立的 SSH 会话。只要启动文件里没有持久化设置，新的独立会话就不会因为本次 `export` 而继续使用该代理。

::: warning 后台任务和 Notebook
已经启动的后台任务、复用的 tmux 会话或 Notebook 内核可能仍保留旧环境。在当前 Bash 中 `unset` 或关闭终端，不会反向清除这些进程中的变量。需要在对应进程中清除，或重新启动该程序。
:::

## 在 Python 程序中使用代理

Python 的特点是可以把代理配置限定在程序或客户端对象中，不自动修改父 Bash。为了减少对其他命令的影响，建议把代理显式配置在确实需要外网访问的 HTTP 客户端上。

在自己的 Python 环境中使用已安装的 HTTPX，运行以下示例（仍以OpenAI作为示例）：

```python
import httpx

with httpx.Client(
    proxy="http://127.0.0.1:portS",
    trust_env=False,
    timeout=20.0,
) as client:
    response = client.get(
        "https://api.openai.com/v1/models"
    )
    print(response.status_code)
```

`proxy` 指定该客户端使用的代理；`trust_env=False` 使它不再读取环境变量中的其他代理设置。示例不携带 Key，返回 `401` 是正常的连通性结果。HTTPX 当前的参数名是 `proxy`，旧版本使用 `proxies`，以安装版本为准。

这个客户端只用于需要代理的外部请求。访问本机或内网服务时，使用另一个不配置 `proxy` 的客户端；显式 `proxy` 不应被当作会自动遵循 `NO_PROXY` 的全局配置。

在 Python 中配置代理，不会解决隧道断开或本地代理未开启的问题。只要请求被配置为经过该代理，代理不可用时仍然会连接失败。

在脚本中通过 `os.environ` 设置代理，只修改当前 Python 进程以及之后启动的子进程，不会反向修改启动它的 Bash。如果使用 Notebook，同一内核会继续保留这些设置，直到主动清除或重启内核。

## 可选：SSH 连接别名

在本地 `~/.ssh/config` (Linux, macOS) 或 `%USERPROFILE%\.ssh\config` (Windows) 中添加独立别名。它只保存 SSH 连接规则，不会设置服务器 Bash 的代理变量。

```text
Host gpu-proxy
    HostName <server_ip>
    User <user_id>
    Port 22
    RemoteForward 127.0.0.1:portS 127.0.0.1:portC
    ExitOnForwardFailure yes
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

把示例地址替换为服务器内网地址，然后在本地执行：

```bash
ssh -N -T gpu-proxy
```


## 常见问题排查

| 现象 | 优先检查 |
|---|---|
| `127.0.0.1:portS Connection refused` | 在服务器检查该端口是否监听。通常是隧道未建立、已断开或端口写错。SSH 进程仍在不等于转发仍有效。 |
| `remote port forwarding failed` | 检查端口是否被其他连接占用，或服务器是否禁止远程转发。不要终止不属于自己的进程。 |
| 连接超时或只有 `CONNECT 200` | 分别检查本地代理、SSH 链路和目标服务；确认看到目标接口的最终 HTTP 状态码。 |
| `curl` 能通但 Python 不通 | 确认当前进程继承了代理变量，再检查 HTTP 库是否覆盖了这些配置。 |

服务器端检查监听和强制指定代理测试：

```bash
ss -ltn 'sport = :portS'
curl -I --proxy http://127.0.0.1:portS \
  --connect-timeout 10 --max-time 20 https://api.openai.com/v1/models
```

更换映射端口时，同步修改 `-R`、环境变量和 Python 配置。服务器策略不允许转发时，联系管理员处理，不要尝试绕过。

## 使用规范

- 只在管理员许可的范围内使用，不把它当作绕过网络限制的手段。
- 不在服务器上安装代理客户端，不修改 SSH、防火墙、DNS 或路由配置。
- 不把服务器作为网络代理、跳板机或中转节点供他人使用。
- 不长时间保持空闲隧道；用完立即关闭 SSH 窗口并清理环境变量。
- 不占用不属于自己的端口，不终止他人的 SSH 或转发进程。

完整规则见[使用规范](rules.md)。

## 参考资料

1. [OpenSSH 端口转发与 `ssh_config`](https://man.openbsd.org/ssh_config)
2. [Bash 环境变量与继承](https://www.gnu.org/software/bash/manual/html_node/Environment.html)
3. [`curl` 代理环境变量](https://curl.se/docs/manpage.html)
4. [HTTPX 代理配置](https://www.python-httpx.org/advanced/proxies/)
5. [HTTPX 环境变量](https://www.python-httpx.org/environment_variables/)

---

返回[用户视角总目录](index.md) ｜ 返回[手册首页](../index.md)
