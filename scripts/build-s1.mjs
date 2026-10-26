import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, copyFileSync, chmodSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The Windows app keeps Ollama; MLX is an optional Apple Silicon provider.
if (process.platform !== "darwin") process.exit(0);
if (process.arch !== "arm64") throw new Error("Build the S1-mini helper on Apple Silicon");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../native/s1-mini");
execFileSync("xcodebuild", ["-scheme", "PatterS1", "-configuration", "Release", "-destination", "platform=macOS,arch=arm64", "-derivedDataPath", join(root, ".build/xcode"), "CODE_SIGNING_ALLOWED=NO", "build"], { cwd: root, stdio: "inherit" });
const bin = join(root, ".build/xcode/Build/Products/Release");
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copyFileSync(join(bin, "patter-s1"), join(dist, "patter-s1"));
const metal = [join(bin, "mlx-swift_Cmlx.bundle/Contents/Resources/default.metallib"), join(bin, "mlx-swift_Cmlx.bundle/default.metallib")].find(existsSync);
if (!metal) throw new Error("MLX Metal library missing. Install the Xcode Metal toolchain.");
copyFileSync(metal, join(dist, "mlx.metallib"));
cpSync(join(root, "licenses"), join(dist, "licenses"), { recursive: true });
// Retain license notices for the statically linked Swift dependencies.
for (const name of readdirSync(join(root, ".build/xcode/SourcePackages/checkouts"))) {
  const checkout = join(root, ".build/xcode/SourcePackages/checkouts", name);
  for (const file of readdirSync(checkout).filter(f => /^(LICENSE|COPYING|NOTICE)(\.|$)/i.test(f))) {
    cpSync(join(checkout, file), join(dist, "licenses", `${name}-${file}`), { recursive: true });
  }
}
for (const file of readdirSync(join(dist, "licenses"))) chmodSync(join(dist, "licenses", file), 0o644);
// Newer toolchains may link Swift compatibility libraries absent on older macOS.
execFileSync("xcrun", ["swift-stdlib-tool", "--copy", "--scan-executable", join(dist, "patter-s1"), "--destination", dist, "--platform", "macosx", "--sign", process.env.APPLE_SIGNING_IDENTITY || "-"], { stdio: "inherit" });
for (const file of readdirSync(dist).filter(f => f.endsWith(".original"))) rmSync(join(dist, file));
execFileSync("install_name_tool", ["-add_rpath", "@executable_path", join(dist, "patter-s1")]);
execFileSync("codesign", ["--force", "--sign", process.env.APPLE_SIGNING_IDENTITY || "-", join(dist, "patter-s1")], { stdio: "inherit" });
console.log("Bundled S1-mini runtime:", dist);
