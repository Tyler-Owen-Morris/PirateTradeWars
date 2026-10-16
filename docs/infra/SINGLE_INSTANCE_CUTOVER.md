# Single-instance cutover (drop the ALB, Cloudflare in front)

Goal: run `PirateTradeWarsEnv` as an Elastic Beanstalk **SingleInstance** environment (no ALB, saves about $23/mo)
with Cloudflare proxying the site and terminating public TLS. Cloudflare talks to the instance over HTTPS using a
**Cloudflare Origin CA certificate** that nginx on the instance serves (SSL mode **Full (strict)**).

Prerequisites (infra cards I1, I2 done first): netcode deployed, t4g.small applied, Cloudflare zone active and
proxying the ALB. Region for everything below: `us-east-2`. Account `835677831294`.

Verified facts (read-only, 2026-10-16):

| Thing | Value |
|---|---|
| EB env CNAME | `PirateTradeWarsEnv.eba-d8ragmnt.us-east-2.elasticbeanstalk.com` |
| Instance profile / role | `EC2InstanceProfile` / `EC2InstanceProfileRole` (managed: ECR, EC2, S3 full; **no SSM**) |
| Instance SG (EB default) | `sg-03f72d02eeb1a7433` (80 and 8080 from ALB SG, 22 from 0.0.0.0/0) |
| ALB SG | `sg-038cbad36a2a61020` |
| VPC | `vpc-054569f4a9174b06e` |
| App port | EB env var `PORT=8080`; the app reads `process.env.PORT` |
| ALB EIPs | 16.59.66.41 `eipalloc-04c3b6aa9ee354d1b`, 3.16.241.76 `eipalloc-0f76c579776e41aeb`, 3.20.92.222 `eipalloc-0d8129e3815e5927e` |
| Route 53 | zone `Z08294463XUHSUXHY5VS`; domain is NOT registered in Route 53 (nameservers are changed at the external registrar) |
| aws/ssm KMS key | `5f0dc6a5-84b7-49ac-8681-c5b2b70510a1` |

Note the EIPs show as associated to ENIs (`eni-092f5255b76c272d3`, `eni-00c86587827322eb8`, `eni-0379d69ce20ec7a05`); confirm
in step 9 they are free before release.

## How the repo side works (already in the repo)

- `.platform/hooks/prebuild/01_fetch_origin_cert.sh` (and the identical copy in `.platform/confighooks/prebuild/`) runs on
  every deploy and config update. It reads SSM SecureString `/ptw/origin-cert` and `/ptw/origin-key` with the instance
  role, writes `/etc/pki/tls/certs/server.crt|key`, and copies `.platform/templates/https.conf.template` to
  `/etc/nginx/conf.d/https.conf` (a `listen 443 ssl` server proxying to `127.0.0.1:8080` with WebSocket upgrade headers,
  `proxy_read_timeout 300s` in the location). If the params or the IAM permission are missing it deletes any stale conf and
  exits 0, and it also drops the conf if `nginx -t` fails. So it is harmless while the env is still behind the ALB.
- The template lives in `.platform/templates/`, not `.platform/nginx/conf.d/`, so EB never installs it without the cert.
- `nginx -t` was verified in `nginx:stable` with a dummy self-signed cert (and with the conf absent).
- `.github/workflows/deploy.yml` pins ASG min/max 1 (valid for SingleInstance) and does not set EnvironmentType.

## Ordered runbook

### 0. Generate the Origin CA cert (Theo, Cloudflare dashboard) - no downtime
SSL/TLS > Origin Server > Create Certificate. RSA 2048, hostnames `piratetradewars.com` and `*.piratetradewars.com`,
validity 15 years. Save the PEM certificate as `origin.pem` and the private key as `origin.key` (the key is shown once).
Keep them out of the repo. Rollback: delete the cert in Cloudflare (nothing depends on it yet).

### 1. Create SSM parameters - no downtime
```
aws ssm put-parameter --region us-east-2 --name /ptw/origin-cert --type SecureString --value file://origin.pem --overwrite
aws ssm put-parameter --region us-east-2 --name /ptw/origin-key  --type SecureString --value file://origin.key --overwrite
```
(Standard tier is fine: each value is under 4 KB.) Then delete the local `origin.key`/`origin.pem` copies.
Rollback: `aws ssm delete-parameter --region us-east-2 --name /ptw/origin-cert` (and `-key`).

