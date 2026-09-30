async def test_overview_counts_project_tasks_created_without_a_parent(client, auth_headers):
    project = (
        await client.post("/api/projects", headers=auth_headers, json={"title": "Launch"})
    ).json()
    make = lambda title: client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": title, "project_id": project["id"]},
    )
    review = (await make("Review copy")).json()
    publish = (await make("Publish post")).json()
    await make("Book venue")
    linked = await client.post(
        "/api/task-relationships",
        headers=auth_headers,
        json={
            "source_task_id": publish["id"],
            "target_task_id": review["id"],
            "type": "depends_on",
        },
    )
    assert linked.status_code in (200, 201), linked.text

    overview = (
        await client.get(f"/api/projects/{project['id']}", headers=auth_headers)
    ).json()

    # Review copy and Book venue can start; Publish waits on Review copy.
    assert (overview["ready_count"], overview["blocked_count"]) == (2, 1)
