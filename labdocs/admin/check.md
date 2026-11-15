# 一键巡检脚本

## 用途

这份文档把实验室现有的 OpenStack、宿主机、GPU、Cinder、交换机、路由器和安全检查脚本整合成一个只读巡检工具。运行一次，会在本地生成一份带时间戳的 Markdown 报告，记录当时各模块的状态、关键配置和原始命令输出。

它适合三类场景：

- 日常巡检：每周或每月跑一次，留一份可追溯的检查记录。
- 变更前后：升级、改网络、改存储、迁移实例前后各跑一次，对比结果。
- 故障排查：出问题时先跑一次，保留现场，再开始处理。

脚本只执行查询命令，不修改设备配置、不重启服务、不写入远端文件。

## 检查范围

| 模块 | 检查内容 |
|---|---|
| OpenStack | Nova、Neutron、Cinder 服务状态，Hypervisor、实例、卷、网络、子网、路由器、浮动 IP、安全组、项目、规格、镜像、主机聚合。 |
| 控制节点 | Docker、Pacemaker、Corosync，failed unit，根分区，chrony。 |
| 计算节点 | host50–host54 的 Nova/Cinder/Neutron 服务、failed unit、libvirt 实例、bond0、VLAN、地址、默认路由、chrony、根分区、Cinder thin pool、iSCSI、ufw、SSH 基线。 |
| GPU | 两台 GPU 虚拟机的 `nvidia-smi`、显卡数量、显存、利用率、温度、根分区和 `/data`。 |
| 存储 | host50、host51 的 Cinder thin pool 使用率，iSCSI 会话，host52–54 无本地后端的状态。 |
| 核心交换机 | 版本、接口、BAGG1–5、GE1/0/47、LACP、VLAN、默认路由、NTP、DHCP 地址池、ACL 3000。 |
| 出口路由器 | 型号、接口地址、默认路由、回程路由、IPv6 默认路由。 |
| 安全基线 | 五台 BMC 的 443 端口、Horizon 的 80 端口；SSH 基线和入侵排查见[安全](../safety/index.md)。 |

## 运行前准备

### 依赖

- Python 3.8 或更高版本。
- `paramiko`：

```bash
pip install paramiko
```

脚本在管理员电脑或控制节点上运行，需要能访问控制节点、五台宿主机、核心交换机、出口路由器和 BMC。地址全部从环境变量读取，默认值使用 RFC 5737 文档网段，只用于演示：

| 变量 | 用途 | 默认值 |
|---|---|---|
| `LAB_CTRL_IP` | 控制节点 | `192.0.2.10` |
| `LAB_HOSTS` | 宿主机编号，逗号分隔 | `50,51,52,53,54` |
| `LAB_HOST_NET_PREFIX` | 宿主机管理地址前缀 | `192.0.2.` |
| `LAB_HOST_INNER_PREFIX` | 宿主机内部地址前缀 | `198.51.100.` |
| `LAB_GATEWAY` | 宿主机默认网关 | `192.0.2.1` |
| `LAB_SWITCH_IP` | 核心交换机 | `192.0.2.11` |
| `LAB_ROUTER_IP` | 出口路由器 | `192.0.2.12` |
| `LAB_ROUTER_LAN_IP` | 路由器内网接口 | `192.0.2.254` |
| `LAB_DHCP_GATEWAY` | VLAN3714 DHCP 网关 | `192.0.2.253` |
| `LAB_RETURN_ROUTES` | 路由器回程网段，逗号分隔 | `198.51.100.0/24,203.0.113.0/24` |
| `LAB_GPU_VM_1`、`LAB_GPU_VM_2` | 两台 GPU 虚拟机（可选） | `192.0.2.21`、`192.0.2.22` |
| `LAB_BMC_1`–`LAB_BMC_5` | 五台 BMC（只探 443 端口） | `192.0.2.31`–`192.0.2.35` |
| `LAB_OS_AUTH_URL` | OpenStack 认证地址 | `http://192.0.2.10:5000/v3` |

### 登录信息

脚本不保存任何账号或口令，运行时从环境变量读取，未设置时在终端交互输入。变量名和默认值见脚本开头；不要把真实账号、口令或执行人姓名写进文档、脚本或报告。

```bash
python3 check_lab.py -o check-YYYYMMDD-HHMMSS.md
```

执行人可以通过环境变量 `LAB_OPERATOR` 或参数 `--operator` 指定；文档示例只使用占位符。

不指定 `-o` 时，报告默认写到当前目录的 `check-YYYYMMDD-HHMMSS.md`。

## 参数

| 参数 | 作用 |
|---|---|
| `-o` / `--output` | 指定输出 Markdown 文件。 |
| `--operator` | 指定报告中的执行人。 |
| `--skip-openstack` | 跳过 OpenStack 检查。 |
| `--skip-control` | 跳过控制节点检查。 |
| `--skip-hosts` | 跳过 host50–host54 检查。 |
| `--skip-gpu` | 跳过 GPU 虚拟机检查。 |
| `--skip-switch` | 跳过 H3C 交换机检查。 |
| `--skip-router` | 跳过出口路由器检查。 |

例如只检查网络设备：

```bash
python3 check_lab.py --skip-openstack --skip-control --skip-hosts --skip-gpu -o check-network.md
```

## 判定规则

| 结果 | 含义 |
|---|---|
| `FAIL` | 影响平台可用性的问题：SSH/API 不可达、Nova/Neutron/Hypervisor 异常、必需服务未运行、bond0 或 br3704 DOWN、默认路由缺失、根分区或 thin pool 达到 90%、GPU 少于两张、GPU 根分区达到 90%。 |
| `WARN` | 需要关注但未必立即中断服务：Cinder 服务 down、Cinder 卷 error、failed unit、bond 成员低于 1Gbps、chrony 未同步、ufw inactive、SSH 允许 root 密码登录、根分区或 thin pool 达到 80%、LACP 成员未 Selected、VLAN 或回程路由缺失、NTP 未同步、DHCP 地址池缺失、BMC/Horizon 端口不可达。 |
| `INFO` | 数量统计、实例列表、GPU 利用率/温度、iSCSI 会话等参考信息。 |
| `OK` | 该项没有发现 WARN 或 FAIL。 |

