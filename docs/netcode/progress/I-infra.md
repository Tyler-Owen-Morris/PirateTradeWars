# I-infra progress (cards I1 arm64 / I3 single-instance)

Status log (newest last). Worktree branch: worktree-agent-a74296e132b27313a.

- Read-only AWS facts gathered: InstanceTypes option accepts t4g.small; SupportedArchitectures option exists (arm64/x86_64).
  Current: aws:autoscaling:launchconfiguration InstanceType=t3.micro, aws:ec2:instances InstanceTypes="t3.micro, t3.small",
  SupportedArchitectures=x86_64. ImageId option is NOT user-defined (platform default), so EB picks the arm64 AMI itself.
- I3 prepared: .platform/hooks/prebuild/01_fetch_origin_cert.sh (+confighooks copy), .platform/templates/https.conf.template,
  docs/infra/SINGLE_INSTANCE_CUTOVER.md. `nginx -t` passes in nginx:stable with dummy cert and with conf absent.
- I1 arm64 test: in progress (build in amd64 node:20 container into docker volume `ptwapp`, then run in --platform linux/arm64).
  Scripts in the agent scratchpad (build.sh, run.sh, wstest.mjs). Runtime native risk: vite (imported by server/vite.ts) -> rollup
  and esbuild platform binaries (optional deps), bufferutil (optional, ws falls back to JS).
- I1 RESULT: x64-built node_modules FAIL on arm64 (rollup: Cannot find module @rollup/rollup-linux-arm64-gnu, via vite import in server/vite.ts).
  Fix: deploy.yml step `npm install --os=linux --cpu=arm64` after build (adds arm64 binaries beside x64; npm 10.8.2/node 20).
  Re-test in linux/arm64 container (QEMU, tonistiigi/binfmt --install arm64): /api/health 200 {"status":"healthy"}; /game-ws connect -> "connected".
  bufferutil has no arm64 prebuild; it is optional and ws falls back to JS.
- DONE, committed.
