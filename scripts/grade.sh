#!/usr/bin/env bash
# usage: scripts/grade.sh <parallel jobs> <run dir>
# Grades every prediction in the run dir with the official SWE-bench harness; writes <key>.grade.json beside each.
set -euo pipefail
jobs=${1:?Pass the parallel job count, then the run dir}
run_dir=$(cd "${2:?Pass the run dir}" && pwd)
grade() {
    local prediction=$1 key run_id
    key=$(jq -er '.[0].model_name_or_path' "$prediction")
    # The harness names grading containers by instance and run id; parallel grades of one instance need distinct run ids.
    run_id="g-$(basename "$(dirname "$prediction")" | shasum | cut -c1-8)"
    cd "$(dirname "$prediction")"
    uv run --no-project --python 3.12 --with swebench==4.1.0 python -m swebench.harness.run_evaluation \
        --dataset_name princeton-nlp/SWE-bench_Verified --split test --instance_ids "$(jq -er '.[0].instance_id' "$prediction")" \
        --predictions_path "$(basename "$prediction")" --namespace swebench --max_workers 1 --run_id "$run_id" \
        --cache_level instance --clean false --timeout 300 >"$key.grade.log" 2>&1
    mv "$key.$run_id.json" "$key.grade.json"
    jq -e '(.completed_instances + .empty_patch_instances == 1) and .error_instances == 0' "$key.grade.json" >/dev/null ||
        { echo "grader error: $key" >&2; return 1; }
    echo "graded: $key"
}
export -f grade
find "$run_dir" -maxdepth 1 -name '*.predictions.json' -print0 | xargs -0 -P "$jobs" -I{} bash -c 'grade "$1"' _ {}
