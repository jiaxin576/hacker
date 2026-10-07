# 配置、安装与移植

需要 Node.js 20+ 和网络访问。没有 npm 依赖。支持 Windows、macOS、Linux；命令路径有空格时按宿主 shell 的规则加引号。

## 密钥

只配置要用的服务即可，auto 根据已配置服务选择。脚本不会读取其他 Agent 的配置或隐式加载当前工作目录的 .env。

| 后端 | 环境变量 |
| --- | --- |
| AnySearch | ANYSEARCH_API_KEY |
| Tavily | TAVILY_API_KEY |
| Exa | EXA_API_KEY |
| Firecrawl | FIRECRAWL_API_KEY |
| Brave | BRAVE_API_KEY |
| Perplexity | PERPLEXITY_API_KEY |
| Grok | XAI_API_KEY |
| 秘塔 | METASO_API_KEY |
| Context7 | CONTEXT7_API_KEY |
| Consensus | CONSENSUS_API_KEY |

env.example 是空白配置模板。可复制到包以外的私有路径，填入需要的密钥，并用 --env-file 指定：
~~~sh
node <skill-dir>/scripts/search.mjs doctor --env-file <private-path>/search.env
node <skill-dir>/scripts/search.mjs search --query "topic" --env-file <private-path>/search.env
~~~

环境变量优先于文件中同名值。文件支持 NAME=value、单双引号、整行注释；不执行命令、不展开变量，也不接受无关环境变量。不要把填写后的密钥文件提交或随 Skill 打包。doctor、providers、--dry-run 都不联网。

AnySearch 官方提供匿名模式，显式 --anonymous 后才可在无密钥时调用。其官方文档说明：匿名额度耗尽的 402 响应可能带自动生成的凭据。脚本丢弃该错误响应正文，不展示、保存或使用这些凭据，也不自动注册、充值或重试。多数服务的 API 用量独立于网页订阅，请以各自控制台的账户权限为准。

Grok 默认模型 grok-4.7 来自当前官方示例；模型可通过 --model 或 XAI_SEARCH_MODEL 修改。Perplexity answer 默认 preset=fast，可通过 --preset 修改。模型、套餐、费用和额度会变化，本包不承诺固定免费额度。

## 安装到 Agent

复制整个 agent-search 目录至宿主的 Skill 根目录；目录名保持 agent-search。

| 宿主 | 常用目录 |
| --- | --- |
| Pi | ~/.pi/agent/skills/agent-search/ 或项目 .pi/skills/agent-search/ |
| Pi 的通用 Agent Skills 位置 | ~/.agents/skills/agent-search/ |
| Codex | ~/.codex/skills/agent-search/ |
| Claude Code | ~/.claude/skills/agent-search/ |
| 自建 Agent | 自己加载 SKILL.md；使用命令工具或 run(request) |

Pi 的格式和调用依据见 [官方 Skills 文档](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)。复制后在已有会话执行 /reload，或重新启动，然后：
~~~text
/skill:agent-search 用 Tavily 搜索这个主题并给出来源
/skill:agent-search 用 Context7 查 React 19 的 useEffect 文档
/skill:agent-search 用 Exa 和 Tavily 交叉搜索这个问题
~~~

Windows 从本仓库根目录复制到 Pi（目标目录已存在时先核对旧版本，避免覆盖个人修改）：
~~~powershell
$searchSkillSource = (Resolve-Path '.\skills\agent-search').Path
$searchSkillRoot = Join-Path $env:USERPROFILE '.pi\agent\skills'
$searchSkillTarget = Join-Path $searchSkillRoot 'agent-search'
if (Test-Path -LiteralPath $searchSkillTarget) { throw '目标 Skill 已存在，请先核对版本' }
New-Item -ItemType Directory -Path $searchSkillRoot -Force | Out-Null
Copy-Item -LiteralPath $searchSkillSource -Destination $searchSkillTarget -Recurse
~~~

## 验证状态

接口文档核对日期：2026-10-07。十个适配器通过本地模拟响应测试，CLI 支持无网络预览。交付时本机无供应商密钥，因此没有声称真实账户调用通过。Metaso 的返回字段做了兼容映射；遇到未识别的结构会返回 invalid_response，需要以真实账户响应进一步核对。

~~~sh
node <skill-dir>/scripts/search.mjs doctor
node <skill-dir>/scripts/search.mjs search --provider tavily --query "test" --dry-run
node --test <skill-dir>/scripts/search.test.mjs
~~~
