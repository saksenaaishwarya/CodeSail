# CodeSail — Docker-Based C++ Execution Engine

Milestone 1 of CodeSail, an institutional coding IDE.

**Scope of this milestone:** write C++ code → run it → see the output or a meaningful
error. Student code is compiled and executed **inside disposable Docker containers**,
never on the host machine.

Not in this milestone: authentication, MongoDB, AI features, dashboards, or any
language other than C++.

---

## 1. Repository structure

```text
CodeSail/
├── dockerCppRunner.js      # NEW  The Docker-based execution engine (the real runner)
├── test.js                 # NEW  Test suite (24 tests) for the Docker engine
├── package.json            # NEW  Scripts and metadata; zero dependencies
├── .gitignore              # NEW
├── README.md               # NEW  This file
├── docker/
│   └── cpp/
│       └── Dockerfile      # NEW  Builds the reusable `codesail-cpp` image
├── cppRunner.js            # UNCHANGED  Original host-based runner (kept as-is)
└── testRunner.js           # UNCHANGED  Original demo script for cppRunner.js
```

### Why the engine is a new file

The brief asked both to *"not modify existing files"* and to *"replace the execution
mechanism"* inside `cppRunner.js`. Those two instructions conflict, so this
implementation takes the non-destructive route:

* `cppRunner.js` and `testRunner.js` are left **byte-for-byte untouched**. Nothing
  that worked before has been removed.
* The Docker engine lives in `dockerCppRunner.js` and exposes **exactly the same
  public interface**, `runCpp(code, input)`, returning the same response shape.

To make `cppRunner.js` itself use Docker, replace its last line with:

```js
module.exports = require("./dockerCppRunner");
```

That is the only change needed — every existing caller keeps working, because the
function signature and the response contract are identical.

---

## 2. Prerequisites

| Requirement | Version used for verification | Notes |
|---|---|---|
| Node.js | v24.12.0 | Any LTS ≥ 20 works (`node:test` is built in) |
| Docker Desktop | 29.1.3 | Must be running, in **Linux containers** mode |
| Disk space | ~1.5 GB | For the `gcc:14` base image |

No npm packages are required. `npm install` will install nothing because the
project has zero dependencies — that is intentional.

### Starting Docker Desktop (Windows)

1. Open the Start menu and launch **Docker Desktop**, or run:
   ```powershell
   Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
   ```
2. Wait until the whale icon in the system tray stops animating.
3. Confirm the engine is reachable:
   ```bash
   docker version
   ```
   The `Server:` section must be present. If you only see `Client:`, the daemon
   is still starting.
4. If Docker is in Windows-containers mode, right-click the tray icon and choose
   **Switch to Linux containers**. The `codesail-cpp` image is Linux-based.

---

## 3. Installation and setup

```bash
# 1. Install dependencies (there are none, but this creates package-lock.json)
npm install

# 2. Build the execution image. Run this ONCE, not per submission.
docker build -t codesail-cpp ./docker/cpp

# 3. Verify the image contains a working compiler
docker run --rm codesail-cpp g++ --version
# expected: g++ (GCC) 14.4.0

# 4. Verify the image runs as a non-root user
docker run --rm codesail-cpp id
# expected: uid=1000(coderunner) gid=1000(coderunner) groups=1000(coderunner)
```

`npm run docker:build` and `npm run docker:verify` are shortcuts for steps 2 and 3.

The first build downloads `gcc:14` and can take several minutes. Later runs reuse
the cached image and start in well under a second.

---

## 4. Running the tests

```bash
# Recommended: readable, per-test output
npm test

# Equivalent, without npm
node --test-reporter=spec --test test.js

# The plain form from the brief also works
node test.js
```

### Expected output

```text
[setup] Docker is ready, image "codesail-cpp" found.

✔ 8a. empty source code returns a validation error
...
✔ 1. successful execution: input '10 20' gives output '30'
✔ 2. string output: prints 'Hello CodeSail'
...
ℹ tests 24
ℹ pass 24
ℹ fail 0
ℹ skipped 0
```

If Docker is **not** running, the suite prints a loud warning and reports the
17 Docker-dependent tests as **skipped**, never as passed:

```text
==========================================================================
WARNING: integration tests will be SKIPPED, not passed.
Docker is not available (...).
Start Docker Desktop, then: docker build -t codesail-cpp ./docker/cpp
==========================================================================

ℹ pass 7
ℹ fail 0
ℹ skipped 17
```

### Running the original host-based demo

`testRunner.js` is unchanged and still exercises the original host runner in
`cppRunner.js`. It needs `g++` installed on the host (e.g. MinGW on Windows):

```bash
node testRunner.js      # or: npm run demo
```

