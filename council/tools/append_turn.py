"""Append a member's turn to conversation.md and print its parsed header.

usage: append_turn.py <transcript.jsonl> <conversation.md> <n> <role>
"""
import re, sys
from agent_report import final_report

body = final_report(sys.argv[1])
n, role = sys.argv[3], sys.argv[4]
h = {k: (re.search(rf"^{k}:\s*(.+)$", body, re.M) or [None, "?"])[1].strip()
     for k in ["REPLY_TO", "ADDRESSES", "STANCE"]}
open(sys.argv[2], "a").write(f"\n## T{n} — {role}\n{body}\n")
print(f"T{n} {role} | REPLY_TO={h['REPLY_TO']} ADDRESSES={h['ADDRESSES']} "
      f"STANCE={h['STANCE']} | words={len(body.split())}")
