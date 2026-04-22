#!/bin/sh
set -eu
python3 - <<'PY'
import json, subprocess, sys, re
from pathlib import Path
from datetime import datetime, timezone

ICP = Path('/tmp/apollo-segment/icp-config.json')
SAVED = Path('/tmp/apollo-segment/saved-contacts.json')
DISC = Path('/tmp/apollo-segment/discovered-prospects.json')
OUT = Path('/tmp/apollo-segment/qualified-segment.json')
STATE_MANAGER = Path('/mnt/c/Users/albak/xdev/Claude_Code_Automations/scripts/state_manager.py')
PY_CANDIDATES = [
    Path('/mnt/c/Users/albak/xdev/ruleIQ/.venv/bin/python'),
    Path('/mnt/c/Users/albak/xdev/ruleIQ-worktrees/wt3/.venv/bin/python'),
    Path('/mnt/c/Users/albak/xdev/LiveTrading/.venv-wsl/bin/python'),
    Path('/usr/bin/python3'),
]

SPECIAL_HANDLING = ['sentbe', 'jpmorgan', 'jp morgan', 'citibank', 'citi', 'barclays', 'hsbc', 'standard chartered', 'deutsche bank', 'bank of america', 'wells fargo']
PAYMENTS = ['payments', 'payment', 'ops', 'operations', 'coo', 'cso', 'settlement']
TREASURY = ['cfo', 'treasurer', 'finance director', 'head of treasury']
PARTNERSHIPS = ['bd', 'business development', 'partnership', 'partnerships', 'network', 'growth', 'co-founder']
TECH = ['cto', 'vp engineering', 'engineering', 'technical', 'integration', 'developer']
COMPLIANCE = ['compliance', 'risk', 'legal', 'counsel', 'cco', 'regulatory']


def fail(msg, code=42):
    print(msg, file=sys.stderr)
    raise SystemExit(code)

def load_json(path):
    if not path.exists():
        return {}
    return json.loads(path.read_text())

def pick_python():
    for candidate in PY_CANDIDATES:
        if not candidate.exists():
            continue
        proc = subprocess.run([str(candidate), str(STATE_MANAGER), '--help'], capture_output=True, text=True)
        if proc.returncode == 0:
            return str(candidate)
    return None

def normalize(s):
    return re.sub(r'\s+', ' ', (s or '').strip().lower())

def dedup_key(contact):
    if contact.get('email'):
        return ('email', normalize(contact['email']))
    if contact.get('apollo_person_id'):
        return ('person', str(contact['apollo_person_id']))
    return ('name_company', normalize(contact.get('name')), normalize(contact.get('company')))

def merge_contact(existing, incoming):
    merged = dict(existing)
    for k, v in incoming.items():
        if merged.get(k) in (None, '', [], {}):
            merged[k] = v
    sources = set()
    for value in [existing.get('source'), incoming.get('source')]:
        if isinstance(value, list):
            sources.update(value)
        elif value:
            sources.add(value)
    if sources == {'apollo_saved', 'apollo_discovery'}:
        merged['source'] = 'both'
    elif len(sources) == 1:
        merged['source'] = next(iter(sources))
    else:
        merged['source'] = sorted(sources)
    merged['dedup_status'] = 'merged' if existing != merged else existing.get('dedup_status', 'unique')
    return merged

def persona_lane(title):
    t = normalize(title)
    if any(token in t for token in TREASURY):
        return 'A'
    if any(token in t for token in PAYMENTS):
        return 'B'
    if any(token in t for token in TECH):
        return 'D'
    if any(token in t for token in COMPLIANCE):
        return 'E'
    if any(token in t for token in PARTNERSHIPS):
        return 'C'
    return 'C'

def motion_type(company):
    c = normalize(company)
    if any(token in c for token in ['network', 'infrastructure', 'infra']):
        return 'Participant'
    return 'FC'

def fit_score(contact, icp):
    title = normalize(contact.get('title'))
    titles = [normalize(t) for t in icp.get('filters', {}).get('titles', [])]
    if title and any(t == title for t in titles):
        return 'High'
    if title and any(t in title or title in t for t in titles):
        return 'Medium'
    return 'Low'

