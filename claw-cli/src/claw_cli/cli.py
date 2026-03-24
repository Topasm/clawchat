"""Main CLI entry point — argparse-based command routing."""

from __future__ import annotations

import argparse
import getpass
import sys
import time

from claw_cli import __version__
from claw_cli import config
from claw_cli import client
from claw_cli import output
from claw_cli.errors import ClawError, EXIT_OK, EXIT_INPUT_ERROR


# ── Auth commands ────────────────────────────────────────────────────

def cmd_auth_login(args: argparse.Namespace) -> int:
    server = args.server
    if not server:
        output.print_error("--server is required")
        return EXIT_INPUT_ERROR

    pin = args.pin or getpass.getpass("PIN: ")
    if not pin:
        output.print_error("PIN is required")
        return EXIT_INPUT_ERROR

    data = client.login(server, pin)
    output.print_success(f"Logged in to {server} (token expires in {data['expires_in']}s)")
    return EXIT_OK


def cmd_auth_status(args: argparse.Namespace) -> int:
    cfg = config.load()
    server = cfg.get("server_url")
    if not server:
        output.print_error("Not logged in")
        return EXIT_OK

    token = cfg.get("access_token")
    expires_at = cfg.get("token_expires_at", 0)
    remaining = max(0, int(expires_at - time.time()))
    expired = "expired" if remaining == 0 else f"expires in {remaining}s"

    output.console.print(f"Server:  {server}")
    output.console.print(f"Token:   {'present' if token else 'missing'} ({expired})")
    return EXIT_OK


def cmd_auth_logout(args: argparse.Namespace) -> int:
    client.logout()
    output.print_success("Logged out")
    return EXIT_OK


# ── Todo commands ────────────────────────────────────────────────────

def cmd_add(args: argparse.Namespace) -> int:
    body: dict = {"title": args.title}

    if args.description:
        body["description"] = args.description
    if args.priority:
        body["priority"] = args.priority
    if args.due:
        body["due_date"] = args.due
    if args.tag:
        body["tags"] = args.tag
    if args.estimate:
        body["estimated_minutes"] = args.estimate
    if args.project:
        body["source"] = "obsidian_project"
        body["source_id"] = args.project
    if args.capture:
        body["inbox_state"] = "classifying"

    todo = client.todo_create(body)
    output.print_success(f"Created: {todo['id'][:8]}  {todo['title']}")
    if args.capture:
        output.console.print("[dim]Inbox pipeline will classify this item.[/]")
    return EXIT_OK


def cmd_list(args: argparse.Namespace) -> int:
    params = {
        "status": args.status,
        "priority": args.priority,
        "due_before": args.due_before,
        "root_only": args.root_only or None,
        "limit": args.limit,
        "page": args.page,
    }
    data = client.todo_list(**params)
    output.print_todo_list(data, as_json=args.json, plain=args.plain)
    return EXIT_OK


def cmd_today(args: argparse.Namespace) -> int:
    data = client.today()
    output.print_today(data, as_json=args.json)
    return EXIT_OK


def cmd_show(args: argparse.Namespace) -> int:
    todo = client.todo_get(args.todo_id)
    output.print_todo_detail(todo, as_json=args.json)
    return EXIT_OK


def cmd_done(args: argparse.Namespace) -> int:
    todo = client.todo_update(args.todo_id, {"status": "completed"})
    output.print_success(f"Completed: {todo['title']}")
    return EXIT_OK


# ── Inbox commands ───────────────────────────────────────────────────

def cmd_inbox(args: argparse.Namespace) -> int:
    data = client.today()
    inbox_count = data.get("inbox_count", 0)
    needs_review = data.get("needs_review", [])

    if args.json:
        output.print_json({"inbox_count": inbox_count, "needs_review": needs_review})
        return EXIT_OK

    output.console.print(f"[bold]Inbox[/]  {inbox_count} unscheduled\n")
    if needs_review:
        output.console.print("[magenta]Needs review:[/]")
        for t in needs_review:
            output.console.print(f"  {output.print_todo_row(t)}")
    else:
        output.console.print("[dim]No items need review right now.[/]")
    return EXIT_OK


def cmd_inbox_organize(args: argparse.Namespace) -> int:
    result = client.organize(args.todo_id)
    output.print_success(f"Organizing {args.todo_id[:8]}… ({result.get('status', 'processing')})")
    return EXIT_OK


