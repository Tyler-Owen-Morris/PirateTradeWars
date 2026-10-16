#!/bin/bash
# Fetch the Cloudflare Origin CA cert/key from SSM Parameter Store and enable nginx TLS on :443.
# Safe to ship while still behind the ALB: if the params or IAM permission are missing this
# removes any stale TLS conf and exits 0, so the deploy never fails and nginx never references a missing cert.
# See docs/infra/SINGLE_INSTANCE_CUTOVER.md. Identical copy lives in .platform/confighooks/prebuild/
# (runs on config-only updates); keep the two in sync.
CERT=/etc/pki/tls/certs/server.crt
KEY=/etc/pki/tls/certs/server.key
CONF=/etc/nginx/conf.d/https.conf
HERE="$(cd "$(dirname "$0")" && pwd)"
TMPL="$HERE/../../templates/https.conf.template"

disable() { rm -f "$CONF"; echo "origin-cert: $1; TLS listener disabled"; exit 0; }

# IMDSv2 only (IMDSv1 is disabled on this environment).
TOKEN=$(curl -s -m 3 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
REGION=$(curl -s -m 3 -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)
export AWS_DEFAULT_REGION="${REGION:-us-east-2}"

command -v aws >/dev/null 2>&1 || disable "aws cli missing"
[ -f "$TMPL" ] || disable "template not found at $TMPL"

TMPC=$(mktemp); TMPK=$(mktemp)
if aws ssm get-parameter --name /ptw/origin-cert --with-decryption --query Parameter.Value --output text > "$TMPC" 2>/dev/null \
   && aws ssm get-parameter --name /ptw/origin-key --with-decryption --query Parameter.Value --output text > "$TMPK" 2>/dev/null \
   && grep -q 'BEGIN CERTIFICATE' "$TMPC" && grep -q 'PRIVATE KEY' "$TMPK"; then
  install -m 644 -o root -g root "$TMPC" "$CERT"
  install -m 600 -o root -g root "$TMPK" "$KEY"
  rm -f "$TMPC" "$TMPK"
  cp "$TMPL" "$CONF"
  # Never leave a config that fails nginx -t (e.g. mismatched cert/key): drop it instead.
  if command -v nginx >/dev/null 2>&1 && ! nginx -t >/dev/null 2>&1; then
    rm -f "$CONF"
    echo "origin-cert: nginx -t failed with TLS conf; TLS listener disabled"
  else
    echo "origin-cert: installed cert and enabled :443"
  fi
  exit 0
fi
rm -f "$TMPC" "$TMPK"
disable "SSM params /ptw/origin-cert|key unavailable"
