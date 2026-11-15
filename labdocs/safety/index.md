# 安全

实验室平台的安全事件主要是挖矿僵尸网络。而且，挖矿僵尸网络的攻击手法和防护措施与传统的“黑客入侵”有很大不同。它们不追求数据泄露、勒索或破坏，而是追求长期稳定的算力输出。

攻击者通常会在被入侵的机器上安装挖矿程序，并通过各种方式保持对机器的控制，以便持续挖矿。 此外，对挖矿僵尸网络来说，一台失陷主机不只是“多了一台矿机”，它还可以被用来继续扫描、爆破和感染同网段的其他机器。

本章节会介绍挖矿僵尸网络的[入侵手法](mining.md)、[防护基线](hardening.md)、[排查命令](inspect.md)和[应急处置流程](response.md)。普通用户只需要记住行为边界和异常上报方式。

## 关键点

1. **挖矿只是变现方式，持久化才是本体。** 只杀矿机进程，cron、watchdog、公钥和改掉的密码还在，几十分钟内就会回来。
2. **入口通常不是高深漏洞。** 暴露到公网的 SSH、弱密码、复用密码、来源不明的 `curl | bash`，比内核漏洞更常见。
3. **一台机器失陷，同网段、同密码、同公钥的其他机器都要假设已被尝试。** 横向移动往往比第一次入侵更安静。
4. **先保留现场，再动手。** 重启、删日志、清临时目录都会让原因和影响范围无法确认。
5. **安全是配置和流程，不是一次扫描。** 没有基线、没有日志、没有账号清单，清理完也无法证明真的干净。

## 自查命令（只读）

下面这些命令只读，不改配置、不杀进程、不删文件。怀疑机器异常时，先执行一遍，把输出保存下来。带 `sudo` 的命令需要管理员权限；普通用户只执行自己有权执行的部分。

```bash
hostname
date -Is
uptime

# CPU / 内存占用最高的进程
ps -eo pid,ppid,user,pcpu,pmem,etimes,stat,args --sort=-pcpu | head -25

# 监听端口和已建立连接
sudo ss -tunap

# 用户 crontab 和系统 cron
sudo ls -la /var/spool/cron/crontabs/ 2>/dev/null
sudo cat /etc/crontab 2>/dev/null
sudo find /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /etc/cron.monthly -maxdepth 1 -type f -ls 2>/dev/null

# 临时目录里的可执行文件和随机目录
sudo ls -la /var/tmp /tmp /dev/shm
sudo find /var/tmp /tmp /dev/shm -maxdepth 2 -type d \
  -regextype posix-extended -regex '.*/[0-9a-f]{8}' -ls 2>/dev/null

# 公钥和最近登录
sudo find /home /root -name authorized_keys -printf '%p %TY-%Tm-%Td %TH:%TM\n' 2>/dev/null
sudo grep -aE 'Failed password|Accepted' /var/log/auth.log 2>/dev/null | tail -40
```

看到以下任一情况，不要继续“清理”，按[入侵排查与命令](inspect.md)深入确认：

| 现象 | 为什么可疑 |
|---|---|
| CPU 长期 100%，但没有已知训练或计算任务 | 最常见的是 CPU 挖矿。 |
| GPU 利用率很高，`nvidia-smi` 里却是陌生进程 | GPU 挖矿或借卡跑任务。 |
| 进程名是 8 位十六进制、`cache`、`-bash`，或 `PPID=1` | 僵尸网络常用随机名和脱离终端的进程。 |
| `/var/tmp`、`/tmp`、`/dev/shm` 下有 8 位十六进制目录 | 恶意载荷的常见落地目录，而且会分钟级轮换。 |
| `crontab` 里出现 `/var/tmp/<8位十六进制>/...` | 持久化的典型写法。 |
| `authorized_keys` 出现不认识的公钥，或 mtime 刚被改过 | SSH 后门，改密码也不一定失效。 |
| 大量 `Failed password` | 密码爆破，回环隧道。 |
| 日志突然断档、journald 反复重启 | 可能是日志洪泛，也可能是反取证。 |

:::info
注意：`top` 和 `ps` 的 CPU 占用百分比描述的是一个核的占用情况，而不是整个机器（32）核的占用情况，所以 CPU 的总占用率可能会超过 100%。top 默认是 Irix 模式（按单核算），所以多线程进程天然会超过 100%。按 I 可切到 Solaris 模式（除以核数，回到 0–100%）。
:::
## 普通用户要做什么

普通用户不需要记住所有排查命令，但下面几条直接决定平台会不会被当成入口：

- **不共用账号，不把密码写进脚本、Notebook、代码仓库或聊天记录。** 
- **不执行来源不明的脚本。** 尤其是 `curl ... | bash`、陌生安装包、别人发来的“一键环境”和 AI 生成的系统命令。
- **不使用未经验证的第三方工具或软件。** 避免安装来源不明的软件包，特别是那些需要执行脚本或安装驱动的。
- **不在服务器上挖矿或密码爆破。** 这些行为会被直接按安全事件处理。
- **发现异常先保留现场。** CPU/GPU 异常、陌生进程、SSH 变慢、文件被改、密码登不上，先记录时间和命令输出，联系管理员；不要自己 kill 进程、重启或删文件。
- **不把账号借给别人，也不让别人把公钥加进你的 `authorized_keys`。** 不要往自己的 `authorized_keys` 里加不认识的 key；公钥是长期有效的“备用钥匙”。

更完整的用户行为边界见[使用规范](../user/rules.md)；发现安全事件后的上报方式见[应急处置与上报](response.md)。

## 阅读约定

- 命令中的 `<user>`、`<PID>`、`<path>` 是占位符，执行前替换成实际值。
- 带 `sudo` 的命令需要 root 或管理员权限；普通用户只执行自己有权执行的部分。
- 文档中的清理命令都假定已经完成取证。没有留证之前，不要直接照抄执行。

---

返回[手册首页](../index.md)

