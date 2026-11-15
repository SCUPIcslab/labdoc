# 应急处置与上报

确认机器被入侵后，目标不是“尽快让进程消失”，而是按顺序完成四件事：**保留证据、切断扩散、清除持久化、验证干净**。顺序错了，轻则复发，重则把证据和业务一起弄丢。

本页给的是通用流程。涉及具体主机、账号和业务时，先确认影响范围，再执行命令。

## 处置原则

1. **人员安全优先，业务连续其次，证据保全贯穿全程。** 不要让处置动作造成更大范围的中断。
2. **先隔离，后清理。** 先切断攻击者的网络和登录入口，再谈删文件。
3. **先取证，后删除。** 删除前记录路径、哈希、进程、连接和日志。
4. **先切断重生链，再杀进程。** cron、systemd、watchdog 不处理，杀完还会回来。
5. **不要重启。** 重启会丢失内存、连接和未落盘日志，也可能让持久化重新加载。
6. **不要只改密码。** 公钥、cron、服务账号和同密码的其他机器都要处理。
7. **不要在原机上下载工具。** 使用可信介质或另一台机器。
8. **不要公开讨论。** 安全事件只在受控渠道内沟通。

## 处置流程

| 阶段 | 目标 | 关键动作 | 不要做 |
|---|---|---|---|
| 1. 确认 | 判断是否真的失陷、影响几台 | 只读排查、看进程/网络/持久化/账号/日志 | 不要急着重启或删文件。 |
| 2. 隔离 | 阻止继续横向和外联 | 交换机 ACL、安全组、防火墙、关闭隧道 | 不要直接关机；保留带外/控制台。 |
| 3. 取证 | 留下可复核的证据 | 进程、连接、crontab、公钥、日志、样本哈希 | 不要运行样本；不要只留截图。 |
| 4. 遏制 | 切断重生链 | 停 cron、杀进程、清 crontab、禁用 systemd | 不要只做其中一步。 |
| 5. 清除 | 删除载荷和持久化 | 临时目录、二进制、key、unit、脚本 | 不要用大范围通配删除。 |
| 6. 恢复 | 恢复可信状态 | 补丁、改密、换 key、关隧道、恢复数据 | 不要在 root 失陷的机器上“清理后继续用”。 |
| 7. 验证 | 证明没有复发 | 多个 cron 周期、重启、复查、扫描、观察 | 不要看一次 `ps` 就结束。 |
| 8. 复盘 | 修流程和基线 | 时间线、根因、IOC、手册更新 | 不要把事件写成个人失误。 |

## 隔离：先切断，但不要关机

优先在网络侧隔离：

- 交换机端口 ACL、VLAN 隔离；
- OpenStack 安全组只允许管理员地址；
- 防火墙只保留管理入口；
- 在边界设备上关闭对应隧道；
- 必要时摘下浮动 IP，但保留控制台或带外管理。

不要直接关机或重启。关机后：

- 内存中的进程、连接、环境变量消失；
- 未落盘的日志可能丢失；
- 攻击者可能已经设置了重启后生效的持久化；
- 你无法再观察它是否在横向。

如果必须关机，先完成进程、网络、crontab、公钥和关键日志的采集。

## 取证：先记录，再动手

### 最小取证集

