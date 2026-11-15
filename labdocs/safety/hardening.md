# 防护措施

本节主要介绍一些基本的防护措施，帮助减少被入侵的风险。

对于已经被入侵的主机，请参考[应急响应](response.md)。

## SSH

### 推荐配置

先创建允许登录的用户组，把需要登录的人加进去，再启用 `AllowGroups`。否则改完可能把自己锁在外面。

```bash
sudo groupadd -f ssh-users
sudo usermod -aG ssh-users <admin-user>
```

新建 `00-hardening.conf`。在使用 `Include /etc/ssh/sshd_config.d/*.conf` 的系统上，文件名的 `00-` 前缀可使它先于 `50-cloud-init.conf` 等同目录配置读取。OpenSSH 对同一个选项通常采用第一次出现的值，因此还要确认主配置文件中的 `Include` 位置及其他重复配置，最终以 `sshd -T` 为准。

```text
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
AuthenticationMethods publickey
MaxAuthTries 3
LoginGraceTime 30
MaxStartups 10:30:60
AllowGroups ssh-users
```

说明：

- `PasswordAuthentication no` 禁用密码登录，只留公钥。
- `KbdInteractiveAuthentication no` 同时关掉 PAM 的键盘交互密码认证。
- `PermitRootLogin no` 禁止 root 直接登录；需要 root 时先用普通账号登录再 `sudo`。
- `AuthenticationMethods publickey` 强制公钥，避免其他认证方式被意外打开。
- `MaxAuthTries 3`、`LoginGraceTime 30`、`MaxStartups 10:30:60` 降低爆破的成功率和资源消耗。
- `AllowGroups ssh-users` 只允许指定组登录。**启用前必须确认自己在这个组里，并保留一个已登录会话。**

改完先检查语法，再重载：

```bash
sudo sshd -t
sudo sshd -T | grep -Ei '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin|pubkeyauthentication|authenticationmethods|maxauthtries|logingracetime|maxstartups|allowgroups)'
sudo systemctl reload ssh
```

Ubuntu 的服务名通常是 `ssh`，不是 `sshd`。如果 `sshd -t` 报错，不要重载，先修配置。

### 公钥管理

```bash
# 列出所有 authorized_keys 和修改时间
sudo find /home /root -name authorized_keys -printf '%p %TY-%Tm-%Td %TH:%TM\n' 2>/dev/null

# 查看指纹和注释
sudo ssh-keygen -lf /home/<user>/.ssh/authorized_keys

# 检查权限
sudo stat -c '%a %U:%G %n' /home/<user>/.ssh /home/<user>/.ssh/authorized_keys
```

要求：

- `~/.ssh` 权限 `700`，`authorized_keys` 权限 `600`，属主是本人。
- 每个人一把自己的 key，不共用。
- 离职、换设备、疑似泄露时删除对应 key。
- 定期把指纹和负责人对一遍；只看注释不可靠，注释可以随便写。
- 不要往 `authorized_keys` 里加 `command=`、`from=` 之类看不懂的限制，除非确实理解作用。

## 账号与权限

### 账号盘点

```bash
# 普通账号
getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 {print $1, $3, $6, $7}'

# uid 0 账号
awk -F: '$3 == 0 {print}' /etc/passwd

# sudo 组
getent group sudo

# 密码状态（L 锁定、P 可用、NP 空密码）
sudo passwd -S -a

# 最近登录
sudo lastlog
last -a | head -30

# 没有属主的家目录
sudo find /home -maxdepth 1 -nouser -ls
```

### 原则

- **一人一账号。** 共用账号会让责任和止损都无法界定。
- **服务账号不设可登录密码。** 用 `passwd -l` 锁定，shell 设为 `/usr/sbin/nologin`，需要执行任务时用 sudo 规则或 systemd 的 `User=` 指定。
- **`nologin` 不等于安全。** 它只阻止交互式 shell；如果账号还有密码、还在 sudo 组、还能做端口转发，风险仍然存在。
- **sudo 组只给确实需要的人。** 能用 `sudo -l` 看到具体命令，就不要给全量 sudo。
- **禁止无密码 sudo。** 确需免密时，限定到具体命令，并记录原因。
- **离职/项目结束要删账号、删家目录、删公钥、删 cron，并回收 sudo。** `userdel -r <user>` 之前确认数据已经交接。
- **UID 回收要小心。** 删账号后如果 UID 被新用户复用，旧文件会看起来属于新人；旧家目录和新家目录可能混淆。

### 服务账号检查

```bash
# 哪些账号有可登录 shell
getent passwd | awk -F: '$7 !~ /(nologin|false)$/ {print $1, $7}'

# 哪些账号有密码
sudo passwd -S -a | grep -v ' L '

# 哪些账号在 sudo 组
getent group sudo

# 某个账号的 sudo 权限
sudo -l -U <user>
```

服务账号（例如 `deploy`、`backup`、`monitor` 等）要重点看：

- 是否还有可用密码；
- 是否在 sudo、docker、datagroup 等敏感组；
- 家目录里是否有 `.ssh`、cron、脚本；
- 是否被多个用户共用；
- 是否还在被应用程序使用，能否改成密钥或受限 sudo。

