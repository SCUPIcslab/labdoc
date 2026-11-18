# 服务器瓶颈排查

服务器性能下降时（例如响应时间变长、吞吐量降低，或主观感觉“卡顿”），需要排查瓶颈，确定性能问题的根源。

命令后标注“需 root”的项需要管理员权限；普通账号只能查看和调整自己的进程。本文的命令不依赖 `sysstat`，磁盘和网络数据直接读 `/proc`、`ip` 和 `ss`。

## 总体思路

排查不预设结论，按“先定性、再定位、后处理”的顺序进行。

1. **全局扫描**：同时查看 CPU、内存、磁盘、网络、GPU 的粗粒度指标，判断系统时间主要花在哪。
2. **锁定维度**：根据异常信号，进入对应资源的深入排查路径。
3. **定位进程**：找到产生压力的具体进程或连接。
4. **缓解或根治**：先降级非关键任务，保住业务，再追溯原因。

## 全局扫描

全局扫描是第一步，用于判断系统主要时间花在哪。

```bash
uptime                              # Load Average，结合 nproc 判断是否过载
nproc                               # CPU 核数，用于对比 Load
top -b -n1 | head -n5               # 负载、内存概况；CPU 各态看 vmstat
free -h                             # 内存，重点看 available 列
vmstat 1 5                          # 综合：r/b 队列、si/so 换页、wa、bi/bo
df -h                               # 各挂载点容量使用率
df -i                               # inode 使用率
cat /proc/pressure/io               # I/O 压力：some/full 的 avg10
nvidia-smi                          # GPU：利用率、显存、温度、进程（有 GPU 时）
ip -s link                          # 网络：累计收发、错误、丢包（隔几秒再采样）
```

其中：

- `wa` 持续 >20%：怀疑磁盘 I/O。
    - `wa` 高且 `bi`/`bo` 高：磁盘吞吐压力大，可能写入量大。
    - `wa` 高但 `bi`/`bo` 不高：单次 I/O 等待长，怀疑磁盘响应慢。
- `us` 高：怀疑应用计算。
- `sy` 高：怀疑内核/系统调用。
- `top` 的 `si` 高：怀疑网络软中断。
- `available` 低且 `vmstat` 的 `si/so` 非零：内存不足，系统在换页。
- `/proc/pressure/io` 的 `full avg10` 高：I/O 压力已经影响整体运行。
- `df` 接近 100%：存储容量瓶颈，而非 I/O 延迟。

::: warning 注意
`top` 的 `si` 是软中断占用的 CPU 比例，`vmstat` 的 `si/so` 是换页速率，两者含义不同。`vmstat` 的第一条数据是开机以来的平均值，从第二条数据开始才是当前采样值，判断时看后面的。
:::
## CPU 排查

```bash
ps aux --sort=-%cpu | head -10              # 按 CPU 占用排序找大户
top -H -p <PID>                             # 看进程内各线程占用，区分单线程/多线程
perf top                                    # 实时看热点函数（需 perf ）
perf record -F 99 -g -p <PID> -- sleep 30   # 采样 30 秒（需 perf ）
perf report                                 # 分析采样结果，看调用链
```

观察是单线程跑满一个核，还是多线程分摊；这决定优化方向是并行化还是单点优化。

## 内存（RAM）排查

```bash
free -h                                     # 重点看 available，不是 free
ps aux --sort=-rss | head -10               # 按物理内存占用排序
vmstat 1 5                                  # si/so 持续非零 = 在换页，内存不够
slabtop                                     # 内核对象缓存占用（需 root）
dmesg -T | grep -i oom                      # 确认是否有进程被 OOM killer 干掉（可能需要 root）
```

判断依据：`available` 低且 `si/so` 有活动，说明存在内存瓶颈。进一步区分正常缓存（可回收）和进程泄漏（用语言级工具分析堆）。

## 磁盘 I/O 排查

```bash
vmstat 1 5                                  # wa、bi/bo
grep -E "Dirty|Writeback" /proc/meminfo     # 回写积压
cat /proc/pressure/io                       # PSI：some/full 的 avg10
ps -eo pid,stat,wchan:32,cmd | awk '$2 ~ /^D/'
```

`wchan` 出现 `jbd2`、`flush`、`wait_on_page` 等关键词，基本可以确定是磁盘 I/O 等待。`/proc/pressure/io` 不存在时说明内核不支持 PSI，跳过即可。

按进程看 I/O，用 `/proc`：

```bash
cat /proc/<PID>/io | grep -E "read_bytes|write_bytes"
sleep 5
cat /proc/<PID>/io | grep -E "read_bytes|write_bytes"   # 两次差值 = 这 5 秒的读写量
```

普通账号只能读自己的进程；读别人的进程会提示权限不足。

需要单块盘的延迟和利用率时，读 `/proc/diskstats`：

```bash
awk '$3=="vda" {print $4,$7,$8,$11,$13,$14,$19,$20}' /proc/diskstats
sleep 5
awk '$3=="vda" {print $4,$7,$8,$11,$13,$14,$19,$20}' /proc/diskstats
```

`vda` 换成 `lsblk` 里看到的设备名。以下列号均指 `/proc/diskstats` 的字段：

- 第 4 列：读完成次数；第 7 列：读耗时（ms）。
- 第 8 列：写完成次数；第 11 列：写耗时（ms）。
- 第 13 列：设备忙碌时间（ms）。
- 第 14 列：加权忙碌时间（ms）。
- 第 19、20 列：flush 次数和 flush 耗时（较新内核才有）。

两次采样相减：

