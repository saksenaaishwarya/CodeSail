// =============================================================================
// CodeSail - test suite for the Docker-based C++ execution engine
// =============================================================================
//
// Run it with:   node test.js          (or: npm test)
//
// It uses `node:test`, the test runner built into Node.js, so there are no
// dependencies to install.
//
// TWO KINDS OF TESTS
//   * Unit tests          - pure validation logic, no Docker needed.
//   * Integration tests   - really start containers. If Docker is not running,
//                           or the codesail-cpp image has not been built, these
//                           are reported as SKIPPED with the reason. They are
//                           never silently reported as passing.
// =============================================================================

const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");

const { runCpp, CONFIG } = require("./dockerCppRunner");

// -----------------------------------------------------------------------------
// Is Docker usable right now?
//
// This probe MUST be synchronous. `node:test` evaluates each test's options
// object (including our `{ skip: ... }`) while this file is being loaded, so an
// async `before` hook would run too late and the integration tests would fail
// instead of being skipped - exactly the "falsely reported" outcome we must
// avoid. execFileSync keeps the decision available before the first test() call.
// -----------------------------------------------------------------------------

let dockerSkipReason = null;

function probeDockerSync() {
  const quiet = { stdio: "pipe", timeout: 30000, encoding: "utf8" };

  // (a) Is the Docker CLI present and is the daemon answering?
  try {
    execFileSync(CONFIG.dockerBin, ["version", "--format", "{{.Server.Version}}"], quiet);
  } catch (err) {
    const reason = (err.stderr || err.message || "").toString().split("\n")[0].trim();
    dockerSkipReason = `Docker is not available (${reason || "daemon unreachable"}).`;
    return;
  }

  // (b) Has the execution image been built?
  try {
    execFileSync(CONFIG.dockerBin, ["image", "inspect", CONFIG.image], quiet);
  } catch {
    dockerSkipReason =
      `Docker image "${CONFIG.image}" is missing. ` +
      `Build it with: docker build -t ${CONFIG.image} ./docker/cpp`;
  }
}

probeDockerSync();

if (dockerSkipReason) {
  console.error("\n" + "=".repeat(74));
  console.error("WARNING: integration tests will be SKIPPED, not passed.");
  console.error(dockerSkipReason);
  console.error("Start Docker Desktop, then: docker build -t codesail-cpp ./docker/cpp");
  console.error("=".repeat(74) + "\n");
} else {
  console.error(`[setup] Docker is ready, image "${CONFIG.image}" found.\n`);
}

/** `{ skip: reason }` when Docker is missing, so node:test marks it skipped. */
function dockerTest() {
  return dockerSkipReason ? { skip: dockerSkipReason } : {};
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Count leftover CodeSail temp folders, used by the cleanup test. */
function countWorkspaces() {
  return fs
    .readdirSync(os.tmpdir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("codesail-")).length;
}

/** Print a compact summary of a result when an assertion fails. */
function describe(result) {
  return JSON.stringify(
    {
      status: result.status,
      output: (result.output || "").slice(0, 200),
      error: (result.error || "").slice(0, 300),
      detail: result.detail,
      exitCode: result.exitCode,
    },
    null,
    2
  );
}

// Reusable C++ programs.
const PROGRAMS = {
  addTwo: `
#include <iostream>
using namespace std;
int main() {
    int a, b;
    cin >> a >> b;
    cout << a + b;
    return 0;
}
`,
  hello: `
#include <iostream>
int main() {
    std::cout << "Hello CodeSail" << std::endl;
    return 0;
}
`,
  sumManyValues: `
#include <iostream>
#include <vector>
using namespace std;
int main() {
    int n;
    cin >> n;
    vector<int> values(n);
    long long total = 0;
    for (int i = 0; i < n; i++) { cin >> values[i]; total += values[i]; }
    cout << "count=" << n << " sum=" << total;
    return 0;
}
`,
  broken: `
#include <iostream>
int main() {
    this is not valid C++ at all
    return 0
}
`,
  // Deliberately exits non-zero. We do NOT rely on a crash (dereferencing a
  // null pointer is undefined behaviour and does not fail consistently).
  exitsNonZero: `
#include <iostream>
int main() {
    std::cerr << "something went wrong" << std::endl;
    return 3;
}
`,
  infiniteLoop: `
int main() {
    volatile long long x = 0;
    while (true) { x++; }
    return 0;
}
`,
  floodsOutput: `
#include <cstdio>
int main() {
    // Far more than the 1 MB limit, printed as fast as possible.
    for (long long i = 0; i < 20000000LL; i++) {
        fputs("codesail-overflow-line-of-text\\n", stdout);
    }
    return 0;
}
`,
  echoesInput: `
#include <iostream>
#include <string>
using namespace std;
int main() {
    string line;
    int lines = 0;
    while (getline(cin, line)) lines++;
    cout << "lines=" << lines;
    return 0;
}
`,
  printsNothing: `
int main() { return 0; }
`,
};

// =============================================================================
// Unit tests - no Docker required
// =============================================================================

test("8a. empty source code returns a validation error", async () => {
  const result = await runCpp("");
  assert.strictEqual(result.status, "invalid_input", describe(result));
  assert.ok(result.error && result.error.length > 0, "expected a helpful message");
  assert.strictEqual(result.output, "");
});

test("8b. whitespace-only source code returns a validation error", async () => {
  const result = await runCpp("   \n\t  ");
  assert.strictEqual(result.status, "invalid_input", describe(result));
});

test("8c. non-string source code returns a validation error", async () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    const result = await runCpp(bad);
    assert.strictEqual(result.status, "invalid_input", describe(result));
  }
});

