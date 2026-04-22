#!/bin/sh
set -eu
python3 - <<'PY'
import json, subprocess, sys, re
from pathlib import Path
from datetime import datetime, timezone

ICP = Path('/tmp/apollo-segment/icp-config.json')
OUT = Path('/tmp/apollo-segment/discovered-prospects.json')

def fail(msg, code=42):
    print(msg, file=sys.stderr)
    raise SystemExit(code)

def run_tool(slug, data):
    proc = subprocess.run(['composio', 'execute', slug, '-d', json.dumps(data)], capture_output=True, text=True)
    if proc.returncode != 0:
        fail(f'{slug} failed: {proc.stderr.strip() or proc.stdout.strip()}')
    try:
        payload = json.loads(proc.stdout)
    except Exception as e:
        fail(f'{slug} returned non-JSON output: {e}\n{proc.stdout[:500]}')
    if not payload.get('successful', False):
        fail(f'{slug} unsuccessful: {json.dumps(payload)[:800]}')
    if payload.get('storedInFile') and payload.get('outputFilePath'):
        try:
            payload = json.loads(Path(payload['outputFilePath']).read_text())
        except Exception as e:
            fail(f"{slug} stored output could not be read: {e}")
        if not payload.get('successful', False):
            fail(f'{slug} stored output unsuccessful: {json.dumps(payload)[:800]}')
    return payload.get('data') or {}

if not ICP.exists():
    fail('Missing /tmp/apollo-segment/icp-config.json')

icp = json.loads(ICP.read_text())
planner = {}
planner_path = Path('.threados/state/planner-bindings.json')
if planner_path.exists():
    try:
        planner = json.loads(planner_path.read_text())
    except Exception:
        planner = {}
selected_strategy = planner.get('selected_strategy') or 'standard-discovery'
industries = icp.get('filters', {}).get('industry_keywords', [])
geos = icp.get('filters', {}).get('geographies', [])
size = icp.get('filters', {}).get('company_size_range', {})
titles = icp.get('filters', {}).get('titles', [])
if selected_strategy == 'broaden-discovery':
    industries = industries[:5]
    titles = titles[:8]
    geos = geos[:4]
else:
    industries = industries[:3]
    titles = titles[:5]
    geos = geos[:4]
if not industries or not titles:
    fail('ICP config missing industry keywords or titles')

usage_data = run_tool('APOLLO_VIEW_API_USAGE_STATS', {})
orgs = []
org_seen = set()
for industry in industries:
    data = run_tool('APOLLO_ORGANIZATION_SEARCH', {
        'q_organization_keyword_tags': [industry],
        'organization_num_employees_ranges': [f"{size.get('min_employees',10)},{size.get('max_employees',500)}"],
        'organization_locations': geos[:4],
        'per_page': 25,
        'page': 1,
    })
    for org in data.get('organizations') or data.get('accounts') or []:
        oid = org.get('id') or org.get('organization_id') or org.get('apollo_organization_id')
        if not oid or oid in org_seen:
            continue
        org_seen.add(oid)
        domain = org.get('primary_domain') or org.get('website_url') or org.get('domain')
        if domain and isinstance(domain, str):
            domain = re.sub(r'^https?://', '', domain).strip('/').removeprefix('www.')
        orgs.append({'id': oid, 'name': org.get('name'), 'domain': domain, '_raw': org})

domains = [o['domain'] for o in orgs if o.get('domain')][:25]
prospects = []
seen = set()
for title in titles:
    if not domains:
        break
    data = run_tool('APOLLO_PEOPLE_SEARCH', {
        'q_organization_domains': domains,
        'person_titles': [title],
        'person_seniorities': ['director', 'vp', 'head', 'manager'],
        'contact_email_status': ['verified', 'unverified'],
        'per_page': 25,
        'page': 1,
    })
    for p in data.get('people') or data.get('contacts') or []:
        pid = p.get('id') or p.get('person_id') or p.get('apollo_person_id') or f"{title}:{p.get('email')}:{p.get('name')}"
        if pid in seen:
            continue
        seen.add(pid)
        company_domain = p.get('organization_domain') or p.get('company_domain') or (p.get('organization') or {}).get('primary_domain') or (p.get('organization') or {}).get('website_url')
        if company_domain and isinstance(company_domain, str):
            company_domain = re.sub(r'^https?://', '', company_domain).strip('/').removeprefix('www.')
        prospects.append({
            'source': 'apollo_discovery',
            'apollo_person_id': p.get('id') or p.get('person_id') or p.get('apollo_person_id'),
            'name': p.get('name') or ' '.join(x for x in [p.get('first_name') or '', p.get('last_name') or ''] if x).strip() or None,
            'title': p.get('title'),
            'email': p.get('email'),
            'has_email': bool(p.get('email')),
            'has_direct_phone': bool(p.get('phone') or p.get('sanitized_phone')),
            'phone': p.get('phone') or p.get('sanitized_phone'),
            'company': p.get('organization_name') or p.get('company') or (p.get('account') or {}).get('name') or (p.get('organization') or {}).get('name'),
            'company_domain': company_domain,
            'organization_id': p.get('organization_id') or (p.get('account') or {}).get('id') or (p.get('organization') or {}).get('id'),
            'linkedin_url': p.get('linkedin_url'),
            'seniority': p.get('seniority'),
            'persona_lane': None,
            'already_enriched': False,
            'relevance_notes': title,
            '_raw': p,
        })

result = {
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'credits_used': 0,
    'credits_remaining': usage_data,
    'organizations_searched': len(orgs),
    'prospects': prospects,
}
OUT.write_text(json.dumps(result, indent=2) + '\n')
print(f'FILES_CREATED: {OUT}')
print(json.dumps({'organizations_searched': len(orgs), 'prospects': len(prospects)}))
PY
