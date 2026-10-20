// =============================================================================
// CodeSail - Docker-based C++ execution engine
// =============================================================================
//
// WHAT THIS FILE DOES
//   It takes a string of C++ source code (and optional standard input), then
//   compiles and runs that code inside throwaway Docker containers. Nothing is
//   ever compiled or executed directly on the host machine.
//
// WHY DOCKER
//   Student code is untrusted. Running it on the host would let it read files,
//   open network connections, or hang the server. A container gives us a
//   separate filesystem, no network, and hard CPU/memory limits.
//
// THE PIPELINE (one submission = two short-lived containers)
//
//   runCpp(code, input)
//        |
//        v  validate the request                -> invalid_input
//        v  check Docker is usable              -> execution_error
//        v  create a unique temp folder, write main.cpp
//        |
//        v  CONTAINER 1: g++ main.cpp -o main   -> compilation_error
//        |
//        v  CONTAINER 2: ./main   (stdin piped) -> timeout
//        |                                      -> output_limit_exceeded
//        |                                      -> runtime_error
//        v  success
//        |
//        v  always: kill leftover container, delete the temp folder
//
// WHY TWO CONTAINERS INSTEAD OF ONE
//   g++ needs a few hundred megabytes of memory to compile, but student code
//   must be clamped to a much smaller limit. A single container can only have
//   one memory limit, so we would have to loosen the limit for student code.
//   Two containers also make it trivial to tell a compiler error apart from a
//   runtime error, and to give each phase its own timeout.
//
// SECURITY NOTE (IMPORTANT, PLEASE READ)
//   The restrictions below (no network, dropped capabilities, read-only root
//   filesystem, non-root user, memory/CPU/process caps) are real, useful
//   defence in depth. They are NOT an absolute security boundary: a container
//   shares the host kernel, so a kernel-level escape is theoretically
//   possible. This module is a teaching/prototype runner. Do not treat it as
//   production-hardened multi-tenant sandboxing.
//
// =============================================================================

const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

// -----------------------------------------------------------------------------
// 1. Configuration
//
//    Every value can be overridden with an environment variable so that the
//    same code works on a laptop, in CI, and on a server, without editing it.
//    No machine-specific paths are hardcoded anywhere in this file.
// -----------------------------------------------------------------------------

/** Read a positive integer from the environment, or fall back to a default. */
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const CONFIG = {
  // The prebuilt image. Built once with: docker build -t codesail-cpp ./docker/cpp
  image: process.env.CODESAIL_CPP_IMAGE || "codesail-cpp",

  // The Docker CLI executable. Overridable mainly so tests can point it at a
  // non-existent command and verify our "Docker unavailable" handling.
  dockerBin: process.env.CODESAIL_DOCKER_BIN || "docker",

  // How long each phase may take.
  compileTimeoutMs: envInt("CODESAIL_COMPILE_TIMEOUT_MS", 20000),
  executeTimeoutMs: envInt("CODESAIL_EXEC_TIMEOUT_MS", 5000),

  // Maximum bytes we keep from a stream before we give up and kill the
  // container. Applied to stdout and stderr independently (see FR-6 note in
  // the README), so a program can produce at most 2 MB in total.
  maxOutputBytes: envInt("CODESAIL_MAX_OUTPUT_BYTES", 1024 * 1024), // 1 MB

  // Request-size guards, so a huge paste cannot exhaust server memory.
  maxSourceBytes: envInt("CODESAIL_MAX_SOURCE_BYTES", 256 * 1024), // 256 KB
  maxInputBytes: envInt("CODESAIL_MAX_INPUT_BYTES", 1024 * 1024), //   1 MB

  // Resource limits for the compiler container. The compiler is our own
  // trusted program, so it gets more room than student code.
  compileLimits: { memory: "512m", cpus: "1.0", pidsLimit: "128", tmpfsSize: "64m" },

  // Resource limits for the student's program. These are deliberately tight.
  executeLimits: { memory: "128m", cpus: "0.5", pidsLimit: "64", tmpfsSize: "16m" },

  // uid:gid of the non-root user created in docker/cpp/Dockerfile.
  user: process.env.CODESAIL_CONTAINER_USER || "1000:1000",

  // Compiler flags. -std=gnu++17 is a safe, widely taught baseline.
  compilerFlags: ["-std=gnu++17", "-O2", "-pipe"],
};