---

## 5. Using the engine

```js
const { runCpp } = require("./dockerCppRunner");

const result = await runCpp(
  `#include <iostream>
   int main() { int a, b; std::cin >> a >> b; std::cout << a + b; return 0; }`,
  "10 20"
);

console.log(result.status); // "success"
console.log(result.output); // "30"
```

### Signature

```js
runCpp(code, input = "", options = {})
```

| Parameter | Type | Meaning |
|---|---|---|
| `code` | string | The student's C++ source. Required, non-empty, ≤ 256 KB. |
| `input` | string | Optional text piped to standard input. ≤ 1 MB. |
| `options.language` | string | Defaults to `"cpp"`. Anything else is rejected. |
| `options.timeoutMs` | number | Execution timeout. Default 5000. |
| `options.compileTimeoutMs` | number | Compilation timeout. Default 20000. |
| `options.maxOutputBytes` | number | Output cap per stream. Default 1 MB. |
| `options.image` | string | Docker image. Default `codesail-cpp`. |
| `options.dockerBin` | string | Docker CLI path. Default `docker`. |

`runCpp` **never throws and never rejects.** Every outcome — including a missing
Docker daemon or a bug inside the runner — comes back as a structured result.

### Configuration via environment variables

No machine-specific path is hardcoded. Every default can be overridden:

| Variable | Default |
|---|---|
| `CODESAIL_CPP_IMAGE` | `codesail-cpp` |
| `CODESAIL_DOCKER_BIN` | `docker` |
| `CODESAIL_EXEC_TIMEOUT_MS` | `5000` |
| `CODESAIL_COMPILE_TIMEOUT_MS` | `20000` |
| `CODESAIL_MAX_OUTPUT_BYTES` | `1048576` |
| `CODESAIL_MAX_SOURCE_BYTES` | `262144` |
| `CODESAIL_MAX_INPUT_BYTES` | `1048576` |
| `CODESAIL_CONTAINER_USER` | `1000:1000` |
| `CODESAIL_PROBE_CACHE_MS` | `60000` |
| `CODESAIL_DEBUG` | unset — set to `1` for server-side diagnostics |

---

## 6. Response contract

Every call resolves to an object with these fields:

| Field | Type | Meaning |
|---|---|---|
| `status` | string | One of the seven statuses below. |
| `output` | string | The program's standard output. `""` when not applicable. |
| `error` | string \| null | Student-safe message. `null` only on success. |
| `exitCode` | number \| null | The program's exit code, when there is one. |
| `executionTime` | number | Milliseconds spent in the **execution** container. |
| `compileTime` | number | Milliseconds spent in the **compilation** container. |
| `phase` | string | `"validate"`, `"compile"`, or `"execute"`. |
| `detail` | string | **Only on `execution_error`.** For server logs, not students. |

`executionTime` measures how long the student's program took to run (including
container start-up, roughly 300–400 ms on this machine). It does not measure how
long the student took to write the code.

### Every status, with real captured output

**`success`**
```json
{
  "status": "success",
  "output": "30",
  "error": null,
  "exitCode": 0,
  "executionTime": 336,
  "compileTime": 732,
  "phase": "execute"
}
```

**`compilation_error`** — compiler diagnostics are passed straight through, with
the in-container folder stripped so the student sees `main.cpp:2:26`, not a path.
```json
{
  "status": "compilation_error",
  "output": "",
  "error": "main.cpp: In function 'int main()':\nmain.cpp:2:26: error: 'undeclared_thing' was not declared in this scope\n    2 | int main(){ std::cout << undeclared_thing; return 0 }\n      |                          ^~~~~~~~~~~~~~~~",
  "exitCode": 1,
  "executionTime": 0,
  "compileTime": 731,
  "phase": "compile"
}
```

**`runtime_error`** — note that output produced before the failure is preserved.
```json
{
  "status": "runtime_error",
  "output": "partial result\n",
  "error": "error: invalid index 7",
  "exitCode": 3,
  "executionTime": 329,
  "compileTime": 742,
  "phase": "execute"
}
```

**`timeout`**
```json
{
  "status": "timeout",
  "output": "",
  "error": "Execution timed out",
  "exitCode": null,
  "executionTime": 2150,
  "compileTime": 444,
  "phase": "execute"
}
```

**`output_limit_exceeded`**
```json
{
  "status": "output_limit_exceeded",
  "output": "",
  "error": "Output limit exceeded",
  "exitCode": null,
  "executionTime": 631,
  "compileTime": 446,
  "phase": "execute"
}
```

