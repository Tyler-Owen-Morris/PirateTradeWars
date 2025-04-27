#!/bin/bash
cd /home/ec2-user/piratetradewars
# Start the application with PM2
pm2 start server/index.js --name server