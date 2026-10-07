#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROVIDERS = {
  anysearch: { key: 'ANYSEARCH_API_KEY', actions: ['search', 'read', 'subdomains'] },
  tavily: { key: 'TAVILY_API_KEY', actions: ['search', 'read'] },
  exa: { key: 'EXA_API_KEY', actions: ['search', 'read'] },
  firecrawl: { key: 'FIRECRAWL_API_KEY', actions: ['search', 'read', 'crawl', 'crawl-status'] },
  brave: { key: 'BRAVE_API_KEY', actions: ['search'] },
  perplexity: { key: 'PERPLEXITY_API_KEY', actions: ['search', 'answer'] },
  grok: { key: 'XAI_API_KEY', actions: ['search', 'answer'] },
  metaso: { key: 'METASO_API_KEY', actions: ['search', 'read'] },
  context7: { key: 'CONTEXT7_API_KEY', actions: ['search', 'libraries', 'docs'] },
  consensus: { key: 'CONSENSUS_API_KEY', actions: ['search'] },
};
const ROUTES = {
  web: ['tavily', 'brave', 'anysearch', 'exa', 'perplexity', 'firecrawl', 'metaso', 'grok'],
  code: ['context7', 'anysearch', 'tavily', 'brave', 'exa'],
  papers: ['consensus', 'exa', 'anysearch', 'tavily', 'metaso'],
  semantic: ['exa', 'anysearch', 'tavily', 'perplexity'],
  news: ['tavily', 'grok', 'brave', 'anysearch', 'perplexity', 'metaso'],
  social: ['grok', 'anysearch', 'brave', 'tavily'],
  chinese: ['metaso', 'anysearch', 'tavily', 'brave', 'perplexity'],
  research: ['perplexity', 'tavily', 'grok', 'anysearch', 'exa'],
};
const ALIASES = { ct7: 'context7', 'brave-search': 'brave', xai: 'grok', 'metaso-search': 'metaso' };
const ACTIONS = ['search', 'read', 'answer', 'libraries', 'docs', 'subdomains', 'crawl', 'crawl-status', 'doctor', 'providers'];
const FIELDS = ['action', 'provider', 'query', 'intent', 'limit', 'url', 'library', 'libraryId', 'version', 'language', 'domain', 'model', 'preset', 'depth', 'jobId', 'timeout', 'maxChars', 'options', 'dryRun', 'anonymous'];
const MAX_BYTES = 20 * 1024 * 1024;
class SearchError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; Object.assign(this, details); }
}
const fail = (code, message, details) => { throw new SearchError(code, message, details); };
const list = v => v === undefined ? [] : Array.isArray(v) ? v : [v];
const str = v => v === undefined || v === null ? '' : String(v);
const array = (v, label) => { if (!Array.isArray(v) || v.some(x => !x || typeof x !== 'object' || Array.isArray(x))) fail('invalid_response', 'Expected ' + label + ' object array'); return v; };
const hasKey = (env, p) => !!str(env[PROVIDERS[p].key]).trim();
function int(v, fallback, low, high, name) {
  const n = v === undefined ? fallback : Number(v);
  if (!Number.isInteger(n) || n < low || n > high) fail('invalid_request', name + ' must be an integer from ' + low + ' to ' + high);
  return n;
}
function url(v) {
  let u;
  try { u = new URL(v); } catch { fail('invalid_request', 'url must be an absolute HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) fail('invalid_request', 'URL must be HTTP(S) without embedded credentials');
  return u.toString();
}
function safeURL(v) { try { return url(v); } catch { return ''; } }
function check(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_request', 'Request must be a JSON object');
  for (const k of Object.keys(input)) if (!FIELDS.includes(k)) fail('invalid_request', 'Unknown request field: ' + k);
  const r = { action: 'search', provider: 'auto', intent: 'web', ...input };
  if (!ACTIONS.includes(r.action) || !Object.hasOwn(ROUTES, r.intent)) fail('invalid_request', 'Invalid action or intent');
  for (const k of ['query', 'url', 'libraryId', 'version', 'language', 'model', 'preset', 'depth', 'jobId'])
    if (r[k] !== undefined && (typeof r[k] !== 'string' || !r[k].trim())) fail('invalid_request', k + ' must be a non-empty string');
  if (typeof r.provider !== 'string' && !Array.isArray(r.provider)) fail('invalid_request', 'provider must be a name or name array');
  if (Array.isArray(r.provider) && r.provider.some(x => typeof x !== 'string')) fail('invalid_request', 'provider names must be strings');
  r.limit = int(r.limit, 5, 1, 20, 'limit');
  r.timeout = int(r.timeout, 60, 1, 180, 'timeout');
  r.maxChars = int(r.maxChars, 20000, 100, 100000, 'maxChars');
  for (const k of ['dryRun', 'anonymous']) if (r[k] !== undefined && typeof r[k] !== 'boolean') fail('invalid_request', k + ' must be boolean');
  if (['search', 'answer', 'libraries', 'docs'].includes(r.action) && !r.query) fail('invalid_request', 'query is required');
  if (['read', 'crawl'].includes(r.action)) r.url = url(r.url);
  if (r.action === 'docs' && !r.libraryId) fail('invalid_request', 'docs requires libraryId');
  if (r.action === 'libraries' && !r.library) fail('invalid_request', 'libraries requires library');
  if (r.action === 'subdomains' && !r.domain) fail('invalid_request', 'subdomains requires domain');
  if (r.action === 'crawl-status' && !/^[a-zA-Z0-9_-]+$/.test(r.jobId || '')) fail('invalid_request', 'crawl-status requires a valid jobId');
  for (const k of ['library', 'domain'])
    if (r[k] !== undefined && (!list(r[k]).length || list(r[k]).some(x => typeof x !== 'string' || !x.trim()))) fail('invalid_request', k + ' must be a string or non-empty string array');
  r.options ??= {};
  if (!r.options || typeof r.options !== 'object' || Array.isArray(r.options)) fail('invalid_request', 'options must be an object');
  return r;
}
export function providerStatus(env = process.env) {
  return Object.entries(PROVIDERS).map(([name, d]) => ({ name, key_env: d.key, configured: hasKey(env, name), anonymous_supported: name === 'anysearch', actions: d.actions }));
}
function select(r, env) {
  let names = [...new Set((Array.isArray(r.provider) ? r.provider : r.provider.split(',')).map(x => ALIASES[x.trim().toLowerCase()] || x.trim().toLowerCase()))];
  if (names.includes('auto')) {
    if (names.length !== 1) fail('invalid_request', 'auto cannot be mixed with explicit providers');
    let candidates = { read: ['firecrawl', 'anysearch', 'tavily', 'exa', 'metaso'], answer: ['perplexity', 'grok'], libraries: ['context7'], docs: ['context7'], subdomains: ['anysearch'], crawl: ['firecrawl'], 'crawl-status': ['firecrawl'] }[r.action] || ROUTES[r.intent];
    if (r.action === 'search' && (r.library || r.version)) candidates = ['context7'];
    let chosen = candidates.find(p => PROVIDERS[p].actions.includes(r.action) && hasKey(env, p));
    if (!chosen && r.anonymous && PROVIDERS.anysearch.actions.includes(r.action)) chosen = 'anysearch';
    if (!chosen && r.dryRun) chosen = candidates[0];
    if (!chosen) fail('not_configured', 'No configured provider for ' + r.action + '/' + r.intent + '; run doctor');
    names = [chosen];
  }
  if (!names.length || names.length > 3) fail('invalid_request', 'Choose one to three providers');
  if (names.length > 1 && r.action !== 'search') fail('invalid_request', 'Multiple providers are supported only for search');
  for (const p of names) {
    if (!Object.hasOwn(PROVIDERS, p)) fail('invalid_request', 'Unknown provider: ' + p);
    if (!PROVIDERS[p].actions.includes(r.action)) fail('unsupported_action', p + ' does not support ' + r.action);
  }
  return names;
}
function options(r, allowed, generic = []) {
  for (const k of Object.keys(r.options)) if (!allowed.includes(k)) fail('invalid_request', 'Unsupported options field for this provider/action: ' + k);
  for (const k of ['library', 'libraryId', 'version', 'language', 'domain', 'model', 'preset', 'depth'])
    if (r[k] !== undefined && !generic.includes(k)) fail('invalid_request', k + ' is not supported by this provider/action');
  return r.options;
}
function req(endpoint, method, headers, body, params = {}) {
  const u = new URL(endpoint);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null)
    for (const item of list(v)) u.searchParams.append(k, typeof item === 'object' ? JSON.stringify(item) : String(item));
  return { url: u.toString(), method, headers: { Accept: 'application/json', ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body } : {}) };
}
export function buildRequest(p, input, env = process.env) {
  const r = check(input), a = r.action, q = r.query, n = r.limit;
  p = ALIASES[p] || p;
  if (!Object.hasOwn(PROVIDERS, p) || !PROVIDERS[p].actions.includes(a)) fail('unsupported_action', 'Unsupported provider/action');
  const key = str(env[PROVIDERS[p].key]).trim(), bearer = key ? { Authorization: 'Bearer ' + key } : {};
  switch (p) {
    case 'anysearch':
      if (a === 'subdomains') return req('https://api.anysearch.com/v1/sub-domains', 'GET', bearer, null, { domain: r.domain, ...options(r, [], ['domain']) });
      if (a === 'read') return req('https://api.anysearch.com/v1/extract', 'POST', bearer, { url: r.url, ...options(r, []) });
      return req('https://api.anysearch.com/v1/search', 'POST', bearer, { query: q, max_results: Math.min(n, 10), ...(r.language ? { language: r.language } : {}), ...options(r, ['tag', 'params', 'zone', 'format'], ['language']) });
    case 'tavily':
      if (a === 'read') return req('https://api.tavily.com/extract', 'POST', bearer, { urls: [r.url], format: 'markdown', ...options(r, ['extract_depth', 'include_images']) });
      if (r.depth && !['basic', 'advanced', 'fast', 'ultra-fast'].includes(r.depth)) fail('invalid_request', 'Invalid Tavily depth');
      return req('https://api.tavily.com/search', 'POST', bearer, { query: q, max_results: n, search_depth: r.depth || 'basic', topic: r.intent === 'news' ? 'news' : 'general', include_answer: false, include_raw_content: false, ...(r.language ? { language: r.language } : {}), ...options(r, ['include_domains', 'exclude_domains', 'time_range', 'start_date', 'end_date', 'country', 'include_answer', 'include_raw_content', 'include_published_date'], ['depth', 'language']) });
    case 'exa':
      if (a === 'read') return req('https://api.exa.ai/contents', 'POST', { 'x-api-key': key }, { ids: [r.url], text: true, ...options(r, ['livecrawl', 'livecrawlTimeout']) });
      return req('https://api.exa.ai/search', 'POST', { 'x-api-key': key }, { query: q, numResults: n, type: 'auto', ...(r.intent === 'papers' ? { category: 'research paper' } : {}), contents: { highlights: true }, ...options(r, ['type', 'category', 'includeDomains', 'excludeDomains', 'startPublishedDate', 'endPublishedDate', 'contents']) });
    case 'firecrawl':
      if (a === 'crawl-status') return req('https://api.firecrawl.dev/v2/crawl/' + encodeURIComponent(r.jobId), 'GET', bearer, null, options(r, []));
      if (a === 'crawl') return req('https://api.firecrawl.dev/v2/crawl', 'POST', bearer, { url: r.url, limit: n, scrapeOptions: { formats: ['markdown'] }, ...options(r, ['includePaths', 'excludePaths', 'maxDiscoveryDepth']) });
      if (a === 'read') return req('https://api.firecrawl.dev/v2/scrape', 'POST', bearer, { url: r.url, formats: ['markdown'], onlyMainContent: true, ...options(r, ['waitFor', 'includeTags', 'excludeTags']) });
      return req('https://api.firecrawl.dev/v2/search', 'POST', bearer, { query: q, limit: n, sources: ['web'], ...options(r, ['tbs', 'location', 'country', 'categories', 'scrapeOptions', 'includeDomains', 'excludeDomains']) });
    case 'brave':
      return req('https://api.search.brave.com/res/v1/web/search', 'GET', { 'X-Subscription-Token': key }, null, { q, count: n, extra_snippets: true, ...(r.language ? { search_lang: r.language } : {}), ...options(r, ['freshness', 'country', 'safesearch', 'offset'], ['language']) });
    case 'perplexity':
      if (a === 'answer') return req('https://api.perplexity.ai/v1/agent', 'POST', bearer, { preset: r.preset || 'fast', input: q, ...(r.model ? { model: r.model } : {}), ...options(r, ['max_output_tokens'], ['preset', 'model']) });
      return req('https://api.perplexity.ai/search', 'POST', bearer, { query: q, max_results: n, ...options(r, ['search_domain_filter', 'search_recency_filter', 'search_after_date_filter', 'search_before_date_filter', 'country', 'search_language_filter', 'max_tokens_per_page', 'search_type']) });
    case 'grok': {
      const o = options(r, ['allowed_domains', 'excluded_domains', 'allowed_x_handles', 'excluded_x_handles', 'from_date', 'to_date', 'max_output_tokens'], ['model']);
      const { max_output_tokens: tokens, ...filters } = o, social = r.intent === 'social';
      if (o.allowed_domains && o.excluded_domains || o.allowed_x_handles && o.excluded_x_handles) fail('invalid_request', 'Include and exclude filters cannot be combined');
      for (const k of Object.keys(filters)) {
        if (social ? ['allowed_domains', 'excluded_domains'].includes(k) : ['allowed_x_handles', 'excluded_x_handles', 'from_date', 'to_date'].includes(k)) fail('invalid_request', k + ' is not supported by the selected Grok search tool');
        if (k.includes('domains') || k.includes('handles'))
          if (!Array.isArray(filters[k]) || filters[k].length > (social ? 20 : 5)) fail('invalid_request', 'Invalid ' + k + ' array');
      }
      const tool = social ? { type: 'x_search', ...filters } : { type: 'web_search', ...(Object.keys(filters).length ? { filters } : {}) };
      return req('https://api.x.ai/v1/responses', 'POST', bearer, { model: r.model || env.XAI_SEARCH_MODEL || 'grok-4.7', input: [{ role: 'user', content: q }], tools: [tool], ...(tokens ? { max_output_tokens: tokens } : {}) });
    }
    case 'metaso':
      if (a === 'read') return req('https://metaso.cn/api/v1/reader', 'POST', { ...bearer, Accept: 'text/plain' }, { url: r.url, ...options(r, []) });
      return req('https://metaso.cn/api/v1/search', 'POST', bearer, { q, scope: r.intent === 'papers' ? 'scholar' : 'webpage', size: String(n), ...options(r, ['scope', 'page', 'includeSummary', 'includeRawContent', 'conciseSnippet']) });
    case 'context7':
      if (a === 'libraries') {
        if (list(r.library).length !== 1) fail('invalid_request', 'libraries accepts exactly one library');
        return req('https://context7.com/api/v2/libs/search', 'GET', bearer, null, { libraryName: list(r.library)[0], query: q, ...options(r, [], ['library']) });
      }
      if (a === 'docs') return req('https://context7.com/api/v2/context', 'GET', bearer, null, { libraryId: r.libraryId, query: q, type: 'json', ...options(r, [], ['libraryId']) });
      if (q.length > 2000 || list(r.library).length > 4) fail('invalid_request', 'Context7 allows at most 2000 query characters and four libraries');
      return req('https://context7.com/api/v3/search', 'GET', bearer, null, { query: q, type: 'json', library: r.library, version: r.version, language: r.language, ...options(r, [], ['library', 'version', 'language']) });
    case 'consensus':
      return req('https://api.consensus.app/v1/search', 'GET', { 'x-api-key': key }, null, { query: q, ...options(r, ['include_full_text_chunks']) });
  }
}
function scrub(value, secrets) {
  if (typeof value === 'string') {
    for (const secret of secrets) if (secret) value = value.split(secret).join('[REDACTED]');
    return value.replace(/\b(api[_-]?key|password|access[_-]?token|authorization)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(x => scrub(x, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /^(api[_-]?key|password|access[_-]?token|authorization)$/i.test(k) ? '[REDACTED]' : scrub(v, secrets)]));
  return value;
}
function clip(v, max) { const s = str(v); return { text: s.slice(0, max), truncated: s.length > max }; }
function row(p, x, r) {
  const c = clip(x.content, r.maxChars), s = clip(x.snippet, 2500), link = safeURL(x.url);
  return { provider: p, title: str(x.title || link), url: link, snippet: s.text, content: c.text, truncated: c.truncated || s.truncated,
    ...(x.published_at ? { published_at: str(x.published_at) } : {}), ...(typeof x.score === 'number' ? { score: x.score } : {}), ...(x.id ? { id: str(x.id) } : {}),
    ...(x.metadata ? { metadata: x.metadata } : {}), provenance: [{ provider: p, url: link }] };
}
function parse(p, data, r, headers) {
  const out = { results: [], answers: [], metadata: {} };
  const map = (items, convert = x => x) => array(items, 'results').slice(0, r.limit).map(x => row(p, convert(x), r));
  if (p === 'anysearch') {
    if (r.action === 'subdomains') out.metadata.domains = array(data.data?.domains, 'domains');
    else if (r.action === 'read') {
      if (typeof data.data?.content !== 'string') fail('invalid_response', 'AnySearch extraction missing content');
      out.results = [row(p, data.data, r)];
    } else out.results = map(data.data?.results);
  } else if (p === 'tavily') {
    out.results = map(data.results, x => ({ ...x, snippet: r.action === 'read' ? '' : x.content, content: x.raw_content, published_at: x.published_date }));
    if (data.answer) out.answers.push({ provider: p, ...clip(data.answer, r.maxChars) });
    if (data.failed_results?.length) out.metadata.failed_results = data.failed_results.map(x => ({ url: safeURL(x.url), error: 'extraction_failed' }));
    if (r.action === 'read' && !out.results.length && data.failed_results?.length) fail('extraction_failed', 'Tavily could not extract the requested page');
  } else if (p === 'exa') out.results = map(data.results, x => ({ ...x, snippet: x.summary || list(x.highlights).join('\n'), content: x.text, published_at: x.publishedDate }));
  else if (p === 'firecrawl') {
    if (r.action === 'crawl') {
      if (!data.id) fail('invalid_response', 'Firecrawl crawl response missing id');
      out.metadata = { job_id: str(data.id), job_status: 'queued' };
    } else if (r.action === 'crawl-status') {
      if (!['scraping', 'completed', 'failed', 'cancelled'].includes(data.status)) fail('invalid_response', 'Firecrawl crawl response missing a known status');
      if (['failed', 'cancelled'].includes(data.status)) fail('crawl_failed', 'Firecrawl crawl job failed or was cancelled');
      out.results = map(data.data ?? [], x => ({ title: x.metadata?.title, url: x.metadata?.sourceURL || x.metadata?.url, content: x.markdown }));
      out.metadata = { job_status: data.status, total: data.total, completed: data.completed, ...(data.next ? { next_page_available: true } : {}) };
    } else if (r.action === 'read') {
      if (typeof data.data?.markdown !== 'string') fail('invalid_response', 'Firecrawl scrape missing markdown');
      out.results = [row(p, { title: data.data.metadata?.title, url: data.data.metadata?.sourceURL || r.url, content: data.data.markdown }, r)];
    } else out.results = map(Array.isArray(data.data) ? data.data : data.data?.web, x => ({ ...x, snippet: x.description, content: x.markdown }));
  } else if (p === 'brave') {
    if (!data.web && !data.query) fail('invalid_response', 'Brave response missing query/results');
    out.results = map(data.web?.results ?? [], x => ({ ...x, snippet: [x.description, ...list(x.extra_snippets)].filter(Boolean).join('\n') }));
  }
  else if (p === 'perplexity' && r.action === 'search') out.results = map(data.results, x => ({ ...x, published_at: x.date }));
  else if (p === 'grok' || p === 'perplexity') {
    if (data.status && data.status !== 'completed') fail('incomplete_response', 'Model response did not complete');
    const parts = [], citations = [];
    if (typeof data.output_text === 'string') parts.push(data.output_text);
    for (const item of list(data.output)) if (item?.type === 'message')
      for (const c of list(item.content)) {
        if (!data.output_text && typeof c?.text === 'string') parts.push(c.text);
        for (const a of list(c?.annotations)) if (a?.type === 'url_citation') citations.push({ ...a, ...(a.url_citation || {}) });
      }
    for (const c of list(data.citations)) citations.push(typeof c === 'string' ? { url: c } : c);
    if (!parts.length) fail('invalid_response', 'Model response missing answer text');
    out.answers = [{ provider: p, ...clip(parts.join('\n'), r.maxChars), citations: [...new Set(citations.map(x => safeURL(x.url)).filter(Boolean))] }];
    out.results = map(citations, x => ({ title: x.title || x.url, url: x.url, metadata: { source_type: 'model_citation' } }));
  } else if (p === 'metaso') {
    if (r.action === 'read') {
      const content = typeof data === 'string' ? data : data.markdown ?? data.content ?? data.data?.markdown ?? data.data?.content;
      if (typeof content !== 'string') fail('invalid_response', 'Metaso reader missing text');
      out.results = [row(p, { title: data.title, url: r.url, content }, r)];
    } else {
      const root = data.data ?? data;
      out.results = map(root.webpages ?? root.scholars ?? root.documents ?? root.results, x => ({ title: x.title, url: x.link || x.url, snippet: x.snippet || x.summary || x.abstract, content: x.content || x.rawContent, published_at: x.date || x.publishTime }));
    }
  } else if (p === 'context7') {
    if (r.action === 'libraries') out.results = map(data.results, x => ({ title: x.title, id: x.id, url: 'https://context7.com' + x.id, snippet: x.description, metadata: { library_id: x.id } }));
    else {
      if (!('codeSnippets' in data) && !('infoSnippets' in data)) fail('invalid_response', 'Context7 response missing snippets');
      const fence = String.fromCharCode(96).repeat(3);
      out.results = [
        ...array(data.codeSnippets ?? [], 'codeSnippets').map(x => row(p, { title: x.codeTitle || x.pageTitle, url: x.codeId, snippet: x.codeDescription, content: list(x.codeList).map(c => fence + (c.language || '') + '\n' + (c.code || '') + '\n' + fence).join('\n'), metadata: { library_id: x.libraryId } }, r)),
        ...array(data.infoSnippets ?? [], 'infoSnippets').map(x => row(p, { title: x.breadcrumb, url: x.pageId, snippet: x.content, content: x.content }, r)),
      ].slice(0, r.limit);
      if (data.version) out.metadata.version = data.version;
      if (headers.get('X-Context7-Search-Status') === 'partial') out.metadata.partial_reason = headers.get('X-Context7-Search-Reason') || 'partialSearchFailure';
    }
  } else if (p === 'consensus') out.results = map(data.results, x => ({ ...x, snippet: x.takeaway || x.abstract, content: list(x.full_text_chunks).join('\n\n'), published_at: x.publish_year, metadata: { authors: x.authors, journal: x.journal_name, doi: x.doi, citation_count: x.citation_count, year: x.publish_year } }));
  if (data?.usage && typeof data.usage === 'object') out.metadata.usage = data.usage;
  return out;
}
function canonical(link) {
  const u = new URL(link); u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k) || ['fbclid', 'gclid'].includes(k)) u.searchParams.delete(k);
  u.searchParams.sort(); return u.toString();
}
function merge(outputs) {
  const items = [], seen = new Map(), max = Math.max(0, ...outputs.map(o => o.results.length));
  for (let i = 0; i < max; i++) for (const o of outputs) {
    const x = o.results[i]; if (!x) continue;
    const k = x.url ? canonical(x.url) + (x.provider === 'context7' ? '\n' + (x.content || x.snippet) : '') : x.provider + ':' + (x.id || x.title) + ':' + (x.content || x.snippet);
    const old = seen.get(k);
    if (!old) { seen.set(k, x); items.push(x); }
    else {
      for (const s of x.provenance) if (!old.provenance.some(v => v.provider === s.provider && v.url === s.url)) old.provenance.push(s);
      if (x.content.length > old.content.length) { old.content = x.content; old.truncated = x.truncated; }
      if (x.snippet.length > old.snippet.length) old.snippet = x.snippet;
    }
  }
  return items;
}
async function body(resp, plainAllowed) {
  if (Number(resp.headers.get('content-length')) > MAX_BYTES) { await resp.body?.cancel(); fail('response_too_large', 'Response exceeds 20 MiB'); }
  const reader = resp.body?.getReader(), chunks = []; let bytes = 0, text = '';
  if (reader) {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); fail('response_too_large', 'Response exceeds 20 MiB'); }
      chunks.push(Buffer.from(value));
    }
    text = Buffer.concat(chunks).toString('utf8');
  } else text = await resp.text();
  try { return JSON.parse(text); } catch {
    if (plainAllowed && !/^\s*(<!doctype|<html)/i.test(text)) return text;
    fail('invalid_response', 'Provider did not return valid JSON');
  }
}
function publicError(e, p) {
  return { ...(p ? { provider: p } : {}), code: e instanceof SearchError ? e.code : 'internal_error', message: e instanceof SearchError ? e.message : 'Unexpected internal error', ...(e.http_status ? { http_status: e.http_status } : {}), ...(e.retry_after ? { retry_after: e.retry_after } : {}), retryable: !!e.retryable };
}
export async function run(input, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  let r, names;
  try { r = check(input); if (!['doctor', 'providers'].includes(r.action)) names = select(r, env); }
  catch (e) { return { schema_version: 1, status: 'error', results: [], answers: [], runs: [], errors: [publicError(e)] }; }
  if (['doctor', 'providers'].includes(r.action)) return { schema_version: 1, status: 'ok', node_version: process.version, providers: providerStatus(env), routes: ROUTES };
  const secrets = Object.values(PROVIDERS).map(d => env[d.key]).filter(Boolean);
  const outputs = await Promise.all(names.map(async p => {
    const start = Date.now();
    try {
      const request = buildRequest(p, r, env);
      if (r.dryRun) {
        request.headers = Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, /authorization|key|token/i.test(k) ? '[REDACTED]' : v]));
        return { provider: p, results: [], answers: [], metadata: {}, duration_ms: 0, request };
      }
      if (!hasKey(env, p) && !(p === 'anysearch' && r.anonymous)) fail('not_configured', PROVIDERS[p].key + ' is not configured');
      let resp;
      try {
        resp = await fetchImpl(request.url, { method: request.method, headers: request.headers, ...(request.body ? { body: JSON.stringify(request.body) } : {}), signal: AbortSignal.timeout(r.timeout * 1000), redirect: 'error' });
      } catch (e) {
        if (e.name === 'TimeoutError' || e.name === 'AbortError') fail('timeout', p + ' exceeded ' + r.timeout + 's', { retryable: true });
        fail('network_error', p + ' network request failed; check connectivity', { retryable: true });
      }
      // Provider error bodies can contain credentials. Deliberately discard them.
      if (!resp.ok && !(p === 'context7' && resp.status === 404)) {
        await resp.body?.cancel();
        const code = [401, 403].includes(resp.status) ? 'authentication_failed' : [402, 432, 433].includes(resp.status) ? 'quota_exhausted' : resp.status === 429 ? 'rate_limited' : resp.status >= 500 ? 'upstream_error' : 'http_error';
        fail(code, p + ' returned HTTP ' + resp.status + '; check dashboard and parameters', { http_status: resp.status, retryable: resp.status === 429 || resp.status >= 500, retry_after: resp.headers.get('retry-after') });
      }
      const data = await body(resp, p === 'metaso' && r.action === 'read');
      if (p === 'context7' && resp.status === 404) {
        if (data?.error !== 'no_documentation_found') fail('http_error', 'Context7 returned HTTP 404', { http_status: 404 });
        return { provider: p, results: [], answers: [], metadata: { empty_reason: 'no_documentation_found' }, duration_ms: Date.now() - start };
      }
      if (!data || Array.isArray(data) || typeof data !== 'object' && !(p === 'metaso' && r.action === 'read')) fail('invalid_response', 'Expected a JSON object');
      if (data?.success === false || data?.error || p === 'anysearch' && data.code !== 0 || p === 'metaso' && data.errCode !== undefined && ![0, '0'].includes(data.errCode)) fail('provider_error', p + ' reported an application error; check dashboard');
      return { provider: p, ...parse(p, data, r, resp.headers), duration_ms: Date.now() - start };
    } catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') e = new SearchError('timeout', p + ' exceeded ' + r.timeout + 's', { retryable: true });
      else if (e instanceof TypeError && !(e instanceof SearchError)) e = new SearchError('invalid_response', p + ' response has an unexpected shape');
      return { provider: p, results: [], answers: [], metadata: {}, duration_ms: Date.now() - start, error: publicError(e, p) };
    }
  }));
  const errors = outputs.filter(o => o.error).map(o => o.error), partial = o => !!(o.metadata.partial_reason || o.metadata.failed_results?.length);
  const output = { schema_version: 1, status: errors.length === outputs.length ? 'error' : errors.length || outputs.some(partial) ? 'partial' : 'ok', action: r.action, intent: r.intent, query: r.query || null,
    results: merge(outputs), answers: outputs.flatMap(o => o.answers), runs: outputs.map(o => ({ provider: o.provider, status: o.error ? 'error' : partial(o) ? 'partial' : 'ok', duration_ms: o.duration_ms, metadata: o.metadata })), errors,
    ...(r.dryRun ? { dry_run: true, requests: outputs.filter(o => o.request).map(o => ({ provider: o.provider, ...o.request })) } : {}) };
  const sanitized = scrub(output, secrets);
  // Stable protocol labels must not be changed when a key happens to contain the same word.
  for (const k of ['status', 'action', 'intent']) sanitized[k] = output[k];
  sanitized.errors = errors.map(e => ({ ...e, message: scrub(e.message, secrets), ...(e.retry_after ? { retry_after: scrub(e.retry_after, secrets) } : {}) }));
  sanitized.runs.forEach((o, i) => { o.provider = output.runs[i].provider; o.status = output.runs[i].status; });
  sanitized.results.forEach((o, i) => { o.provider = output.results[i].provider; o.provenance.forEach((s, j) => { s.provider = output.results[i].provenance[j].provider; }); });
  sanitized.answers.forEach((o, i) => { o.provider = output.answers[i].provider; });
  if (sanitized.requests) sanitized.requests.forEach((o, i) => { o.provider = output.requests[i].provider; });
  return sanitized;
}
export async function loadEnvFile(path, env = process.env) {
  const text = (await readFile(path, 'utf8')).replace(/^\uFEFF/, ''), out = { ...env }, keys = [...Object.values(PROVIDERS).map(d => d.key), 'XAI_SEARCH_MODEL'];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || !keys.includes(m[1])) fail('invalid_config', 'Unsupported environment file line or variable');
    let value = m[2];
    if (/^['"]/.test(value)) {
      if (value.at(-1) !== value[0]) fail('invalid_config', 'Unclosed quote in environment file');
      value = value.slice(1, -1);
    } else value = value.replace(/\s+#.*$/, '');
    if (!out[m[1]]) out[m[1]] = value;
  }
  return out;
}
const HELP = 'agent-search (Node.js 20+, no npm dependencies)\n' +
  'Usage: node search.mjs <action> [options]\n       node search.mjs --request request.json [--env-file secrets.env]\n' +
  'Actions: search, read, answer, libraries, docs, subdomains, crawl, crawl-status, doctor, providers\n' +
  'Options: --provider NAME[,NAME] --query TEXT --url URL --intent web|code|papers|semantic|news|social|chinese|research\n' +
  '         --limit 1..20 --library NAME --library-id ID --version VERSION --language LANG --domain DOMAIN\n' +
  '         --depth basic|advanced|fast|ultra-fast --model MODEL --preset PRESET --job-id ID\n' +
  '         --options-file FILE --timeout 1..180 --max-chars 100..100000 --env-file FILE --anonymous --dry-run\n' +
  'Exit codes: 0 success/empty success; 1 error; 2 partial. See references/interface.md.';
