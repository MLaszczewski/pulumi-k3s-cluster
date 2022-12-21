import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import * as command from '@pulumi/command'
import { interpolate } from '@pulumi/pulumi'

const config = new pulumi.Config()

interface HttpsIngressArgs {
  domain: string,
  otherDomains: string[],
  authSecret?: string,
  serviceName: string
  servicePort?: number
}

export class HttpsIngress extends pulumi.ComponentResource {
  constructor(name: string, args: HttpsIngressArgs, opts: pulumi.ComponentResourceOptions) {
    super('pkg:index:HttpIngress', name, {}, opts)

    const certificate = new k8s.apiextensions.CustomResource(`${name} certificate`, {
      apiVersion: 'cert-manager.io/v1',
      kind: 'Certificate',
      metadata: {
        name: name,
      },
      spec: {
        secretName: name + '-tls',
        issuerRef: {
          name: 'letsencrypt-prod',
          kind: 'ClusterIssuer'
        },
        commonName: `${args.domain}`,
        dnsNames: [
          args.domain,
          ...args.otherDomains
        ]
      }
    }, {...opts, parent: this, dependsOn: []})

    const redirectHttpsMiddleware = new k8s.apiextensions.CustomResource(`${name} redirect https`, {
      apiVersion: 'traefik.containo.us/v1alpha1',
      kind: 'Middleware',
      metadata: {
        name: `${name}-redirect-https`,
      },
      spec: {
        redirectScheme: {
          scheme: 'https',
          permanent: true
        }
      }
    }, {...opts, parent: this, dependsOn: []})
    const redirectDomainMiddleware = new k8s.apiextensions.CustomResource(`${name} redirect domain`, {
      apiVersion: 'traefik.containo.us/v1alpha1',
      kind: 'Middleware',
      metadata: {
        name: `${name}-redirect-domain`,
      },
      spec: {
        redirectRegex: {
          regex: `^https?://(.*)/(.*)$`,
          replacement: `https://${args.domain}/${'${1}'}`,
        }
      }
    }, {...opts, parent: this, dependsOn: []})
    const middlewares = [redirectHttpsMiddleware, redirectDomainMiddleware]
    if (args.authSecret) {
      const basicAuthMiddleware = new k8s.apiextensions.CustomResource(`${name} basic-auth`, {
        apiVersion: 'traefik.containo.us/v1alpha1',
        kind: 'Middleware',
        metadata: {
          name: `${name}-basic-auth`,
        },
        spec: {
          basicAuth: {
            secret: args.authSecret,
          }
        }
      }, {...opts, parent: this, dependsOn: []})
      middlewares.push(basicAuthMiddleware)
    }

    function route(domain: string, path: string, port?: number, redirectToHttps: boolean = false) {
      const routeConfig = {
        match: 'Host(`' + domain + '`) && PathPrefix(`' + path + '`)',
        kind: 'Rule',
        services: [{
          name: args.serviceName,
          port: port || 80,
          weight: 1,
          passHostHeader: true,
          responseForwarding: {
            flushInterval: '50ms'
          }
        }],
        middlewares: [
          ...(domain != args.domain ? [{name: `${name}-redirect-domain`}] : []),
          ...(redirectToHttps ? [{name: `${name}-redirect-https`}] : []),
          ...((args.authSecret && !redirectToHttps) ? [{name: `${name}-basic-auth`}] : [])
        ]
      }
      //console.log(domain, path, 'config', routeConfig)
      return routeConfig
    }

    const httpsIngressRoute = new k8s.apiextensions.CustomResource(`${name} https ingress`, {
      apiVersion: 'traefik.containo.us/v1alpha1',
      kind: 'IngressRoute',
      metadata: {
        name: `${name}-https-ingress`,
      },
      spec: {
        entryPoints: ['websecure'],
        routes: [
          route(args.domain, '/', args.servicePort),
          ...(args.otherDomains.flatMap(domain => [
            route(domain, '/', args.servicePort),
          ])),
        ],
        tls: {
          secretName: name + '-tls'
        }
      },
    }, {...opts, parent: this, dependsOn: [certificate, ...middlewares]})

    const httpIngressRoute = new k8s.apiextensions.CustomResource(`${name} http ingress`, {
      apiVersion: 'traefik.containo.us/v1alpha1',
      kind: 'IngressRoute',
      metadata: {
        name: `${name}-http-ingress`,
      },
      spec: {
        entryPoints: ['web'],
        routes: [
          route(args.domain, '/', args.servicePort),
          ...(args.otherDomains.flatMap(domain => [
            route(domain, '/', args.servicePort),
          ])),
        ],
      },
    }, {...opts, parent: this, dependsOn: [certificate, ...middlewares]})

    this.registerOutputs({})
  }
}
