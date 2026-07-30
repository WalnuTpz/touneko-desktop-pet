const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
const productName = packageJson.build.productName;
const executablePath = path.join(
  projectRoot,
  "release",
  `${productName}-${packageJson.version}.exe`,
);
const smokeOutputRoot = path.join(
  os.tmpdir(),
  "tangmao-desktop-pet-smoke-output",
);
const expectedScreenshots = [
  "01-daily.png",
  "02-action.png",
  "03-movement.png",
  "04-scale-150.png",
];

function runPortable() {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, ["--smoke-test"], {
      stdio: "ignore",
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("最终便携版冒烟测试超过 120 秒"));
    }, 120000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(
          new Error(
            `最终便携版异常退出：code=${code}, signal=${signal || "none"}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("最终便携版冒烟测试只支持 Windows");
  }
  if (!fs.existsSync(executablePath)) {
    throw new Error(`缺少最终便携版：${executablePath}`);
  }

  const startedAt = Date.now();
  const stopwatch = process.hrtime.bigint();
  await runPortable();
  const elapsedSeconds =
    Number(process.hrtime.bigint() - stopwatch) / 1_000_000_000;

  for (const filename of expectedScreenshots) {
    const screenshotPath = path.join(smokeOutputRoot, filename);
    if (!fs.existsSync(screenshotPath)) {
      throw new Error(`最终便携版没有生成截图：${filename}`);
    }
    const stat = fs.statSync(screenshotPath);
    if (stat.size < 1000 || stat.mtimeMs < startedAt - 2000) {
      throw new Error(`最终便携版截图不是本轮有效结果：${filename}`);
    }
  }
  console.log(
    `最终便携版冒烟测试通过：${elapsedSeconds.toFixed(2)} 秒，4 张截图有效`,
  );
}

main().catch((error) => {
  console.error("最终便携版冒烟测试失败：", error);
  process.exitCode = 1;
});
