#!/bin/bash

set -e

CLUSTER="`cat clusterConfig.json`"

pulumi config set cluster "$CLUSTER"
pulumi config set domain "example.com"
pulumi config set name-servers '["ns1.example.com", "ns2.example.com"]'
pulumi config set letsenctrypt-email "admin@example.com"
pulumi config set flannel-backend "vxlan" # wireguard-native supported

if [[ ! -e secrets/postgres-password.txt ]]; then
    mkdir -p secrets
    xkcdpass --delimiter='23' > secrets/postgres-password.txt
    POSTGRES_PASSWORD="`cat secrets/postgres-password.txt`"
    echo "Generated new postgres password: $POSTGRES_PASSWORD"
fi

echo Cluster config:
pulumi config get cluster
