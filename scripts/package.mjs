// Build and pack the distributable artifacts into dist-packages/ (npm run package).
//   @callwrit/core, @callwrit/sdk, @callwrit/mcp-gateway  → .tgz (npm pack)
//   callwrit (Python)                                     → .whl (pip wheel, no runtime deps)
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist-packages");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
const bin = path.join(root, "node_modules", ".bin");
const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
const run = (cmd, cwd) => execSync(cmd, { cwd, env, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();

for (const pkg of ["core", "sdk-ts", "mcp-gateway"]) {
  const dir = path.join(root, "packages", pkg);
  fs.rmSync(path.join(dir, "dist"), { recursive: true, force: true });
  run("npm run build", dir);
  const file = run(`npm pack --pack-destination "${out}"`, dir).split("\n").pop();
  console.log(`packed ${file}`);
}

const py = ["python3", "python"].find((p) => {
  try {
    execSync(`${p} --version`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});
if (py) {
  run(`${py} -m pip wheel --no-deps --wheel-dir "${out}" .`, path.join(root, "sdk", "python"));
  console.log(`built ${fs.readdirSync(out).filter((f) => f.endsWith(".whl")).join(", ")}`);
} else console.warn("python not found: skipped the wheel");