/** Set CODESAIL_DEBUG=1 to print diagnostics to the server console. */
function debug(...args) {
  if (process.env.CODESAIL_DEBUG) console.error("[codesail]", ...args);
}

// -----------------------------------------------------------------------------
// 2. Small helpers
// -----------------------------------------------------------------------------

/**
 * Convert a host path into the form the Docker CLI expects for `-v`.
 * On Windows, `C:\Users\...` is accepted by Docker Desktop but forward slashes
 * are safer and work everywhere, so we normalise to `C:/Users/...`.
 */
function toDockerMountPath(hostPath) {
  return path.resolve(hostPath).split(path.sep).join("/");
}

/**
 * A bounded output collector.
 *
 * Output is counted and capped AS IT ARRIVES, not after buffering everything.
 * That is the whole point: a program printing in an infinite loop must not be
 * able to fill up the server's memory before we notice.
 */
function createOutputSink(capBytes, onOverflow) {
  const chunks = [];
  let bytes = 0;
  let overflowed = false;

  return {
    push(buffer) {
      if (overflowed) return; // already capped; drop everything further
      const room = capBytes - bytes;
      if (buffer.length <= room) {
        chunks.push(buffer);
        bytes += buffer.length;
        return;
      }
      if (room > 0) chunks.push(buffer.subarray(0, room));
      bytes = capBytes;
      overflowed = true;
      if (onOverflow) onOverflow();
    },
    get overflowed() {
      return overflowed;
    },
    text() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

/**
 * Remove the temporary workspace. Safe to call more than once (idempotent),
 * because several code paths may want to clean up.
 *
 * `maxRetries` matters on Windows, where a file can stay briefly locked after
 * the process that used it exits.
 */
async function cleanupWorkspace(workspace) {
  if (!workspace) return;
  try {
    await fs.promises.rm(workspace, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch (err) {
    // Never let a cleanup failure change the result the student sees.
    debug("workspace cleanup failed:", err.message);
  }
}

/**
 * Strip anything host-specific out of text that will be shown to a student.
 * The compiler only ever sees the in-container path, but Docker's own error
 * messages can mention the host folder, so we scrub it defensively.
 */
function sanitize(text, workspace) {
  if (!text) return "";
  let out = text;
  if (workspace) {
    for (const variant of [workspace, toDockerMountPath(workspace)]) {
      out = out.split(variant).join("<workspace>");
    }
  }
  // Compiler diagnostics say "/workspace/main.cpp:3:5: error: ..." - the
  // folder name is noise for a student, so show just "main.cpp:3:5: ...".
  return out.split("/workspace/").join("").split("/workspace").join("");
}

// -----------------------------------------------------------------------------
// 3. Recognising Docker's own failures
//
//    `docker run` returns the student program's exit code, which is what we
//    want. But when Docker itself fails it uses 125/126/127 and writes its own
//    message to stderr. We only treat those specific codes as infrastructure
//    problems, and only when the message also looks like Docker's, so a
//    student program that happens to `exit(125)` is still a runtime error.
// -----------------------------------------------------------------------------

const DOCKER_INFRA_EXIT_CODES = new Set([125, 126, 127]);

const DOCKER_INFRA_PATTERNS = [
  /cannot connect to the docker daemon/i,
  /error during connect/i,
  /failed to connect to the docker api/i,
  /is the docker daemon running/i,
  /error response from daemon/i,
  /unable to find image/i,
  /pull access denied/i,
  /no such image/i,
  /oci runtime (create|exec) failed/i,
  /docker: /i,
  /exec format error/i,
  /permission denied.*unknown/i,
];

function looksLikeDockerFailure(exitCode, stderr) {
  if (!DOCKER_INFRA_EXIT_CODES.has(exitCode)) return false;
  return DOCKER_INFRA_PATTERNS.some((pattern) => pattern.test(stderr || ""));
}

// -----------------------------------------------------------------------------
// 4. Running one container
//
//    This is the only place that talks to the Docker CLI, and the only place
//    that deals with timers, kills and stream limits. Everything above it just
//    reads the structured outcome it returns.
// -----------------------------------------------------------------------------

/**
 * Forcefully stop a container by name.
 *
 * This is the part a plain `child.kill()` cannot do. Killing the local
 * `docker run` process detaches the CLI but can leave the container running
 * inside the Docker engine, still burning CPU. `docker kill <name>` stops the
 * container itself. We use a unique name per container so we can only ever
 * kill the one belonging to this request.
 */
function killContainer(dockerBin, containerName) {
  // Plain Docker CLI probes (`docker version`) start no container, so they
  // pass no name. Never run `docker kill` without an exact name.
  if (!containerName) return;
  try {
    const killer = spawn(dockerBin, ["kill", containerName], {
      stdio: "ignore",
      windowsHide: true,
    });
    // If Docker is already gone there is nothing to kill; never crash on it.
    killer.on("error", (err) => debug("docker kill failed:", err.message));
  } catch (err) {
    debug("docker kill could not be spawned:", err.message);
  }
}

/**
 * Start a container and collect its result.
 *
 * Resolves exactly once with:
 *   {
 *     outcome:   "exit" | "timeout" | "output_limit" | "spawn_error",
 *     exitCode:  number | null,
 *     stdout:    string,
 *     stderr:    string,
 *     durationMs: number,
 *     spawnError: string | null
 *   }
 *
 * It never rejects: callers get a value for every possible ending.
 */
function runContainer({ dockerBin, dockerArgs, containerName, stdinData, timeoutMs, capBytes }) {
  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();

    // `settled` is the single guard that makes double-resolution impossible.
    let settled = false;
    let outcome = "exit"; // upgraded to "timeout" / "output_limit" if needed
    let timeoutTimer = null;
    let graceTimer = null;

    const finish = (fields) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(graceTimer);
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      resolve({
        outcome,
        exitCode: null,
        spawnError: null,
        stdout: stdout.text(),
        stderr: stderr.text(),
        durationMs: Math.round(durationMs),
        ...fields,
      });
    };

    /**
     * Called on timeout or output overflow.
     *
     * We do NOT resolve here. We record why we are stopping, kill the
     * container, and let the normal "close" handler resolve once the process
     * has really gone away - that way the temp folder is never deleted while
     * a container still has it mounted. `graceTimer` is the safety net in case
     * "close" never arrives.
     */
    const terminate = (reason) => {
      if (settled || outcome !== "exit") return;
      outcome = reason;
      debug(`terminating ${containerName}: ${reason}`);
      killContainer(dockerBin, containerName);
      try {
        child.stdin?.destroy();
      } catch {
        /* stdin may already be closed */
      }
      graceTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        finish({ exitCode: null });
      }, 4000);
      graceTimer.unref?.();
    };

    const stdout = createOutputSink(capBytes, () => terminate("output_limit"));
    const stderr = createOutputSink(capBytes, () => terminate("output_limit"));

    let child;
    try {
      // spawn() with an ARGUMENT ARRAY and no shell. Student code and student
      // input are never part of this array, and no shell ever parses them, so
      // there is nothing to escape and no command injection to worry about.
      child = spawn(dockerBin, dockerArgs, { windowsHide: true });
    } catch (err) {
      // Thrown synchronously only in unusual cases, but handle it anyway.
      finish({ outcome: "spawn_error", spawnError: err.message });
      return;
    }

    // The Docker CLI binary is missing, or the OS refused to start it.
    child.on("error", (err) => {
      outcome = "spawn_error";
      finish({ spawnError: err.message });
    });

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));

    // Feed standard input to the student's program, then close the stream so
    // that code doing `while (cin >> x)` reaches end-of-input and terminates.
    if (child.stdin) {
      // A program that exits without reading its input makes this pipe break.
      // That is normal, not an error, so swallow it.
      child.stdin.on("error", (err) => debug("stdin pipe:", err.message));
      if (stdinData && stdinData.length > 0) child.stdin.write(stdinData);
      child.stdin.end();
    }

    timeoutTimer = setTimeout(() => terminate("timeout"), timeoutMs);

    // The single normal resolution point.
    child.on("close", (exitCode, signal) => {
      finish({ exitCode, signal });
    });
  });
}