### 2. Grant the instance role read access - no downtime
```
aws iam put-role-policy --role-name EC2InstanceProfileRole --policy-name ptw-origin-cert-read --policy-document '{
  "Version":"2012-10-17",
  "Statement":[
    {"Effect":"Allow","Action":"ssm:GetParameter","Resource":"arn:aws:ssm:us-east-2:835677831294:parameter/ptw/origin-*"},
    {"Effect":"Allow","Action":"kms:Decrypt","Resource":"arn:aws:kms:us-east-2:835677831294:key/5f0dc6a5-84b7-49ac-8681-c5b2b70510a1"}
  ]}'
```
Rollback: `aws iam delete-role-policy --role-name EC2InstanceProfileRole --policy-name ptw-origin-cert-read`.

### 3. Merge the repo change (hooks) - normal deploy downtime only
Merge this branch to `main` (a normal deploy; world resets as for any deploy). Once params and IAM exist, the hook
installs the cert and enables 443 on the still-ALB instance (harmless: nothing reaches 443 on the instance yet). Check
via SSH/SSM: `sudo nginx -t && ls -l /etc/nginx/conf.d/https.conf` and `/var/log/eb-hooks.log`.
Rollback: revert the commit (hook removed; stale `https.conf` is only removed when the hook runs, so also
`sudo rm /etc/nginx/conf.d/https.conf && sudo systemctl reload nginx` if you want it gone immediately).

### 4. Create the origin security group (Cloudflare only) - no downtime
EB's default single-instance SG opens port 80 to the world; use a custom SG instead so only Cloudflare can reach the box.
```
SG=$(aws ec2 create-security-group --region us-east-2 --vpc-id vpc-054569f4a9174b06e \
  --group-name ptw-cf-origin --description "PTW origin: 443 from Cloudflare only" --query GroupId --output text)
for c in $(curl -s https://www.cloudflare.com/ips-v4); do
  aws ec2 authorize-security-group-ingress --region us-east-2 --group-id $SG --protocol tcp --port 443 --cidr $c; done
for c in $(curl -s https://www.cloudflare.com/ips-v6); do
  aws ec2 authorize-security-group-ingress --region us-east-2 --group-id $SG --ip-permissions \
    "IpProtocol=tcp,FromPort=443,ToPort=443,Ipv6Ranges=[{CidrIpv6=$c}]"; done
```
(15 IPv4 + 7 IPv6 ranges at time of writing; well under the 60-rule limit. Re-check the lists occasionally.)
Optional: add 22 from your own IP only if you need SSH (otherwise use SSM Session Manager; the role would need
`AmazonSSMManagedInstanceCore`). Rollback: `aws ec2 delete-security-group --region us-east-2 --group-id $SG` (after step 5 rollback).

### 5. Switch the environment to SingleInstance - DOWNTIME about 5-10 min
EB supports changing `EnvironmentType` in place (it removes the ALB and its SG, adds an EB-managed EIP to the instance,
and replaces the instance). The world is in memory, so players are dropped on any instance replacement anyway.
Do not combine with a version change; run it as a pure configuration update:
```
aws elasticbeanstalk update-environment --region us-east-2 \
  --application-name PirateTradeWarsApp --environment-name PirateTradeWarsEnv \
  --option-settings \
    Namespace=aws:elasticbeanstalk:environment,OptionName=EnvironmentType,Value=SingleInstance \
    Namespace=aws:autoscaling:launchconfiguration,OptionName=SecurityGroups,Value=$SG \
    Namespace=aws:autoscaling:launchconfiguration,OptionName=DisableDefaultEC2SecurityGroup,Value=true \
  --options-to-remove \
    Namespace=aws:elasticbeanstalk:environment,OptionName=LoadBalancerType
aws elasticbeanstalk wait environment-updated --region us-east-2 --application-name PirateTradeWarsApp --environment-names PirateTradeWarsEnv
```
(Drop the `--options-to-remove` line if EB rejects it; `LoadBalancerType`/`LoadBalancerIsShared` are ignored for
SingleInstance. If `DisableDefaultEC2SecurityGroup` is rejected in the same call, apply the SG settings in a second call
first, then the type change.) The environment CNAME stays `PirateTradeWarsEnv.eba-d8ragmnt...`. The new instance runs the
prebuild hook, so the cert is installed during this step. The ALB disappears, so the ACM cert and the ALB's HTTPS become unused.

Alternative with near-zero downtime (not needed, shown for completeness): create a clone env of type SingleInstance from
a saved configuration, then `aws elasticbeanstalk swap-environment-cnames`. It costs a second instance temporarily and
loses world state at the swap anyway, so the in-place route is recommended.

Rollback: re-run update-environment with `EnvironmentType=LoadBalanced` and
`SecurityGroups=sg-03f72d02eeb1a7433` + `DisableDefaultEC2SecurityGroup=false`. EB builds a new ALB (about 10 min downtime;
new ALB gets new DNS name, and Cloudflare keeps pointing at the unchanged env CNAME).

