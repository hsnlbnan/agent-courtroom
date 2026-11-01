"""Extract a subagent's final report from its output transcript (JSONL).

usage: agent_report.py <transcript.jsonl> <out.md>
Writes the last SubagentHandback message (or, if none, the last assistant text).
"""
import json, sys

def final_report(path):
    last = None
    for line in open(path):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        m = o.get("message") or {}
        if o.get("type") != "assistant" or not isinstance(m.get("content"), list):
            continue
        for c in m["content"]:
            if c.get("type") == "tool_use" and c.get("name") == "SubagentHandback":
                last = (c.get("input") or {}).get("message", "").strip() or last
            elif c.get("type") == "text" and c.get("text", "").strip():
                last = c["text"].strip()
    return last or ""

if __name__ == "__main__":
    text = final_report(sys.argv[1])
    open(sys.argv[2], "w").write(text + "\n")
    print(sys.argv[2], len(text))
