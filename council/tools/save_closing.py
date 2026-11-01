"""Save a member's closing statement and validate its JSON vote block.

usage: save_closing.py <transcript.jsonl> <closing/<role>.md>
"""
import json, re, sys
from agent_report import final_report

text = final_report(sys.argv[1])
open(sys.argv[2], "w").write(text + "\n")
blocks = re.findall(r"```json\s*(\{.*?\})\s*```", text, re.S)
try:
    j = json.loads(blocks[-1])
    print(sys.argv[2], "OK", j["role"], j["vote"], j["confidence"])
except (IndexError, ValueError, KeyError) as e:
    print(sys.argv[2], "JSON FAIL", e)
    sys.exit(1)