## 持久化面

每次安全检查和事件排查都过一遍下面这些位置：

```bash
# 用户 crontab
sudo ls -la /var/spool/cron/crontabs/
for u in $(cut -d: -f1 /etc/passwd); do
  echo "== $u =="
  sudo crontab -u "$u" -l 2>/dev/null
done

# 系统 cron
sudo cat /etc/crontab
sudo find /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /etc/cron.monthly -maxdepth 1 -type f -ls

# systemd
systemctl list-timers --all
systemctl --failed
systemctl list-unit-files --state=enabled
sudo find /home /root -path '*/.config/systemd/user/*' -type f -ls 2>/dev/null

# Shell 启动文件
sudo find /etc/profile.d /etc/bash.bashrc /root /home -maxdepth 3 \
  \( -name '.bashrc' -o -name '.profile' -o -name '.bash_profile' -o -name '*.sh' \) -ls 2>/dev/null

# 动态链接预加载
cat /etc/ld.so.preload 2>/dev/null

# at 任务
sudo atq

# rc.local
cat /etc/rc.local 2>/dev/null
```

判读要点：

- cron 里出现 `/var/tmp`、`/tmp`、`/dev/shm`、`curl`、`wget`、`base64`，优先怀疑。
- systemd unit 的 `ExecStart` 指向临时目录，或服务名伪装成 `systemd-*`、`kworker`，优先怀疑。
- `ld.so.preload` 非空时，查每个 `.so` 的来源和哈希。
- 用户单位置也要看，不要只查系统 unit。

## 日志与告警

### 先保证日志不丢

`journald` 默认有速率限制，SSH 爆破量很大时可能丢日志。2026-11-15 的案例中，journald 重启 6 次，`auth.log` 断档约 20 分钟，给时间线判断造成了很大困难。

建议：

```ini
# /etc/systemd/journald.conf.d/99-cslab.conf
[Journal]
SystemMaxUse=4G
SystemMaxFileSize=200M
RateLimitIntervalSec=30s
RateLimitBurst=50000
```

`RateLimitBurst` 不要设得比默认值低（常见默认是 30 秒内 10000 条）；调低会让爆破时更容易丢日志。磁盘紧张时优先做异地转发和轮转，不要靠丢日志省空间。

```bash
sudo systemctl restart systemd-journald
```

同时保留 `rsyslog` 的 `/var/log/auth.log`，并尽量把日志转发到另一台主机或集中日志系统。不要把日志只留在被入侵的机器上。

### 建议的告警

| 事件 | 建议阈值 | 说明 |
|---|---|---|
| SSH 失败登录 | 同一来源 5 分钟内 > 20 次 | 爆破或误配置。 |
| SSH 成功登录 | 来源是 `127.0.0.1`、非常用网段或非常用时间 | 可能是隧道或盗用账号。 |
| 新公钥 | `authorized_keys` mtime 变化或指纹不在清单 | 后门。 |
| 新 cron/systemd | 新增 unit、timer、cron 文件 | 持久化。 |
| 临时目录可执行文件 | `/var/tmp`、`/tmp`、`/dev/shm` 新增 ELF | 载荷落地。 |
| 出站连接 | 3333、9000、14444、222 等矿池/C2 常用端口 | 挖矿或 C2。 |
| CPU 持续满载 | 10 分钟 > 90%，且无已知任务 | CPU 挖矿。 |
| GPU 异常占用 | 出现不在允许清单中的进程 | GPU 挖矿。 |
| 日志断档 | journald 重启、日志速率骤降 | 反取证或日志洪泛。 |

没有集中监控时，至少每周人工看一次：

```bash
sudo grep -aE 'Failed password|Accepted' /var/log/auth.log | tail -100
sudo journalctl -u ssh --since '7 days ago' --no-pager | tail -100
sudo last -a | head -30
```

## 出网与资源

挖矿必须连矿池，C2 必须回连。出网监控往往比主机杀毒更早发现问题。

- 记录并定期检查服务器主动外联的地址和端口；
- 对 3333、9000、14444、222、4444 等矿池/C2 常用端口做告警或阻断；
- 对 DNS 查询做日志，关注随机域名、动态域名、刚注册域名；
- 对 GPU 进程做基线：正常情况下只有哪些用户、哪些程序会用 GPU；
- 对 CPU 使用率、负载、温度做趋势告警，不只看瞬时值；
- 对 `/var/tmp`、`/tmp`、`/dev/shm` 的新增可执行文件做监控。

```bash
# 当前外联
sudo ss -tnp state established

# 按进程看连接
sudo lsof -nP -iTCP -sTCP:ESTABLISHED

# GPU 进程
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
```

不要只按 IP 封禁。攻击者会换 IP、换域名，行为特征和持久化位置更稳定。

## 补丁与供应链

