# Turning the game OFF and ON

Theo may say "turn the game off", "set the deployment to off", "park the site" (go to OFF), or "turn it back
on", "relaunch the game" (go to ON). This doc defines both states and the exact steps between them.
Planned 2026-10-16; **not executed yet**, so the first OFF run also builds the parked site (step 3).

**Current state: ON** (update this line, and the log at the bottom, every time you switch).

Both directions take a live, public site up or down. Confirm with Theo in the same conversation before
starting, even if he asked earlier.

## Fixed facts

| What | Value |
|---|---|
| AWS account / region | 835677831294 / us-east-2 (the CLI on Theo's desktop is logged in as `Tyler_Admin`) |
| EB application / environment | `PirateTradeWarsApp` / `PirateTradeWarsEnv` (LoadBalanced, ALB, t4g.small, ASG 1/1) |
| Platform | `64bit Amazon Linux 2023 v6.11.5 running Node.js 20` |
| Domain DNS | Route 53 hosted zone `Z08294463XUHSUXHY5VS` (piratetradewars.com). Registered elsewhere, not in Route 53 Domains. Only the apex `A` alias matters (no www record). |
| ALB HTTPS cert | ACM us-east-2 `arn:aws:acm:us-east-2:835677831294:certificate/73add82a-2aa2-4a1e-8eda-7424da554d03` (keep it; the saved template points at it) |
| Data | Upstash Redis (`REDIS_CONN_STRING`, also in Secrets Manager `piratetradewars/redis-prod`). Outside AWS; it is never touched by OFF/ON, so the leaderboard and players survive. |
| EB env vars | `REDIS_CONN_STRING`, `STRIPE_SECRET_KEY`, `STRIPE_*_PRICE_ID`, `VITE_STRIPE_PUBLISHABLE_KEY`, `SEGMENT_WRITE_KEY`, `PORT`, `DUMMY`. The values live only in the EB config; the saved template keeps them. Never print or commit them. |
| Saved config template | `ptw-on-state` (created by OFF step 1) |
| Route 53 alias zone ids | EB us-east-2: `Z14LCN19Q5QHIC`; CloudFront: `Z2FDTNDATAQYW2` |

## State ON (about $45-50/mo)

- Environment `PirateTradeWarsEnv` exists, Status Ready, Health Green, ASG MinSize=MaxSize=1.
- The apex `A` alias points to the environment's CNAME (zone `Z14LCN19Q5QHIC`).
- `https://piratetradewars.com/api/health` returns 200 and the game loads.
- `deploy.yml` deploys every push to `main` without `[skip ci]` (repo variable `GAME_OFF` unset or not `1`).
- Cost: instance ~$13, ALB ~$17, public IPv4 ~$15 (instance + the ALB's two addresses; the two Elastic IPs
  in us-east-2 are the ALB's ENIs and go away with it), plus disk, Route 53, the secret.

## State OFF (about $1/mo)

- No environment: no EC2 instance, no ALB, no public IPs, no EBS volume in us-east-2.
- The apex `A` alias points to a CloudFront distribution (zone `Z2FDTNDATAQYW2`) that serves a static
  "Pirate Trade Wars is docked for now" page from a private S3 bucket (`piratetradewars-parked`, via Origin
  Access Control), HTTPS with a free ACM cert in **us-east-1** for `piratetradewars.com`.
  403/404 map to `/index.html` with status 200, so every path (old links, `/api/...`) shows the page.
- Kept, so ON is one command: the EB application and its versions (zips in
  `s3://elasticbeanstalk-us-east-2-835677831294/`), template `ptw-on-state`, the us-east-2 ACM cert, the
  secret, the hosted zone, Upstash.
- Deploys are skipped: repo variable `GAME_OFF=1`, and the `deploy` job in `.github/workflows/deploy.yml` has
  `if: vars.GAME_OFF != '1'` (add that guard on the first OFF run; it is not in the workflow yet). The test
  job still runs.
- Remaining cost: hosted zone $0.50 + secret $0.40 + S3/CloudFront pennies (free tier). Plus the domain
  renewal at the registrar, which is outside AWS.

## Going OFF

1. **Save the config.** Get the environment id and save the template (delete an old `ptw-on-state` first):
   ```
   aws elasticbeanstalk describe-environments --environment-names PirateTradeWarsEnv --region us-east-2 --query "Environments[0].[EnvironmentId,VersionLabel]" --output text
   aws elasticbeanstalk delete-configuration-template --application-name PirateTradeWarsApp --template-name ptw-on-state --region us-east-2   # ok to fail if absent
   aws elasticbeanstalk create-configuration-template --application-name PirateTradeWarsApp --template-name ptw-on-state --environment-id <EnvironmentId> --region us-east-2
   ```
   Check it with `describe-configuration-settings --template-name ptw-on-state`: it must hold the env var
   names above, `InstanceType t4g.small`, ASG 1/1, the 443 listener cert, IdleTimeout 300, health path
   `/api/health`. Write the version label into the log below.
2. **Disable deploys.** First time only: add `if: vars.GAME_OFF != '1'` to the `deploy` job. Then
   `gh variable set GAME_OFF --body 1`. Commit with `[skip ci]`.
3. **Parked site.** First time only, create and keep it forever (it costs ~0 idle):
   - `docs/infra/parked/index.html`: one self-contained page (no external assets), saying the game is
     docked for now and will be back. Commit it.
   - S3 bucket `piratetradewars-parked` (private, block public access), upload `index.html`.
   - ACM cert in us-east-1 for `piratetradewars.com`, DNS-validated: add the CNAME it asks for to the hosted
     zone and wait for ISSUED.
   - CloudFront distribution: S3 origin with OAC (bucket policy allows only this distribution), default root
     `index.html`, alternate name `piratetradewars.com` with that cert, custom errors 403 and 404 →
     `/index.html` with status 200, PriceClass_100.
   - Check that `https://<id>.cloudfront.net/` shows the page before touching DNS.

   Later times: re-upload `index.html` if it changed and invalidate `/*`.
4. **Flip DNS** with `aws route53 change-resource-record-sets` (UPSERT the apex `A` alias:
   `HostedZoneId Z2FDTNDATAQYW2`, `DNSName <id>.cloudfront.net.`, `EvaluateTargetHealth false`). Wait
   for INSYNC, then check `https://piratetradewars.com` shows the parked page. The TTL is 60 s.
5. **Terminate:** `aws elasticbeanstalk terminate-environment --environment-name PirateTradeWarsEnv --region us-east-2`,
   then wait until Status is Terminated (about 5-10 min).
6. **Verify nothing is left billing** in us-east-2: `describe-instances` (no PirateTradeWarsEnv),
   `elbv2 describe-load-balancers` (none `awseb-*`), `ec2 describe-addresses` (none), `ec2 describe-volumes`
   (none `available`). Release or delete anything left over.
7. Set "Current state: OFF", add a log line, commit + push with `[skip ci]`. Tell Theo.

## Going ON

1. **Create the environment from the template** with the version label in the log (the last one deployed):
   ```
   aws elasticbeanstalk create-environment --application-name PirateTradeWarsApp --environment-name PirateTradeWarsEnv --template-name ptw-on-state --version-label <label> --region us-east-2
   aws elasticbeanstalk wait environment-updated --application-name PirateTradeWarsApp --environment-names PirateTradeWarsEnv --region us-east-2
   ```
   If the name is still reserved right after an OFF, wait a few minutes and retry. Expect 10-15 min.
2. Check Status Ready and Health Green, then `curl -fsS http://<new CNAME>/api/health`. The CNAME changes on
   every re-create, so DNS must be flipped.
3. **Flip DNS back**: UPSERT the apex `A` alias with `HostedZoneId Z14LCN19Q5QHIC`,
   `DNSName <new CNAME>.`, `EvaluateTargetHealth true`. Wait for INSYNC, then check
   `https://piratetradewars.com/api/health` returns 200 and the game loads and connects.
4. **Re-enable deploys:** `gh variable delete GAME_OFF`. If `main` has commits newer than the running label,
   ask Theo before deploying them (`gh workflow run deploy.yml`, or his next push).
5. Leave the CloudFront distribution, bucket and us-east-1 cert in place for the next OFF.
6. Set "Current state: ON", add a log line, commit + push with `[skip ci]`. Tell Theo.

## Log

| Date | Change | Version label | By |
|---|---|---|---|
| 2026-10-16 | Doc written; state ON. Running label `8d3388eb5ccbbc455f021fa78ab06d741e6041e9` before the NPC-halving deploy. | 8d3388e... | Claude |
