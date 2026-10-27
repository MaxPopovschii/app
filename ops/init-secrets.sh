#!/bin/sh
set -eu
copy() { mkdir -p "/out/$1"; cp "/input/$2" "/out/$1/$2"; chown "$3:$3" "/out/$1" "/out/$1/$2"; chmod 750 "/out/$1"; chmod 440 "/out/$1/$2"; }
for name in mongo_uri rabbit_url auth_secret metrics_token; do copy api "$name" 1000; done
for name in mongo_uri rabbit_url fetcher_token; do copy worker "$name" 1000; done
copy fetcher fetcher_token 1000
for name in mongo_root_password mongo_app_password mongo_init_uri mongo_backup_config mongo_key; do copy mongo "$name" 999; done
chmod 400 /out/mongo/mongo_key
copy monitor metrics_token 65534
copy rabbit rabbit_password 999
