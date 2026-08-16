# dsh-python-env

DeepSeek Harness 插件：**面向 Agent 的工作区级 Python 虚拟环境管理**。发现、创建、安装、删除虚拟环境，所有副作用严格限定在会话工作区内，绝不触碰全局 Python 环境。

## 为什么需要

DSH 沙箱会拦截 pip 依赖的两样东西：CPython 的 owner-only 临时目录（Windows 上 `ensurepip` / wheel 解包时 `[Errno 13]`）和包索引的网络访问。本插件通过平台 **subprocess 通道**（宿主进程，与 graphlint 插件同通道）执行 `python`/`pip`/`venv`，而非沙箱 shell，并以严格的工作区约束作为补偿：

- 所有路径都解析在工作区内（Windows 大小写不敏感）；
- 缓存与临时状态位于 `<工作区>/.dsh-pyenv/`；
- 命令全部为 argv 数组——不经过任何 shell 解释；
- 全局解释器 / 宿主 pip 缓存 / 系统临时目录永不被触碰；
- 网络失败时自动按镜像链重试（清华 TUNA、阿里云、中科大 USTC），并探测常见本地代理端口。

**仅依赖标准库**——不需要 uv、virtualenv 或任何其他插件。

## 工具

| 工具 | 作用 |
| ---- | ---- |
| `pyenv_discover` | 按 `pyvenv.cfg` 标记或常见命名（`.venv`、`venv`、`env`、`.env`、`virtualenv`）在工作区内最多两层深度发现环境，报告路径、解释器、版本、pip 状态。 |
| `pyenv_create` | 用 `python -m venv` 创建环境（可指定名称 / root_dir / 基础解释器；已存在则幂等返回）。 |
| `pyenv_install` | 把 `packages` 和/或 `requirements` 文件装入环境（显式指定 / 自动发现 / 自动创建 `.venv`）；pip 缺失时用 `ensurepip` 自动修复；镜像/代理回退；支持后台任务。 |
| `pyenv_remove` | 删除工作区内的真实虚拟环境（拒绝删除非环境目录）。 |

跨平台：Windows（`Scripts\python.exe`）、macOS/Linux（`bin/python`）。

## 安装

```sh
dsh plugin --profile <profile> add link:<本仓库绝对路径>
```

（标准 web 配置名为 `web`。）随后重启 DSH 宿主（或重载插件）使 bundle 行生效。Agent 会话中即出现 `pyenv_discover` / `pyenv_create` / `pyenv_install` / `pyenv_remove` 四个工具与 `python-env` 技能。

## 快速上手（Agent 侧）

```text
pyenv_create                                  # -> 创建 .venv 并报告解释器路径
pyenv_install { packages: ["pytest>=8"] }     # 装入 .venv
pyenv_install { requirements: "requirements.txt" }
pyenv_discover                                # 查看全部环境
# 用报告的解释器路径运行代码，如 <ws>\.venv\Scripts\python.exe
```

## 开发

```sh
# 测试（无需 DSH 运行时；平台服务由 mock 替身）
node --test --test-isolation=none "test/*.test.js"
```

本地开发通过 profile 的 node_modules（junction）或 `npm install` 解析 `@deepseek-ai/dsh-tools`。架构详见 [docs/design.md](docs/design.md)，威胁模型见 [SECURITY.md](SECURITY.md)。

## 许可证

MIT
