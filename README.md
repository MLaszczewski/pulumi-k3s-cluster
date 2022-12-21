Minimal k3s cluster configuration with basic services
===

Features
---

- K3Sup with single master
- Traefik ingress controller
- CertManager with letsencrypt
- KontDNS with dns entry resource for pulumi
- Example service and ingress

How to use
---

1. Clone this repository

2. Run `npm install' to install dependencies.

3. Set KUBE_CONFIG environment variable

```bash
export KUBE_CONFIG=./kubeconfig
```

2. Setup pulumi passphrase to avoid writing it every time (optional)

```bash
export PULUMI_CONFIG_PASSPHRASE=
```

3. Run `pulumi stack` and create new stack.

4. Add your instances addresses in `clusterConfig.json`

5. Modify configure.sh to match your needs

6. Run `./configure.sh` to configure your cluster

7. Run `pulumi up --yes` to start basic cluster

8. Modify code configuration as needed.

9. Run `pulumi preview` to verify effects of your changes.

10. Run `pulumi up --yes` to apply changes.

11. Run `pulumi down --yes` to destroy cluster.

TODO
---

- Add letsencrypt dns challenge
- Add multi-master support
- Add postgresql cluster
- Add backups with velero and restic