test("8d. non-string standard input returns a validation error", async () => {
  const result = await runCpp(PROGRAMS.hello, 123);
  assert.strictEqual(result.status, "invalid_input", describe(result));
});

test("8e. an unsupported language is rejected", async () => {
  const result = await runCpp(PROGRAMS.hello, "", { language: "python" });
  assert.strictEqual(result.status, "invalid_input", describe(result));
  assert.match(result.error, /python/i);
});

test("8f. oversized source code is rejected", async () => {
  const huge = "// padding\n".repeat(CONFIG.maxSourceBytes);
  const result = await runCpp(huge);
  assert.strictEqual(result.status, "invalid_input", describe(result));
  assert.match(result.error, /too large/i);
});

test("9. Docker unavailable produces a controlled infrastructure error", async () => {
  // Point the runner at a Docker CLI that does not exist. This is exactly what
  // a stopped Docker Desktop or a missing CLI looks like to us.
  const result = await runCpp(PROGRAMS.hello, "", {
    dockerBin: "codesail-no-such-docker-binary",
  });
  assert.strictEqual(result.status, "execution_error", describe(result));
  assert.strictEqual(result.error, "Execution service unavailable");
  assert.strictEqual(result.output, "");
  // The operator-facing detail exists but the student-facing message does not
  // leak infrastructure internals.
  assert.ok(result.detail, "expected a detail field for server logs");
});

test("9b. a missing Docker image produces a controlled infrastructure error", dockerTest(), async () => {
  const result = await runCpp(PROGRAMS.hello, "", {
    image: "codesail-image-that-does-not-exist:nope",
  });
  assert.strictEqual(result.status, "execution_error", describe(result));
  assert.match(result.detail, /docker build/i, "detail should tell the operator how to fix it");
});

// =============================================================================
// Integration tests - these really start containers
// =============================================================================

test("1. successful execution: input '10 20' gives output '30'", dockerTest(), async () => {
  const result = await runCpp(PROGRAMS.addTwo, "10 20");
  assert.strictEqual(result.status, "success", describe(result));
  assert.strictEqual(result.output.trim(), "30");
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.exitCode, 0);
  assert.ok(typeof result.executionTime === "number" && result.executionTime >= 0);
});

test("2. string output: prints 'Hello CodeSail'", dockerTest(), async () => {
  const result = await runCpp(PROGRAMS.hello);
  assert.strictEqual(result.status, "success", describe(result));
  assert.strictEqual(result.output.trim(), "Hello CodeSail");
});

test("3. standard input: reads and processes multiple values", dockerTest(), async () => {
  const result = await runCpp(PROGRAMS.sumManyValues, "5\n1 2 3 4 5\n");
  assert.strictEqual(result.status, "success", describe(result));
  assert.strictEqual(result.output.trim(), "count=5 sum=15");
});

test("4. compilation error: malformed C++ returns compilation_error", dockerTest(), async () => {
  const result = await runCpp(PROGRAMS.broken);
  assert.strictEqual(result.status, "compilation_error", describe(result));
  assert.strictEqual(result.output, "");
  assert.match(result.error, /error/i, "compiler diagnostics should be visible");
  assert.match(result.error, /main\.cpp/, "diagnostics should name the file");
  // No host path may be exposed to the student.
  assert.doesNotMatch(result.error, /[A-Za-z]:[\\/]/, "must not leak a Windows host path");
  assert.doesNotMatch(result.error, /AppData/i, "must not leak the host temp folder");
});

test("5. runtime error: a non-zero exit status returns runtime_error", dockerTest(), async () => {
  const result = await runCpp(PROGRAMS.exitsNonZero);
  assert.strictEqual(result.status, "runtime_error", describe(result));
  assert.strictEqual(result.exitCode, 3);
  assert.match(result.error, /something went wrong/);
});

test("6. infinite loop is terminated and returns timeout", dockerTest(), async () => {
  const startedAt = Date.now();
  const result = await runCpp(PROGRAMS.infiniteLoop, "", { timeoutMs: 2000 });
  const elapsed = Date.now() - startedAt;
  assert.strictEqual(result.status, "timeout", describe(result));
  assert.strictEqual(result.error, "Execution timed out");
  // It must actually stop, not run to completion.
  assert.ok(elapsed < 20000, `took too long to give up: ${elapsed} ms`);
});

