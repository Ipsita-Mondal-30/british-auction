"""
Parity check: sends the same requests to the Node API and the Python API and reports any
difference in status code or JSON (key order included). Point both at the same, freshly seeded
database. It creates test RFQs and bids there, so reseed afterwards.

    .venv/bin/python scripts/compare_backends.py --node http://localhost:4000/api --python http://localhost:4001/api
"""

import argparse
import datetime as dt
import json
import sys
import urllib.request

NO_BODY = object()


def call(base, method, path, uid=None, body=NO_BODY, headers=None, raw=None):
    h = dict(headers or {})
    if uid is not None:
        h['x-user-id'] = str(uid)
    data = raw
    if body is not NO_BODY:
        h['content-type'] = 'application/json'
        data = json.dumps(body).encode()
    req = urllib.request.Request(base + path, method=method, data=data, headers=h)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def first_diff(a, b, path='$'):
    """Path and values of the first difference; dict key order counts."""
    if type(a) is not type(b):
        return f'{path}: {a!r} != {b!r}'
    if isinstance(a, dict):
        if list(a) != list(b):
            return f'{path}: keys {list(a)} != {list(b)}'
        for k in a:
            if d := first_diff(a[k], b[k], f'{path}.{k}'):
                return d
    elif isinstance(a, list):
        if len(a) != len(b):
            return f'{path}: length {len(a)} != {len(b)}'
        for i, (x, y) in enumerate(zip(a, b)):
            if d := first_diff(x, y, f'{path}[{i}]'):
                return d
    elif a != b:
        return f'{path}: {a!r} != {b!r}'
    return None


def without_server_now(x):
    if isinstance(x, dict):
        return {k: without_server_now(v) for k, v in x.items() if k != 'serverNow'}
    if isinstance(x, list):
        return [without_server_now(v) for v in x]
    return x


class Report:
    def __init__(self):
        self.total = self.same = 0

    def check(self, label, a, b):
        self.total += 1
        d = f'status {a[0]} != {b[0]}' if a[0] != b[0] else first_diff(without_server_now(a[1]), without_server_now(b[1]))
        if d:
            print(f'  DIFF {label}: {d}')
        else:
            self.same += 1


# --- 1. reads --------------------------------------------------------------------------------

def reads(node, py, report):
    users = [u['id'] for u in call(node, 'GET', '/users')[1]]
    rfqs = [r['id'] for r in call(node, 'GET', '/rfqs', 1)[1]['rfqs']]
    cases = [('/users', None)] + [('/rfqs', u) for u in users] + [(f'/rfqs/{r}', u) for r in rfqs for u in users]
    cases += [('/rfqs', h) for h in (None, '', 'abc', '99', '1.0', ' 2 ', '0x1', '-1', '1e0')]
    cases += [(f'/rfqs/{i}', 1) for i in ('abc', '0', '-1', '999', '1.0', '2e0', '%203')]
    for path, uid in cases:
        report.check(f'GET {path} as {uid!r}', call(node, 'GET', path, uid), call(py, 'GET', path, uid))


# --- 2. rejected writes ----------------------------------------------------------------------

