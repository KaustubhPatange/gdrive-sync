#!/bin/sh
cd /app && node /app/index.js
# set -e
#
# # Setup cron job
# echo "0 2 * * * cd /app && node /app/index.js >> /var/log/cron.log 2>&1" > /etc/crontabs/root
#
# # Start crond in background
# crond -b -l 8
#
# # Output logs
# tail -f /var/log/cron.log
