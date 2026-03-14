#!/usr/bin/env python3
"""
Claude Code PreToolUse Hook: Compositional Bash Command Approval

Adapted from https://gist.github.com/mrocklin/30099bcc5d02a6e7df373b4c259d95e9

PROBLEM
-------
Claude Code's static permission system uses prefix matching:
    "Bash(git diff:*)" matches "git diff --staged" but NOT "git -C /path diff"
    "Bash(timeout 30 pytest:*)" matches that exact timeout, not "timeout 20 pytest"

This leads to frequent permission prompts for safe command variations.

SOLUTION
--------
This hook auto-approves Bash commands that are safe combinations of:
    WRAPPERS (timeout, env vars, etc.) + CORE COMMANDS (git, pytest, node, etc.)

For non-Bash tools (Edit, Write, Grep, etc.), everything is auto-approved.

CHAINED COMMANDS
----------------
Commands with &&, ||, ;, | are split and ALL segments must be safe:
    "ls && pwd"           -> approved (both safe)
    "ls && rm -rf /"      -> rejected (rm not safe)
    "git diff | head"     -> approved (both safe)

Command substitution ($(...) and backticks) is always rejected.

CONFIGURATION
-------------
Registered in .claude/settings.local.json:

    "hooks": {
      "PreToolUse": [{
        "matcher": "Bash",
        "hooks": [{"type": "command", "command": "python3 $CLAUDE_PROJECT_DIR/.claude/hooks/approve-tools.py"}]
      }]
    }

DEBUG
-----
    echo '{"tool_name": "Bash", "tool_input": {"command": "timeout 30 pytest"}}' | python3 .claude/hooks/approve-tools.py
"""
import json
import re
import sys

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool_name = data.get("tool_name")
tool_input = data.get("tool_input", {})

# Auto-approve all non-Bash tools (Edit, Write, Read, Glob, Grep, WebFetch, WebSearch, etc.)
if tool_name != "Bash":
    result = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": f"non-Bash tool: {tool_name}",
        },
    }
    print(json.dumps(result))
    sys.exit(0)


def approve(reason):
    """Output approval JSON and exit."""
    result = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": reason,
        },
    }
    print(json.dumps(result))
    sys.exit(0)


cmd = tool_input.get("command", "")

# --- Reject dangerous constructs that are hard to parse safely ---
if re.search(r"\$\(|`", cmd):
    sys.exit(0)


def split_command_chain(cmd):
    """Split command into segments on &&, ||, ;, |.

    Note: We don't split on newlines if:
    - Quotes are present (multiline strings like python -c "...")
    - Backslash continuations are present (cmd \\\n  --flag)
    """
    # First, collapse backslash-newline continuations
    cmd = re.sub(r"\\\n\s*", " ", cmd)

    # Protect quoted strings from splitting (replace with placeholders)
    quoted_strings = []

    def save_quoted(m):
        quoted_strings.append(m.group(0))
        return f"__QUOTED_{len(quoted_strings)-1}__"

    cmd = re.sub(r'"[^"]*"', save_quoted, cmd)
    cmd = re.sub(r"'[^']*'", save_quoted, cmd)

    # Normalize redirections to prevent splitting on & in 2>&1
    cmd = re.sub(r"(\d*)>&(\d*)", r"__REDIR_\1_\2__", cmd)
    cmd = re.sub(r"&>", "__REDIR_AMPGT__", cmd)

    # Split on command separators: &&, ||, ;, |, & (background)
    if quoted_strings:
        segments = re.split(r"\s*(?:&&|\|\||;|\||&)\s*", cmd)
    else:
        segments = re.split(r"\s*(?:&&|\|\||;|\||&)\s*|\n", cmd)

    # Restore quoted strings and redirections
    def restore(s):
        s = re.sub(r"__REDIR_(\d*)_(\d*)__", r"\1>&\2", s)
        s = s.replace("__REDIR_AMPGT__", "&>")
        for i, qs in enumerate(quoted_strings):
            s = s.replace(f"__QUOTED_{i}__", qs)
        return s

    segments = [restore(s) for s in segments]
    return [s.strip() for s in segments if s.strip()]