### 6. Cloudflare settings - no downtime
- DNS: apex `piratetradewars.com` CNAME (flattened automatically at the apex) to
  `PirateTradeWarsEnv.eba-d8ragmnt.us-east-2.elasticbeanstalk.com`, **Proxied** (orange cloud). If I2 already used the env
  CNAME as origin, nothing changes. Optional `www` CNAME to the apex, proxied.
- SSL/TLS > Overview: **Full (strict)** (Origin CA cert is trusted by Cloudflare).
- Network: **WebSockets** On (default on). Also keep "Always Use HTTPS" on.
- Do not enable caching rules for `/game-ws` or `/api/*`.
Rollback: set SSL mode to Flexible/Full only as a short-term fix; for a full rollback revert step 5 first.

### 7. Verify - no downtime
```
curl -sS https://piratetradewars.com/api/health            # expect 200 via Cloudflare
curl -sS -o /dev/null -w '%{http_code}\n' http://<instance EIP>/ --max-time 5   # expect timeout (80 closed)
curl -sSk --resolve piratetradewars.com:443:<instance EIP> https://piratetradewars.com/api/health --max-time 5  # expect timeout (only CF may connect)
```
WebSocket: from a machine with the repo, run a one-off script that opens `wss://piratetradewars.com/game-ws`, sends
`{"type":"connect","name":"cutover","shipType":"sloop"}` and expects a `connected` message; hold it open 6+ minutes to
confirm the 300 s proxy timeout is not cutting idle sockets (the game sends pings; Cloudflare's own idle limit is 100 s
without traffic, which the ping cadence in `docs/netcode/PROTOCOL.md` must stay under). Then play one browser session.
Check `aws elasticbeanstalk describe-environments` for Health Green and run the deploy workflow once via
`workflow_dispatch` to confirm the pipeline still verifies `https://piratetradewars.com/api/health`.
If the origin is reachable but Cloudflare shows 525/526, the cert was not installed: check
`/var/log/eb-hooks.log` and `/etc/nginx/conf.d/https.conf` on the instance, fix, and redeploy or run
`aws elasticbeanstalk update-environment ... --option-settings Namespace=aws:elasticbeanstalk:application:environment,OptionName=DUMMY,Value=n`
to trigger the confighook.

### 8. Wait and watch - at least 24 h
Leave the Route 53 zone and EIPs in place until the site has run clean on Cloudflare + single instance.

### 9. Cleanup - no downtime
a. Release the ALB EIPs, only once unattached:
```
aws ec2 describe-addresses --region us-east-2 --query 'Addresses[].[PublicIp,AllocationId,AssociationId]' --output text
for a in eipalloc-04c3b6aa9ee354d1b eipalloc-0f76c579776e41aeb eipalloc-0d8129e3815e5927e; do
  aws ec2 release-address --region us-east-2 --allocation-id $a; done
```
Do NOT release the new EB-managed instance EIP (it belongs to the CloudFormation stack and is released with it). If an ALB EIP is
still associated, step 5 did not finish deleting the ALB: investigate, do not force-disassociate.
Rollback: none (released addresses cannot be recovered; the IPs are not referenced anywhere, DNS is Cloudflare).

b. Delete the Route 53 hosted zone `Z08294463XUHSUXHY5VS` **only after** the registrar's nameservers point to Cloudflare and
`dig NS piratetradewars.com +short` (from several resolvers) returns only Cloudflare nameservers. The domain is not registered in
Route 53, so the nameserver change is made at the external registrar. Delete the records first, then the zone
(`aws route53 delete-hosted-zone --id Z08294463XUHSUXHY5VS`; the zone costs $0.50/mo, so there is no rush).
Before deleting, export it for reference: `aws route53 list-resource-record-sets --hosted-zone-id Z08294463XUHSUXHY5VS > r53-zone-backup.json`.
Rollback: recreate the zone from the backup and point the registrar nameservers back.

c. Optionally delete the unused ACM certificate (attached to the removed ALB) and the `_367b...` validation record.

### Downtime summary

| Step | Downtime |
|---|---|
| 0, 1, 2, 4, 6, 7, 8, 9 | none |
| 3 (normal deploy) | the usual deploy blip (instance replace, a few minutes) |
| 5 (type change) | about 5-10 min, world resets |
| Rollback of 5 | about 10 min |

### Known risks
- Cloudflare Origin CA certs are trusted only by Cloudflare. Grey-clouding the record (DNS only) will show browsers a certificate error.
- A single instance has a public EIP; direct access is blocked by the SG, but keep the Cloudflare range list current.
- Hook runs as root during deploy and needs the `aws` CLI (present on AL2023 EB platform images).
- Cloudflare's 100 s idle proxy timeout applies to WebSockets without traffic; the game's 20 Hz snapshots and pings keep sockets active.