**`invalid_input`** — a validation failure. Nothing is created, so nothing leaks.
```json
{
  "status": "invalid_input",
  "output": "",
  "error": "Source code is empty. Please write some C++ code before running.",
  "exitCode": null,
  "executionTime": 0,
  "compileTime": 0,
  "phase": "validate"
}
```

**`execution_error`** — an infrastructure problem. The student sees a generic
message; `detail` carries the real cause for operators.
```json
{
  "status": "execution_error",
  "output": "",
  "error": "Execution service unavailable",
  "detail": "Docker CLI could not be started (spawn docker ENOENT).",
  "exitCode": null,
  "executionTime": 0,
  "compileTime": 0,
  "phase": "validate"
}
```

> `invalid_input` and the `exitCode` / `executionTime` / `compileTime` / `phase` /
> `detail` fields are additions to the original contract. The six original
> statuses and the `status` / `output` / `error` fields are unchanged, so existing
> callers keep working.

---

## 7. How the Docker pipeline works

```text
runCpp(code, input)
        |
        v  1. Validate            -> invalid_input      (nothing created)
        v  2. Probe Docker        -> execution_error    (cached for 60 s)
        v  3. mkdtemp + write main.cpp
        |
        v  4. CONTAINER 1  g++ -std=gnu++17 -O2 -o main main.cpp
        |       |-- timeout            -> timeout
        |       |-- non-zero exit      -> compilation_error
        |       '-- Docker's own error -> execution_error
        |
        v  5. CONTAINER 2  ./main      (student input piped to stdin)
        |       |-- 5 s elapsed        -> timeout                (container killed)
        |       |-- 1 MB on a stream   -> output_limit_exceeded   (container killed)
        |       |-- non-zero exit      -> runtime_error
        |       '-- exit 0             -> success
        |
        v  6. finally: delete the temporary folder
```

### Two containers, not one

A single container would have to use one memory limit for both phases. g++ needs
a few hundred megabytes to compile, while student code must be clamped to 128 MB —
so one container means loosening the limit that actually matters. Splitting the
phases also gives each its own timeout and makes a compiler error trivially
distinguishable from a runtime error. Both containers mount the *same* temporary
folder, so the compiled binary is simply there when the second container starts.

### How a timeout really stops the program

A JavaScript timer plus `child.kill()` is **not enough**: killing the local
`docker run` process only detaches the CLI, leaving the container running inside
the engine and still burning CPU. So each container is started with a unique
`--name` (`codesail-exec-<uuid>`), and on timeout the runner issues
`docker kill <that exact name>`. Because the name is unique per request, only this
request's container can ever be killed.

The runner then waits for the process's `close` event before deleting the
temporary folder, so the folder is never removed while a container still has it
mounted. A 4-second grace timer resolves the promise anyway if `close` never
arrives. A single `settled` flag guarantees the promise resolves exactly once.
Test `6b` asserts that `docker ps` shows no leftover `codesail-exec-*` containers
after a timeout.

### How the output limit really works

Bytes are counted **as each chunk arrives** and the collector stops appending once
the cap is reached. A program printing in an infinite loop therefore cannot fill
server memory — it is cut off at 1 MB and its container is killed. The cap is
applied to stdout and stderr **independently**, so the documented worst case is
2 MB total per submission.

### Why student code cannot be used for command injection

Every Docker invocation uses `spawn(dockerBin, [...argv])` with an **argument
array and no shell**. Student source code and student input are never part of that
array — the code travels to the container as a *file* in the mounted folder, and
the input travels through the process's stdin pipe. No shell ever parses either,
so there is nothing to escape.

---

## 8. Container restrictions

Both containers run with:

| Flag | What it prevents |
|---|---|
| `--network none` | No internet, no LAN, no localhost. Test 13 verifies this. |
| `--memory` + `--memory-swap` (equal) | Hard memory cap with swap fully disabled. |
| `--cpus` | Caps CPU share, so one submission cannot starve the machine. |
| `--pids-limit` | Blocks fork bombs. |
| `--cap-drop ALL` | Removes every Linux capability. |
| `--security-opt no-new-privileges` | setuid binaries cannot escalate. |
| `--read-only` | The container's own filesystem is immutable. |
| `--tmpfs /tmp:rw,nosuid,nodev` | The only writable scratch area, in RAM, size-capped. |
| `--user 1000:1000` | Runs as the non-root `coderunner` user. |
| `--rm` | The container is deleted the moment it exits. |
| `-v <temp folder>:/workspace` | Only this submission's folder is visible. |

| | Compilation container | Execution container |
|---|---|---|
| Memory | 512 MB | **128 MB** |
| CPUs | 1.0 | **0.5** |
| PID limit | 128 | **64** |
| `/tmp` size | 64 MB | **16 MB** |
| Timeout | 20 s | **5 s** |
| stdin | closed | piped from `input` |