def rejected_writes(node, py, report, open_rfq, closed_rfq, upcoming_rfq):
    now = dt.datetime.now(dt.timezone.utc)
    iso = lambda m: (now + dt.timedelta(minutes=m)).isoformat()
    day = lambda d: (now + dt.timedelta(days=d)).date().isoformat()
    rfq = dict(refId='PARITY-NEVER-SAVED', name='Probe', bidStartAt=iso(10), bidCloseAt=iso(60), forcedCloseAt=iso(90),
               pickupDate=day(3), triggerWindowMin=10, extensionMin=5, triggerType='BID_RECEIVED')
    bid = dict(carrierName='Probe', freightCharges=100, originCharges=10, destinationCharges=10, transitTimeDays=3, quoteValidUntil=day(10))
    without = lambda d, k: {x: v for x, v in d.items() if x != k}

    rfq_bodies = [without(rfq, k) for k in rfq] + [
        {}, [], NO_BODY, {**rfq, 'refId': '  '}, {**rfq, 'refId': 'x' * 51}, {**rfq, 'name': 'n' * 201}, {**rfq, 'refId': 5},
        {**rfq, 'name': None}, {**rfq, 'bidStartAt': 'not a date'}, {**rfq, 'bidCloseAt': ''}, {**rfq, 'triggerWindowMin': 0},
        {**rfq, 'triggerWindowMin': 2.5}, {**rfq, 'triggerWindowMin': '10'}, {**rfq, 'triggerWindowMin': 1441},
        {**rfq, 'extensionMin': True}, {**rfq, 'triggerType': 'NOPE'}, {**rfq, 'bidCloseAt': iso(5)},
        {**rfq, 'forcedCloseAt': iso(30)}, {**rfq, 'forcedCloseAt': iso(60)}, {**rfq, 'pickupDate': day(-2)},
        {**rfq, 'bidStartAt': iso(-60), 'bidCloseAt': iso(-30), 'forcedCloseAt': iso(-10)},
        {**rfq, 'refId': '', 'triggerWindowMin': 0, 'triggerType': 'NOPE'}, {**rfq, 'name': '', 'forcedCloseAt': iso(30)},
        {**rfq, 'triggerWindowMin': 2.5, 'forcedCloseAt': iso(30)}, {**rfq, 'triggerWindowMin': 0, 'forcedCloseAt': iso(30)},
        {**rfq, 'bidStartAt': 1800000000000},
    ]
    for i, body in enumerate(rfq_bodies):
        report.check(f'POST /rfqs case {i}', call(node, 'POST', '/rfqs', 1, body), call(py, 'POST', '/rfqs', 1, body))

    bid_bodies = [without(bid, k) for k in bid] + [
        {}, [], NO_BODY, {**bid, 'carrierName': ' '}, {**bid, 'carrierName': 'c' * 101}, {**bid, 'freightCharges': -1},
        {**bid, 'freightCharges': 1e9 + 1}, {**bid, 'freightCharges': '100'}, {**bid, 'originCharges': None},
        {**bid, 'destinationCharges': False}, {**bid, 'transitTimeDays': 0}, {**bid, 'transitTimeDays': 1.5},
        {**bid, 'transitTimeDays': 366}, {**bid, 'quoteValidUntil': 'soon'}, {**bid, 'quoteValidUntil': day(-3)},
        {**bid, 'freightCharges': 0, 'originCharges': 0, 'destinationCharges': 0},
        {**bid, 'carrierName': '', 'freightCharges': -5, 'transitTimeDays': 0},
    ]
    for i, body in enumerate(bid_bodies):
        path = f'/rfqs/{open_rfq}/bids'
        report.check(f'POST {path} case {i}', call(node, 'POST', path, 3, body), call(py, 'POST', path, 3, body))

    others = [
        ('supplier creates RFQ', '/rfqs', 3, {}), ('buyer bids', f'/rfqs/{open_rfq}/bids', 1, {}), ('bad id', '/rfqs/abc/bids', 3, {}),
        ('missing RFQ', '/rfqs/999999/bids', 3, bid), ('closed RFQ', f'/rfqs/{closed_rfq}/bids', 3, bid),
        ('upcoming RFQ', f'/rfqs/{upcoming_rfq}/bids', 3, bid), ('no user', '/rfqs', None, rfq),
    ]
    for label, path, uid, body in others:
        report.check(label, call(node, 'POST', path, uid, body), call(py, 'POST', path, uid, body))
    for label, raw, headers in [('broken JSON', b'{"a":', {'content-type': 'application/json'}),
                                ('NaN in JSON', b'{"x": NaN}', {'content-type': 'application/json', 'x-user-id': '1'}),
                                ('text/plain body', b'{}', {'content-type': 'text/plain', 'x-user-id': '1'})]:
        report.check(label, call(node, 'POST', '/rfqs', raw=raw, headers=headers), call(py, 'POST', '/rfqs', raw=raw, headers=headers))


# --- 3. scripted auctions --------------------------------------------------------------------