test("6b. the killed container does not survive the timeout", dockerTest(), async () => {
  await runCpp(PROGRAMS.infiniteLoop, "", { timeoutMs: 1500 });
  // Give Docker a moment to finish removing the container.
  await new Promise((r) => setTimeout(r, 2500));
  const running = execFileSync(
    CONFIG.dockerBin,
    ["ps", "--filter", "name=codesail-exec-", "--format", "{{.Names}}"],
    { encoding: "utf8" }
  ).trim();
  assert.strictEqual(running, "", `leftover containers still running: ${running}`);
});

test("7. output overflow is terminated and returns output_limit_exceeded", dockerTest(), async () => {
  const result = await runCpp(PROGRAMS.floodsOutput, "", { timeoutMs: 15000 });
  assert.strictEqual(result.status, "output_limit_exceeded", describe(result));
  assert.strictEqual(result.error, "Output limit exceeded");
});

test("10. the temporary workspace is removed after success and after failure", dockerTest(), async () => {
  const before = countWorkspaces();

  await runCpp(PROGRAMS.addTwo, "1 2"); // success
  await runCpp(PROGRAMS.broken); // compilation error
  await runCpp(PROGRAMS.exitsNonZero); // runtime error
  await runCpp(PROGRAMS.infiniteLoop, "", { timeoutMs: 1500 }); // timeout

  const after = countWorkspaces();
  assert.strictEqual(after, before, `${after - before} temporary folder(s) were left behind`);
});

test("11. repeated execution does not reuse stale source or executables", dockerTest(), async () => {
  // Each run must see only its own code. If a previous workspace or binary
  // leaked through, the second and third answers would be wrong.
  const first = await runCpp(PROGRAMS.addTwo, "2 3");
  assert.strictEqual(first.status, "success", describe(first));
  assert.strictEqual(first.output.trim(), "5");

  const second = await runCpp(PROGRAMS.hello);
  assert.strictEqual(second.status, "success", describe(second));
  assert.strictEqual(second.output.trim(), "Hello CodeSail");

  const third = await runCpp(PROGRAMS.addTwo, "100 -40");
  assert.strictEqual(third.status, "success", describe(third));
  assert.strictEqual(third.output.trim(), "60");

  // A broken program in between must not poison the next good run.
  const broken = await runCpp(PROGRAMS.broken);
  assert.strictEqual(broken.status, "compilation_error", describe(broken));

  const fourth = await runCpp(PROGRAMS.addTwo, "7 8");
  assert.strictEqual(fourth.status, "success", describe(fourth));
  assert.strictEqual(fourth.output.trim(), "15");
});

test("12a. empty input works for a program that reads nothing", dockerTest(), async () => {
  const result = await runCpp(PROGRAMS.printsNothing, "");
  assert.strictEqual(result.status, "success", describe(result));
  assert.strictEqual(result.output, "");
});

test("12b. empty input works for a program that tries to read", dockerTest(), async () => {
  // stdin is closed immediately, so getline() fails straight away and the
  // program must finish instead of hanging until the timeout.
  const result = await runCpp(PROGRAMS.echoesInput, "");
  assert.strictEqual(result.status, "success", describe(result));
  assert.strictEqual(result.output.trim(), "lines=0");
});

test("12c. input ending with a newline works", dockerTest(), async () => {
  const result = await runCpp(PROGRAMS.echoesInput, "alpha\nbeta\ngamma\n");
  assert.strictEqual(result.status, "success", describe(result));
  assert.strictEqual(result.output.trim(), "lines=3");
});

test("12d. input without a trailing newline works", dockerTest(), async () => {
  const result = await runCpp(PROGRAMS.addTwo, "40 2");
  assert.strictEqual(result.status, "success", describe(result));
  assert.strictEqual(result.output.trim(), "42");
});

test("12e. extra unread input does not break the program", dockerTest(), async () => {
  // The program reads two numbers and exits; the rest of the pipe is discarded.
  const result = await runCpp(PROGRAMS.addTwo, "6 7\n" + "99 ".repeat(1000));
  assert.strictEqual(result.status, "success", describe(result));
  assert.strictEqual(result.output.trim(), "13");
});

test("13. student code has no network access", dockerTest(), async () => {
  const result = await runCpp(`
#include <cstdlib>
int main() {
    // Returns non-zero when the name cannot be resolved, which is what we
    // expect with --network none.
    return std::system("getent hosts example.com > /dev/null") == 0 ? 0 : 7;
}
`);
  assert.strictEqual(result.status, "runtime_error", describe(result));
  assert.strictEqual(result.exitCode, 7, "network should be unreachable");
});
