# dsh-python-env

[English](README.md) | **中文**

> 面向 DeepSeek Harness 项目的工作区级 Python 虚拟环境管理——发现、创建、安装、删除虚拟环境，远离沙箱、网络与子进程的坑。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/Node.js-%3E%3D20-brightgreen)](https://nodejs.org/)
[![npm version](https://img.shields.io/npm/v/dsh-python-env)](https://www.npmjs.com/package/dsh-python-env)
[![GitHub issues](https://img.shields.io/github/issues/AngelosZou/dsh-python-env)](https://github.com/AngelosZou/dsh-python-env/issues)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，为每个项目（工作区）提供面向 Agent 的 Python 虚拟环境管理：

- **五个模型工具** —— `pyenv_discover`、`pyenv_create`、`pyenv_install`、`pyenv_uninstall`、`pyenv_remove`，外加 `python-env` 技能与 system-prompt 引导段。
- 通过平台 **subprocess 通道**（宿主进程）运行**标准库** `python -m venv` / `pip`，而非沙箱 shell——venv 创建、`ensurepip` 引导、包索引网络访问在 shell 侧 pip 会失败的地方照常工作。
- **镜像与代理回退** —— 网络类失败时按清华 TUNA → 阿里云 → 中科大 USTC 镜像链重试，并探测常见本地代理端口；`index` / `proxy` 参数可分别钉死。
- **工作区约束** —— 所有路径都解析在工作区内（Windows 大小写不敏感）；缓存与临时状态位于 `<工作区>/.dsh-pyenv/`；命令为 argv 数组（不经 shell）；全局 Python 环境、宿主 pip 缓存、系统临时目录永不被触碰。
- **跨平台** —— Windows / macOS / Linux 的布局与解释器链（`Scripts` 与 `bin`、`py -3` 与 `python3`）。
- **零第三方依赖** —— 不需要 uv、virtualenv 或任何其他插件；缺失 pip 的环境用 `ensurepip` 离线修复。
- **会话模式对齐** —— 写工具遵循会话沙箱模式，read-only 会话中拒绝执行；发现工具始终可用。

## 环境要求

- Node.js >= 20
- 由 `@deepseek-ai/dsh-base` 组合的 DSH profile（提供插件使用的 `subprocess`、`jobs`、`tools`、`skills` 服务）
- Python >= 3.8（在 PATH 上，或显式传入）——仅用于插件管理的环境

## 安装

从 npm：

```bash
dsh plugin --profile web add dsh-python-env
```

从本地检出（开发）：

```bash
dsh plugin --profile web add link:<本仓库绝对路径>
```

然后**重启 DSH 后端**（宿主组合在进程启动时加载）。新会话中即出现 `pyenv_discover` / `pyenv_create` / `pyenv_install` / `pyenv_remove` 四个工具与 `python-env` 技能。

## 用法

Agent 侧：

| 工具 | 作用 |
| ---- | ---- |
| `pyenv_discover` | 按 `pyvenv.cfg` 标记或常见命名（`.venv`、`venv`、`env`、`.env`、`virtualenv`）在工作区内最多两层深度发现环境，报告路径、解释器、版本、pip 状态。 |
| `pyenv_create` | 用 `python -m venv` 创建环境——支持 `name` / `root_dir` / 基础 `python` 参数，对已存在环境幂等。 |
| `pyenv_install` | 把 `packages` 和/或 `requirements` 文件装入环境（显式 `venv` / 自动发现 / 自动创建 `.venv`）；`ensurepip` 修复缺失 pip；镜像/代理回退；`upgrade` 升级；本地项目 editable 安装；`run_in_background` 支持长安装。 |
| `pyenv_uninstall` | 从环境卸载包（`pip uninstall -y`）；离线；从不自动创建环境。 |
| `pyenv_remove` | 只删除工作区内的真实环境（拒绝非环境目录与工作区逃逸）。 |

```text
pyenv_create                                  # -> 创建 .venv 并报告解释器路径
pyenv_install { packages: ["pytest>=8"] }     # 装入 .venv
pyenv_install { requirements: "requirements.txt" }
pyenv_discover                                # 查看全部环境
# 用报告的解释器路径运行代码：
#   Windows: <venv>\Scripts\python.exe    macOS/Linux: <venv>/bin/python
```

行为说明：

- 写工具（create / install / uninstall / remove）遵循会话沙箱模式，**read-only** 会话中拒绝执行；发现工具仍可用。
- 常见需求全覆盖：钉版本（`"pkg==1.2.3"`）、升级（`upgrade: true`）、按 `requirements.txt` 安装（`requirements`）、本地项目 editable 安装（`packages: ["-e", "."]`——editable 路径必须位于工作区内，远程/VCS editable URL 会被拒绝）。
- 未传 `venv` 时，`pyenv_install` 使用唯一发现的环境（优先 `.venv`），不存在则自动创建 `.venv`，存在多个则要求显式指定；`pyenv_uninstall` 从不自动创建。
- 安装结果报告每一次尝试（`index`、`proxy`、`exitCode`），安装走了哪条路一目了然。
- 后台安装注册到 jobs 运行时——用 `job_output` 轮询、`job_kill` 停止；30 分钟硬上限生效。

## 工作原理

- **Subprocess 通道** —— DSH 沙箱会拦截 CPython 的 owner-only 临时目录（Windows 上 `ensurepip` / wheel 解包时 `[Errno 13]`）与包索引网络访问。插件代码运行在宿主进程中，因此所有 python/pip/venv 调用都走 `ctx.subprocess`（与 graphlint 插件同通道）：argv 数组、字节上限的输出收集、进程树级终止。非受限 token 由下述约束模型补偿——而非削弱沙箱。
- **约束模型** —— 每个受模型影响的路径都经过 `guardWorkspacePath`（绝对解析 + 包含性判定，防 `..`）；venv 名称经单段正则校验并在 `join` 后再次守卫；子进程的 `PIP_CACHE_DIR` / TMP / TEMP / TMPDIR 重定向到 `<工作区>/.dsh-pyenv/`。
- **安装尝试链** —— 先走默认索引；网络类失败（连接重置/超时/DNS——绝非"No matching distribution found"或 TLS 错误）按 TUNA → 阿里云 → USTC 镜像回退，并一次性探测常见本地代理端口（7890、7891、10809、10808、8888），命中则经代理重试同一索引。
- **ensurepip 修复** —— `<venv-python> -m ensurepip --upgrade` 用内置 wheel 离线引导 pip；ensurepip 本身缺失时报错附带 Debian/Ubuntu `python3-venv` 提示。
- **并发** —— 写工具声明 `isConcurrencySafe: false`，调度器原生串行化；发现只读。
- **技能与引导** —— `python-env` 技能教 Agent 工具优先与"绝不为 pip 申请升级"的规则；system-prompt 段（`dsh-python-env:guidance`，order 120）提醒每个会话 pyenv 工具才是正规路径。

## 项目结构

| 路径 | 用途 |
| ---- | ---- |
| `cordis.patch.yml` | Profile 补丁层，插入 `dsh-python-env` 行 |
| `lib/index.js` | 宿主插件：注册四个工具、技能与引导段 |
| `lib/tools/` | 四个模型工具（`discover` / `create` / `install` / `remove`） |
| `lib/guard.js`、`lib/venv.js`、`lib/layout.js`、`lib/paths.js`、`lib/python.js` | 工作区约束、venv 解析、发现、平台布局、解释器链 |
| `lib/runner.js`、`lib/pip.js`、`lib/envdir.js` | Subprocess 通道、安装链、工作区缓存 |
| `test/` | 无运行时行为测试（见开发） |
| `docs/` | 设计与分析文档 |

## 开发

无构建步骤：插件是纯 ESM，测试直接用 Node 运行（mock ctx 替代 DSH 服务；真实的 `defineTool` 校验所有 schema）：

```bash
npm test
# 或：node --test --test-isolation=none "test/*.test.js"
```

开发循环（含离线依赖解析）见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 兼容性

**dsh-multi-folder（可选，零依赖）** —— 当同时安装了 dsh-multi-folder 插件时，其配置的副工作目录会自动成为所有 `pyenv_*` 工具的合法根目录：可以在其中发现、创建、安装、卸载、删除环境，并遵循 multi-folder 拦截授予的同一会话模式（workspace-write 会话可写，read-only 会话仍被策略门拒绝）。该集成为静默能力探测——未安装 multi-folder 时一切不变：无额外上下文、无依赖、无任何用户可感知差异。

## 安全

安装包意味着执行第三方代码：`pyenv_install`（含自动创建 `.venv` 的路径）会以宿主用户权限从配置的索引下载并运行代码，editable 安装会原样引入工作区内的项目。插件的缓解措施包括：仅 HTTPS 索引、爆炸半径限定在工作区（被攻破的环境可用 `pyenv_remove` 一次性丢弃）、路由全程透明、会话模式对齐（read-only 会话无法触发任何安装）、按 profile 选择安装。完整威胁模型与缓解清单见 [SECURITY.md](SECURITY.md)。

## 文档

- [docs/design.md](docs/design.md) —— 架构、约束模型、安装链、已知限制
- [SECURITY.md](SECURITY.md) —— 威胁模型与补偿控制

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。欢迎提 issue 与 pull request。

## 许可证

[MIT](LICENSE)
