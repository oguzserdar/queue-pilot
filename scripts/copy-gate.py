#!/usr/bin/env python3
"""Copy gate: fails (exit 1) when user-facing text breaks Queue Pilot's writing rules.

Checks banned words and phrases, semicolons, em dashes and more than one exclamation mark. It is the mechanical half
of the copy review; tone and clarity are reviewed by a person.

Usage: python3 scripts/copy-gate.py FILE [FILE...]   (.html: visible text only; .md: prose outside code)
"""
import html, re, sys

BANNED_WORDS = [
    "delve", "tapestry", "realm", "beacon", "harness", "illuminate", "facilitate", "bolster", "underscore",
    "landscape", "robust", "seamless", "seamlessly", "leverage", "comprehensive", "cutting-edge", "game-changer",
    "empower", "navigate", "embark", "look no further", "next level", "serves as", "stands as", "boasts",
    "testament", "pivotal", "cornerstone", "hallmark", "additionally", "furthermore", "moreover", "interplay",
    "foster", "showcasing", "highlighting", "symbolizing", "i hope this helps", "let me know", "as of",
    "experts argue", "studies show", "actually", "genuinely", "legitimately", "perhaps", "maybe",
    "the reality is", "that said", "in practice", "to be fair", "what nobody tells you", "plot twist",
    "load-bearing", "honest take", "belt and suspenders", "the unlock", "smoking gun",
    "meticulous", "vibrant", "thriving", "unpack", "deep dive", "dive into", "holistic", "actionable",
    "impactful", "synergy", "utilize", "commence", "endeavor", "elevate", "unleash", "supercharge",
    "streamline", "revolutionize", "transformative", "effortless", "magic", "magical",
    "ready to", "get started", "learn more", "in today's", "whether you're",
]
PATTERNS = [
    (r"—|--", "em dash"),
    (r";", "semicolon"),
    (r"\b(?:it|this)(?:'s| is) not (?:just )?[^.]{1,60}, (?:it|this)(?:'s| is)\b", "not X, it's Y"),
    (r"(?:^|\. )Not [^.]{1,40}\. [A-Z]", "Not X. Y."),
    (r"\bSame \w+, same \w+", "Same X, same Y"),
    (r"\b(?:here's|here is) (?:the|what)\b", "reader-steering frame"),
    (r":\s+(?:it|this|that)\b[^.]*\.", "possible colon reveal"),
    (r"\bfrom \w+ to \w+s\b", "possible false range"),
]
ALLOW = {"Happy Friday, friends!", "Excited to share this week's issue!"}  # example text shown being deleted


def visible_text(path):
    raw = open(path, encoding="utf-8").read()
    if path.endswith(".html"):
        raw = re.sub(r"<(script|style)\b.*?</\1>", " ", raw, flags=re.S | re.I)
        raw = re.sub(r"<[^>]+>", "\n", raw)
        return html.unescape(raw)
    raw = re.sub(r"```.*?```", " ", raw, flags=re.S)
    raw = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", raw)  # image syntax: keep the alt text, drop the "!"
    return re.sub(r"`[^`]*`", " ", raw)


def check(path):
    text = visible_text(path)
    for a in ALLOW:
        text = text.replace(a, " ")
    problems = []
    lines = [ln.strip() for ln in text.split("\n") if ln.strip() and not re.fullmatch(r"[|:\- ]+", ln.strip())]
    for ln in lines:
        low = ln.lower()
        for w in BANNED_WORDS:
            if re.search(r"(?<![a-z])" + re.escape(w) + r"(?![a-z])", low):
                problems.append(f"banned '{w}': {ln[:90]}")
        for pat, name in PATTERNS:
            if re.search(pat, ln):
                problems.append(f"{name}: {ln[:90]}")
    if text.count("!") > 1:
        problems.append(f"{text.count('!')} exclamation marks (max 1)")
    return problems


def main(paths):
    failed = 0
    for p in paths:
        probs = check(p)
        print(f"{'FAIL' if probs else 'PASS'}  {p}")
        for x in probs:
            print("   -", x)
        failed += bool(probs)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main(sys.argv[1:])
