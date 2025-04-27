#!/bin/bash
# Stop the existing application if running
if pm2 list | grep -q "server"; then
    pm2 stop server
    pm2 delete server
fi
# Remove previous application files
if [ -d "/home/ec2-user/piratetradewars" ]; then
    rm -rf /home/ec2-user/piratetradewars
fi