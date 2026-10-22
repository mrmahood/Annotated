#!/usr/bin/env bash
# Model-check the hosted-media dispatcher, lease, and retry path.
# Sequential on purpose: parallel TLC runs race on the standard-module cache.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="1.7.4"
JAR_URL="https://github.com/tlaplus/tlaplus/releases/download/v${VERSION}/tla2tools.jar"
JAR_SHA256="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
CACHE="${TMPDIR:-/tmp}/annotated-tlc"
JAR="${CACHE}/tla2tools-${VERSION}.jar"
LOG_DIR="${CACHE}/logs"

if ! command -v java >/dev/null 2>&1; then
  echo "Java is required to run TLC. Install a JRE 11 or newer and retry." >&2
  exit 1
fi

mkdir -p "${CACHE}" "${LOG_DIR}"
if [[ ! -f "${JAR}" ]] || ! printf '%s  %s\n' "${JAR_SHA256}" "${JAR}" | sha256sum -c - >/dev/null 2>&1; then
  curl -fsSL -o "${JAR}.partial" "${JAR_URL}"
  printf '%s  %s\n' "${JAR_SHA256}" "${JAR}.partial" | sha256sum -c -
  mv "${JAR}.partial" "${JAR}"
fi

run_one() {
  local name="$1"
  local cfg="$2"
  local expect="$3"
  local log="${LOG_DIR}/${name}.log"
  local meta="${CACHE}/meta-${name}"
  rm -rf "${meta}"
  set +e
  java -XX:+UseParallelGC -Xmx2g -jar "${JAR}" \
    -workers 2 -cleanup -difftrace \
    -config "${ROOT}/${cfg}" \
    -metadir "${meta}" \
    "${ROOT}/MediaJobLifecycle.tla" >"${log}" 2>&1
  local status=$?
  set -e
  local states="unknown"
  local generated="unknown"
  local summary
  summary="$(grep -E '^[0-9]+ states generated, [0-9]+ distinct states found' "${log}" | tail -1 || true)"
  if [[ -n "${summary}" ]]; then
    generated="$(printf '%s\n' "${summary}" | sed -E 's/^([0-9]+) states generated.*/\1/')"
    states="$(printf '%s\n' "${summary}" | sed -E 's/.* ([0-9]+) distinct states found.*/\1/')"
  fi
  local result="error"
  if grep -q 'No error has been found' "${log}"; then
    result="pass"
  elif grep -q 'Error:' "${log}"; then
    result="counterexample"
  fi
  printf '%s\t%s\t%s\tgenerated=%s\tdistinct=%s\texit=%s\tlog=%s\n' \
    "${name}" "${result}" "${expect}" "${generated}" "${states}" "${status}" "${log}"
  if [[ "${result}" != "${expect}" ]]; then
    echo "Unexpected ${name}: expected ${expect}, got ${result}. See ${log}" >&2
    return 1
  fi
  return 0
}

echo "java: $(java -version 2>&1 | head -1)"
echo "tlc: ${VERSION} ${JAR_SHA256}"
echo

fail=0
run_one real-mutex MediaJobLifecycle.cfg pass || fail=1
run_one real-termination MediaJobLifecycleTermination.cfg pass || fail=1
run_one mutant-skip-lease MutantSkipLease.cfg counterexample || fail=1
run_one mutant-no-increment MutantNoIncrement.cfg counterexample || fail=1

echo
if [[ "${fail}" -ne 0 ]]; then
  echo "tlc: failed"
  exit 1
fi
echo "recorded result: mutual exclusion passes; termination passes; both mutants are caught"
echo "exit 0 means mutual exclusion passes, termination passes, and both mutants are caught."
exit 0
