#!/bin/sh
set -eu
python3 - <<'PY'
import json, subprocess, sys, re
from pathlib import Path
from datetime import datetime, timezone

ICP = Path('/tmp/apollo-segment/icp-config.json')
OUT = Path('/tmp/apollo-segment/saved-contacts.json')

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
titles = icp.get('filters', {}).get('titles', [])
if not titles:
    fail('ICP config has no titles')

stages_data = run_tool('APOLLO_LIST_CONTACT_STAGES', {})
usage_data = run_tool('APOLLO_VIEW_API_USAGE_STATS', {})
all_contacts = []
seen = set()

for title in titles:
    for page in range(1, 6):
        data = run_tool('APOLLO_SEARCH_CONTACTS', {'q_keywords': title, 'per_page': 100, 'page': page})
        contacts = data.get('contacts') or []
        for c in contacts:
            cid = c.get('id') or c.get('contact_id') or c.get('apollo_contact_id') or f"{title}:{c.get('email')}:{c.get('name')}"
            if cid in seen:
                continue
            seen.add(cid)
            first = c.get('first_name') or ''
            last = c.get('last_name') or ''
            name = c.get('name') or ' '.join(x for x in [first, last] if x).strip() or None
            company = c.get('organization_name') or c.get('company') or (c.get('account') or {}).get('name')
            company_domain = c.get('website_url') or c.get('organization_website_url') or c.get('company_domain')
            if company_domain and isinstance(company_domain, str):
                company_domain = re.sub(r'^https?://', '', company_domain).strip('/').removeprefix('www.')
            item = {
                'source': 'apollo_saved',
                'apollo_contact_id': c.get('id') or c.get('contact_id') or c.get('apollo_contact_id'),
                'apollo_person_id': c.get('person_id') or c.get('apollo_person_id') or c.get('id'),
                'name': name,
                'email': c.get('email'),
                'title': c.get('title'),
                'company': company,
                'company_domain': company_domain,
                'organization_id': c.get('organization_id') or (c.get('account') or {}).get('id'),
                'phone': c.get('phone') or c.get('sanitized_phone'),
                'current_stage_id': c.get('contact_stage_id') or c.get('stage_id'),
                'current_stage_name': c.get('contact_stage_name') or c.get('stage_name'),
                'owner_id': c.get('owner_id'),
                '_raw': c,
            }
            all_contacts.append(item)
        pag = data.get('pagination') or {}
        total_pages = pag.get('total_pages') or 0
        if not contacts or page >= total_pages:
            break

result = {
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'stages_available': stages_data.get('contact_stages') or [],
    'usage_snapshot': usage_data,
    'total_contacts': len(all_contacts),
    'contacts': all_contacts,
}
OUT.write_text(json.dumps(result, indent=2) + '\n')
print(f'FILES_CREATED: {OUT}')
print(json.dumps({'total_contacts': len(all_contacts), 'stage_count': len(result['stages_available'])}))
PY