```bash
# 元信息
date -Is
hostname
whoami
id

# 进程
ps -eo pid,ppid,pgid,sid,user,etimes,pcpu,pmem,rss,stat,args --sort=-pcpu > ps.txt
for p in /proc/[0-9]*; do
  pid=${p#/proc/}
  exe=$(readlink "$p/exe" 2>/dev/null) || continue
  case "$exe" in
    /tmp/*|/var/tmp/*|/dev/shm/*|*"(deleted)"*)
      printf 'PID=%s EXE=%s\n' "$pid" "$exe" >> proc-exe.txt
      tr '\0' ' ' < "$p/cmdline" 2>/dev/null >> proc-exe.txt
      echo >> proc-exe.txt
      ;;
  esac
done

# 网络
sudo ss -tunap > ss.txt
sudo lsof -nP -i > lsof.txt

# 持久化
sudo ls -la /var/spool/cron/crontabs/ > cron-spool.txt 2>&1
sudo cat /etc/crontab > cron-system.txt 2>&1
sudo find /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /etc/cron.monthly -maxdepth 1 -type f -ls > cron-d.txt 2>&1
systemctl list-timers --all > timers.txt 2>&1
sudo find /home /root -name authorized_keys -printf '%p %TY-%Tm-%Td %TH:%TM\n' > keys.txt 2>&1
sudo find /home /root -name authorized_keys -exec ssh-keygen -lf {} \; > key-fingerprints.txt 2>&1

# 登录和日志
sudo grep -aE 'Failed password|Accepted|sudo:|passwd changed|new user' /var/log/auth.log > auth.txt 2>&1
sudo journalctl --since '24 hours ago' --no-pager > journal.txt 2>&1

# 样本哈希（先哈希，再复制）
sudo sha256sum /var/tmp/<path>/<sample> > hashes.txt 2>&1
```

把输出复制到另一台可信主机或离线介质。不要只留在被入侵的机器上。`/evidence` 只是示例目录；如果主机已经失陷，证据应尽快复制出去。

### 样本处理

- 先 `sha256sum`，再复制；复制时保留权限和时间戳：`cp -a`。
- 不要在本机运行样本；静态分析用 `file`、`readelf`、`strings` 等只读工具。
- 不要上传到公开沙箱；如需分析，用隔离虚拟机或离线环境。
- 记录样本来源、路径、大小、哈希、属主、mtime。
- 如果样本是 ELF，`file`、`readelf -h`、`strings` 可以先做静态判断；UPX 加壳的先 `upx -d` 再分析，但要在隔离环境。

### 日志时间陷阱

如果 journald 崩溃或日志积压，journal 时间可能和消息内时间不一致。引用时间线时：

- 优先使用消息内时间；
- 记录日志回填的时间点；
- 不要把“没有日志”直接解释为“没有发生”；
- 在报告中注明日志缺口和可能丢失的时段。

## 遏制：切断重生链

### 推荐顺序

如果条件允许：

1. **短暂停止 cron 服务**，切断分钟级重生；
2. **记录并杀掉相关进程**；
3. **清空/删除恶意 crontab 和 systemd unit**；
4. **删除载荷文件**；
5. **清理公钥、锁定账号、改密码**；
6. **关闭隧道、封禁 IOC**；
7. **恢复 cron 服务**，观察是否复发。

```bash
# 0. 准备证据目录（最好在外部介质或另一台可信主机上）
sudo mkdir -p /evidence

# 1. 停 cron（Ubuntu 是 cron，RHEL 是 crond；会影响其他用户的定时任务，事件处置期间可接受）
sudo systemctl stop cron

# 2. 记录并杀进程（用实际 PID，不要用模糊 pkill）
ps -fp <PID>
sudo kill -9 <PID> <PID> ...

# 3. 清 crontab（先备份）
sudo crontab -u <user> -l > /evidence/crontab-<user>.txt 2>&1
sudo crontab -u <user> -r

# 4. 删除载荷（确认路径后）
sudo rm -f /var/tmp/<path>/<sample>

# 5. 清公钥、锁账号、改密码
sudo cp -a /home/<user>/.ssh/authorized_keys /evidence/authorized_keys-<user>.bak
sudo ssh-keygen -lf /home/<user>/.ssh/authorized_keys
# 手动删除确认恶意的行，不要整文件清空

sudo passwd -l <user>
sudo usermod -L <user>
sudo gpasswd -d <user> sudo

# 6. 恢复 cron
sudo systemctl start cron
```

如果 cron 不能停，按“杀进程 → 清 crontab → 删文件”的顺序快速执行，并在每一步后复查：

```bash
ps -eo pid,user,args | grep -E '/var/tmp|/tmp|/dev/shm'
sudo ls -la /var/spool/cron/crontabs/
```

### 关于 `kill -9`

