"""Rich-based output formatting for CLI results."""

from __future__ import annotations

import json
import sys
from typing import Any

from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text

console = Console()
err_console = Console(stderr=True)

PRIORITY_COLORS = {
    "urgent": "red bold",
    "high": "yellow",
    "medium": "white",
    "low": "dim",
}

STATUS_ICONS = {
    "pending": "○",
    "in_progress": "◐",
    "completed": "●",
    "cancelled": "✗",
}

INBOX_STATE_LABELS = {
    "none": "",
    "classifying": "classifying…",
    "questioning": "needs answers",
    "planning": "planning…",
    "plan_ready": "plan ready",
    "captured": "captured",
}


def print_json(data: Any) -> None:
    print(json.dumps(data, indent=2, default=str))


def print_error(msg: str) -> None:
    err_console.print(f"[red bold]error:[/] {msg}")


def print_success(msg: str) -> None:
    console.print(f"[green]✓[/] {msg}")


def print_todo_row(todo: dict, *, compact: bool = False) -> str:
    """Format a single todo as a one-line string."""
    status = STATUS_ICONS.get(todo.get("status", ""), "?")
    priority = todo.get("priority", "medium")
    title = todo.get("title", "")
    tid = todo.get("id", "")[:8]
    parts = [f"{status} [{PRIORITY_COLORS.get(priority, 'white')}]{title}[/]"]
    if not compact:
        parts.append(f"  [dim]{tid}[/]")
    due = todo.get("due_date")
    if due:
        parts.append(f"  [cyan]due {due[:10]}[/]")
    inbox = todo.get("inbox_state", "none")
    label = INBOX_STATE_LABELS.get(inbox, "")
    if label:
        parts.append(f"  [magenta]({label})[/]")
    return "".join(parts)


def print_todo_list(data: dict, *, as_json: bool = False, plain: bool = False) -> None:
    if as_json:
        print_json(data)
        return

    items = data.get("items", [])
    total = data.get("total", len(items))
    page = data.get("page", 1)
    limit = data.get("limit", 20)

    if not items:
        console.print("[dim]No todos found.[/]")
        return

    if plain:
        for todo in items:
            status = STATUS_ICONS.get(todo.get("status", ""), "?")
            print(f"{status} {todo['id'][:8]}  {todo['title']}")
        return

    for todo in items:
        console.print(print_todo_row(todo))

    if total > len(items):
        console.print(f"\n[dim]Page {page} · {len(items)}/{total} todos (--page/--limit to paginate)[/]")


def print_todo_detail(todo: dict, *, as_json: bool = False) -> None:
    if as_json:
        print_json(todo)
        return

    priority = todo.get("priority", "medium")
    status = todo.get("status", "pending")
    title = todo.get("title", "")

    lines = [
        f"[bold]{title}[/]",
        f"ID:       {todo.get('id', '')}",
        f"Status:   {STATUS_ICONS.get(status, '?')} {status}",
        f"Priority: [{PRIORITY_COLORS.get(priority, 'white')}]{priority}[/]",
    ]

    if todo.get("due_date"):
        lines.append(f"Due:      {todo['due_date'][:10]}")
    if todo.get("tags"):
        lines.append(f"Tags:     {', '.join(todo['tags'])}")
    if todo.get("estimated_minutes"):
        lines.append(f"Estimate: {todo['estimated_minutes']}min")
    if todo.get("source"):
        lines.append(f"Source:   {todo['source']} ({todo.get('source_id', '')})")
    inbox = todo.get("inbox_state", "none")
    if inbox != "none":
        lines.append(f"Inbox:    {INBOX_STATE_LABELS.get(inbox, inbox)}")
    if todo.get("description"):
        lines.append(f"\n{todo['description']}")
    if todo.get("plan_summary"):
        lines.append(f"\n[dim]Plan: {todo['plan_summary']}[/]")
    if todo.get("next_action"):
        lines.append(f"[dim]Next: {todo['next_action']}[/]")
    if todo.get("clarification_questions"):
        lines.append("\n[yellow]Clarification questions:[/]")
        for i, q in enumerate(todo["clarification_questions"]):
            ans = (todo.get("clarification_answers") or {}).get(str(i), "")
            mark = f" → {ans}" if ans else ""
            lines.append(f"  {i}. {q}{mark}")

    console.print(Panel("\n".join(lines), border_style="blue"))