def cmd_inbox_answer(args: argparse.Namespace) -> int:
    answers: dict[str, str] = {}
    for pair in args.answer:
        if "=" not in pair:
            output.print_error(f"Invalid answer format: {pair!r} (expected index=text)")
            return EXIT_INPUT_ERROR
        idx, text = pair.split("=", 1)
        answers[idx.strip()] = text.strip()

    result = client.answer_questions(args.todo_id, answers)
    output.print_success(f"Answers submitted ({result.get('status', 'processing')})")
    return EXIT_OK


def cmd_inbox_skip(args: argparse.Namespace) -> int:
    result = client.skip_questions(args.todo_id)
    output.print_success(f"Questions skipped ({result.get('status', 'processing')})")
    return EXIT_OK


# ── Plan commands ────────────────────────────────────────────────────

def cmd_plan_router(args: argparse.Namespace) -> int:
    """Route plan subcommands: `claw plan <id>`, `claw plan apply <id>`, etc."""
    action = args.action_or_id
    if action == "apply":
        if not args.todo_id:
            output.print_error("Usage: claw plan apply <todo_id>")
            return EXIT_INPUT_ERROR
        return _plan_apply(args.todo_id)
    if action == "dismiss":
        if not args.todo_id:
            output.print_error("Usage: claw plan dismiss <todo_id>")
            return EXIT_INPUT_ERROR
        return _plan_dismiss(args.todo_id)
    # Default: action_or_id is the todo_id — generate plan
    return _plan_generate(action, as_json=args.json)


def _plan_generate(todo_id: str, *, as_json: bool = False) -> int:
    output.console.print(f"[dim]Generating plan for {todo_id[:8]}…[/]")
    client.delegate(todo_id, "plan")

    import time as _time
    for _ in range(30):
        _time.sleep(2)
        try:
            plan = client.plan_latest(todo_id)
            output.print_plan(plan, as_json=as_json)
            return EXIT_OK
        except Exception:
            continue

    output.console.print("[yellow]Plan is still generating. Check back with:[/]")
    output.console.print(f"  claw show {todo_id}")
    return EXIT_OK


def _plan_apply(todo_id: str) -> int:
    result = client.plan_apply(todo_id)
    count = len(result.get("created_subtask_ids", []))
    output.print_success(f"Plan applied: {count} subtasks created")
    if result.get("project_folder_created"):
        output.console.print(f"[dim]Project folder: {result['project_folder_created']}[/]")
    return EXIT_OK


def _plan_dismiss(todo_id: str) -> int:
    client.plan_dismiss(todo_id)
    output.print_success("Plan dismissed")
    return EXIT_OK


# ── Delegate / Skills ───────────────────────────────────────────────

def cmd_delegate(args: argparse.Namespace) -> int:
    result = client.delegate(args.todo_id, args.skill)
    output.print_success(
        f"Delegated to {result.get('skill_id', args.skill)} "
        f"(task {result.get('task_id', '')[:8]})"
    )
    return EXIT_OK


def cmd_skills(args: argparse.Namespace) -> int:
    data = client.skills_list()
    output.print_skills(data, as_json=args.json)
    return EXIT_OK


