# 入侵排查与命令

怀疑机器被挖矿时，最忌讳的是“先重启试试”“先把可疑文件删了”。这两件事都会让证据消失，而且往往不能阻止重生。正确的做法是先只读采集，再按攻击链逐层确认。

本页按“资源 → 进程 → 网络 → 持久化 → 账号 → 日志 → 文件完整性 → 横向”的顺序组织。命令默认在疑似失陷主机上执行，带 `sudo` 的需要管理员权限。

::: warning 先保护现场
- 不要重启、关机、重装。
- 不要删除 `/var/tmp`、`/tmp`、日志、`.bash_history`。
- 不要 kill 不确定用途的进程。
- 不要把样本上传到公开的在线沙箱或 VirusTotal，可能泄露实验室数据，也会惊动攻击者。
- 先记录时间、主机名、执行账号和命令输出，再考虑清理。
:::

## 先判断是不是安全事件

| 现象 | 更像资源/配置问题 | 更像安全事件 |
|---|---|---|
| CPU 高 | 自己的训练、编译、数据处理 | 没有任务但持续 100%，进程名陌生 |
| GPU 忙 | 自己或同组用户的任务 | `nvidia-smi` 里是陌生进程，或进程路径在 `/tmp` |
| 磁盘满 | 日志、缓存、数据集 | 临时目录出现大量可执行文件或随机目录 |
| 登录慢 | 网络、DNS、负载高 | 大量失败登录、陌生来源、`127.0.0.1` 登录 |
| 网络慢 | 大流量下载、链路故障 | 陌生 `ESTAB`、矿池端口、出站扫描 22 |
| 文件变化 | 自己或同事的操作 | `authorized_keys`、crontab、systemd 被改 |
| 日志缺失 | 日志轮转、磁盘满 | journald 反复重启、日志速率骤降 |

拿不准时，按安全事件处理：先只读采集，再判断。采集本身不会破坏系统。

## 五分钟快查

```bash
# 身份、时间、负载
hostname
date -Is
whoami
id
uptime

# CPU / 内存占用最高的进程
ps -eo pid,ppid,user,pcpu,pmem,etimes,stat,args --sort=-pcpu | head -30

# 监听端口和连接
sudo ss -lntup
sudo ss -tnp state established

# 用户 crontab 和系统 cron
sudo ls -la /var/spool/cron/crontabs/ 2>/dev/null
sudo cat /etc/crontab 2>/dev/null
sudo find /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /etc/cron.monthly -maxdepth 1 -type f -ls 2>/dev/null

# 临时目录
sudo ls -la /var/tmp /tmp /dev/shm
sudo find /var/tmp /tmp /dev/shm -maxdepth 2 -type d \
  -regextype posix-extended -regex '.*/[0-9a-f]{8}' -ls 2>/dev/null
sudo find /var/tmp /tmp /dev/shm -maxdepth 3 -type f -perm -111 -ls 2>/dev/null

# 公钥
sudo find /home /root -name authorized_keys -printf '%p %TY-%Tm-%Td %TH:%TM\n' 2>/dev/null
sudo find /home /root -name authorized_keys -exec ssh-keygen -lf {} \; 2>/dev/null

# 登录
sudo grep -aE 'Failed password|Accepted' /var/log/auth.log 2>/dev/null | tail -50
sudo last -a | head -30
```

这一步的目标不是“确认有没有病毒”，而是找出明显的异常方向。任何一项命中，继续看对应章节。

## 进程与可执行文件

### 看进程树和资源

```bash
ps -eo pid,ppid,pgid,sid,user,etimes,pcpu,pmem,rss,stat,args --sort=-pcpu | head -40
ps -eo pid,ppid,user,args --forest | head -80
top -b -n1 | head -40
```

看什么：

- `pcpu` 超过 100% 是可能的（多核），但长期 800%、1500% 且没有对应任务，优先怀疑 CPU 挖矿。
- `PPID=1` 说明进程已经脱离终端，常被守护进程或恶意载荷使用。
- `etimes` 很短、进程名随机，说明刚启动，可能是 watchdog 拉起的。
- `user` 是 `nobody`、`www-data`、服务账号，但命令行是 `/tmp/...`，非常可疑。

