import * as command from "@pulumi/command"
import {interpolate} from "@pulumi/pulumi"
import * as pulumi from "@pulumi/pulumi"
import * as k8s from "@pulumi/kubernetes"
import * as fs from "fs"
import {parseHost, parseHostsList} from "../lib/hosts"

const config = new pulumi.Config()

const k3sVersion = config.get<string>('k3sVersion') ?? 'v1.25.4+k3s1'

const privKey = config.get<string>("sshKey") ?? '~/.ssh/id_rsa'
const kubeContext = config.get<string>('kubeContext') ?? 'default'
const flannelBackend = config.get<string>('flannel-backend') ?? 'vxlan'

function nodeNetworkConfig(node: NodeConfig) {
  const connection = parseHost(node.address)
  return [
    ...(flannelBackend === 'vxlan' && node.iface ? [
      `--flannel-iface ${node.iface}`,
      `--advertise-address ${connection.host}`,
      `--node-ip ${connection.host}`,
      `--node-external-ip ${connection.host}`,
    ] : []),
    ...(node.master ? [`--flannel-backend ${flannelBackend}`] : []),
  ].join(" \\\n")
}

export function installSingleMaster(master: NodeConfig, options: Object) {
  const connection = parseHost(master.address)
  return new command.local.Command(
    `install k3s master on ${connection.host}`,
    {
      create: interpolate`
      k3sup install \\
        --ip "${connection.host}" \\
        --user "${connection.user}" \\
        --ssh-key "${privKey}" \\
        --k3s-extra-args "${nodeNetworkConfig(master)}" \\
        --k3s-version ${k3sVersion}\\
        --context ${kubeContext} \\
        --local-path $KUBECONFIG \\
        --merge 2>&1`,
      delete: interpolate`ssh -C -i "${privKey}" "${connection.user}@${connection.host}" "sudo k3s-uninstall.sh" 2>&1`,
      environment: {
      }
    },
    options
  )
}

export function install(master: NodeConfig, options: Object) {
  const connection = parseHost(master.address)
  return new command.local.Command(
    `install k3s master on ${connection.host}`,
    {
      create: interpolate`
      k3sup install \\
        --ip "${connection.host}" \\
        --user "${connection.user}" \\
        --ssh-key "${privKey}" \\
        --k3s-extra-args "${nodeNetworkConfig(master)}" \\
        --k3s-version ${k3sVersion}\\
        --context ${kubeContext} \\
        --local-path $KUBECONFIG \\
        --cluster\\
        --merge 2>&1`,
      delete: interpolate`ssh -C -i "${privKey}" "${connection.user}@${connection.host}" "sudo k3s-uninstall.sh" 2>&1`,
      environment: {
      }
    },
    options
  )
}

export function joinMaster(worker: NodeConfig, master: NodeConfig, options: Object) {
  const connection = parseHost(worker.address)
  const to = parseHost(master.address)
  return new command.local.Command(
    `join k3s master ${connection.host} to ${to.host}`,
    {
      create: interpolate`
      k3sup join \\
        --ip "${connection.host}" \\
        --user "${connection.user}" \\
        --ssh-key "${privKey}" \\
        --k3s-extra-args "${nodeNetworkConfig(worker)}" \\
        --k3s-version ${k3sVersion}\\
        --context ${kubeContext} \\
        --local-path $KUBECONFIG \\
        --server-ip ${to.host} \\
        --server-user "${to.user}" \\
        --server \\
        --merge 2>&1`,
      delete: interpolate`ssh -C -i "${privKey}" "${connection.user}@${connection.host}" "sudo k3s-uninstall.sh" 2>&1`,
      environment: {
      }
    },
    options
  )
}

export function joinWorker(worker: NodeConfig, master: NodeConfig, options: Object) {
  const connection = parseHost(worker.address)
  const to = parseHost(master.address)
  return new command.local.Command(
    `join k3s worker ${connection.host} to ${to.host}`,
    {
      create: interpolate`
      k3sup join \\
        --ip "${connection.host}" \\
        --server-ip "${to.host}" \\
        --server-user "${to.user}" \\
        --user "${connection.user}" \\
        --ssh-key "${privKey}" \\
        --k3s-extra-args "${nodeNetworkConfig(worker)}" \\
        --k3s-version "${k3sVersion}" 2>&1`,
      delete: interpolate`
      ssh -C -i "${privKey}" "${connection.user}@${connection.host}" \\
        "sudo k3s-agent-uninstall.sh" 2>&1`,
      environment: {
      }
    },
    options
  )
}

