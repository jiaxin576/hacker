# hacker · Agent Search Skill

供通用 Agent 调用的搜索 Skill，适用于 Pi、Codex、Claude Code，以及能够读取 Skill 并执行命令的自建 Agent。

统一接入 **AnySearch、Tavily、Exa、Firecrawl、Brave Search、Perplexity、Grok、秘塔、Context7、Consensus**。运行环境为 **Node.js 20+**，无 npm 依赖。

## 能做什么

- 按任务和已配置密钥选择搜索后端，也可以明确指定工具。
- 通用 Web 搜索、开发文档、科研论文、中文资料、实时新闻与 X 社媒检索。
- 最多三个后端并行搜索，按 URL 去重并保留来源。
- 读取网页 Markdown，查询 Context7 指定库及版本。
- 使用 Perplexity 或 Grok 获取带引用的综合回答。
- 创建有页数上限的 Firecrawl 抓取任务，按任务 ID 查询状态。
- 统一 JSON 输出，区分成功、部分成功、空结果和失败。
- 提供不联网的配置检查与请求预览。

搜索路由是默认选择策略，不是工具质量排名；模型总结与原始证据分开返回。

## 快速开始

~~~sh
git clone https://github.com/jiaxin576/hacker.git
cd hacker
node skills/agent-search/scripts/search.mjs doctor
node skills/agent-search/scripts/search.mjs search --provider tavily --query "Agent search APIs" --dry-run
~~~

doctor 和 dry-run 不联网，不需要配置 API Key。

配置要使用的后端环境变量，或将 skills/agent-search/env.example 复制到私有路径，填写密钥，通过 --env-file 显式加载。无需把十个服务都配齐。

~~~sh
node skills/agent-search/scripts/search.mjs search --provider tavily --query "Agent search APIs" --env-file /private/path/search.env
node skills/agent-search/scripts/search.mjs search --provider tavily,exa --query "RAG evaluation"
node skills/agent-search/scripts/search.mjs search --provider context7 --library react --version 19 --query "useEffect cleanup"
node skills/agent-search/scripts/search.mjs read --provider firecrawl --url "https://example.com/article"
node skills/agent-search/scripts/search.mjs answer --provider perplexity --query "Explain this topic with sources"
~~~

Windows 可用实际私有路径替换 /private/path/search.env，例如 C:/Users/你的用户名/.config/agent-search.env。不要把密钥写入聊天、请求参数或提交到仓库。

不配 Key 时可显式使用 AnySearch 匿名额度：
~~~sh
node skills/agent-search/scripts/search.mjs search --provider anysearch --anonymous --query "Agent Skills"
~~~

## 安装到 Pi 等 Agent

复制 **整个 skills/agent-search 目录**，不要只复制 SKILL.md。

| Agent | Skill 放置位置 |
| --- | --- |
| Pi | ~/.pi/agent/skills/agent-search/ |
| Pi 项目 | .pi/skills/agent-search/ |
| Codex | ~/.codex/skills/agent-search/ |
| Claude Code | ~/.claude/skills/agent-search/ |
| 自建 Agent | 自己加载 SKILL.md，执行 CLI 或导入 run(request) |

从仓库根目录复制到 Pi：

~~~sh
# macOS / Linux
mkdir -p ~/.pi/agent/skills
cp -R skills/agent-search ~/.pi/agent/skills/
~~~

~~~powershell
# Windows PowerShell
$searchSkillRoot = Join-Path $env:USERPROFILE '.pi\agent\skills'
$searchSkillTarget = Join-Path $searchSkillRoot 'agent-search'
if (Test-Path -LiteralPath $searchSkillTarget) { throw '目标 Skill 已存在，请先核对版本' }
New-Item -ItemType Directory -Path $searchSkillRoot -Force | Out-Null
Copy-Item -LiteralPath '.\skills\agent-search' -Destination $searchSkillTarget -Recurse
~~~

Pi 重启或执行 /reload 后：
~~~text
/skill:agent-search 用 Tavily 和 Exa 搜索这个主题并给出来源
/skill:agent-search 用 Context7 查 React 19 的 useEffect 文档
/skill:agent-search 用 Consensus 查相关论文
~~~

Pi 的目录和调用方式依据 [官方 Skills 文档](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)。

## API Key 与免费额度

**当前 Skill 只有 AnySearch 支持免 Key 的匿名模式；其余九个后端需要 API Key。配 Key 不等于付费。**

Tavily、Exa、Firecrawl、Brave、Context7、Consensus 提供有限免费 API 额度。Perplexity 与 Grok 的通用 API 按量收费；秘塔的固定免费 API 额度尚未核实。详细额度、条件、官方来源和核对日期见 [API Key 与免费额度](skills/agent-search/references/pricing.md)。

网页端套餐和 API 额度分别计算。免费额度与价格可能调整，使用前查看服务控制台。

## 文档

- [Skill 入口与路由规则](skills/agent-search/SKILL.md)
- [配置与安装](skills/agent-search/references/setup.md)
- [调用契约、参数和 JSON 示例](skills/agent-search/references/interface.md)
- [各后端接口与可用参数](skills/agent-search/references/providers.md)
- [工具用途与选择建议](skills/agent-search/references/tool-selection.md)
- [API Key 与免费额度](skills/agent-search/references/pricing.md)
- [工具参数 JSON Schema](skills/agent-search/references/request.schema.json)
- [空白密钥配置模板](skills/agent-search/env.example)

## 自建 Agent 接入

~~~js
import { run } from './skills/agent-search/scripts/search.mjs';

const output = await run({
  action: 'search',
  provider: 'auto',
  query: 'Agent search APIs',
  limit: 5,
});
console.log(JSON.stringify(output));
~~~

run(request) 接收统一请求，使用进程环境中的密钥，返回结构化结果。也可将 CLI 接入已有命令执行工具。包含引号、换行的查询推荐写成 UTF-8 JSON 文件，再用 --request 调用，避免 shell 拼接。

## 验证

~~~sh
npm test
npm run check
~~~

也可以直接：
~~~sh
node --test skills/agent-search/scripts/search.test.mjs
node --check skills/agent-search/scripts/search.mjs
~~~

**29 项本地模拟测试通过**，覆盖十个后端、五种网页读取、路由、去重、错误、脱敏与 CLI。未使用真实 API Key 做联网验证，因此不声称真实账户调用通过。秘塔搜索响应字段目前采用兼容映射，需要真实账户响应进一步核对。

## 目录

~~~text
skills/agent-search/
├── SKILL.md
├── env.example
├── agents/openai.yaml
├── scripts/
│   ├── search.mjs
│   └── search.test.mjs
└── references/
    ├── setup.md
    ├── interface.md
    ├── providers.md
    ├── pricing.md
    ├── tool-selection.md
    └── request.schema.json
~~~