- 先用 `ps -fp <PID>` 记录命令行和启动时间。
- 只杀确认恶意的 PID，不要 `pkill -9 -u <user>` 一刀切。
- 父进程是 1 的进程，杀掉后可能被 cron/systemd 重新拉起；先处理持久化。
- 如果进程处于 `D` 状态（不可中断），`kill -9` 也可能无效；需要排查 I/O 或内核问题。

### 关于公钥

不要直接 `> authorized_keys` 清空。先备份，再按指纹删除：

```bash
sudo cp -a /home/<user>/.ssh/authorized_keys /evidence/authorized_keys-<user>.bak
sudo ssh-keygen -lf /home/<user>/.ssh/authorized_keys
# 按输出中的注释或公钥片段定位到文件行，再手动删除
sudo grep -n '<comment-or-key-fragment>' /home/<user>/.ssh/authorized_keys
```

确认行号后手动编辑，保留合法 key。删除后验证：

```bash
sudo ssh-keygen -lf /home/<user>/.ssh/authorized_keys
sudo stat -c '%a %U:%G %n' /home/<user>/.ssh /home/<user>/.ssh/authorized_keys
```

### 关于账号

- `passwd -l <user>` 锁定密码，但不删除账号。
- `usermod -L <user>` 锁定账号。
- `gpasswd -d <user> sudo` 移出 sudo 组。
- 先取证再 `pkill -KILL -u <user>`，否则会丢失该用户的进程证据。
- 重置密码后，检查同密码的其他主机和系统。
- 服务账号改为密钥或受限 sudo，不要继续用共享密码。

### 关于隧道

- 检查路由器端口映射、UPnP、IPv6 防火墙。
- 不要只关一条隧道；把所有隧道列出来，逐条确认用途。

## 清除：删什么、不删什么

### 要删的

- `/var/tmp/<8位十六进制>/` 下的载荷；
- `/tmp`、`/dev/shm` 下的恶意可执行文件；
- 用户 crontab、`/etc/cron.d` 中的恶意条目；
- 恶意 systemd unit/timer；
- `authorized_keys` 中的攻击者公钥；
- `.bashrc`、`.profile`、`profile.d` 中被追加的启动命令；
- `/etc/ld.so.preload` 中的恶意 `.so`；
- 攻击者留下的日志、脚本、工具包；
- 确认恶意后才删除，不要用 `rm -rf /var/tmp/*`。

### 不要删的

- 不确定用途的文件；
- 其他用户的文件；
- 正在排查的日志；
- 业务数据、模型、代码；
- 系统自带文件（除非确认被替换，按包管理恢复）。

### 如果怀疑 root 级入侵

以下情况优先重装，不要试图“清理干净”：

- 攻击者取得 root 或 sudo；
- 内核模块、`ld.so.preload`、系统二进制被替换；
- rootkit 扫描发现可疑项；
- 无法解释的持久化；
- 多台机器同时失陷。

重装前备份数据，但不要备份可执行文件和系统配置；从可信镜像重装，再从只读备份恢复数据。

## 恢复：改什么、验证什么

### 恢复动作

- 安装安全更新，尤其是 OpenSSH、内核、Docker、Web 框架；
- 关闭密码登录和 root 直登；
- 安装/启用 fail2ban 或等效的登录保护；
- 关闭不需要的隧道和端口映射；
- 轮换所有可能泄露的密码、token、API key；
- 检查同密码、同公钥的其他主机；
- 从可信备份恢复数据；
- 恢复后继续观察 24–72 小时。

### 验证清单