SCENARIOS = [
    # label, trigger, close in (min), forced close in (min), bids (supplier id, freight)
    ('bid', 'BID_RECEIVED', 3, 30, [(2, 1000), (3, 1200), (2, 1100), (2, 900.5)]),
    ('rank', 'ANY_RANK_CHANGE', 3, 30, [(2, 1000), (3, 1100), (4, 1300), (4, 1050), (3, 950)]),
    ('l1', 'L1_CHANGE', 3, 30, [(2, 1000), (3, 1200), (4, 1100), (3, 1150), (4, 999.99)]),
    ('cap', 'BID_RECEIVED', 3, 6, [(2, 1000), (3, 900), (4, 800)]),
    ('quiet', 'BID_RECEIVED', 40, 60, [(2, 1000), (3, 900)]),
]


def relative(ts, origin):
    """A timestamp as minutes after the RFQ's original close, since clock times differ between runs."""
    if ts is None:
        return None
    parse = lambda s: dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
    return round((parse(ts) - parse(origin)).total_seconds() / 60, 2)


def normalize(d, origin):
    """Drops ids, reference IDs and clock times; keeps everything else."""
    drop = {'id', 'refId', 'rfqId', 'bidId', 'buyerId', 'createdAt', 'bidStartAt', 'bidCloseAt', 'pickupDate', 'quoteValidUntil'}
    if isinstance(d, list):
        return [normalize(x, origin) for x in d]
    if not isinstance(d, dict):
        return d
    out = {}
    for k, v in d.items():
        if k in drop:
            continue
        out[k] = relative(v, origin) if k in ('currentCloseAt', 'forcedCloseAt', 'oldCloseAt', 'newCloseAt') else normalize(v, origin)
    return out


def run_auction(base, label, trigger, close_min, forced_min, bids, tag):
    now = dt.datetime.now(dt.timezone.utc)
    iso = lambda m: (now + dt.timedelta(minutes=m)).isoformat()
    status, rfq = call(base, 'POST', '/rfqs', 1, dict(
        refId=f'PARITY-{label}-{tag}', name=f'Parity {trigger}', bidStartAt=iso(-1), bidCloseAt=iso(close_min),
        forcedCloseAt=iso(forced_min), pickupDate=(now + dt.timedelta(days=2)).date().isoformat(),
        triggerWindowMin=10, extensionMin=5, triggerType=trigger))
    origin = rfq['bidCloseAt']
    out = {'create': (status, normalize(rfq, origin)), 'bids': []}
    for uid, freight in bids:
        status, r = call(base, 'POST', f'/rfqs/{rfq["id"]}/bids', uid, dict(
            carrierName=f'C{uid}', freightCharges=freight, originCharges=12.5, destinationCharges=7.25,
            transitTimeDays=uid, quoteValidUntil=(now + dt.timedelta(days=9)).date().isoformat()))
        out['bids'].append((status, normalize(without_server_now(r), origin)))
    for uid in (1, 3):
        out[f'details as user {uid}'] = normalize(without_server_now(call(base, 'GET', f'/rfqs/{rfq["id"]}', uid)[1]), origin)
    return out


def auctions(node, py, report):
    tag = dt.datetime.now().strftime('%H%M%S')
    for label, trigger, close, forced, bids in SCENARIOS:
        a = run_auction(node, f'{label}-node', trigger, close, forced, bids, tag)
        b = run_auction(py, f'{label}-py', trigger, close, forced, bids, tag)
        report.check(f'auction "{label}" ({trigger})', (200, a), (200, b))


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    p.add_argument('--node', default='http://localhost:4000/api')
    p.add_argument('--python', default='http://localhost:4001/api')
    args = p.parse_args()

    listing = call(args.node, 'GET', '/rfqs', 1)[1]['rfqs']
    pick = lambda status: next(r['id'] for r in listing if r['status'] == status)
    sections = [
        ('reads', lambda r: reads(args.node, args.python, r)),
        ('rejected writes', lambda r: rejected_writes(args.node, args.python, r, pick('ACTIVE'), pick('CLOSED'), pick('UPCOMING'))),
        ('scripted auctions', lambda r: auctions(args.node, args.python, r)),
    ]
    failed = False
    for name, run in sections:
        print(f'{name}:')
        report = Report()
        run(report)
        print(f'  {report.same}/{report.total} identical')
        failed |= report.same != report.total
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
