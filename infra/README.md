# infra/ (DEPRECATED, NOT DEPLOYED)

This CDK code is an abandoned attempt at a CodeDeploy/ASG setup. It is **not** what runs production.
Do NOT run `cdk deploy` here: `cdk deploy --all` would create a brand new VPC, ALB and ASG.

Production is the Elastic Beanstalk environment `PirateTradeWarsEnv` (application `PirateTradeWarsApp`,
us-east-2), deployed by `.github/workflows/deploy.yml` on every push to `main`. Beanstalk settings that
live in the repo are in `.ebextensions/` and `.platform/`.

## Leftover AWS resources from the abandoned setup (not touched, need cleanup by the owner)
- Stray Auto Scaling group `PirateTradeWarsASG` running a c7a.medium (`i-0bd5c19476416577d`)
- CloudFormation stack `PirateTradeWarsFrontendStack`
- S3 bucket `piratetradewars-deploy-bucket`
