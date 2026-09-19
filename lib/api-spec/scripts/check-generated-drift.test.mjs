import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("the production drift command checks both generated libraries from the package directory", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const command = manifest.scripts.verify.match(/if ! (git[^;]+); then/)?.[1];
  assert.ok(command, "test must execute the actual drift command used by verify");
  const root = mkdtempSync(path.join(tmpdir(), "api-generated-drift-"));
  const packageDirectory = path.join(root, "lib/api-spec");
  const outputs = [
    "lib/api-client-react/src/generated/api.ts",
    "lib/api-zod/src/generated/api.ts",
  ];
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const check = () => spawnSync("sh", ["-c", command], { cwd: packageDirectory, encoding: "utf8" });
  try {
    mkdirSync(packageDirectory, { recursive: true });
    for (const output of outputs) {
      mkdirSync(path.dirname(path.join(root, output)), { recursive: true });
      writeFileSync(path.join(root, output), "// committed generated output\n");
    }
    git("init", "--quiet");
    git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test",
      "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture");

    assert.equal(check().status, 0, "unchanged generated files must pass");
    for (const output of outputs) {
      writeFileSync(path.join(root, output), "// regenerated output differs\n");
      const result = check();
      assert.equal(result.status, 1, `${output} drift must fail: ${result.stderr}`);
      assert.ok(result.stdout.includes(output), "failure must identify the changed output");
      git("restore", "--", output);
    }
    writeFileSync(path.join(packageDirectory, "README.md"), "Unrelated documentation\n");
    assert.equal(check().status, 0, "unrelated files must not cause generated drift failures");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("controlled hosted regression failure probe", () => { assert.fail("intentional CI regression probe; remove before merge"); });
