"""
ChadStart Python runtime worker.
Reads newline-delimited JSON requests from stdin, invokes the function, writes JSON result to stdout.
Protocol: {"id": N, "entry": "/path/to/fn.py", "event": {...}, "ctx": {...}}
Response: {"id": N, "result": ...} or {"id": N, "error": "message"}
"""
import sys, json, importlib.util, asyncio, os

def load_module(entry):
    spec = importlib.util.spec_from_file_location("fn", entry)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def run(mod, event, ctx):
    fn = getattr(mod, 'handler', None) or getattr(mod, 'default', None)
    if fn is None:
        raise RuntimeError("No handler or default export found")
    if asyncio.iscoroutinefunction(fn):
        return asyncio.run(fn(event, ctx))
    return fn(event, ctx)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        mod = load_module(req["entry"])
        result = run(mod, req.get("event", {}), req.get("ctx", {}))
        print(json.dumps({"id": req["id"], "result": result}), flush=True)
    except Exception as e:
        print(json.dumps({"id": req.get("id"), "error": str(e)}), flush=True)