# ── Parser construction ─────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="claw",
        description="ClawChat CLI — task management and agent operations",
    )
    parser.add_argument("--version", action="version", version=f"claw {__version__}")
    sub = parser.add_subparsers(dest="command")

    # ── auth ──
    auth_p = sub.add_parser("auth", help="Authentication")
    auth_sub = auth_p.add_subparsers(dest="auth_command")

    login_p = auth_sub.add_parser("login", help="Log in to a ClawChat server")
    login_p.add_argument("--server", required=True, help="Server URL (e.g. http://localhost:8000)")
    login_p.add_argument("--pin", help="PIN (prompted if omitted)")
    login_p.set_defaults(func=cmd_auth_login)

    status_p = auth_sub.add_parser("status", help="Show auth status")
    status_p.set_defaults(func=cmd_auth_status)

    logout_p = auth_sub.add_parser("logout", help="Log out")
    logout_p.set_defaults(func=cmd_auth_logout)

    # ── add ──
    add_p = sub.add_parser("add", help="Create a new todo")
    add_p.add_argument("title", help="Todo title")
    add_p.add_argument("--description", "-d", help="Description")
    add_p.add_argument("--priority", "-p", choices=["low", "medium", "high", "urgent"])
    add_p.add_argument("--due", help="Due date (YYYY-MM-DD or ISO8601)")
    add_p.add_argument("--project", help="Project folder name")
    add_p.add_argument("--tag", "-t", action="append", help="Tag (repeatable)")
    add_p.add_argument("--estimate", type=int, help="Time estimate in minutes")
    add_p.add_argument("--capture", action="store_true", help="Send to inbox pipeline for classification")
    add_p.set_defaults(func=cmd_add)

    # ── list ──
    list_p = sub.add_parser("list", help="List todos")
    list_p.add_argument("--status", "-s", help="Filter by status")
    list_p.add_argument("--priority", help="Filter by priority")
    list_p.add_argument("--due-before", help="Due before date (ISO8601)")
    list_p.add_argument("--root-only", action="store_true", help="Only root todos")
    list_p.add_argument("--limit", "-l", type=int, default=20)
    list_p.add_argument("--page", type=int, default=1)
    list_p.add_argument("--json", action="store_true", help="JSON output")
    list_p.add_argument("--plain", action="store_true", help="Plain text output (no colors)")
    list_p.set_defaults(func=cmd_list)

    # ── today ──
    today_p = sub.add_parser("today", help="Today's dashboard")
    today_p.add_argument("--json", action="store_true")
    today_p.set_defaults(func=cmd_today)

    # ── show ──
    show_p = sub.add_parser("show", help="Show todo detail")
    show_p.add_argument("todo_id", help="Todo ID")
    show_p.add_argument("--json", action="store_true")
    show_p.set_defaults(func=cmd_show)

    # ── done ──
    done_p = sub.add_parser("done", help="Mark todo as completed")
    done_p.add_argument("todo_id", help="Todo ID")
    done_p.set_defaults(func=cmd_done)

    # ── inbox ──
    inbox_p = sub.add_parser("inbox", help="Inbox summary and operations")
    inbox_p.add_argument("--json", action="store_true")
    inbox_sub = inbox_p.add_subparsers(dest="inbox_command")

    org_p = inbox_sub.add_parser("organize", help="Trigger inbox organization")
    org_p.add_argument("todo_id", help="Todo ID")
    org_p.set_defaults(func=cmd_inbox_organize)

    ans_p = inbox_sub.add_parser("answer", help="Answer clarification questions")
    ans_p.add_argument("todo_id", help="Todo ID")
    ans_p.add_argument("--answer", "-a", action="append", required=True,
                        help="Answer as index=text (repeatable)")
    ans_p.set_defaults(func=cmd_inbox_answer)

    skip_p = inbox_sub.add_parser("skip", help="Skip clarification questions")
    skip_p.add_argument("todo_id", help="Todo ID")
    skip_p.set_defaults(func=cmd_inbox_skip)

    inbox_p.set_defaults(func=cmd_inbox)

    # ── plan ──
    # Uses manual routing: `claw plan <id>` or `claw plan apply|dismiss <id>`
    plan_p = sub.add_parser("plan", help="Generate or manage plans")
    plan_p.add_argument("action_or_id", help="Todo ID, or 'apply'/'dismiss'")
    plan_p.add_argument("todo_id", nargs="?", help="Todo ID (when action is apply/dismiss)")
    plan_p.add_argument("--json", action="store_true")
    plan_p.set_defaults(func=cmd_plan_router)

    # ── delegate ──
    deleg_p = sub.add_parser("delegate", help="Delegate todo to a skill")
    deleg_p.add_argument("todo_id", help="Todo ID")
    deleg_p.add_argument("--skill", required=True, help="Skill ID")
    deleg_p.set_defaults(func=cmd_delegate)

    # ── skills ──
    skills_p = sub.add_parser("skills", help="List available skills")
    skills_p.add_argument("--json", action="store_true")
    skills_p.set_defaults(func=cmd_skills)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not hasattr(args, "func"):
        parser.print_help()
        sys.exit(EXIT_INPUT_ERROR)

    try:
        code = args.func(args)
        sys.exit(code)
    except ClawError as exc:
        output.print_error(str(exc))
        sys.exit(exc.exit_code)
    except KeyboardInterrupt:
        sys.exit(130)