### 看 `/proc/<pid>/exe` 和命令行

`ps` 的进程名可以被伪装，`/proc` 更可靠：

```bash
for p in /proc/[0-9]*; do
  pid=${p#/proc/}
  exe=$(readlink "$p/exe" 2>/dev/null) || continue
  case "$exe" in
    /tmp/*|/var/tmp/*|/dev/shm/*|*"(deleted)"*)
      printf 'PID=%s EXE=%s\n' "$pid" "$exe"
      tr '\0' ' ' < "$p/cmdline" 2>/dev/null
      echo
      ;;
  esac
done
```

重点看：

- `exe` 指向 `/tmp`、`/var/tmp`、`/dev/shm`；
- `exe` 后面带 `(deleted)`，说明二进制已经被删除但进程还在跑；
- `cmdline` 和 `ps` 显示的名字不一致；
- `cwd` 在临时目录：

```bash
sudo ls -l /proc/<PID>/cwd
sudo ls -l /proc/<PID>/exe
sudo cat /proc/<PID>/cmdline | tr '\0' ' '
```

### 看进程打开的文件和网络

```bash
sudo lsof -p <PID> | head -50
sudo lsof -nP -p <PID> -i
sudo cat /proc/<PID>/status
sudo cat /proc/<PID>/environ | tr '\0' '\n'
```

`environ` 里可能出现 `LD_PRELOAD`、代理、矿池地址、钱包等线索。不要把它直接贴到公开渠道，可能含凭据。

## 网络与外联

### 连接和监听

```bash
sudo ss -tunap
sudo ss -tnp state established
sudo ss -lntup
sudo lsof -nP -iTCP -sTCP:ESTABLISHED
```

重点看：

- `ESTAB` 到陌生公网 IP 的 443、222、3333、9000、14444、5555 等端口；
- `SYN-SENT` 大量堆积，可能是 C2 不可达或扫描；
- 监听在 `0.0.0.0` 的陌生端口；
- 进程名是 `cache`、8 位十六进制、`-bash` 等。

按端口过滤：

```bash
sudo ss -tnp state established '( dport = :443 or dport = :222 or dport = :3333 or dport = :9000 or dport = :14444 )'
```

### 看 DNS 和出站

如果怀疑 C2 使用域名：

```bash
sudo journalctl -u systemd-resolved --since '1 hour ago' --no-pager | tail -80
cat /etc/resolv.conf
```

需要抓包时，先确认没有其他人在做网络实验，并尽量只抓短时间、指定端口：

```bash
sudo tcpdump -ni any -c 100 'port 53 or port 3333 or port 9000'
```

抓包文件可能包含敏感信息，按内部资料保管。

## 持久化

### 用户 crontab

```bash
sudo ls -la /var/spool/cron/crontabs/
for u in $(cut -d: -f1 /etc/passwd); do
  echo "== $u =="
  sudo crontab -u "$u" -l 2>/dev/null
done
```

可疑特征：

- `/var/tmp/<8位十六进制>/...`
- `curl`、`wget`、`base64`、`bash -c`
- `@reboot`、每分钟、每 30 分钟同时出现
- 路径每分钟变化，或目标目录已经被删除

### 系统 cron 和 systemd

```bash
sudo cat /etc/crontab
sudo find /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /etc/cron.monthly -maxdepth 1 -type f -ls
systemctl list-timers --all
systemctl --failed
systemctl list-unit-files --state=enabled
sudo find /home /root -path '*/.config/systemd/user/*' -type f -ls 2>/dev/null
```

重点看 `ExecStart` 是否指向 `/tmp`、`/var/tmp`、`/dev/shm`，以及服务名是否伪装成系统组件。

### 其他启动位置

```bash
cat /etc/ld.so.preload 2>/dev/null
cat /etc/rc.local 2>/dev/null
sudo atq
sudo find /etc/profile.d /etc/bash.bashrc /root /home -maxdepth 3 \
  \( -name '.bashrc' -o -name '.profile' -o -name '.bash_profile' -o -name '*.sh' \) -ls 2>/dev/null
```

`/etc/ld.so.preload` 非空时，逐个查 `.so` 的来源、哈希和所属软件包。

## 账号与公钥

### 账号

