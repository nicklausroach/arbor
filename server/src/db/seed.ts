import { db } from "./index.js";
import { detectGitHubRemotes, getDefaultBranch, isGitRepo } from "../github/client.js";
import { newId } from "../id.js";

// Preview apps (Fly PR review apps) boot with an empty, ephemeral DB and no project repo
// on disk to point the Connect flow at. The Dockerfile bakes a throwaway git checkout at
// ARBOR_SEED_REPO_PATH; here we insert a repositories row pointing at it so the app opens
// already-connected. Gated on ARBOR_PREVIEW so local dev and real deployments never seed.
export function seedPreviewRepo(): void {
  if (!process.env.ARBOR_PREVIEW) return;

  const seedPath = process.env.ARBOR_SEED_REPO_PATH;
  if (!seedPath) return;

  // Idempotent: only seed when there are no repositories yet. The DB is normally empty on
  // each cold start, but guard against re-running if /data ever persists.
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM repositories").get() as { count: number };
  if (count > 0) return;

  if (!isGitRepo(seedPath)) {
    console.warn(`seedPreviewRepo: ${seedPath} is not a git repo, skipping seed`);
    return;
  }

  // Read owner/name from the baked repo's origin remote so the Dockerfile's SEED_REMOTE_URL
  // is the single source of truth — no duplicated owner/name string to keep in sync.
  const remotes = detectGitHubRemotes(seedPath);
  const remote = remotes.find((r) => r.remoteName === "origin") ?? remotes[0];
  if (!remote) {
    console.warn(`seedPreviewRepo: no GitHub remote on ${seedPath}, skipping seed`);
    return;
  }

  db.prepare(
    "INSERT INTO repositories (id, local_path, owner, name, default_branch) VALUES (?, ?, ?, ?, ?)"
  ).run(newId("repo"), seedPath, remote.owner, remote.name, getDefaultBranch(seedPath));

  console.log(`seedPreviewRepo: connected ${remote.owner}/${remote.name} at ${seedPath}`);
}
