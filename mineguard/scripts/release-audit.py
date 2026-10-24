"""Read-only source/package audit. Never prints matched credential contents."""

import argparse
import json
import re
import subprocess
from pathlib import Path


def audit(root: Path) -> dict:
    root = root.resolve()
    names = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root
    ).decode().split("\0")
    patterns = {
        "private-key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
        "github-token": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"),
        "aws-access-key": re.compile(r"\bAKIA[A-Z0-9]{16}\b"),
        "slack-token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    }
    findings, large, encoding, skipped = [], [], [], []
    total = scanned = 0
    for name in sorted(set(filter(None, names))):
        path = root / name
        if path.is_symlink():
            skipped.append({"file": name, "reason": "symlink"})
            continue
        if not path.is_file():
            continue
        size = path.stat().st_size
        total += size
        if size > 10 * 1024 * 1024:
            large.append({"file": name, "bytes": size})
        if path.name == ".env" or path.suffix.lower() in {".key", ".p12", ".pfx"}:
            findings.append({"file": name, "category": "sensitive-filename"})
        if size > 2 * 1024 * 1024:
            skipped.append({"file": name, "reason": "over-2MiB-content-scan"})
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeError:
            skipped.append({"file": name, "reason": "binary-or-non-UTF8"})
            continue
        scanned += 1
        for number, line in enumerate(content.splitlines(), 1):
            for category, pattern in patterns.items():
                if pattern.search(line):
                    findings.append({"file": name, "line": number, "category": category})
            if name.startswith("mineguard/") and any(s in line for s in ("\u00c2\u00b7", "m\u00c2\u00b3/s", "\ufffd")):
                encoding.append({"file": name, "line": number})
    for finding in findings:
        baseline = subprocess.run(
            ["git", "show", "HEAD:" + finding["file"]], cwd=root, capture_output=True
        )
        finding["identical_to_local_HEAD"] = (
            baseline.returncode == 0 and baseline.stdout == (root / finding["file"]).read_bytes()
        )
    return {
        "scope": "Git tracked and nonignored working-tree files; excludes ignored runtime secrets/caches",
        "limitation": "Heuristic known-token scan, not a guarantee of no secrets; Git history not scanned",
        "source_bytes": total,
        "text_files_scanned": scanned,
        "credential_findings": findings,
        "encoding_findings": encoding,
        "files_over_10MiB": large,
        "content_scan_skipped": skipped,
        "required_artifacts": {p: (root / p).is_file() for p in ("README.md", "SUBMISSION.md", "presentation.pdf", "LICENSE", "NOTICE", "mineguard/THIRD_PARTY.md")},
        "local_branch": subprocess.check_output(["git", "branch", "--show-current"], cwd=root, text=True).strip(),
        "local_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
        "working_tree_entries": len(subprocess.check_output(["git", "status", "--porcelain"], cwd=root, text=True).splitlines()),
        "remote_submission_verified": False,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    result = audit(args.root)
    print(json.dumps(result, indent=2))
    raise SystemExit(bool(result["credential_findings"] or result["encoding_findings"]))