```bash
getent passwd
getent group sudo
awk -F: '$3 == 0 {print}' /etc/passwd
sudo passwd -S -a
sudo lastlog
last -a | head -30
sudo lastb -a | head -30
```

看什么：

- 新增的 uid 0 账号；
- 不该在 sudo 组的账号；
- 服务账号有可用密码；
- 长期不登录但突然有登录；
- 陌生来源、非工作时间的登录；
- `last` 里 `gone - no logout`，可能是非交互式 `ssh <cmd>` 或会话被强杀。

### 公钥

```bash
sudo find /home /root -name authorized_keys -printf '%p %TY-%Tm-%Td %TH:%TM\n' 2>/dev/null
sudo ssh-keygen -lf /home/<user>/.ssh/authorized_keys
sudo grep -R -nE 'command=|from=|environment=' /home/*/.ssh/authorized_keys 2>/dev/null
```

看什么：

- mtime 正好落在事件时间窗；
- 指纹不在清单里；
- 注释是陌生名字、随机字符串；
- `command=` 强制命令，可能是后门；
- 同一把 key 出现在多个用户下。

公钥后门不会因为改密码而失效。删除前先备份文件，按指纹确认是哪一把，不要整文件清空。

### sudo 和提权痕迹

```bash
sudo grep -aE 'sudo:|su:|passwd changed|new user' /var/log/auth.log | tail -100
sudo grep -R -nE 'NOPASSWD|ALL=' /etc/sudoers /etc/sudoers.d 2>/dev/null
sudo find / -xdev -perm -4000 -type f -ls 2>/dev/null
```

SUID 列表可能很长，先与基线对比；没有基线时，重点看 `/tmp`、`/home`、`/opt` 下的 SUID。

## 日志与登录

```bash
sudo grep -aE 'Failed password|Accepted|Invalid user|session opened' /var/log/auth.log | tail -100
sudo journalctl -u ssh --since '24 hours ago' --no-pager | tail -100
sudo journalctl --since '24 hours ago' --no-pager | grep -Ei 'error|fail|killed|oom|journal'
systemctl show systemd-journald -p NRestarts
```

看什么：

- 同一来源大量 `Failed password`；
- `Accepted` 来自 `127.0.0.1` 或非常用网段；
- `sudo: <user> : user NOT in sudoers`；
- `passwd: password changed for <user>`；
- `journald` 重启、日志断档；
- `Failed to write`、`Rate limit`、`Suppressed`。

日志时间要结合消息内时间看。

## 文件系统与完整性

### 临时目录

```bash
sudo find /var/tmp /tmp /dev/shm -maxdepth 2 -type d \
  -regextype posix-extended -regex '.*/[0-9a-f]{8}' -ls 2>/dev/null
sudo find /var/tmp /tmp /dev/shm -maxdepth 3 -type f -perm -111 -ls 2>/dev/null
sudo find /var/tmp /tmp /dev/shm -maxdepth 3 -type f -mtime -2 -ls 2>/dev/null
```

### 最近变化的文件

```bash
sudo find /home -xdev -type f -mtime -2 -printf '%TY-%Tm-%Td %TH:%TM %p\n' 2>/dev/null | sort | tail -50
sudo find /etc /usr/local /opt -xdev -type f -mtime -7 -printf '%TY-%Tm-%Td %TH:%TM %p\n' 2>/dev/null | sort | tail -50
```

范围不要一上来就全盘。先看 `/home`、`/etc`、`/usr/local`、`/opt`，再按需要扩大。

### 软件包完整性

```bash
# Debian / Ubuntu
dpkg -V 2>/dev/null | head -50
debsums -c 2>/dev/null | head -50

# RHEL / CentOS
rpm -Va 2>/dev/null | head -50
```

`dpkg -V` 会检查已安装文件的 md5，输出被修改的文件。系统升级、配置修改也可能产生输出，要结合 `/var/log/dpkg.log` 判断。

### 内核模块和 rootkit

```bash
lsmod
cat /proc/modules
sudo grep -R . /etc/modules-load.d /etc/modprobe.d 2>/dev/null
sudo rkhunter --check --sk 2>/dev/null
sudo chkrootkit 2>/dev/null
```

rootkit 扫描器有误报，也不能保证发现所有 rootkit。它们适合做辅助，不适合作为“干净”的唯一证据。

