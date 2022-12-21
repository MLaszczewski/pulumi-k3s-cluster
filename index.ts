import * as pulumi from "@pulumi/pulumi"
import * as command from "@pulumi/command"
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";
import { interpolate } from "@pulumi/pulumi"

import { K3sCluster, NodeConfig } from "./components/k3sUp"
import { Wireguard } from './components/wireguard'

import { parseHost } from "./lib/hosts"
import {KnotDns, KnotDnsZone} from "./components/knotdns"
import {LetsEncrypt} from "./components/letsencrypt"
import {EchoExample} from "./components/echoExample"
import {HttpsIngress} from "./components/httpsIngress"

const config = new pulumi.Config()

const domain = config.require('domain')

const clusterConfig = config.requireObject<NodeConfig[]>('cluster')

const k3sCluster = new K3sCluster("k3s cluster",
  { clusterConfig },
  { dependsOn: [] })

const wireguard = new Wireguard('wireguard', {}, { dependsOn: [k3sCluster] })

const letsencrypt = new LetsEncrypt('letsencrypt', { dnsChallenge: false },
  { dependsOn: [k3sCluster] })

const dns = new KnotDns('knotdns', { }, { dependsOn: [k3sCluster] })

const nameServers = config.requireObject<string[]>('name-servers')
const wwwServers = clusterConfig
  .filter(node => node.labels.www)
  .map((node) => parseHost(node.address).host)

const dnsEntries = [
  `@ 7200 IN SOA ${nameServers.join('. ')}. 2016020202 7200 1800 1209600 86400`,
  ...(nameServers.map(nameServer => `@ 7200 IN NS ${nameServer}.`)),
  // A RECORDS
  ...(wwwServers.map(wwwServer => `@ 3600 IN A ${wwwServer}`)),
  ...(wwwServers.map(wwwServer => `www 3600 IN A ${wwwServer}`)),
  ...(wwwServers.map(wwwServer => `* 3600 IN A ${wwwServer}`))
]

const echoZone = new KnotDnsZone("echo." + config.require<string>('domain'), {
  name: "echo." + config.require<string>('domain'),
  entries: dnsEntries
}, { dependsOn: [dns] })

const echo = new EchoExample("echo", { text: "Hello World!" }, { dependsOn: [k3sCluster] })

const echoIngress = new HttpsIngress("echo-ingress", {
  domain: "www.echo." + config.require<string>('domain'),
  otherDomains: ["echo." + config.require<string>('domain')],
  serviceName: 'echo'
}, { dependsOn: [echo, echoZone] })