| 检查项 | 命令 | 通过标准 |
|---|---|---|
| 恶意进程 | `ps -eo pid,user,args \| grep -E '/var/tmp\|/tmp\|/dev/shm'` | 无相关进程。 |
| 进程重生 | 观察 4 个以上 cron 周期 | 无新进程。 |
| C2/矿池连接 | `sudo ss -tnp state established` | 无相关外联。 |
| 用户 crontab | `sudo ls -la /var/spool/cron/crontabs/` | 无恶意条目。 |
| 系统 cron | `cat /etc/crontab`、`find /etc/cron.*` | 无恶意条目。 |
| systemd | `systemctl list-timers --all`、`systemctl --failed` | 无未知 unit/timer。 |
| 公钥 | `ssh-keygen -lf` | 只剩合法指纹。 |
| 账号 | `passwd -S -a`、`getent group sudo` | 服务账号锁定，sudo 名单正确。 |
| 临时目录 | `find /var/tmp /tmp /dev/shm -maxdepth 3 -type f -perm -111` | 无可疑 ELF。 |
| 重启后 | 清理完成并确认持久化已清除后，计划重启并复查上述项 | 无复发。 |
| 横向 | 同网段其他主机登录/进程/公钥 | 无同类 IOC。 |

不要只看一次结果。至少跨过一个 cron 周期，最好跨过重启，再观察一段时间。

## 上报

### 什么时候上报

- 确认或高度怀疑主机被入侵；
- 账号密码泄露、被改；
- 发现陌生公钥、cron、systemd；
- 发现横向扫描或同网段其他主机异常；
- 数据可能泄露或被删除；
- 不确定影响范围，需要更多人判断。

### 上报给谁

| 类型 | 对象 | 方式 |
|---|---|---|
| 主机失陷、挖矿、C2 | 实验室管理员和指导教师 | 立即消息 + 事件记录，不要公开讨论。 |
| 账号泄露、密码被改 | 实验室管理员 | 立即上报，按管理员要求重置。 |
| 数据泄露/删除 | 实验室管理员、指导教师、实验室负责人 | 立即上报，保留证据。 |
| 需要停机/重装 | 实验室负责人 | 书面说明影响、窗口和回滚方案。 |

### 事件记录模板

```text
【安全事件】
发现时间：
发现人：
主机/实例：
影响范围：
（单机 / 同网段 / 多用户 / 整个平台）

当前状态：
（仍在运行 / 已隔离 / 已清理 / 观察中）

已确认事实：
（进程、连接、crontab、公钥、日志，附命令输出）

已采取动作：
（隔离、取证、杀进程、清 cron、改密、关隧道）

影响与风险：
（算力、数据、账号、横向范围）

待确认事项：
（root 是否失陷、其他主机、数据是否外传）

需要谁决策：
（管理员 / 指导教师 / 实验室负责人）
```

### 沟通注意

- 不在公开群聊、朋友圈、GitHub issue 中讨论细节。
- 不发样本、密码、私钥、完整公钥、内部 IP 到公开渠道。
- 不在报告中写未验证的结论；事实、推断、待确认分开写。
- 对外通报由实验室负责人决定，个人不要自行联系外部。

## 常见错误

| 错误 | 后果 | 正确做法 |
|---|---|---|
| 先重启 | 丢失内存和连接证据，持久化可能仍生效 | 先取证，再隔离。 |
| 只杀矿机进程 | cron/watchdog 下一分钟拉起 | 先切断 cron/systemd，再杀进程。 |
| 只删 `/var/tmp` | crontab 仍指向该路径 | 同时清 crontab 和进程。 |
| 只清 crontab | 运行中的进程会重写 | 杀进程和清 cron 一起做。 |
| 只改密码 | 公钥后门仍有效 | 删陌生 key，检查所有账号。 |
| 只清一台机器 | 同网段其他机器仍被控 | 全网扫描同 IOC、同密码、同公钥。 |
| 直接 `rm -rf /var/tmp/*` | 删证据、误删他人文件 | 按路径和哈希确认后删除。 |
| 用 `pkill -9 -u` | 误杀正常任务，丢失证据 | 记录 PID 后精确 kill。 |
| 在失陷主机上下载工具 | 工具可能被替换，或再次中招 | 用可信介质/另一台机器。 |
| 上传样本到公开沙箱 | 泄露数据，惊动攻击者 | 隔离环境静态分析。 |
| 清理后不复核 | 复发不知道 | 跨 cron 周期、重启、持续观察。 |
| 在 root 失陷的机器上“清理后继续用” | 无法保证干净 | 重装并从可信备份恢复。 |

---

返回[安全总览](index.md) ｜ 返回[手册首页](../index.md)

