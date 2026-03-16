# hello.py — ChadStart Python function
# Returns a greeting from the Python runtime.
#
# Runtime: python
# Trigger: GET /api/fn/greet/python (public)


def handler(event, ctx):
    name = (event.get("query") or {}).get("name", "World")
    return {
        "message": f"Hello, {name}!",
        "runtime": "python",
    }
