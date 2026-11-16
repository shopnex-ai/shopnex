import { connect } from 'node:net'
import { UsageError } from './errors'

/** Something already answers on this port (IPv4 or IPv6): connecting is the check that works on every platform */
export function portInUse(port: number) {
  const tryHost = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = connect({ port, host })
      socket.setTimeout(500)
      socket.once('connect', () => (socket.destroy(), resolve(true)))
      socket.once('timeout', () => (socket.destroy(), resolve(false)))
      socket.once('error', () => resolve(false))
    })
  return Promise.all([tryHost('127.0.0.1'), tryHost('::1')]).then((used) => used.some(Boolean))
}

/** Before starting anything: a taken port would make a server quit or move to another port, and the printed addresses would be wrong */
export async function assertPortsFree(ports: { port: number; flag: string }[]) {
  for (const { port, flag } of ports) {
    if (await portInUse(port)) {
      throw new UsageError(`Port ${port} is already in use. Stop what is using it, or pick another with ${flag}.`)
    }
  }
}
