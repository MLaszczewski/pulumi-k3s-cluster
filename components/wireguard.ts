import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import * as command from '@pulumi/command'
import { interpolate } from '@pulumi/pulumi'

interface WireguardArgs {
  peersCount?: number
}

export class Wireguard extends pulumi.ComponentResource {
  constructor(name: string, config: WireguardArgs, opts: pulumi.ComponentResourceOptions) {
    super('pkg:index:Wireguard', name, {}, opts)

    const peersCount = config.peersCount ?? 2

    const namespace = new k8s.core.v1.Namespace(
      name + ' namespace',
      {
        metadata: {
          name,
          labels: { name }
        }
      },
      { ...opts, parent: this }
    )
    const configmap = new k8s.core.v1.ConfigMap(
      name + ' configmap',
      {
        metadata: {
          name,
          namespace: name
        },
        data: {
          PUID: '1000',
          PGID: '1000',
          TZ: 'Etc/GMT',
          SERVERPORT: '31820',
          PEERS: '' + peersCount,
          PEERDNS: '10.43.0.10',
          ALLOWEDIPS: '0.0.0.0/0, ::/0',
          INTERNAL_SUBNET: '10.23.23.0'
        }
      },
      { ...opts, parent: this, dependsOn: [namespace] }
    )
    const pvc = new k8s.core.v1.PersistentVolumeClaim(
      name + ' pvc',
      {
        metadata: {
          name,
          namespace: name
        },
        spec: {
          storageClassName: 'local-path',
          accessModes: ['ReadWriteOnce'],
          resources: {
            requests: { storage: '10Mi' }
          }
        }
      },
      { ...opts, parent: this, dependsOn: [namespace] }
    )
    const pod = new k8s.core.v1.Pod(
      name + ' pod',
      {
        metadata: {
          name,
          namespace: name,
          labels: {
            app: name
          }
        },
        spec: {
          containers: [
            {
              name,
              image: 'ghcr.io/linuxserver/wireguard',
              envFrom: [
                {
                  configMapRef: { name }
                }
              ],
              securityContext: {
                capabilities: {
                  add: ['NET_ADMIN', 'SYS_MODULE']
                }
              },
              volumeMounts: [
                {
                  name: 'config',
                  mountPath: '/config'
                },
                {
                  name: 'libmodules',
                  mountPath: '/lib/modules'
                }
              ],
              ports: [
                {
                  name: 'wireguard',
                  containerPort: 51820,
                  protocol: 'UDP'
                }
              ],
              resources: {
                requests: {
                  memory: '64Mi',
                  cpu: '100m'
                },
                limits: {
                  memory: '128Mi',
                  cpu: '250m'
                }
              }
            }
          ],
          volumes: [
            {
              name: 'config',
              persistentVolumeClaim: { claimName: name }
            },
            {
              name: 'libmodules',
              hostPath: { path: '/lib/modules' }
            }
          ],
          nodeSelector: {
            wireguard: 'true'
          }
        }
      },
      { ...opts, parent: this, dependsOn: [namespace, configmap] }
    )
    const service = new k8s.core.v1.Service(
      name + ' service',
      {
        metadata: {
          name,
          namespace: name,
          labels: {
            app: name
          }
        },
        spec: {
          type: 'NodePort',
          selector: {
            app: name
          },
          ports: [
            {
              port: 51820,
              targetPort: 'wireguard',
              protocol: 'UDP',
              nodePort: 31820
            }
          ]
        }
      },
      { ...opts, parent: this, dependsOn: [namespace, configmap, pod] }
    )
    const podReady = new command.local.Command(
      name + ' pods ready',
      {
        create: interpolate`kubectl -n ${name} wait --for=condition=Ready pod ${name} --timeout=60s; sleep 3`,
        delete: interpolate`echo ok`
      },
      {
        ...opts,
        parent: this,
        dependsOn: [pod, service]
      }
    )

    for (let i = 1; i <= peersCount; i++) {
      const peer = new command.local.Command(
        name + ` download wg-peer${i}.conf`,
        {
          create: interpolate`kubectl -n ${name} exec ${name} -- cat /config/peer${i}/peer${i}.conf > output/wg-peer${i}.conf`,
          delete: interpolate`rm output/wg-peer${i}.conf`
        },
        {
          parent: this,
          dependsOn: [podReady]
        }
      )
    }

    this.registerOutputs({})
  }
}