# --- Safe wrappers that can prefix any safe command ---
WRAPPER_PATTERNS = [
    (r"^timeout\s+\d+\s+", "timeout"),
    (r"^nice\s+(-n\s*\d+\s+)?", "nice"),
    (r"^env\s+", "env"),
    (r'^([A-Z_][A-Z0-9_]*=(?:[^\s"]*|"[^"]*"|\'[^\']*\')\s+)+', "env vars"),
    # Virtual env paths
    (r"^(\.\./)*\.?venv/bin/", ".venv"),
    (r"^/[^\s]+/\.?venv/bin/", ".venv"),
    # do (loop body prefix)
    (r"^do\s+", "do"),
]

# --- Safe core command patterns ---
SAFE_COMMANDS = [
    # Git operations (with optional -C flag)
    (r"^git\s+(-C\s+\S+\s+)?(diff|log|status|show|branch|stash|bisect|worktree|fetch|remote|check-ignore|ls-files|ls-tree|rev-parse|rev-list|describe|tag|config|blame|shortlog|reflog|name-rev|cat-file|for-each-ref|count-objects|verify-pack|grep)\b",
     "git read op"),
    (r"^git\s+(-C\s+\S+\s+)?(add|checkout|commit|merge|rebase|cherry-pick|reset|apply|push|pull|rm|switch|restore|clean|init|clone|submodule|sparse-checkout)\b",
     "git write op"),
    # GitHub CLI
    (r"^gh\s+(pr|issue|run|repo|api|release)\b", "gh cli"),
    # Node / BokehJS build
    (r"^node\s+make\b", "node make"),
    (r"^node\b", "node"),
    (r"^npm\s+(install|run|test|build|ci|view)\b", "npm"),
    (r"^npx\b", "npx"),
    # Python
    (r"^python3?\b", "python"),
    (r"^pip\s+(install|show|list|freeze|uninstall)\b", "pip"),
    (r"^pytest\b", "pytest"),
    (r"^pre-commit\b", "pre-commit"),
    (r"^ruff\b", "ruff"),
    (r"^mypy\b", "mypy"),
    # Bokeh
    (r"^bokeh\b", "bokeh"),
    # Conda / mamba
    (r"^conda\b", "conda"),
    (r"^mamba\b", "mamba"),
    # Common read-only commands
    (r"^(ls|cat|head|tail|tac|wc|find|grep|rg|file|which|pwd|du|df|sort|uniq|cut|tr|awk|sed|xargs|lsof|stat|readlink|realpath|hostname|uname|whoami|id|uptime|top|ps|netstat|ss|nproc|free|env|printenv|type|command|hash)\b",
     "read-only"),
    # File operations
    (r"^(mkdir|cp|mv|rm|touch|chmod)\b", "file op"),
    # Network
    (r"^curl\b", "curl"),
    # Process management
    (r"^(pgrep|pkill|kill)\b", "process mgmt"),
    # Display / macOS
    (r"^(open|screencapture|osascript)\b", "display"),
    # Shell builtins and control flow
    (r"^(echo|printf)\b", "echo"),
    (r"^(true|false|exit(\s+\d+)?)$", "shell builtin"),
    (r"^cd\s", "cd"),
    (r"^(source|\.\s)", "source"),
    (r"^sleep\s", "sleep"),
    # Variable assignment (VAR=value)
    (r"^[A-Z_][A-Z0-9_]*=\S*$", "var assignment"),
    # Loops
    (r"^for\s+\w+\s+in\s", "for loop"),
    (r"^while\s", "while loop"),
    (r"^done$", "done"),
]


def strip_wrappers(cmd):
    """Strip safe wrapper prefixes, return (core_cmd, list_of_wrappers)."""
    wrappers = []
    changed = True
    while changed:
        changed = False
        for pattern, name in WRAPPER_PATTERNS:
            m = re.match(pattern, cmd)
            if m:
                wrappers.append(name)
                cmd = cmd[m.end():]
                changed = True
                break
    return cmd.strip(), wrappers


def check_safe(cmd):
    """Check if command matches a safe pattern. Returns reason or None."""
    for pattern, reason in SAFE_COMMANDS:
        if re.match(pattern, cmd):
            return reason
    return None


# --- Main Bash logic ---
segments = split_command_chain(cmd)

reasons = []
for segment in segments:
    core_cmd, wrappers = strip_wrappers(segment)
    reason = check_safe(core_cmd)
    if not reason:
        sys.exit(0)  # One unsafe segment = reject entire command
    if wrappers:
        reasons.append(f"{'+'.join(wrappers)} + {reason}")
    else:
        reasons.append(reason)

approve(" | ".join(reasons))
