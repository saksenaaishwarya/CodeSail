# CodeSail - C++ execution image
#
# Purpose
#   A small, reusable image that contains the GNU C++ compiler. CodeSail builds
#   this image ONCE (see README) and then starts a fresh, disposable container
#   for every student submission. The image itself never contains student code.
#
# Why gcc:14
#   It is an official Linux image that already ships g++ 14, so students get a
#   modern, standards-compliant compiler without us installing anything.

FROM gcc:14

# ---------------------------------------------------------------------------
# A dedicated non-root user.
#
# Student code must never run as root, even inside a container. We create a
# normal user (uid/gid 1000) and the runner starts every container with
# `--user 1000:1000`. uid 1000 is used because Docker Desktop bind mounts make
# the mounted workspace writable for it, so g++ can still write the compiled
# binary into the mounted folder.
# ---------------------------------------------------------------------------
RUN groupadd --gid 1000 coderunner \
    && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash coderunner

# The runner always bind-mounts the per-submission temporary folder here.
WORKDIR /workspace

# /workspace is created by the Dockerfile so it exists (and is owned by the
# execution user) even if someone starts the image without a bind mount.
RUN chown coderunner:coderunner /workspace

USER coderunner

# No default program: the runner always supplies the exact command to run
# (either `g++ ...` or `./main`). `bash` is only a convenience for debugging.
CMD ["bash"]
