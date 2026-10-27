#!/bin/sh
set -eu
export RABBITMQ_DEFAULT_USER=launchcheck
export RABBITMQ_DEFAULT_PASS="$(cat /run/launchcheck/rabbit_password)"
exec docker-entrypoint.sh rabbitmq-server