## GPU 挖矿排查

```bash
nvidia-smi
nvidia-smi -L
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
nvidia-smi pmon -c 1
```

看什么：

- GPU 利用率 100%，但没有对应的训练任务；
- 进程名陌生，或进程路径在 `/tmp`、`/var/tmp`；
- 显存占用很小但利用率很高，可能是轻量矿机；
- 同一进程在两张卡上都有占用，但用户没有提交双卡任务。

用 PID 回到进程章节确认：

```bash
ps -fp <PID>
sudo ls -l /proc/<PID>/exe
sudo lsof -p <PID> | head -30
```

## 输出怎么判断

| 看到的现象 | 可能含义 | 下一步 |
|---|---|---|
| `/var/tmp` 下多个 8 位十六进制目录 | 恶意载荷落地、轮换 | 看目录内文件、crontab、进程。 |
| 进程名是 8 位十六进制或 `cache` | 僵尸网络常用随机名 | 看 `/proc/<pid>/exe`、`cmdline`、外联。 |
| `PPID=1` 且 exe 在 `/tmp` | 已脱离终端，可能是矿机/守护 | 看启动方式、cron、systemd。 |
| CPU 1500%、GPU 空闲 | CPU 挖矿 | 看进程、矿池连接。 |
| GPU 100%、没有用户任务 | GPU 挖矿 | 看 `nvidia-smi` 进程、exe 路径。 |
| `ESTAB` 到陌生 443/222 | C2 | 看进程、域名、历史连接。 |
| `ESTAB` 到 3333/9000/14444 | 矿池 | 看进程和命令行里的钱包/矿池参数。 |
| crontab 5 条指向 `/var/tmp/<8hex>` | 持久化 | 先取证，再按应急处置顺序清理。 |
| `authorized_keys` 新增陌生 key | SSH 后门 | 记录指纹、备份文件、确认后删除。 |
| `Accepted ... from 127.0.0.1` | 隧道回环 | 查配置和日志。 |
| journald 重启、日志断档 | 日志洪泛/反取证 | 查 journald 限制、磁盘、SSH 失败量。 |
| `last` 里 `gone - no logout` | 非交互式登录或会话被杀 | 对照 auth.log 和 wtmp。 |
| 大量出站 22 | 横向爆破 | 查进程、目标网段、同密码账号。 |

## 按现象查

| 现象 | 先执行 | 重点看 |
|---|---|---|
| 机器很卡、负载高 | `uptime`、`ps --sort=-pcpu`、`top` | 是否有陌生高 CPU 进程。 |
| GPU 一直满载 | `nvidia-smi`、`nvidia-smi --query-compute-apps=...` | 进程是否属于已知用户/任务。 |
| SSH 登录变慢或失败多 | `sudo grep Failed /var/log/auth.log`、`sudo lastb` | 爆破、账号锁定、日志洪泛。 |
| 磁盘突然满 | `df -h`、`du -sh /var/tmp /tmp /home/*` | 临时目录、日志、恶意样本。 |
| 网络变慢 | `sudo ss -tnp`、`sudo lsof -i`、`sudo tcpdump` | 大流量外联、矿池、扫描。 |
| 发现陌生进程 | `ls -l /proc/<pid>/exe`、`lsof -p` | 可执行路径、父进程、外联。 |
| crontab 自动变化 | `ls -la /var/spool/cron/crontabs/`、`crontab -l` | 路径是否指向临时目录。 |
| 新公钥 | `ssh-keygen -lf`、`stat` | 指纹、mtime、注释。 |
| 日志缺失 | `systemctl show systemd-journald -p NRestarts`、`journalctl` | 重启次数、速率限制、磁盘。 |
| 同网段机器异常 | `ss -tnp`、`journalctl -u ssh` | 出站 22、同密码登录。 |

## 取证采集顺序

确认要处置前，先按下面的顺序采集。能留内存镜像更好，但不要为了取证把业务长时间停掉。

