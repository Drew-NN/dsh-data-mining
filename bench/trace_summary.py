#!/usr/bin/env python3
"""Summarize a dsh session trace: tool call sequence + write/denial evidence.

Usage: python3 bench/trace_summary.py <session.jsonl.zstd>
"""
import json
import sys
import subprocess

zst = sys.argv[1]
raw = subprocess.run(['zstd', '-dc', zst], capture_output=True, text=True).stdout

calls = []
for line in raw.splitlines():
    try:
        ev = json.loads(line)
    except Exception:
        continue
    if ev.get('type') == 'tool/call':
        d = ev.get('data') or {}
        name = d.get('name') or '?'
        try:
            arg = json.loads(d.get('arguments') or '{}')
        except Exception:
            arg = {}
        calls.append((name, json.dumps(arg, ensure_ascii=False)[:160]))

print(f'--- {len(calls)} tool calls ---')
for name, arg in calls:
    print(f'{name:24s} {arg}')

print('\n--- write/denial evidence ---')
for line in raw.splitlines():
    if any(k in line for k in ['sandbox', 'denied', 'FS_SANDBOX', 'approval', 'chmod']):
        try:
            ev = json.loads(line)
            t = ev.get('type', '?')
            msg = str(ev)[:300]
            if any(k in msg for k in ['sandbox', 'denied', 'approval', 'escalat', 'chmod', 'read-only']):
                print(f'[{t}] {msg}')
        except Exception:
            pass
