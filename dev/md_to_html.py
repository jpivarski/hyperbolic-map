#!/usr/bin/env python3
"""Convert a slice of a Markdown file into simple, readable HTML.

This exists to make ONE conversion: the option tables and format reference that used to live in
README.md became `docs/index.html`. After that conversion the HTML is the main copy and is edited by
hand, so this script is not part of any build -- it is kept because "how was that page produced?" is a
fair question, and because the answer "by hand" would not have been true.

The output is deliberately plain: one block element per line, real newlines between sections, no
wrapper divs, no classes. It is meant to be read and edited in a text editor.

    python3 dev/md_to_html.py README.md out.html \\
        --title "hyperbolic-map" --from-heading "## Options" --to-heading "## Development"

`--from-heading` is inclusive and `--to-heading` exclusive, both matched as exact line prefixes.
Headings get GitHub-style slug ids so that in-page links such as `#atlas-of-tiles` keep working.

Needs `mistune` (v3), which is a local install and not a dependency of the library.
"""

import argparse
import html
import re
import sys

try:
    import mistune
except ImportError:  # pragma: no cover - the message is the point
    sys.exit("error: this script needs mistune (pip install --user mistune); it is dev tooling, "
             "not a dependency of the library")


def slugify(text):
    """GitHub's heading-anchor rule: strip tags, lowercase, drop punctuation, spaces to hyphens."""
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    return re.sub(r"\s+", "-", text.strip())


def slice_markdown(text, from_heading, to_heading):
    lines = text.split("\n")
    start = 0
    end = len(lines)
    if from_heading:
        for i, line in enumerate(lines):
            if line.startswith(from_heading):
                start = i
                break
        else:
            sys.exit(f"error: --from-heading {from_heading!r} not found")
    if to_heading:
        for i in range(start + 1, len(lines)):
            if lines[i].startswith(to_heading):
                end = i
                break
        else:
            sys.exit(f"error: --to-heading {to_heading!r} not found after the start")
    return "\n".join(lines[start:end]).strip() + "\n"


# Tags that CONTAIN other blocks: their children are indented one step and each gets its own line.
CONTAINERS = ("ul", "ol", "table", "thead", "tbody", "tr", "blockquote", "li")
# Tags whose contents are inline and are kept on ONE line with their open and close tags, however long
# the line gets. Splitting these is what would introduce whitespace where the markup did not have any.
LEAVES = ("h1", "h2", "h3", "h4", "h5", "h6", "p", "th", "td")
VOID = ("hr", "br", "img")


def prettify(markup):
    """One block element per line; block children indented two spaces; inline content never split.

    Everything inside a <pre> is passed through untouched -- its whitespace is content -- and an <li>
    that holds only inline text collapses back onto one line, which is the common case in this
    document and reads much better than three.
    """
    out = []
    depth = 0
    buf = None  # the leaf currently being accumulated, or None

    def emit(line):
        out.append("  " * depth + line)

    for chunk in re.split(r"(<pre[\s\S]*?</pre>)", markup):
        if chunk.startswith("<pre"):
            emit(chunk)
            continue
        for piece in re.split(r"(<[^>]+>)", chunk):
            if not piece.strip():
                continue
            m = re.match(r"</?([a-z0-9]+)", piece)
            tag = m.group(1) if m else None
            closing = piece.startswith("</")

            if buf is not None:
                buf += piece
                if closing and tag == buf_tag:
                    emit(buf)
                    buf = None
                continue

            if tag in LEAVES and not closing:
                buf, buf_tag = piece, tag
            elif tag in CONTAINERS and not closing:
                emit(piece)
                depth += 1
            elif tag in CONTAINERS and closing:
                depth -= 1
                # `<li>text</li>` with no nested block: fold the close back onto the open.
                if tag == "li" and out and not out[-1].lstrip().startswith("</"):
                    out[-1] += piece
                else:
                    emit(piece)
            elif tag in VOID:
                emit(piece)
            elif out:
                out[-1] += piece
            else:
                emit(piece)

    # `<li>` holding only inline text: mistune gives us the text as a bare run, which the branch above
    # appended to the `<li>` line, so nothing more is needed. Close any tag left open by malformed
    # input rather than dropping it silently.
    if buf is not None:
        out.append(buf)

    spaced = []
    for line in out:
        if re.match(r"\s*<h[1-3]", line) and spaced:
            spaced.append("")
        spaced.append(line)
    return "\n".join(spaced)


def unescape_quotes(markup):
    """`&quot;` outside a tag back to a plain `"`.

    Valid either way, but this file is meant to be read, and `"auto"` in a code span beats
    `&quot;auto&quot;`. Attribute values are inside tags and are left alone.
    """
    return re.sub(r"(<[^>]*>)|&quot;", lambda m: m.group(1) if m.group(1) else '"', markup)


def add_heading_ids(markup):
    def repl(m):
        level, attrs, text = m.group(1), m.group(2), m.group(3)
        if "id=" in attrs:
            return m.group(0)
        return f'<h{level} id="{slugify(text)}"{attrs}>{text}</h{level}>'

    return re.sub(r"<h([1-6])([^>]*)>(.*?)</h\1>", repl, markup, flags=re.S)


PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="stylesheet" href="{css}">
</head>
<body>

{body}

</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="Markdown file to read")
    ap.add_argument("destination", help="HTML file to write, or - for stdout")
    ap.add_argument("--title", default="", help="contents of <title>")
    ap.add_argument("--css", default="style.css", help="stylesheet to link")
    ap.add_argument("--from-heading", default="", help="first line to include, matched as a prefix")
    ap.add_argument("--to-heading", default="", help="first line to EXCLUDE, matched as a prefix")
    ap.add_argument("--fragment", action="store_true", help="emit the body only, with no page wrapper")
    args = ap.parse_args()

    with open(args.source, encoding="utf-8") as f:
        text = f.read()
    text = slice_markdown(text, args.from_heading, args.to_heading)

    convert = mistune.create_markdown(plugins=["table", "strikethrough"], escape=False)
    body = prettify(unescape_quotes(add_heading_ids(convert(text))))
    page = body + "\n" if args.fragment else PAGE.format(title=html.escape(args.title), css=args.css, body=body)

    if args.destination == "-":
        sys.stdout.write(page)
    else:
        with open(args.destination, "w", encoding="utf-8") as f:
            f.write(page)
        print(f"wrote {args.destination}: {len(page.splitlines())} lines from {args.source}")


if __name__ == "__main__":
    main()