报告里的 `WARN` 不是“必须马上修”，而是“需要人看一眼”。例如 host52–host54 没有本地 Cinder 后端，`cinder-volume` 不运行是设计使然，脚本会把它标成正常或 INFO，不会误报。

## 报告结构

生成的 Markdown 包含：

1. 检查开始/结束时间、执行人、检查范围和只读说明。
2. 结果总览表：每个模块的状态和最多三条关注项。
3. 需要关注：所有 WARN/FAIL 的逐条列表。
4. 各模块明细表：OpenStack、控制节点、计算节点、GPU、存储、核心交换机、出口路由器、安全基线。
5. 原始输出：按主机/设备折叠的命令输出，便于复核。

报告包含当时的使用率、显存占用、链路速率和服务状态。这些是时间节点数据，不是长期配置，不要直接提交到 `labdocs/` 或当作永久基线。

## 脚本

把下面的代码保存为 `check_lab.py`。脚本约 800 行，建议单独存放，不要和手册正文混在一个文件里。

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SCUPI CSLAB read-only health check.

Collects OpenStack, host, GPU, switch and router state, then writes a
timestamped Markdown report. Every remote command is a query. The script
does not change configuration, restart services or write to devices.
"""

import argparse
import csv
import datetime
import getpass
import html
import json
import os
import re
import shlex
import socket
import sys
import time
from pathlib import Path

import paramiko
from paramiko import Transport

# H3C S5120V3 uses an old ssh-rsa host key. This only changes the client's
# preferred key list; it does not change the switch.
if "ssh-rsa" not in Transport._preferred_keys:
    Transport._preferred_keys = tuple(Transport._preferred_keys) + ("ssh-rsa",)

# 设备地址从环境变量读取。默认值使用 RFC 5737 文档网段，仅用于演示；
# 实际巡检前按现场环境设置 LAB_* 变量，或修改下面的默认值。
CTRL_IP = os.environ.get("LAB_CTRL_IP", "192.0.2.10")
SWITCH_IP = os.environ.get("LAB_SWITCH_IP", "192.0.2.11")
ROUTER_IP = os.environ.get("LAB_ROUTER_IP", "192.0.2.12")
HOSTS = [int(x) for x in os.environ.get("LAB_HOSTS", "50,51,52,53,54").split(",") if x.strip()]
HOST_NET_PREFIX = os.environ.get("LAB_HOST_NET_PREFIX", "192.0.2.")
HOST_INNER_PREFIX = os.environ.get("LAB_HOST_INNER_PREFIX", "198.51.100.")
GATEWAY = os.environ.get("LAB_GATEWAY", "192.0.2.1")
ROUTER_LAN_IP = os.environ.get("LAB_ROUTER_LAN_IP", "192.0.2.254")
DHCP_GATEWAY = os.environ.get("LAB_DHCP_GATEWAY", "192.0.2.253")
RETURN_ROUTES = [x.strip() for x in os.environ.get(
    "LAB_RETURN_ROUTES", "198.51.100.0/24,203.0.113.0/24").split(",") if x.strip()]
GPU_VMS = {
    "gpu-vm-1": os.environ.get("LAB_GPU_VM_1", "192.0.2.21"),
    "gpu-vm-2": os.environ.get("LAB_GPU_VM_2", "192.0.2.22"),
}
BMC_IPS = [os.environ.get(f"LAB_BMC_{i}", f"192.0.2.{30 + i}") for i in range(1, 6)]
SECTION_ORDER = ["OpenStack", "控制节点", "计算节点", "GPU", "存储", "核心交换机", "出口路由器", "安全基线"]
STATUS_RANK = {"OK": 0, "INFO": 0, "WARN": 1, "FAIL": 2}


# --------------------------------------------------------------------- helpers
def now_text():
    return datetime.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %z")


def env(name, default=None):
    value = os.environ.get(name)
    return value if value else default


def secret(name, prompt):
    value = os.environ.get(name)
    if value:
        return value
    try:
        return getpass.getpass(prompt)
    except (EOFError, KeyboardInterrupt):
        print(f"\n缺少环境变量 {name}，且无法交互输入。", file=sys.stderr)
        raise SystemExit(2)


def ssh_exec(ip, user, password, command, timeout=60):
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.WarningPolicy())
    try:
        client.connect(
            ip,
            username=user,
            password=password,
            timeout=12,
            banner_timeout=12,
            auth_timeout=12,
            look_for_keys=False,
            allow_agent=False,
        )
        _, stdout, stderr = client.exec_command(command, timeout=timeout)
        return stdout.read().decode(errors="replace") + stderr.read().decode(errors="replace")
    finally:
        client.close()


def split_marked(text, marker="==="):
    """Split output containing ===NAME=== markers into {NAME: text}."""
    parts = re.split(r"^" + re.escape(marker) + r"([A-Z0-9_]+)" + re.escape(marker) + r"\s*$", text, flags=re.M)
    result = {}
    for i in range(1, len(parts) - 1, 2):
        result[parts[i]] = parts[i + 1].strip()
    return result


def split_switch(text):
    """Split Comware output containing ===== command ===== markers."""
    parts = re.split(r"^=====\s*(.*?)\s*=====\s*$", text, flags=re.M)
    result = {}
    for i in range(1, len(parts) - 1, 2):
        result[parts[i].strip()] = parts[i + 1].strip()
    return result


def json_list(text):
    start = text.find("[")
    end = text.rfind("]")
    if start < 0 or end <= start:
        raise ValueError("no JSON array in output")
    return json.loads(text[start:end + 1])


def pct(value):
    try:
        return float(str(value).replace("%", "").strip())
    except (TypeError, ValueError):
        return None


def md_cell(text):
    return str(text).replace("|", "\\|").replace("\n", "<br>")


def add(findings, section, item, status, detail):
    findings.append({"section": section, "item": item, "status": status, "detail": detail})


def section_status(findings, section):
    levels = [f["status"] for f in findings if f["section"] == section]
    if not levels:
        return "INFO"
    return max(levels, key=lambda s: STATUS_RANK.get(s, 0))


def overall_status(findings):
    levels = [f["status"] for f in findings]
    if not levels:
        return "INFO"
    return max(levels, key=lambda s: STATUS_RANK.get(s, 0))


def render_table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    for row in rows:
        out.append("| " + " | ".join(md_cell(c) for c in row) + " |")
    return "\n".join(out)


def details(title, text, limit=12000):
    text = (text or "").strip()
    if len(text) > limit:
        text = text[:limit] + f"\n...（已截断，原长度 {len(text)} 字符）"
    return (
        f"<details><summary>{html.escape(title)}</summary>\n\n"
        f"<pre>{html.escape(text)}</pre>\n\n</details>"
    )


# --------------------------------------------------------------------- OpenStack
OS_QUERIES = [
    ("compute-services", "compute service list -f json"),
    ("network-agents", "network agent list -f json"),
    ("volume-services", "volume service list -f json"),
    ("hypervisors", "hypervisor list --long -f json"),
    ("servers", "server list --all-projects --long -f json"),
    ("volumes", "volume list --all-projects --long -f json"),
    ("networks", "network list --long -f json"),
    ("subnets", "subnet list --long -f json"),
    ("routers", "router list --long -f json"),
    ("floating-ips", "floating ip list --long -f json"),
    ("security-groups", "security group list --all-projects -f json"),
    ("projects", "project list -f json"),
    ("flavors", "flavor list --long -f json"),
    ("images", "image list --long -f json"),
    ("aggregates", "aggregate list --long -f json"),
]


def collect_openstack(cfg, findings, raw):
    print("  OpenStack ...")
    os_env = (
        f"export OS_AUTH_URL={shlex.quote(cfg['os_auth_url'])} "
        f"OS_USER_DOMAIN_NAME=Default OS_PROJECT_DOMAIN_ID=default "
        f"OS_IDENTITY_API_VERSION=3 OS_USERNAME={shlex.quote(cfg['os_user'])} "
        f"OS_PASSWORD={shlex.quote(cfg['os_password'])} "
        f"OS_PROJECT_NAME={shlex.quote(cfg['os_project'])} OS_INTERFACE=internal; "
    )
    data = {}
    for key, query in OS_QUERIES:
        command = os_env + "openstack " + query
        try:
            text = ssh_exec(
                CTRL_IP, cfg["ctrl_user"], cfg["ctrl_password"],
                "bash -c " + shlex.quote(command), timeout=60,
            )
        except Exception as exc:
            add(findings, "OpenStack", key, "FAIL", f"采集失败：{type(exc).__name__}: {exc}")
            raw[f"openstack-{key}"] = ""
            continue
        raw[f"openstack-{key}"] = text
        try:
            data[key] = json_list(text)
        except Exception:
            add(findings, "OpenStack", key, "WARN", "输出不是有效 JSON，已保留原始输出")
            continue

    services = data.get("compute-services", [])
    bad = [s for s in services if s.get("State") != "up" or s.get("Status") != "enabled"]
    add(findings, "OpenStack", "Nova 服务",
        "WARN" if bad else "OK",
        f"{len(services)} 条，异常 {len(bad)} 条" + (f"：{', '.join(s.get('Host','?') for s in bad)}" if bad else ""))

    agents = data.get("network-agents", [])
    bad = [a for a in agents if not a.get("Alive")]
    add(findings, "OpenStack", "Neutron agent",
        "FAIL" if bad else "OK",
        f"{len(agents)} 条，Alive 异常 {len(bad)} 条" + (f"：{', '.join(a.get('Host','?') for a in bad)}" if bad else ""))

    volumes = data.get("volume-services", [])
    bad = [v for v in volumes if v.get("State") != "up"]
    add(findings, "OpenStack", "Cinder 服务",
        "WARN" if bad else "OK",
        f"{len(volumes)} 条，down {len(bad)} 条" + (f"：{', '.join(v.get('Binary','?') + ' (' + v.get('Host','?') + ')' for v in bad)}" if bad else ""))

    hypers = data.get("hypervisors", [])
    bad = [h for h in hypers if h.get("State") != "up"]
    add(findings, "OpenStack", "Hypervisor",
        "FAIL" if bad else "OK",
        f"{len(hypers)} 台，异常 {len(bad)} 台" + (f"：{', '.join(h.get('Hypervisor Hostname','?') for h in bad)}" if bad else ""))

    servers = data.get("servers", [])
    bad = [s for s in servers if s.get("Status") != "ACTIVE"]
    add(findings, "OpenStack", "实例",
        "WARN" if bad else "OK",
        f"{len(servers)} 台，非 ACTIVE {len(bad)} 台" + (f"：{', '.join(s.get('Name','?') for s in bad)}" if bad else ""))

    vols = data.get("volumes", [])
    bad = [v for v in vols if v.get("Status") == "error"]
    add(findings, "OpenStack", "Cinder 卷",
        "WARN" if bad else "OK",
        f"{len(vols)} 个，error {len(bad)} 个" + (f"：{', '.join(v.get('ID','?')[:8] for v in bad)}" if bad else ""))

    for key, label, status in [
        ("networks", "网络", "INFO"),
        ("subnets", "子网", "INFO"),
        ("routers", "路由器", "INFO"),
        ("floating-ips", "浮动 IP", "INFO"),
        ("security-groups", "安全组", "INFO"),
        ("projects", "项目", "INFO"),
        ("flavors", "规格", "INFO"),
        ("images", "镜像", "INFO"),
        ("aggregates", "主机聚合", "INFO"),
    ]:
        if key in data:
            add(findings, "OpenStack", label, status, f"{len(data[key])} 个")


# --------------------------------------------------------------------- control node
CTRL_COMMAND = "; ".join([
    "echo ===HOSTNAME===; hostname",
    "echo ===DATE===; date -Is",
    "echo ===UPTIME===; uptime",
    "echo ===SERVICES===; systemctl is-active docker pacemaker corosync",
    "echo ===FAILED===; systemctl --failed --no-pager 2>&1 | head -20",
    "echo ===DF===; df -P -h / 2>&1",
    "echo ===CHRONY===; chronyc tracking 2>&1 | head -20",
])


def check_ctrl(cfg, findings, raw):
    print("  控制节点 ...")
    try:
        text = ssh_exec(CTRL_IP, cfg["ctrl_user"], cfg["ctrl_password"], CTRL_COMMAND, timeout=60)
    except Exception as exc:
        add(findings, "控制节点", "SSH", "FAIL", f"采集失败：{type(exc).__name__}: {exc}")
        raw["control-node"] = ""
        return
    raw["control-node"] = text
    parts = split_marked(text)

    states = [x for x in parts.get("SERVICES", "").splitlines() if x.strip()]
    names = ["docker", "pacemaker", "corosync"]
    state_map = dict(zip(names, states))
    bad = [f"{n}={state_map.get(n, 'missing')}" for n in names if state_map.get(n) != "active"]
    add(findings, "控制节点", "容器/集群服务",
        "FAIL" if bad else "OK",
        ", ".join(bad) if bad else "docker、pacemaker、corosync 正常")

    failed = parts.get("FAILED", "")
    failed_units = re.findall(r"([\w@.-]+\.service)\s+loaded failed failed", failed)
    add(findings, "控制节点", "failed unit",
        "WARN" if failed_units else "OK",
        ", ".join(failed_units) if failed_units else "无 failed unit")

    df = parts.get("DF", "")
    m = re.search(r"(\d+)%\s+/$", df, re.M)
    use = int(m.group(1)) if m else None
    add(findings, "控制节点", "根分区",
        "FAIL" if use is not None and use >= 90 else ("WARN" if use is not None and use >= 80 else "OK"),
        f"/ 使用率 {use}%" if use is not None else "无法解析 df 输出")

    chrony = parts.get("CHRONY", "")
    chrony_ok = "Leap status     : Normal" in chrony or "Leap status : Normal" in chrony
    add(findings, "控制节点", "时间同步",
        "OK" if chrony_ok else "WARN",
        "Leap status Normal" if chrony_ok else "chrony 未同步或未解析")


# --------------------------------------------------------------------- hosts
HOST_COMMAND = "; ".join([
    "echo ===HOSTNAME===; hostname",
    "echo ===DATE===; date -Is",
    "echo ===UPTIME===; uptime",
    "echo ===SERVICES===; systemctl is-active nova-compute cinder-volume neutron-linuxbridge-agent",
    "echo ===FAILED===; systemctl --failed --no-pager 2>&1 | head -20",
    "echo ===VIRSH===; virsh list --all 2>&1",
    "echo ===LINK===; ip -br link",
    "echo ===ADDR===; ip -br addr",
    "echo ===ROUTE===; ip route",
    "echo ===BOND===; cat /proc/net/bonding/bond0 2>/dev/null | head -80",
    "echo ===CHRONY===; chronyc tracking 2>&1 | head -20",
    "echo ===DF===; df -P -h / 2>&1",
    "echo ===VGS===; vgs 2>&1",
    "echo ===LVS===; lvs -o vg_name,lv_name,lv_size,data_percent,metadata_percent 2>&1 | head -60",
    "echo ===ISCSI===; iscsiadm -m session 2>&1",
    "echo ===SS===; ss -ltn 2>&1 | head -30",
    "echo ===UFW===; ufw status 2>&1",
    "echo ===SSHD===; sshd -T 2>/dev/null | grep -Ei '^(permitrootlogin|passwordauthentication|pubkeyauthentication)'",
    "echo ===FREE===; free -m",
])


def collect_host(host, cfg):
    ip = f"{HOST_NET_PREFIX}{host}"
    text = ssh_exec(ip, cfg["host_user"], cfg["host_password"], HOST_COMMAND, timeout=100)
    return host, text


def check_host(host, text, findings, raw):
    sec = "计算节点"
    parts = split_marked(text)
    raw[f"host{host}"] = text

    services = [x for x in parts.get("SERVICES", "").splitlines() if x.strip()]
    names = ["nova-compute", "cinder-volume", "neutron-linuxbridge-agent"]
    service_state = dict(zip(names, services))
    problems = []
    for name in names:
        state = service_state.get(name, "missing")
        if name == "cinder-volume" and host not in (50, 51):
            continue
        if state != "active":
            problems.append(f"{name}={state}")
    if problems:
        service_detail = ", ".join(problems)
    elif host in (50, 51):
        service_detail = "nova-compute、cinder-volume、neutron-linuxbridge-agent 正常"
    else:
        service_detail = "nova-compute、neutron-linuxbridge-agent 正常；cinder-volume 不运行（无本地后端）"
    add(findings, sec, f"host{host} 服务",
        "FAIL" if problems else "OK", service_detail)

    failed = parts.get("FAILED", "")
    failed_units = re.findall(r"([\w@.-]+\.service)\s+loaded failed failed", failed)
    add(findings, sec, f"host{host} failed unit",
        "WARN" if failed_units else "OK",
        ", ".join(failed_units) if failed_units else "无 failed unit")

    virsh = parts.get("VIRSH", "")
    running = [x.strip() for x in virsh.splitlines() if "running" in x]
    add(findings, sec, f"host{host} 虚拟机",
        "INFO", f"{len(running)} 台 running：" + ", ".join(running) if running else "0 台 running")

    link = parts.get("LINK", "")
    link_up = {line.split()[0]: line for line in link.splitlines() if line.strip()}
    missing = []
    for name in ("bond0", "br3704"):
        line = link_up.get(name, "")
        if "UP" not in line:
            missing.append(name)
    add(findings, sec, f"host{host} 链路",
        "FAIL" if missing else "OK",
        "缺少或 DOWN：" + ", ".join(missing) if missing else "bond0、br3704 UP")

    addr = parts.get("ADDR", "")
    need = [f"{HOST_NET_PREFIX}{host}", f"{HOST_INNER_PREFIX}{host}"]
    missing = [a for a in need if a not in addr]
    add(findings, sec, f"host{host} 地址",
        "FAIL" if missing else "OK",
        "缺少：" + ", ".join(missing) if missing else "管理地址和内部地址存在")

    route = parts.get("ROUTE", "")
    default_route = f"default via {GATEWAY}"
    add(findings, sec, f"host{host} 默认路由",
        "OK" if default_route in route else "FAIL",
        f"默认路由指向 {GATEWAY}" if default_route in route else f"未看到默认路由 {GATEWAY}")

    bond = parts.get("BOND", "")
    speeds = [int(x) for x in re.findall(r"Speed:\s*(\d+)\s*Mbps", bond)]
    status_ok = "MII Status: up" in bond
    slow = [s for s in speeds if s < 1000]
    bond_status = "FAIL" if not status_ok else ("WARN" if slow else "OK")
    add(findings, sec, f"host{host} bond0", bond_status,
        ("MII down" if not status_ok else f"成员速率：{', '.join(str(s) + 'Mbps' for s in speeds) or '未解析'}"))

    chrony = parts.get("CHRONY", "")
    chrony_ok = "Leap status     : Normal" in chrony or "Leap status : Normal" in chrony
    add(findings, sec, f"host{host} 时间同步",
        "OK" if chrony_ok else "WARN",
        "Leap status Normal" if chrony_ok else "chrony 未同步或未解析")

    df = parts.get("DF", "")
    m = re.search(r"(\d+)%\s+/$", df, re.M)
    use = int(m.group(1)) if m else None
    if use is None:
        add(findings, sec, f"host{host} 根分区", "WARN", "无法解析 df 输出")
    else:
        add(findings, sec, f"host{host} 根分区",
            "FAIL" if use >= 90 else ("WARN" if use >= 80 else "OK"), f"/ 使用率 {use}%")

    lvs = parts.get("LVS", "")
    pool = next((line for line in lvs.splitlines() if "cinder-volumes-pool" in line), "")
    pcts = re.findall(r"(\d+\.\d+)\s+(\d+\.\d+)\s*$", pool)
    if pcts:
        data_pct, meta_pct = map(float, pcts[-1])
        status = "FAIL" if max(data_pct, meta_pct) >= 90 else ("WARN" if max(data_pct, meta_pct) >= 80 else "OK")
        add(findings, "存储", f"host{host} Cinder thin pool", status,
            f"Data {data_pct:.2f}%，Meta {meta_pct:.2f}%")
    elif host in (50, 51):
        add(findings, "存储", f"host{host} Cinder thin pool", "WARN", "未解析到 cinder-volumes-pool")
    else:
        add(findings, "存储", f"host{host} Cinder thin pool", "INFO", "无本地 Cinder 后端")

    iscsi = parts.get("ISCSI", "")
    sessions = [x for x in iscsi.splitlines() if x.strip() and "No active" not in x]
    add(findings, "存储", f"host{host} iSCSI", "INFO", f"{len(sessions)} 条会话")

    ufw = parts.get("UFW", "")
    add(findings, sec, f"host{host} ufw",
        "WARN" if "Status: inactive" in ufw else "OK",
        "ufw inactive" if "Status: inactive" in ufw else "ufw 状态已采集")

    sshd = parts.get("SSHD", "").lower()
    ssh_risks = []
    if "permitrootlogin yes" in sshd:
        ssh_risks.append("PermitRootLogin yes")
    if "passwordauthentication yes" in sshd:
        ssh_risks.append("PasswordAuthentication yes")
    add(findings, sec, f"host{host} SSH 基线",
        "WARN" if ssh_risks else "OK",
        ", ".join(ssh_risks) if ssh_risks else "未发现 root 密码直登")


def collect_hosts(cfg, findings, raw):
    print("  计算节点 ...")
    for host in HOSTS:
        try:
            _, text = collect_host(host, cfg)
            check_host(host, text, findings, raw)
        except Exception as exc:
            add(findings, "计算节点", f"host{host}", "FAIL", f"采集失败：{type(exc).__name__}: {exc}")
            raw[f"host{host}"] = ""


# --------------------------------------------------------------------- GPU
GPU_COMMAND = "; ".join([
    "echo ===HOSTNAME===; hostname",
    "echo ===DATE===; date -Is",
    "echo ===GPU===; nvidia-smi -L 2>&1",
    "echo ===GPUQ===; nvidia-smi --query-gpu=index,name,memory.total,memory.used,utilization.gpu,temperature.gpu --format=csv,noheader 2>&1",
    "echo ===DF===; df -P -h / /data 2>&1",
    "echo ===FREE===; free -m",
])


def collect_gpu(cfg, findings, raw):
    print("  GPU 虚拟机 ...")
    if not cfg["vm_password"]:
        add(findings, "GPU", "GPU 检查", "WARN", "未提供虚拟机口令，已跳过")
        return
    for name, ip in GPU_VMS.items():
        try:
            text = ssh_exec(ip, cfg["vm_user"], cfg["vm_password"], GPU_COMMAND, timeout=60)
        except Exception as exc:
            add(findings, "GPU", name, "FAIL", f"采集失败：{type(exc).__name__}: {exc}")
            raw[name] = ""
            continue
        raw[name] = text
        parts = split_marked(text)
        gpu_lines = [x for x in parts.get("GPU", "").splitlines() if x.startswith("GPU ")]
        add(findings, "GPU", f"{name} 显卡",
            "OK" if len(gpu_lines) >= 2 else "FAIL",
            f"识别到 {len(gpu_lines)} 张卡" + (f"：{'; '.join(gpu_lines)}" if gpu_lines else ""))

        rows = []
        for row in csv.reader(parts.get("GPUQ", "").splitlines()):
            if len(row) >= 6 and row[0].strip().isdigit():
                rows.append(row)
        if rows:
            for row in rows:
                add(findings, "GPU", f"{name} GPU{row[0].strip()}",
                    "INFO", f"{row[1].strip()}，显存 {row[2].strip()}，已用 {row[3].strip()}，利用率 {row[4].strip()}，温度 {row[5].strip()}")
        else:
            add(findings, "GPU", f"{name} 运行状态", "WARN", "无法解析 nvidia-smi 查询输出")

        df = parts.get("DF", "")
        for mount in ("/", "/data"):
            m = re.search(r"(\d+)%\s+" + re.escape(mount) + r"$", df, re.M)
            if m:
                use = int(m.group(1))
                add(findings, "GPU", f"{name} {mount}",
                    "FAIL" if use >= 90 else ("WARN" if use >= 80 else "OK"), f"使用率 {use}%")


# --------------------------------------------------------------------- switch
SWITCH_COMMANDS = [
    "display clock",
    "display version",
    "display interface brief",
    "display ip interface brief",
    "display vlan brief",
    "display link-aggregation verbose",
    "display ip routing-table",
    "display ntp-service status",
    "display dhcp server pool",
    "display acl all",
    "display logbuffer",
]


def switch_shell(ip, user, password, commands, timeout=30):
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.WarningPolicy())
    try:
        client.connect(ip, username=user, password=password, timeout=15,
                       banner_timeout=15, auth_timeout=15,
                       look_for_keys=False, allow_agent=False)
        channel = client.invoke_shell()
        time.sleep(2)
        while channel.recv_ready():
            channel.recv(65535)
        channel.send("screen-length disable\n")  # current VTY session only
        time.sleep(2)
        while channel.recv_ready():
            channel.recv(65535)
        buf = []
        for command in commands:
            buf.append(f"\n===== {command} =====\n")
            channel.send(command + "\n")
            time.sleep(2.5)
            while channel.recv_ready():
                buf.append(channel.recv(65535).decode(errors="replace"))
                time.sleep(0.1)
        time.sleep(1)
        while channel.recv_ready():
            buf.append(channel.recv(65535).decode(errors="replace"))
        return "".join(buf)
    finally:
        client.close()


def check_switch(cfg, findings, raw):
    print("  核心交换机 ...")
    try:
        text = switch_shell(SWITCH_IP, cfg["switch_user"], cfg["switch_password"], SWITCH_COMMANDS)
    except Exception as exc:
        add(findings, "核心交换机", "SSH", "FAIL", f"采集失败：{type(exc).__name__}: {exc}")
        raw["switch"] = ""
        return
    raw["switch"] = text
    parts = split_switch(text)

    version = parts.get("display version", "")
    add(findings, "核心交换机", "版本",
        "OK" if "S5120V3-54S-EI" in version else "WARN",
        "S5120V3-54S-EI" if "S5120V3-54S-EI" in version else "未识别到型号")

    intf = parts.get("display interface brief", "")
    bagg_ok = all(re.search(rf"^{name}\s+UP\b", intf, re.M) for name in ["BAGG1", "BAGG2", "BAGG3", "BAGG4", "BAGG5"])
    add(findings, "核心交换机", "BAGG1–BAGG5",
        "OK" if bagg_ok else "FAIL",
        "全部 UP" if bagg_ok else "存在 DOWN 的聚合口")
    add(findings, "核心交换机", "GE1/0/47 上联",
        "OK" if re.search(r"^GE1/0/47\s+UP\b", intf, re.M) else "FAIL",
        "UP" if re.search(r"^GE1/0/47\s+UP\b", intf, re.M) else "未 UP")

    lacp = parts.get("display link-aggregation verbose", "")
    unselected = [
        line for line in re.findall(r"^\s+GE1/0/\d+.*\sU\s", lacp, re.M)
        if not re.search(r"GE1/0/(11|12)\b", line)
    ]
    add(findings, "核心交换机", "LACP 成员",
        "WARN" if unselected else "OK",
        f"{len(unselected)} 个成员未 Selected" if unselected else "BAGG1–BAGG5 成员均已 Selected")

    vlan = parts.get("display vlan brief", "")
    need_vlans = [3701, 3702, 3703, 3704, 3705, 3710, 3711, 3713, 3714]
    missing = [str(v) for v in need_vlans if not re.search(rf"\b{v}\b", vlan)]
    add(findings, "核心交换机", "VLAN",
        "FAIL" if missing else "OK",
        "缺少：" + ", ".join(missing) if missing else "3701、3702、3703、3704、3705、3710、3711、3713、3714 存在")

    route = parts.get("display ip routing-table", "")
    route_ok = "0.0.0.0/0" in route and ROUTER_LAN_IP in route
    add(findings, "核心交换机", "默认路由",
        "OK" if route_ok else "FAIL",
        f"0.0.0.0/0 → {ROUTER_LAN_IP}" if route_ok else f"未看到默认路由 {ROUTER_LAN_IP}")

    ntp = parts.get("display ntp-service status", "")
    add(findings, "核心交换机", "NTP",
        "OK" if "Clock status: synchronized" in ntp else "WARN",
        "已同步" if "Clock status: synchronized" in ntp else "未同步或未解析")

    dhcp = parts.get("display dhcp server pool", "")
    dhcp_ok = "Pool name: vlan3714" in dhcp and f"gateway-list {DHCP_GATEWAY}" in dhcp
    add(findings, "核心交换机", "DHCP 地址池",
        "OK" if dhcp_ok else "WARN",
        "vlan3714 地址池存在" if dhcp_ok else "未解析到 vlan3714 地址池")

    acl = parts.get("display acl all", "")
    add(findings, "核心交换机", "ACL 3000",
        "INFO" if "ACL 3000" in acl or "3000" in acl else "WARN",
        "ACL 3000 存在" if "ACL 3000" in acl or "3000" in acl else "未看到 ACL 3000")


# --------------------------------------------------------------------- router
ROUTER_COMMAND = "; ".join([
    "echo ===BOARD===; ubus call system board 2>&1",
    "echo ===DATE===; date -Is 2>&1",
    "echo ===ADDR===; ip -br addr 2>&1",
    "echo ===ROUTE===; ip route 2>&1",
    "echo ===ROUTE6===; ip -6 route 2>&1",
    "echo ===LOG===; logread 2>&1 | tail -30",
])


def check_router(cfg, findings, raw):
    print("  出口路由器 ...")
    try:
        text = ssh_exec(ROUTER_IP, cfg["router_user"], cfg["router_password"], ROUTER_COMMAND, timeout=60)
    except Exception as exc:
        add(findings, "出口路由器", "SSH", "FAIL", f"采集失败：{type(exc).__name__}: {exc}")
        raw["router"] = ""
        return
    raw["router"] = text
    parts = split_marked(text)

    board = parts.get("BOARD", "")
    add(findings, "出口路由器", "型号",
        "OK" if "N60" in board else "WARN",
        "Netcore N60 Pro" if "N60" in board else "未识别到 N60")

    addr = parts.get("ADDR", "")
    missing = [a for a in (ROUTER_LAN_IP, ROUTER_IP) if a not in addr]
    add(findings, "出口路由器", "接口地址",
        "FAIL" if missing else "OK",
        "缺少：" + ", ".join(missing) if missing else f"{ROUTER_LAN_IP}、{ROUTER_IP} 存在")

    route = parts.get("ROUTE", "")
    route_ok = "default via" in route
    add(findings, "出口路由器", "默认路由",
        "OK" if route_ok else "FAIL",
        "存在默认路由" if route_ok else "未看到默认路由")
    missing_routes = [net for net in RETURN_ROUTES if net not in route]
    add(findings, "出口路由器", "回程路由",
        "WARN" if missing_routes else "OK",
        "缺少：" + ", ".join(missing_routes) if missing_routes else "回程网段齐全")

    route6 = parts.get("ROUTE6", "")
    add(findings, "出口路由器", "IPv6 默认路由",
        "OK" if "default" in route6 else "WARN",
        "存在 IPv6 默认路由" if "default" in route6 else "未看到 IPv6 默认路由")


# --------------------------------------------------------------------- reachability
def check_reachability(findings):
    print("  BMC / Horizon 端口 ...")
    reachable = 0
    for ip in BMC_IPS:
        try:
            sock = socket.create_connection((ip, 443), timeout=3)
            sock.close()
            reachable += 1
        except OSError:
            pass
    add(findings, "安全基线", "BMC 443",
        "OK" if reachable == len(BMC_IPS) else "WARN",
        f"{reachable}/{len(BMC_IPS)} 个 BMC HTTPS 端口可达")
    try:
        sock = socket.create_connection((CTRL_IP, 80), timeout=3)
        sock.close()
        add(findings, "安全基线", "Horizon 80", "OK", f"{CTRL_IP}:80 可达")
    except OSError:
        add(findings, "安全基线", "Horizon 80", "WARN", f"{CTRL_IP}:80 不可达")


# --------------------------------------------------------------------- report
def build_report(cfg, findings, raw, started):
    lines = []
    lines.append("# 实验室基础设施巡检报告")
    lines.append("")
    lines.append(f"- 检查开始：{started}")
    lines.append(f"- 检查结束：{now_text()}")
    lines.append(f"- 执行人：{cfg['operator']}")
    lines.append("- 检查范围：OpenStack、host50–host54、GPU 虚拟机、Cinder、H3C 交换机、出口路由器、BMC/Horizon 可达性。")
    lines.append("- 说明：本报告由只读脚本生成，未修改设备配置、未重启服务。容量、占用率和在线状态是本次检查时刻的值。")
    lines.append("")
    lines.append("## 结果总览")
    lines.append("")
    summary_rows = []
    for section in SECTION_ORDER:
        status = section_status(findings, section)
        issues = [f for f in findings if f["section"] == section and f["status"] in ("WARN", "FAIL")]
        summary_rows.append((section, status, "；".join(f"{f['item']}：{f['detail']}" for f in issues[:3]) or "无"))
    lines.append(render_table(["模块", "结果", "关注项"], summary_rows))
    lines.append("")
    lines.append(f"**总体结果：{overall_status(findings)}**")
    lines.append("")

    issues = [f for f in findings if f["status"] in ("WARN", "FAIL")]
    lines.append("## 需要关注")
    lines.append("")
    if issues:
        for f in issues:
            lines.append(f"- **[{f['status']}] {f['section']} / {f['item']}**：{f['detail']}")
    else:
        lines.append("- 未发现 WARN 或 FAIL。")
    lines.append("")

    for section in SECTION_ORDER:
        rows = [(f["item"], f["status"], f["detail"]) for f in findings if f["section"] == section]
        if not rows:
            continue
        lines.append(f"## {section}")
        lines.append("")
        lines.append(render_table(["检查项", "结果", "说明"], rows))
        lines.append("")

    lines.append("## 原始输出")
    lines.append("")
    for key in sorted(raw):
        if raw[key]:
            lines.append(details(key, raw[key]))
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# --------------------------------------------------------------------- main
def main():
    parser = argparse.ArgumentParser(description="SCUPI CSLAB read-only health check")
    parser.add_argument("-o", "--output", default=None, help="输出 Markdown 文件")
    parser.add_argument("--operator", default=env("LAB_OPERATOR", "实验室管理员"), help="执行人")
    parser.add_argument("--skip-gpu", action="store_true", help="跳过 GPU 虚拟机检查")
    parser.add_argument("--skip-openstack", action="store_true", help="跳过 OpenStack 检查")
    parser.add_argument("--skip-control", action="store_true", help="跳过控制节点检查")
    parser.add_argument("--skip-hosts", action="store_true", help="跳过宿主机检查")
    parser.add_argument("--skip-switch", action="store_true", help="跳过交换机检查")
    parser.add_argument("--skip-router", action="store_true", help="跳过路由器检查")
    args = parser.parse_args()

    cfg = {
        "operator": args.operator,
        "host_user": env("LAB_HOST_USER", "root"),
        "host_password": "" if args.skip_hosts else secret("LAB_HOST_PASSWORD", "宿主机 root 口令: "),
        "ctrl_user": env("LAB_CTRL_USER", "admin"),
        "ctrl_password": "" if (args.skip_control and args.skip_openstack) else secret("LAB_CTRL_PASSWORD", "控制节点 Linux 口令: "),
        "switch_user": env("LAB_SWITCH_USER", "admin"),
        "switch_password": "" if args.skip_switch else secret("LAB_SWITCH_PASSWORD", "交换机口令: "),
        "router_user": env("LAB_ROUTER_USER", "root"),
        "router_password": "" if args.skip_router else secret("LAB_ROUTER_PASSWORD", "路由器口令: "),
        "vm_user": env("LAB_VM_USER", "root"),
        "vm_password": "" if args.skip_gpu else (env("LAB_VM_PASSWORD") or secret("LAB_VM_PASSWORD", "GPU 虚拟机 root 口令: ")),
        "os_user": env("LAB_OS_USER", "admin"),
        "os_password": "" if args.skip_openstack else secret("LAB_OS_PASSWORD", "OpenStack admin 口令: "),
        "os_project": env("LAB_OS_PROJECT", "admin"),
        "os_auth_url": env("LAB_OS_AUTH_URL", f"http://{CTRL_IP}:5000/v3"),
    }

    started = now_text()
    findings = []
    raw = {}

    if not args.skip_openstack:
        collect_openstack(cfg, findings, raw)
    if not args.skip_control:
        check_ctrl(cfg, findings, raw)
    if not args.skip_hosts:
        collect_hosts(cfg, findings, raw)
    if not args.skip_gpu:
        collect_gpu(cfg, findings, raw)
    else:
        add(findings, "GPU", "GPU 检查", "INFO", "已按 --skip-gpu 跳过")
    if not args.skip_switch:
        check_switch(cfg, findings, raw)
    if not args.skip_router:
        check_router(cfg, findings, raw)
    check_reachability(findings)

    report = build_report(cfg, findings, raw, started)
    output = Path(args.output or f"check-{datetime.datetime.now():%Y%m%d-%H%M%S}.md")
    output.write_text(report, encoding="utf-8")
    print(f"报告已写入 {output}")


if __name__ == "__main__":
    main()
```

## 使用注意

- 脚本只执行 `display`、`show`、`ip`、`systemctl`、`openstack` 查询类命令，不进入 `system-view`，不执行 `save`、`reset`、`reboot`、`systemctl restart`。
- H3C 会话中的 `screen-length disable` 只对当前 VTY 会话生效，不写入启动配置。
- 交换机使用旧式 `ssh-rsa` 主机密钥。脚本在客户端临时放开 `ssh-rsa`，不修改交换机。
- 首次连接某台设备时，Paramiko 会提示未知主机密钥。确认地址正确后再接受。若要长期使用，建议把主机密钥加入 `known_hosts`。
- 脚本不会把口令写进报告。但原始输出包含内部 IP、主机名、卷 ID 和实例名，报告应按内部资料保管。
- 脚本不尝试逐个登录验证所有账号口令，避免多次失败锁定账号。
- 脚本统计安全组数量，但不逐条审计规则；需要做安全专项时，按[防护基线](../safety/hardening.md)和[入侵排查与命令](../safety/inspect.md)单独检查。
- 如果 OpenStack 命令在 JSON 前后夹杂弃用警告，脚本会截取 JSON 数组；截取失败时保留原始输出并标 WARN。
- 如果某项采集失败，报告仍会生成，失败项标为 FAIL，不会因为单台设备不可达而丢掉整份报告。
- 报告中的 Cinder 服务 down 可能包含备份服务、旧 NFS 后端等非核心服务，先看具体 `Binary (Host)` 再判断。
- 报告中的 GPU 利用率和显存占用是瞬时值，不能用来判断显卡长期健康；长期趋势需要多次巡检对比。

## 相关文档

- [运行与日常维护](maintenance.md)：巡检周期、备份、更新和变更流程。
- [安全](../safety/index.md)：挖矿入侵手法、防护基线、排查和应急处置。
- [数据存储](storage.md)：Cinder、LVM、iSCSI 和备份的解释。
- [网络架构](network.md)：VLAN、路由、DHCP/DNS 和 VXLAN。
- [核心交换机](switch.md)：端口、LACP、ACL 和面板标注。
- [风险评估与问题上报](report.md)：发现问题后怎样整理和上报。

---

返回[管理员视角总目录](index.md) ｜ 返回[手册首页](../index.md)

