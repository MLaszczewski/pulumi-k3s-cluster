import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

interface LetsEncryptArgs {
  dnsChallenge: boolean;
}

export class LetsEncrypt extends pulumi.ComponentResource {
  constructor(name: string, args: LetsEncryptArgs, opts: pulumi.ComponentResourceOptions) {
    super('pkg:index:LetsEncrypt', name, {}, opts)

    const certManagerCRDs = new k8s.yaml.ConfigFile("cert-manager-crds", {
      file: "https://github.com/cert-manager/cert-manager/releases/download/v1.10.1/cert-manager.crds.yaml"
    }, { parent: this, ...opts })
    const certManager = new k8s.helm.v3.Release("cert-manager", {
      chart: "cert-manager",
      namespace: 'cert-manager',
      createNamespace: true,
      repositoryOpts: {
        repo: "https://charts.jetstack.io",
      },
    }, {
      parent: this, dependsOn: [certManagerCRDs]
    })
    /*const certManager = new certmanager.CertManager("cert-manager", {
      installCRDs: true
    }, { dependsOn: [k3sCluster] })*/
    const certIssuer = new k8s.apiextensions.CustomResource("letsencrypt issuer", {
      apiVersion: "cert-manager.io/v1",
      kind: "ClusterIssuer",
      metadata: {
        name: "letsencrypt-prod",
        namespace: "cert-manager"
      },
      spec: {
        acme: {
          server: "https://acme-v02.api.letsencrypt.org/directory",
          email: "michal@laszczewski.pl",
          privateKeySecretRef: {
            name: "letsencrypt-prod"
          },
          solvers: [{
            http01: {
              ingress: {
                class: "traefik"
              }
            }
          }]
        }
      }
    }, { parent: this, dependsOn: [certManager] })

    this.registerOutputs({})
  }
}