Deliberately **not** done:

* The Docker socket is never mounted into an execution container.
* No host directory other than the per-submission temp folder is mounted.
* No `--privileged`, and nothing runs as root.
* The project directory is never mounted.

---

## 9. Security considerations — please read

**Docker provides useful isolation. It is not an absolute security boundary.**

Containers share the host kernel. A kernel-level container escape is theoretically
possible, and the restrictions above are *defence in depth*, not a guarantee.

**This is a prototype runner for a teaching environment. Do not describe it as
production-secure.** Before running untrusted code from the open internet you
would additionally want:

* A stronger sandbox (gVisor, Kata Containers, Firecracker microVMs, or a
  dedicated throwaway VM per submission).
* Seccomp and AppArmor/SELinux profiles beyond Docker's defaults.
* A per-user concurrency limit and a queue — right now nothing stops a thousand
  simultaneous submissions from exhausting the host.
* Disk quotas on the temporary folder (the workspace bind mount is currently
  writable and not size-capped; a program can fill the host temp partition).
* Audit logging of every submission.

### What is already handled

* Host paths never reach the student — compiler diagnostics and Docker errors are
  scrubbed, and the temp path is never logged to stdout. Test 4 asserts no
  Windows path or `AppData` string appears in compiler output.
* Infrastructure details go into `detail` (for logs), never into `error`.
* Student code and input are never interpolated into a shell command.
* The temporary folder is removed on every path, including timeouts and crashes.
  Test 10 asserts the folder count is unchanged after success, compilation error,
  runtime error, and timeout.

---

## 10. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `status: "execution_error"`, detail mentions `ENOENT` | The Docker CLI is not on `PATH`. Install Docker Desktop, or set `CODESAIL_DOCKER_BIN` to its full path. |
| detail says `Docker daemon is not reachable` | Docker Desktop is not running, or still starting. Launch it and wait for the tray icon to settle. |
| detail says `Execution image "codesail-cpp" is missing` | Run `docker build -t codesail-cpp ./docker/cpp`. |
| `docker: no matching manifest for windows/amd64` | Docker is in Windows-containers mode. Right-click the tray icon → *Switch to Linux containers*. |
| `error during connect ... dockerDesktopLinuxEngine` | Same as above — the Linux engine is not up yet. |
| Compilation fails with `Permission denied` writing `main` | The container user cannot write to the bind mount. Check Docker Desktop → *Settings → Resources → File sharing* includes your temp drive, or set `CODESAIL_CONTAINER_USER=0:0` as a diagnostic (less safe — do not leave it set). |
| Every run returns `timeout` immediately | The timeout is too low for container start-up (~300–400 ms). Keep `CODESAIL_EXEC_TIMEOUT_MS` at 1000 or above. |
| First run is very slow | The `gcc:14` image is being downloaded (~1.5 GB). This happens once. |
| `docker build` says `invalid working directory` in Git Bash | Git Bash rewrites `/workspace` into a Windows path. Use PowerShell, or prefix with `MSYS2_ARG_CONV_EXCL='*'`. This affects manual CLI use only — the Node runner is unaffected because `spawn` does no path conversion. |
| Tests report `skipped 17` | Docker is unavailable. The suite is telling you honestly that it did not run them. |

Set `CODESAIL_DEBUG=1` to print internal diagnostics to stderr.

---

## 11. Known limitations

1. **C++ only.** Any other `options.language` is rejected.
2. **No HTTP API yet.** `runCpp()` is a library function. No Express layer was
   added because this milestone only needs the runner; the engine is already
   shaped to drop into a route handler.
3. **Container start-up costs ~300–400 ms per phase**, so a trivial program takes
   roughly one second end to end. A warm container pool would fix this but adds
   cleanup complexity that is not worth it at this stage.
4. **`cppRunner.js` still runs on the host.** It is unchanged by design; see §1
   for the one-line switch.
5. **Output limits are per stream.** 1 MB of stdout *and* 1 MB of stderr, so 2 MB
   worst case, by design.
6. **No concurrency control.** Each call starts its own containers. Many parallel
   calls can exhaust host resources.
7. **The workspace bind mount is writable and not size-capped.** Simple student
   file I/O works, but a program can fill the host temp partition.
8. **`executionTime` includes container start-up**, so it is not a precise
   measurement of pure CPU time.
9. **Not production-hardened.** See §9.

---

## 12. Quick reference

```bash
docker build -t codesail-cpp ./docker/cpp     # build the image (once)
docker run --rm codesail-cpp g++ --version    # verify the image
npm test                                      # run the 24-test suite
node test.js                                  # same suite, plain node
node testRunner.js                            # original host-based demo
```
