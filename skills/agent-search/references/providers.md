# 后端接口参考

核对日期 2026-10-07。下面列出本 Skill 实现的接口范围和官方依据；完整产品功能不限于这些动作。脚本不是网页会员登录代理。

| 后端 | 实现的动作 | 官方文档 |
| --- | --- | --- |
| AnySearch | POST /v1/search、POST /v1/extract、GET /v1/sub-domains | [Search](https://www.anysearch.com/docs/api-endpoints/v1-search)、[Extract](https://www.anysearch.com/docs/api-endpoints/v1-extract)、[Domains](https://www.anysearch.com/docs/api-endpoints/v1-sub-domains) |
| Tavily | POST /search、POST /extract | [Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)、[Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract) |
| Exa | POST /search、POST /contents | [Search](https://exa.ai/docs/reference/search)、[Contents](https://exa.ai/docs/reference/get-contents) |
| Firecrawl | v2 search、scrape、crawl、单次 crawl status | [Search](https://docs.firecrawl.dev/api-reference/endpoint/search)、[Scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape)、[Crawl](https://docs.firecrawl.dev/api-reference/endpoint/crawl-post) |
| Brave | GET /res/v1/web/search | [官方 Web Search 文档](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started) |
| Perplexity | POST /search、POST /v1/agent | [Search API](https://docs.perplexity.ai/api-reference/search-post)、[Agent API](https://docs.perplexity.ai/api-reference/agent-post)、[迁移说明](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview) |
| Grok | POST /v1/responses，web_search / x_search | [Web Search](https://docs.x.ai/developers/tools/web-search)、[X Search](https://docs.x.ai/developers/tools/x-search) |
| Metaso / 秘塔 | POST /api/v1/search、POST /api/v1/reader | [官方 Playground](https://metaso.cn/search-api/playground) |
| Context7 / CT7 | GET /api/v3/search、GET /api/v2/libs/search、GET /api/v2/context | [API Guide](https://context7.com/docs/api-guide)、[Search](https://context7.com/docs/api-reference/search/search-documentation-in-one-request) |
| Consensus | GET /v1/search | [API Get Started](https://docs.consensus.app/api-get-started) |

## 支持的 options

参数名保留供应商原始拼写。值的详细取值范围以对应官方文档为准；本 Skill 校验字段名与核心结构，服务仍会校验具体筛选值。

- AnySearch search：tag、params、zone、format。read 只允许 url。subdomains 用顶层 domain，重复 query 参数。
- Tavily search：include_domains、exclude_domains、time_range、start_date、end_date、country、include_answer、include_raw_content、include_published_date。read：extract_depth、include_images。
- Exa search：type、category、includeDomains、excludeDomains、startPublishedDate、endPublishedDate、contents。read：livecrawl、livecrawlTimeout。
- Firecrawl search：tbs、location、country、categories、scrapeOptions、includeDomains、excludeDomains。read：waitFor、includeTags、excludeTags。crawl：includePaths、excludePaths、maxDiscoveryDepth。
- Brave：freshness、country、safesearch、offset。语言使用顶层 language。
- Perplexity search：search_domain_filter、search_recency_filter、search_after_date_filter、search_before_date_filter、country、search_language_filter、max_tokens_per_page、search_type。answer：max_output_tokens；preset/model 使用顶层字段。
- Grok：allowed_domains、excluded_domains（最多 5 个，二者互斥）；social：allowed_x_handles、excluded_x_handles（最多 20 个，二者互斥）、from_date、to_date。两种模式都可用 max_output_tokens。
- Metaso：scope、page、includeSummary、includeRawContent、conciseSnippet。reader 使用 Accept: text/plain 和仅含 url 的 body，返回 Markdown。scope 的可用值来自 Playground，不猜枚举。
- Context7：不透传额外 options；使用顶层 library、libraryId、version、language。
- Consensus：include_full_text_chunks。其他研究过滤器尚未包装，需要核对官方文档后扩展白名单。

## 接入边界

HTTP 通信不需要特定 Agent 内置 SDK 或 MCP。宿主只需加载 Skill 并执行命令。配置 Key 是开启对应服务的前提（AnySearch 可显式匿名）。

Perplexity 回答使用官方 Agent API 的 fast preset；Grok 回答使用官方示例模型，能够返回答案和引用。这些是模型生成内容，搜索结果或网页正文仍应作为结论的证据。

Context7 可能以 partial 状态返回版本未核实或预发布版本。脚本保留 JSON version 和相关响应 header 的 reason，避免默默将当前文档当指定版本。

Metaso 官方 Playground 确认了 URL、认证、请求字段和 Markdown reader 的 Accept 方式；搜索返回字段映射采取兼容处理，仍需真实账户确认。其他后端也尚未用真实 Key 做联网验证。所有实现已用模拟响应检查，本包不包含凭据。