def print_today(data: dict, *, as_json: bool = False) -> None:
    if as_json:
        print_json(data)
        return

    console.print(f"[bold]{data.get('greeting', 'Hello')}[/]  {data.get('date', '')}\n")

    overdue = data.get("overdue_tasks", [])
    if overdue:
        console.print(f"[red bold]Overdue ({len(overdue)})[/]")
        for t in overdue:
            console.print(f"  {print_todo_row(t, compact=True)}")
        console.print()

    today_tasks = data.get("today_tasks", [])
    if today_tasks:
        console.print(f"[bold]Today ({len(today_tasks)})[/]")
        for t in today_tasks:
            console.print(f"  {print_todo_row(t, compact=True)}")
        console.print()

    events = data.get("today_events", [])
    if events:
        console.print(f"[bold]Events ({len(events)})[/]")
        for e in events:
            start = e.get("start_time", "")[:16].replace("T", " ")
            console.print(f"  [cyan]{start}[/]  {e.get('title', '')}")
        console.print()

    needs_review = data.get("needs_review", [])
    inbox_count = data.get("inbox_count", 0)
    if needs_review or inbox_count:
        console.print(f"[magenta bold]Inbox[/] ({inbox_count} unscheduled)")
        for t in needs_review:
            console.print(f"  {print_todo_row(t, compact=True)}")

    if not overdue and not today_tasks and not events and not needs_review:
        console.print("[dim]Nothing scheduled for today.[/]")


def print_plan(plan: dict, *, as_json: bool = False) -> None:
    if as_json:
        print_json(plan)
        return

    console.print(f"[bold]Plan[/]  [dim]task {plan.get('task_id', '')[:8]}[/]\n")
    console.print(plan.get("summary", ""))

    subtasks = plan.get("subtasks", [])
    if subtasks:
        console.print(f"\n[bold]Subtasks ({len(subtasks)})[/]")
        for i, st in enumerate(subtasks):
            est = f" [{st['estimated_minutes']}min]" if st.get("estimated_minutes") else ""
            due = f" due {st['due_date'][:10]}" if st.get("due_date") else ""
            deps = ""
            if st.get("depends_on_indices"):
                deps = f" (after #{', #'.join(str(d) for d in st['depends_on_indices'])})"
            console.print(f"  {i}. {st.get('title', '')}{est}{due}{deps}")
            if st.get("description"):
                console.print(f"     [dim]{st['description']}[/]")

    if plan.get("suggested_root_due_date"):
        console.print(f"\nSuggested due: {plan['suggested_root_due_date']}")
    if plan.get("suggested_skills_labels"):
        console.print(f"Suggested skills: {', '.join(plan['suggested_skills_labels'])}")
    if plan.get("suggested_project_label"):
        console.print(f"Suggested project: {plan['suggested_project_label']}")


def print_skills(data: dict, *, as_json: bool = False) -> None:
    if as_json:
        print_json(data)
        return

    skills = data.get("skills", [])
    if not skills:
        console.print("[dim]No skills available.[/]")
        return

    table = Table(show_header=True, header_style="bold")
    table.add_column("ID", style="cyan")
    table.add_column("Name")
    table.add_column("Description")
    table.add_column("Tags", style="dim")

    for s in skills:
        table.add_row(
            s.get("id", ""),
            s.get("name", ""),
            s.get("description", ""),
            ", ".join(s.get("tags", [])),
        )
    console.print(table)
