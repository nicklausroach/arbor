import { Router } from "express";
import { readFileSync } from "node:fs";
import { getRun } from "../projects/store.js";

export const runLogRouter = Router();

runLogRouter.get("/:id/log", (req, res) => {
  const run = getRun(req.params.id);
  if (!run || !run.log_path) {
    res.status(404).type("text/plain").send("no log available");
    return;
  }
  try {
    res.type("text/plain").send(readFileSync(run.log_path, "utf8"));
  } catch {
    res.status(404).type("text/plain").send("log file not found");
  }
});
