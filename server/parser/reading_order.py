"""Parse a page into screen-reader heading and control order.

Stdlib only, so the same source can run in Otari's code-execution sandbox.
Reads an HTML document or extracted Markdown from stdin and writes JSON to stdout.
"""

from __future__ import annotations

import base64
import json
import re
import sys
from html.parser import HTMLParser

HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
VOID_TAGS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}
SKIP_TAGS = {"script", "style", "noscript", "template"}
CONTROL_ROLES = {
    "button",
    "link",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "textbox",
    "combobox",
    "searchbox",
    "slider",
    "menuitem",
    "option",
}


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def looks_like_html(text: str) -> bool:
    return bool(
        re.search(
            r"<(?:html|body|main|header|footer|section|form|h[1-6]|a|button|input|select|textarea|p|div|img|label)\b",
            text,
            re.I,
        )
    )


class _Builder(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root: dict = {"tag": "#doc", "attrs": {}, "children": []}
        self.stack: list[dict] = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        node = {
            "tag": tag,
            "attrs": {key.lower(): "" if val is None else val for key, val in attrs},
            "children": [],
        }
        self.stack[-1]["children"].append(node)
        if tag not in VOID_TAGS:
            self.stack.append(node)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in VOID_TAGS:
            return
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index]["tag"] == tag:
                self.stack = self.stack[:index]
                return

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag.lower() not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_data(self, data: str) -> None:
        if data:
            self.stack[-1]["children"].append(data)


def _hidden(node: dict) -> bool:
    attrs = node["attrs"]
    if "hidden" in attrs:
        return True
    if attrs.get("aria-hidden", "").lower() == "true":
        return True
    if node["tag"] == "input" and attrs.get("type", "").lower() == "hidden":
        return True
    return False


def _visible_text(node: dict | str) -> str:
    if isinstance(node, str):
        return node
    if node["tag"] in SKIP_TAGS or _hidden(node):
        return ""
    if node["tag"] == "img":
        return node["attrs"].get("alt", "")
    return "".join(_visible_text(child) for child in node["children"])


def _index(node: dict, ids: dict[str, dict], labels: dict[str, dict]) -> None:
    if node["tag"] in SKIP_TAGS:
        return
    element_id = node["attrs"].get("id", "")
    if element_id and element_id not in ids:
        ids[element_id] = node
    if node["tag"] == "label":
        target = node["attrs"].get("for", "")
        if target and target not in labels:
            labels[target] = node
    for child in node["children"]:
        if isinstance(child, dict):
            _index(child, ids, labels)


def _is_control(node: dict) -> bool:
    tag = node["tag"]
    role = node["attrs"].get("role", "").split()[0].lower() if node["attrs"].get("role") else ""
    if tag == "a":
        return "href" in node["attrs"] or role in {"link", "button"}
    if tag == "input":
        return node["attrs"].get("type", "text").lower() != "hidden"
    if tag in {"button", "select", "textarea"}:
        return True
    return role in CONTROL_ROLES


def _role_for(node: dict) -> str:
    explicit = node["attrs"].get("role", "").split()[0].lower() if node["attrs"].get("role") else ""
    if explicit:
        return explicit
    tag = node["tag"]
    if tag == "a":
        return "link"
    if tag == "button":
        return "button"
    if tag == "select":
        return "combobox"
    if tag == "textarea":
        return "textbox"
    input_type = node["attrs"].get("type", "text").lower()
    if input_type in {"submit", "button", "reset", "image"}:
        return "button"
    if input_type in {"checkbox", "radio"}:
        return input_type
    return "textbox"


def _accessible_name(node: dict, ids: dict[str, dict], labels: dict[str, dict], ancestor_label: dict | None) -> str:
    aria = clean(node["attrs"].get("aria-label"))
    if aria:
        return aria
    labelled_by = node["attrs"].get("aria-labelledby", "")
    if labelled_by:
        parts = [_visible_text(ids[ref]) for ref in labelled_by.split() if ref in ids]
        name = clean(" ".join(parts))
        if name:
            return name
    element_id = node["attrs"].get("id", "")
    if element_id and element_id in labels:
        name = clean(_visible_text(labels[element_id]))
        if name:
            return name
    if ancestor_label is not None and ancestor_label is not node:
        name = clean(_visible_text(ancestor_label))
        if name:
            return name
    tag = node["tag"]
    if tag not in {"input", "select", "textarea"}:
        name = clean(_visible_text(node))
        if name:
            return name
    if tag == "input":
        input_type = node["attrs"].get("type", "text").lower()
        value = clean(node["attrs"].get("value"))
        if input_type in {"submit", "button", "reset"} and value:
            return value
        if input_type == "submit" and not value:
            # HTML default value for an unnamed submit input. Not used for <button>.
            return "Submit"
        if input_type == "reset" and not value:
            return "Reset"
        if input_type == "image":
            alt = clean(node["attrs"].get("alt"))
            if alt:
                return alt
    title = clean(node["attrs"].get("title"))
    if title:
        return title
    return ""


