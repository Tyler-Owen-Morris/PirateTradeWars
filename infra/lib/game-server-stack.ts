import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as iam from 'aws-cdk-lib/aws-iam';

export class PirateTradeWarsGameServerStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const vpc = new ec2.Vpc(this, 'PirateTradeWarsGameVpc', { maxAzs: 2 });

        const alb = new elbv2.ApplicationLoadBalancer(this, 'PirateTradeWarsAlb', {
            vpc,
            internetFacing: true,
        });

        const listener = alb.addListener('PirateTradeWarsListener', {
            port: 443,
            protocol: elbv2.ApplicationProtocol.HTTPS,
            certificates: [
                elbv2.ListenerCertificate.fromArn('arn:aws:acm:us-east-2:835677831294:certificate/73add82a-2aa2-4a1e-8eda-7424da554d03'),// Add ARN of ACM certificate for piratetradewars.com
            ],
            defaultAction: elbv2.ListenerAction.fixedResponse(404, {
                contentType: 'text/plain',
                messageBody: 'Not Found'
            })
        });

        const targetGroup = new elbv2.ApplicationTargetGroup(this, 'PirateTradeWarsTargetGroup', {
            vpc,
            port: 443,
            protocol: elbv2.ApplicationProtocol.HTTPS,
            targetType: elbv2.TargetType.INSTANCE,
            healthCheck: {
                path: '/health',
                protocol: elbv2.Protocol.HTTPS,
            },
        });

        listener.addTargetGroups('PirateTradeWarsGameTarget', {
            targetGroups: [targetGroup],
            priority: 1,
            conditions: [
                elbv2.ListenerCondition.pathPatterns(['/server-*']),
            ],
        });

        const asg = new autoscaling.AutoScalingGroup(this, 'PirateTradeWarsGameAsg', {
            vpc,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
            machineImage: ec2.MachineImage.latestAmazonLinux2(),
            minCapacity: 0,
            maxCapacity: 10,
            desiredCapacity: 0,
            userData: ec2.UserData.custom(`
        #!/bin/bash
        UPSTASH_REDIS_URL=$(aws secretsmanager get-secret-value --secret-id piratetradewars-upstash-redis-url --query SecretString --output text --region us-east-2)
        echo "UPSTASH_REDIS_URL=$UPSTASH_REDIS_URL" >> /etc/environment
        yum install -y nodejs
        npm install -g pm2
        cd /home/ec2-user
        aws s3 cp s3://piratetradewars-deploy-bucket/backend.zip .
        unzip backend.zip
        npm install
        pm2 start server/index.js
      `),
        });

        // Add tag for CodeDeploy
        cdk.Tags.of(asg).add('App', 'PirateTradeWars');

        asg.role.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName('AWSSecretsManagerReadWrite')
        );

        targetGroup.addTarget(asg);

        const coordinator = new ec2.Instance(this, 'PirateTradeWarsCoordinator', {
            vpc,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
            machineImage: ec2.MachineImage.latestAmazonLinux2(),
        });

        coordinator.role.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName('AutoScalingFullAccess')
        );

        new cdk.CfnOutput(this, 'PirateTradeWarsAlbDnsName', {
            value: alb.loadBalancerDnsName,
        });
    }
}