async function cli(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return; }
  const input = {}, paths = {}, flags = { '--provider': 'provider', '--query': 'query', '--url': 'url', '--intent': 'intent', '--limit': 'limit', '--library': 'library', '--library-id': 'libraryId', '--version': 'version', '--language': 'language', '--domain': 'domain', '--depth': 'depth', '--model': 'model', '--preset': 'preset', '--job-id': 'jobId', '--timeout': 'timeout', '--max-chars': 'maxChars' };
  try {
    let i = 0; if (!argv[0].startsWith('-')) input.action = argv[i++];
    for (; i < argv.length; i++) {
      const flag = argv[i];
      if (flag === '--dry-run' || flag === '--anonymous') { input[flag === '--dry-run' ? 'dryRun' : 'anonymous'] = true; continue; }
      const key = flags[flag], pathKey = { '--request': 'request', '--options-file': 'options', '--env-file': 'env' }[flag];
      if (!key && !pathKey) fail('invalid_request', 'Unknown CLI option: ' + flag);
      const value = argv[++i]; if (value === undefined || value.startsWith('--')) fail('invalid_request', 'Missing value for ' + flag);
      if (pathKey) paths[pathKey] = value;
      else if (['library', 'domain'].includes(key)) input[key] = [...list(input[key]), value];
      else input[key] = value;
    }
    const readJSON = async p => JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''));
    const base = paths.request ? await readJSON(paths.request) : {};
    if (!base || typeof base !== 'object' || Array.isArray(base)) fail('invalid_request', 'Request file must contain a JSON object');
    if (paths.options) input.options = await readJSON(paths.options);
    const output = await run({ ...base, ...input }, { env: paths.env ? await loadEnvFile(paths.env) : process.env });
    console.log(JSON.stringify(output, null, 2));
    process.exitCode = output.status === 'error' ? 1 : output.status === 'partial' ? 2 : 0;
  } catch (e) {
    console.log(JSON.stringify({ schema_version: 1, status: 'error', results: [], answers: [], runs: [], errors: [e instanceof SearchError ? publicError(e) : { code: 'invalid_config', message: 'Could not read or parse a request/options/environment file', retryable: false }] }, null, 2));
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await cli(process.argv.slice(2));