// -----------------------------------------------------------------------------
// 5. Is Docker usable?
//
//    Checking up front turns a confusing mid-pipeline failure into one clear
//    "execution service unavailable" answer. The successful result is cached
//    briefly so we do not pay for two extra processes on every single run.
// -----------------------------------------------------------------------------

const PROBE_CACHE_MS = envInt("CODESAIL_PROBE_CACHE_MS", 60000);
const probeCache = new Map(); // key -> { ok, detail, checkedAt }

/** Run a short Docker command and return { ok, stdout, stderr, spawnError }. */
function probeCommand(dockerBin, args) {
  return runContainer({
    dockerBin,
    dockerArgs: args,
    containerName: null, // a probe starts no container, so there is none to kill
    stdinData: "",
    timeoutMs: 15000,
    capBytes: 64 * 1024,
  });
}

async function checkDockerReady(dockerBin, image) {
  const key = `${dockerBin}::${image}`;
  const cached = probeCache.get(key);
  if (cached && cached.ok && Date.now() - cached.checkedAt < PROBE_CACHE_MS) {
    return cached;
  }

  // (a) Is the CLI present and is the daemon answering?
  const version = await probeCommand(dockerBin, ["version", "--format", "{{.Server.Version}}"]);
  if (version.outcome === "spawn_error") {
    return cache(key, false, `Docker CLI could not be started (${version.spawnError}).`);
  }
  if (version.outcome === "timeout") {
    return cache(key, false, "Docker did not respond (daemon may be starting).");
  }
  if (version.exitCode !== 0) {
    return cache(key, false, `Docker daemon is not reachable: ${version.stderr.trim()}`);
  }

  // (b) Has the execution image been built?
  const inspect = await probeCommand(dockerBin, ["image", "inspect", image]);
  if (inspect.exitCode !== 0) {
    return cache(
      key,
      false,
      `Execution image "${image}" is missing. Build it with: docker build -t ${image} ./docker/cpp`
    );
  }

  return cache(key, true, null);
}

