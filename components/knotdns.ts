import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import * as command from '@pulumi/command'
import { interpolate } from '@pulumi/pulumi'

interface KnotDnsArgs {
}

export class KnotDns extends pulumi.ComponentResource {
  constructor(name: string, args: KnotDnsArgs, opts: pulumi.ComponentResourceOptions) {
    super('pkg:index:KnotDns', name, {}, opts)

    const configmap = new k8s.core.v1.ConfigMap(name + ' configmap', {
      metadata: {
        name: name + '-configmap',
      },
      data: {
        'knot.conf': [
          `server:`,
          `    listen: 0.0.0.0@53`,
          `    listen: ::@53`,
          `log:`,
          `  - target: stdout`,
          `    any: info`,
        ].join('\n')
      }
    }, { ...opts, parent: this })
    const pvc = new k8s.core.v1.PersistentVolumeClaim(
      name + ' pvc',
      {
        metadata: {
          name
        },
        spec: {
          storageClassName: 'local-path',
          accessModes: ['ReadWriteOnce'],
          resources: {
            requests: { storage: '200Mi' }
          }
        }
      },
      { ...opts, parent: this, dependsOn: [] }
    )
    const pod = new k8s.core.v1.Pod(
      name + ' pod',
      {
        metadata: {
          name,
          labels: {
            app: name
          }
        },
        spec: {
          containers: [
            {
              name,
              image: 'cznic/knot:v3.2.3',
              command: ['knotd', '-c', '/config/knot.conf'],
              volumeMounts: [
                {
                  name: 'config',
                  mountPath: '/config'
                },
                {
                  name: 'storage',
                  mountPath: '/storage'
                }
              ],
              ports: [
                {
                  name: 'dns',
                  containerPort: 53,
                  protocol: 'UDP'
                }
              ],
              resources: {
                requests: {
                  memory: '128Mi',
                  cpu: '100m'
                },
                limits: {
                  memory: '256Mi',
                  cpu: '2'
                }
              }
            }
          ],
          volumes: [
            {
              name: 'storage',
              persistentVolumeClaim: {claimName: name}
            },
            {
              name: 'config',
              configMap: {name: name + '-configmap'}
            }
          ],
          nodeSelector: {
            knotdns: 'true'
          }
        }
      },
      {...opts, parent: this, dependsOn: [configmap]}
    )
    const service = new k8s.core.v1.Service(
      name + ' service',
      {
        metadata: {
          name,
          labels: {
            app: name
          }
        },
        spec: {
          type: 'LoadBalancer',
          selector: {
            app: name
          },
          ports: [
            {
              port: 53,
              targetPort: 'dns',
              protocol: 'UDP',
              //nodePort: 53
            }
          ]
        }
      },
      { ...opts, parent: this, dependsOn: [pod] }
    )

    this.registerOutputs({})
  }
}

type KnotDnsZoneEntry = string

interface KnotDnsZoneArgs {
  name: string,
  entries: KnotDnsZoneEntry[]
}

function addZoneCommands(name: string, entries: KnotDnsZoneEntry[]):string[] {
  return [
    `conf-begin`,
    `conf-set 'zone[${name}]'`,
    `conf-set 'zone[${name}].dnssec-signing' 'on'`,
    `conf-commit`, `conf-begin`, `conf-abort`,
    `zone-begin ${name}`,
    ...(entries.map(entry => `zone-set ${name} ${entry}`)),
    `zone-commit ${name}`, `zone-begin ${name}`, `zone-abort ${name}`
  ]
}

function removeZoneCommands(name: string):string[] {
  return [
    `conf-begin`,
    `conf-unset 'zone[${name}]'`,
    `conf-commit`, `conf-begin`, `conf-abort`
  ]
}

function knotcCommand(commands: string[]) {
  return `printf "${commands.join('\\n').replace(/"/, '""')}" `
    + `| kubectl exec --stdin knotdns -- knotc`
}
/*
zone-begin chaosu.pl\nzone-set chaosu.pl @ 7200 SOA ns hostmaster 1 86400 900 691200 3600\nzone-set chaosu.pl @ 3600 A 137.74.93.199\nzone-commit chaosu.pl\nzone-abort chaosu.pl
*/


export class KnotDnsZone extends pulumi.ComponentResource {
  constructor(name: string, args: KnotDnsZoneArgs, opts: pulumi.ComponentResourceOptions) {
    super('pkg:index:KnotDnsZone', name, {}, opts)
    //console.log("CREATE", knotcCommand(addZoneCommands(args.name, args.entries)))
    //console.log("DELETE", knotcCommand(removeZoneCommands(args.name)))
    new command.local.Command(
      `setup knotdns zone ${name}`,
      {
        create: knotcCommand(addZoneCommands(args.name, args.entries)),
        delete: knotcCommand(removeZoneCommands(args.name)),
      },
      { ...opts, parent: this }
    )
    this.registerOutputs({})
  }
}
