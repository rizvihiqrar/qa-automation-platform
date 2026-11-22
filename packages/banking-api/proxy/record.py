"""mitmproxy add-on for the banking-api wire tests (test-proxy/).

It does two things, and nothing else:

* records every request and reply that passes, one JSON line each, in /out/flows.jsonl
  (the tests read it back and check what was really on the wire);
* changes one field of a request body in flight, while /out/control.json holds a
  "tamper" entry, e.g. {"tamper": {"method": "POST", "path": "/transfers",
  "field": "amount", "value": "1000.00"}}. The tests write that file before a request
  and remove it after, so the same proxy serves every test.

Run by test-proxy/proxy.ts: mitmdump --mode reverse:http://host:port -s /addons/record.py
"""
import json
import os

CONTROL = "/out/control.json"
FLOWS = "/out/flows.jsonl"


def control() -> dict:
    try:
        with open(CONTROL, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


class Record:
    def request(self, flow):
        tamper = control().get("tamper")
        if not tamper:
            return
        request = flow.request
        if request.method != tamper["method"] or request.path != tamper["path"]:
            return
        try:
            body = json.loads(request.get_text())
        except ValueError:
            return
        if not isinstance(body, dict):
            return
        original = body.get(tamper["field"])
        body[tamper["field"]] = tamper["value"]
        request.set_text(json.dumps(body))
        flow.metadata["original"] = {tamper["field"]: original}

    def response(self, flow):
        request, response = flow.request, flow.response
        line = {
            "method": request.method,
            "path": request.path,  # everything after the host, query string included
            "request_headers": [[k, v] for k, v in request.headers.items(multi=True)],
            "request_body": request.get_text(strict=False),
            "status": response.status_code,
            "response_headers": [[k, v] for k, v in response.headers.items(multi=True)],
            "response_body": response.get_text(strict=False),
            "changed": flow.metadata.get("original"),
        }
        with open(FLOWS, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(line) + "\n")


addons = [Record()]
