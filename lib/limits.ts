import * as pulumi from "@pulumi/pulumi";

export interface Limits {
  storage?: pulumi.Input<string>
  cpu?: pulumi.Input<string>
  memory?: pulumi.Input<string>
  maxCpu?: pulumi.Input<string>
  maxMemory?: pulumi.Input<string>
}

export function resourceLimits(args: Limits = {}, defaults: Limits): pulumi.Input<any> {
  return {
    requests: {
      cpu: args.cpu ?? defaults.cpu,
      memory: args.memory ?? defaults.memory
    },
    limits: {
      cpu: args.maxCpu ?? defaults.maxCpu,
      memory: args.maxMemory ??  defaults.maxMemory
    }
  }
}