```text
await   = (Δ第7列 + Δ第11列) / (Δ第4列 + Δ第8列)
%util   = Δ第13列 / 采样时长（ms） * 100
aqu-sz  = Δ第14列 / 采样时长（ms）
f_await = Δ第20列 / Δ第19列
```

`%util` 低但 `await` 高，说明盘没有被打满，单次请求等待长。`Δ第19列` 为 0 时跳过 `f_await`。

## 存储容量与文件系统

```bash
df -h                                       # 各挂载点使用率
df -i                                       # inode 使用率
du -sh <目录>/* | sort -rh | head -10       # 定位大目录
lsblk                                       # 磁盘与分区结构，确认挂载是否正确
```

判断依据：使用率接近 100% 时，瓶颈可能不是 I/O 延迟，而是无法写入。从 `vmstat` 的 `wa` 和 `bi/bo` 上可能看不出异常，但应用写日志或临时文件会直接失败。inode 用尽时同样会报 `No space left on device`，即使 `df -h` 仍显示有空间。

## 网络排查

```bash
ip -s link                                  # 累计收发、错误、丢包
ss -s                                       # 连接数汇总
ss -ti                                      # 单连接窗口、RTT、重传、累计字节
nstat -az TcpOutSegs TcpRetransSegs         # TCP 发送/重传计数（iproute2）
```

`ip -s link` 是累计值，隔几秒再跑一次，两次相减再除以间隔，就是这段时间的平均收发速率；接口名用 `ip -br addr` 确认。`ss -ti` 里看 `bytes_sent`/`bytes_received` 的增长和 `retrans`，隔几秒采样两次可以判断哪个连接在占带宽。`nstat` 也是累计值，两次相减，重传数除以发送数就是重传率。没有 `nstat` 时读 `/proc/net/snmp`。

判断依据：`top` 的 `si` 高且网卡收发速率打满，说明是网络带宽瓶颈；重传率高说明链路质量问题；连接数异常可能是应用侧连接泄漏。

## GPU 排查

```bash
nvidia-smi                                  # 全局：利用率、显存、温度、功耗、进程
watch -n 2 nvidia-smi                       # 持续观察间歇性打满或显存缓慢增长
nvidia-smi -i 0 -q                          # 指定卡的详细信息（Perf 状态、功耗墙）
nvidia-smi topo -m                          # 多卡拓扑，判断 PCIe/NVLink 带宽瓶颈
```

判断依据：利用率高但吞吐上不去，查显存瓶颈或 PCIe 带宽；显存缓慢增长，疑似泄漏；温度或功耗触墙，会降频导致性能下降。

## 进程状态与内核信号

```bash
ps -eo stat,pid,comm | awk '$1 ~ /^D/'      # D 状态进程（不可中断睡眠）
ps -eo pid,stat,wchan:32,cmd | awk '$2 ~ /^D/'   # 带 wchan，看卡在哪个内核函数
cat /proc/<PID>/stack                       # 内核栈（需 root）
cat /proc/<PID>/wchan                       # 单行内核等待点
dmesg -T | grep -iE "hung|timeout|I/O error|oom"  # 内核报错（可能需要 root）
```

D 状态进程会被计入 Load Average，这是“Load 高但 CPU 闲”的常见原因。

## 处理手段

缓解（优先，不动别人的任务）：

```bash
ionice -c 3 -p <PID>                        # I/O 降到 idle 级，只在磁盘空闲时干活
renice -n 19 -p <PID>                       # CPU 优先级调低
```

以上两条命令调整自己的进程时不需要 root；调整别人的进程需要 root 权限，普通账号应先联系管理员。

限流与错峰：降低下载并发数（如 `--max-workers 1`）、避免数据集下载与编译同时运行、批处理任务避开业务高峰。

根治：查应用日志、慢查询、最近配置变更；用 `perf`/`strace` 分析进程为何产生大资源消耗；容量问题清理缓存目录（`~/.cache/pip`、`~/.conda/pkgs`）或挂载独立数据盘。

谨慎终止：`kill` 别人正在运行的任务风险高，尤其是 `tar` 打包、数据写入类进程。必须先确认任务内容并征得负责人同意。

## 完整排查示例

以“服务器卡顿”为例，不预设结论时的实际排查过程：

1. `uptime` + `nproc`：Load 11.9，32 核，不算极高但异常。
2. `vmstat` 看 CPU：idle 76%，`wa` 21.5%，初步指向 I/O。
3. `cat /proc/pressure/io`：some 93.6%、full 91.2%；另看 `/proc/pressure/cpu`，压力为 0，确认 I/O 瓶颈。
4. `ps` 筛 D 状态：出现 `jbd2/vda1-8`、`kworker/*+flush`，说明存在磁盘回写压力。
5. `vmstat` 与 `/proc/diskstats`：`bi`/`bo` 不高，但 `%util` 仅 7~22%，`await` 约 45ms，`f_await` 约 391ms。磁盘大部分时间不忙，单次请求却等很久，属于响应慢而非占满。
6. `grep Dirty /proc/meminfo`：4.6GB 且上涨，回写跟不上。
7. 读 `/proc/<PID>/io` 采样：5 秒内几乎无进程读写（普通账号只能看到自己的进程），I/O 是间歇性爆发。
8. 结合进程列表：`modelscope download`、`pip install`、`tar` 三任务叠加。
9. 处理：`ionice -c3` 降级 `tar`，建议错峰，关注磁盘 86% 使用率。

每一步的输出决定下一步走哪条路径，而不是按固定脚本跑完。

---

返回[用户视角总目录](index.md) ｜ 返回[手册首页](../index.md)
