import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run, buildRequest, PROVIDERS, loadEnvFile } from './search.mjs';

const env = Object.fromEntries(Object.entries(PROVIDERS).map(([p, d]) => [d.key, 'test-secret-' + p + '-12345']));
const link = 'https://example.com/source';
const model = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Grounded answer', annotations: [{ type: 'url_citation', title: 'Source', url: link }] }] }] };
const fixtures = {
  anysearch: { code: 0, data: { results: [{ title: 'Source', url: link, snippet: 'AnySearch evidence' }] } },
  tavily: { results: [{ title: 'Source', url: link, content: 'Tavily evidence', score: 0.7 }] },
  exa: { results: [{ title: 'Source', url: link, highlights: ['Exa evidence'], text: 'Exa full text', publishedDate: '2026-10-01' }] },
  firecrawl: { success: true, data: { web: [{ title: 'Source', url: link, description: 'Firecrawl evidence' }] } },
  brave: { query: { original: 'topic' }, web: { results: [{ title: 'Source', url: link, description: 'Brave evidence', extra_snippets: ['More'] }] } },
  perplexity: { results: [{ title: 'Source', url: link, snippet: 'Perplexity evidence', date: '2026-10-01' }] },
  grok: model,
  metaso: { webpages: [{ title: '来源', link, snippet: '秘塔证据' }] },
  context7: { codeSnippets: [{ codeTitle: 'Effect cleanup', codeId: link, libraryId: '/facebook/react', codeDescription: 'Cleanup', codeList: [{ language: 'js', code: 'return cleanup;' }] }], infoSnippets: [], version: { requested: '19', status: 'verified' } },
  consensus: { results: [{ title: 'Paper', url: link, takeaway: 'Paper finding', authors: ['A'], publish_year: 2026, journal_name: 'Journal', doi: '10.1000/test', citation_count: 3, full_text_chunks: ['Evidence section'] }] },
};
const endpoints = {
  anysearch: 'https://api.anysearch.com/v1/search', tavily: 'https://api.tavily.com/search',
  exa: 'https://api.exa.ai/search', firecrawl: 'https://api.firecrawl.dev/v2/search',
  brave: 'https://api.search.brave.com/res/v1/web/search', perplexity: 'https://api.perplexity.ai/search',
  grok: 'https://api.x.ai/v1/responses', metaso: 'https://metaso.cn/api/v1/search',
  context7: 'https://context7.com/api/v3/search', consensus: 'https://api.consensus.app/v1/search',
};
function mock(data, headers = {}, status = 200) {
  return async () => new Response(typeof data === 'string' ? data : JSON.stringify(data), { status, headers: { 'Content-Type': typeof data === 'string' ? 'text/plain' : 'application/json', ...headers } });
}
for (const p of Object.keys(PROVIDERS)) test(p + ' request and search response', async () => {
  let calls = 0;
  const out = await run({ provider: p, query: 'topic 中文', limit: 3 }, { env, fetchImpl: async (u, opts) => {
    calls++;
    assert.equal(u.split('?')[0], endpoints[p]);
    assert.equal(opts.redirect, 'error');
    assert.ok(Object.values(opts.headers).includes(p === 'brave' || ['exa', 'consensus'].includes(p) ? env[PROVIDERS[p].key] : 'Bearer ' + env[PROVIDERS[p].key]));
    if (opts.body) assert.doesNotThrow(() => JSON.parse(opts.body));
    return mock(fixtures[p])();
  } });
  assert.equal(calls, 1);
  assert.equal(out.status, 'ok', JSON.stringify(out.errors));
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].url, link);
  if (p === 'grok') assert.equal(out.answers[0].text, 'Grounded answer');
  if (p === 'consensus') assert.equal(out.results[0].metadata.doi, '10.1000/test');
});
test('all page readers preserve full text', async () => {
  const reads = {
    anysearch: { code: 0, data: { title: 'Page', url: link, content: 'Full page' } },
    tavily: { results: [{ url: link, raw_content: 'Full page' }], failed_results: [] },
    exa: { results: [{ url: link, text: 'Full page' }] },
    firecrawl: { success: true, data: { markdown: 'Full page', metadata: { sourceURL: link } } },
    metaso: 'Full page',
  };
  for (const [p, data] of Object.entries(reads)) {
    const out = await run({ action: 'read', provider: p, url: link }, { env, fetchImpl: mock(data) });
    assert.equal(out.status, 'ok', p + JSON.stringify(out.errors));
    assert.equal(out.results[0].content, 'Full page');
    assert.equal(out.results[0].url, link);
  }
  assert.deepEqual(buildRequest('metaso', { action: 'read', url: link }, env).body, { url: link });
});
test('Perplexity answer uses current Agent API with citations', async () => {
  const req = buildRequest('perplexity', { action: 'answer', query: 'topic' }, env);
  assert.equal(req.url, 'https://api.perplexity.ai/v1/agent');
  assert.equal(req.body.preset, 'fast');
  const out = await run({ action: 'answer', provider: 'perplexity', query: 'topic' }, { env, fetchImpl: mock(model) });
  assert.equal(out.answers[0].citations[0], link);
});
test('Grok social uses X Search and date filters', () => {
  const req = buildRequest('grok', { query: 'topic', intent: 'social', options: { from_date: '2026-10-01' } }, env);
  assert.deepEqual(req.body.tools, [{ type: 'x_search', from_date: '2026-10-01' }]);
  assert.throws(() => buildRequest('grok', { query: 'topic', options: { from_date: '2026-10-01' } }, env));
});
test('Context7 discovery, fixed library and version partial status', async () => {
  const req = buildRequest('context7', { query: 'topic', library: ['react', 'next.js'], version: '19' }, env);
  assert.deepEqual(new URL(req.url).searchParams.getAll('library'), ['react', 'next.js']);
  const lib = await run({ action: 'libraries', library: 'react', query: 'topic' }, { env, fetchImpl: mock({ results: [{ id: '/facebook/react', title: 'React' }] }) });
  assert.equal(lib.results[0].id, '/facebook/react');
  assert.equal(buildRequest('context7', { action: 'docs', libraryId: '/facebook/react', query: 'topic' }, env).url.split('?')[0], 'https://context7.com/api/v2/context');
  const out = await run({ provider: 'context7', query: 'topic' }, { env, fetchImpl: mock(fixtures.context7, { 'X-Context7-Search-Status': 'partial', 'X-Context7-Search-Reason': 'versionUnverified' }) });
  assert.equal(out.status, 'partial');
  assert.equal(out.runs[0].metadata.partial_reason, 'versionUnverified');
});
test('Context7 documentation not found is empty success', async () => {
  const out = await run({ provider: 'context7', query: 'topic' }, { env, fetchImpl: mock({ error: 'no_documentation_found' }, {}, 404) });
  assert.equal(out.status, 'ok'); assert.deepEqual(out.results, []);
  const wrong = await run({ provider: 'context7', query: 'topic' }, { env, fetchImpl: mock({ error: 'wrong_endpoint' }, {}, 404) });
  assert.equal(wrong.status, 'error');
});
test('AnySearch repeated domains and strict extraction body', async () => {
  const req = buildRequest('anysearch', { action: 'subdomains', domain: ['code', 'finance'] }, env);
  assert.deepEqual(new URL(req.url).searchParams.getAll('domain'), ['code', 'finance']);
  const out = await run({ action: 'subdomains', provider: 'anysearch', domain: 'code' }, { env, fetchImpl: mock({ code: 0, data: { domains: [{ domain: 'code', sub_domains: [] }] } }) });
  assert.equal(out.runs[0].metadata.domains[0].domain, 'code');
  assert.deepEqual(buildRequest('anysearch', { action: 'read', url: link }, env).body, { url: link });
  assert.equal(buildRequest('anysearch', { query: 'topic', limit: 20 }, env).body.max_results, 10);
});
test('Firecrawl capped creation, one poll and failed status', async () => {
  const req = buildRequest('firecrawl', { action: 'crawl', url: link, limit: 10 }, env);
  assert.equal(req.body.limit, 10);
  const created = await run({ action: 'crawl', provider: 'firecrawl', url: link }, { env, fetchImpl: mock({ success: true, id: 'job-123' }) });
  assert.equal(created.runs[0].metadata.job_id, 'job-123');
  let calls = 0;
  const polled = await run({ action: 'crawl-status', provider: 'firecrawl', jobId: 'job-123' }, { env, fetchImpl: async () => { calls++; return mock({ status: 'completed', total: 1, completed: 1, next: 'unfollowed', data: [{ markdown: 'Page', metadata: { sourceURL: link } }] })(); } });
  assert.equal(calls, 1); assert.equal(polled.runs[0].metadata.next_page_available, true);
  const failed = await run({ action: 'crawl-status', provider: 'firecrawl', jobId: 'job-123' }, { env, fetchImpl: mock({ status: 'failed' }) });
  assert.equal(failed.errors[0].code, 'crawl_failed');
});
test('routing uses task and available keys; library constraints are preserved', async () => {
  for (const [intent, p] of [['code', 'context7'], ['papers', 'consensus'], ['semantic', 'exa'], ['chinese', 'metaso'], ['social', 'grok']]) {
    const out = await run({ intent, query: 'topic' }, { env, fetchImpl: mock(fixtures[p]) });
    assert.equal(out.runs[0].provider, p);
  }
  const out = await run({ intent: 'code', query: 'topic', library: 'react' }, { env: { TAVILY_API_KEY: env.TAVILY_API_KEY }, fetchImpl: async () => assert.fail('must not ignore library') });
  assert.equal(out.errors[0].code, 'not_configured');
});
test('explicit provider never silently falls back', async () => {
  const out = await run({ provider: 'exa', query: 'topic' }, { env: { TAVILY_API_KEY: 'configured' }, fetchImpl: async () => assert.fail('no network') });
  assert.equal(out.errors[0].code, 'not_configured');
});
test('anonymous is opt-in and dry run is offline with redacted keys', async () => {
  const noNetwork = async () => assert.fail('must not call network');
  const disabled = await run({ provider: 'anysearch', query: 'topic' }, { env: {}, fetchImpl: noNetwork });
  assert.equal(disabled.status, 'error');
  const enabled = await run({ provider: 'anysearch', query: 'topic', anonymous: true }, { env: {}, fetchImpl: mock(fixtures.anysearch) });
  assert.equal(enabled.status, 'ok');
  const dry = await run({ provider: 'tavily', query: 'topic', dryRun: true }, { env, fetchImpl: noNetwork });
  assert.equal(dry.requests[0].headers.Authorization, '[REDACTED]');
  assert.ok(!JSON.stringify(dry).includes(env.TAVILY_API_KEY));
});
test('URL dedup preserves provider provenance and distinct Context7 snippets', async () => {
  const out = await run({ provider: ['tavily', 'exa'], query: 'topic' }, { env, fetchImpl: async u => mock(u.includes('tavily') ? { results: [{ title: 'Page', url: link + '?utm_source=test#anchor', content: 'snippet' }] } : fixtures.exa)() });
  assert.equal(out.results.length, 1);
  assert.deepEqual(out.results[0].provenance.map(x => x.provider), ['tavily', 'exa']);
  assert.equal(out.results[0].content, 'Exa full text');
  const docs = await run({ provider: 'context7', query: 'topic' }, { env, fetchImpl: mock({ codeSnippets: [], infoSnippets: [{ pageId: link, content: 'First' }, { pageId: link, content: 'Second' }] }) });
  assert.equal(docs.results.length, 2);
});
test('partial multi-source failure keeps successful evidence', async () => {
  const out = await run({ provider: 'tavily,exa', query: 'topic' }, { env, fetchImpl: async u => u.includes('tavily') ? mock(fixtures.tavily)() : mock({ message: 'private' }, {}, 429)() });
  assert.equal(out.status, 'partial'); assert.equal(out.results.length, 1);
  assert.equal(out.errors[0].code, 'rate_limited');
});
test('HTTP errors suppress generated credentials and never retry', async () => {
  for (const [status, code] of [[401, 'authentication_failed'], [403, 'authentication_failed'], [402, 'quota_exhausted'], [429, 'rate_limited'], [500, 'upstream_error']]) {
    let calls = 0;
    const out = await run({ provider: 'anysearch', query: 'topic' }, { env, fetchImpl: async () => { calls++; return mock({ message: 'api_key=new-secret password=private-password' }, { 'retry-after': '5' }, status)(); } });
    assert.equal(calls, 1); assert.equal(out.errors[0].code, code);
    assert.ok(!JSON.stringify(out).includes('private-password'));
    assert.ok(!JSON.stringify(out).includes('new-secret'));
  }
});
test('business failure is not reported as empty success', async () => {
  for (const [p, fixture] of [['anysearch', { code: -1, message: 'api_key=private' }], ['firecrawl', { success: false }], ['metaso', { errCode: 3, errMsg: 'private' }]]) {
    const out = await run({ provider: p, query: 'topic' }, { env, fetchImpl: mock(fixture) });
    assert.equal(out.status, 'error'); assert.equal(out.errors[0].code, 'provider_error');
  }
});
test('invalid response shapes and HTML fail; genuine empty results succeed', async () => {
  for (const data of ['<html>login</html>', {}, { results: [null] }]) {
    const out = await run({ provider: 'tavily', query: 'topic' }, { env, fetchImpl: mock(data) });
    assert.equal(out.errors[0].code, 'invalid_response');
  }
  const empty = await run({ provider: 'tavily', query: 'topic' }, { env, fetchImpl: mock({ results: [] }) });
  assert.equal(empty.status, 'ok');
  const brave = await run({ provider: 'brave', query: 'topic' }, { env, fetchImpl: mock({}) });
  assert.equal(brave.errors[0].code, 'invalid_response');
});
test('timeouts, network errors and response cap are distinct', async () => {
  for (const [name, code] of [['TimeoutError', 'timeout'], ['TypeError', 'network_error']]) {
    const out = await run({ provider: 'tavily', query: 'topic' }, { env, fetchImpl: async () => { const e = new Error('sensitive'); e.name = name; throw e; } });
    assert.equal(out.errors[0].code, code);
  }
  const oversized = await run({ provider: 'tavily', query: 'topic' }, { env, fetchImpl: mock(fixtures.tavily, { 'content-length': String(21 * 1024 * 1024) }) });
  assert.equal(oversized.errors[0].code, 'response_too_large');
});
test('truncation is explicit and configured secrets are scrubbed', async () => {
  const out = await run({ provider: 'anysearch', query: 'topic', maxChars: 100 }, { env, fetchImpl: mock({ code: 0, data: { results: [{ url: link, content: 'A'.repeat(120), snippet: env.ANYSEARCH_API_KEY + ' password=generated-secret' }] } }) });
  assert.equal(out.results[0].content.length, 100); assert.equal(out.results[0].truncated, true);
  assert.ok(!JSON.stringify(out).includes(env.ANYSEARCH_API_KEY));
  assert.ok(!JSON.stringify(out).includes('generated-secret'));
});
test('input errors and unsupported combinations do not call network', async () => {
  const cases = [{ query: 'topic', provider: '__proto__' }, { query: 'topic', provider: ['tavily', 'exa', 'brave', 'anysearch'] }, { query: 'topic', provider: 'auto,exa' }, { action: 'read', provider: 'brave', url: link }, { action: 'read', url: 'file:///private' }, { action: 'read', url: 'https://user:pass@example.com' }, { query: 'topic', limit: 0 }, { query: 'topic', apiKey: 'private' }, { query: 'topic', provider: 'tavily', options: { api_key: 'private' } }];
  for (const input of cases) {
    const out = await run(input, { env, fetchImpl: async () => assert.fail('no network') });
    assert.equal(out.status, 'error');
  }
});
test('env file precedence and CLI JSON input / exit status', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-search-test-'));
  const script = join(dirname(fileURLToPath(import.meta.url)), 'search.mjs');
  try {
    const cfg = join(dir, 'private.env'), request = join(dir, 'request.json');
    await writeFile(cfg, 'TAVILY_API_KEY="file-secret"\n# comment\nEXA_API_KEY=file-exa\n', 'utf8');
    assert.equal((await loadEnvFile(cfg, { TAVILY_API_KEY: 'process-secret' })).TAVILY_API_KEY, 'process-secret');
    await writeFile(request, '\uFEFF' + JSON.stringify({ provider: 'tavily', query: '中文 "quotes"\nline', dryRun: true }), 'utf8');
    const done = spawnSync(process.execPath, [script, '--request', request, '--env-file', cfg], { encoding: 'utf8', env: { ...process.env, TAVILY_API_KEY: '' } });
    assert.equal(done.status, 0); assert.equal(JSON.parse(done.stdout).query, '中文 "quotes"\nline');
    assert.ok(!done.stdout.includes('file-secret'));
    const bad = spawnSync(process.execPath, [script, 'read', '--url', 'file:///secret'], { encoding: 'utf8' });
    assert.equal(bad.status, 1); assert.equal(JSON.parse(bad.stdout).status, 'error');
    const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