- 及时安装安全更新，尤其是 OpenSSH、内核、glibc、Docker、Web 框架。
- 不在生产环境直接 `apt upgrade`；先评估、备份、安排窗口。
- 禁止 `curl ... | bash`。需要安装时，先下载、校验哈希/签名、阅读脚本。
- pip/npm/conda 包使用可信源和锁文件；不要安装来源不明的“加速包”“破解包”。
- 容器镜像使用可信仓库，不使用 `--privileged`，不挂载宿主机根目录。
- 不在服务器上安装未经审查的 AI 代理、自动化脚本、远程控制工具。
- 对模型权重、数据集、第三方二进制做来源和哈希记录。

## 备份与恢复

- 重要配置、数据库、用户数据定期备份。
- 至少一份离线或不可变备份，避免被勒索软件/入侵者一起删掉。
- 备份要能恢复，定期做恢复演练；只看“备份任务成功”不够。
- 事件处置前先备份现场，但不要把恶意样本留在生产主机上。
- 如果怀疑 root 级入侵，优先从可信镜像重装，再从备份恢复数据；不要试图在已被 root 控制的系统上“清理干净”。

## 月度安全检查表

这一节集中列出每月要做的安全检查；日常维护页只保留入口，不再重复具体条目。每月至少做一次，把结果记在维护记录里。

| # | 检查项 | 命令/动作 | 通过标准 |
|---|---|---|---|
| 1 | uid 0 账号 | `awk -F: '$3==0 {print}' /etc/passwd` | 只有 root。 |
| 2 | sudo 组 | `getent group sudo` | 名单与授权一致。 |
| 3 | 密码状态 | `sudo passwd -S -a` | 服务账号锁定；活人账号无空密码。 |
| 4 | 最近登录 | `sudo lastlog`、`last -a` | 无陌生来源、无长期不用的账号。 |
| 5 | SSH 配置 | `sudo sshd -T \| grep -Ei 'passwordauthentication\|permitrootlogin\|maxauthtries'` | 密码登录关闭、root 禁止、尝试次数受限。 |
| 6 | 公钥清单 | `sudo find /home /root -name authorized_keys -exec ssh-keygen -lf {} \;` | 每个指纹都有负责人。 |
| 7 | 用户 crontab | `sudo ls -la /var/spool/cron/crontabs/`、逐个 `sudo crontab -u <user> -l` | 无临时目录、无 `curl\|bash`。 |
| 8 | 系统 cron | `sudo cat /etc/crontab`、`sudo find /etc/cron.* -type f` | 无未知脚本、无临时目录。 |
| 9 | systemd | `systemctl list-timers --all`、`systemctl --failed` | 无未知 unit/timer。 |
| 10 | 临时目录 | `find /var/tmp /tmp /dev/shm -maxdepth 3 -type f -perm -111`、`find /var/tmp /tmp /dev/shm -maxdepth 2 -regextype posix-extended -type d -regex '.*/[0-9a-f]{8}'` | 无可疑 ELF、无 8 位随机目录。 |
| 11 | 监听端口 | `sudo ss -lntup` | 只开放必要端口。 |
| 12 | 外联 | `sudo ss -tnp state established` | 无矿池/C2/陌生地址。 |
| 13 | 隧道 | 查 frp/ngrok/cloudflared 配置和进程 | 每条隧道都有登记和用途。 |
| 14 | 防火墙 | `sudo ufw status` 或 `sudo nft list ruleset` | 默认拒绝入站，规则可解释。 |
| 15 | 补丁 | `apt list --upgradable` | 无长期未处理的高危更新。 |
| 16 | 日志 | `sudo journalctl -u ssh --since '30 days ago'`、日志保留 | 无断档、可追溯。 |
| 17 | 备份 | 最近备份时间、恢复演练记录 | 有离线副本，能恢复。 |
| 18 | 离职账号 | 对照人员名单 | 已删账号、家目录、公钥、cron、sudo。 |

## 落地顺序

如果现在只能做五件事，按这个顺序：

1. 关掉公网 SSH 暴露和不再使用的隧道。
2. 把需要登录的人迁到公钥，然后关闭密码登录和 root 直登。
3. 盘点 sudo 组、服务账号、`authorized_keys` 和 crontab。
4. 给 `/var/tmp`、crontab、公钥、SSH 登录失败加告警。
5. 做一次离线备份和恢复演练。

每改一项，先验证再改下一项。涉及 SSH 和防火墙时，保留一个已登录会话和一个带外入口。

## 不要做的事

- 不要把 22 端口直接映射到公网，也不要用“临时”隧道长期暴露。
- 不要给服务账号设置可登录密码，不要把它留在 sudo 组。
- 不要把同一个密码用在多台机器、多个系统。
- 不要把 `authorized_keys` 当成“加一把 key 无所谓”的地方。
- 不要只清 crontab 不杀进程，也不要只杀进程不清 crontab。
- 不要在没有备份和回滚方案时批量改 SSH、防火墙、sudo。
- 不要用来源不明的“安全扫描脚本”清理生产机。
- 不要以为装了 fail2ban 就安全；它只降低爆破速度，不替代密钥登录和边界控制。

---

返回[安全总览](index.md) ｜ 返回[手册首页](../index.md)

