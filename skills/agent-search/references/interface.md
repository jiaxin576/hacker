# 统一调用契约

## 动作与参数

~~~text
node <skill-dir>/scripts/search.mjs <action> [options]
node <skill-dir>/scripts/search.mjs --request request.json [--env-file search.env]
~~~

动作 search、read、answer、libraries、docs、subdomains、crawl、crawl-status、doctor、providers。每条命令在 stdout 输出一个 JSON 对象；--help 输出文本。退出码 0=成功（可能为空），1=失败，2=部分成功。

| CLI | JSON 字段 | 意义 |
| --- | --- | --- |
| --provider | provider | auto 或后端名；search 可逗号分隔或 JSON 数组，最多 3 个 |
| --query | query | 搜索、回答、libraries、docs 的查询 |
| --intent | intent | web、code、papers、semantic、news、social、chinese、research，默认 web |
| --url | url | read、crawl 的绝对 HTTP(S) URL |
| --limit | limit | 每后端条目上限 1–20，默认 5；crawl 为抓取页数上限 |
| --library | library | Context7 名称或 ID；search 可重复至 4 个 |
| --library-id | libraryId | Context7 docs 所需 ID |
| --version | version | Context7 search 版本偏好；检查返回的实际版本 |
| --language | language | Context7 编程语言，AnySearch/Tavily 语言，Brave search_lang；各服务编码有差异 |
| --domain | domain | AnySearch subdomains，可重复 |
| --depth | depth | Tavily 搜索深度 |
| --model | model | Grok 模型或 Perplexity answer 模型 |
| --preset | preset | Perplexity answer，默认 fast |
| --job-id | jobId | Firecrawl crawl-status |
| --timeout | timeout | 单次请求秒数 1–180，默认 60；服务内部步骤可能另有计费 |
| --max-chars | maxChars | 每条正文/回答字符上限 100–100000，默认 20000；片段另限 2500 |
| --options-file | options | JSON 文件中的供应商参数；仅支持脚本列出的白名单 |
| --dry-run | dryRun | 布尔；预览脱敏请求，不联网 |
| --anonymous | anonymous | 显式允许无 Key 的 AnySearch |
| --env-file | 无 | 私有配置文件路径，不进入请求对象 |

CLI 参数覆盖请求文件中的同名字段。Key 不接收命令行参数。auto 只选一个已配置候选，失败后不自动调用另一个；library/version 提示会固定选择 Context7，避免忽略明确的文档约束。多源请求的 options 必须被每个所选后端支持；不同服务的过滤参数请拆成独立请求。AnySearch 最多请求 10 条；Consensus 返回后在本地限制条目；模型引用条数在返回后限制，不等价于服务搜索/计费上限。

## 请求例子

多源：
~~~json
{"action":"search","provider":["tavily","exa"],"query":"retrieval augmented generation evaluation","limit":5}
~~~

开发文档：
~~~json
{"action":"search","provider":"context7","query":"How do I clean up an effect?","library":["react"],"version":"19","language":"TypeScript"}
~~~

已知文档 ID：
~~~json
{"action":"docs","provider":"context7","libraryId":"/facebook/react","query":"useEffect cleanup"}
~~~

AnySearch 垂直搜索先获取定义：
~~~json
{"action":"subdomains","provider":"anysearch","domain":["code"]}
~~~
再使用实际返回的 tag 和 params。官方示例：
~~~json
{"action":"search","provider":"anysearch","query":"Go release notes","options":{"tag":"code.doc","params":{"library":"golang"}}}
~~~

中文搜索：
~~~json
{"action":"search","provider":"metaso","intent":"chinese","query":"人工智能应用进展","options":{"scope":"webpage","includeSummary":true}}
~~~

论文：
~~~json
{"action":"search","provider":"consensus","intent":"papers","query":"retrieval augmented generation evaluation","options":{"include_full_text_chunks":true}}
~~~

X：
~~~json
{"action":"search","provider":"grok","intent":"social","query":"What is being discussed about AI agents?","options":{"from_date":"2026-10-01","to_date":"2026-10-07"}}
~~~

站点抓取：
~~~json
{"action":"crawl","provider":"firecrawl","url":"https://example.com/docs","limit":10,"options":{"includePaths":["/docs/.*"],"maxDiscoveryDepth":2}}
~~~
返回 runs[0].metadata.job_id；使用 crawl-status 查看一页，不自动轮询、翻页或扩展到其他网站。job_status=queued/scraping 表示仍在处理，不代表正文已经齐备。

## 输出

~~~json
{
  "schema_version":1,
  "status":"ok",
  "action":"search",
  "intent":"web",
  "query":"topic",
  "results":[{
    "provider":"tavily",
    "title":"Source title",
    "url":"https://example.com/article",
    "snippet":"Search evidence",
    "content":"",
    "truncated":false,
    "provenance":[{"provider":"tavily","url":"https://example.com/article"}]
  }],
  "answers":[],
  "runs":[{"provider":"tavily","status":"ok","duration_ms":123,"metadata":{}}],
  "errors":[]
}
~~~

answers[].text 是模型生成的回答，附 citations（若服务提供）。空数组表示没有返回该类型内容。results[].score、published_at、id、metadata 仅在有值时出现。metadata 保留论文信息、库 ID、Context7 实际版本、抓取任务状态等。

URL 去重忽略片段锚点与常见跟踪参数，保留真实检索参数；不会把不同供应商分数混成同一评分。Context7 的同页不同代码/文档片段保留。多源交叉验证要看 provenance 的供应商列表，不能把同一 URL 当成多个独立证据。

错误 code：invalid_request、unsupported_action、not_configured、authentication_failed、quota_exhausted、rate_limited、timeout、network_error、http_error、upstream_error、provider_error、invalid_response、response_too_large、extraction_failed、crawl_failed、incomplete_response。retryable 表示可考虑重试，不代表脚本已经重试。原始错误正文不输出，以避免泄露供应商返回的密钥。

## 接到自建 Agent 的工具

~~~js
import { run } from '/absolute/path/agent-search/scripts/search.mjs';
const output = await run({ action: 'search', provider: 'auto', query: 'topic' });
return JSON.stringify(output);
~~~

可用 references/request.schema.json 作为工具参数 JSON Schema。run(request, {env, fetchImpl}) 支持受控注入环境和 transport；普通 Agent 不应允许模型把密钥、任意 endpoint、headers 或 transport 放进请求。schema 的条件参数由运行时再次校验。
