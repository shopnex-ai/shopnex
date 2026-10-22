// A tiny SMTP server for tests, in the test process: no provider account needed
import { createServer, type AddressInfo } from 'node:net'

// Accepts any message, no TLS and no AUTH (like Mailpit); keeps the raw messages it receives
export function smtpSink() {
  const messages: string[] = []
  const server = createServer((socket) => {
    let buffer = ''
    let data: string | null = null
    socket.write('220 sink ESMTP\r\n')
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      for (;;) {
        if (data !== null) {
          const end = buffer.indexOf('\r\n.\r\n')
          if (end === -1) return
          messages.push(data + buffer.slice(0, end))
          data = null
          buffer = buffer.slice(end + 5)
          socket.write('250 OK queued\r\n')
          continue
        }
        const newline = buffer.indexOf('\r\n')
        if (newline === -1) return
        const command = buffer.slice(0, 4).toUpperCase()
        buffer = buffer.slice(newline + 2)
        if (command === 'EHLO') socket.write('250-sink\r\n250 8BITMIME\r\n')
        else if (command === 'DATA') {
          data = ''
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
        } else if (command === 'STAR' || command === 'AUTH') socket.write('502 Command not implemented\r\n')
        else if (command === 'QUIT') socket.end('221 Bye\r\n')
        else socket.write('250 OK\r\n')
      }
    })
  })
  return {
    messages,
    start: () =>
      new Promise<number>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
      ),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
