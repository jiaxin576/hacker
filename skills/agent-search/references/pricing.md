# API Key 与免费额度

核对日期：**2026-10-07**。这里比较的是本 Skill 调用的官方 API，而不是网页搜索产品的会员套餐。价格和额度可能变动，账户实际可用额度以供应商控制台为准。

**当前实现：AnySearch 可以显式匿名调用，其余九个后端都需要 Key。Key 主要用于身份识别和计量，申请 Key 不代表必须购买付费套餐。**

| 工具 | 当前 Skill 是否需要 Key | 免费额度或计费情况 | 官方依据 |
| --- | --- | --- | --- |
| AnySearch | 可以不配，使用 --anonymous | 支持匿名免费额度；注册免费套餐标注 1,000 次/天。匿名模式另受 IP 限制，不把注册额度当作匿名保证 | [认证](https://anysearch.com/docs/auth)、[定价](https://anysearch.com/pricing) |
| Tavily | 需要 TAVILY_API_KEY | 1,000 credits/月，无需信用卡；深入搜索等操作消耗更多 credits | [定价](https://www.tavily.com/pricing) |
| Exa | 需要 EXA_API_KEY | $10 免费额度/月，另有 $10 新用户奖励，无需支付方式 | [定价](https://exa.ai/pricing) |
| Firecrawl | 需要 FIRECRAWL_API_KEY | 1,000 credits/月，无需信用卡；基础抓取 1 credit/页，搜索等动作按对应费率扣减 | [定价](https://www.firecrawl.dev/pricing) |
| Brave Search | 需要 BRAVE_API_KEY | $5 免费额度/月；普通搜索 $5/千次。需要信用卡作验证 | [定价与说明](https://brave.com/search/api/) |
| Context7 / CT7 | 需要 CONTEXT7_API_KEY | 1,000 次 API 调用/月，免费套餐支持公开库 | [套餐](https://context7.com/plans) |
| Consensus | 需要 CONSENSUS_API_KEY | 30 次 API/MCP 调用/月，两者共享额度 | [API 说明](https://help.consensus.app/en/articles/16516328-the-consensus-api) |
| Perplexity | 需要 PERPLEXITY_API_KEY | 通用 API 按量收费；标准搜索 $5/千次，Fast Search $1/千次；回答另计模型与工具用量 | [API 定价](https://docs.perplexity.ai/docs/getting-started/pricing) |
| Grok | 需要 XAI_API_KEY | API 按量收费；未核实稳定的长期免费套餐，活动赠送积分以账户为准 | [计费说明](https://docs.x.ai/console/billing) |
| 秘塔 / Metaso | 需要 METASO_API_KEY | 未核实明确的固定免费 API 额度，需在账户控制台查询 | [官方 API 入口](https://metaso.cn/search-api/playground)、[用户协议](https://metaso.cn/meta-user-policy) |

credits、调用次数和美元额度不是同一个单位，不能直接相加或按数字比较。多后端搜索会分别消耗各服务额度；limit 限制返回条目数，不是费用上限。

Perplexity 为 Hermes Agent 的默认 Fast Search 提供免 Key 免费通道，这是特定宿主集成；当前 Skill 使用的是常规 API，没有接入这个通道。见 [官方 Hermes 集成说明](https://docs.perplexity.ai/docs/getting-started/integrations/hermes)。

## 低成本起步

可先选 AnySearch 匿名搜索，或配置 Tavily 的免费 Key。开发文档加入 Context7，已知 URL 的正文读取加入 Firecrawl，论文查询加入 Consensus。只配置所需后端，不必一次配置十个。

~~~sh
node <skill-dir>/scripts/search.mjs search --provider anysearch --anonymous --query "Agent Skills"
node <skill-dir>/scripts/search.mjs doctor
~~~

完整配置方法见 [setup.md](setup.md)，空白模板为 ../env.example。脚本不会自动充值、换 Key、启用付费套餐、保存返回的凭据或重试请求。