function cache(key, ok, detail) {
  const entry = { ok, detail, checkedAt: Date.now() };
  probeCache.set(key, entry);
  return entry;
}

// -----------------------------------------------------------------------------
// 6. Building the `docker run` argument lists
// -----------------------------------------------------------------------------

/**
 * The hardening flags shared by both containers.
 *
 * --rm                        delete the container as soon as it exits
 * --name                      unique, so a timeout kills only THIS container
 * --network none              no internet, no LAN, no localhost
 * --memory / --memory-swap    hard memory cap, swap disabled (equal values)
 * --cpus                      fraction of one CPU core
 * --pids-limit                blocks fork bombs
 * --cap-drop ALL              removes every Linux capability
 * --security-opt no-new-privileges   setuid binaries cannot escalate
 * --read-only                 the container's own filesystem is immutable
 * --tmpfs /tmp                the one small writable scratch area, in RAM
 * --user                      runs as the non-root user from the Dockerfile
 * -v <workspace>:/workspace   ONLY the per-submission temp folder is visible
 *
 * Deliberately absent: the Docker socket, any host directory other than the
 * temp workspace, and any privileged flag.
 */
function baseRunArgs({ containerName, workspace, limits, readOnlyWorkspace }) {
  return [
    "run",
    "--rm",
    "--name",
    containerName,
    "--network",
    "none",
    "--memory",
    limits.memory,
    "--memory-swap",
    limits.memory, // same value as --memory => no swap at all
    "--cpus",
    limits.cpus,
    "--pids-limit",
    limits.pidsLimit,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    `/tmp:rw,nosuid,nodev,size=${limits.tmpfsSize}`,
    "--user",
    CONFIG.user,
    "-v",
    `${toDockerMountPath(workspace)}:/workspace${readOnlyWorkspace ? ":ro" : ""}`,
    "-w",
    "/workspace",
  ];
}

// -----------------------------------------------------------------------------
// 7. Request validation
// -----------------------------------------------------------------------------

function validateRequest(code, input, language) {
  if (typeof code !== "string") {
    return "Source code must be provided as a string.";
  }
  if (code.trim().length === 0) {
    return "Source code is empty. Please write some C++ code before running.";
  }
  const codeBytes = Buffer.byteLength(code, "utf8");
  if (codeBytes > CONFIG.maxSourceBytes) {
    return `Source code is too large (${codeBytes} bytes, limit ${CONFIG.maxSourceBytes}).`;
  }
  if (typeof input !== "string") {
    return "Standard input must be provided as a string.";
  }
  const inputBytes = Buffer.byteLength(input, "utf8");
  if (inputBytes > CONFIG.maxInputBytes) {
    return `Standard input is too large (${inputBytes} bytes, limit ${CONFIG.maxInputBytes}).`;
  }
  if (language !== "cpp") {
    return `Unsupported language "${language}". Only "cpp" is supported in this milestone.`;
  }
  return null;
}

