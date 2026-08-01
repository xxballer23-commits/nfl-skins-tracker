#!/bin/sh
# Runs the test suites with jsc, the JavaScript engine bundled with macOS,
# so nothing has to be installed. Falls back to node if it is available.
set -e
cd "$(dirname "$0")/.."

JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc

if [ -x "$JSC" ]; then
  RUN="$JSC -m"
elif command -v node >/dev/null 2>&1; then
  RUN="node"
else
  echo "Need either macOS jsc or node to run the tests." >&2
  exit 1
fi

$RUN test/scoring.test.mjs
$RUN test/validate.mjs