def _walk(
    node: dict,
    items: list[dict],
    state: dict,
    ids: dict[str, dict],
    labels: dict[str, dict],
    inside_control: bool,
    ancestor_label: dict | None,
) -> None:
    if node["tag"] in SKIP_TAGS or _hidden(node):
        return
    tag = node["tag"]
    if tag == "label" and ancestor_label is None:
        ancestor_label = node
    control = _is_control(node)
    if tag in HEADING_TAGS and not inside_control:
        state["headings"] += 1
        level = int(tag[1])
        text = clean(_visible_text(node))
        ref = f"h{state['headings']}"
        items.append({"ref": ref, "kind": "heading", "level": level, "text": text})
        last = state["last_level"]
        if last == 0 and level > 1:
            state["issues"].append(
                {
                    "ref": ref,
                    "kind": "skipped-heading",
                    "detail": f"The first heading is level {level}, so the levels above it are skipped.",
                }
            )
        elif last and level > last + 1:
            state["issues"].append(
                {
                    "ref": ref,
                    "kind": "skipped-heading",
                    "detail": f"Heading level jumps from {last} to {level}.",
                }
            )
        if not text:
            state["issues"].append(
                {"ref": ref, "kind": "missing-name", "detail": "Heading has no text."}
            )
        state["last_level"] = level
    elif control and not inside_control:
        state["controls"] += 1
        ref = f"c{state['controls']}"
        name = _accessible_name(node, ids, labels, ancestor_label)
        input_type = ""
        if tag == "input":
            input_type = node["attrs"].get("type", "text").lower() or "text"
        elif tag == "button":
            input_type = node["attrs"].get("type", "submit").lower() or "submit"
        item = {
            "ref": ref,
            "kind": "control",
            "tag": tag,
            "role": _role_for(node),
            "name": name,
            "disabled": "disabled" in node["attrs"],
        }
        if input_type:
            item["inputType"] = input_type
        placeholder = clean(node["attrs"].get("placeholder"))
        if placeholder:
            item["placeholder"] = placeholder
        items.append(item)
        if not name:
            state["issues"].append(
                {
                    "ref": ref,
                    "kind": "missing-name",
                    "detail": f"{tag} has no accessible name.",
                }
            )
        inside_control = True
    for child in node["children"]:
        if isinstance(child, dict):
            _walk(child, items, state, ids, labels, inside_control, ancestor_label)


def parse_html(text: str) -> dict:
    builder = _Builder()
    builder.feed(text)
    builder.close()
    ids: dict[str, dict] = {}
    labels: dict[str, dict] = {}
    _index(builder.root, ids, labels)
    title = ""
    for child in _descendants(builder.root):
        if child["tag"] == "title":
            title = clean(_visible_text(child))
            break
    items: list[dict] = []
    if title:
        items.append({"ref": "t", "kind": "title", "text": title})
    state = {"headings": 0, "controls": 0, "last_level": 0, "issues": []}
    _walk(builder.root, items, state, ids, labels, False, None)
    return {
        "sourceKind": "html",
        "title": title,
        "items": items,
        "issues": state["issues"],
    }


def _descendants(node: dict):
    for child in node["children"]:
        if isinstance(child, dict):
            yield child
            yield from _descendants(child)


def parse_markdown(text: str) -> dict:
    items: list[dict] = []
    issues: list[dict] = []
    headings = 0
    controls = 0
    last_level = 0
    for line in text.splitlines():
        heading = re.match(r"^(#{1,6})\s+(.*?)\s*$", line)
        if heading:
            headings += 1
            level = len(heading.group(1))
            label = clean(heading.group(2))
            ref = f"h{headings}"
            items.append({"ref": ref, "kind": "heading", "level": level, "text": label})
            if last_level == 0 and level > 1:
                issues.append(
                    {
                        "ref": ref,
                        "kind": "skipped-heading",
                        "detail": f"The first heading is level {level}, so the levels above it are skipped.",
                    }
                )
            elif last_level and level > last_level + 1:
                issues.append(
                    {
                        "ref": ref,
                        "kind": "skipped-heading",
                        "detail": f"Heading level jumps from {last_level} to {level}.",
                    }
                )
            if not label:
                issues.append({"ref": ref, "kind": "missing-name", "detail": "Heading has no text."})
            last_level = level
        for match in re.finditer(r"\[([^\]]*)\]\(([^)\s]+)\)", line):
            controls += 1
            name = clean(match.group(1))
            ref = f"c{controls}"
            items.append(
                {
                    "ref": ref,
                    "kind": "control",
                    "tag": "a",
                    "role": "link",
                    "name": name,
                    "disabled": False,
                }
            )
            if not name:
                issues.append({"ref": ref, "kind": "missing-name", "detail": "a has no accessible name."})
    return {"sourceKind": "markdown", "title": "", "items": items, "issues": issues}


def parse_document(text: str) -> dict:
    raw = text.lstrip("\ufeff")
    if looks_like_html(raw):
        return parse_html(raw)
    return parse_markdown(raw)


def main() -> None:
    raw = sys.stdin.read()
    json.dump(parse_document(raw), sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
