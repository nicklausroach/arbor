import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

process.env.ARBOR_DB_PATH = join(mkdtempSync(join(tmpdir(), "arbor-store-test-")), "test.sqlite");

const { migrate } = await import("../db/index.js");
const {
  createProject,
  createTask,
  getTask,
  listTasksForProject,
  updateTaskStatus,
  setTaskSession,
  deleteTask,
  deleteProject,
} = await import("./store.js");
const { db } = await import("../db/index.js");

function makeRepo(): string {
  const id = "repo_test";
  db.prepare(
    "INSERT INTO repositories (id, local_path, owner, name, default_branch) VALUES (?, ?, ?, ?, ?)"
  ).run(id, "/tmp/repo", "acme", "widgets", "main");
  return id;
}

beforeEach(() => {
  migrate();
  db.exec("DELETE FROM tasks; DELETE FROM projects; DELETE FROM repositories;");
});

describe("task CRUD", () => {
  it("creates a task with project_id and description", () => {
    const repoId = makeRepo();
    const project = createProject({ repositoryId: repoId, title: "T", objective: "O" });

    const task = createTask({ projectId: project.id, description: "do the thing" });

    expect(task.id).toMatch(/^task_/);
    expect(task.project_id).toBe(project.id);
    expect(task.description).toBe("do the thing");
    expect(task.status).toBe("draft");
    expect(task.session_id).toBeNull();
  });

  it("reads a task back by id", () => {
    const repoId = makeRepo();
    const project = createProject({ repositoryId: repoId, title: "T", objective: "O" });
    const created = createTask({ projectId: project.id, description: "read me" });

    expect(getTask(created.id)).toEqual(created);
    expect(getTask("task_missing")).toBeUndefined();
  });

  it("lists tasks for a project ordered by created_at descending", () => {
    const repoId = makeRepo();
    const project = createProject({ repositoryId: repoId, title: "T", objective: "O" });

    const first = createTask({ projectId: project.id, description: "first" });
    // Force a strictly later created_at so ordering is deterministic.
    db.prepare("UPDATE tasks SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(first.id);
    const second = createTask({ projectId: project.id, description: "second" });
    db.prepare("UPDATE tasks SET created_at = '2026-01-02T00:00:00.000Z' WHERE id = ?").run(second.id);

    const tasks = listTasksForProject(project.id);
    expect(tasks.map((t) => t.description)).toEqual(["second", "first"]);
  });

  it("only lists tasks for the requested project", () => {
    const repoId = makeRepo();
    const a = createProject({ repositoryId: repoId, title: "A", objective: "O" });
    const b = createProject({ repositoryId: repoId, title: "B", objective: "O" });
    createTask({ projectId: a.id, description: "for a" });
    createTask({ projectId: b.id, description: "for b" });

    expect(listTasksForProject(a.id).map((t) => t.description)).toEqual(["for a"]);
  });

  it("updates a task status and bumps updated_at", () => {
    const repoId = makeRepo();
    const project = createProject({ repositoryId: repoId, title: "T", objective: "O" });
    const task = createTask({ projectId: project.id, description: "work" });

    updateTaskStatus(task.id, "running");
    expect(getTask(task.id)!.status).toBe("running");

    updateTaskStatus(task.id, "completed");
    expect(getTask(task.id)!.status).toBe("completed");
  });

  it("stores a session id on a task", () => {
    const repoId = makeRepo();
    const project = createProject({ repositoryId: repoId, title: "T", objective: "O" });
    const task = createTask({ projectId: project.id, description: "work" });

    setTaskSession(task.id, "sess-123");
    expect(getTask(task.id)!.session_id).toBe("sess-123");
  });

  it("deletes a task", () => {
    const repoId = makeRepo();
    const project = createProject({ repositoryId: repoId, title: "T", objective: "O" });
    const task = createTask({ projectId: project.id, description: "temp" });

    deleteTask(task.id);
    expect(getTask(task.id)).toBeUndefined();
  });

  it("deletes a project's tasks when the project is deleted", () => {
    const repoId = makeRepo();
    const project = createProject({ repositoryId: repoId, title: "T", objective: "O" });
    createTask({ projectId: project.id, description: "child" });

    deleteProject(project.id);
    expect(listTasksForProject(project.id)).toEqual([]);
  });
});