def compliance_check(pybin, contact):
    if not pybin:
        return {'status': 'UNKNOWN', 'message': 'state_manager unavailable', 'contact': None}
    cmd = [pybin, str(STATE_MANAGER), 'check-contact']
    if contact.get('email'):
        cmd += ['--email', contact['email']]
    cmd += ['--name', contact.get('name') or 'Unknown']
    cmd += ['--company-name', contact.get('company') or 'Unknown']
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return {'status': 'UNKNOWN', 'message': (proc.stderr or proc.stdout).strip()[:500], 'contact': None}
    try:
        return json.loads(proc.stdout)
    except Exception:
        return {'status': 'UNKNOWN', 'message': proc.stdout[:500], 'contact': None}

if not ICP.exists():
    fail('Missing /tmp/apollo-segment/icp-config.json')

icp = load_json(ICP)
saved = load_json(SAVED)
disc = load_json(DISC)
all_contacts = []
all_contacts.extend(saved.get('contacts') or [])
all_contacts.extend(disc.get('prospects') or [])

seen = {}
excluded = {'dnc': 0, 'recently_contacted': 0, 'existing_pipeline': 0, 'special_handling': 0, 'non_omar_owned': 0, 'duplicates': 0}
for item in all_contacts:
    key = dedup_key(item)
    if key in seen:
        excluded['duplicates'] += 1
        seen[key] = merge_contact(seen[key], item)
    else:
        item = dict(item)
        item['dedup_status'] = 'unique'
        seen[key] = item

pybin = pick_python()
qualified = []
for item in seen.values():
    company = normalize(item.get('company'))
    if any(token in company for token in SPECIAL_HANDLING):
        excluded['special_handling'] += 1
        continue
    owner = item.get('owner_id')
    if owner not in (None, '', 'omar', 'Omar') and item.get('source') in ('apollo_saved', 'both'):
        excluded['non_omar_owned'] += 1
        continue
    compliance = compliance_check(pybin, item)
    status = normalize(compliance.get('status'))
    if status == 'do_not_contact':
        excluded['dnc'] += 1
        continue
    flags = []
    if status == 'caution':
        flags.append('compliance_caution')
    if status == 'unknown':
        flags.append('compliance_unverified')
    item['persona_lane'] = persona_lane(item.get('title'))
    item['motion_type'] = motion_type(item.get('company'))
    item['fit_score'] = fit_score(item, icp)
    item['needs_enrichment'] = not bool(item.get('email')) or not bool(item.get('phone'))
    item['needs_create_in_apollo'] = item.get('source') in ('apollo_discovery', ['apollo_discovery']) and not bool(item.get('apollo_contact_id'))
    item['flags'] = flags
    item['relevance_notes'] = item.get('relevance_notes') or item.get('title')
    qualified.append({
        'name': item.get('name'),
        'email': item.get('email'),
        'title': item.get('title'),
        'company': item.get('company'),
        'company_domain': item.get('company_domain'),
        'phone': item.get('phone'),
        'source': item.get('source'),
        'apollo_contact_id': item.get('apollo_contact_id'),
        'apollo_person_id': item.get('apollo_person_id'),
        'organization_id': item.get('organization_id'),
        'current_stage_id': item.get('current_stage_id'),
        'persona_lane': item.get('persona_lane'),
        'motion_type': item.get('motion_type'),
        'dedup_status': item.get('dedup_status'),
        'fit_score': item.get('fit_score'),
        'needs_enrichment': item.get('needs_enrichment'),
        'needs_create_in_apollo': item.get('needs_create_in_apollo'),
        'flags': item.get('flags'),
        'relevance_notes': item.get('relevance_notes'),
    })

result = {
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'segment_name': icp.get('segment_name'),
    'total_qualified': len(qualified),
    'excluded': excluded,
    'contacts': qualified,
}
OUT.write_text(json.dumps(result, indent=2) + '\n')
print(f'FILES_CREATED: {OUT}')
print(json.dumps({'total_qualified': len(qualified), 'excluded': excluded, 'state_manager_python': pybin}))
if not qualified:
    fail(f'No qualified contacts after merge: {json.dumps(excluded)}')
PY