1. **记录元信息**：时间、主机名、IP、执行人、命令。
2. **进程和网络**：`ps`、`ss`、`lsof`、`/proc/<pid>/exe`、`cmdline`、`environ`。
3. **登录和日志**：`last`、`lastb`、`auth.log`、`journalctl`。
4. **持久化**：crontab、`/etc/cron*`、systemd、`authorized_keys`、`ld.so.preload`。
5. **文件和哈希**：样本先 `sha256sum`，再复制到离线介质；不要在原机运行。
6. **账号状态**：`passwd -S`、sudo 组、最近登录、密钥指纹。
7. **其他内容**，如其他主机的登录记录等。

采集时把输出写到外部介质或另一台可信主机。不要只留在被入侵的机器上，攻击者可能删除。

## 一键只读采集

下面脚本只读，不修改配置、不杀进程、不删文件。建议从 U 盘或可信主机复制过去执行，不要在被入侵主机上下载脚本再运行。

```bash
#!/usr/bin/env bash
# 只读采集：sudo bash triage.sh
set -u

host=$(hostname)
ts=$(date +%Y%m%d-%H%M%S)
out="triage-${host}-${ts}.txt"

{
  echo "== meta =="
  date -Is; hostname; whoami; id; uptime
  echo "== users =="
  who; w; last -a | head -30
  echo "== processes =="
  ps -eo pid,ppid,pgid,sid,user,etimes,pcpu,pmem,rss,stat,args --sort=-pcpu | head -80
  echo "== proc exe =="
  for p in /proc/[0-9]*; do
    pid=${p#/proc/}
    exe=$(readlink "$p/exe" 2>/dev/null) || continue
    case "$exe" in
      /tmp/*|/var/tmp/*|/dev/shm/*|*"(deleted)"*)
        printf 'PID=%s EXE=%s\n' "$pid" "$exe"
        tr '\0' ' ' < "$p/cmdline" 2>/dev/null; echo
        ;;
    esac
  done
  echo "== network =="
  ss -tunap 2>/dev/null || netstat -tunap 2>/dev/null
  echo "== cron =="
  ls -la /var/spool/cron/crontabs/ 2>/dev/null
  cat /etc/crontab 2>/dev/null
  find /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /etc/cron.monthly -maxdepth 1 -type f -ls 2>/dev/null
  echo "== systemd =="
  systemctl list-timers --all 2>/dev/null
  systemctl --failed 2>/dev/null
  echo "== keys =="
  find /home /root -name authorized_keys -printf '%p %TY-%Tm-%Td %TH:%TM\n' 2>/dev/null
  find /home /root -name authorized_keys -exec ssh-keygen -lf {} \; 2>/dev/null
  echo "== tmp =="
  find /var/tmp /tmp /dev/shm -maxdepth 2 -type d \
    -regextype posix-extended -regex '.*/[0-9a-f]{8}' -ls 2>/dev/null
  find /var/tmp /tmp /dev/shm -maxdepth 3 -type f -perm -111 -ls 2>/dev/null
  echo "== auth =="
  grep -aE 'Failed password|Accepted|sudo:|passwd changed' /var/log/auth.log 2>/dev/null | tail -100
  echo "== journald =="
  systemctl show systemd-journald -p NRestarts 2>/dev/null
} | tee "$out"

echo "written: $out"
```

脚本输出可能包含账号、IP、文件名等内部信息。

## 注意事项

- **不要只信 `ps`。** 进程名可以伪造，`/proc/<pid>/exe`、`cmdline`、`cwd` 更可靠。
- **不要直接 `pkill -9 -u <user>`。** 可能杀掉正常任务，也会丢失证据；先记录 PID 和命令行。
- **不要 `rm -rf /var/tmp/*`。** 会删掉证据，也可能影响其他用户。
- **不要先重启。** 内存里的连接、进程和环境变量会丢失。
- **不要用被入侵主机上的工具做判断。** `ps`、`ss`、`find`、`ssh` 都可能被替换；必要时用静态编译的工具或从可信介质启动。
- **不要在公开渠道发样本、密码、公钥或内部 IP。**
- **不要只查一台机器。** 同密码、同公钥、同网段的主机都要查。
- **不要把“没有发现”当成“没有问题”。** 没有基线、日志缺失或被 root 控制时，结论要保守。

确认失陷后，按[应急处置与上报](response.md)的顺序处理。

---

返回[安全总览](index.md) ｜ 返回[手册首页](../index.md)

