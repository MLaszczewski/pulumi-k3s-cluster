import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import * as command from '@pulumi/command'
import { interpolate } from '@pulumi/pulumi'
import {Limits, resourceLimits} from "../lib/limits";

const config = new pulumi.Config()

interface EchoArgs {
  limits?: Limits,
  text: String
}

export class EchoExample extends pulumi.ComponentResource {
  constructor(name: string, args: EchoArgs, opts: pulumi.ComponentResourceOptions) {
    super('pkg:index:EchoStartSync', name, {}, opts)
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
            requests: { storage: args.limits?.storage ?? '200Mi' }
          }
        }
      },
      { ...opts, parent: this, dependsOn: [] }
    )
    this.registerOutputs({})
    //if(!args.started) return;
    const pod = new k8s.core.v1.Pod(
      name + ' pod',
      {
        metadata: {
          name,
          labels: {
            'echo': name
          }
        },
        spec: {
          restartPolicy: 'Always',
          containers: [
            {
              name: 'echo',
              image: 'hashicorp/http-echo:latest',
              imagePullPolicy: 'Always',
              //command: ['bash', '-c', 'sleep infinity'],
              ports: [
                {
                  containerPort: 3616,
                  name: 'sync',
                  protocol: 'TCP'
                },
              ],
              volumeMounts: [
                {
                  name: 'data',
                  mountPath: '/data'
                }
              ],
              resources: resourceLimits(args.limits, {
                cpu: '100m', memory: '100Mi',
                maxCpu: '1', maxMemory: '200Mi'
              }),
            }
          ],
          volumes: [
            {
              name: 'data',
              persistentVolumeClaim: {
                claimName: name
              }
            }
          ],
          nodeSelector: {
            'echo-sync': 'true'
          }
        }
      },
      { ...opts, parent: this, dependsOn: [] }
    )
    const svc = new k8s.core.v1.Service(
      name + ' svc',
      {
        metadata: {
          name: name,
          labels: {
            'echo': name
          }
        },
        spec: {
          ports: [
            {
              name: 'sync',
              port: 3616,
              targetPort: 'sync',
              protocol: 'TCP'
            },
            {
              name: 'http',
              port: 80,
              targetPort: 'sync',
              protocol: 'TCP'
            }
          ],
          selector: {
            'echo-start-sync': name
          }
        }
      },
      { ...opts, parent: this, dependsOn: [pod] }
    )
  }
}
