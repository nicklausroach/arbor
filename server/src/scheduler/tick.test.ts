import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.ARBOR_DB_PATH = join(mkdtempSync(join(tmpdir(), "arbor-test-")), "test.sqlite");

const startTicketRun = vi.fn();
vi.mock("../runner/runner.js", () => ({ startTicketRun }));

const getPrMergeState = vi.fn();
const findOpenPrForBranch = vi.fn();
const octokitFromStoredPat = vi.fn(() => ({}) as any);
vi.mock("../github/client.js", () => ({ getPrMergeState, findOpenPrForBranch, octokitFromStoredPat }));

const { migrate, setSetting } = await import("../db/index.js");
const { tick } = await import("./tick.js");
const {
  createProject,
  ensureTicketRows,
  insertDependencyRows,
  insertRun,
  finishRun,
  setProjectBaseBranch,
  setProjectStatus,
  setTicketStatus,
  getProject,
  listTicketsWithDeps,
} = await import("../projects/store.js");
const { db } = await import("../db/index.js");

function makeRepo() {
  const id = "repo_test";
  db.prepare(
    "INSERT INTO repositories (id, local_path, owner, name, default_branch) VALUES (?, ?, ?, ?, ?)"
  ).run(id, "/tmp/repo", "acme", "widgets", "main");
  return id;
}

beforeEach(() => {
  migrate();
  db.exec("DELETE FROM runs; DELETE FROM dependencies; DELETE FROM tickets; DELETE FROM graph_versions; DELETE FROM projects; DELETE FROM repositories; DELETE FROM settings;");
  startTicketRun.mockReset();
  getPrMergeState.mockReset();
  findOpenPrForBranch.mockReset();
  setSetting("agent_command", "true");
  setSetting("max_concurrency", "1");
});

afterAll(() => {
  db.close();
});

function setupTwoTicketProject() {
  const repositoryId = makeRepo();
  const project = createProject({ repositoryId, title: "Demo", objective: "obj" });
  setProjectBaseBranch(project.id, "main");
  ensureTicketRows(project.id, [
    { ticket: { id: "T1", title: "Root", problem: "p", acceptanceCriteria: [], dependsOn: [] }, number: 1, status: "ready", branchName: "arbor/demo/1-root" },
    { ticket: { id: "T2", title: "Child", problem: "p", acceptanceCriteria: [], dependsOn: ["T1"] }, number: 2, status: "blocked", branchName: "arbor/demo/2-child" },
  ]);
  insertDependencyRows(project.id, [
    { id: "T1", title: "Root", problem: "p", acceptanceCriteria: [], dependsOn: [] },
    { id: "T2", title: "Child", problem: "p", acceptanceCriteria: [], dependsOn: ["T1"] },
  ]);
  setProjectStatus(project.id, "running");
  return project;
}

describe("scheduler tick", () => {
  it("dispatches a ready root ticket via the runner", async () => {
    const project = setupTwoTicketProject();
    await tick(project.id);
    expect(startTicketRun).toHaveBeenCalledTimes(1);
    const arg = startTicketRun.mock.calls[0][0];
    expect(arg.ticket.stable_key).toBe("T1");
  });

  it("does not dispatch a blocked ticket, and respects the concurrency limit", async () => {
    const project = setupTwoTicketProject();
    const tickets = listTicketsWithDeps(project.id);
    const t1 = tickets.find((t) => t.stable_key === "T1")!;
    setTicketStatus(t1.id, "running"); // simulate T1 already running
    await tick(project.id);
    // concurrency is 1 and T1 already counts as running, so T2 (still blocked) must not dispatch
    expect(startTicketRun).not.toHaveBeenCalled();
  });

  it("promotes blocked -> ready once the upstream ticket is merged", async () => {
    const project = setupTwoTicketProject();
    const tickets = listTicketsWithDeps(project.id);
    const t1 = tickets.find((t) => t.stable_key === "T1")!;
    setTicketStatus(t1.id, "merged");
    await tick(project.id);
    const after = listTicketsWithDeps(project.id);
    expect(after.find((t) => t.stable_key === "T2")!.status).toBe("ready");
  });

  it("promotes review -> merged by polling the linked PR, and recovers a stuck running ticket via an open PR lookup", async () => {
    const project = setupTwoTicketProject();
    const tickets = listTicketsWithDeps(project.id);
    const t1 = tickets.find((t) => t.stable_key === "T1")!;
    const t2 = tickets.find((t) => t.stable_key === "T2")!;

    setTicketStatus(t1.id, "review");
    const run = insertRun(t1.id, "/tmp/log.txt");
    finishRun(run.id, "succeeded", 42, "https://github.com/acme/widgets/pull/42");
    // Only PR #42 (T1's) is merged — T2's freshly-recovered PR #43 is still open,
    // so this isolates "review -> merged" from the same-tick recovery promotion.
    getPrMergeState.mockImplementation(async (_o: unknown, _ow: string, _r: string, prNumber: number) => ({
      merged: prNumber === 42,
      state: prNumber === 42 ? "closed" : "open",
    }));

    setTicketStatus(t2.id, "running");
    const stuckRun = insertRun(t2.id, "/tmp/log2.txt");
    findOpenPrForBranch.mockResolvedValue({ number: 43, url: "https://github.com/acme/widgets/pull/43" });

    await tick(project.id);

    const after = listTicketsWithDeps(project.id);
    expect(after.find((t) => t.stable_key === "T1")!.status).toBe("merged");
    expect(after.find((t) => t.stable_key === "T2")!.status).toBe("review");
    void stuckRun;
  });

  it("marks the project done once every ticket is merged", async () => {
    const project = setupTwoTicketProject();
    const tickets = listTicketsWithDeps(project.id);
    for (const t of tickets) setTicketStatus(t.id, "merged");
    await tick(project.id);
    expect(getProject(project.id)!.status).toBe("done");
  });
});