// -----------------------------------------------------------------------------
// 8. The public function
// -----------------------------------------------------------------------------

/**
 * Compile and run a C++ program inside Docker.
 *
 * @param {string} code             The student's C++ source.
 * @param {string} [input]          Optional text piped to standard input.
 * @param {object} [options]
 * @param {string} [options.language="cpp"]  Rejected unless "cpp".
 * @param {number} [options.timeoutMs]       Overrides the execution timeout.
 * @param {number} [options.compileTimeoutMs]
 * @param {number} [options.maxOutputBytes]
 * @param {string} [options.image]           Overrides the Docker image.
 * @param {string} [options.dockerBin]       Overrides the Docker CLI path.
 *
 * @returns {Promise<object>} Always resolves (never rejects) with:
 *   {
 *     status: "success" | "compilation_error" | "runtime_error" | "timeout" |
 *             "output_limit_exceeded" | "invalid_input" | "execution_error",
 *     output: string,          // program stdout (or "" when not applicable)
 *     error: string | null,    // student-safe message, null on success
 *     exitCode: number | null,
 *     executionTime: number,   // ms spent in the execution container
 *     compileTime: number,     // ms spent in the compilation container
 *     phase: "validate" | "compile" | "execute"
 *   }
 *   `detail` is added for infrastructure failures. It is meant for server logs
 *   and operators, not for showing to students.
 */
