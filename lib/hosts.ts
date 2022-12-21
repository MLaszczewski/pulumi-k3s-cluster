import * as command from "@pulumi/command"
import * as pulumi from "@pulumi/pulumi"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const config = new pulumi.Config()

const sshKey = fs.readFileSync(
  config.get<string>("sshKey") ?? path.join(os.homedir(), ".ssh", "id_rsa")
).toString("utf8")

export function parseHost(hostInfo: string):command.types.input.remote.ConnectionArgs {
  const parts = hostInfo.split('@')
  const [user, host] = parts.length > 1 ? parts : [parts[0], config.getObject<string>('sshUser') || 'root']
  return { host, user, privateKey: sshKey }
}

export function parseHostsList(hosts: string[]): command.types.input.remote.ConnectionArgs[] {
  return hosts.map(hostInfo => parseHost(hostInfo))
}

