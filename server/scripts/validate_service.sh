#!/bin/bash
# Check if the application is running by querying the health endpoint
if curl -f http://localhost:443/health; then
    exit 0
else
    exit 1
fi