async function runCpp(code, input = "", options = {}) {
  const dockerBin = options.dockerBin || CONFIG.dockerBin;
  const image = options.image || CONFIG.image;
  const language = options.language || "cpp";
  const executeTimeoutMs = options.timeoutMs || CONFIG.executeTimeoutMs;
  const compileTimeoutMs = options.compileTimeoutMs || CONFIG.compileTimeoutMs;
  const capBytes = options.maxOutputBytes || CONFIG.maxOutputBytes;

  // --- Step 1: validate -----------------------------------------------------
  // Done before any folder or container exists, so an invalid request costs
  // nothing and leaves nothing behind.
  const validationError = validateRequest(code, input, language);
  if (validationError) {
    return {
      status: "invalid_input",
      output: "",
      error: validationError,
      exitCode: null,
      executionTime: 0,
      compileTime: 0,
      phase: "validate",
    };
  }

  // --- Step 2: is the execution service available? --------------------------
  const readiness = await checkDockerReady(dockerBin, image);
  if (!readiness.ok) {
    debug("docker not ready:", readiness.detail);
    return {
      status: "execution_error",
      output: "",
      error: "Execution service unavailable",
      detail: readiness.detail, // for logs/operators
      exitCode: null,
      executionTime: 0,
      compileTime: 0,
      phase: "validate",
    };
  }

  // --- Step 3: unique temporary workspace -----------------------------------
  let workspace = null;
  try {
    workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codesail-"));
    await fs.promises.writeFile(path.join(workspace, "main.cpp"), code, "utf8");
  } catch (err) {
    await cleanupWorkspace(workspace);
    return {
      status: "execution_error",
      output: "",
      error: "Execution service unavailable",
      detail: `Could not prepare the workspace: ${err.message}`,
      exitCode: null,
      executionTime: 0,
      compileTime: 0,
      phase: "validate",
    };
  }

  // Every path below goes through `finally`, so the workspace is always
  // removed exactly once - on success, on failure, and on timeout.
  try {
    // --- Step 4: compile in a container -----------------------------------
    const compileContainer = `codesail-compile-${crypto.randomUUID()}`;
    const compile = await runContainer({
      dockerBin,
      containerName: compileContainer,
      dockerArgs: [
        ...baseRunArgs({
          containerName: compileContainer,
          workspace,
          limits: CONFIG.compileLimits,
          readOnlyWorkspace: false, // g++ must write the binary here
        }),
        image,
        "g++",
        ...CONFIG.compilerFlags,
        "-o",
        "main",
        "main.cpp",
      ],
      stdinData: "",
      timeoutMs: compileTimeoutMs,
      capBytes,
    });

    const compileTime = compile.durationMs;

    if (compile.outcome === "spawn_error") {
      return infraFailure(
        `Docker CLI could not be started: ${compile.spawnError}`,
        compileTime,
        "compile"
      );
    }
    if (compile.outcome === "timeout") {
      return {
        status: "timeout",
        output: "",
        error: `Compilation timed out after ${compileTimeoutMs} ms`,
        exitCode: null,
        executionTime: 0,
        compileTime,
        phase: "compile",
      };
    }
    if (compile.outcome === "output_limit") {
      return {
        status: "output_limit_exceeded",
        output: "",
        error: "Output limit exceeded (the compiler produced too many messages)",
        exitCode: null,
        executionTime: 0,
        compileTime,
        phase: "compile",
      };
    }
    if (compile.exitCode !== 0) {
      // Was this the compiler rejecting the code, or Docker itself failing?
      if (looksLikeDockerFailure(compile.exitCode, compile.stderr)) {
        return infraFailure(
          `Compilation container failed (exit ${compile.exitCode}): ${compile.stderr.trim()}`,
          compileTime,
          "compile"
        );
      }
      const diagnostics =
        sanitize(compile.stderr, workspace).trim() ||
        sanitize(compile.stdout, workspace).trim() ||
        "Compilation failed.";
      return {
        status: "compilation_error",
        output: "",
        error: diagnostics,
        exitCode: compile.exitCode,
        executionTime: 0,
        compileTime,
        phase: "compile",
      };
    }

    // --- Step 5: execute the compiled binary in a second container --------
    const execContainer = `codesail-exec-${crypto.randomUUID()}`;
    const run = await runContainer({
      dockerBin,
      containerName: execContainer,
      dockerArgs: [
        ...baseRunArgs({
          containerName: execContainer,
          workspace,
          limits: CONFIG.executeLimits,
          readOnlyWorkspace: false, // allow simple file I/O by student programs
        }),
        "-i", // keep stdin open so we can pipe the student's input in
        image,
        "./main",
      ],
      stdinData: input,
      timeoutMs: executeTimeoutMs,
      capBytes,
    });

    const executionTime = run.durationMs;

    if (run.outcome === "spawn_error") {
      return infraFailure(
        `Docker CLI could not be started: ${run.spawnError}`,
        compileTime,
        "execute",
        executionTime
      );
    }
    if (run.outcome === "timeout") {
      return {
        status: "timeout",
        output: "",
        error: "Execution timed out",
        exitCode: null,
        executionTime,
        compileTime,
        phase: "execute",
      };
    }
    if (run.outcome === "output_limit") {
      return {
        status: "output_limit_exceeded",
        output: "",
        error: "Output limit exceeded",
        exitCode: null,
        executionTime,
        compileTime,
        phase: "execute",
      };
    }
    if (looksLikeDockerFailure(run.exitCode, run.stderr)) {
      return infraFailure(
        `Execution container failed (exit ${run.exitCode}): ${run.stderr.trim()}`,
        compileTime,
        "execute",
        executionTime
      );
    }

    const programStdout = sanitize(run.stdout, workspace);
    const programStderr = sanitize(run.stderr, workspace);

    if (run.exitCode !== 0) {
      // Exit code 137 means the kernel killed the process with SIGKILL, which
      // for us almost always means it hit the 128 MB memory limit.
      const hint =
        run.exitCode === 137
          ? "Program was terminated (it most likely exceeded the memory limit)."
          : `Program exited with code ${run.exitCode}.`;
      return {
        status: "runtime_error",
        output: programStdout,
        error: programStderr.trim() || hint,
        exitCode: run.exitCode,
        executionTime,
        compileTime,
        phase: "execute",
      };
    }

    // --- Step 6: success ---------------------------------------------------
    return {
      status: "success",
      output: programStdout,
      error: null,
      exitCode: 0,
      executionTime,
      compileTime,
      phase: "execute",
    };
  } catch (err) {
    // A bug in this module must still produce a well-formed result.
    debug("unexpected runner error:", err);
    return infraFailure(`Unexpected runner error: ${err.message}`, 0, "execute");
  } finally {
    await cleanupWorkspace(workspace);
  }
}

/** Build the standard infrastructure-failure response. */
function infraFailure(detail, compileTime, phase, executionTime = 0) {
  return {
    status: "execution_error",
    output: "",
    error: "Execution service unavailable",
    detail,
    exitCode: null,
    executionTime,
    compileTime,
    phase,
  };
}

module.exports = {
  runCpp,
  // Exported for tests and for an HTTP layer later on.
  checkDockerReady,
  CONFIG,
};
