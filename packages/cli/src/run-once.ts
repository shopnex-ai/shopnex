import { spawn } from 'node:child_process'

/** Runs a Node script to the end with its output shown as it comes; resolves with the exit code */
export function runOnce({ script, cwd, env }: { script: string; cwd: string; env: Record<string, string> }) {
  return new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [script], { cwd, env: { ...process.env, ...env }, stdio: 'inherit' })
    child.on('error', (error) => {
      console.error(`Could not start ${script}: ${error.message}`)
      resolve(1)
    })
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}