export interface NodeConfig {
  name: string
  address: string
  iface?: string
  master: boolean
  labels: { [key: string]: string }
}
export interface K3sClusterArgs {
  clusterConfig:NodeConfig[],
  registry?: string
}

export class K3sCluster extends pulumi.ComponentResource {
  constructor(name:string,
              args: K3sClusterArgs,
              opts: pulumi.ComponentResourceOptions) {
    super("pkg:index:K3sStack", name, {}, opts)
    const { clusterConfig } = args

    let preparations = []

    preparations.push(...clusterConfig.map(node => {
      return new command.remote.Command(`set ${node.address} hostname to ${node.name}`, {
        connection: parseHost(node.address),
        environment: {
          DEBIAN_FRONTEND: 'noninteractive'
        },
        create: interpolate`sudo hostname ${node.name}; echo ${node.name} | sudo tee /etc/hostname`,
        delete: interpolate`echo ok`
      }, { parent: this })
    }))

    preparations.push(new command.local.Command(`remove kubeconfig`, {
      create: interpolate`touch kubeconfig; rm kubeconfig`,
      delete: interpolate`touch kubeconfig; rm kubeconfig`
    }, { parent: this }))


    const masters: NodeConfig[] = clusterConfig.filter(c => c.master)
    const workers: NodeConfig[] = clusterConfig.filter(c => !c.master)

    if (masters.length == 0) throw new Error('at least one master is required')
    const firstMaster = (masters.length > 1 ? install : installSingleMaster)(masters[0], {
      parent: this,
      dependsOn: [...preparations],
      ...opts
    })
    const otherMasters = masters
      .slice(1)
      .map((m) => joinMaster(m, masters[0], { parent: this, ...opts, dependsOn: [firstMaster] }))
    const allMasters = [firstMaster, ...otherMasters]
    const allWorkers = workers.map((w) =>
      joinWorker(w, masters[0], { parent: this, ...opts, dependsOn: [firstMaster] })
    )

    const all = [...masters, ...workers]

    const k3sClusterNodesReady = new command.local.Command(name + " nodes ready", {
      create: interpolate`sleep 60; kubectl wait --for=condition=Ready nodes --all --timeout=600s; sleep 5`,
      delete: interpolate`echo ok`
    },{
      parent: this,
      dependsOn: [...preparations, ...allMasters, ...allWorkers]
    })

    const labeledNodes = clusterConfig.map(node => {
      const labelsString = Object.keys(node.labels).map(key => `${key}=${node.labels[key]}`).join(' ')
      new command.local.Command(`label node ${node.name}`, {
        create: interpolate`kubectl label nodes ${node.name} ${labelsString}`,
        delete: interpolate`echo ok`
      }, {
        parent: this,
        dependsOn: [k3sClusterNodesReady]
      })
    })

    const firstMasterLocalPath = new command.local.Command(name + " local path velero fix", {
      create: interpolate`kubectl -n kube-system set image deployment/local-path-provisioner \\
        local-path-provisioner=kmjayadeep/local-path-provisioner:velero-support`,
      delete: interpolate`kubectl -n kube-system set image deployment/local-path-provisioner \\
        local-path-provisioner=rancher/local-path-provisioner:v0.0.21`,
    }, { parent: this, dependsOn: [k3sClusterNodesReady] })

/*    const csiCrds = new k8s.kustomize.Directory(name + " CSI CRDs", {
      directory: "https://github.com/kubernetes-csi/external-snapshotter/tree/v6.1.0/client/config/crd",
    }, { parent: this, dependsOn: [k3sClusterNodesReady] })
    const csiDeploy = new k8s.kustomize.Directory(name + " CSI deploy", {
      directory: "https://github.com/kubernetes-csi/external-snapshotter/tree/v6.1.0/deploy/kubernetes/csi-snapshotter"
    }, { parent: this, dependsOn: [csiCrds] })*/

    this.registerOutputs({})
  }
}
